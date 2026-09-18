# 组的图像调节方案

## 目标

画布上打组之后，组的 toolbar 也提供「图像调节」入口：打开后复用现有的图像调节面板，并在预览图下方列出组内所有图片，可以切换对象逐张调节。

组模式下的保存语义与单节点不同：

- 组模式只有「保存」，不再提供「覆盖原图 / 新建节点」两个选项，保存即覆盖原图。
- 组内有多张图片时，额外提供「保存整组」：把当前这张的参数套用到组内全部图片并覆盖。

## 现状与复用点

| 能力 | 位置 |
| --- | --- |
| 组的工具栏（目前只有取消编组 / 删除） | `renderer/src/features/infinite-canvas/nodes/NativeCanvasGroupNode.tsx` |
| 图像调节面板（预览 + 预设/调节 + 保存下拉） | `renderer/src/features/infinite-canvas/nodes/ImageAdjustDialog.tsx` |
| 打开入口 / 应用回写 | `canvasActions.openImageAdjustDialog` → `ReactFlowCanvasPage` 的 `imageAdjustTarget` → `imageAdjustContext` |
| 单张渲染与回写 | `adjustNodeImage(nodeId, adjustments, { imageIndex, localSourceUrl, mode })` |
| 组内节点收集（含嵌套组） | `collectNativeCanvasSubtree(groupId, nodes)`（`nativeCanvasGroups.ts`） |
| 统一取图 | `nativeCanvasNodeImages(data)`：素材节点 1 张，生成/动作裂变/批量节点多张 |

## 交互设计

### 入口

- 组工具栏在「取消编组」左侧新增「图像调节」按钮（`SlidersHorizontal`）。
- 组内没有任何可用图片时按钮禁用，title 说明原因。
- 只读画布不用特殊处理：`elementsSelectable={!readOnly}` 时组工具栏不会出现。

### 面板

- 沿用 `ImageAdjustDialog`，在预览列下方新增一条横向缩略图轨道；只有从组入口打开时才出现，单节点入口行为完全不变。
- 轨道项：缩略图（只用 `thumbUrl`，避免解码原图）+ 序号/节点名；当前项描边高亮；正在生成或不可用的项置灰并标注原因。
- 点击切换目标：预览、分辨率、自然尺寸随之刷新；**调节参数重置为默认**（避免把上一张调好的数值顺手用到这一张），视口重新 fit，预设列表不重置。
- 目标被删除或图片消失时自动切到下一个可用目标；全部失效则关闭面板（沿用现有 `imageAdjustContext` 为空即关窗的逻辑）。

### 保存语义

| 场景 | 按钮 | 行为 |
| --- | --- | --- |
| 单节点入口 | 保存 + 下拉 | 保持现状：覆盖原图 / 新建节点 |
| 组入口，组内 1 张图 | 保存 | 用当前参数覆盖这张图，保存后关窗 |
| 组入口，组内多张图 | 保存 / 应用整组 / 保存整组 | 保存 = 只覆盖当前这张并关窗；应用整组 = 把当前这张的参数复制给组内其它图片（只改参数，不落盘）；保存整组 = 每张按各自的参数覆盖原图，完成后关窗 |

- 组内每张图各自的参数在面板打开期间保留：切到别的图再切回来，之前调过的数值还在（互不串味）。
- 组模式没有「新建节点」：整组浏览时逐张派生新节点会迅速把画布铺满，且与「在组内统一调色」的意图不符。
- 「保存整组」串行执行（主进程 sharp 渲染有并发上限），按钮上显示进度「保存中 2/5」；过程中禁止关闭面板和切换目标。
- 部分失败时保留已成功的部分，toast 汇总失败/跳过的张数，不整体回滚。
- 正在生成的图片会被跳过并计入「已跳过」，不阻塞整组保存。

### 文案

- `imageAdjustApply`：`保存` / `Save`（已生效，替代原来的「应用 / Apply」）。
- 新增 `imageAdjustApplyGroup`：`应用整组` / `Apply to whole group`（附 `imageAdjustApplyGroupHint` 说明只改参数不落盘）。
- 新增 `imageAdjustSaveGroup`：`保存整组` / `Save whole group`。
- 新增 `imageAdjustSavingGroup`：`保存中 {{done}}/{{total}}` / `Saving {{done}}/{{total}}`。
- 新增 `imageAdjustGroupTargets`：`组内图片` / `Images in group`。
- 新增 `imageAdjustGroupEmpty`：`这个组里没有可调节的图片` / `No adjustable images in this group`。

## 实现要点

### 目标列表

新增纯函数 `collectGroupImageAdjustTargets(nodes, groupId)`：

- 用 `collectNativeCanvasSubtree` 取子树，天然包含嵌套子组。
- 只保留 `nativeCanvasNodeImages(data)` 非空的节点。
- 按画布阅读顺序排序（先 y 后 x），多图节点逐张展开成独立项，标签形如 `节点名 · 2`。
- 每项返回 `{ key: "nodeId#index", nodeId, imageIndex, label, thumbnailUrl, disabledReason }`，`key` 用于轨道选中态。

### 页面状态

- 保留现有 `imageAdjustTarget { nodeId, imageIndex }` 不变。
- 新增 `imageAdjustTargets: AdjustTarget[]`：由入口（单节点 / 组）决定，为空时面板不渲染轨道。
- 切换目标只改 `imageAdjustTarget`，`imageAdjustContext` 会自动重算出新目标，`adjustNodeImage` 不用改。

### 面板改动

`ImageAdjustDialog` 增加可选 props：`targets`、`activeTargetKey`、`onSelectTarget`、`onSaveGroup`、`groupProgress`。不传时保持现状。

布局上把预览包一层 `.rf-image-adjust__stage-column`（`grid-template-rows: minmax(0, 1fr) auto`），轨道放在预览下方，`.rf-image-adjust__body` 的高度约束跟着挪到这一列，避免轨道把预览压扁（轨道约占 76px）。

### 保存整组

- 复用单张流程：对每个目标调用 `adjustNodeImage(nodeId, adjustments, { imageIndex, mode: "overwrite" })`。
- 组模式固定 `mode: "overwrite"`，不需要 `localSourceUrl` 预落盘逻辑之外的额外分支。
- 历史记录：整组保存包在 `beginHistoryGesture` / `endHistoryGesture` 之间，一次撤销回到整组覆盖之前。

## 边界

- 同一节点的多张生成结果各占一个轨道项，互不影响。
- 组很大时轨道横向滚动，只加载缩略图。
- 只读画布、生成中的节点、图片加载失败的节点：列出但禁用/跳过，并给出一句原因。

## 拆分与测试

1. `collectGroupImageAdjustTargets` 纯函数 + 单测（排序、多图展开、空组、嵌套组、不可用项）。
2. `ImageAdjustDialog` 支持轨道与「保存 / 保存整组」（不传 props 时零变化），CSS 调整。
3. `openImageAdjustDialog` 支持组 scope，页面维护目标列表与切换。
4. 组工具栏按钮 + i18n 文案。
5. e2e：
   - 组内 3 张图 → 打开面板 → 轨道 3 项 → 切到第 2 张 → 预览与分辨率变化 → 调参数 → 保存 → 只有第 2 张被覆盖。
   - 保存整组 → 断言整组每张都被覆盖、进度文案出现、一次撤销可全部还原。
   - 组模式没有「新建节点」菜单项；单节点入口仍然保留。
   - 多图生成节点：保存整组会覆盖它的每一张结果图。
   - 只读画布不出现组调节按钮。
6. 文档：本文件。

## 实施状态（已完成）

方案已落地，实际实现与上面的设计一致，另有一处顺带修掉的旧问题：

| 能力 | 位置 |
| --- | --- |
| 目标收集（嵌套组、多图展开、阅读顺序排序） | `renderer/src/features/infinite-canvas/groupImageAdjustTargets.ts`（含 `tests/group-image-adjust-targets.test.cjs`） |
| 组工具栏入口 | `NativeCanvasGroupNode.tsx`：组内无图时禁用 |
| 面板轨道 + 保存 / 应用整组 / 保存整组 | `ImageAdjustDialog.tsx`：传 `targets` 时进入组模式（无「新建节点」）；每张图各自保存参数，切回来不丢；切换目标重新 fit 视口；按钮与调节区同在右栏 |
| 组会话与整组保存 | `ReactFlowCanvasPage.tsx`：`imageAdjustSession` / `imageAdjustTargets` / `saveImageAdjustGroup`（按每张各自的参数串行覆盖、带进度、跳过多图生成中的目标），保存后关窗 |
| 文案 | `imageAdjustGroupAction` / `imageAdjustSaveGroup` / `imageAdjustSavingGroup` / `imageAdjustGroupTargets` / `imageAdjustGroupSaved` / `imageAdjustGroupSaveFailed` / `imageAdjustTargetGenerating` / `imageAdjustTargetLoading` |
| 面板布局 | 标题栏之外分左右两栏：左栏预览 + 组内图片轨道（吃满面板高度），右栏预设/调节区 + 底部操作按钮 |
| e2e | `tests/electron/infinite-canvas-group-image-adjust.spec.ts` |

实现过程中发现并修复：覆盖图片时（图像调节与裁剪共用新的 `overwriteNodeImage`）此前**总是写回第 0 张**结果图，多图生成节点上调整第 2、3 张会把第 1 张覆盖掉。现在按 `imageIndex` 精确写回，e2e 用轨道缩略图断言「只有被调的那一张变了」。
