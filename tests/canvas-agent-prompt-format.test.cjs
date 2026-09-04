const assert = require('node:assert/strict');
const test = require('node:test');
const { extractJsonCandidate, parseStructuredResult, reasoningForRequest, routeForRequest, splitInstructions, structuredOutputInstruction } = require('../electron/main/modules/canvas-agent/canvas-agent-service.cjs');
const { z } = require('zod');
const { smartReverseMessages } = require('../electron/main/modules/canvas-agent/tasks/reverse-prompt.cjs');
const {
  formatOptimizedPromptLines,
  imagePromptOptimizationMessages,
  removeTechnicalPromptParameters,
} = require('../electron/main/modules/canvas-agent/tasks/optimize-image-generator-prompt.cjs');
const { agentBaseUrl } = require('../electron/main/modules/canvas-agent/agent-model.cjs');

test('Canvas Agent normalizes OpenAI-compatible API roots', () => {
  assert.equal(agentBaseUrl({ baseUrl: 'https://api.example.com', protocol: 'openai' }), 'https://api.example.com/v1');
  assert.equal(agentBaseUrl({ baseUrl: 'https://api.example.com/v1/', protocol: 'compatible' }), 'https://api.example.com/v1');
  assert.equal(agentBaseUrl({ baseUrl: 'https://api.example.com/api/v3', protocol: 'compatible' }), 'https://api.example.com/api/v3');
  assert.equal(agentBaseUrl({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'gemini' }), 'https://generativelanguage.googleapis.com/v1beta');
});

test('smart reverse uses only the model route supplied by the canvas node', () => {
  assert.deepEqual(routeForRequest({}, 'smart-reverse', { providerId: 'node-provider', model: 'node-model' }), {
    enabled: true,
    providerId: 'node-provider',
    model: 'node-model',
  });
  assert.equal(routeForRequest({}, 'smart-reverse', null), null);
});

test('image prompt optimization uses the Agent settings route when the node does not override it', () => {
  assert.deepEqual(
    routeForRequest({}, 'optimize-image-generator-prompt', { providerId: 'node-provider', model: 'node-model' }),
    { enabled: true, providerId: 'node-provider', model: 'node-model' },
  );
  assert.deepEqual(routeForRequest({
    imageGeneratorPromptOptimization: { providerId: 'settings-provider', model: 'settings-model' },
  }, 'optimize-image-generator-prompt', null), {
    enabled: true,
    providerId: 'settings-provider',
    model: 'settings-model',
  });
  assert.equal(routeForRequest({}, 'optimize-image-generator-prompt', { providerId: 'node-provider', model: '' }), null);
});

test('Canvas Agent maps OpenAI reasoning effort for node and global settings', () => {
  assert.equal(reasoningForRequest({}, 'smart-reverse', 'none'), 'none');
  assert.equal(reasoningForRequest({}, 'smart-reverse', 'max'), 'max');
  assert.equal(reasoningForRequest({}, 'smart-reverse', 'unsupported'), 'none');
  assert.equal(reasoningForRequest({ thinkingMode: false, reasoningLevel: 'xhigh' }, 'optimize-image-generator-prompt'), 'none');
  assert.equal(reasoningForRequest({ thinkingMode: true, reasoningLevel: 'minimal' }, 'optimize-image-generator-prompt'), 'minimal');
  assert.equal(reasoningForRequest({ thinkingMode: true, reasoningLevel: 'max' }, 'optimize-image-generator-prompt'), 'max');
});

test('Canvas Agent sends task system prompts through instructions', () => {
  const taskMessages = [
    smartReverseMessages({ assets: [{ nodeId: 'image-1' }] }, 'zh-CN'),
    imagePromptOptimizationMessages({ prompt: 'portrait' }, 'zh-CN'),
  ];

  for (const messages of taskMessages) {
    const prompt = splitInstructions(messages);
    assert.ok(prompt.instructions);
    assert.equal(prompt.messages.some((message) => message.role === 'system'), false);
    assert.equal(prompt.messages.some((message) => message.role === 'user'), true);
  }
});

test('Canvas Agent keeps multimodal user message parts intact', () => {
  const imagePart = { type: 'file', data: 'data:image/jpeg;base64,AA==', mediaType: 'image/jpeg' };
  const prompt = splitInstructions([
    { role: 'system', content: 'Follow the task.' },
    { role: 'user', content: [{ type: 'text', text: 'Inspect this.' }, imagePart] },
  ]);

  assert.equal(prompt.instructions, 'Follow the task.');
  assert.deepEqual(prompt.messages[0].content[1], imagePart);
});

test('Canvas Agent parses plain, fenced, and explanatory JSON responses', () => {
  const schema = z.object({ optimizedPrompt: z.string() });
  assert.deepEqual(parseStructuredResult('{"optimizedPrompt":"plain"}', schema), { optimizedPrompt: 'plain' });
  assert.deepEqual(parseStructuredResult('```json\n{"optimizedPrompt":"fenced"}\n```', schema), { optimizedPrompt: 'fenced' });
  assert.deepEqual(parseStructuredResult('结果如下： {"optimizedPrompt":"extracted"} 谢谢', schema), { optimizedPrompt: 'extracted' });
  assert.throws(() => parseStructuredResult('not json', schema), /invalid JSON/i);
  assert.equal(extractJsonCandidate('{"a":"} inside string"} trailing'), '{"a":"} inside string"}');
});

test('Canvas Agent injects the concrete JSON schema into text-output prompts', () => {
  const instruction = structuredOutputInstruction(z.object({ optimizedPrompt: z.string(), warnings: z.array(z.string()) }), 'zh-CN');
  assert.match(instruction, /optimizedPrompt/);
  assert.match(instruction, /warnings/);
  assert.match(instruction, /required/);
});

test('Image Generator optimized prompts strip explicit generation controls', () => {
  const cleaned = removeTechnicalPromptParameters('一张女性肖像，1024x1024，1:1，2K，高画质，生成三张，红色外套');
  assert.equal(cleaned, '一张女性肖像，红色外套');
});

test('Image Generator optimization instructions expose exact Chinese reference labels', () => {
  const [, user] = imagePromptOptimizationMessages({
    prompt: '人物戴帽子',
    referenceImages: [{ title: 'hat.png' }, { title: 'glasses.png' }],
  }, 'zh-CN');
  assert.match(user.content, /参考图 1：@图一/);
  assert.match(user.content, /参考图 2：@图二/);
  assert.match(user.content, /禁止写入 optimizedPrompt/);
  assert.doesNotMatch(user.content, /负面 Prompt|用户补充要求/);
});

test('Image Generator optimized prompts gain readable semantic line breaks', () => {
  const source = '年轻女性穿着红色外套，微微侧身看向镜头，双手轻扶帽檐并与参考图中的配饰互动，中景人像构图并保留街道纵深，傍晚暖色逆光勾勒人物轮廓，细腻织物材质与电影胶片质感';
  const formatted = formatOptimizedPromptLines(source, 34);
  assert.match(formatted, /\n/);
  assert.equal(formatted.replace(/\n/g, ''), source);
  assert.equal(formatOptimizedPromptLines('主体外观\n动作互动\n构图光影'), '主体外观\n动作互动\n构图光影');
});
