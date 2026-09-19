# 动作裂变 Agent 模式方案

## 1. 背景与目标

当前「动作裂变」节点必须先绑定动作库动作：每一行（= 一张目标卡片）都要选择一个动作项目、
标签筛选和具体动作，运行时把 `selectedActionPrompt` 作为提示词基础。

本次要增加一个 **Agent 模式**：

- 不再需要选择动作库里的动作。
- 由用户接入的 LLM 模型读取已连接的参考图，自动为每个卡片生成一条提示词。
- 卡片数量仍然由用户手动增删行决定。

目标是把「动作裂变」从「动作库驱动」扩展为「参考图驱动」，
让用户在没有合适动作素材时仍然能批量产出差异化结果。

## 2. 与既有计划的关系

`docs/forart-embedded-agent-plan.md` 第 22 行写有「取消 Action Fission 自动选择动作」，
第 27 行把动作裂变的智能能力重新定义为「用户先选动作，再优化提示词」。
该路线（Phase 4，生图前提示词优化）至今未实现，`electron/main/modules/canvas-agent/tasks/`
下只有 `reverse-prompt.cjs` 和 `optimize-image-generator-prompt.cjs`。

本方案不是「优化已选动作的提示词」，而是**绕开动作库、直接生成提示词**，
因此会覆盖上述旧决策。实施前需要同步更新 `forart-embedded-agent-plan.md`，
避免两份文档互相矛盾。

可以复用的既有基础设施：

| 能力 | 位置 |
| --- | --- |
| Agent 任务分发、结构化输出校验、取消、120s 超时、密钥脱敏 | `electron/main/modules/canvas-agent/canvas-agent-service.cjs` |
| 参考图读取与压缩（最长边 1600px → JPEG q86） | `electron/main/modules/canvas-agent/canvas-agent-images.cjs` |
| 渲染层 Agent 调用与运行状态 | `renderer/src/features/canvas-agent/CanvasAgentProvider.tsx` |
| Agent 任务消息与 schema 先例 | `electron/main/modules/canvas-agent/tasks/optimize-image-generator-prompt.cjs` |
| 节点内选择平台 / 模型 / 推理强度的先例 | `renderer/src/features/infinite-canvas/nodes/ImageReverseParamPanel.tsx` |
| 参数面板插入整组提示词编辑器的先例（批量洗图） | `renderer/src/features/infinite-canvas/nodes/BatchImageGeneratorNodeBody.tsx` |

## 3. 已确认的产品决策

1. **卡片数量**：仍由用户手动增删行决定，LLM 不改变行数。
2. **两段式流程**：先生成提示词，用户确认后再生图。
3. **参数面板新增 Agent 行**：底部变为两行，第一行选择 LLM 平台 / 模型 / 推理强度并生成提示词，
   第二行是现有生图参数与运行按钮。
4. **整组创作要求**：新增节点级输入框，插入方式与批量洗图一致
   （复用 `ImageGeneratorParamPanel` 的提示词编辑器）。
5. **摘要位置**：卡片左下角不再叠加摘要预览（图片下方已显示摘要）；
   摘要规范为「动作·构图或角度」，例如「单手插兜·全身侧面」。
6. **提示词可编辑**：通过卡片行末的齿轮按钮打开提示词编辑弹层；
   摘要由模型生成、不参与生图，所以不可编辑。
7. **生成时拼接**：生图时把 LLM 生成的提示词与接入的提示词节点拼接；
   但生成提示词时不把这些接入的提示词节点传给 LLM。
8. **差异规划**：每张卡的差异由 LLM 自动规划。
9. **模型选择**：在节点内选择平台与模型，不走全局 Agent 设置；推理强度也在节点内暴露。
10. **模型列表**：下拉列出全部对话模型，「需选择支持图片输入的模型」这条提示放在下拉框内部。
11. **附加参考图**：保持行级开关；传给 LLM 时把全部参考图一起传入，
    并明确告知每张附加参考图被哪些行使用。
12. **不设上限**：单次调用不限制行数，也不限制参考图数量，模型或 Provider 自身的限制直接报错。
13. **只做整组生成**：不提供单行「重新生成这条提示词」入口。
14. **换一批消失**：Agent 模式下隐藏「整组切换动作」按钮。
15. **步骤标识**：参数面板两行最左侧各放一个图标，标明「第一步：生成提示词」「第二步：生成图片」；
    「生成提示词」按钮与生图按钮一致，只用一个图标按钮。
16. **生成中动效**：生成提示词期间，在卡片图片下方（摘要区域）显示与智能优化一致的文本骨架动画。
17. **提示词格式**：提示词只写「构图：」和「动作：」两段，每段一行。
    服装、配饰、场景、风格、光影等由用户自己连接的提示词节点补充。
18. **不做过期判定**：不引入签名比对、过期角标和失效提示。
19. **模式切换需确认**：切换模式前弹出提示，说明会清理模式专属配置；
    确认后清空两种模式的专属配置，但**保留已生成的图片结果**。
20. **模式隔离**：动作库故障不影响 Agent 模式；Agent 模式不做动作库查询，也不自动分配动作。
21. **模式切换控件**：使用与任务中心一致的分段切换组件，只显示图标，
    放在节点头部「新增栏位」右侧。
22. **兼容旧画布**：`mode` 缺省视为 `library`，旧画布行为不变。

## 4. 已确认的默认值

- 推理强度默认 `medium`，可节点内调整。
- 模式切换只清模式专属配置，已生成的图片与生图参数一律保留。

## 5. 数据模型

`renderer/src/features/infinite-canvas/action-fission/actionFissionTypes.ts`：

```ts
export type ActionFissionMode = "library" | "agent";

export interface ActionFissionState {
  mode?: ActionFissionMode;        // 缺省 = "library"
  rows: ActionFissionRow[];
  apiType?: "third-party-api" | "libtv-api";
  providerId?: string;
  model?: string;
  libtvModelName?: string;
  resolution?: string;
  aspectRatio?: string;

  // Agent 模式专属
  agentProviderId?: string;
  agentModel?: string;
  agentReasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface ActionFissionRow extends BatchNodeItemBase {
  // ...现有字段保持不变

  // Agent 模式专属
  agentPrompt?: string;            // 完整提示词，生图与悬浮展示使用
  agentPromptLabel?: string;       // LLM 给出的差异摘要（3-8 字），卡片正面显示
  agentWarnings?: string[];
}
```

整组创作要求**不新增字段**，直接复用节点数据上现成的文本字段，与批量洗图保持一致：

- 文本：`data.text`
- 富文本 / @图 引用文档：`data.imagePromptDocument`

`data.text` 在动作裂变节点上当前未被使用，也不会被下游节点当作「连接的提示词」读取
（`collectConnectedPrompt` 只识别 `prompt` / `llm` / `smartReverse` 三种节点），因此可以安全复用。

其他约束：

- `canvasSnapshotSemantics.ts` 的 `compactActionFissionRow` 会透传未知字段，
  Agent 模式字段无需额外改造即可随画布保存；实现时确认不会误删 `agentPrompt` 与 `agentPromptLabel`。
- `normalizeActionFissionState` 负责归一化 `mode` 与 Agent 字段，并继续丢弃历史遗留字段。

## 6. 交互设计

### 6.1 模式切换

节点头部「新增栏位」右侧提供「动作库 / Agent」分段切换（复用任务中心的 `NativeTabs`，只显示图标）。

- 当前模式没有任何专属配置时可直接切换，不弹确认。
- 存在专属配置时弹出确认框，列出将被清理的内容；用户确认后才执行。
- 切换时同时清空两种模式的专属配置，避免切回时残留上一次的配置。

清理与保留范围：

| 数据 | 切换时 |
| --- | --- |
| 动作分类组、`selectedCategoryGroupId` | 清空（归一化为空分类组） |
| `selectedActionId` / `Name` / `Prompt` / `Tags` / `AssetUrl` / `ThumbUrl` | 清空 |
| `agentPrompt` / `agentPromptLabel` / `agentWarnings` | 清空 |
| 每行生成结果（`resultUrl` / `resultThumbUrl` / 文件名 / 尺寸 / 下载状态） | 保留 |
| `latestGenerationTaskId` | 保留（结果仍在，任务监听需要） |
| 行数与行 ID | 保留 |
| 比例、分辨率、画质、自定义尺寸 | 保留 |
| 生图平台与图像模型 | 保留 |
| Agent 平台 / 模型 / 推理强度 | 保留（切到 Agent 模式后无需重新选择） |
| 节点尺寸、位置、分组 | 保留 |

### 6.2 参数面板布局（Agent 模式）

```text
[主参考图 / 附加参考图 参考图组]
[整组创作要求  ← 与批量洗图相同的位置与编辑器]
──────────────────────────────────────────────
✨ 第一行：[平台 ▾] [模型 ▾] [推理强度 ▾]   [生成提示词（图标按钮）/ 取消]
🖼 第二行：[比例] [分辨率] [画质] [下载]     [运行]
```

- 「生成提示词」运行中显示阶段文案（准备请求 / 解析图片 / 请求模型 / 校验结果），可取消。
- 「生成提示词」与生图按钮一致，只用一个图标按钮；已有提示词时语义为整组重跑。
- 未选择平台或模型时按钮禁用并给出提示。
- 模型下拉列出全部对话模型，下拉框内部标注「需选择支持图片输入的模型」。
- 两行最左侧的图标标明步骤：第一行生成提示词，第二行生成图片。
- 生成失败只报错，不静默降级，也不自动开始生图。

运行状态复用 `useCanvasAgent()` 的运行记录（按 `nodeId + task` 过滤），
面板重挂或切换节点后仍能恢复「正在生成提示词」的状态。

### 6.3 卡片提示词区

Agent 模式下不再叠加左下角的摘要预览（图片下方已经显示摘要）：

- 摘要、附加参考状态与提示词首行显示在卡片图片下方（原行信息区）；
- 点击行末齿轮按钮打开提示词编辑弹层，保存写入一次独立撤销记录；
- 无提示词：摘要显示「待生成提示词」；
- 生成中：图片下方显示文本骨架动画（与生图智能优化的占位一致）；
  骨架复用与文本摘要相同的三个行元素，行高天然一致，卡片高度不会变化
  （也不依赖写死的高度），动作库模式的高度即是基准；
- 生图结果、下载、创建素材节点、单行运行按钮等区域保持不变。

### 6.4 Agent 模式下隐藏或改写的入口

| 入口 | 动作库模式 | Agent 模式 |
| --- | --- | --- |
| 整组「切换动作」 | 显示 | 隐藏 |
| 单行「切换动作」 | 显示 | 隐藏 |
| 单行齿轮「动作分类」 | 打开动作分类弹窗 | 打开提示词编辑弹层 |
| 行汇总信息 | 项目 / 标签 / 动作名 | 差异摘要 / 提示词状态 |
| 参数面板提示词编辑器 | 隐藏 | 显示为「整组创作要求」 |

## 7. Agent 任务设计

### 7.1 任务注册

新增 `electron/main/modules/canvas-agent/tasks/generate-action-fission-prompts.cjs`，
在 `canvas-agent-service.cjs` 中：

- `SUPPORTED_TASKS` 增加 `generate-action-fission-prompts`；
- `collectContextAssets` 对该任务返回 `context.referenceImages`；
- 调用 `resolveImageParts` 时**不传 `maxImages`**（对应决策 12）；
- 结构化输出仍走 `parseStructuredResult`；
- 模型路由使用渲染层传来的 `modelRoute`（平台 + 模型），推理强度使用 `request.reasoning`，
  与 `smart-reverse` 的处理方式一致，不依赖全局 Agent 设置。

### 7.2 上下文

```ts
interface ActionFissionPromptGenerationContext {
  instruction?: string;            // 整组创作要求（data.text）
  referenceImages: Array<{
    id: string;                    // 稳定 id，用于在提示中引用
    imageUrl: string;
    title?: string;                // 节点标题 / 参考图序号
    role: "primary" | "additional";
  }>;
  rows: Array<{
    rowId: string;
    additionalReferenceIds: string[]; // 该行开关打开的附加参考图 id
  }>;
}
```

说明：

- 全部参考图（主参考 + 附加参考）一次性传给模型，不做数量截断。
- 每行的 `additionalReferenceIds` 由行级 `useAdditionalReferences` 开关决定，
  用于让模型知道「第 3 行的附加参考图是 @图四」这类关系。
- 明确**不传入**：接入的提示词节点内容、动作库信息、分辨率 / 比例 / 画质等技术参数。

### 7.3 输出 schema

```ts
{
  prompts: Array<{
    rowId: string;
    prompt: string;
    label: string;       // 3-8 字差异摘要
    warnings: string[];
  }>;
}
```

校验要求：

- 返回的 `rowId` 必须落在请求的行集合内；
- 提示词非空、按固定段落分行、不含技术参数；
- `label` 归一化为「动作·构图或角度」写法（统一分隔符、去掉句末标点）；
- 缺失的行不写入数据，并在面板上提示重试。

提示词结构（模型必须遵守，主进程再做一次断行兜底）：

```text
构图：从头到脚的全身镜头
动作：模特正面朝向镜头，单手插兜，头部微微侧向光源
```

只输出 `构图` 与 `动作` 两段，动作段落允许模型自由展开。
参考图用法、服装、配饰、场景、风格、光影与氛围由用户自己连接的提示词节点补充；
参考图仍会作为视觉输入传给模型，用于理解主体。

### 7.4 提示词要点（System Prompt）

- 角色：Forart 动作裂变的提示词生成模块。
- 为每个卡位生成一条可直接用于生图的完整提示词，卡位之间必须有明确差异
  （动作、镜位、表情、构图、场景、与配饰或道具的互动由模型自行规划）。
- 不得改变参考图中的人物身份、人物数量和服装配饰的关键特征。
- 多张参考图且用户未说明关系时，默认第一张为主体参考，其余按可见内容理解为
  风格、服装、场景、道具或细节补充；不得虚构参考图中不存在的品牌与道具。
- 结合每行的附加参考图归属信息，在对应卡位中体现这些图片里的可见特征。
- 用户填写了整组创作要求时，优先遵循用户要求。
- 不写分辨率、尺寸、宽高比、画质档位、生成数量等技术参数。
- 不输出「第 1 张」「卡位 A」等编号说明，直接写画面内容。
- 输出语言跟随界面语言。

### 7.5 失败处理

- 未选择平台或模型 → 按钮禁用并提示。
- 请求失败、返回非法 JSON、schema 校验失败 → 面板显示错误，
  不覆盖已有提示词，不自动开始生图。
- 用户取消 → 保留原提示词。

## 8. 生成链路改造

`renderer/src/features/infinite-canvas/action-fission/actionFissionRules.ts`：

- `actionFissionPrompt()` 增加模式参数，Agent 模式用 `agentPrompt` 替换 `selectedActionPrompt`，
  其余拼接顺序保持不变（决策 7）：

  ```text
  library 模式：selectedActionPrompt + 主 Prompt + 附加 Prompt
  agent 模式：  agentPrompt         + 主 Prompt + 附加 Prompt
  ```

- 附加 Prompt 是否参与拼接、附加参考图是否参与生图，仍由行级 `useAdditionalReferences` 决定，
  两种模式行为一致。
- `getActionFissionRunReadiness()` 增加模式参数：
  Agent 模式的就绪条件是「有参考图 && 每行 `agentPrompt` 非空」，
  不再要求 `selectedActionId`。

`renderer/src/features/infinite-canvas/generation/useNativeActionFissionGeneration.ts`：

- 按模式组装 `inputs`；
- 任务标题在 Agent 模式下使用差异摘要代替动作名；
- 报错文案区分「先选择动作」与「先生成提示词」；
- API 与 LibTV 两条生图路径共用同一套提示词，不需要分别改造；
- 正在生图或正在生成提示词时不允许覆盖提示词，避免覆盖旧运行结果。

## 9. 兼容性与迁移

- `mode` 缺省视为 `library`，旧画布无需迁移。
- `normalizeActionFissionRow` 需要容忍 Agent 行没有 `categoryGroups` 的情况；
  当前实现会自动补一个空分类组，需确认这不会重新触发动作库查询。
- Agent 模式下 `useActionFissionLibraryData` 需要支持不发起查询，
  并且 `libraryFailure` 不再隐藏节点主体与参数面板。
- Agent 模式下关闭「自动补动作」effect，避免 LLM 提示词与动作提示词混用。
- 画布快照压缩与内容节点裁剪需要覆盖 Agent 字段，确认往返不丢数据。

## 10. 测试重点

- 规则层单测（沿用 `tests/action-fission-*.test.cjs` 直接转译 TS 的方式）：
  - 两种模式的就绪判断；
  - 两种模式的提示词拼接顺序；
  - 附加参考开关对拼接与参考图集合的影响。
- 状态层：`normalizeActionFissionState` / `normalizeActionFissionRow`
  对 Agent 行的归一化、快照往返，以及模式切换的清理结果。
- Agent 任务：schema 校验、`rowId` 越界与缺失行处理、非法 JSON、取消、推理强度透传。
- 交互回归：Agent 模式下隐藏「切换动作」、参数面板两行、卡片提示词摘要与悬浮全文、
  切换模式确认框；模式切换只清配置、保留生成结果；动作库模式下现有行为不变。
- 端到端：参考图与创作要求变化后不会出现脏状态；生图使用拼接后的最终提示词。

## 11. 实施阶段

1. **规则与状态层**：mode 字段、行字段、就绪判断、拼接、归一化、模式切换清理与单测。
2. **Agent 任务**：新增主进程任务文件、注册任务、上下文（含行级附加参考归属）与 schema、fixture 测试。
3. **节点 UI**：模式切换与确认框、整组创作要求编辑器、Agent 参数行、提示词卡与编辑弹层、i18n 中英文案。
4. **生成链路**：按模式分支组装输入、错误文案、运行状态恢复。
5. **回归与文档**：补端到端测试，更新 `docs/forart-embedded-agent-plan.md` 中冲突的决策条目。

## 12. 风险与控制

| 风险 | 控制方式 |
| --- | --- |
| 覆盖正在运行的提示词 | 运行中禁止写入，等待当前任务结束 |
| 模式切换误清内容 | 确认框只清模式专属配置，生成结果与生图参数一律保留 |
| 提示词与动作提示词混用 | Agent 模式下关闭自动补动作，且不查询动作库 |
| 模型不支持读图 | 界面标注能力要求，错误信息透出 Provider 原文 |
| 参考图过多导致请求过大 | 不做应用层截断，由 Provider 报错并原样呈现 |
| 与既有文档决策冲突 | 实现前先更新 `forart-embedded-agent-plan.md` |

## 13. 实现状态（已完成）

规则与状态层：

- `actionFissionTypes.ts`：新增 `ActionFissionMode`、`agentProviderId`、`agentModel`、
  `agentReasoning`（默认 `medium`）与行级 `agentPrompt` / `agentPromptLabel` / `agentWarnings`。
- `actionFissionState.ts`：模式归一化、`actionFissionMode`、`actionFissionModeHasData`、
  `switchActionFissionMode`（只清配置、保留生成结果）。
- `actionFissionRules.ts`：`getActionFissionRunReadiness` / `actionFissionPrompt` /
  `actionFissionRowReady` / `actionFissionRowLabel` 支持模式参数，默认仍为动作库模式。
- `actionFissionAgentPrompts.ts`：Agent 上下文组装（参考图角色 + 行级附加参考归属）与结果归一化。

Agent 任务：

- 新增 `electron/main/modules/canvas-agent/tasks/generate-action-fission-prompts.cjs`
  （中英文消息 + 结构化 schema）。
- `canvas-agent-service.cjs` 注册任务、复用图片解析（不限制参考图数量）、
  使用节点传入的模型路由与推理强度，并对返回提示词做技术参数清洗与固定段落断行。

界面：

- 节点头部模式切换 + 切换确认框。
- 参数面板两行各带步骤图标；第一行为平台 / 模型 / 推理强度 + 图标式生成按钮，
  模型下拉内部标注读图能力要求；「整组创作要求」编辑器与批量洗图一致。
- 卡片摘要显示在图片下方；提示词通过行末齿轮按钮打开编辑弹层；
  生成提示词期间图片下方显示文本骨架动画。
- Agent 模式下隐藏「整组切换动作」与单行「切换动作」，行设置按钮改为编辑提示词。
- 动作库故障不再影响 Agent 模式；Agent 模式不查询动作库、不自动补动作。

生成链路：

- 生图提示词按模式拼接；Agent 模式就绪条件为「有参考图 && 每行有提示词」；
  未生成提示词时提示「先生成提示词」。
- API 与 LibTV 两条生图路径共用同一套提示词。

测试：

- `tests/action-fission-agent-mode.test.cjs`：模式规则、切换清理、上下文与结果归一化。
- `tests/action-fission-agent-prompt-task.test.cjs`：任务 schema 与中英文消息。
- `tests/electron/infinite-canvas-node-toolbar-actions.spec.ts`：
  Agent 模式切换与参数面板冒烟测试。

## 14. 硬性规则（互斥与前置条件）

规则只在动作裂变节点内部生效：其他节点、以及智能反推等既有 Agent 任务都不受影响。

### 14.1 互斥

| 规则 | 触发条件 | 行为 | 落地点 |
| --- | --- | --- | --- |
| 生图期间不能生成提示词 | launching / queued / running | 按钮直接禁用（不额外弹提示），函数入口静默返回 | `actionFissionPromptGenerationBlocker` + `generateAgentPrompts` |
| 生成提示词期间不能生图 | Agent 运行中 | 整组 / 单行 / 查看器三个入口都禁用，`runActionFission` 内再兜底并提示「正在生成提示词，请稍候」 | `actionFissionImageGenerationBlocked` + `runActionFission` |
| 运行中不能切换模式 | 任一任务运行中 | 模式切换分段控件禁用 | `actionFissionModeSwitchBlocked` |
| 同节点提示词生成不并发 | Agent 运行中 | 渲染层 ref 锁 + 主进程按 operation 去重 | `agentRunLockRef` + runtime key |
| 生成提示词期间禁止改输入 | Agent 运行中 | 提示词编辑弹层、附加参考开关、删除栏位都禁用 | `ActionFissionNodeBody` |
| 切换画布直接取消 | canvasId 变化或卸载 | 静默取消该画布的提示词生成；智能反推等任务保持运行 | `CanvasAgentProvider` |

### 14.2 前置条件

- 生成提示词：Agent 模式 + 至少 1 张主参考图 + 已选择平台与模型。
- 生图：每行都有提示词 + 至少 1 张参考图。
- 结果写回：只写回发起时的节点，且该节点仍处于 Agent 模式（撤销等外部改动会阻止写回）。

### 14.4 用户可见提示的取舍

能用按钮禁用表达的状态就不再弹提示，避免提示噪音：

- 生图进行中 / 缺参考图 / 未选平台模型：只禁用按钮（未选模型时按钮 title 说明原因，平台与模型下拉用占位文案提示）。
- 每次执行都是独立的一次生成，按钮文案固定为「生成提示词」，没有「重新生成」。
- 模型漏返回某些行时不做弹窗，改为对应卡片右下角的状态显示黄色「未返回提示词」。
- 未配置对话模型 Provider 时不再显示独立提示条，改由平台/模型下拉的占位文案表达。

### 14.3 主进程边界

- `generate-action-fission-prompts` 使用独立 operation id `action_fission_prompt_generate`，
  不再落入 image prompt optimize 的提交分支，也不会被当成该任务的 `sourcePrompt`。
- 跨模态互斥不在主进程实现（由渲染层收口；主进程只负责同 operation 去重与取消）。
