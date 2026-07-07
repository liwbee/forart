# 统一 Sharp 缩略图方案

## 背景

当前项目已经有两套缩略图机制：

- 无限画布：renderer 通过浏览器 Canvas 生成 WebP 缩略图，再交给 Electron main 保存。
- 资源库：renderer 上传时尝试生成缩略图，同时 server/Electron main 可用 `sharp` 按需补建。

这会导致生成规则分散、renderer 额外解码大图、后续规则调整难以统一。本方案将缩略图生成统一收敛到 Electron main/server 侧，renderer 不再负责缩略图编码。

## 目标

- 所有持久化缩略图统一由 `sharp` 生成。
- renderer 只上传或引用原图，不再生成 `thumbDataUrl` / `thumbnail_data_url`。
- 无限画布和资源库共用同一套缩略图规则。
- 缩略图是可再生派生文件，不写入数据库为主数据。
- 缩略图缺失时按需补建，生成失败静默回退原图。
- 后续修改缩略图规则时，可以删除缩略图目录触发自然重建。

## 统一规则

- 输出格式：`webp`
- 缩放：原图 50% 分辨率
- 长边最大：`1280px`
- 原图长边低于 `512px`：不生成缩略图，直接回退原图
- WebP 质量：`0.78`，sharp 参数为 `quality: 78`
- PNG 透明：保留透明通道
- GIF/动图：只取首帧生成缩略图，原图仍保留动图
- SVG：不生成缩略图，回退原图
- EXIF orientation：自动应用
- EXIF/metadata：不写入缩略图
- 生成失败：只记录日志，不向前端抛错
- 并发限制：全局同时生成 2 个
- 同一资源去重：同一 asset/file 同时只生成一次

## 存储规则

### 无限画布

保持现有路径：

```text
CanvasAssests/input/<file>
CanvasAssests/input/thumb/<basename>.webp

CanvasAssests/output/<file>
CanvasAssests/output/thumb/<basename>.webp
```

说明：

- 原图 `abc.png` 对应 `thumb/abc.webp`。
- 删除主图时同步删除 `thumb/<basename>.webp`。
- `thumb` 目录不作为独立主资源展示。

### 资源库

保持当前路径：

```text
<databaseDir>/thumb/library-assets/<asset_id>.webp
```

示例：

```text
<library>/.forart/database/thumb/library-assets/asset_xxxxx.webp
/database/thumb/library-assets/asset_xxxxx.webp
```

说明：

- 资源库缩略图按 `asset_id` 命名。
- 移动/重命名原图不会影响缩略图路径。
- 删除 asset 时同步删除对应缩略图。

## 代码架构

### 1. 新增共享 sharp 核心

新增：

```text
server/src/shared/image-thumbnail-sharp.mjs
```

职责：

- 暴露统一常量。
- 判断 SVG、小图等跳过条件。
- 读取图片 metadata。
- `sharp(sourcePath, { animated: false }).rotate()`。
- 计算目标尺寸。
- 输出 WebP。
- 写临时文件后 rename。
- 捕获错误并返回 `null`。

建议接口：

```js
export const IMAGE_THUMBNAIL_RULES = {
  scale: 0.5,
  maxLongEdge: 1280,
  minLongEdge: 512,
  webpQuality: 78,
};

export async function generateSharpImageThumbnail({
  sourcePath,
  targetPath,
  mimeType,
  logger,
}) {
  // returns { filePath, mimeType: "image/webp" } | null
}
```

### 2. 新增共享并发/去重 helper

新增或放入同一模块：

```text
server/src/shared/thumbnail-generation-queue.mjs
```

职责：

- 全局并发限制 2。
- 同一个 key 去重。
- 生成完成后释放 key。

当前资源库已有手写版本：

```text
server/src/library/library-asset-thumbnails.mjs
```

可以先抽出来复用，也可以暂时复制到 canvas 侧后续再收敛。更推荐抽出来，避免两套队列。

### 3. 资源库缩略图模块改造

修改：

```text
server/src/library/library-asset-thumbnails.mjs
```

保留职责：

- 推导资源库缩略图路径。
- 删除资源库缩略图。
- `ensureLibraryAssetThumbnail(runtime, asset, sourcePath)`。
- 资源库按 `asset_id` 去重。

移除职责：

- 保存 renderer 上传的 `thumbnail_data_url`。
- 内部直接写 sharp 生成逻辑。

改为：

- 调用共享 sharp 核心生成。
- 访问 `/api/assets/:assetId/thumb` 时缺失则按需生成。

### 4. 资源库上传路径改造

修改 renderer：

```text
renderer/src/features/resource-library/createLibraryAssetUploadPayload.ts
renderer/src/features/model-library/ModelLibraryPage.tsx
renderer/src/features/outfit-library/OutfitLibraryPage.tsx
renderer/src/features/action-library/ActionLibraryPage.tsx
renderer/src/features/action-library/ActionFolderImportDialog.tsx
```

改动：

- `createLibraryAssetUploadPayload` 只读取原图 base64。
- 删除 `createImageThumbnail` 调用。
- 删除 `thumbnail_data_url` 字段。
- 动作文件夹批量导入不再基于预览图生成 thumbnail data URL。

修改 server/Electron local service：

```text
server/src/library/model-library-service.mjs
server/src/library/outfit-library-service.mjs
server/src/library/action-library-service.mjs
server/src/library/action-folder-import-service.mjs
server/forart-server.mjs
```

改动：

- 写入 asset 后调用 `ensureLibraryAssetThumbnail(...)` 或 fire-and-forget 生成缩略图。
- 不再接收和保存 `thumbnail_data_url`。
- 缩略图生成失败不影响上传成功。

### 5. 无限画布保存路径改造

修改：

```text
electron/main/modules/asset-store.cjs
```

改动：

- `saveAsset(payload)` 保存原图后用 sharp 生成缩略图。
- `saveAssetThumbnail(payload)` 改成从原图路径生成缩略图，不再保存 `thumbDataUrl`。
- 新增 `ensureAssetThumbnail(payload)`，用于旧图补建。
- 生成失败返回 `{}`，前端继续回退原图。

建议返回结构继续保持兼容：

```js
{
  url,
  thumbUrl,
  fileName,
  filePath,
  thumbFilePath,
}
```

### 6. 无限画布 renderer 改造

修改：

```text
renderer/src/features/infinite-canvas/useCanvasMediaActions.ts
renderer/src/features/infinite-canvas/canvasAssetThumbnails.ts
renderer/src/features/infinite-canvas/generation/generationTaskWriteback.ts
renderer/src/features/infinite-canvas/generation/useActionFissionGenerationActions.ts
renderer/src/features/infinite-canvas/libtv-generation/useLibtvGenerationActions.ts
```

改动：

- 删除 `createImageThumbnail` 调用。
- 不再传 `thumbDataUrl`。
- 调用 `saveCanvasAsset` 后使用 main 返回的 `thumbUrl/thumbFilePath`。
- 对已保存的 `localUrl` 调用 `saveCanvasAssetThumbnail` 时，main 自己从原图生成。

保留：

- 图片节点继续显示 `node.thumbUrl || node.url`。
- 动作裂变结果继续显示 `row.resultThumbUrl || row.resultUrl`。
- 查看原图仍使用原始 URL。

### 7. 旧画布按需补建

需要覆盖三种旧数据：

- `thumbUrl` 存在且文件存在：继续使用。
- `thumbUrl` 存在但文件缺失：按需补建。
- `thumbUrl` 缺失：按需补建并写回节点。

推荐新增 IPC：

```text
canvas:ensure-asset-thumbnail
```

renderer 使用场景：

- 打开画布后扫描 image-like nodes。
- 对本地 `forart-asset://canvas/...` 原图调用 ensure。
- 成功后更新节点 `thumbUrl/thumbFilePath`。
- 后续保存画布时自然持久化。

注意：

- 不对远程 URL 自动补建，除非先保存为本地资产。
- 不对 SVG 和小图生成缩略图。
- 补建应批量但受 main 侧并发限制控制。

### 8. 协议层兜底

当前 `forart-asset://canvas/...` 协议只负责解析已有文件。

可选增强：

- 当请求的是 `thumb` 路径且文件不存在时，尝试从同目录主图补建。
- 该增强只能解决“已有 thumbUrl 但文件丢失”的情况。
- 对“节点没有 thumbUrl”的情况，仍需要 IPC ensure 写回。

建议优先做 IPC ensure，协议层兜底作为后续增强。

### 9. 缓存清理保持同步

现有：

```text
electron/main/modules/canvas-cache-store.cjs
```

已有能力：

- 枚举时排除 `thumb` 目录。
- 统计主图时计入 thumb size。
- 删除主图时同步删除对应 thumb。

需要复查：

- sharp 生成路径必须和 `thumbPathForAsset(filePath)` 保持一致。
- 清理缓存时不展示孤立缩略图。

## 迁移后的数据流

### 资源库上传

```text
renderer 读取原图 -> API 上传原图
server/Electron local 保存 asset
server/Electron local 用 sharp 生成 database/thumb/library-assets/<asset_id>.webp
前端列表使用 thumbnail_url
缺失时 /api/assets/:assetId/thumb 或 library-thumb 协议按需补建
```

### 无限画布上传/保存

```text
renderer 提交原图 URL/dataUrl
Electron main 保存原图到 input/output
Electron main 用 sharp 生成 input/thumb 或 output/thumb
renderer 写入 thumbUrl/thumbFilePath
节点显示 thumbUrl || url
查看原图使用 url
```

### 旧画布补建

```text
renderer 打开画布
扫描本地图片节点
调用 canvas:ensure-asset-thumbnail
Electron main 发现 thumb 不存在则用 sharp 生成
renderer 写回节点 thumbUrl/thumbFilePath
```

## 删除或弱化的旧路径

以下路径不再作为资源库/无限画布缩略图生成入口：

```text
renderer/src/features/image-thumbnails/createImageThumbnail.ts
renderer/src/features/resource-library/createLibraryAssetUploadPayload.ts 中的 createImageThumbnail 调用
```

处理结果：

- 删除 `createImageThumbnail.ts`，后续如果确实需要纯前端临时预览再重新设计。
- `canvasAssetThumbnails.ts` 保留为薄适配层，只调用 IPC ensure。

## 风险

- `sharp` 是 native 依赖，Electron 打包后必须持续验证。
- 从 renderer 迁移到 main 后，上传后缩略图生成变成异步或 main 同步等待，需要控制 UI 体验。
- 旧画布补建可能在第一次打开时触发较多任务，必须依赖并发限制。
- 资源库本地 Electron 和 Docker/server 都要走同一规则，但运行环境不同，需要分别验证。
- 如果上传后等待 sharp 生成，超大图片会稍微增加保存耗时；如果 fire-and-forget，列表首次显示可能短暂回退原图。

## 实施步骤

1. 抽共享 sharp 生成核心。
2. 抽共享生成队列或复用资源库现有队列。
3. 改资源库模块，移除 `thumbnail_data_url` 保存路径。
4. 改资源库 renderer，上传不再生成缩略图。
5. 改无限画布 `asset-store.cjs`，保存原图后生成缩略图。
6. 改无限画布 renderer，移除 `thumbDataUrl` 生成和传输。
7. 新增 `canvas:ensure-asset-thumbnail` IPC。
8. 打开旧画布时按需补建本地图片节点缩略图。
9. 复查缓存清理逻辑。
10. 跑验证和打包。

## 验证清单

- `npm run validate:i18n`
- `npm run build`
- `npm run package:dir`
- 上传无限画布 input 图片，生成 `CanvasAssests/input/thumb/*.webp`
- 图像生成 output 图片，生成 `CanvasAssests/output/thumb/*.webp`
- 裁剪图片后生成 `output/thumb/*.webp`
- 动作裂变结果生成 `resultThumbUrl`
- 删除 canvas 主图时同步删除 thumb
- 删除 thumb 文件后打开旧画布，能按需补建并写回节点
- 资源库上传模型/穿搭/动作图片后生成 `database/thumb/library-assets/*.webp`
- 资源库删除 asset 后同步删除 thumb
- 资源库缩略图文件删除后访问缩略图 URL 能自动重建
- 小图、SVG 回退原图
- GIF 缩略图只取首帧
- 透明 PNG 缩略图保留透明
- Docker 镜像构建成功
- Docker server 中 `/api/assets/:assetId/thumb` 可用

## 需要确认的问题

1. 上传/保存时是否等待 `sharp` 生成完成？
   - 方案 A：等待生成完成后返回 `thumbUrl`。UI 一次到位，但保存大图会稍慢。
   - 方案 B：保存原图立即返回，后台生成缩略图。保存更快，但首次显示可能短暂回退原图，需要后续刷新/补写。

2. 打开旧画布时是否自动扫描并补建所有本地图片节点缩略图？
   - 方案 A：自动补建当前画布所有本地图片节点，受并发限制。
   - 方案 B：只在图片节点进入视口或缩略图加载失败时补建。

3. `createImageThumbnail.ts` 是否保留？
   - 不保留，本次实现直接删除，避免形成第三套缩略图规则。

4. 资源库上传后是否也立即生成缩略图？
   - 建议立即生成，失败静默；如果跳过即时生成，则首次访问缩略图 URL 时再生成。

5. 是否本次顺手引入 `p-limit`？
   - 建议可以引入，用于替换手写并发队列。
   - `lru-cache` 暂时不建议引入，当前没有明显收益。
