# Forart 远程权限与客户端入口控制改造计划

## 1. 目标

建立一套统一的“服务端最终校验、客户端按权限展示”的权限体系，使远程成员只看到自己能够执行的操作，同时保留查看权限下的只读体验。

本计划只针对远程服务器模式的成员权限，不把本机文件系统能力误建模成服务器成员权限。前端隐藏入口只是交互优化，服务端 `401/403` 校验仍然是唯一的安全边界。

## 2. 当前调查结论

### 2.1 服务端已经具备的部分

权限目录位于 `server/src/auth/permission-catalog.mjs`，当前标准权限为：

资源库模块 `model_library`、`outfit_library`、`action_library`：

```text
{module}.view
{module}.project_edit
{module}.project_delete
{module}.project_reorder
{module}.entry_edit
{module}.entry_delete
{module}.tag_manage
```

共享画布：

```text
shared_canvas.view
shared_canvas.project_edit
shared_canvas.project_delete
shared_canvas.project_reorder
shared_canvas.canvas_edit
shared_canvas.canvas_delete
shared_canvas.copy_to_local
```

服务端已有：

- `GET /api/me` 返回用户和权限。
- `GET /api/me/permissions` 返回权限和角色。
- `server/src/auth/request-authorization.mjs` 对资源库、共享画布和资源访问做统一请求级校验。
- 共享画布项目更新接口对项目重命名、排序做了额外的字段级校验。
- 管理后台可以维护成员权限，管理员角色不受普通权限项限制。

### 2.2 当前客户端缺口

Renderer 目前有 Bearer Token 和远程 API 请求封装，但没有统一的权限 Store/Context。各页面仍主要根据本地/远程模式、`readOnly` 或操作结果决定 UI，尚未统一根据服务端返回的权限隐藏入口。

这会产生以下体验问题：

- 无权操作的按钮仍然显示，点击后才收到 `403`。
- 多个页面分别实现权限判断，后续容易出现粒度不一致。
- 权限加载期间可能先显示高风险按钮，再因权限返回而消失。
- 成员权限被后台修改后，旧页面的权限状态可能过期。

### 2.3 各功能是否已经涉及权限

| 功能 | 当前数据/操作通道 | 当前权限情况 | 结论 |
|---|---|---|---|
| 资源库 | 远程走 `/api/model-projects`、`/api/outfit-projects`、`/api/action-projects`；本地走 Electron IPC | 远程已有服务端校验，本地没有成员权限 | 第一阶段接入客户端入口控制 |
| 无限画布“我的画布” | Electron `canvas:*` IPC，本地 JSON/资源目录 | 没有远程成员权限 | 保持本机完整能力 |
| 无限画布“共享画布” | `/api/canvas-exchange/*` | 已有远程服务端校验，客户端只有部分 `readOnly` 判断 | 第一阶段接入统一权限判断 |
| 共享画布资源下载/复制 | 共享画布资产、transfer、package 接口 | 服务端已有 `view`/`copy_to_local` 相关校验 | 需要核对接口语义并隐藏对应入口 |
| 自由画布 | `FreeCanvasEditor`，图片/文字/图层/导出均在 Renderer 和本机 | 没有服务端资源对象，也没有远程 API 权限 | 不接入成员权限；属于本地工作区能力 |
| 缓存清理 | `window.easyTool.scanCanvasCache/deleteCanvasCacheAssets`，Electron IPC | 没有服务端权限 | 不接入成员权限；仅允许本机当前用户操作 |
| 图片审查 | Electron IPC 读取本机目录、写入产品目录下 JSON、调用 PS | 没有服务端资源库权限 | 不接入资源库成员权限；后续若改为服务器目录再单独设计 |
| 生图任务中心 | 全局任务系统和本机 Electron 任务运行链路 | 目前不是服务器资源库权限 | 不在本次资源权限改造中；需要单独定义任务提交/停止权限 |
| API 设置、LibTV、平台配置 | 本地配置和 Electron IPC | 没有远程成员权限 | 保持管理员/本机设置范围，不向普通远程成员开放时应由客户端模式或账户策略控制 |

## 3. 权限边界设计

### 3.1 模式边界

```text
本地模式
  └─ 本机数据和本机工具：默认完整权限，不请求远程成员权限

远程模式
  ├─ 远程资源库：使用对应 library 权限
  ├─ 共享画布：使用 shared_canvas 权限
  └─ 本机工具：仍是本机能力，不由服务器成员权限控制
```

不能因为当前配置是远程模式，就把自由画布、缓存清理、图片审查等本机能力误隐藏；也不能因为某个用户能使用本机缓存，就认为他有权修改服务器资源。

### 3.2 入口展示规则

资源库：

| 权限 | 应显示/允许的入口 |
|---|---|
| `module.view` | 页面入口、项目列表、素材查看、缩略图和原图读取 |
| `module.project_edit` | 新增项目、项目重命名、项目封面、项目编辑；同时覆盖新增和重命名 |
| `module.project_delete` | 删除项目 |
| `module.project_reorder` | 项目拖拽排序、排序保存 |
| `module.entry_edit` | 上传素材、导入素材、素材编辑、素材重命名；同时覆盖新增和编辑 |
| `module.entry_delete` | 删除素材、批量删除素材 |
| `module.tag_manage` | 标签新增、重命名、删除、排序和标签管理 Dialog |

共享画布：

| 权限 | 应显示/允许的入口 |
|---|---|
| `shared_canvas.view` | 共享画布项目/画布列表、打开、拖拽缩放查看 |
| `shared_canvas.project_edit` | 新增项目、项目重命名 |
| `shared_canvas.project_delete` | 删除项目 |
| `shared_canvas.project_reorder` | 项目排序 |
| `shared_canvas.canvas_edit` | 上传画布、重命名画布、保存画布内容 |
| `shared_canvas.canvas_delete` | 删除画布 |
| `shared_canvas.copy_to_local` | 下载/迁移/复制共享画布到我的画布 |

有 `view` 但没有编辑权限时，不隐藏项目和画布内容；共享画布保持 `readOnly`，允许拖拽、缩放和查看大图，但禁止节点修改、上传、保存和删除。

## 4. 推荐文件架构

### 4.1 Renderer 权限模块

新增独立目录：

```text
renderer/src/features/permissions/
├── permissionTypes.ts       # 权限键、角色、加载状态类型
├── permissionCatalog.ts     # 前端使用的 canonical key 和模块映射
├── permissionStore.ts       # Zustand 全局权限状态
├── permissionClient.ts      # /api/me/permissions 加载与刷新
├── permissionSelectors.ts   # hasPermission、hasAny、hasAll 等纯函数
├── PermissionProvider.tsx   # 可选；页面级 hook 注入和模式切换同步
├── PermissionGate.tsx       # 页面/菜单/按钮的声明式隐藏组件
└── index.ts
```

项目已有 Zustand，因此权限状态适合放入独立 Store，不应混入 `appStore`、资源库 Store 或无限画布 Store。权限 Store 不保存业务数据，只保存当前连接的服务器、用户、角色、权限和加载状态。

建议的公共 API：

```ts
type PermissionKey =
  | "model_library.view"
  | "model_library.project_edit"
  | "model_library.project_delete"
  | "model_library.project_reorder"
  | "model_library.entry_edit"
  | "model_library.entry_delete"
  | "model_library.tag_manage"
  | "outfit_library.view"
  | "outfit_library.project_edit"
  | "outfit_library.project_delete"
  | "outfit_library.project_reorder"
  | "outfit_library.entry_edit"
  | "outfit_library.entry_delete"
  | "outfit_library.tag_manage"
  | "action_library.view"
  | "action_library.project_edit"
  | "action_library.project_delete"
  | "action_library.project_reorder"
  | "action_library.entry_edit"
  | "action_library.entry_delete"
  | "action_library.tag_manage"
  | "shared_canvas.view"
  | "shared_canvas.project_edit"
  | "shared_canvas.project_delete"
  | "shared_canvas.project_reorder"
  | "shared_canvas.canvas_edit"
  | "shared_canvas.canvas_delete"
  | "shared_canvas.copy_to_local";

hasPermission(key: PermissionKey): boolean;
```

### 4.2 权限加载时机

1. 本地模式切换时设置 `mode: local`，权限状态标记为 `local-full-access`。
2. 远程登录成功后使用登录响应中的权限初始化 Store；如果登录响应没有完整权限，再调用 `/api/me/permissions`。
3. 应用启动、服务器地址变化、重新登录时重新加载。
4. 收到 `401` 时清理远程权限并回到未登录状态。
5. 收到 `403` 时显示权限提示，并触发一次权限刷新；不要自动重试原始写操作。
6. 切换回本地模式时清理远程用户和权限，避免远程权限污染本地 UI。

### 4.3 API 错误处理

在 `renderer/src/lib/apiClient.ts` 中统一识别：

```text
401 AUTHENTICATION_REQUIRED
403 PERMISSION_DENIED
```

`ApiError` 保留 `required` 权限键，供日志和开发诊断使用，但面向用户只显示统一的本地化权限提示，不直接显示内部权限键。

## 5. 页面接入顺序

### 阶段一：公共导航和资源库

文件范围：

```text
renderer/src/app/appRoutes.tsx
renderer/src/app/WorkspacePage.tsx
renderer/src/features/resource-library/
renderer/src/features/model-library/
renderer/src/features/outfit-library/
renderer/src/features/action-library/
renderer/src/features/library-tags/
renderer/src/features/library-layout/
```

工作项：

- 没有 `view` 时隐藏对应资源库入口，避免请求后才显示错误。
- 新增/重命名/封面/上传统一使用 `project_edit` 或 `entry_edit`。
- 删除菜单、批量删除使用对应 `*_delete`。
- 项目拖拽排序在没有 `project_reorder` 时关闭，并移除拖拽手柄。
- 标签管理 Dialog 在没有 `tag_manage` 时隐藏入口。
- 页面加载权限期间，高风险操作使用隐藏或 Skeleton，避免闪烁。

### 阶段二：无限画布和共享画布

文件范围：

```text
renderer/src/features/infinite-canvas/CanvasWorkspaceHome.tsx
renderer/src/features/infinite-canvas/CanvasWorkspacePage.tsx
renderer/src/features/infinite-canvas/ReactFlowCanvasPage.tsx
renderer/src/features/infinite-canvas/CanvasDocumentTabs.tsx
renderer/src/features/infinite-canvas/CanvasTransferProgressDialog.tsx
electron/main/ipc/canvas-ipc.cjs
electron/main/modules/canvas-package-store.cjs
server/src/canvas-exchange/
server/src/auth/request-authorization.mjs
```

工作项：

- 共享画布入口仅在 `shared_canvas.view` 存在时显示；远程模式但无权时显示无权限状态或隐藏整个切换入口。
- 共享项目顶部新增、重命名、删除、排序分别按 `project_edit`、`project_delete`、`project_reorder` 控制。
- 共享画布上传和保存按 `canvas_edit` 控制。
- 共享画布的编辑器接收 `readOnly`，同时在节点、快捷键、右键菜单、保存按钮和拖拽操作层面统一禁止修改。
- 复制到我的画布、下载远程画布包按 `copy_to_local` 控制。
- 共享画布的查看、缩放、拖拽浏览、大图查看不应被误判为编辑权限。
- 本地“我的画布”的新增、保存、删除、导入导出、节点编辑继续走 Electron IPC，不接入远程成员权限。

注意：`ReactFlowCanvasPage` 当前已有 `readOnly` 参数，但它是行为层保护，不等同于权限系统。应由共享画布容器根据权限计算 `readOnly`，并继续保留 React Flow 的删除键、上下文菜单、保存等保护。

### 阶段三：自由画布、缓存清理和图片审查边界确认

自由画布：

- 当前是 Renderer 状态、本机图片和导出操作，没有服务器画布 ID或远程保存接口。
- 不接入 `shared_canvas.*`，也不为本地文字、图层、上传、清空、导出新增远程成员权限。
- 如果未来把自由画布保存到服务器，应新建独立权限域，例如 `free_canvas.view/edit/delete`，不要复用 `shared_canvas.canvas_edit`。

缓存清理：

- 当前 `CacheSettingsPanel` 通过 `window.easyTool.scanCanvasCache` 和 `deleteCanvasCacheAssets` 使用本机缓存目录。
- 这是设备存储管理能力，不属于服务器资源库权限。
- 远程模式下仍可清理当前电脑的本地缓存；清理逻辑必须继续依据画布引用关系，不能因为远程成员没有资源库删除权限就删除本地缓存入口。
- 如果产品希望普通成员不能清理本机缓存，应新增本机设置能力开关或客户端角色策略，不应伪装成服务器资源权限。

图片审查：

- 当前通过 Electron IPC 读取本机目录、打开 Photoshop、写入产品目录下的 `ImageReview.json`。
- 不接入资源库的 `entry_delete` 或 `entry_edit`，因为图片审查状态不是资源库素材修改。
- 将来若目录由服务器提供，需要单独定义审查权限，例如 `image_review.view` 和 `image_review.status_edit`。

## 6. 服务端需要补强的地方

服务端当前已有统一请求授权，但改造客户端前应完成以下核对：

1. 确认所有资源库 GET 路径都只需要对应 `module.view`。
2. 确认资源下载、缩略图读取不会意外要求编辑或删除权限。
3. 将项目 PATCH 的“名称”和“排序”拆成字段级权限，而不是所有 PATCH 都同时要求编辑和排序。
4. 核对共享画布资产读取、transfer、package 的 `view` 与 `copy_to_local` 语义，避免“查看图片”被错误限制为必须复制权限。
5. 让 `POST /api/canvas-exchange/canvases`、资产上传、complete、取消上传都明确归入 `shared_canvas.canvas_edit`。
6. 保留后端对所有写请求的校验，不因为前端隐藏入口而删除服务端校验。
7. 统一返回 `PERMISSION_DENIED`、`required` 和资源类型信息，便于客户端刷新权限和定位问题。

## 7. 不建议的做法

- 不只在 React 中隐藏按钮而不做后端校验。
- 不把 `readOnly` 当作权限来源；它只能表达当前视图状态。
- 不把所有远程模式功能都绑定到服务器权限。
- 不把管理员权限列表复制到多个页面中维护。
- 不在前端继续使用旧的 `entry_create`、`project_create`、`project_rename` 权限键。
- 不把没有查看权限的资源伪装成空列表；应统一隐藏入口或显示无权限状态。
- 不在权限加载未完成时默认展示删除、上传、保存等高风险按钮。

## 8. 测试计划

### 单元测试

- 权限 Store 在本地模式下返回完整权限。
- 远程权限响应能正确解析角色和权限。
- 管理员不依赖权限列表即可通过检查。
- 旧 alias 不出现在客户端目录，但服务端仍能兼容。
- 权限加载、登出、切换服务器时状态不会残留。

### 页面测试

- 只读成员能查看资源库和共享画布。
- 无 `project_edit` 时新增、重命名、封面入口不存在。
- 无 `project_delete` 时删除入口不存在。
- 无 `project_reorder` 时项目拖拽手柄和排序行为关闭。
- 无 `entry_edit` 时上传和编辑素材入口不存在。
- 无 `entry_delete` 时批量删除和单项删除入口不存在。
- 无 `tag_manage` 时标签管理入口不存在。
- 无 `shared_canvas.canvas_edit` 时共享画布为只读。
- 无 `shared_canvas.copy_to_local` 时复制/迁移入口不存在。
- 权限加载期间高风险入口不会闪现。
- 本地模式下资源库、无限画布、自由画布、缓存清理行为不受远程权限影响。

### 接口测试

- 直接构造没有权限的 POST/PATCH/DELETE 请求仍返回 403。
- 读权限用户读取缩略图和原图成功，但写操作返回 403。
- 权限被后台修改后，客户端刷新权限后入口状态同步。
- 共享画布项目排序、重命名、删除分别命中正确权限。

## 9. 分阶段交付顺序

1. 新增 Renderer 权限模块和远程权限加载。
2. 统一 `apiClient` 的 401/403 处理。
3. 接入资源库导航、项目操作、素材操作、标签管理。
4. 接入共享画布项目、画布、复制和只读状态。
5. 完成服务端路径和字段级权限核对。
6. 补充本地模式回归测试，确认自由画布、缓存清理、图片审查和我的画布不受影响。
7. 最后再评估生图任务中心是否需要独立的远程任务权限，不与资源库权限混用。

## 10. 验收标准

- 后端仍能阻止所有越权请求。
- 远程成员看不到无权操作的入口，且权限加载期间不闪烁。
- 只读用户可以浏览已有资源和共享画布。
- 本地模式的完整功能不受服务器权限影响。
- 自由画布和缓存清理不会被错误地绑定到资源库或共享画布权限。
- 新增权限项只需更新服务端目录、前端类型映射和对应页面声明，不需要在多个页面复制判断逻辑。
