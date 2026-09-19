const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

// Loads renderer TS modules and resolves their relative TS imports, so the Agent
// mode rules can be unit tested without a bundler.
function loadTsModule(filePath, cache = new Map()) {
  if (cache.has(filePath)) return cache.get(filePath).exports;
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  cache.set(filePath, loaded);
  const localRequire = (specifier) => {
    if (!specifier.startsWith('.')) return require(specifier);
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : `${resolved}.ts`;
    return target.endsWith('.ts') ? loadTsModule(target, cache) : require(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const actionFissionDir = path.join(
  __dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'action-fission',
);

function loadRules() {
  return loadTsModule(path.join(actionFissionDir, 'actionFissionRules.ts'));
}

function loadState() {
  return loadTsModule(path.join(actionFissionDir, 'actionFissionState.ts'));
}

function loadAgentPrompts() {
  return loadTsModule(path.join(actionFissionDir, 'actionFissionAgentPrompts.ts'));
}

function row(overrides = {}) {
  return {
    id: 'row-1',
    categoryGroups: [{ id: 'g1', actionProjectId: '', includeActionTagIds: [], excludeActionTagIds: [] }],
    selectedCategoryGroupId: 'g1',
    ...overrides,
  };
}

test('Agent 模式的行就绪条件只看提示词', () => {
  const { getActionFissionRunReadiness, actionFissionRowReady } = loadRules();
  const rows = [
    row({ id: 'r1' }),
    row({ id: 'r2', agentPrompt: '   ' }),
    row({ id: 'r3', agentPrompt: '侧身回眸，手扶帽檐' }),
  ];
  const readiness = getActionFissionRunReadiness(rows, 1, 'agent');
  assert.deepEqual(readiness.unconfiguredRowIds, ['r1', 'r2']);
  assert.equal(readiness.canRun, false);
  assert.equal(getActionFissionRunReadiness([rows[2]], 1, 'agent').canRun, true);
  assert.equal(getActionFissionRunReadiness([rows[2]], 0, 'agent').missingReference, true);
  assert.equal(actionFissionRowReady(rows[2], 'agent'), true);
  // 动作库模式仍然只看动作选择。
  assert.equal(actionFissionRowReady(row({ selectedActionId: 'a1' }), 'library'), true);
  assert.equal(actionFissionRowReady(row({ agentPrompt: 'x' }), 'library'), false);
});

test('Agent 模式的提示词拼接用 agentPrompt 替换动作提示词', () => {
  const { actionFissionPrompt } = loadRules();
  const target = row({
    selectedActionPrompt: '动作库提示词',
    agentPrompt: 'Agent 提示词',
    useAdditionalReferences: true,
  });
  assert.equal(
    actionFissionPrompt(target, '主体提示词', ['附加提示词'], 'agent'),
    ['Agent 提示词', '主体提示词', '附加提示词'].join('\n\n'),
  );
  assert.equal(
    actionFissionPrompt(target, '主体提示词', ['附加提示词'], 'library'),
    ['动作库提示词', '主体提示词', '附加提示词'].join('\n\n'),
  );
  // 附加参考开关关闭时不拼接附加提示词，两种模式一致。
  assert.equal(
    actionFissionPrompt({ ...target, useAdditionalReferences: false }, '主体提示词', ['附加提示词'], 'agent'),
    ['Agent 提示词', '主体提示词'].join('\n\n'),
  );
});

test('归一化补全模式与 Agent 字段', () => {
  const { normalizeActionFissionState, actionFissionMode } = loadState();
  const fallback = normalizeActionFissionState(undefined);
  assert.equal(actionFissionMode(fallback), 'library');
  assert.equal(fallback.agentReasoning, 'medium');

  const legacy = normalizeActionFissionState({ rows: [row({ selectedActionId: 'a1' })], promptOptimizationEnabled: true });
  assert.equal(actionFissionMode(legacy), 'library');
  assert.equal(legacy.promptOptimizationEnabled, undefined);

  const agent = normalizeActionFissionState({
    mode: 'agent',
    agentProviderId: '  p1  ',
    agentModel: ' m1 ',
    agentReasoning: 'nope',
    rows: [row({ agentPrompt: '  提示词  ', agentPromptLabel: ' 特写 ', agentWarnings: [' 注意 ', ''] })],
  });
  assert.equal(actionFissionMode(agent), 'agent');
  assert.equal(agent.agentProviderId, 'p1');
  assert.equal(agent.agentModel, 'm1');
  assert.equal(agent.agentReasoning, 'medium');
  assert.equal(agent.rows[0].agentPrompt, '提示词');
  assert.equal(agent.rows[0].agentPromptLabel, '特写');
  assert.deepEqual(agent.rows[0].agentWarnings, ['注意']);
});

test('切换模式清空两种模式的配置但保留生成结果与生图参数', () => {
  const { switchActionFissionMode, actionFissionModeHasData } = loadState();
  const state = {
    mode: 'library',
    resolution: '2K',
    aspectRatio: '1:1',
    providerId: 'image-provider',
    agentProviderId: 'llm-provider',
    agentModel: 'llm-model',
    agentReasoning: 'high',
    rows: [row({
      selectedActionId: 'a1',
      selectedActionName: '动作',
      selectedActionPrompt: '动作提示词',
      selectedActionAssetUrl: 'asset.png',
      agentPrompt: '旧的 Agent 提示词',
      useAdditionalReferences: true,
      resultUrl: 'result.png',
      resultThumbUrl: 'result-thumb.png',
      latestGenerationTaskId: 'task-1',
    })],
  };
  assert.equal(actionFissionModeHasData(state), true);
  const next = switchActionFissionMode(state, 'agent');
  assert.equal(next.mode, 'agent');
  assert.equal(next.rows[0].selectedActionId, undefined);
  assert.equal(next.rows[0].selectedActionPrompt, undefined);
  assert.equal(next.rows[0].agentPrompt, undefined);
  assert.equal(next.rows[0].categoryGroups.length, 1);
  assert.equal(next.rows[0].categoryGroups[0].actionProjectId, '');
  // 生成结果、任务 id、生图参数与模型选择都保留。
  assert.equal(next.rows[0].resultUrl, 'result.png');
  assert.equal(next.rows[0].resultThumbUrl, 'result-thumb.png');
  assert.equal(next.rows[0].latestGenerationTaskId, 'task-1');
  assert.equal(next.rows[0].useAdditionalReferences, true);
  assert.equal(next.resolution, '2K');
  assert.equal(next.aspectRatio, '1:1');
  assert.equal(next.providerId, 'image-provider');
  assert.equal(next.agentProviderId, 'llm-provider');
  assert.equal(next.agentModel, 'llm-model');
  assert.equal(next.agentReasoning, 'high');
  // 切回原模式同样会清空，且没有配置时不触发确认框。
  const back = switchActionFissionMode(next, 'library');
  assert.equal(actionFissionModeHasData(switchActionFissionMode(back, 'library')), false);
  assert.equal(actionFissionModeHasData({ mode: 'library', rows: [row()] }), false);
});

test('Agent 上下文带上参考图角色与每行的附加参考归属', () => {
  const { buildActionFissionAgentPromptContext } = loadAgentPrompts();
  const context = buildActionFissionAgentPromptContext({
    rows: [
      row({ id: 'r1', useAdditionalReferences: true }),
      row({ id: 'r2' }),
    ],
    primaryReferences: [{ imageUrl: 'main.png', title: '主图' }],
    additionalReferences: [
      { imageUrl: 'hat.png', title: '帽子' },
      { imageUrl: '   ' },
    ],
    instruction: '  展示服装  ',
  });
  assert.equal(context.instruction, '展示服装');
  assert.deepEqual(context.referenceImages.map((item) => [item.id, item.role, item.imageUrl]), [
    ['primary_1', 'primary', 'main.png'],
    ['additional_1', 'additional', 'hat.png'],
  ]);
  assert.deepEqual(context.rows, [
    { rowId: 'r1', additionalReferenceIds: ['additional_1'] },
    { rowId: 'r2', additionalReferenceIds: [] },
  ]);
  const withoutInstruction = buildActionFissionAgentPromptContext({
    rows: [row({ id: 'r1' })],
    primaryReferences: [{ imageUrl: 'main.png' }],
    additionalReferences: [],
    instruction: '   ',
  });
  assert.equal(withoutInstruction.instruction, undefined);
});

test('Agent 结果只接受请求过的行并报告缺失行', () => {
  const { normalizeActionFissionAgentPromptResult, normalizeActionFissionAgentPromptLabel } = loadAgentPrompts();
  const result = normalizeActionFissionAgentPromptResult({
    prompts: [
      { rowId: 'r2', prompt: '  提示词 B  ', label: ' 特写 ', warnings: ['注意', ''] },
      { rowId: 'unknown', prompt: '越界', label: '', warnings: [] },
      { rowId: 'r1', prompt: '   ', label: '', warnings: [] },
      { rowId: 'r2', prompt: '重复', label: '', warnings: [] },
    ],
  }, ['r1', 'r2']);
  assert.deepEqual(result.patches, [
    { rowId: 'r2', agentPrompt: '提示词 B', agentPromptLabel: '特写', agentWarnings: ['注意'] },
  ]);
  assert.deepEqual(result.missingRowIds, ['r1']);
  assert.deepEqual(normalizeActionFissionAgentPromptResult(null, ['r1']).missingRowIds, ['r1']);
  // 摘要规范：「动作·构图或角度」，统一分隔符并去掉句末标点。
  assert.equal(normalizeActionFissionAgentPromptLabel(' 单手插兜 · 全身侧面。 '), '单手插兜·全身侧面');
  assert.equal(normalizeActionFissionAgentPromptLabel('·单手插兜·全身侧面·'), '单手插兜·全身侧面');
  assert.equal(normalizeActionFissionAgentPromptLabel(''), '');
  assert.deepEqual(
    normalizeActionFissionAgentPromptResult({
      prompts: [{ rowId: 'r1', prompt: '构图：半身近景', label: ' 回眸 · 半身 ', warnings: [] }],
    }, ['r1']).patches,
    [{ rowId: 'r1', agentPrompt: '构图：半身近景', agentPromptLabel: '回眸·半身' }],
  );
});

test('生成提示词与生图的互斥规则', () => {
  const {
    actionFissionModeSwitchBlocked,
    actionFissionImageGenerationBlocked,
    actionFissionPromptGenerationBlocker,
  } = loadRules();
  const idle = { imageGenerationActive: false, promptGenerationActive: false };
  const imagesRunning = { imageGenerationActive: true, promptGenerationActive: false };
  const promptsRunning = { imageGenerationActive: false, promptGenerationActive: true };

  // 模式切换：任一任务运行期间都不允许。
  assert.equal(actionFissionModeSwitchBlocked(idle), false);
  assert.equal(actionFissionModeSwitchBlocked(imagesRunning), true);
  assert.equal(actionFissionModeSwitchBlocked(promptsRunning), true);

  // 生图：只在生成提示词期间被禁止。
  assert.equal(actionFissionImageGenerationBlocked(idle), false);
  assert.equal(actionFissionImageGenerationBlocked(promptsRunning), true);
  assert.equal(actionFissionImageGenerationBlocked(imagesRunning), false);

  // 生成提示词：模式 / 互斥 / 参考图三道前置。
  assert.equal(actionFissionPromptGenerationBlocker({ mode: 'agent', referenceCount: 1, busy: idle }), '');
  assert.equal(actionFissionPromptGenerationBlocker({ mode: 'library', referenceCount: 1, busy: idle }), 'library-mode');
  assert.equal(
    actionFissionPromptGenerationBlocker({ mode: 'agent', referenceCount: 1, busy: imagesRunning }),
    'image-generation-active',
  );
  assert.equal(
    actionFissionPromptGenerationBlocker({ mode: 'agent', referenceCount: 1, busy: promptsRunning }),
    'prompt-generation-active',
  );
  assert.equal(
    actionFissionPromptGenerationBlocker({ mode: 'agent', referenceCount: 0, busy: idle }),
    'missing-reference',
  );
  // 生图优先于缺参考图报出，用户先看到「正在生成图片」。
  assert.equal(
    actionFissionPromptGenerationBlocker({ mode: 'agent', referenceCount: 0, busy: imagesRunning }),
    'image-generation-active',
  );
});
