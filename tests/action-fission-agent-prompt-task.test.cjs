const assert = require('node:assert/strict');
const test = require('node:test');

const {
  actionFissionPromptGenerationMessages,
  actionFissionPromptGenerationSchema,
  formatActionFissionPrompt,
} = require('../electron/main/modules/canvas-agent/tasks/generate-action-fission-prompts.cjs');

const context = {
  instruction: '展示服装细节',
  referenceImages: [
    { id: 'primary_1', imageUrl: 'main.png', title: '主图', role: 'primary' },
    { id: 'additional_1', imageUrl: 'hat.png', title: '帽子', role: 'additional' },
    { id: 'additional_2', imageUrl: '', title: '空地址', role: 'additional' },
  ],
  rows: [
    { rowId: 'row_1', additionalReferenceIds: [] },
    { rowId: 'row_2', additionalReferenceIds: ['additional_1'] },
  ],
};

function messageContent(messages, role) {
  return messages.filter((message) => message.role === role)
    .map((message) => String(message.content || ''))
    .join('\n');
}

test('动作裂变提示词任务的 schema 只接受结构化提示词数组', () => {
  const valid = actionFissionPromptGenerationSchema.safeParse({
    prompts: [{ rowId: 'row_1', prompt: '提示词', label: '特写', warnings: [] }],
  });
  assert.equal(valid.success, true);
  assert.equal(actionFissionPromptGenerationSchema.safeParse({ prompts: [{ rowId: 'row_1' }] }).success, false);
  assert.equal(actionFissionPromptGenerationSchema.safeParse({ prompts: [] }).success, true);
  assert.equal(actionFissionPromptGenerationSchema.safeParse({}).success, false);
});

test('中文提示词消息列出参考图编号、行与附加参考归属', () => {
  const messages = actionFissionPromptGenerationMessages(context, 'zh-CN');
  const system = messageContent(messages, 'system');
  const user = messageContent(messages, 'user');
  assert.equal(messages.length, 2);
  assert.match(system, /动作裂变/);
  assert.match(system, /输出中文/);
  assert.match(user, /展示服装细节/);
  // 空地址的参考图会被跳过，编号不会错位。
  assert.match(user, /参考图 1：@图一（主参考：主图）/);
  assert.match(user, /参考图 2：@图二（附加参考：帽子）/);
  assert.doesNotMatch(user, /空地址/);
  assert.match(user, /rowId: row_1/);
  assert.match(user, /rowId: row_2/);
  assert.match(user, /行 1（rowId: row_1）：附加参考 无/);
  assert.match(user, /行 2（rowId: row_2）：附加参考 @图二/);
});

test('英文提示词消息与空输入回退', () => {
  const messages = actionFissionPromptGenerationMessages(context, 'en-US');
  assert.match(messageContent(messages, 'system'), /Output in English/);
  assert.match(messageContent(messages, 'user'), /Row 2 \(rowId: row_2\): additional references @图二/);

  const empty = actionFissionPromptGenerationMessages({}, 'zh-CN');
  assert.match(messageContent(empty, 'user'), /（无）/);
});

test('提示词要求固定结构并规定摘要写法', () => {
  const system = messageContent(actionFissionPromptGenerationMessages(context, 'zh-CN'), 'system');
  assert.match(system, /只包含两段/);
  assert.match(system, /构图：/);
  assert.match(system, /动作：/);
  // 风格、光影、服装等交给用户自己连接的提示词节点补充。
  assert.match(system, /不要写参考图用法、服装、配饰、场景、风格、光影或氛围/);
  assert.match(system, /动作·构图或角度/);
  assert.match(system, /单手插兜·全身侧面/);
});

test('提示词按固定段落标签断行', () => {
  const singleLine = '参考图：使用@图一的模特，衣服细节参考@图二。构图：从头到脚的全身镜头。动作：模特正面朝向镜头，单手插兜。风格：潮牌 LOOKBOOK 风格';
  assert.equal(
    formatActionFissionPrompt(singleLine),
    [
      '参考图：使用@图一的模特，衣服细节参考@图二。',
      '构图：从头到脚的全身镜头。',
      '动作：模特正面朝向镜头，单手插兜。',
      '风格：潮牌 LOOKBOOK 风格',
    ].join('\n'),
  );
  // 已经分行的提示词保持结构，只做清理。
  assert.equal(
    formatActionFissionPrompt('构图：半身近景\n\n 动作：手扶帽檐 '),
    '构图：半身近景\n动作：手扶帽檐',
  );
  assert.equal(formatActionFissionPrompt('   '), '');
});
