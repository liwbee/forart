# Forart 画布提示词智能能力改造计划

## 1. 已确认的产品方向

Forart 第一阶段不做画布级聊天侧栏，也不做可以自由规划和调用任意画布工具的通用 Agent。

第一阶段聚焦两类高频、边界明确的提示词能力：

1. 图像反推：根据一张或多张已连接图片，以及用户编写的要求，生成可编辑提示词。
2. 提示词智能优化：结合当前 Prompt、参考图和目标用途，在生图前优化提示词。

不同业务使用独立的 Agent 模型路由：

- 图像反推模型。
- Image Generator 提示词优化模型。
- Action Fission 提示词生成模型（节点内选择，不走全局 Agent 设置）。

这些配置独立于 Image Generator 实际使用的生图 Provider 和图像模型，后续在设置页增加独立的“Agent 设置”页面。

已取消的能力：

- 取消「从动作库自动挑选动作」；改为 Action Fission 的 Agent 模式由 LLM 直接生成提示词，
  不再经过动作库（见 `docs/action-fission-agent-mode-plan.md`）。
- 取消通用 LLM 节点。
- 第一阶段取消画布级 Agent 侧栏。
- 第一阶段取消通用工具循环、自动规划、自动布局和 MCP。

Action Fission 的智能能力有两种模式：动作库模式下按原流程选定动作并生成；
Agent 模式下不再选择动作，由节点内选择的 LLM 根据已连接参考图与整组创作要求，
为每个卡片生成一条差异化提示词，用户确认后再启动生图。
生图时仍按原有顺序拼接接入的提示词节点。

原 `llm` 节点替换为“图像反推”节点。图像反推节点接收图片输入和用户要求，输出 Prompt，可继续连接到 Image Generator 或 Action Fission。

## 2. 核心产品闭环

### 2.1 图像反推

```text
一张或多张图片节点
        ↓
连接到“图像反推”节点
        ↓
用户填写目标和补充要求
        ↓
调用图像反推模型
        ↓
生成结构化视觉分析和 Prompt
        ↓
用户编辑或重新生成
        ↓
连接到 Image Generator / Action Fission
```

### 2.2 Image Generator 提示词优化

```text
当前 Prompt + 当前参考图 + 当前目标图像模型信息
        ↓
点击“智能优化”
        ↓
调用 Image Generator 提示词优化模型
        ↓
预览原文与优化结果
        ↓
替换原文 / 追加 / 创建 Prompt 节点
        ↓
用户启动生图
```

### 2.3 Action Fission 提示词优化

```text
已选定动作 + 动作原始 Prompt
        +
主参考图 / 附加参考图
        +
连接的主体 Prompt
        ↓
调用 Action Fission 提示词优化模型
        ↓
保留动作意图，增加与人物、服装、配饰和环境的互动细节
        ↓
使用优化后的 Prompt 启动该行动作裂变生图
```

Agent 不改变：

- `selectedActionId`
- `selectedActionName`
- 动作分类和标签选择
- Action Fission 行配置

Agent 只优化最终提交给图像模型的 Prompt。

## 3. 为什么 Agent 请求放在 Electron 主进程

### Renderer 直接请求模型

优点：离 React Flow 状态近，开发初期调用简单，流式更新 UI 较直接。

问题：

- API Key 必须进入 Renderer。
- 本地图片、`forart-asset://` 和远程鉴权图片处理复杂。
- 可能遇到浏览器 CORS 和协议限制。
- 普通生图、Agent 请求和 Provider 测试容易形成多套请求实现。

### Electron 主进程请求模型

优点：

- API Key 只在主进程内解密和使用。
- 可复用 Electron `net`、本地文件、`sharp`、超时和取消能力。
- 可统一 Provider 协议、日志脱敏、图片限制和错误结构。
- 普通生图、动作裂变、Agent 请求和 Provider 验证可以共用安全请求层。

代价：

- 需要定义 IPC、进度事件和取消协议。
- 主进程不能直接访问 React Flow 实时状态，Renderer 必须先组装受限上下文。
- 画布写入仍需由 Renderer 执行。

最终边界：

```text
Renderer
  ├─ 收集选中节点和连线上下文
  ├─ 展示运行状态和结果
  ├─ 用户确认
  └─ 原子应用画布修改
          ↓ IPC（不含 API Key）
Electron Main
  ├─ 读取 Agent 设置
  ├─ 按 providerId 解析密钥
  ├─ 读取、缩放和编码图片
  ├─ 调用视觉/文本模型
  ├─ 结构化结果校验
  └─ 取消、超时、重试和日志脱敏
```

主进程负责模型请求，不负责修改 React Flow。

## 4. 现有代码接入点与约束

Provider 配置位于：

`renderer/src/features/settings/apiProviders.ts`

主进程配置存储位于：

`electron/main/modules/config-store.cjs`

实时画布状态位于：

`renderer/src/features/infinite-canvas/ReactFlowCanvasPage.tsx`

Action Fission 最终 Prompt 拼接位于：

`renderer/src/features/infinite-canvas/action-fission/actionFissionRules.ts`

现状约束：

- `apiKey` 会通过 preload 返回 Renderer。
- Image Generator 和 Action Fission 会把完整 `provider` 传回主进程启动生图。
- Provider 模型拉取和 APIMart 余额查询会在 Renderer 发送认证请求。
- 现有 `NativeCanvasActions` 没有完整的原子画布命令和前置条件检查。
- `llm` 已存在于节点类型和菜单，但没有完整节点执行 UI。

因此 API Key 迁移必须作为前置阶段，同时覆盖现有普通生图和设置页 Provider 请求。

## 5. 集中式 Canvas Agent 架构

Agent 在画布中作为一个独立功能模块挂载一次，不在 Image Generator、图像反推和 Action Fission 内分别实现请求、状态和上下文组装。

```text
ReactFlowCanvasPage
  └─ CanvasAgentProvider（每个打开画布一个实例）
       └─ NativeCanvasSurface（注册当前画布适配器）
            ├─ CanvasAgent API
            ├─ 运行状态 Store
            ├─ 统一结果/错误 UI
            └─ Canvas Agent IPC Client
              ↓ IPC
          CanvasAgentService（Electron Main 单例）
              ├─ 三个当前任务实现
              ├─ Provider Resolver
              ├─ Image Resolver
              └─ Cancel / Timeout / Redaction
```

其他组件只调用：

```ts
const canvasAgent = useCanvasAgent();

canvasAgent.reversePrompt({ nodeId });
canvasAgent.optimizeImageGeneratorPrompt({ nodeId });
canvasAgent.prepareActionFissionPrompts({ nodeId, rowIds });
```

节点组件不允许：

- 直接调用 Agent IPC。
- 自己读取 Agent 设置或 API Key。
- 自己拼模型消息和结构化输出 schema。
- 自己维护 Agent 取消 Controller。
- 自己复制 Prompt 优化结果 UI。

### 5.1 Renderer 侧最小公共接口

第一阶段只暴露当前确实需要的方法：

```ts
interface CanvasAgentApi {
  reversePrompt(input: { nodeId: string }): Promise<{ runId: string }>;
  optimizeImageGeneratorPrompt(input: { nodeId: string }): Promise<{ runId: string }>;
  prepareActionFissionPrompts(input: {
    nodeId: string;
    rowIds: string[];
  }): Promise<{
    runId: string;
    promptsByRowId: Record<string, string>;
  }>;
  applyImageGeneratorPrompt(input: {
    runId: string;
    mode: "replace" | "append" | "createPromptNode";
  }): void;
  createPromptNodeFromReverseOutput(input: {
    nodeId: string;
    outputId: string;
  }): void;
  cancel(runId: string): Promise<void>;
}
```

不预先增加通用 `run(anyTask)`、Canvas Tool Registry、审批系统、会话消息接口或 MCP 适配接口。

## 6. 当前任务实现

Canvas Agent 内部只有三个明确任务：

```ts
type CanvasAgentTask =
  | "reverse-prompt"
  | "optimize-image-generator-prompt"
  | "optimize-action-fission-prompt";
```

每个任务文件自己拥有当前任务所需的：

- 上下文读取规则。
- 主进程请求类型。
- System/User Prompt 构造。
- Zod 输出 schema。
- 结果标准化。

主进程使用简单的显式 `switch (task)` 分发三个任务。当前不设计可动态注册的任务插件协议；以后出现第四个真实功能时，再增加新的联合类型和任务实现。

模型不能自己选择任务、Provider、画布目标或权限。

## 7. 图像反推节点

### 7.1 节点类型与迁移

新增节点类型：

```ts
type NativeCanvasNodeKind =
  | "imageGenerator"
  | "imageLoader"
  | "prompt"
  | "annotation"
  | "imageReverse"
  | "actionFission"
  | "group";
```

显示名称为“图像反推”。`llm` 不再出现在新建节点菜单。

已有 `llm` 节点默认迁移为普通 Prompt 节点，以保留原有 `text`。新增 `imageReverse` 后建议升级画布 schema，并增加旧画布、剪贴板、导入包和远程交换兼容测试。

### 7.2 节点数据

```ts
interface ImageReverseNodeData {
  kind: "imageReverse";
  label: string;
  instruction?: string;
  outputLanguage?: "zh-CN" | "en-US";
  outputs?: ImageReversePromptOutput[];
}

interface ImageReversePromptOutput {
  id: string;
  sourceNodeIds: string[];
  summary: string;
  text: string;
  compactText?: string;
  negativePrompt?: string;
}
```

运行状态、错误和完整视觉分析默认只保存在内存 Run Store。画布只持久化用户要求和最终 Prompt 结果。

### 7.3 图片输入

第一版处理节点上已连接的全部参考图，不再设置用户可见或应用层固定的最多图片数。模型或 Provider 自身的上下文限制可以正常返回错误，但 Forart 不主动截断输入。

决策规则：

1. 用户明确说明图片关系或目标时，优先遵循用户要求。
2. 用户要求组合生成，但没有说明每张图的角色时，由模型判断哪些图提供主体、风格、构图、服装、细节或场景。
3. 用户没有说明多图之间的关系时，默认分别反推，每张图输出一个独立 Prompt。
4. 用户要求组合，但模型判断图片毫无关联或存在明显冲突时，不强行拼接；改为分别输出，并在结果中说明原因。

模型可以判断图片用途，但不能在缺少用户说明时擅自把多张无关图片合并成一个确定的创作意图。

### 7.4 输出

```ts
interface ReversePromptResult {
  mode: "combined" | "separate";
  relationshipSummary: string;
  imageUses: Array<{
    nodeId: string;
    use: string;
  }>;
  outputs: Array<{
    id: string;
    sourceNodeIds: string[];
    summary: string;
    detailedPrompt: string;
    compactPrompt: string;
    negativePrompt: string;
    preserved: string[];
    avoid: string[];
    uncertainties: string[];
  }>;
  warnings: string[];
}
```

`combined` 通常产生一个使用多张图的输出；`separate` 为每张图产生一个独立输出。

图像反推节点为每个输出保存稳定 `id`，并渲染独立输出 Handle。连接到 Image Generator 时，边的 `sourceHandle` 标识具体使用哪一条反推 Prompt，避免切换选中项后改变已有工作流语义。用户也可以把任意输出创建为普通 Prompt 节点。

界面固定提示：“这是根据可见内容生成的视觉重建提示词，不是原始 Prompt 还原。”

## 8. 视觉分析与 Prompt 编译

```ts
interface VisualFact {
  value: string;
  source: "observed" | "inferred" | "suggested";
  confidence: "high" | "medium" | "low";
  evidence?: string;
  uncertaintyReason?: string;
}

interface VisualAnalysis {
  summary: string;
  imageAnalyses: Array<{
    nodeId: string;
    summary: string;
    suggestedUse: string;
  }>;
  relationship: {
    canCombine: boolean;
    reason: string;
  };
  subjects: VisualFact[];
  composition: VisualFact[];
  environment: VisualFact[];
  lighting: VisualFact[];
  colors: VisualFact[];
  materials: VisualFact[];
  style: VisualFact[];
  camera: VisualFact[];
  textInImage: VisualFact[];
  interactions: VisualFact[];
  uncertainties: string[];
}
```

使用离散置信等级，不展示看似精确但未经校准的数值置信度。

```text
模型生成 VisualAnalysis JSON
        ↓
Zod 校验和有限修复/重试
        ↓
本地应用内置规则
        ↓
本地 Prompt Compiler
        ↓
ReversePromptResult
```

正常情况下只有一次模型调用。规则处理和 Prompt 编译不额外调用模型。

## 9. Image Generator 提示词智能优化

入口放在 Image Generator 节点参数面板或节点工具栏中，第一版不需要画布侧栏。

输入：

- 当前节点 Prompt 和负面 Prompt。
- 连接的 Prompt 节点。
- 连接的参考图。
- 当前目标图像模型、比例和尺寸。
- 用户可选补充要求。

```ts
interface PromptOptimizationResult {
  optimizedPrompt: string;
  optimizedNegativePrompt?: string;
  preserved: string[];
  changes: Array<{ category: string; summary: string }>;
  warnings: string[];
}
```

应用方式：替换当前 Prompt、追加、创建新 Prompt 节点并连接，或取消。

默认先预览，不自动修改节点，也不自动启动生图。

## 10. Action Fission 提示词智能优化

### 10.1 输入

```ts
interface ActionFissionPromptContext {
  canvasId: string;
  nodeId: string;
  rowId: string;
  selectedActionId: string;
  selectedActionName: string;
  selectedActionPrompt: string;
  primaryPrompt: string;
  additionalPrompts: string[];
  referenceImages: ImageInputDescriptor[];
  userInstruction?: string;
}
```

### 10.1.1 动作适配规则与可扩展 Guidance

Action Fission 不是普通的 Prompt 润色。`selectedActionPrompt` 是基础动作方案，模型可以修改动作的执行方式，但必须保留动作的展示目标和主体关系。例如“轻触胸部”可以根据参考图改为触摸胸前特殊服装结构；人物戴帽子或眼镜时，可以改为扶正、触摸、整理或摘下对应配饰。

动作适配使用统一的 Guidance 结构，避免把规则散落在每个任务的长字符串中：

```ts
interface PromptGuidancePolicy {
  purpose: string;
  priorities: string[];
  preserve: string[];
  allowed: string[];
  forbidden: string[];
  output: string[];
}
```

每个新的智能优化目的只需增加一套策略，例如“服装展示”“配饰互动”“产品展示”或“场景动作适配”，共用同一套策略渲染和结构化输出协议。Action Fission 当前策略的优先级为：用户明确要求 > 动作展示目标 > 参考图中真实可见结构 > 原始动作的具体表达 > 普通风格扩写。

输出除了最终 `optimizedPrompt` 外，还应说明 `actionIntent`、`adaptedAction`、`referenceFeaturesUsed`、`interactionEnhancements` 和 `warnings`，便于后续验证动作意图是否仍然存在。

### 10.2 规则

必须保留：动作的展示目标、动作 ID、主体身份和人物数量；原动作的具体姿态、接触目标和手部轨迹可以根据参考图适配。

允许增强和修改：

- 手与帽子、眼镜、包、服装细节的互动。
- 姿态与裙摆、外套、袖口和饰品的物理关系。
- 动作与环境、道具和镜头构图的协调。
- 避免遮挡关键产品或破坏服装设计。

- 将笼统的接触目标替换为参考图中真实存在且值得展示的服装结构、配饰或道具。
- 为了展示服装或产品而轻微调整手部位置、身体朝向、视线和构图。

禁止改变动作的展示目标、虚构品牌或产品功能、无依据增加人物或道具、遮挡关键展示对象。

### 10.3 输出与失效

```ts
interface ActionPromptOptimizationResult {
  rowId: string;
  optimizedPrompt: string;
  preservedAction: string;
  actionIntent?: string;
  adaptedAction?: string;
  referenceFeaturesUsed?: string[];
  interactionEnhancements: string[];
  warnings: string[];
}
```

动作行或参考图改变后，旧的优化结果只属于上一次执行快照，不会复用到下一次生成。

### 10.4 生图前自动优化与任务中心记录

动作裂变点击执行后，先冻结本次执行快照，并并行启动两条准备流程：

1. 调用 Action Fission 优化模型生成最终 Prompt。
2. 准备 API 或 LibTV 所需的参考图（上传、Base64/Multipart 转换或 LibTV 节点上传）。

只有两条流程都成功后，才提交远端生图请求。优化结果不显示预览、不写回动作行或画布、不产生 Undo/Redo。

生成任务内部只使用一个 `prompt` 字段，记录本次实际提交的 Prompt；该字段不写入或展示在任务中心历史中。无需设计“瞬时执行字段”和“持久化字段”的分离，也不为重试保存优化结果或恢复状态。用户再次执行时创建新的任务批次并重新优化；应用在远端提交前退出时，当前批次可直接中断。

当参数面板中的 Action Fission 优化开关已启用但模型配置无效或优化失败时，任务进入失败状态并不提交原始 Prompt，避免静默绕过用户设置。

### 10.5 批量优化

Action Fission 最多有多行，不能无条件逐行独立请求。第一版按相同参考图集合分组，使用结构化数组批量优化，只处理本次准备生成的行，并限制批量数量、总图片数和并发数。

### 10.6 生成前执行方式

已确认采用生成前自动优化：

1. 用户点击某行或多行“生成”。
2. 参数面板中的智能优化开关已启用且 Agent 路由有效时，先进入“正在优化提示词”阶段。
3. 优化成功后自动把结果作为本次生成的 `promptOverride`，继续现有生图任务。
4. 原始 `selectedActionPrompt` 不被覆盖；最终 Prompt 只保存在本次生成任务内部，不写回画布或任务中心历史。
5. 优化失败时不静默使用原始 Prompt，停止在预检阶段；本次任务失败，用户再次执行时重新发起优化。

## 11. Agent 设置页面

```ts
interface AgentModelRoute {
  enabled: boolean;
  providerId: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
}

interface AgentSettings {
  reversePrompt: AgentModelRoute;
  imageGeneratorPromptOptimization: AgentModelRoute;
  actionFissionPromptOptimization: AgentModelRoute;
  outputLanguage: "zh-CN" | "en-US";
}
```

设置页展示三张任务卡：图像反推、Image Generator 提示词优化、Action Fission 提示词优化。每张卡单独选择是否启用、Provider、模型和高级参数。

Image Generator 节点中选择的实际生图模型不影响 Agent 模型路由。Agent 请求超时由应用固定为 120 秒，不在设置页暴露可配置字段。

## 12. Provider 能力描述

```ts
interface ChatModelCapabilities {
  vision: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
  streaming: boolean;
  maxImages?: number;
  maxImageBytes?: number;
}
```

第一阶段只依赖 Vision、普通文本和 JSON/JSON Schema 输出，不依赖 Tool Calling。

不能只根据模型名称猜能力。模型导入后允许用户覆盖能力，Agent 设置页在选择模型时验证任务要求。

## 12.1 开源库选型与自研边界

已确认：第一阶段使用开源库完成“模型请求适配”和“结构化输出”，不引入完整 Agent 框架，也不实现通用 Agent 循环。AI SDK 只服务 Canvas Agent 的视觉/文本模型调用；现有 Image Generator 的底层生图协议暂不迁移到 AI SDK。

推荐依赖：

```text
ai                         # Vercel AI SDK 核心
@ai-sdk/openai             # OpenAI Provider
@ai-sdk/google             # Gemini Provider
@ai-sdk/openai-compatible  # OpenAI-compatible Provider（需要时加入）
zod                        # 项目已有，用于输出 schema
```

这些依赖只安装和运行在 Electron 主进程的 Provider Runtime 中。Renderer 只通过既有的 Canvas Agent IPC 调用，不接触 SDK、Provider 实例或 API Key。

Vercel AI SDK 在本阶段负责：

- 统一文本和视觉消息格式。
- `generateText` 等单次请求 API。
- `Output.object(...)` 结构化输出和 Zod 校验衔接。
- 流式事件、`AbortSignal` 和基础错误归一化。
- 后续接入多个 Provider 时减少协议分支。

Forart 自己负责：

- 三个任务的 Prompt、上下文组装和 Zod schema。
- 图片来源解析、缩放、大小/MIME 限制和 `sourceHash`。
- Provider Resolver、密钥解密、超时、日志脱敏和 IPC 权限边界。
- 多图关系规则、Prompt Compiler、Action Fission 批量分组。
- 结果预览、前置条件检查、画布写入和 Undo。

第一阶段明确不使用 `ToolLoopAgent`，原因是三个任务都是“一次输入 → 一次结构化结果”：模型不能选择工具，也不需要观察画布后继续规划。引入循环只会增加状态、成本、取消和错误处理面。

### 未来真正需要循环时的选型顺序

只有出现下列流程才重新评估 Agent Loop：

```text
分析画布 → 选择工具 → 修改节点 → 检查结果 → 再次调用 → 请求用户批准
```

评估顺序：

1. **Vercel AI SDK `ToolLoopAgent`**：仍需多 Provider、希望保持依赖轻量，并且循环主要是工具调用。
2. **`@openai/agents`**：主要使用 OpenAI，并需要 tracing、guardrails、sessions、handoff 或 human-in-the-loop。
3. **LangGraph**：需要长时间运行、checkpoint、可恢复状态机或人工中断/恢复时再考虑。
4. **Mastra**：当前不推荐；覆盖面和依赖量大于三项短任务的实际需要。

不建议自行手写完整 Tool Loop。若未来确实不采用 SDK，最小实现也必须覆盖最大步数、tool-call ID 配对、Zod 参数校验、工具结果回传、取消/超时、重复调用检测、错误分类、审批暂停/恢复、上下文裁剪、流式事件和 tracing；这些细节很容易在业务代码中重复出现并产生不一致行为。

### Electron 模块格式注意事项

当前 Electron 主进程文件大量使用 `.cjs`，而 `ai` 及其 Provider 包以 ESM 为主。Provider Runtime 应通过独立 `.mjs` 适配器或在 `.cjs` 中使用受控动态 `import()` 接入，禁止在各任务文件中分别处理 ESM/CJS 兼容。SDK 只在主进程加载，打包时确认 Electron Builder 会保留相关依赖。

## 13. API Key 迁移出 Renderer

### 13.1 目标

- API Key 不再通过 preload 返回 Renderer。
- API Key 不再包含在生图、动作裂变或 Agent IPC payload 中。
- API Key 不写入任务数据库、画布 JSON、导出包、日志或错误详情。
- Provider 认证请求统一在 Electron 主进程执行。

### 13.2 公开配置与私有密钥分离

```ts
interface PublicApiProvider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: "openai" | "apimart" | "gemini";
  hasApiKey: boolean;
  imageModels: string[];
  chatModels: string[];
  videoModels: string[];
}
```

```text
apiSettings.providers       → 无明文密钥
apiSecrets.<providerId>     → safeStorage 加密内容
```

设置页加载时只返回 `hasApiKey`。密钥输入框不回填旧值；空输入不会清除密钥；替换和清除密钥使用明确的独立动作。

### 13.3 一次性迁移

启动时发现旧 `apiSettings.providers[*].apiKey`：

1. 使用 `safeStorage` 加密。
2. 写入 `apiSecrets`。
3. 从公开配置删除明文字段。
4. 原子写回配置文件。
5. 迁移失败时保留旧数据，不进行半迁移。

### 13.4 受影响链路

迁移必须同时覆盖：

- Provider 地址验证和模型列表拉取。
- APIMart 余额查询。
- 普通 Image Generator 生图。
- Action Fission API 生图。
- 活跃生成任务恢复。
- Agent 请求。

Renderer 启动任务时只传 `providerId`、模型、Prompt、参考图描述和非敏感参数。主进程 Provider Resolver 负责合并公开配置和解密后的密钥。

## 14. Agent IPC

```ts
type CanvasAgentRunRequest =
  | {
      runId: string;
      task: "reverse-prompt";
      context: ReversePromptContext;
    }
  | {
      runId: string;
      task: "optimize-image-generator-prompt";
      context: ImageGeneratorPromptContext;
    }
  | {
      runId: string;
      task: "optimize-action-fission-prompt";
      context: ActionFissionPromptContext[];
    };

interface CanvasAgentProgress {
  runId: string;
  stage:
    | "queued"
    | "resolving-images"
    | "preparing-request"
    | "requesting-model"
    | "validating-result"
    | "compiling-prompt"
    | "completed";
  messageCode?: string;
}
```

Preload 只暴露：

```text
forartCanvasAgent.run(request)
forartCanvasAgent.cancel(runId)
forartCanvasAgent.onProgress(callback)
```

只有 `CanvasAgentProvider` 的 IPC Client 使用这个 preload API。画布节点和其他业务组件一律通过 `useCanvasAgent()` 调用，不直接依赖 `window.forartCanvasAgent`。

不使用 `context: unknown` 的开放请求，也不暴露任意 Provider 请求、文件读取或动态 IPC 方法名。

## 15. 图片输入处理

Renderer 只提交来源描述，不通过 IPC 复制完整 data URL：

```ts
interface ImageInputDescriptor {
  nodeId: string;
  role: "primary" | "supporting";
  assetUrl: string;
  thumbUrl?: string;
}
```

主进程负责解析本地/远程资源、校验 MIME 和尺寸、使用 `sharp` 缩放、删除非必要元数据，并根据 Provider 协议转换图片输入。

默认优先发送缩放图，不发送原图。只有确有需要且用户允许时才发送原尺寸。

## 16. 结果应用与并发保护

主进程只返回结果，不直接写画布。

`CanvasAgentProvider` 接收一个只覆盖当前功能的画布适配器：

```ts
interface CanvasAgentCanvasAdapter {
  getSnapshot(): NativeCanvasSnapshot;
  updateReversePromptOutputs(input: {
    nodeId: string;
    outputs: ImageReversePromptOutput[];
  }): void;
  applyImageGeneratorPrompt(input: {
    nodeId: string;
    prompt: string;
    negativePrompt?: string;
    mode: "replace" | "append";
  }): void;
  createPromptNode(input: {
    sourceNodeId: string;
    text: string;
  }): string;
}
```

该接口不提供通用节点删除、任意 patch、自动布局、文件访问或工具执行。以后有真实的新 Agent 写入需求时，再增加对应的具体方法。

```ts
interface PromptRunPrecondition {
  canvasId: string;
  sourceNodeIds: string[];
  sourceHash: string;
  startedAt: number;
}
```

应用前重新计算 `sourceHash`：

- 未变化：允许应用。
- 已变化：结果仍可查看，但禁止一键覆盖，提示重新运行或手动复制。
- 画布已切换、节点已删除或画布只读：禁止应用。

一次应用复用现有 `beginHistoryGesture` / `endHistoryGesture` 完成，只产生一个 Undo 记录；第一阶段不新增通用事务框架。

## 17. UI 设计

第一阶段只使用节点内入口和轻量结果面板。

图像反推节点包含：图片数量和缩略图、用户要求、当前模型摘要、“生成提示词”、阶段状态和取消。组合输出显示一张 Prompt Card；分别输出时按图片显示多张 Prompt Card，每张卡都有详细 Prompt 编辑器、精简/负面 Prompt 折叠区、独立输出 Handle 和“创建 Prompt 节点”操作。

Image Generator 增加带文字的“智能优化”按钮，结果以 Popover 或邻近浮层展示原文、优化结果、修改摘要和警告。

Action Fission 不显示“自动选动作”；已选动作行增加优化入口或状态，批量生成时显示优化阶段，并允许查看每行最终用于生图的 Prompt。

第一阶段不增加全局侧边栏，不引入聊天消息流。

## 18. 建议模块结构

```text
renderer/src/features/canvas-agent/
  index.ts
  CanvasAgentProvider.tsx
  useCanvasAgent.ts
  canvasAgentTypes.ts
  canvasAgentClient.ts
  canvasAgentRunStore.ts
  canvasAgentCanvasAdapter.ts
  canvasAgentSettings.ts
  tasks/
    reversePrompt.ts
    optimizeImageGeneratorPrompt.ts
    optimizeActionFissionPrompt.ts
  components/
    ImageReverseNodeBody.tsx
    PromptOptimizationPreview.tsx
    CanvasAgentRunStatus.tsx
    AgentSettingsPanel.tsx

electron/main/modules/canvas-agent/
  canvas-agent-service.cjs
  canvas-agent-images.cjs
  agent-model.cjs
  tasks/
    reverse-prompt.cjs
    optimize-image-generator-prompt.cjs
    optimize-action-fission-prompt.cjs

electron/main/modules/provider-runtime/
  provider-resolver.cjs
  provider-secret-store.cjs
  provider-request.cjs

electron/main/ipc/
  canvas-agent-ipc.cjs
```

`canvas-agent` 目录拥有 Agent 的任务、状态、UI、设置组件和调用入口。`provider-runtime` 是普通生图、Action Fission 和 Canvas Agent 共用的安全基础设施，不属于某一个 Agent 任务。

画布组件层级调整为：

```tsx
<ReactFlowProvider>
  <CanvasAgentProvider canvasId={canvasId}>
    <NativeCanvasSurface {...props} />
  </CanvasAgentProvider>
</ReactFlowProvider>
```

`NativeCanvasSurface` 创建当前画布适配器并注册给 Provider，因此它内部的生成 hook 和它渲染的所有节点都能调用同一个 `useCanvasAgent()`。Provider 卸载时自动取消该画布仍在运行的任务并清空适配器。

允许存在的外部接入点只有：

- `ReactFlowCanvasPage.tsx`：在 `ReactFlowProvider` 内挂载一次 `CanvasAgentProvider`；`NativeCanvasSurface` 注册当前画布适配器。
- `NativeCanvasNode.tsx`：渲染 Agent 模块导出的图像反推节点和触发按钮。
- `useNativeActionFissionGeneration.ts`：生图前调用 `prepareActionFissionPrompts`，不包含优化逻辑。
- `SettingsPage.tsx`：挂载 Agent 模块导出的设置面板。
- `preload.cjs`、`appConfig.ts`：声明最小 IPC bridge 类型。
- `electron-main.cjs`：注册 Canvas Agent IPC。

这些文件只负责接线，Agent Prompt、schema、上下文规则、运行状态和结果 UI 不散落到接入文件中。

## 19. 分阶段实施

### Phase 0：API Key 和 Provider 请求边界迁移

- 分离公开 Provider 与私有 Secret。
- 使用 `safeStorage` 加密现有 API Key。
- preload 不再返回密钥。
- Provider 验证、模型拉取和余额查询迁移到主进程。
- 普通生图和 Action Fission 生图 payload 删除完整 `provider`。
- 主进程按 `providerId` 解析 Provider 和密钥。
- 增加迁移、明文泄漏和任务恢复测试。

验收：Renderer、IPC、画布和任务数据库中都不存在 API Key；现有生图功能不回归。

### Phase 1：基础请求系统和 Agent 设置

- 新增 Agent 设置页和三条独立模型路由。
- 新增 Provider 能力描述。
- 新增 Canvas Agent IPC、取消、超时和错误结构。
- 新增主进程图片输入处理。
- 使用 fixture 验证三个任务的 schema。

验收：不接画布 UI，也能通过测试调用三个任务并得到结构化结果。

### Phase 2：图像反推节点

- 移除新建 `llm` 节点入口并迁移已有文本。
- 新增 `imageReverse` 节点和连线规则。
- 支持全部已连接图片、组合输出和逐图分别输出；不由应用层按固定数量截断。
- 支持用户要求、生成、取消、编辑和重新生成。
- 输出可作为 Prompt 连接到 Image Generator。

验收：单图能生成一个 Prompt；没有关系说明的多图能逐图输出；明确组合要求时模型能判断图片用途；无关图片不会被强行合并；失败不会修改已有内容。

### Phase 3：Image Generator 提示词优化

- 增加“智能优化”入口。
- 组装 Prompt、负面 Prompt、参考图和目标模型上下文。
- 展示优化前后结果和修改摘要。
- 支持替换、追加和创建 Prompt 节点。
- 增加 source hash 和原子 Undo。

验收：旧运行不能覆盖新编辑；应用后一次 Undo 可完整恢复。

### Phase 4：Action Fission 提示词优化

- 不实现自动动作选择。
- 基于已选动作和参考图优化最终 Prompt。
- 支持帽子、眼镜、服装、饰品和场景互动规则。
- 支持按参考图集合批量优化。
- 增加 context hash 和失效规则。
- 接入现有 API 与 LibTV 生图入口；优化与参考图准备并行，统一写入本次生成任务的最终 `prompt`。

验收：动作 ID 始终不变；上下文改变后旧结果不会被误用；批量生成不会无上限并发调用 Agent 模型。

### Phase 5：质量迭代

- 内置不同用途的 Prompt Compiler。
- 提供图像反推字段级编辑。
- 保存用户主动确认的 Prompt 版本。
- 根据生成结果做差异分析和再次优化。
- 再评估是否需要画布侧栏、会话或 MCP。

## 20. 测试重点

### API Key 安全

- 旧明文密钥原子迁移。
- Renderer 只得到 `hasApiKey`。
- 空输入不清除已有密钥，明确清除动作有效。
- 生图、Agent IPC、任务数据库和日志不包含密钥。
- `safeStorage` 不可用时不静默回退为明文保存。

### 图像反推

- 单图、多图和顺序稳定性。
- 图片缺失、损坏、过大和协议不支持；输入参考图不由应用层按固定数量截断。
- 非法 JSON 有限重试。
- 低置信度信息进入不确定项。
- 用户要求不能绕过本地硬规则。

### Prompt 优化

- 无参考图时纯文本优化，有参考图时视觉优化。
- Prompt 为空时明确提示。
- 应用方式和 Undo。
- 运行期间用户编辑导致前置条件失效。

### Action Fission

- 动作 ID 和选择字段不被修改。
- 帽子、眼镜、服装和配饰互动 fixture。
- 附加参考图开关影响优化上下文。
- 不同参考图集合正确分批。
- 上下文变化后旧结果失效。
- 优化失败时不启动错误的生图任务。
- 生成任务内部记录最终 Prompt，但任务中心不保存或展示 Prompt；再次执行不复用上次优化结果。

## 21. 风险与控制

- 优化改变动作本意：动作 ID 不可写，本地校验核心动作，UI 可查看最终 Prompt。
- 多图语义不明确：没有关系说明时逐图输出；组合任务由模型说明每张图用途；明显无关时拒绝强行合并。
- Action Fission 成本过高：只优化本次生成行，按参考集合分组，限制批量和并发。
- API Key 迁移导致回归：独立 Phase 0，原子迁移，先补任务恢复和现有生图测试。
- 旧结果覆盖新 Prompt：使用 source hash、画布 ID、节点存在性和只读状态检查。

## 22. 最终验收标准

- API Key 不再进入 Renderer。
- 普通生图、Action Fission 和 Agent 都由主进程解析 Provider 密钥。
- Agent 设置可为三类任务独立选择 Provider 和模型。
- 图像反推节点支持单图、多图组合和逐图分别输出，每个输出可独立连接到 Image Generator。
- Image Generator 可以预览和应用优化 Prompt。
- Action Fission 只优化已选动作的 Prompt，不自动选择或更换动作。
- 优化能够利用帽子、眼镜、服装、饰品和场景信息。
- 所有模型请求支持取消、超时、结构化错误和日志脱敏。
- 旧运行不能覆盖用户的新编辑。
- 第一阶段无需画布侧栏、聊天会话、工具循环或 MCP。

## 23. 推荐的首个可交付版本

```text
API Key 迁移出 Renderer
        +
Agent 设置中的图像反推模型配置
        +
图像反推节点（全部已连接图片）
        +
生成、取消、编辑和连接到 Image Generator
```

第二个版本加入 Image Generator 智能优化，第三个版本加入 Action Fission 生图前提示词优化。

## 24. 已确认的交互默认值

1. 多图反推不预设主参考。用户未说明图片关系时逐图输出 Prompt；用户要求组合时由模型判断每张图用途；图片明显无关时仍改为逐图输出。
2. Action Fission 在点击生成后自动优化并继续生图；优化失败时停止，不静默降级为原始 Prompt；再次执行会重新优化。

Phase 0–4 当前没有阻塞性的产品交互决策。

## 25. 当前已执行的基础实现

- 已加入 `ai`、OpenAI、Gemini 和 OpenAI-compatible Provider adapters。
- Provider API Key 已迁移到 Electron 主进程 `safeStorage`；Renderer 只接收 `hasApiKey`。
- Provider 模型列表和 APImart 余额请求已迁移到主进程。
- 普通 Image Generator 和 Action Fission 生图只提交 `providerId`，主进程按配置解析密钥。
- 已建立 Canvas Agent 主进程 IPC、取消、进度事件和独立 Renderer Provider。
- 已建立三个一次性结构化任务执行器，没有引入 Tool Loop。
- 已增加 Agent 设置页，可分别配置三类任务的 Provider 和模型。
