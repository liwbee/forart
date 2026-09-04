# 图像生成"智能优化"按钮改造 + Agent 设置简化

## 需求

1. 智能优化从"提示词编辑器上方的文字按钮"改为**开始按钮左侧的图标按钮**：点击弹出下拉菜单，一级选平台（provider）、二级选模型；选中即用该模型执行优化
2. Agent 设置中**移除**"Image Generator 提示词优化"的默认模型选择和"输出语言"选项
3. 优化输出语言自动跟随程序当前界面语言

## 现状要点（已核实）

- 当前按钮：`ImageGeneratorParamPanel.tsx:828-844`（提示词编辑器上方右对齐文字按钮）；开始按钮在 `:1143-1156`，前面已有 `{beforeRunControl}` 插槽先例
- `agent.run` 已支持透传 `modelRoute`（`CanvasAgentProvider.tsx:78-88`，preload 原样透传），但 main 侧 `routeForRequest`（`canvas-agent-service.cjs:119-123`）**只对 reverse-prompt 放行**，optimize 任务强制走设置里的路由
- 面板已有 `apiSettings.providers`（`:129,244`），chatModels 可直接取；`dropdown-menu.tsx` 组件已存在（支持 SubMenu）
- 输出语言：main 从 `settings.outputLanguage` 读（`:155`）；renderer 侧 `i18n.language`（"zh-CN"/"en-US"）是活的界面语言源
- **顺带修正一个我此前的失误**：`canvas-agent-service.cjs:185` 有 `await import('ai')`，上次删依赖时被我的 grep 过滤误排除——`ai` 实际在用，需加回 package.json

## 改动步骤

### 1. main：`canvas-agent-service.cjs`

- `routeForRequest` 对 `optimize-image-generator-prompt` 也接受 `requestedRoute`（providerId+model 齐全时优先，否则回退设置路由——兼容旧数据与动作裂变优化）
- 语言：`const language = request.language === 'en-US' || request.language === 'zh-CN' ? request.language : settings.outputLanguage;`
- **package.json 加回 `ai` 依赖**（`npm install ai`）

### 2. renderer：`CanvasAgentProvider.tsx`

- `run` 内自动附带 `language: i18n.language === "en-US" ? "en-US" : "zh-CN"`（所有 agent 任务统一跟随界面语言）
- `appConfig.ts` 的 `forartCanvasAgent.run` 请求类型加 `language?: "zh-CN" | "en-US"`

### 3. renderer：`ImageGeneratorParamPanel.tsx`（核心）

- **删除**现有文字按钮行（`:828-844` 的按钮部分，`optimizationError` Alert 保留在编辑器下方）
- **新增图标按钮**（Sparkles 图标，`size="icon-sm" variant="ghost"`，title/aria = "智能优化"），渲染在开始按钮左侧（`{beforeRunControl}` 之后、Play 按钮之前）；busy 时图标换 Spinner
- 点击打开 `DropdownMenu`：一级 = 有 chatModels 的 provider 列表（沿用 AgentSettingsPanel 的过滤：`chatModels.length`，未配 key 的标注），每项 `DropdownMenuSub` 二级列出该 provider 的 chatModels；无可选项时菜单内显示"暂无可用模型"提示项
- 选中模型：`patchNodeData(nodeId, { imageOptimizationRoute: { providerId, model } })`（选择持久化在节点数据里，随画布保存），然后立即执行优化
- `runPromptOptimization` 增加 modelRoute 解析：优先节点数据 `imageOptimizationRoute` → 回退旧 agent 设置 `imageGeneratorPromptOptimization` → 回退第一个已配置 provider 的首个 chatModel；解析不到则报错提示。调用 `agent.run` 时传 `modelRoute`

### 4. renderer：`AgentSettingsPanel.tsx`

- `ROUTES` 移除 `imageGeneratorPromptOptimization`（保留 reversePrompt、actionFissionPromptOptimization）
- 移除"输出语言"下拉；保留图像反推图片数、请求超时
- 类型与 config-store 的字段不动（旧配置数据无需迁移，作为回退源仍有效）

### 5. i18n

- `infiniteCanvas` namespace 新增：`promptOptimizationPickModel`（"选择优化模型"/"Select optimization model"）、`promptOptimizationNoModel`（"暂无可用模型，请先在 API 设置中配置对话模型的平台"/"No models available..."）；按钮标题复用现有 `promptOptimization`

### 6. 测试

- `tests/canvas-agent-prompt-format.test.cjs:29` 断言更新：optimize 任务带 requestedRoute 时应返回请求路由（而非 settings 路由）；补一条"无 requestedRoute 回退 settings"的断言
- 全量验证：`npm run test:unit`（268 个）+ `npx tsc -b` + 全量 e2e（复用 reuseExistingServer 临时配置）

## 不做的事

- 不动 reverse-prompt / action-fission 优化的设置面板与逻辑（用户未要求）
- 不删 config-store 中 outputLanguage/imageGeneratorPromptOptimization 字段（作为旧数据回退保留，避免 schema 迁移）
- 不改 preload.cjs（请求对象原样透传，language 字段无需白名单）