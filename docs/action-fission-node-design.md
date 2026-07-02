# 动作裂变节点设计方案

## 目标

在无限画布中新增一个“动作裂变”节点，用于把一组公共参考图和多行动作筛选组合起来，一次生成多张动作变化图。节点需要复用现有图像生成能力，但在一个节点内部管理多条生成栏位。

## 已确认规则

- 顶部参考图来自画布图片节点连接，显示为缩略图，并支持拖拽调整顺序。
- 每一个栏位生成一张图。
- 每个栏位左侧显示结果图，中间选择动作库项目和标签，右侧提供刷新动作按钮和单独运行按钮。
- 动作筛选中，多标签关系为 AND：候选动作必须同时包含所有选中的标签。
- 随机命中的动作 prompt 直接作为图像生成 prompt，不额外修改、不拼接用户补充文本。
- 行内附加图第一版只支持本地上传。
- 结果图只保存在动作裂变节点内部，不需要弹出或转换为独立画布图片节点。
- 一键运行为并发运行所有栏位。
- 最多允许 15 个栏位。
- 每个栏位保存随机结果。刷新按钮用于重新随机选择动作。
- 默认新节点只初始化 1 个栏位，但节点默认高度预留 4 个栏位的空间。
- 模型、尺寸、比例为节点级配置，放在节点模块左下角，所有栏位共用。
- 刷新动作时清空该行错误，但保留旧结果图。
- 并发失败不自动重试，只显示行级错误。
- 公共参考图基础上限为 6 张；实际有效上限取 6 和当前模型规则参考图上限中的较小值。
- 第一版需要停止按钮，支持停止单行运行和停止全部运行。
- 图像生成链路支持 `AbortController`，停止按钮需要中断本地 fetch、上传、轮询和后续保存流程。对于已经提交到远端的异步任务，第一版不承诺取消远端任务，只保证本地不再等待和写回结果。
- 单行实际提交给 provider 的参考图数量为“公共参考图 + 该行附加图”。因此运行前除了校验公共参考图上限，还必须校验总参考图数量不超过当前模型规则的 `maxReferenceImages`。
- 至少保留 1 个栏位，不能删除到 0 行。
- 修改栏位的动作项目或标签后，立刻清空该栏位已随机选中的动作。
- 停止后不显示错误或状态，只恢复为可运行状态，旧结果图保留。
- 单行正在生成时，不允许修改该行的项目、标签、附加图，也不允许刷新动作。
- 删除最后一行时，清空项目、标签、随机动作、附加图、结果图、错误和状态，让它恢复成全新的空行。

## 节点结构

节点分为四个区域：

1. 顶部参考图区
   - 显示连接进来的图片节点。
   - 缩略图按连接顺序排列。
   - 支持拖拽排序。
   - 支持移除某张参考图连接。
   - 基础上限为 6 张公共参考图；如果当前模型规则上限更小，则按更小值限制。

2. 动作栏位区
   - 每行包含：
     - 结果图预览区。
     - 动作库项目选择。
     - 多标签选择。
     - 当前随机命中的动作名。
     - 附加图上传入口和缩略图。
     - 刷新动作按钮。
     - 单行运行按钮。
   - 行高保持稳定，运行中不改变布局尺寸。

3. 新增栏位区
   - 点击后新增一行。
   - 已达到 15 行时禁用，并显示上限提示。
   - 至少保留 1 行；删除最后一行时不移除行，而是清空项目、标签、随机动作、附加图、结果图、错误和状态。

4. 底部批量运行区
   - 左下角显示节点级模型、尺寸、比例设置。
   - 右下角显示一键运行按钮。
   - 一键运行所有可运行栏位。
   - 运行时一键运行按钮切换为停止全部按钮。
   - 显示整体进度，例如 `3 / 8`。

## 交互细节

### 公共参考图

公共参考图使用现有图像生成节点的输入预览机制：

- 允许连接来源：
  - `imageLoader`
  - `imageGenerator`
- 连接目标：
  - 新节点 `actionFission`。
- 排序结果通过调整连接数组顺序保存，与现有图像生成节点保持一致。
- 公共参考图基础上限为 6 张，不会随模型规则变大。
- 如果当前模型规则的参考图上限小于 6 张，则使用模型规则的更小上限。
- 当公共参考图达到当前有效上限时，在建立连接时直接阻止新的图片连接，不额外提示；同时在单行运行和一键运行前保留兜底校验，避免模型配置变化或历史数据导致超限。
- 单行运行和一键运行前都校验公共参考图数量；超过当前有效上限时禁止运行。
- 单行运行和一键运行前还要校验“公共参考图 + 行内附加图”的总数；总数超过当前模型规则 `maxReferenceImages` 时禁止运行并显示行级错误。

### 栏位动作筛选

每个栏位保存：

- `actionProjectId`
- `actionTagIds`
- `selectedActionId`
- `selectedActionName`
- `selectedActionPrompt`
- `selectedActionTags`

候选动作获取逻辑：

1. 根据 `actionProjectId` 拉取该动作项目下全部动作。
2. 如果没有选择标签，则候选范围为该项目下全部动作。
3. 如果选择了多个标签，则只保留同时包含所有选中标签的动作。
4. 从候选动作中随机选择一个。
5. 将选中动作保存到栏位状态。

当前已确认动作条目的 `tags` 字段保存的是标签名数组，而不是标签 ID 数组。栏位状态可以保存用户选择的 `actionTagIds`，但执行 AND 过滤前必须先把这些 ID 映射为同项目下的 `ActionTag.name`，再与 `ActionEntry.tags` 比较。

因为当前动作库 API 的 `listActions` 只支持单个 `tag_id` 参数，多标签 AND 建议第一版在前端完成：

- 请求项目下全部动作。
- 在前端用 `action.tags` 做 AND 过滤。
- 过滤口径固定为标签名：`selectedTagIds -> ActionTag.name[] -> action.tags.includes(tagName)`。

如果动作数量后续变大，再考虑新增后端接口支持多标签筛选。

项目和标签变更逻辑：

- 用户修改 `actionProjectId` 时，清空该行 `actionTagIds`。
- 用户修改 `actionProjectId` 或 `actionTagIds` 后，立刻清空 `selectedActionId`、`selectedActionName`、`selectedActionPrompt`、`selectedActionTags`。
- 不清空旧结果图，避免筛选调整时误删已生成结果。
- 如果该行正在生成，项目和标签控件禁用，不允许修改。

### 刷新动作按钮

刷新按钮位于单行运行按钮左侧。

行为：

- 点击后重新从当前项目和标签范围里随机选择一个动作。
- 保存新的 `selectedActionId`、`selectedActionName`、`selectedActionPrompt`。
- 清空该行旧错误。
- 不自动运行生成。
- 不清空已有结果图，避免用户误操作导致结果丢失。
- 如果候选范围为空，显示该行错误信息。
- 如果该行正在生成，刷新按钮禁用。

### 单行运行按钮

行为：

1. 如果该行没有已保存的随机动作，先执行一次随机选择。
2. 使用 `selectedActionPrompt` 作为生成 prompt。
3. 参考图为：
   - 顶部公共参考图，按当前顺序。
   - 该行附加图，如果存在，则追加在公共参考图之后。
   - 公共参考图数量必须不超过 `min(6, modelRule.maxReferenceImages)`。
   - 公共参考图加行内附加图的总数量必须不超过 `modelRule.maxReferenceImages`。
4. 调用图像生成接口。
5. 成功后保存结果图到该行。
6. 失败只影响该行，不影响其他行。
7. 运行中，单行运行按钮切换为停止按钮。点击停止后 abort 当前本地请求链路，清空该行运行态和错误，不显示停止状态，不清空旧结果图。远端已提交任务是否真正取消取决于 provider 是否提供取消接口，第一版不额外调用远端取消接口。

### 一键运行

行为：

- 并发运行所有可运行栏位。
- 可运行栏位定义：
  - 有动作项目。
  - 筛选范围存在候选动作，或已有保存的随机动作。
  - 当前没有在运行。
  - 当前图像模型配置可用。
- 全部栏位同时发起生成。
- 每行独立记录 running/status/error。
- 批量按钮显示整体运行态，直到所有 Promise settled。
- 批量运行中，底部一键运行按钮切换为停止全部按钮。
- 点击停止全部时，abort 当前节点下所有正在运行的行。

风险控制：

- 由于一键运行是全并发，最多 15 行意味着最多同时发起 15 个图像生成请求。
- 需要保留 per-row 错误展示，避免单个失败吞掉整体结果。
- 如果 API Provider 本身限流，第一版只展示失败信息，不做自动重试。
- 停止全部不回滚已成功的行；已成功结果保留，未完成行 abort 本地请求链路、清空运行态和错误，不显示停止状态。

### 行内附加图

第一版只支持本地上传：

- 每行一个隐藏 `input[type=file]`。
- 仅允许 `image/*`。
- 只保存一张附加图。
- 上传后复用现有 `saveCanvasImageAsset` 保存为画布资源。
- 显示缩略图、替换按钮、移除按钮。
- 如果该行正在生成，上传、替换、移除附加图都禁用。

附加图不使用画布连接模型，避免第一版引入行级端口。

## 数据结构建议

在 `CanvasNodeType` 中新增：

```ts
export type CanvasNodeType =
  | "imageGenerator"
  | "imageLoader"
  | "prompt"
  | "llm"
  | "actionFission";
```

动作裂变状态采用嵌套对象，不把大量 `actionFission*` 字段平铺到 `CanvasNode` 顶层。这样可以避免 `CanvasNode` 继续膨胀，也方便后续集中维护动作裂变功能。

新增行数据：

```ts
export interface ActionFissionRow {
  id: string;
  actionProjectId: string;
  actionTagIds: string[];
  selectedActionId?: string;
  selectedActionName?: string;
  selectedActionPrompt?: string;
  selectedActionTags?: string[];
  extraImageUrl?: string;
  extraImageFileName?: string;
  resultUrl?: string;
  resultFileName?: string;
  resultWidth?: number;
  resultHeight?: number;
  running?: boolean;
  status?: string;
  error?: string;
}
```

新增节点级状态：

```ts
export interface ActionFissionState {
  rows: ActionFissionRow[];
  providerId?: string;
  model?: string;
  resolution?: "1k" | "2k" | "4k";
  aspectRatio?: "1:1" | "2:3" | "3:2" | "4:3" | "3:4" | "16:9" | "9:16";
  runningAll?: boolean;
  progress?: {
    completed: number;
    total: number;
  };
  error?: string;
}
```

在 `CanvasNode` 上只新增一个字段：

```ts
actionFission?: ActionFissionState;
```

说明：

- 模型、尺寸、比例采用节点级配置，所有栏位共用。
- 节点创建时只初始化 1 个栏位。
- 节点默认尺寸预留 4 个栏位空间，避免新增前几行时节点频繁改变高度。
- 行级只保存动作筛选、附加图、结果图和运行状态。
- 不把行结果拆成独立节点，降低画布复杂度。
- 所有动作裂变专属数据都位于 `node.actionFission` 下，避免顶层字段分散。

## 代码架构建议

动作裂变需要独立模块化实现，避免继续扩大 `CanvasPage.tsx`。`CanvasPage.tsx` 只负责画布级接线，不承载动作裂变的业务规则。

预计新增目录：

```text
renderer/src/features/infinite-canvas/action-fission/
```

建议新增文件：

- `actionFissionTypes.ts`
  - 定义 `ActionFissionRow`、`ActionFissionState`、行运行状态类型。
  - 定义常量：`MAX_ACTION_FISSION_ROWS = 15`、`DEFAULT_ACTION_FISSION_VISIBLE_ROWS = 4`、`BASE_PUBLIC_REFERENCE_LIMIT = 6`。

- `actionFissionState.ts`
  - 纯状态函数。
  - 创建默认行。
  - 创建默认 `ActionFissionState`。
  - patch row。
  - 删除行。
  - 删除最后一行时清空为全新空行。
  - 项目/标签变化后清空随机动作。

- `actionFissionActions.ts`
  - 与动作库数据相关的纯业务函数。
  - 根据项目和标签做 AND 过滤。
  - 随机选择动作。
  - 标准化动作标签比较口径。

- `actionFissionReferences.ts`
  - 公共参考图上限计算。
  - `effectivePublicReferenceLimit = min(6, 当前模型规则参考图上限)`。
  - 校验公共参考图数量。

预计新增节点 UI：

- `renderer/src/features/infinite-canvas/nodes/ActionFissionNodeBody.tsx`
  - 只负责 UI 渲染和事件转发。
  - 不直接写随机动作、生成图片、并发运行等复杂业务。

预计新增运行 hook：

- `renderer/src/features/infinite-canvas/generation/useActionFissionGenerationActions.ts`
  - 管理单行运行。
  - 管理并发一键运行。
  - 管理 `AbortController`。
  - 保存行内结果图。
  - 停止单行和停止全部。

`CanvasPage.tsx` 中只做这些接线：

- 为 `actionFission` 节点收集公共参考图 previews。
- 把公共参考图排序、移除复用现有连接顺序逻辑。
- 把 row 操作函数、运行函数、停止函数传给 `ActionFissionNodeBody`。
- 在右键菜单中加入新节点。
- 在连接规则中允许图片节点连接到 `actionFission`。
- 在落连接时阻止超过公共参考图连接上限的新图片连接，不额外提示；运行前校验仍由动作裂变运行模块兜底。

不要在 `CanvasPage.tsx` 中实现这些逻辑：

- AND 标签过滤。
- 随机动作选择。
- 行状态 patch 细节。
- 删除最后一行的清空规则。
- 单行/批量运行细节。
- `AbortController` 管理。

### `ActionFissionNodeBody` 后续重构计划

当前第一版可以先保留 `ActionFissionNodeBody` 的实现形态，避免在功能刚落地时扩大改动面。后续如果继续演进动作裂变节点，建议按以下顺序重构：

1. 抽离 `useActionFissionLibraryData`
   - 负责加载动作项目、标签、动作列表。
   - 负责生成 `tagsByProject`、`actionsByProject` 和每行候选动作数据。
   - `ActionFissionNodeBody` 只消费已经整理好的行视图数据。

2. 抽离 `useActionFissionNodeState`
   - 封装 `patchActionFission`、`patchRow`、项目变更、标签变更、附加图变更、增删行等节点状态操作。
   - 保持这些操作继续复用 `actionFissionState.ts` 的纯函数。

3. 拆分展示组件
   - `ActionFissionReferenceStrip`：顶部公共参考图预览、排序、移除。
   - `ActionFissionRowItem`：单行结果、项目、标签、附加图、刷新和运行按钮。
   - `ActionFissionFooter`：模型、尺寸、比例和一键运行区。

4. 保持生成逻辑独立
   - 单行运行、一键运行、停止、`AbortController`、保存结果继续放在 `useActionFissionGenerationActions`。
   - UI 组件只接收 `onRunRow`、`onStopRow`、`onRunAllRows`、`onStopAllRows` 这类事件回调。

5. 收口参考图规则
   - 直接连接收集、直接连接计数、公共参考图上限、总参考图校验继续集中在 `actionFissionReferences.ts`。
   - 后续如果支持更多图片来源，只改这里和连接规则，不把判断散落到 UI 里。

## 运行逻辑建议

新增 `useActionFissionGenerationActions`，职责包括：

- `refreshActionFissionRow(nodeId, rowId)`
- `runActionFissionRow(nodeId, rowId)`
- `runAllActionFissionRows(nodeId)`
- `stopActionFissionRow(nodeId, rowId)`
- `stopAllActionFissionRows(nodeId)`

单行运行伪代码：

```ts
async function runRow(nodeId, rowId) {
  const node = getNode(nodeId);
  const row = getRow(node, rowId);
  const action = row.selectedActionPrompt ? row : await pickRandomAction(row);
  const referenceImages = [
    ...collectReferenceImages(node, nodes, connections),
    row.extraImageUrl,
  ].filter(Boolean);
  const publicReferenceImages = collectReferenceImages(node, nodes, connections);
  const maxPublicReferenceImages = Math.min(6, modelRule?.maxReferenceImages || 6);
  if (publicReferenceImages.length > maxPublicReferenceImages) {
    patchRow({ error: `公共参考图最多 ${maxPublicReferenceImages} 张` });
    return;
  }
  if (referenceImages.length > (modelRule?.maxReferenceImages || 0)) {
    patchRow({ error: `当前模型最多支持 ${modelRule?.maxReferenceImages || 0} 张参考图` });
    return;
  }

  patchRow({ running: true, error: "", status: "running" });

  const result = await generateImageWithProvider({
    provider,
    model,
    prompt: action.selectedActionPrompt,
    referenceImages,
    resolution,
    aspectRatio,
  });

  const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName, kind: "output" });
  const dimensions = await readImageDimensions(saved.url);
  patchRow({
    resultUrl: saved.url,
    resultFileName: saved.fileName || result.fileName,
    resultWidth: dimensions?.width || result.width,
    resultHeight: dimensions?.height || result.height,
    running: false,
    status: "",
  });
}
```

动作裂变结果保存不要复用 `applyImageGenerationResult`，因为该函数会把结果写入节点顶层 `url`、调整节点尺寸，并更新普通图片生成节点状态。动作裂变应只复用 `generateImageWithProvider`、`saveCanvasImageAsset` 和 `readImageDimensions`，然后把结果写入对应 `ActionFissionRow`。

一键运行伪代码：

```ts
await Promise.allSettled(
  runnableRows.map((row) => runRow(nodeId, row.id))
);
```

停止运行伪代码：

```ts
function stopRow(nodeId, rowId) {
  abortControllersRef.current[`${nodeId}:${rowId}`]?.abort();
  delete abortControllersRef.current[`${nodeId}:${rowId}`];
  patchRow({ running: false, status: "", error: "" });
}

function stopAllRows(nodeId) {
  getRows(nodeId).forEach((row) => stopRow(nodeId, row.id));
  patchNode(nodeId, {
    actionFission: {
      ...node.actionFission,
      runningAll: false,
    },
  });
}
```

停止必须调用对应行的 `AbortController.abort()`，中断本地 fetch、上传、轮询和保存流程；停止后 UI 不显示错误或状态。对于已经提交到远端的异步任务，第一版不额外调用 provider 取消接口。

## UI 规格

### 节点默认尺寸

建议默认：

- 宽度：760
- 高度：620

节点创建时只有 1 个栏位，但默认高度保留 4 个栏位空间。节点允许 resize，因为最多 15 行，需要用户按画布空间调整。

### 栏位布局

每行建议使用固定三段式布局：

- 左侧结果图：96 x 96。
- 中间配置区：自适应宽度。
- 右侧操作区：两个 44 x 44 图标按钮。

按钮：

- 刷新动作：使用 `RefreshCw` 图标。
- 运行：使用 `Play` 图标。
- 运行中：使用 `Square` 停止图标。
- 一键运行：使用 `Play` 图标和文本。
- 一键运行中：使用 `Square` 停止图标和文本。

### 节点级参数区

节点左下角固定显示共用生成参数：

- 图像模型选择。
- 分辨率选择。
- 比例选择。

这些参数对所有栏位生效。运行中的行使用触发时刻的参数快照；用户在运行中修改参数不影响已经提交的请求，只影响之后的新运行。

### 状态展示

每行需要有这些状态：

- 未选择动作项目。
- 当前筛选无候选动作。
- 已随机动作但未运行。
- 运行中。
- 成功。
- 失败，可重试。

停止后不显示单独状态，行恢复为普通可运行状态。

## 需要修改的文件

预计新增：

- `renderer/src/features/infinite-canvas/action-fission/actionFissionTypes.ts`
- `renderer/src/features/infinite-canvas/action-fission/actionFissionState.ts`
- `renderer/src/features/infinite-canvas/action-fission/actionFissionActions.ts`
- `renderer/src/features/infinite-canvas/action-fission/actionFissionReferences.ts`
- `renderer/src/features/infinite-canvas/nodes/ActionFissionNodeBody.tsx`
- `renderer/src/features/infinite-canvas/generation/useActionFissionGenerationActions.ts`

预计修改：

- `renderer/src/features/infinite-canvas/types.ts`
- `renderer/src/features/infinite-canvas/constants.ts`
- `renderer/src/features/infinite-canvas/nodes/registry.ts`
- `renderer/src/features/infinite-canvas/nodes/CanvasNodeBodyRenderer.tsx`
- `renderer/src/features/infinite-canvas/core/rules.ts`
- `renderer/src/features/infinite-canvas/nodePredicates.ts`
- `renderer/src/features/infinite-canvas/CanvasPage.tsx`
- `renderer/src/features/infinite-canvas/useCanvasGenerationActions.ts`
- `renderer/src/styles/infinite-canvas.css`
- `renderer/src/i18n.ts`

## 实现顺序

1. 类型和节点注册
   - 新增 `actionFission` 节点类型。
   - 设置默认尺寸，初始化 1 个栏位，并预留 4 个栏位的视觉空间。
   - 加入右键菜单。
   - 使用 `node.actionFission` 嵌套对象保存动作裂变状态。

2. 独立动作裂变模块
   - 新增 `action-fission` 目录。
   - 抽离状态纯函数。
   - 抽离 AND 标签过滤和随机动作选择。
   - 抽离公共参考图上限计算。

3. 节点 UI
   - 顶部参考图预览和排序。
   - 行列表。
   - 新增栏位按钮和 15 行上限。
   - 删除栏位时至少保留 1 行。
   - 删除最后一行时清空为全新空行。
   - 本地附加图上传。
   - 左下角节点级模型、尺寸、比例设置。
   - 单行停止按钮和停止全部按钮。

4. 动作筛选
   - 拉取动作项目和标签。
   - 每行选择项目、多标签。
   - 实现 AND 过滤和随机选择。

5. 单行运行
   - 复用图像生成 provider/model/resolution/aspectRatio。
   - 保存行内结果。
   - 展示行级错误。
   - 支持单行停止。

6. 一键运行
   - 并发触发所有栏位。
   - 显示整体进度。
   - 保证所有行独立成功/失败。
   - 支持停止全部。

7. 验证
   - 新建节点。
   - 默认只有 1 行，但节点空间预留 4 行。
   - 连接参考图并调序。
   - 公共参考图超过当前有效上限时禁止运行或阻止新增连接。
   - 添加、删除、达到 15 行上限。
   - 多标签 AND 筛选。
   - 修改项目或标签后立即清空已随机动作。
   - 刷新动作只换动作不运行。
   - 刷新动作清空行错误但保留旧结果图。
   - 单行运行。
   - 单行运行中禁用该行项目、标签、附加图和刷新按钮。
   - 单行停止后不显示错误或状态。
   - 一键并发运行。
   - 停止全部后未完成行不显示错误或状态。
   - 附加图上传后参与参考图。
   - `CanvasPage.tsx` 只做接线，没有新增大量动作裂变业务逻辑。

## 实现前检查

当前方案没有未确认的产品规则。进入实现前需要按以下约束实现：

1. 动作条目里的 `tags` 字段已确认是标签名数组。实现 AND 过滤时，用户选择的 `actionTagIds` 必须通过当前项目的 `ActionTag[]` 转换成标签名后再比较。
2. 公共参考图有效上限为 `min(6, 当前模型规则参考图上限)`；如果模型没有更小限制，则使用 6。
3. 单行总参考图数量为公共参考图加行内附加图，必须不超过当前模型规则的 `maxReferenceImages`。
4. 停止按钮第一版只保证中断本地请求链路和阻止结果写回，不保证远端异步任务一定取消。
5. 行结果保存只写入 `node.actionFission.rows[]`，不要复用会改写节点顶层图片状态和节点尺寸的 `applyImageGenerationResult`。
