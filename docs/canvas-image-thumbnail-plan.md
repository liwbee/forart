# 无限画布图片缩略图方案

## 背景

无限画布节点变多后，拖动画布时浏览器需要持续合成和采样大量图片。图片 `src` 不变时通常不会每帧重新网络加载或重新解码，但大分辨率原图仍会增加内存、GPU 纹理和缩放采样成本。

性能上需要区分两件事：
- 文件大小主要影响磁盘/网络读取、首次加载和首次解码。
- 拖拽、缩放、合成更主要受解码后的像素尺寸影响，也就是分辨率、图片数量、滤镜和动画。

所以本方案优先降低画布常态展示时参与合成的像素量。

## 已确认规则

- 不使用 `sharp`，缩略图由 renderer 侧 Canvas 生成，Electron main 只负责保存文件。
- 缩略图统一输出 `webp`。
- 缩略图尺寸为原图 50% 分辨率，长边最大不超过 `1280px`。
- 原图长边低于 `512px` 时不生成缩略图，直接回退原图。
- WebP 质量参数使用 `0.78`。
- 透明 PNG 生成缩略图时保留透明通道。
- GIF/动图缩略图只取首帧，原图仍保留动图。
- SVG 不生成缩略图，继续用原图。
- 缩略图生成失败时静默回退原图，不影响原图保存。
- 缩略图不保留 EXIF/metadata。
- 依赖浏览器图片解码能力自动应用 EXIF orientation。
- 远程画布包不包含缩略图。
- 旧缓存不自动全量补建缩略图。
- 第一阶段只处理无限画布自己上传/保存到 `CanvasAssests/input` 和 `CanvasAssests/output` 的图片。
- 动作库/资源库自身资源缩略图后续再做。
- 清理缓存时不把孤立缩略图作为独立主资源展示；删除主图时同步删除对应缩略图。

## 路径与命名

缩略图与原图放在同类目录下：

```text
CanvasAssests/input/example.png
CanvasAssests/input/thumb/example.webp

CanvasAssests/output/example.png
CanvasAssests/output/thumb/example.webp
```

命名规则：
- 原图 `abc.png` 对应缩略图 `thumb/abc.webp`。
- 同一张原图重复生成缩略图时覆盖同名缩略图。
- 这样删除原图时可以稳定推导缩略图路径，不会留下 `abc-2.webp` 这类孤儿文件。

## 数据结构

`CanvasNode` 增加可选缩略图字段：

```ts
interface CanvasNode {
  url?: string;
  thumbUrl?: string;
  filePath?: string;
  thumbFilePath?: string;
}
```

动作裂变 row 增加结果缩略图字段：

```ts
interface ActionFissionRow {
  resultUrl?: string;
  resultThumbUrl?: string;
}
```

兼容策略：
- `thumbUrl` 缺失时 UI 回退 `url`。
- `resultThumbUrl` 缺失时 UI 回退 `resultUrl`。
- 旧画布不做迁移，仍可正常打开。
- 保存时清理 `blob:` 缩略图地址，避免临时 URL 持久化。

## 生成链路

通用缩略图生成器位于：

```text
renderer/src/features/image-thumbnails/createImageThumbnail.ts
```

无限画布保存现有本地资产缩略图的适配器位于：

```text
renderer/src/features/infinite-canvas/canvasAssetThumbnails.ts
```

接入点：
- 上传图片：保存原图到 `input` 时同时传入 `thumbDataUrl`。
- 裁剪图片：保存裁剪结果到 `output` 时同时传入 `thumbDataUrl`。
- 普通图像生成任务写回：对已保存的 `localUrl` 补写 `output/thumb/*.webp`。
- 动作裂变生成任务写回：对 row 结果补写 `resultThumbUrl`。
- LibTV 图像生成节点：对 `localUrl` 补写 `thumbUrl`。
- LibTV 动作裂变结果：对 row 结果补写 `resultThumbUrl`。

Electron main 新增能力：
- `saveCanvasAsset(payload)` 支持可选 `thumbDataUrl`。
- `saveCanvasAssetThumbnail(payload)` 为已保存的本地原图补写缩略图。
- main 不负责缩放/编码，只保存 renderer 传入的缩略图 data URL。

## 展示策略

常态展示使用缩略图优先：
- 图片节点 `<img>` 使用 `node.thumbUrl || node.url`。
- 动作裂变结果图使用 `row.resultThumbUrl || row.resultUrl`。
- 图像生成输入预览使用连接节点的 `thumbUrl || url`。
- 动作裂变参考图预览使用连接节点的 `thumbUrl || url`。

必须继续使用原图的场景：
- 查看大图。
- 下载图片。
- 裁剪图片。
- 提交给图像生成/LLM/API 的参考图。

这样可以降低画布渲染成本，同时不降低生成质量。

## 导出与远程包

第一阶段不把缩略图打包为正式资源：
- 导出 JSON/画布包时删除 `thumbUrl`、`thumbFilePath`、`resultThumbUrl`。
- 画布包只包含原图。
- 导入后没有缩略图也能回退原图。
- 后续如果服务端或资源库需要缩略图，可以基于相同命名和派生资源规则生成。

## 缓存清理

缓存扫描：
- 枚举 `input` / `output` 时排除 `thumb` 目录里的图片。
- 每个主资源记录可附带：

```ts
thumbUrl?: string;
thumbFilePath?: string;
thumbSizeBytes?: number;
```

统计：
- `inputBytes`、`outputBytes`、`referencedBytes`、`cleanableBytes` 计入对应缩略图大小。

删除：
- 删除主图时根据主图路径推导 `thumb/<basename>.webp` 并同步删除。
- 不信任前端传入的任意缩略图路径。

## 未来复用到资源库

当前抽象边界是：
- `features/image-thumbnails/createImageThumbnail.ts`：通用浏览器侧缩略图生成。
- `features/infinite-canvas/canvasAssetThumbnails.ts`：无限画布资产保存适配。
- Electron `asset-store.cjs`：本地 CanvasAssests 文件布局与 IPC。

后续资源库复用时建议：
- 复用 `createImageThumbnail` 生成策略。
- 为资源库单独做 `libraryAssetThumbnails` 适配器，不把资源库路径规则塞进无限画布模块。
- 把缩略图视为可再生派生资源，业务实体仍以原图为主资产。
- 如果以后服务端也需要缩略图，服务端实现同样的尺寸/质量/命名规则即可，不要求客户端上传远程画布缩略图。

## 验证清单

- 上传大于 `512px` 长边图片后生成 `CanvasAssests/input/thumb/*.webp`。
- 上传小图或 SVG 时不生成缩略图，UI 回退原图。
- 裁剪图片后生成 `CanvasAssests/output/thumb/*.webp`。
- 图像生成和动作裂变结果生成 `output/thumb/*.webp`。
- 画布节点和结果列表显示缩略图。
- 查看大图、下载、裁剪、API 参考图仍使用原图。
- 缓存清理删除主图时同步删除对应缩略图。
- 导出 JSON/画布包不包含缩略图字段。
