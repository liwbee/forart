const { createAgentModel } = require('./agent-model.cjs');
const { resolveImageParts } = require('./canvas-agent-images.cjs');
const { smartReverseMessages, smartReverseSchema } = require('./tasks/reverse-prompt.cjs');
const {
  formatOptimizedPromptLines,
  imagePromptOptimizationMessages,
  imagePromptOptimizationSchema,
  removeTechnicalPromptParameters,
} = require('./tasks/optimize-image-generator-prompt.cjs');
const SUPPORTED_TASKS = Object.freeze({
  'smart-reverse': true,
  'optimize-image-generator-prompt': true,
});
const REASONING_LEVELS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function isEmptySuccessfulModelResponse(error) {
  const statusCode = Number(error?.statusCode);
  if (statusCode < 200 || statusCode >= 300) return false;
  try {
    const response = JSON.parse(String(error?.responseBody || ''));
    return response?.choices === null || (Array.isArray(response?.choices) && response.choices.length === 0);
  } catch {
    return false;
  }
}

function safeErrorMessage(error, provider, language = 'zh-CN') {
  const secret = String(provider?.apiKey || '').trim();
  const message = isEmptySuccessfulModelResponse(error)
    ? language === 'en-US'
      ? 'The selected LLM returned no content. Choose another LLM model in Agent settings and try again.'
      : '当前 LLM 模型未返回内容，请在 Agent 设置中选择其他 LLM 模型后重试。'
    : error instanceof Error ? error.message : String(error || 'Agent request failed.');
  return secret ? message.split(secret).join('[redacted]') : message;
}

function appendImageParts(messages, imageParts) {
  if (!imageParts.length) return messages;
  return messages.map((message, index) => {
    if (index !== messages.length - 1 || message.role !== 'user') return message;
    return {
      ...message,
      content: [{ type: 'text', text: String(message.content || '') }, ...imageParts],
    };
  });
}

// AI SDK v7 sends system instructions through the dedicated `instructions`
// option by default. Some compatible providers reject a system message inside
// `messages`, so normalize task prompts at the service boundary instead of
// making each task/provider implement its own format.
function splitInstructions(messages) {
  const systemMessages = [];
  const promptMessages = [];
  for (const message of messages || []) {
    if (message?.role === 'system') {
      const content = Array.isArray(message.content)
        ? message.content.map((part) => String(part?.text || '')).filter(Boolean).join('\n')
        : String(message.content || '');
      if (content) systemMessages.push(content);
    } else {
      promptMessages.push(message);
    }
  }
  return {
    instructions: systemMessages.join('\n\n') || undefined,
    messages: promptMessages,
  };
}

function extractJsonCandidate(text) {
  const source = String(text || '').trim();
  if (!source) return '';
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const objectStart = source.indexOf('{');
  const arrayStart = source.indexOf('[');
  const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
  if (start < 0) return source;
  const open = source[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

function parseStructuredResult(text, schema) {
  const candidate = extractJsonCandidate(text);
  let value;
  try {
    value = JSON.parse(candidate);
  } catch {
    throw new Error('Agent model returned invalid JSON.');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Agent model returned JSON with an invalid shape: ${parsed.error.issues?.[0]?.message || 'schema validation failed'}`);
  }
  return parsed.data;
}

function structuredOutputInstruction(schema, language) {
  const { z } = require('zod');
  const jsonSchema = z.toJSONSchema(schema);
  const prefix = language === 'en-US'
    ? 'Return only one JSON object matching this JSON Schema. Do not use Markdown, code fences, or add explanations.'
    : '只返回一个符合以下 JSON Schema 的 JSON 对象。不要使用 Markdown、代码围栏或添加解释。';
  return `${prefix}\n${JSON.stringify(jsonSchema)}`;
}

function routeForRequest(_settings, _task, requestedRoute) {
  if (requestedRoute?.providerId && requestedRoute?.model) {
    return {
      enabled: requestedRoute.enabled !== false,
      providerId: String(requestedRoute.providerId),
      model: String(requestedRoute.model),
      ...(Number.isFinite(Number(requestedRoute.temperature)) ? { temperature: Number(requestedRoute.temperature) } : {}),
      ...(Number.isFinite(Number(requestedRoute.maxOutputTokens)) ? { maxOutputTokens: Number(requestedRoute.maxOutputTokens) } : {}),
    };
  }
  const settings = _settings && typeof _settings === 'object' ? _settings : {};
  const fallback = _task === 'optimize-image-generator-prompt'
    ? settings.imageGeneratorPromptOptimization
    : null;
  if (!fallback?.providerId || !fallback?.model) return null;
  return {
    enabled: fallback.enabled !== false,
    providerId: String(fallback.providerId),
    model: String(fallback.model),
  };
}

function normalizeRequestLanguage(value) {
  return value === 'en-US' || value === 'zh-CN' ? value : '';
}

function collectContextAssets(task, context) {
  if (task === 'smart-reverse') return Array.isArray(context?.assets) ? context.assets : [];
  if (task === 'optimize-image-generator-prompt') return Array.isArray(context?.referenceImages) ? context.referenceImages : [];
  return [];
}

function reasoningForRequest(settings, task, requestedReasoning) {
  const value = task === 'smart-reverse'
    ? requestedReasoning
    : settings?.thinkingMode === true ? settings.reasoningLevel : 'none';
  return REASONING_LEVELS.has(String(value)) ? String(value) : 'none';
}

function createCanvasAgentService({ net, assetStore, configStore }) {
  const activeRuns = new Map();

  async function run(request = {}, emitProgress = () => {}) {
    const runId = String(request.runId || '').trim();
    const task = String(request.task || '').trim();
    if (!runId) throw new Error('Agent runId is required.');
    if (!SUPPORTED_TASKS[task]) throw new Error(`Unsupported Canvas Agent task: ${task}`);
    if (activeRuns.has(runId)) throw new Error('Agent run is already active.');

    const settings = typeof configStore.loadAgentSettings === 'function'
      ? configStore.loadAgentSettings()
      : {};
    const requestedRoute = request.modelRoute && typeof request.modelRoute === 'object' ? request.modelRoute : null;
    const route = routeForRequest(settings, task, requestedRoute);
    if (!route?.enabled) throw new Error('Select an Agent model in Agent settings first.');
    const provider = configStore.getApiProvider(route.providerId);
    if (!provider) throw new Error('Agent Provider is not configured.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    activeRuns.set(runId, controller);
    const progress = (stage) => emitProgress({ runId, stage });
    // 输出语言跟随渲染进程当前界面语言，未携带时使用中文。
    const language = normalizeRequestLanguage(request.language) || 'zh-CN';

    try {
      progress('preparing-request');
      const model = await createAgentModel(provider, route.model);
      let messages;
      let schema;
      if (task === 'smart-reverse') {
        messages = smartReverseMessages(request.context, language);
        progress('resolving-images');
        const imageParts = await resolveImageParts({
          net,
          assetStore,
          sources: collectContextAssets(task, request.context),
        });
        messages = appendImageParts(messages, imageParts);
        schema = smartReverseSchema;
      } else if (task === 'optimize-image-generator-prompt') {
        messages = imagePromptOptimizationMessages(request.context, language);
        progress('resolving-images');
        const imageParts = await resolveImageParts({ net, assetStore, sources: collectContextAssets(task, request.context), maxImages: 4 });
        messages = appendImageParts(messages, imageParts);
        schema = imagePromptOptimizationSchema;
      }

      if (controller.signal.aborted) throw new Error('Agent request canceled.');
      progress('requesting-model');
      const { generateText } = await import('ai');
      const prompt = splitInstructions(messages);
      const outputInstruction = structuredOutputInstruction(schema, language);
      const reasoning = reasoningForRequest(settings, task, request.reasoning);
      const result = await generateText({
        model,
        instructions: [prompt.instructions, outputInstruction].filter(Boolean).join('\n\n'),
        messages: prompt.messages,
        reasoning,
        ...(route.temperature !== undefined ? { temperature: route.temperature } : {}),
        ...(route.maxOutputTokens ? { maxOutputTokens: route.maxOutputTokens } : {}),
        abortSignal: controller.signal,
      });
      progress('validating-result');
      const output = parseStructuredResult(result.text, schema);
      if (task === 'optimize-image-generator-prompt') {
        output.optimizedPrompt = formatOptimizedPromptLines(
          removeTechnicalPromptParameters(output.optimizedPrompt),
        );
      }
      progress('completed');
      return output;
    } catch (error) {
      throw new Error(safeErrorMessage(error, provider, language));
    } finally {
      clearTimeout(timeout);
      activeRuns.delete(runId);
    }
  }

  function cancel(runId) {
    const controller = activeRuns.get(String(runId || '').trim());
    if (!controller) return { ok: true, canceled: false };
    controller.abort();
    return { ok: true, canceled: true };
  }

  return { run, cancel };
}

module.exports = { createCanvasAgentService, extractJsonCandidate, parseStructuredResult, reasoningForRequest, routeForRequest, safeErrorMessage, splitInstructions, structuredOutputInstruction };
