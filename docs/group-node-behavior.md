# 组节点行为：参考图输出与空组清理

## 背景

组原本只是一个视觉容器：不能连线，也可以在没有成员时继续留在画布上。实际使用中会碰到两个问题：

1. 组里往往已经攒了很多图像节点，想把它们整体喂给下游的图片生成节点时，只能逐个节点连线。
2. 把组里的节点删掉或拖出去之后，空组会留下来，既没有内容也没有用途。

## 组作为参考图来源

- 组节点现在提供**输出端点**（右侧，id 为 `output`，`NATIVE_CANVAS_NODE_DEFINITIONS.group.providesOutput = true`）。
- 组可以连到任何接受参考图的目标：`imageGenerator`、`batchImageGenerator`、`actionFission`、`smartReverse`。
  `inputKindForSource("group")` 返回 `referenceImage`，所以连到批量/裂变节点的第二个端点时自动变成「附加参考图」。
- 一条「组 → 目标」的连线会展开成**组内所有图片节点、所有结果图**的参考：
  - 顺序按画布阅读顺序（先上后下、先左后右），含嵌套子组 —— 复用 `collectGroupImageEntries`；
  - 多图节点的每一张各占一条参考，标题形如 `节点名 2`；
  - 组里没有图的节点（提示词等）不参与。
- 组派生的参考在条目左上角显示一个**组图标**（`rf-reference-item__group`），和普通参考区分开。
- 参考条上的删除按钮对组派生的参考语义是「**断开整个组**」：一条边贡献多张参考时删掉任意一张，
  就等于删掉这条连线（多图节点的多张结果图同理）。按钮的 aria/title 会写成「移除整组参考（断开这个组）」。
- 顺序可以拖动调整：排序结果记在**那条连线**上（`edge.data.referenceImageOrder`，元素是同一条边内部多张参考图的
  `sortKey`，形如 `节点id#图片序号`），未记录的图片按默认阅读顺序排在后面。
  同一条边内的多张参考图（多图节点、组）共用这套机制，所以多图生成节点的结果图参考也能排序。
- 需要把某张图从参考里去掉时，现在是把它移出组/删掉；如果要做"从引用里排除"，见下节分析。
- 参考图数量的校验（模型支持上限）对这些参考一视同仁，超限时沿用现有的超限提示。

## 空组自动清理

- 画布上只要出现「没有任何子节点」的组，就会被静默移除（`ReactFlowCanvasPage` 里的清理 effect），
  与组相连的边也一起删掉。
- 触发时机包括：删掉组内最后一个节点、把最后一个节点拖出组外、载入本来就带空组的旧画布。
- 清理不单独记一条历史：撤销时会跟着子节点的恢复一起回来。

## 相关文件

| 能力 | 位置 |
| --- | --- |
| 组输出端点 | `renderer/src/features/infinite-canvas/nodes/NativeCanvasGroupNode.tsx`、`nativeCanvas.ts` |
| 组内图片展开 | `renderer/src/features/infinite-canvas/groupImageAdjustTargets.ts`（`collectGroupImageEntries`） |
| 参考图收集与 `locked` | `renderer/src/features/infinite-canvas/generation/imageGenerationInputs.ts` |
| 参考条目的删除/排序限制 | `renderer/src/features/infinite-canvas/nodes/ImageReferenceStrip.tsx` |
| 空组清理 | `renderer/src/features/infinite-canvas/ReactFlowCanvasPage.tsx` |
| 测试 | `tests/image-generation-inputs.test.cjs`、`tests/electron/infinite-canvas-group-output.spec.ts` |

## 批量洗图：清除全部

批量洗图节点的头部在「上传图片」右侧新增「清除全部」：一次移除所有卡片，
正在生成的卡片会先停止任务，`taskReferenceOrder` 复位，节点回到空状态提示。

## 如果要支持"删除单张组内参考"（方案分析）

参考图的来源分两种情况，代价差别很大：

| 情况 | 语义 | 实现路径 | 代价 |
| --- | --- | --- | --- |
| 组内**单图节点**（素材节点、只有一张结果的生成节点） | 把这张图对应的节点移出组 | 复用现成的 `detachNativeCanvasNode`（相对坐标换算成绝对坐标）+ 组尺寸重算 + 空组自动清理 | 约 1 天，副作用是"点小叉会改动画布结构" |
| 组内**多图节点的其中一张** | 只把这一张从引用里排除 | 在这条边上记 `excludedReferenceImages: string[]`（复用排序用的 `sortKey`），收集器过滤；参考条加"已排除 N 张 · 恢复"入口 | 约 0.5 天 |
| 真正删掉那张结果图 | 从生成节点上删除某张结果 | 现在 `generatedImages` 只支持覆盖/追加，没有删除；要新增删除能力，并处理多图网格、下载状态、历史、以及其它把这些图当参考的节点 | 2~3 天，且有跨节点副作用，不推荐为这个入口做 |

已实现的是「删除 = 断开整组」，它对应上表的第一种语义（不动组结构，只断开引用），代价最低也最不容易误解。
如果以后要支持「只排除多图节点里的某一张」，再按第二条做排除列表 + 恢复入口即可。
