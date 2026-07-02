# Node-Anchored Generation Task Plan

## 目的

本文档重新定义 Forart 无限画布图像生成与图像裂变任务的管理方向。

新的方向是：

- 节点或裂变行保存最小任务恢复锚点。
- 后端只维护轻量运行任务表，负责提交、查询、取消和结果缓存。
- 前端打开画布时从节点或行里的任务锚点恢复轮询和 UI 状态。
- 不再把 canvas/global active task registry 作为唯一任务状态源。

这个方案优先解决当前开发阶段最实际的问题：

- 切换画布回来后，前端能准确知道哪个节点或哪一行正在等待哪个任务。
- 复制节点时不会继承生成中状态。
- 删除节点、删除任务项或删除画布时，可以通过节点/行上的 task id 直接取消任务。
- 不需要为了纯全局任务注册表补大量画布切换、异步视图刷新、目标归属和孤儿任务处理逻辑。

## 设计结论

Forart 后续建议采用“节点锚点 + 后端轻量任务表”的混合模式。

```text
节点/行：保存任务归属与恢复锚点
后端任务表：保存当前进程内的运行状态、结果、错误与取消控制
前端轮询：把后端状态同步回节点/行
画布 JSON：保存最终结果和可恢复任务锚点
```

这不是纯节点运行态，也不是纯全局 registry。它的核心是：

- 任务归属写在任务目标上。
- 任务执行状态由后端负责。
- UI 状态由节点/行任务锚点 + 后端查询结果推导。

## 推荐数据模型

### 节点或裂变行上的任务锚点

图像生成节点和图像裂变行保留一个统一的 `generationTask` 字段。

```ts
type GenerationTaskAnchor = {
  taskId: string;
  upstreamTaskId?: string;
  status: 'queued' | 'submitting' | 'running' | 'recoverable';
  kind: 'image-node' | 'action-fission-row';
  providerId?: string;
  model?: string;
  expectedCount?: number;
  createdAt: number;
  updatedAt: number;
  resumeHint?: string;
};
```

节点或行不保存 AbortController、轮询 timer、后台 promise、临时进度对象等运行时对象。

### 后端任务表

后端保存当前进程内的轻量任务记录。

```ts
type BackendGenerationTask = {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result?: unknown;
  error?: string;
  upstreamTaskId?: string;
  providerId?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
};
```

后端任务表可以落盘，也可以先只内存化。开发阶段建议先保持轻量，不把它升级成复杂的全局画布状态中心。

## 生成流程

1. 用户点击生成。
2. 前端创建本地 pending UI。
3. 前端请求后端创建任务。
4. 后端返回 `taskId`。
5. 前端立刻把 `generationTask` 写入对应节点或裂变行，并保存画布。
6. 前端开始轮询后端任务状态。
7. 后端任务成功后，前端写入结果图片。
8. 前端删除节点或行上的 `generationTask`。
9. 前端写入任务日志或最终结果摘要。

关键点：

- `taskId` 一旦生成，必须尽快保存到画布 JSON。
- 成功结果写入节点/行后，`generationTask` 必须清除。
- 失败但存在 `upstreamTaskId` 时，保留 `generationTask` 并标记为 `recoverable`。
- 失败且不可恢复时，清除 `generationTask`，UI 回到空闲或展示失败日志。

## 切换画布与恢复

打开或切回画布时：

1. 扫描当前画布所有图像节点和图像裂变行。
2. 找到存在 `generationTask.taskId` 的目标。
3. 使用 `taskId` 查询后端任务表。
4. 如果后端任务仍存在且未结束，恢复轮询并显示生成中。
5. 如果后端任务已成功，写回结果并清除 `generationTask`。
6. 如果后端任务已失败且有 `upstreamTaskId`，进入 `recoverable` 状态。
7. 如果后端任务不存在但节点有 `upstreamTaskId`，进入 `recoverable` 状态。
8. 如果后端任务不存在且没有任何恢复引用，清除 `generationTask`，恢复空闲。

这样可以避免纯 registry 方案中的一个核心问题：

```text
后端知道有任务，但前端切回画布时不知道应该挂到哪个节点或哪一行。
```

在本方案中，任务目标本身保存归属信息，所以恢复路径更短。

## 复制节点处理

复制或粘贴节点时：

保留：

- 最终生成图片。
- 节点配置。
- 用户输入内容。
- 必要的非任务结果数据。

清除：

- `generationTask`
- `taskId`
- `upstreamTaskId`
- `running`
- `status`
- `generationStatus`
- `resumeHint`
- 任务日志中的运行中记录
- 裂变行里的运行中任务字段

复制节点后，新节点必须是空闲状态。

这一步是本方案的关键补丁点。它解决最初的问题：复制一个正在生成的图像裂变节点后，新节点不应该显示生成中。

## 删除与停止

### 删除节点

删除节点前：

1. 收集节点自身的 `generationTask.taskId`。
2. 收集节点内所有裂变行的 `generationTask.taskId`。
3. 调用后端取消任务。
4. 从画布中删除节点。
5. 保存画布。

### 删除裂变行

删除裂变行前：

1. 如果行有 `generationTask.taskId`，调用后端取消任务。
2. 删除该行。
3. 保存画布。

### 删除画布

删除画布前：

1. 扫描整张画布的所有 `generationTask.taskId`。
2. 批量取消后端任务。
3. 删除画布数据。
4. 清除相关任务记录。

### 手动停止任务

手动停止任务时：

1. 调用后端取消任务。
2. 清除节点或行上的 `generationTask`。
3. UI 回到正常空闲状态。
4. 不弹出错误提示。

如果某些上游平台不支持真正取消，则后端至少要停止本地等待和写回，避免结果再落到已停止的节点。

## 图像裂变行处理

图像裂变每一行都有独立 `generationTask`。

批量状态由行任务自动推导：

- 任意行存在 `queued/submitting/running`，批量区域显示运行中。
- 所有行无 active task，批量区域显示空闲。
- 行成功后清除该行 `generationTask` 并写入结果。
- 行失败可恢复时保留 `generationTask.status = 'recoverable'`。

清空操作拆分最后一行数据时，应重新生成该行 ID，避免旧任务锚点和旧行身份继续复用。

## 与旧 Global Registry 方案的取舍

旧 registry 方案的目标是让后端统一管理所有 active task。它在概念上更集中，但实践中需要处理更多边界：

- 画布切换时 registry 视图刷新时序。
- 旧画布请求覆盖新画布视图的异步 race。
- 后端任务归属和前端节点挂载之间的同步。
- 节点删除、画布删除后的孤儿任务清理。
- 任务完成后写回目标是否还存在。
- 复制节点后 registry 目标是否需要重新映射。
- 前端 UI 完全依赖 registry 时，任何 registry 拉取失败都会让节点看起来空闲。

新的节点锚点方案把任务归属放回目标数据本身，减少这类补丁。

代价是：

- 节点/行 JSON 仍然会保存少量 active task 字段。
- 复制、导出、克隆画布时必须显式清理任务锚点。
- 需要严格区分“任务锚点”和“最终结果”，避免把运行态当成结果数据。

总体判断：

```text
节点锚点方案更简单、更直接、更适合当前开发阶段。
Global registry 方案更集中，但对当前 Forart 来说会引入更高的状态同步复杂度。
```

## 与 Infinite-Canvas-main 的对比

参考项目 `D:\coding\Infinite-Canvas-main` 使用的是相似但更松散的混合方案。

### 相同点

- 都让节点保存任务恢复引用。
- 都由后端创建本地任务并返回 `taskId`。
- 都由前端轮询后端任务状态。
- 都在切换或重新打开画布时，根据节点里的任务引用恢复轮询。
- 都在成功后把结果写回节点，并清理 pending 任务。

### Infinite-Canvas-main 的做法

它的前端节点会保存：

- `pendingTasks`
- `pending`
- `running`
- `jimengPending`
- 计时字段

后端有内存任务表：

- `CANVAS_TASKS`
- `/api/canvas-image-tasks`
- `/api/canvas-image-tasks/{task_id}`

任务完成后，前端把结果写回节点；如果后端任务丢失但能拿到上游 task id，则进入手动查询或恢复路径。

### Forart 新方案的不同点

Forart 不建议完全照搬它的字段设计，而是做更收敛的版本：

1. 使用统一字段 `generationTask`，不分散保存 `pendingTasks/running/pending/jimengPending`。
2. `running` 和 `pending` 尽量作为 UI 派生状态，不作为核心恢复字段。
3. 复制节点时必须清除 `generationTask`，并覆盖所有旧任务字段。
4. 删除节点、删除裂变行、删除画布时必须主动取消后端任务。
5. 后端需要提供明确的 cancel 接口，而不是只让前端停止轮询。
6. 图像节点和图像裂变行使用同一套任务锚点结构。
7. 可恢复状态统一为 `generationTask.status = 'recoverable'`，不把恢复逻辑散落在多个字段中。

### Infinite-Canvas-main 的不足，Forart 应避免

1. 普通复制粘贴只清了部分运行态字段，存在遗漏恢复字段的风险。
2. 后端任务表主要是内存态，服务重启后本地任务状态会丢。
3. 删除节点时没有明显的后端任务取消链路。
4. 节点字段较分散，`pendingTasks/pending/running/jimengPending` 同时存在，长期容易形成多套状态判断。
5. 部分恢复逻辑依赖特殊 provider 分支，统一性不够。

Forart 可以吸收它的简单恢复思路，但不要继承它的字段分散和取消链路缺失问题。

## 建议实施阶段

### 阶段 1：停止推进纯 registry 作为唯一状态源

- 保留已有后端 runner 能力。
- 不再把 registry 视为 UI active state 的唯一来源。
- 明确节点/行上的 `generationTask` 是恢复锚点。

### 阶段 2：恢复节点与行级任务锚点

- 在图像节点恢复 `generationTask`。
- 在图像裂变行恢复 `generationTask`。
- 统一 `GenerationTaskAnchor` 类型。
- 生成提交后立即写入锚点并保存画布。

### 阶段 3：恢复切换画布轮询

- 打开画布时扫描节点/行任务锚点。
- 查询后端任务表。
- 恢复 active 轮询。
- 对缺失本地任务但存在 `upstreamTaskId` 的目标标记为 `recoverable`。

### 阶段 4：复制、导出、克隆清理

- 建立统一 `sanitizeNodeForClone` 或等价函数。
- 清除所有任务锚点和旧运行态字段。
- 保留最终图片结果。
- 覆盖图像节点、图像裂变节点、画布复制、导出导入等入口。

### 阶段 5：删除与停止闭环

- 删除节点前取消节点和行任务。
- 删除裂变行前取消行任务。
- 删除画布前批量取消任务。
- 手动停止后清除锚点，不弹错误提示。

### 阶段 6：清理旧 registry-only 代码

- 移除只为纯 registry UI 服务的复杂 view 层。
- 保留必要的后端任务运行表和查询接口。
- 保留结果写回、防重复写回、取消保护等实际有用逻辑。

## 验收场景

必须覆盖以下手动测试：

1. 图像节点生成中，切换画布再切回，仍显示生成中并最终写回结果。
2. 图像裂变某一行生成中，切换画布再切回，该行仍显示生成中并最终写回结果。
3. 复制正在生成的图像节点，新节点保留旧结果图但不显示生成中。
4. 复制正在生成的图像裂变节点，新节点所有行都不显示生成中。
5. 删除正在生成的节点，后端任务被取消，结果不会写回。
6. 删除正在生成的裂变行，后端任务被取消，结果不会写回。
7. 删除整张画布，画布内所有 active task 被取消。
8. 手动停止任务后，UI 回到空闲，不弹错误提示。
9. 后端任务丢失但有 `upstreamTaskId` 时，目标进入可恢复状态。
10. 后端任务丢失且没有恢复引用时，目标回到空闲。

