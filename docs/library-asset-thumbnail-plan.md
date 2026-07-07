# 资源库缩略图方案

## 目标

为资源库资产增加统一缩略图机制，覆盖模型库、穿搭库、动作库共用的 `assets` 表。

目标效果：
- 上传/导入资源时，renderer 先生成缩略图并随资产一起提交给服务端保存。
- 列表和选择器优先显示缩略图，找不到缩略图时回退原图。
- 如果缩略图文件被删除，访问缩略图接口时服务端按需重新生成。
- 后续修改缩略图规则后，可以通过删除缩略图目录触发自然重建，不需要迁移数据库。

## 存储位置

缩略图放在 SQLite 数据库目录下的 `thumb` 子目录：

```text
<databaseDir>/
  forart-library.sqlite
  forart-library.sqlite-wal
  forart-library.sqlite-shm
  thumb/
    library-assets/
      <asset_id>.webp
```

不同运行环境对应：

```text
桌面本地库:
<library>/.forart/database/thumb/library-assets/<asset_id>.webp

Docker/服务端:
/database/thumb/library-assets/<asset_id>.webp

开发默认:
server/.forart-data/database/thumb/library-assets/<asset_id>.webp
```

## 命名规则

只保存一份缩略图，使用 `asset_id` 命名：

```text
database/thumb/library-assets/asset_xxxxx.webp
```

理由：
- `assets` 表由模型库、穿搭库、动作库共享，文件名可能重复。
- `asset_id` 全局唯一，移动或重命名原图时缩略图路径不需要变化。
- 删除资产时可以稳定删除对应缩略图。
- 后续修改缩略图规则时，删除整个 `thumb/library-assets` 目录即可触发按需重建。

## 数据模型

第一阶段不修改 `assets` 表结构。

缩略图是可再生派生资源，不作为主数据写入 SQLite。服务端通过 `databaseDir + asset_id` 推导缩略图路径。

如果未来需要记录规则版本、尺寸等信息，再考虑新增派生资源表：

```sql
CREATE TABLE asset_derivatives (
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  rule_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(asset_id, kind),
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
```

当前不加表，避免把可清理缓存做成强数据。

## 缩略图规则

沿用无限画布当前规则：

- 输出格式：`webp`
- 尺寸：原图 50% 分辨率，长边最大 `1280px`
- 原图长边低于 `512px` 时不生成缩略图，接口回退原图
- WebP 质量：`0.78`
- SVG 不生成缩略图，回退原图
- GIF 只取首帧生成缩略图，原图仍保留动图
- 透明 PNG 保留透明通道
- 缩略图去除 EXIF/metadata
- 服务端生成时应用 EXIF orientation

## 两种生成路径

### 1. 上传时 renderer 生成

上传/导入资源时：

1. renderer 读取原图。
2. 复用 `renderer/src/features/image-thumbnails/createImageThumbnail.ts` 生成 WebP data URL。
3. 上传接口在原资源数据外增加可选字段：

```ts
type LibraryAssetUploadPayload = {
  image_data_url: string;
  filename: string;
  thumbnail_data_url?: string;
};
```

4. 服务端保存原图到资源库目录。
5. 服务端拿到新建的 `asset_id` 后，将 `thumbnail_data_url` 保存为：

```text
<databaseDir>/thumb/library-assets/<asset_id>.webp
```

如果 renderer 生成失败、文件太小、SVG 等情况导致没有 `thumbnail_data_url`，上传继续成功，服务端后续按需处理。

### 2. 加载时服务端按需补建

新增缩略图访问接口：

```text
GET /api/assets/:assetId/thumb
```

处理流程：

1. 查询 `assets` 表确认资产存在。
2. 推导缩略图路径 `databaseDir/thumb/library-assets/<assetId>.webp`。
3. 如果缩略图文件存在，直接返回 `image/webp`。
4. 如果缩略图不存在，读取原图并用服务端生成 WebP 缩略图。
5. 生成成功后写入缩略图路径并返回 WebP。
6. 如果服务端无法生成，回退返回原图文件。

回退原图时接受返回原图的 `Content-Type`，例如 `image/png`、`image/jpeg`、`image/gif`、`image/svg+xml`。

## 服务端生成能力

服务端新增图片处理依赖，选用 `sharp`。

职责：
- 从原图按需补建 WebP 缩略图。
- 支持 Docker 环境下缩略图自然重建。
- 删除缩略图目录后，下次访问缩略图接口自动按新规则重建。

注意：
- `sharp` 是 native/预编译二进制依赖，需要验证 Windows 本地 server、Docker 镜像构建和运行。
- 如果 `sharp` 安装或运行失败，缩略图接口必须回退原图，不影响资源库正常使用。

## API 变化

资产返回结构统一增加：

```ts
{
  asset_url: "/api/assets/<assetId>/file",
  thumbnail_url: "/api/assets/<assetId>/thumb"
}
```

适用位置：
- 模型库列表和详情图片
- 穿搭库列表和详情图片
- 动作库列表和详情图片
- 资源选择器弹窗
- 动作裂变选择器内的动作预览

前端显示规则：

```ts
const displayUrl = thumbnail_url || asset_url;
```

但用于下载、查看原图、提交给生成 API 的场景仍使用 `asset_url`。

## 删除与替换

删除资产时：

```text
删除原图
删除 database/thumb/library-assets/<asset_id>.webp
删除 assets 表记录
```

替换资产文件时：
- 删除旧缩略图。
- 如果请求带了新缩略图，保存新缩略图。
- 如果没带，新缩略图由 `/api/assets/:id/thumb` 第一次访问时按需生成。

移动或重命名资源库文件夹时：
- 因为缩略图以 `asset_id` 命名，不需要移动缩略图。

## 并发与失败处理

缩略图接口可能被列表并发触发，需要避免同一资产同时生成多次。

策略：
- 服务端维护进程内 `Map<assetId, Promise>` 做单资产去重。
- 增加全局生成并发限制，限制为 `2`，避免第一次打开大库时大量任务并发占满 CPU。
- 生成时先写入临时文件：

```text
<asset_id>.webp.tmp-<pid>-<random>
```

- 写完后原子 rename 到 `<asset_id>.webp`。
- 生成失败时删除临时文件并回退原图。

失败策略：
- 不向普通列表显示错误。
- 缩略图接口回退原图。
- `sharp` 按需生成失败时只记录服务端日志，方便排查，不向前端返回错误。

## 与无限画布的边界

复用：
- 缩略图尺寸、质量、格式规则。
- renderer 通用生成器 `features/image-thumbnails/createImageThumbnail.ts`。

不复用：
- 无限画布的 `CanvasAssests/input/thumb` 和 `output/thumb` 路径。
- 无限画布的 Electron IPC。

资源库新增自己的服务端 helper：

```text
server/src/library/library-asset-thumbnails.mjs
```

职责：
- 推导缩略图根目录。
- 保存 renderer 上传的缩略图 data URL。
- 判断缩略图是否存在。
- 服务端按需生成缩略图。
- 删除资产缩略图。
- 控制按需生成并发。

## 实施步骤

1. 新增服务端依赖 `sharp`
2. 新增服务端缩略图 helper
   - `libraryThumbnailRoot(runtime)`
   - `libraryAssetThumbPath(runtime, assetId)`
   - `saveUploadedLibraryAssetThumbnail(runtime, assetId, dataUrl)`
   - `deleteLibraryAssetThumbnail(runtime, assetId)`
   - `ensureLibraryAssetThumbnail(runtime, asset)`
3. 新增缩略图接口
   - `GET /api/assets/:assetId/thumb`
   - 存在则返回 WebP
   - 不存在则服务端按需生成
   - 失败则回退原图
4. 上传接口增加 `thumbnail_data_url`
   - 模型库上传
   - 穿搭库上传
   - 动作库上传
   - 动作文件夹批量导入最终入库图片
5. 前端上传前生成缩略图
   - 复用 `createImageThumbnail`
   - 失败时不阻塞上传
6. 列表和选择器改用 `thumbnail_url`
   - 列表卡片
   - 详情预览
   - 资源选择器
   - 动作裂变选择器
7. 删除/替换资产时清理缩略图
   - 所有 `removeAssetIfUnused`
   - 替换文件名/替换图片路径的逻辑
8. 验证
   - 新上传资源立即生成 `database/thumb/library-assets/<asset_id>.webp`
   - 删除缩略图文件后刷新列表，服务端自动重建
   - 删除资源后对应缩略图也删除
   - Docker `/database` 挂载下缩略图能持久化
   - SVG、小图、坏图能回退原图

## 已确认决策

- 允许服务端新增图片处理依赖。
- 服务端图片处理库选用 `sharp`。
- 缩略图规则沿用无限画布规则。
- 每个资源只保存一份缩略图：`database/thumb/library-assets/<asset_id>.webp`。
- 缩略图接口生成失败时统一回退原图，不在前端显示错误。
- 缩略图接口回退原图时接受返回原图 `Content-Type`。
- 第一阶段包含动作文件夹批量导入的最终入库缩略图。
- 服务端按需生成需要做单 `asset_id` 去重，并增加全局并发限制。
- 全局按需生成并发限制先设为 `2`。
- 上传时 renderer 生成缩略图失败，继续上传原图。
- `sharp` 按需生成失败只记录服务端日志，不返回错误给前端。

## 需要确认

当前方案已无必须确认项，可以进入实现。
