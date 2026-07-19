# 全局图像生成任务系统改造计划

## 1. 背景

Forart 当前已经具备全局任务系统的部分基础：

- Electron 主进程分别创建 API 与 LibTV 的全局内存 Task Store。
- API 与 LibTV Runner 在主进程中执行，画布卸载后主进程任务可以继续运行。
- 画布 JSON 保存本地任务 ID、远端任务 ID和 LibTV 远端锚点，用于软件重启后的恢复。
- Runner 在任务结束时直接将最终结果一次性写回画布，避免普通画布保存协调运行时任务。
- Renderer 通过轮询主进程任务，将完整任务对象、状态、错误等复制到 React Flow 节点数据中。

当前职责仍然分散：

- API 使用 `generation-task-store.cjs`，LibTV 使用 `libtv-generation-task-store.cjs`，状态模型不同。
- 节点和动作裂变行同时保存任务 ID、远端锚点、完整任务对象、错误与队列布尔值。
- Renderer 的轮询 Hook 既负责发起任务，也负责恢复、同步状态和写回节点。
- 主进程重启后内存 Task Store 丢失，只能扫描所有画布 JSON 重建任务。
- 同一种状态在主进程 Task Store、Renderer 节点状态和画布 JSON 中存在多个副本。
- API 与 LibTV 的错误字段、恢复字段和终态处理存在重复逻辑。

本计划将图像生成改造成持久化的主进程全局任务系统，使画布只保存必要的内部任务指针和正式结果内容。

## 实施状态

### 2026-07-18：第一批基础持久化已完成

已完成：

- 新增 `generation-tasks.sqlite` 和统一 `GenerationTaskRepository`。
- API 与 LibTV Task Store 保持原公开接口，通过同一个 Repository 持久化。
- 主进程启动时从数据库恢复两个 Store 的任务记录。
- 主进程退出时关闭 Repository。
- 数据库使用 WAL、`synchronous = NORMAL`、busy timeout 和 foreign key。
- 新增 `generation_tasks`、`generation_target_heads` 和 `generation_meta` 基础表。
- 同目标创建新 API 任务时，旧任务 supersede 状态同步持久化。
- 修复持久活跃任务重启后“Store 中存在但无内存 Controller”时不继续恢复的问题。
- API 有远端任务 ID时重新挂接轮询，不重新提交生成。
- LibTV 有 project UUID 和 remote node ID时重新挂接查询，不重新创建远端节点。
- 没有可恢复远端锚点的持久任务明确进入 interrupted，避免重复生成。
- 新增 SQLite 关闭重开、API/LibTV 共库、Target Head 和持久恢复回归测试。

当前仍属于兼容阶段：

- `payload_json` 暂时保存现有两类 Task 对象，用于不改变 Runner/Renderer 接口地承接持久化；统一 DTO 完成后删除。
- Renderer 仍使用现有轮询 Hook，尚未切换到全局 IPC 事件和 Zustand Task Cache。
- 画布仍保存旧任务锚点和错误字段，尚未收敛为 `latestGenerationTaskId`。
- 结果仍沿用现有 Runner 一次性写回，尚未切换到独立 ResultCommitter。
- 自动清理和终态任务精简尚未启用。
- 画布工作区仍保留旧恢复入口，后续 Renderer 迁移到全局 Task Cache 时删除。

### 2026-07-18：第二批统一任务服务与启动恢复已完成

已完成：

- 新增统一状态、目标、Executor 常量和 `GenerationTaskDto` 规范化模块。
- 新增 `GenerationTaskService`，集中提供跨 API/LibTV 的查询、启动、停止、恢复和任务变更订阅入口。
- 现有两个 Task Store 通过 Service Store Adapter 提供给 Runner，Runner 不再直接持有主进程公开 Store。
- API 与 LibTV Runner 注册为两个独立 Executor，平台请求和 LibTV CLI/队列实现仍保持分离。
- 同一目标的新任务 supersede 旧任务时，统一事件流会同时发布旧任务终态与新任务。
- Repository 新增按画布和 Executor 读取带 `version` 任务记录的能力。
- 应用主进程启动时直接从 SQLite 恢复活跃任务，不再依赖先进入无限画布页面扫描画布锚点。
- API 有远端任务 ID 时继续轮询；没有安全远端锚点或平台已移除时进入 interrupted。
- LibTV 有远端节点锚点时继续查询；尚未发送到远端的 queued 任务按原节点并发池重新入队。
- 新增统一 DTO、跨 Executor 查询/事件、停止路由、恢复合并和主进程启动恢复测试。

仍处于兼容阶段：

- Runner 目前以 Service Adapter 作为统一写入入口，但具体执行代码尚未从旧 Runner 文件物理迁移到独立 Executor 文件。
- Renderer 尚未订阅统一任务事件，仍使用旧 API/LibTV IPC 和节点级轮询。
- `payload_json` 仍保存过渡任务对象；结构化任务列和私有 `executor_state_json` 尚未完成。
- 画布仍保存旧运行时锚点；`latestGenerationTaskId`、ResultCommitter 和旧字段迁移尚未开始。

### 2026-07-18：第三批任务事件与 Renderer Cache 已完成

已完成：

- 新增统一任务 IPC，支持按 ID、批量 ID、画布查询公开 DTO，以及按内部任务 ID 停止任务。
- 主进程通过 `generation-task:changed` 发布完整公开 DTO，不向 Renderer 暴露数据库和 Executor 私有状态。
- Preload 新增类型化的 `forartGenerationTasks` 接口。
- 新增 Zustand `GenerationTaskCache`，按任务 ID 保存 DTO，并按单调递增 `version` 忽略迟到事件。
- Renderer 初始化顺序调整为先订阅事件，再按当前画布获取任务快照，避免订阅与快照之间的竞态。
- 普通 API 图像生成、普通 LibTV 图像生成和动作裂变每行任务均改为等待缓存事件，不再每秒轮询主进程。
- 删除工作区加载时重复扫描所有画布触发恢复的入口；主进程启动恢复成为默认路径。
- 旧画布仅有历史远端锚点且数据库无记录时，Hook 仍执行一次兼容恢复，随后进入统一事件流。
- 新增 IPC 事件、Cache 版本去重、终态事件等待和“生成 Hook 不含一秒轮询”回归测试。

当前仍属于过渡阶段：

- Hook 已从 Task Cache 接收状态，但为了兼容现有节点 UI，暂时仍把任务 DTO 转换为旧任务对象并 patch 到节点数据。
- 下一批需要引入按 `taskId` 的节点 selector，随后删除完整任务对象、运行时错误和远端锚点的节点副本。
- 画布字段收敛、幂等 ResultCommitter、结构化 Repository 列和自动清理尚未开始。

### 2026-07-18：第四批画布字段收敛与结果提交器已完成

已完成：

- 图像生成节点和动作裂变行统一只写入 `latestGenerationTaskId`，不再把任务对象、状态、错误或远端锚点复制到 React Flow 节点数据。
- 节点 UI、参数面板和动作裂变行直接按内部任务 ID 从 Zustand Task Cache 派生状态、错误、时间和结果处理进度。
- 动作裂变使用批量浅比较 selector，避免每一行分别建立 Zustand 订阅。
- 启动前校验错误保存在 Renderer 运行时 Store，不写入画布 JSON。
- API、LibTV 和动作裂变生成 Hook 的新任务路径只写任务指针；终态事件只提交正式图片结果。
- CanvasStore 在写入新任务指针时清理旧任务对象、旧任务 ID、远端锚点和错误字段。
- 新增幂等 ResultCommitter 和 SQLite 提交状态；重复终态事件只提交一次。
- ResultCommitter 会拒绝旧任务的迟到结果并标记为 `discarded`，画布缺失或写入失败时回到 `pending` 等待后续恢复。
- API 与 LibTV 都要求画布任务指针成功落盘后才开始远端执行，避免产生无法关联的任务。
- 普通画布保存不协调任务状态；任务指针只影响持久化签名，不把画布内容标记为已编辑。
- 复制节点、Alt 拖拽复制、粘贴、画布包、导出和共享上传均清除任务指针及全部旧运行时字段，同时保留正式图片结果。
- 新增终态幂等、陈旧结果丢弃、失败提交回退、快照语义和画布包清理回归测试。

当前保留的兼容边界：

- 旧画布任务对象和远端锚点仍只读一版，用于数据库中没有对应记录时的一次性迁移恢复。
- 快照、复制、导出和资源收集仍识别旧字段，确保迁移期画布不会丢资源且新写入不会重新产生旧字段。
- `result_commit_state = pending/committing` 的启动补交、历史任务精简和自动清理属于第五批。
- 旧内存 Store 外壳、旧恢复扫描器和兼容 DTO 将在第五批恢复稳定后于第六批删除。

### 2026-07-18：第五批启动补交与自动清理已完成

已完成：

- 软件启动时先把进程退出遗留的 `result_commit_state = committing` 恢复为 `pending`，再补交所有未提交终态结果。
- 补交成功后标记 `committed`；任务已被同目标新任务替换时标记 `discarded`；画布写入异常时继续保留 `pending`。
- 结果补交、API 活跃任务恢复、LibTV 活跃任务恢复和任务清理分别容错，单个步骤失败不会阻止后续维护或窗口创建。
- 当前 Target Head 的终态任务会精简为任务 ID、目标、Executor、状态、错误和时间摘要，删除输入快照、远端锚点及重复结果详情。
- 非 Head 历史任务按状态保留：成功 7 天、失败 14 天、中断/替换 7 天、取消 3 天、无远端提交的中断任务 1 天。
- 活跃任务、`result_processing`、待提交结果和当前 Target Head 永远不会被常规历史清理删除。
- 清理前检查画布、节点和动作裂变行是否仍存在；孤儿 Head 被移除，终态提交标记为 `discarded`，并从确认孤儿起保留 1 天。
- 目标存在性扫描按画布分组读取 JSON，避免动作裂变行较多时重复解析同一画布。
- SQLite 清理完成后同步移除 API 与 LibTV 内存 Store 中的终态记录，避免数据库与内存查询结果不一致。
- 清理后执行被动 WAL checkpoint 和小批量 incremental vacuum，不执行高频完整 `VACUUM`，也不删除任何图片资源。
- 自动维护在启动恢复后、每 12 小时或用户清理画布缓存后触发。
- 用户清理图片缓存后会额外触发一次任务历史维护；任务元数据清理失败不会影响已完成的图片缓存操作。
- 新增 pending/committing 补交、陈旧结果丢弃、Head 精简、历史保留、孤儿 Head、自动触发和内存同步回归测试。

第六批仍需处理：

- 删除旧 API/LibTV 内存 Store 外壳，将统一 Repository/Service 直接作为唯一任务读写入口。
- 删除 CanvasStore 旧任务锚点扫描器和 Renderer 一次性旧字段恢复代码。
- 删除旧 IPC、旧 DTO 兼容字段和发布周期结束后的旧画布运行时字段读取。
- 完成迁移后的最终全量回归与打包验证。

## 2. 核心架构决策

### 2.1 双事实源边界

系统使用两个边界清晰的事实源：

- **全局任务数据库是任务执行事实源**：保存队列、运行状态、错误、远端锚点、恢复信息、时间与结果处理状态。
- **画布 JSON 是画布文档事实源**：保存节点配置、最新任务 ID、最终结果图和下载状态。

任务数据库不能成为画布最终结果的唯一来源。任务历史被清理、数据库丢失、画布导出或上传共享画布时，已经生成的画布仍必须完整可用。

### 2.2 画布只引用内部任务 ID

图像生成节点保存：

```ts
interface ImageGeneratorTaskBinding {
  latestGenerationTaskId?: string;
}
```

动作裂变的每一行分别保存：

```ts
interface ActionFissionRowTaskBinding {
  latestGenerationTaskId?: string;
}
```

`latestGenerationTaskId` 由 Forart 自己生成，是画布与全局任务系统之间唯一稳定的任务查询键。

画布不再保存：

```text
generationTask
generationRemoteTaskId
generationError
libtvTask
libtvTaskId
libtvQueued
libtvRunning
libtvProjectUuid
libtvRemoteNodeId
任务错误字段
任务状态消息
```

### 2.3 全局任务仍记录目标定位

任务记录必须保留目标信息：

```ts
interface GenerationTaskTarget {
  canvasId: string;
  kind: "imageGenerator" | "actionFissionRow";
  nodeId: string;
  rowId?: string;
}
```

这些字段用于：

- 任务结束后定位并提交画布结果。
- 检查任务是否仍是目标的最新任务。
- 按画布、节点或动作行停止任务。
- 删除画布或节点时处理关联任务。
- 保持动作裂变的节点级并发限制。
- 软件重启后无需扫描所有画布才能知道任务归属。

任务结构中不再同时保存顶层 `nodeId` 和 `target.nodeId`，目标信息只保留一份。

### 2.4 API 与 LibTV 共享任务协议但保持执行链路独立

统一系统结构：

```text
GenerationTaskService
├── ApiGenerationExecutor
└── LibtvGenerationExecutor
```

共享内容：

- 内部任务 ID。
- 任务状态机。
- SQLite Repository。
- 目标定位。
- IPC 状态事件。
- 结果提交协议。
- 清理与恢复入口。

独立内容：

- 请求和 CLI 调用。
- 远端任务创建及轮询。
- 远端错误解析。
- 取消能力。
- 并发控制细节。
- LibTV 工作区、项目和远端节点处理。

LibTV 不并入第三方 API 请求实现，只实现统一 Executor 接口，以便未来单独剥离。

## 3. 目标

- 所有画布、所有节点和动作裂变行共享一个主进程任务系统。
- 任务跨画布切换和 Renderer 卸载继续执行。
- 软件重启后从任务数据库恢复，不依赖完整扫描画布锚点作为主要恢复方式。
- Renderer 不再为每个节点运行独立轮询循环。
- 任务状态、错误与进度不再写进画布 JSON。
- API 和 LibTV 使用统一状态码与内部任务 ID。
- 最终结果只由主进程幂等提交一次。
- 旧任务不能覆盖新任务结果。
- 支持自动清理旧任务，不影响最终画布内容和未完成任务恢复。
- 不将 API Key、图片二进制或 Base64 写入任务数据库。
- 保持现有 API、LibTV、动作裂变并发、停止和重新运行行为。

## 4. 非目标

- 本次不统一 API 与 LibTV 的具体请求协议。
- 本次不把图片文件保存进 SQLite。
- 本次不实现跨设备共享任务队列。
- 本次不让远程共享画布依赖本地任务数据库。
- 本次不提供完整任务历史管理页面。
- 本次不改变资源库和画布资源文件的存储结构。
- 本次不让 Renderer 直接访问 SQLite。
- 本次不要求 Docker/server 使用本地桌面任务数据库。

## 5. 总体数据流

```text
用户点击运行
  -> Renderer 提交任务请求
  -> GenerationTaskService 创建内部 taskId
  -> SQLite 事务写入任务与目标最新指针
  -> CanvasStore 写入 latestGenerationTaskId
  -> 目标指针写入成功后进入调度队列
  -> 对应 Executor 调用 API 或 LibTV
  -> TaskService 更新状态并向 Renderer 推送事件
  -> Executor 获得远端结果
  -> AssetStore 下载原图并生成缩略图
  -> TaskService 进入 succeeded + commit_pending
  -> GenerationResultCommitter 检查画布最新 taskId
  -> 匹配则一次性写入最终画布结果
  -> 标记 result_committed
```

Renderer 打开画布时：

```text
读取节点 latestGenerationTaskId
  -> 批量查询全局任务快照
  -> 写入 Renderer 全局 Zustand Task Cache
  -> 订阅主进程任务事件
  -> 节点通过 taskId selector 读取状态
```

## 6. SQLite 存储设计

### 6.1 文件位置

建议路径：

```text
<portableRootDir>/CanvasAssests/tasks/generation-tasks.sqlite
```

开发环境跟随现有 `portableRootDir`；免安装版本跟随 exe 所在数据根目录；设置 `FORART_DATA_ROOT` 时跟随该目录。

启用 WAL 后，程序运行期间可能出现：

```text
CanvasAssests/tasks/generation-tasks.sqlite-wal
CanvasAssests/tasks/generation-tasks.sqlite-shm
```

它们是 SQLite 的临时 sidecar 文件，逻辑上仍属于同一个任务数据库。

### 6.2 数据库配置

初始化时执行：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
```

规则：

- Electron 主进程只创建一个 Repository 写实例。
- Executor 和 CLI 子进程不直接打开数据库。
- 网络请求、轮询、图片下载和缩略图生成不得位于数据库事务中。
- Prepared Statement 在 Repository 初始化时创建并复用。
- UI 状态事件可以立即发出，非关键高频消息允许合并持久化。

### 6.3 `generation_tasks` 表

建议核心字段：

```sql
CREATE TABLE generation_tasks (
  id TEXT PRIMARY KEY,

  canvas_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  node_id TEXT NOT NULL,
  row_id TEXT,

  executor_kind TEXT NOT NULL,
  provider_id TEXT,
  model TEXT,

  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  interrupt_reason TEXT,

  input_json TEXT,
  executor_state_json TEXT,

  remote_task_id TEXT,
  message_code TEXT,
  message_params_json TEXT,
  remote_message TEXT,
  error_code TEXT,
  error_message TEXT,

  result_json TEXT,
  result_commit_state TEXT NOT NULL DEFAULT 'none',
  result_committed_at INTEGER,

  created_at INTEGER NOT NULL,
  started_at INTEGER,
  running_at INTEGER,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER
);
```

约束：

- `target_kind` 只允许 `imageGenerator`、`actionFissionRow`。
- `actionFissionRow` 必须有 `row_id`。
- `imageGenerator` 的 `row_id` 必须为空。
- `executor_kind` 首期只允许 `api`、`libtv`。
- `status` 必须来自统一状态机。
- `version` 每次更新递增，Renderer 忽略旧版本事件。

建议索引：

```sql
CREATE INDEX idx_generation_tasks_canvas
ON generation_tasks(canvas_id, updated_at DESC);

CREATE INDEX idx_generation_tasks_target
ON generation_tasks(canvas_id, node_id, target_kind, row_id, updated_at DESC);

CREATE INDEX idx_generation_tasks_status
ON generation_tasks(status, updated_at);

CREATE INDEX idx_generation_tasks_commit
ON generation_tasks(result_commit_state, updated_at);
```

### 6.4 `generation_target_heads` 表

该表记录每个生成目标在任务系统中的最新任务：

```sql
CREATE TABLE generation_target_heads (
  target_key TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  node_id TEXT NOT NULL,
  row_id TEXT,
  latest_task_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (latest_task_id)
    REFERENCES generation_tasks(id)
    ON DELETE CASCADE
);
```

`target_key` 统一生成：

```text
canvas:<canvasId>/node:<nodeId>
canvas:<canvasId>/node:<nodeId>/row:<rowId>
```

用途：

- 创建新任务时原子替换最新任务。
- 快速判断旧任务是否已被替代。
- 清理时保护每个目标的最新任务。
- 无需扫描所有画布判断任务是否为历史任务。

画布 JSON 的 `latestGenerationTaskId` 仍是结果提交时的最终校验依据；数据库 Head 是任务系统索引，二者通过恢复流程处理异常中断导致的不一致。

### 6.5 `generation_meta` 表

```sql
CREATE TABLE generation_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

首期保存：

```text
schema_version
last_cleanup_at
```

## 7. 统一任务模型

Renderer 与主进程共享的任务 DTO：

```ts
type GenerationTaskStatus =
  | "queued"
  | "preparing"
  | "submitting"
  | "running"
  | "result_processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted"
  | "superseded";

interface GenerationTaskDto {
  id: string;
  target: {
    canvasId: string;
    kind: "imageGenerator" | "actionFissionRow";
    nodeId: string;
    rowId?: string;
  };
  executorKind: "api" | "libtv";
  providerId?: string;
  model?: string;
  status: GenerationTaskStatus;
  version: number;
  messageCode?: string;
  messageParams?: Record<string, string | number>;
  remoteMessage?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt: number;
  runningAt?: number;
  updatedAt: number;
  completedAt?: number;
  durationMs?: number;
  result?: {
    images: Array<{
      assetUrl: string;
      thumbUrl?: string;
      fileName?: string;
      width?: number;
      height?: number;
    }>;
  };
}
```

### 7.1 输入快照

`input_json` 保存任务实际提交时的输入快照：

```ts
interface GenerationTaskInput {
  prompt: string;
  referenceImages: string[];
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  imageCount: number;
  modelRuleId?: string;
}
```

要求：

- 不保存 API Key、Authorization Header 或登录 Cookie。
- 参考图优先保存稳定的本地资源 URL/ID，而不是临时 object URL。
- 输入快照创建后不可变，重新运行创建新任务。
- 清理时可以从历史任务中移除输入快照。

### 7.2 Executor 私有状态

平台专用状态放入 `executor_state_json`，按 Executor 自己的版本解析：

API 示例：

```json
{
  "schemaVersion": 1,
  "protocol": "openai-image",
  "pollUrl": "..."
}
```

LibTV 示例：

```json
{
  "schemaVersion": 1,
  "workspaceId": "...",
  "workspaceName": "...",
  "projectUuid": "...",
  "remoteNodeId": "...",
  "remoteReferenceNodeIds": []
}
```

Renderer 和画布不读取该字段。

## 8. 状态机

### 8.1 正常状态流

```text
queued
  -> preparing
  -> submitting
  -> running
  -> result_processing
  -> succeeded
```

允许的终态：

```text
failed
canceled
interrupted
superseded
```

### 8.2 状态约束

- 只有 TaskService 能修改任务状态。
- Executor 通过 TaskService 回调报告状态，不直接写 Repository。
- 终态任务不能回到活跃状态；重试必须创建新任务 ID。
- 同一目标创建新任务时，旧活跃任务转为 `superseded` 并尝试取消。
- `result_processing` 表示已获得远端结果，正在下载、保存原图或生成缩略图。
- 本地结果处理失败时保留远端锚点和结果 URL，重新运行本地结果处理，不重新发起生成。
- `recovering` 不作为长期持久化状态；恢复过程中继续使用原活跃状态，并通过 `messageCode` 表达恢复动作。

### 8.3 消息与错误

- Forart 自己产生的状态使用 `messageCode + messageParams`，Renderer 通过 i18n 翻译。
- 远端返回的生成反馈保存在 `remoteMessage`，按原文显示并添加本地状态前缀。
- 本地可分类错误使用 `errorCode + errorMessage`。
- 远端原始错误不翻译，但可以保留平台和请求上下文。
- 错误不再写入节点 `generationError` 或动作行 `error`。

## 9. 主进程模块规划

避免继续扩大现有 Runner 文件，新增一个聚合度适中的目录：

```text
electron/main/modules/generation/
  generation-task-types.cjs
  generation-task-repository.cjs
  generation-task-service.cjs
  generation-result-committer.cjs
  generation-task-cleanup.cjs
  api-generation-executor.cjs
  libtv-generation-executor.cjs
```

### 9.1 `generation-task-types.cjs`

职责：

- 状态、目标种类和 Executor 常量。
- ID 和 target key 生成。
- 输入、任务和 DTO 规范化。
- 状态转换校验。
- 终态/活跃状态判断。

### 9.2 `generation-task-repository.cjs`

职责：

- 创建并迁移 `generation-tasks.sqlite`。
- Repository 单写入实例。
- Prepared Statement 和短事务。
- 创建任务、更新状态、批量读取、按画布读取。
- 原子写入任务与 `generation_target_heads`。
- 查询待恢复、待提交和待清理任务。
- 不包含网络、调度、CanvasStore 或 IPC 逻辑。

### 9.3 `generation-task-service.cjs`

职责：

- 全局任务生命周期入口。
- 创建单任务和批量任务。
- 在目标指针持久化成功后调度 Executor。
- 管理内存 Controller、队列和节点级并发。
- 统一状态转换和 Repository 写入。
- 发布任务事件。
- 停止任务、目标、节点和画布任务。
- 软件启动时恢复任务。
- 调用结果提交器和清理器。

首期可以把 Scheduler 保留在 Service 内部；只有当调度规则继续增长时再提取独立模块，避免过度拆分。

### 9.4 `generation-result-committer.cjs`

职责：

- 处理 `result_commit_state = pending` 的成功任务。
- 读取任务目标和画布。
- 检查画布目标的 `latestGenerationTaskId`。
- 匹配时将本地结果和缩略图一次性写入画布。
- 不匹配时标记 `discarded`，不覆盖新任务。
- 写入成功后标记 `committed` 和 `result_committed_at`。
- 启动时重试因进程退出而遗留的 pending commit。

### 9.5 `generation-task-cleanup.cjs`

职责：

- 精简目标最新终态任务。
- 删除超过保留期的历史终态任务。
- 处理目标已经被删除的 orphan 任务。
- 执行低频 WAL checkpoint 和 incremental vacuum。
- 只清理任务元数据，不删除图片资源。

### 9.6 Executor

`api-generation-executor.cjs` 从现有 `image-generation-runner.cjs` 提取：

- API 请求。
- 直接返回与远端异步任务处理。
- 远端轮询。
- 远端取消。
- 结果 URL 解析。

`libtv-generation-executor.cjs` 从现有 `libtv-generation-runner.cjs` 提取：

- 工作区和日期画布准备。
- 参考图上传。
- 远端节点创建和运行。
- LibTV 查询和恢复。
- CLI 中止。
- 现有每节点动作裂变并发规则。

Executor 返回原始远端结果，统一由 TaskService/AssetStore 进入 `result_processing`。

## 10. 创建任务的一致性协议

任务数据库和画布 JSON 无法使用同一个数据库事务，必须使用明确顺序和补偿：

1. Repository 事务创建 `queued` 任务并更新 Target Head。
2. CanvasStore 将 `latestGenerationTaskId` 写入对应节点或动作行。
3. 画布写入成功后，TaskService 才允许任务进入 Executor 队列。
4. 画布写入失败时，将任务标记为 `interrupted` 或 `orphaned`，不调用远端。
5. Renderer 收到任务创建成功响应时，任务 ID 已经写入数据库和画布。

这样不会出现远端已经开始生成，但画布尚未持久化任务指针的窗口。

批量动作裂变任务：

- 在一个 Repository 事务中创建本批任务和 Target Heads。
- CanvasStore 使用一次画布文件写入更新所有行指针。
- 画布写入失败则整批不进入调度。
- 画布写入成功后按照节点并发设置开始执行。

## 11. 终态结果提交协议

### 11.1 成功任务

1. Executor 获得远端图片 URL。
2. TaskService 将任务更新为 `result_processing`。
3. AssetStore 下载图片并生成缩略图。
4. Repository 保存结果资源信息。
5. 任务更新为 `succeeded`、`result_commit_state = pending`。
6. ResultCommitter 读取画布目标。
7. 比较画布 `latestGenerationTaskId === task.id`。
8. 相等则写入 `generatedImages` 或动作行结果。
9. 标记 `result_commit_state = committed`。
10. 不相等则标记 `discarded`，保留资源供后续资源清理处理。

### 11.2 失败、取消和中断

- 错误只保存在任务记录中。
- 画布继续指向该最新任务，因此重新打开后仍可查询错误。
- 不清除之前已经生成的正式结果图。
- 重新运行创建新任务并替换画布指针。
- 旧任务晚到的结果因指针不匹配无法提交。

### 11.3 幂等要求

- ResultCommitter 可以安全重复执行。
- `committed` 和 `discarded` 任务不会再次写画布。
- CanvasStore 写入必须检查任务 ID，不仅检查 node/row ID。
- 软件在任务终态与画布写入之间退出时，启动后自动补交。

## 12. 全局调度与并发

### 12.1 调度范围

任务池属于主进程，不属于当前 Renderer 页面：

- 切换画布不会暂停任务。
- 关闭参数面板不会暂停任务。
- Canvas React 组件卸载不会清理任务 Controller。
- 多画布任务可以同时运行。

### 12.2 同目标规则

- 一个图像生成节点同一时间只有一个最新活跃任务。
- 动作裂变每一行是独立任务目标。
- 同一动作裂变节点的 LibTV 行任务遵守设置中的并发数量。
- 不同动作裂变节点拥有独立并发池，但可以共享同一个 LibTV 远端日期画布。
- 单行重试创建新任务，并重新进入该节点并发池。
- 创建新任务时旧活跃任务转为 `superseded`。

### 12.3 内存与持久化状态

不持久化：

- AbortController。
- Promise。
- CLI 子进程句柄。
- 定时器。
- IPC 订阅者。
- 防抖队列。

持久化：

- 队列状态。
- 输入快照。
- 目标和 Executor。
- 远端锚点。
- 关键状态和错误。
- 结果处理阶段。
- 终态提交状态。

## 13. 软件启动恢复

启动顺序：

1. 初始化数据库并执行 schema migration。
2. 查询所有非终态任务。
3. 查询所有 `result_commit_state = pending` 的成功任务。
4. 先补做 pending 结果提交。
5. 再按状态恢复活跃任务。
6. 完成恢复后执行安全清理。
7. 创建 BrowserWindow 后发送当前活跃任务快照。

恢复规则：

### `queued`

- 重新进入全局队列。
- 保留原任务 ID。

### `preparing`

- API：根据输入快照重新执行纯本地准备。
- LibTV：检查已有 workspace/project 状态后继续。
- 准备步骤必须幂等。

### `submitting`

- 已有远端任务 ID：进入远端恢复/轮询。
- 没有远端 ID且平台没有幂等提交能力：标记 `interrupted`，避免重复扣费和重复生成。
- 未来平台支持 idempotency key 时，可以使用内部任务 ID作为提交幂等键。

### `running`

- API 有远端任务 ID：继续轮询。
- LibTV 有 project UUID 和 remote node ID：继续查询远端节点。
- 没有可恢复远端锚点：标记 `interrupted`。

### `result_processing`

- 已保存远端结果 URL：只重新下载/保存/生成缩略图。
- 不重新发起远端生成。

### 终态但未提交画布

- 重新运行 ResultCommitter。
- 指针匹配则补交结果。
- 指针不匹配则标记 `discarded`。

## 14. Renderer 状态架构

新增：

```text
renderer/src/features/infinite-canvas/generation-tasks/
  generationTaskTypes.ts
  generationTaskClient.ts
  generationTaskStore.ts
  generationTaskSelectors.ts
  useGenerationTaskRuntime.ts
```

### 14.1 Zustand Task Cache

仅保存在 Renderer 内存：

```ts
interface GenerationTaskRuntimeState {
  tasksById: Map<string, GenerationTaskDto>;
  applySnapshot(tasks: GenerationTaskDto[]): void;
  applyEvent(task: GenerationTaskDto): void;
  removeTasks(taskIds: string[]): void;
}
```

规则：

- Store 不自行持久化到磁盘。
- 根据 `task.version` 忽略乱序旧事件。
- 画布打开时批量查询该画布引用的任务 ID。
- 节点通过单任务 selector 订阅，其他任务更新不触发该节点重渲染。
- Task Cache 不写回 React Flow node data。

### 14.2 Hook 收敛

现有 Hook：

```text
useNativeImageGeneration.ts
useNativeActionFissionGeneration.ts
useNativeLibtvGeneration.ts
```

改造后只保留 UI 命令职责：

- 构建提交输入。
- 调用 start/stop/retry IPC。
- 处理本地表单校验。
- 不运行轮询循环。
- 不保存 Controller。
- 不把任务对象和错误 patch 到节点。
- 不负责软件重启恢复。

状态展示统一读取全局 Task Cache。

## 15. IPC 设计

建议方法：

```text
generation-tasks:start
generation-tasks:start-many
generation-tasks:get
generation-tasks:get-many
generation-tasks:list-for-canvas
generation-tasks:stop
generation-tasks:stop-for-target
generation-tasks:stop-for-node
generation-tasks:stop-for-canvas
generation-tasks:retry-result-processing
```

主进程事件：

```text
generation-task:changed
generation-task:removed
```

事件载荷包含完整公开 DTO 和单调递增 `version`。

初始化订阅避免竞态：

1. Renderer 先注册事件监听器。
2. 再调用 `get-many` 或 `list-for-canvas` 获取快照。
3. Store 按 `version` 合并快照和已收到事件。

Preload 只暴露类型明确的方法，不暴露数据库路径、SQL 或 Repository。

## 16. 画布模型改造

### 16.1 图像生成节点

保留：

```text
latestGenerationTaskId
imageGenerationBackend
imageProviderId
imageModel
imageResolution
imageAspectRatio
imageQuality
imageCount
generatedImages
```

`libtvImageGeneration` 中只保留节点参数配置；运行时远端字段全部移入任务数据库。后续可以再将 API/LibTV 参数统一为明确的 generation config，本计划不强制同时完成该重构。

### 16.2 动作裂变行

保留：

```text
latestGenerationTaskId
动作分类配置
selectedActionId / selectedActionName
resultUrl / resultThumbUrl
resultFileName
resultWidth / resultHeight
resultDownloadState / resultDownloadedAt
```

移除所有 API/LibTV 运行时字段。

### 16.3 复制和导出

- 复制节点、Alt 拖拽复制和粘贴节点时删除 `latestGenerationTaskId`。
- 保留已经成为画布内容的结果图。
- 导出/上传共享画布包含结果资源，但不包含任务数据库记录。
- 导入/复制共享画布时删除任务 ID，避免指向另一台机器不存在的任务。
- 普通画布另存为副本时同样删除所有任务 ID。

## 17. 0.1.34 画布迁移

迁移只负责把 GitHub `0.1.34` 保存的画布 JSON 原子替换为 `canvasSchemaVersion: 2`，不把旧任务导入全局任务数据库。

### 17.1 清理字段

清理旧运行态、任务锚点和错误字段：

```text
generationTaskId
generationRemoteTaskId
generationTask
generationError
libtvImageGeneration.taskId
libtvImageGeneration.projectUuid
libtvImageGeneration.remoteNodeId
actionFission.rows[*].generationTaskId
actionFission.rows[*].generationRemoteTaskId
actionFission.rows[*].libtvTaskId
actionFission.rows[*].libtvProjectUuid
actionFission.rows[*].libtvRemoteNodeId
actionFission.rows[*].error
```

### 17.2 迁移规则

- 保留节点、连线、视口、节点尺寸与层级、生成结果、缩略图和下载状态。
- 保留平台、模型、尺寸、动作分类及已选择动作等持久配置。
- 旧任务不恢复，旧错误不保留，也不创建 SQLite 任务记录。
- 动作分类行统一为 `categoryGroups` 结构。
- CanvasStore 启动时用原子文件替换完成迁移。
- `canvasSchemaVersion: 2` 作为幂等边界，v2 画布不再重复迁移。
- 团队画布全部升级后，可整体删除 v1→v2 迁移函数。

## 18. 自动清理策略

### 18.1 不可清理

以下任务永不自动删除：

- 所有活跃状态任务。
- `result_processing` 任务。
- `result_commit_state = pending` 的任务。
- 当前仍由 `generation_target_heads` 引用的最新任务。

### 18.2 最新终态任务精简

每个目标最新任务长期保留精简摘要：

- 保留 ID、目标、Executor、状态、错误、时间和提交状态。
- 成功且已提交后移除输入快照、远端原始响应和重复结果详情。
- 失败任务保留最近错误，直到新任务替换或目标删除。
- 最新任务数量最多约等于图像生成节点数量加动作裂变行数量。

### 18.3 历史任务保留期

建议默认值：

```text
succeeded + committed/discarded: 7 天
failed:                         14 天
interrupted/superseded:          7 天
canceled:                        3 天
未实际提交且无远端锚点:          1 天
orphaned 终态任务:               1 天
```

删除必须同时满足：

- 已进入终态。
- 不是任何 Target Head 的最新任务。
- 不在内存队列或 Controller 中。
- 成功任务已经 committed 或 discarded。
- 超过对应保留期限。

### 18.4 触发时机

- 软件启动完成任务恢复后。
- 每 12 小时。
- 用户执行清理缓存时，可额外提供任务历史清理入口。

### 18.5 数据库维护

- 清理事务结束后按需执行 WAL checkpoint。
- 不在每次清理后执行完整 `VACUUM`。
- 数据库明显膨胀时低频执行 `incremental_vacuum`。
- 任务清理绝不直接删除图片文件。

## 19. 删除与孤儿处理

### 删除节点或动作行

- 如果存在活跃最新任务，调用 TaskService 停止。
- 删除对应 Target Head。
- 任务已经向远端提交但无法真正取消时标记 orphaned/interrupted。
- orphan 任务的晚到结果不得写入画布。

### 删除画布

- 停止该画布所有可停止任务。
- 删除该画布所有 Target Heads。
- 终态历史任务进入短保留期。
- 无法取消的远端任务继续由 Service 收尾，但不保存为画布结果。

### 移动画布到项目

- `canvasId` 不变，不影响任务目标。

### 重命名画布或节点

- ID 不变，不影响任务目标。

## 20. 性能与并发原则

- SQLite 只保存任务元数据，不保存图片二进制。
- 所有写入由主进程单 Repository 串行完成。
- 单次状态更新使用单行短事务。
- 关键状态转换立即持久化。
- 未变化的状态不重复写入。
- 高频远端反馈可在 200–500ms 内合并持久化，但 IPC UI 事件可立即更新。
- Renderer 只订阅当前节点 taskId，避免全画布因任意任务状态变化重渲染。
- 不把任务状态 patch 进 React Flow nodes，从根源减少画布快照变化和节点重渲染。

## 21. 测试计划

### 21.1 Repository 单元测试

- schema 初始化和升级。
- WAL/foreign key 配置。
- 创建任务与 Target Head 原子更新。
- 同目标新任务 supersede 旧任务。
- `version` 单调递增。
- 非法状态转换拒绝。
- 批量任务事务回滚。
- 并发回调下无丢失更新。
- 清理保护活跃、最新和 pending commit 任务。
- 各终态保留期正确。

### 21.2 TaskService 单元测试

- API/LibTV Executor 路由正确。
- 画布指针写入失败时不启动远端任务。
- 多画布任务独立运行。
- 同节点新任务替代旧任务。
- 动作裂变节点并发限制 1–10 和无限制。
- 单行失败后重新运行重新进入节点任务池。
- 队列任务停止后不会发送到远端。
- 停止单任务、节点、画布边界正确。

### 21.3 结果提交测试

- 最新任务成功后写入结果。
- 旧任务晚完成不能覆盖新任务。
- 重复终态事件只写一次。
- 进程在 terminal 与 canvas commit 中间退出后可补交。
- `result_processing` 重启只重新本地处理，不重新生成。
- 画布、节点或动作行不存在时标记 discarded/orphaned。
- 成功结果写回后下载状态初始化正确。

### 21.4 恢复测试

- queued 重启后重新入队。
- API 有 remote task ID 时继续轮询。
- API submitting 且无幂等远端锚点时标记 interrupted。
- LibTV 使用 project UUID/remote node ID恢复。
- 切换画布后任务继续。
- Renderer reload 后通过快照恢复 UI 状态。
- 软件关闭再启动后错误、时间和结果处理状态恢复。

### 21.5 Renderer 测试

- Zustand 按 task version 忽略旧事件。
- 节点只响应自身任务更新。
- 状态、错误、时间和按钮禁用从 Task Cache 派生。
- 任务不存在但画布有最终结果时正常显示结果。
- 任务历史被清理时 dangling task ID 不显示错误。
- 复制节点和画布时清除任务 ID并保留正式结果。

### 21.6 回归测试场景

分别使用 API 与 LibTV：

- 图像生成节点单任务。
- 多图结果。
- 动作裂变 3 行和 10 行。
- 两个画布同时运行。
- 多个动作裂变节点同时运行。
- 生成中切换画布。
- 队列中停止单行。
- 运行中停止整组。
- 单行失败后重新运行。
- 更换平台后旧错误不再回到新任务。
- 远端已成功、本地结果处理失败后重试。
- 删除运行中的节点和画布。
- 软件重启恢复。
- 清理后画布最终图片仍完整。

### 21.7 发布验证

- `npm run validate:i18n`
- `npm run build`
- 所有 Node 回归测试。
- `npm run package:dir`
- 打包版本中的 `better-sqlite3` 原生模块可加载。
- 免安装目录移动后任务数据库仍跟随 portableRootDir。

## 22. 分阶段实施

### 阶段 0：行为锁定

- 为当前 API、LibTV、动作裂变任务生命周期补齐特征测试。
- 固定现有并发、取消、恢复和结果写回规则。
- 建立旧画布 fixture。

验收：当前行为有可重复测试，后续重构能检测回归。

### 阶段 1：SQLite Repository

- 新增数据库与 schema。
- 将两个内存 Task Store 的读写迁移到统一 Repository。
- 暂时保持现有 Runner 和 Renderer 轮询接口。
- API 与 LibTV 任务都写入同一数据库，但仍由原 Runner 执行。

验收：软件重启后任务记录仍存在；现有 UI 行为不变。

### 阶段 2：统一 TaskService 与 Executor

- 新增 TaskService。
- 现有 API/LibTV Runner 收敛为 Executor。
- 统一状态、目标、停止与恢复入口。
- 保留两套执行实现的独立性。

验收：跨画布运行、并发、停止和远端恢复全部由主进程管理。

### 阶段 3：事件订阅与 Renderer Task Cache

- 新增任务事件 IPC。
- 新增 Zustand 全局 Task Cache。
- 节点状态改为按 taskId selector 获取。
- 移除 Renderer 每节点轮询和完整任务对象 patch。

验收：切换画布和组件卸载不影响任务；UI 状态无明显延迟。

### 阶段 4：画布字段收敛与结果提交器

- 新增 `latestGenerationTaskId`。
- 新增幂等 ResultCommitter。
- 移除画布中的运行状态、错误、远端锚点和完整任务对象。
- 实现旧画布迁移。
- 调整复制、导出、共享上传和导入规则。

验收：画布 JSON 只包含任务指针与正式结果；旧任务不能覆盖新结果。

### 阶段 5：启动恢复与自动清理

- 按状态恢复任务。
- 补交 pending 结果。
- 新增历史任务精简和删除。
- 接入缓存清理入口和数据库维护。

验收：重启恢复和自动清理均不丢任务、不丢结果、不重复生成。

### 阶段 6：删除旧代码

- 删除旧内存 Task Store。
- 删除画布锚点扫描恢复路径。
- 删除 Renderer 轮询 Controller 和旧字段兼容。
- 删除旧 API/LibTV 重复任务 DTO。
- 更新测试、文档和 i18n。

验收：不存在第二套任务事实源和长期双写逻辑。

## 23. 风险与控制

### 数据库与画布双写不一致

控制：固定创建顺序、任务未写入画布前不启动、ResultCommitter 幂等补偿、启动时校验 pending 状态。

### SQLite 主线程阻塞

控制：单行短事务、Prepared Statement、WAL、非关键消息合并、图片处理不进入事务。

### 旧任务重复生成

控制：提交阶段无远端幂等锚点时不自动重试；`result_processing` 只恢复本地处理。

### 旧任务串图

控制：画布和 Target Head 双重 latest task ID 校验，旧任务只能 discarded。

### LibTV 被公共系统耦合

控制：只共享任务协议，LibTV Executor 保持独立模块和私有状态。

### 任务数据库无限增长

控制：每目标只长期保留一个精简摘要，历史终态任务按期限删除。

### 导出或共享画布依赖本机任务数据库

控制：最终结果始终写回画布；导出时清除任务 ID并携带结果资源。

## 24. 验收标准

- 画布 JSON 不再保存完整任务对象、错误、运行状态或远端平台锚点。
- 每个图像生成节点和动作裂变行最多只有一个 `latestGenerationTaskId`。
- 所有任务均可通过内部 task ID在主进程全局查询。
- API 和 LibTV 状态使用同一 DTO 和状态机。
- 切换或卸载画布不影响任务执行和调度。
- 软件重启后可恢复所有具备远端锚点的任务。
- 本地结果处理失败不会重新生成远端图片。
- 任务成功后最终结果幂等写入画布。
- 旧任务晚完成不能覆盖新任务。
- 失败信息从任务系统读取，重新运行后不会恢复旧平台错误。
- 删除画布/节点不会产生晚到结果写回。
- 自动清理不会删除活跃、最新或待提交任务。
- 清理任务历史后，画布结果、导出和共享画布仍完整可用。
- 现有 LibTV 动作裂变节点级并发规则保持不变。
- 生产构建、Electron 打包和任务生命周期回归测试全部通过。

## 25. 最终建议

本次改造应分阶段完成，不建议一次性同时替换 Repository、Runner、Renderer 和画布字段。

最安全的路径是先让现有任务 Store 获得 SQLite 持久化，再建立统一 TaskService，之后切换 Renderer 状态来源，最后收敛画布字段和删除旧代码。任何阶段都不应长期维持两套可写任务事实源。

最终边界保持为：

```text
SQLite GenerationTaskService
  = 任务状态、错误、队列、远端锚点、恢复与清理

Canvas JSON
  = latestGenerationTaskId、节点参数、最终结果与下载状态

Canvas Assets
  = 原图与缩略图文件
```

这能同时解决跨画布任务、软件重启恢复、状态字段重复、旧错误回流、任务串图和历史数据增长问题，同时保留 API 与 LibTV 的独立执行边界。
