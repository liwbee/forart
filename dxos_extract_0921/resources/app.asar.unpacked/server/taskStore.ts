import { createHash, randomUUID } from 'node:crypto'
import { ccsDb } from './ccsDb.ts'
import { findByPath, getNode, isWithinRoot } from './fs.ts'

export type TaskStatus = 'queued' | 'planning' | 'running' | 'verifying' | 'completed' | 'waiting_user' | 'paused' | 'interrupted' | 'failed' | 'cancelled'
export type FileAction = { tool: 'file.read' | 'file.create' | 'file.write'; path: string; content?: string }
export type LegacyTaskInput = {
  sourceId: string; title?: string; instruction?: string; status?: string; createdAt?: number
  messages?: Array<{ role?: string; text?: string }>
}

type ProjectRow = { id: string; name: string; root_node_id: string; created_by: string | null; created_at: number; updated_at: number }
type TaskRow = {
  id: string; project_id: string; thread_id: string; title: string; instruction: string; status: TaskStatus
  worker_id: string | null; lease_until: number | null; heartbeat_at: number | null; current_step_id: string | null
  result: string | null; error_code: string | null; error_message: string | null; resume_safe: number
  mode: 'actions' | 'react'; execution_profile: AssistantMode; model_calls: number; tool_calls: number; waiting_question: string | null
  preferred_provider_id: string | null; preferred_llm_model: string | null; preferred_image_provider_id: string | null; preferred_image_model: string | null
  created_by: string | null
  created_at: number; updated_at: number; started_at: number | null; completed_at: number | null
}
export type AssistantMode = 'assistant' | 'thinking'
type TaskStepRow = { id: string; task_id: string; ordinal: number; title: string; tool_name: string; input_json: string; status: string; output_json: string | null; operation_id: string }
type TaskEventRow = { id: number; task_id: string; sequence: number; type: string; message: string; data_json: string | null; created_at: number }
type ThreadMessageRow = { id: string; thread_id: string; task_id: string | null; role: string; content: string; created_at: number }
type CheckpointRow = { id: string; task_id: string; step_id: string | null; iteration: number; plan_version: number; state_json: string; context_summary: string | null; created_at: number }
type PlanRow = { id: string; task_id: string; version: number; goal: string; assumptions: string; acceptance: string; created_at: number; updated_at: number }
type DeliverableRow = { id: string; task_id: string; project_id: string; node_id: string; name: string; verification_status: string; created_at: number; updated_at: number }
type ObservationRow = { id: string; task_id: string; step_id: string; operation_id: string; tool_name: string; status: string; summary: string; data_json: string | null; created_at: number }
export type TaskView = TaskRow & { plan: PlanRow | null; steps: TaskStepRow[]; events: TaskEventRow[]; checkpoints: CheckpointRow[]; deliverables: DeliverableRow[]; observations: ObservationRow[] }

const now = () => Date.now()
const json = (value: unknown) => JSON.stringify(value ?? null)
const hashInput = (value: string) => createHash('sha256').update(value).digest('hex')
function writeTransaction<T>(work: () => T): T {
  return ccsDb.inTransaction ? work() : ccsDb.transaction(work).immediate()
}

export function projectForRoot(rootNodeId: string) {
  return ccsDb.prepare('SELECT * FROM projects WHERE root_node_id = ?').get(rootNodeId) as ProjectRow | undefined
}

export function createProject(input: { name: string; rootNodeId: string; createdBy: string }) {
  const existing = projectForRoot(input.rootNodeId)
  if (existing) {
    requireProjectAccess(existing.id, input.createdBy)
    return existing
  }
  const id = randomUUID()
  const ts = now()
  ccsDb.transaction(() => {
    ccsDb.prepare('INSERT INTO projects(id,name,root_node_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, input.name.trim() || '未命名项目', input.rootNodeId, input.createdBy, ts, ts)
    ccsDb.prepare('INSERT INTO project_members(project_id,user_id,role,can_create_tasks,created_at) VALUES (?,?,?,?,?)')
      .run(id, input.createdBy, 'owner', 1, ts)
  })()
  return getProject(id)!
}

export function getProject(id: string) {
  return ccsDb.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
}

export function listProjects(userId: string) {
  return ccsDb.prepare(`SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id
    WHERE m.user_id=? ORDER BY p.updated_at DESC`).all(userId) as ProjectRow[]
}

export function projectPermission(projectId: string, userId: string) {
  return ccsDb.prepare('SELECT role,can_create_tasks FROM project_members WHERE project_id=? AND user_id=?').get(projectId, userId) as
    { role: 'owner' | 'member'; can_create_tasks: number } | undefined
}

/** 共享区项目自动加入成员（计划 11：共享文件夹成员可创建项目对话/任务）。 */
export function ensureProjectMember(projectId: string, userId: string, role: 'owner' | 'member' = 'member') {
  ccsDb.prepare(`INSERT INTO project_members(project_id,user_id,role,can_create_tasks,created_at) VALUES (?,?,?,1,?)
    ON CONFLICT(project_id,user_id) DO NOTHING`).run(projectId, userId, role, now())
}

export function requireProjectAccess(projectId: string, userId: string, createTask = false) {
  const permission = projectPermission(projectId, userId)
  if (!permission || (createTask && !permission.can_create_tasks)) throw new Error('没有该项目的任务权限')
  return permission
}

export function createThread(projectId: string, title = '新对话', createdBy?: string, visibility: 'private' | 'project' = 'project') {
  const id = randomUUID()
  const ts = now()
  ccsDb.prepare('INSERT INTO threads(id,project_id,title,visibility,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, projectId, title, visibility, createdBy || null, ts, ts)
  return ccsDb.prepare('SELECT * FROM threads WHERE id = ?').get(id) as { id: string; project_id: string; title: string; visibility: string; created_by: string | null; created_at: number; updated_at: number }
}

function titleFor(instruction: string) {
  return instruction.trim().replace(/\s+/g, ' ').slice(0, 40) || '未命名任务'
}

function normalizeActions(actions: unknown): FileAction[] {
  if (!Array.isArray(actions)) return []
  return actions.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const tool = String(raw.tool || '')
    const path = String(raw.path || '').trim()
    if (!['file.read', 'file.create', 'file.write'].includes(tool) || !path) return []
    return [{ tool: tool as FileAction['tool'], path, ...(raw.content === undefined ? {} : { content: String(raw.content) }) }]
  })
}

/** M2 的基础 Harness 只执行确定的文件动作；规划与 ReAct 在 M4 接入。 */
export function actionsFromRequest(instruction: string, rawActions: unknown): FileAction[] {
  const explicit = normalizeActions(rawActions)
  if (explicit.length) return explicit
  // 涉及建文件夹/目录的请求，结构不确定（可能是“建文件夹+写文件”多步）→ 交给 ReAct，
  // 让它用 fs_mkdir + fs_create 完整执行，避免启发式把“文件夹”错建成空文件。
  if (/(创建|新建|建立一个?)?\s*(文件夹|目录|子文件夹|目录结构)/.test(instruction)) return []
  const quoted = instruction.match(/[「“\"]([^」”\"]+)[」”\"]/)
  const path = quoted?.[1]?.trim()
  const content = instruction.match(/(?:内容[为是：:]|写入[：:]|内容：)\s*([\s\S]+)$/)?.[1]?.trim()
  if (!path) return []
  if (/读取|查看|读(?:取)?文件/.test(instruction)) return [{ tool: 'file.read', path }]
  if (/创建|新建/.test(instruction)) return [{ tool: 'file.create', path, content: content || '' }]
  if (/写入|覆盖|更新|修改/.test(instruction)) return [{ tool: 'file.write', path, content: content || '' }]
  return []
}

export function createTask(input: { projectId: string; createdBy: string; threadId?: string; title?: string; instruction: string; userMessage?: string; actions?: unknown; executionProfile?: AssistantMode; preferences?: { providerId?: string; llmModel?: string; imageProviderId?: string; imageModel?: string } }) {
  const project = getProject(input.projectId)
  if (!project) throw new Error('项目不存在')
  requireProjectAccess(project.id, input.createdBy, true)
  const thread = input.threadId
    ? ccsDb.prepare('SELECT id, project_id FROM threads WHERE id = ?').get(input.threadId) as { id: string; project_id: string } | undefined
    : createThread(project.id, titleFor(input.instruction), input.createdBy)
  if (!thread || thread.project_id !== project.id) throw new Error('对话不属于该项目')
  const actions = actionsFromRequest(input.instruction, input.actions)
  const id = randomUUID(); const ts = now(); const planId = randomUUID()
  // M4：没有确定动作的任务进入 react 模式，由 Worker 的 Planner/ReAct 执行
  const mode: 'actions' | 'react' = actions.length ? 'actions' : 'react'
  ccsDb.transaction(() => {
    ccsDb.prepare(`UPDATE threads SET title=CASE WHEN title='新对话' THEN ? ELSE title END, updated_at=? WHERE id=?`)
      .run(titleFor(input.instruction), ts, thread.id)
    ccsDb.prepare(`INSERT INTO tasks(id,project_id,thread_id,title,instruction,status,mode,execution_profile,preferred_provider_id,preferred_llm_model,preferred_image_provider_id,preferred_image_model,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, project.id, thread.id, input.title?.trim() || titleFor(input.instruction), input.instruction, 'queued', mode, input.executionProfile || 'thinking', input.preferences?.providerId || null, input.preferences?.llmModel || null, input.preferences?.imageProviderId || null, input.preferences?.imageModel || null, input.createdBy, ts, ts)
    ccsDb.prepare('INSERT INTO thread_messages(id,thread_id,task_id,role,content,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), thread.id, id, 'user', input.userMessage?.trim() || input.instruction, ts)
    ccsDb.prepare('INSERT INTO task_plans(id,task_id,goal,assumptions,acceptance,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(planId, id, input.instruction, '[]', json(actions.map((a) => `完成 ${a.tool} ${a.path}`)), ts, ts)
    const step = ccsDb.prepare(`INSERT INTO task_steps(id,task_id,ordinal,title,tool_name,input_json,status,operation_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    actions.forEach((action, ordinal) => step.run(randomUUID(), id, ordinal + 1, `${action.tool} ${action.path}`, action.tool, json(action), 'queued', `${id}:${ordinal + 1}`, ts))
    appendTaskEvent(id, 'task.created', mode === 'actions' ? '任务已进入队列' : '思考模式已开始处理', { mode, executionProfile: input.executionProfile || 'thinking', actions: actions.length })
  })()
  return getTask(id)!
}

/**
 * 记录一轮「对话式」问答（不产生后台任务）。用于 Agent 判断为纯问答/闲聊时，
 * 把用户消息 + 助理回答写入对话历史，供项目「对话」视图查看与延续。
 */
export function recordConversation(input: { projectId: string; createdBy: string; threadId?: string; userText: string; assistantText: string }) {
  const project = getProject(input.projectId)
  if (!project) throw new Error('项目不存在')
  requireProjectAccess(project.id, input.createdBy, true)
  const thread = input.threadId
    ? ccsDb.prepare('SELECT id, project_id FROM threads WHERE id = ?').get(input.threadId) as { id: string; project_id: string } | undefined
    : createThread(project.id, titleFor(input.userText), input.createdBy)
  if (!thread || thread.project_id !== project.id) throw new Error('对话不属于该项目')
  const ts = now()
  const insert = ccsDb.prepare('INSERT INTO thread_messages(id,thread_id,task_id,role,content,created_at) VALUES (?,?,?,?,?,?)')
  ccsDb.transaction(() => {
    insert.run(randomUUID(), thread.id, null, 'user', input.userText, ts)
    insert.run(randomUUID(), thread.id, null, 'assistant', input.assistantText, ts + 1)
    ccsDb.prepare(`UPDATE threads SET title=CASE WHEN title='新对话' THEN ? ELSE title END, updated_at=? WHERE id=?`)
      .run(titleFor(input.userText), ts + 1, thread.id)
  })()
  return { threadId: thread.id }
}

const ASSISTANT_CHAT_PREFIX = '__DX_CHAT_V1__:'

export function syncAssistantConversation(input: {
  projectId: string
  createdBy: string
  threadId: string
  title: string
  createdAt?: number
  messages: Array<{ id: string; role: 'user' | 'assistant' | 'tool'; text: string; images?: Array<{ nodeId: string; name: string; url: string }> }>
}) {
  requireProjectAccess(input.projectId, input.createdBy, true)
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(input.threadId)) throw new Error('对话 ID 无效')
  const existing = ccsDb.prepare('SELECT id,project_id,created_by,visibility,created_at FROM threads WHERE id=?').get(input.threadId) as
    { id: string; project_id: string; created_by: string | null; visibility: string; created_at: number } | undefined
  if (existing && (existing.project_id !== input.projectId || existing.created_by !== input.createdBy || existing.visibility !== 'private')) throw new Error('对话不存在或无权修改')
  const nowTs = now()
  const createdAt = Number(input.createdAt) > 0 ? Number(input.createdAt) : nowTs
  const title = String(input.title || '').trim().slice(0, 80) || '新对话'
  // 请求体大小已经由 HTTP 层限制；这里不能再静默丢弃较早的聊天记录。
  const messages = Array.isArray(input.messages) ? input.messages : []
  ccsDb.transaction(() => {
    if (!existing) {
      ccsDb.prepare('INSERT INTO threads(id,project_id,title,visibility,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(input.threadId, input.projectId, title, 'private', input.createdBy, createdAt, nowTs)
    } else {
      ccsDb.prepare('UPDATE threads SET title=?,updated_at=? WHERE id=?').run(title, nowTs, input.threadId)
    }
    ccsDb.prepare('DELETE FROM thread_messages WHERE thread_id=? AND substr(content,1,?)=?')
      .run(input.threadId, ASSISTANT_CHAT_PREFIX.length, ASSISTANT_CHAT_PREFIX)
    const insert = ccsDb.prepare('INSERT INTO thread_messages(id,thread_id,task_id,role,content,created_at) VALUES (?,?,?,?,?,?)')
    insert.run(randomUUID(), input.threadId, null, 'system', `${ASSISTANT_CHAT_PREFIX}${JSON.stringify({ type: 'thread' })}`, createdAt)
    messages.forEach((message, index) => {
      const role = message.role === 'user' || message.role === 'tool' ? message.role : 'assistant'
      insert.run(randomUUID(), input.threadId, null, role, `${ASSISTANT_CHAT_PREFIX}${JSON.stringify({
        type: 'message',
        id: String(message.id || randomUUID()),
        role,
        text: String(message.text || ''),
        ...(Array.isArray(message.images) && message.images.length ? { images: message.images.slice(0, 20) } : {}),
      })}`, createdAt + index + 1)
    })
  })()
  return ccsDb.prepare('SELECT * FROM threads WHERE id=?').get(input.threadId)
}

export function deleteAssistantConversation(projectId: string, userId: string, threadId: string) {
  requireProjectAccess(projectId, userId, true)
  const thread = ccsDb.prepare('SELECT id FROM threads WHERE id=? AND project_id=? AND created_by=? AND visibility=?').get(threadId, projectId, userId, 'private') as { id: string } | undefined
  if (!thread) return false
  ccsDb.prepare('DELETE FROM threads WHERE id=?').run(threadId)
  return true
}

/** 旧浏览器任务仅作为不可执行历史导入；localStorage 由前端保留。 */
export function importLegacyTask(projectId: string, createdBy: string, input: LegacyTaskInput) {
  requireProjectAccess(projectId, createdBy, true)
  const sourceId = String(input.sourceId || '').trim()
  if (!sourceId) throw new Error('旧任务缺少来源 ID')
  const existing = ccsDb.prepare('SELECT * FROM tasks WHERE created_by=? AND legacy_source_id=?').get(createdBy, sourceId) as TaskRow | undefined
  if (existing) return hydrateTask(existing)
  const messages = Array.isArray(input.messages) ? input.messages.filter((item) => item?.text) : []
  const instruction = String(input.instruction || messages.find((item) => item.role === 'user')?.text || input.title || '历史任务')
  const title = String(input.title || titleFor(instruction)).slice(0, 80)
  const sourceStatus = String(input.status || '')
  const status: TaskStatus = sourceStatus === 'done' ? 'completed' : sourceStatus === 'error' ? 'failed' : 'interrupted'
  const ts = Number(input.createdAt) > 0 ? Number(input.createdAt) : now()
  const id = randomUUID(); const thread = createThread(projectId, title, createdBy)
  writeTransaction(() => {
    ccsDb.prepare(`INSERT INTO tasks(id,project_id,thread_id,title,instruction,status,result,error_code,error_message,resume_safe,created_by,created_at,updated_at,completed_at,legacy_source_id)
      VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)`).run(
      id, projectId, thread.id, title, instruction, status,
      status === 'completed' ? messages.filter((item) => item.role === 'assistant').at(-1)?.text || '历史任务已完成' : null,
      status === 'failed' ? 'legacy_error' : status === 'interrupted' ? 'legacy_interrupted' : null,
      status === 'failed' ? messages.at(-1)?.text || '历史任务失败' : status === 'interrupted' ? '页面刷新前任务已中断，仅作为历史导入' : null,
      createdBy, ts, ts, status === 'completed' || status === 'failed' ? ts : null, sourceId,
    )
    ccsDb.prepare('INSERT INTO task_plans(id,task_id,goal,assumptions,acceptance,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), id, instruction, '[]', '[]', ts, ts)
    const insertMessage = ccsDb.prepare('INSERT INTO thread_messages(id,thread_id,task_id,role,content,created_at) VALUES (?,?,?,?,?,?)')
    messages.forEach((message, index) => insertMessage.run(randomUUID(), thread.id, id, message.role || 'assistant', String(message.text), ts + index))
    appendTaskEvent(id, 'task.imported', '已从浏览器历史只读导入', { sourceStatus })
  })
  return getTask(id)!
}

export function appendTaskEvent(taskId: string, type: string, message: string, data?: unknown) {
  return writeTransaction(() => {
    const result = ccsDb.prepare(`INSERT INTO task_events(task_id,sequence,type,message,data_json,created_at)
      SELECT ?,COALESCE(MAX(sequence),0)+1,?,?,?,? FROM task_events WHERE task_id=?`)
      .run(taskId, type, message, data === undefined ? null : json(data), now(), taskId)
    return Number(result.lastInsertRowid)
  })
}

export function addCheckpoint(taskId: string, stepId: string | null, state: unknown) {
  const iteration = (ccsDb.prepare('SELECT COALESCE(MAX(iteration),0)+1 AS value FROM task_checkpoints WHERE task_id=?').get(taskId) as { value: number }).value
  ccsDb.prepare(`INSERT INTO task_checkpoints(id,task_id,step_id,iteration,plan_version,state_json,context_summary,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), taskId, stepId, iteration, 1, json(state), JSON.stringify(state).slice(0, 500), now())
}

export function getTask(id: string) {
  const task = ccsDb.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
  return task ? hydrateTask(task) : undefined
}

function hydrateTask(task: TaskRow): TaskView {
  const plan = ccsDb.prepare('SELECT * FROM task_plans WHERE task_id = ?').get(task.id) as PlanRow | undefined
  const steps = ccsDb.prepare('SELECT * FROM task_steps WHERE task_id = ? ORDER BY ordinal').all(task.id) as TaskStepRow[]
  const events = ccsDb.prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY sequence').all(task.id) as TaskEventRow[]
  const checkpoints = ccsDb.prepare('SELECT * FROM task_checkpoints WHERE task_id = ? ORDER BY iteration DESC').all(task.id) as CheckpointRow[]
  const deliverables = ccsDb.prepare('SELECT * FROM deliverables WHERE task_id = ? ORDER BY created_at').all(task.id) as DeliverableRow[]
  const observations = ccsDb.prepare('SELECT * FROM task_observations WHERE task_id = ? ORDER BY created_at').all(task.id) as ObservationRow[]
  return { ...task, plan: plan || null, steps, events, checkpoints, deliverables, observations }
}

export function listTaskEvents(taskId: string, afterSequence = 0) {
  return ccsDb.prepare('SELECT * FROM task_events WHERE task_id=? AND sequence>? ORDER BY sequence')
    .all(taskId, Math.max(0, afterSequence)) as TaskEventRow[]
}

export function listTasks(userId: string, projectId?: string) {
  const rows = projectId
    ? ccsDb.prepare(`SELECT t.* FROM tasks t JOIN project_members m ON m.project_id=t.project_id
      WHERE t.project_id=? AND m.user_id=? ORDER BY t.created_at DESC`).all(projectId, userId) as TaskRow[]
    : ccsDb.prepare(`SELECT t.* FROM tasks t JOIN project_members m ON m.project_id=t.project_id
      WHERE m.user_id=? ORDER BY t.created_at DESC`).all(userId) as TaskRow[]
  return rows.map(hydrateTask)
}

export function projectHistory(projectId: string, userId: string) {
  requireProjectAccess(projectId, userId)
  // 私人对话只有创建者可见；project 可见性对全部项目成员开放（计划 11）
  const threads = ccsDb.prepare(`SELECT * FROM threads WHERE project_id=?
    AND (visibility!='private' OR created_by IS NULL OR created_by=?) ORDER BY updated_at DESC`).all(projectId, userId) as { id: string }[]
  const visibleThreadIds = new Set(threads.map((t) => t.id))
  const messages = (ccsDb.prepare(`SELECT m.* FROM thread_messages m JOIN threads t ON t.id=m.thread_id
    WHERE t.project_id=? ORDER BY m.created_at`).all(projectId) as ThreadMessageRow[])
    .filter((m) => visibleThreadIds.has(m.thread_id))
  const tasks = listTasks(userId, projectId).filter((t) => visibleThreadIds.has(t.thread_id))
  return { project: getProject(projectId), threads, messages, tasks }
}

/** 给同一对话的后续模型调用提供上下文；同时校验对话归属与可见性。 */
export function threadMessages(projectId: string, userId: string, threadId: string) {
  requireProjectAccess(projectId, userId)
  const thread = ccsDb.prepare(`SELECT id FROM threads WHERE id=? AND project_id=?
    AND (visibility!='private' OR created_by IS NULL OR created_by=?)`).get(threadId, projectId, userId) as { id: string } | undefined
  if (!thread) throw new Error('对话不存在或无权访问')
  return ccsDb.prepare(`SELECT role,content FROM thread_messages WHERE thread_id=?
    ORDER BY created_at DESC LIMIT 30`).all(threadId).reverse() as Array<{ role: string; content: string }>
}

export function updateTaskStatus(id: string, status: TaskStatus, extras: Record<string, unknown> = {}) {
  const allowed = new Set(['worker_id', 'lease_until', 'heartbeat_at', 'current_step_id', 'result', 'error_code', 'error_message', 'started_at', 'completed_at', 'waiting_question'])
  const pairs = Object.entries(extras).filter(([key]) => allowed.has(key))
  const sets = ['status = @status', 'updated_at = @updated_at', ...pairs.map(([key]) => `${key} = @${key}`)]
  ccsDb.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run({ id, status, updated_at: now(), ...Object.fromEntries(pairs) })
}

// ── M4 ReAct 支持 ────────────────────────────────────────────────────

export type TaskBudget = { maxModelCalls: number | null; maxToolCalls: number | null }
/** 思考模式不设模型/工具调用次数上限；仍持续记录调用次数，供状态与审计使用。 */
export const DEFAULT_BUDGET: TaskBudget = { maxModelCalls: null, maxToolCalls: null }

/** 记录一次模型/工具调用；超预算返回 false（调用方应停止并失败）。 */
export function consumeBudget(taskId: string, kind: 'model' | 'tool', budget: TaskBudget = DEFAULT_BUDGET) {
  const column = kind === 'model' ? 'model_calls' : 'tool_calls'
  const limit = kind === 'model' ? budget.maxModelCalls : budget.maxToolCalls
  if (limit === null) {
    const result = ccsDb.prepare(`UPDATE tasks SET ${column}=${column}+1, updated_at=? WHERE id=?`).run(now(), taskId)
    return result.changes > 0
  }
  const row = ccsDb.prepare(`UPDATE tasks SET ${column}=${column}+1, updated_at=? WHERE id=? AND ${column}<? RETURNING ${column} AS n`)
    .get(now(), taskId, limit) as { n: number } | undefined
  return row !== undefined
}

/** ReAct 动态追加一个步骤（计划步骤在执行时才知道工具与参数）。 */
export function appendDynamicStep(taskId: string, title: string, toolName: string, args: unknown) {
  const ordinal = (ccsDb.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS n FROM task_steps WHERE task_id=?').get(taskId) as { n: number }).n
  const id = randomUUID()
  ccsDb.prepare(`INSERT INTO task_steps(id,task_id,ordinal,title,tool_name,input_json,status,operation_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, taskId, ordinal, title.slice(0, 120), toolName, json(args), 'queued', `${taskId}:${ordinal}`, now())
  return { id, ordinal, operation_id: `${taskId}:${ordinal}` }
}

/** react 任务开跑前清理中断遗留的 queued/running 步骤（react 不消费队列）。 */
export function sealStaleReactSteps(taskId: string) {
  ccsDb.prepare(`UPDATE task_steps SET status='failed',result_summary='任务中断，该步骤未完成',completed_at=?
    WHERE task_id=? AND status IN ('queued','running')`).run(now(), taskId)
}

/** react 任务的计划步骤（Planner 产出，只有标题与期望产出，无具体工具）。 */
export function savePlan(taskId: string, plan: { goal: string; assumptions: string[]; acceptance: string[] }) {
  return writeTransaction(() => {
    ccsDb.prepare('UPDATE task_plans SET goal=?,assumptions=?,acceptance=?,updated_at=? WHERE task_id=?')
      .run(plan.goal.slice(0, 2000), json(plan.assumptions), json(plan.acceptance), now(), taskId)
    appendTaskEvent(taskId, 'task.planned', plan.goal.slice(0, 200), { assumptions: plan.assumptions, acceptance: plan.acceptance })
  })
}

/** 任务进入 waiting_user 并记录问题（预算内问不清楚 / 需要用户决策）。 */
export function waitForUser(taskId: string, workerId: string, question: string) {
  return writeTransaction(() => {
    const changed = ccsDb.prepare(`UPDATE tasks SET status='waiting_user',waiting_question=?,worker_id=NULL,lease_until=NULL,heartbeat_at=NULL,updated_at=?
      WHERE id=? AND worker_id=? AND status IN ('running','verifying')`).run(question.slice(0, 1000), now(), taskId, workerId).changes > 0
    if (changed) appendTaskEvent(taskId, 'task.waiting_user', question.slice(0, 500))
    return changed
  })
}

/** 围栏化任务失败：只有仍持有任务的 Worker 能标记失败（no_llm_provider 转 waiting_user）。 */
export function failTaskFenced(taskId: string, workerId: string, code: string, message: string) {
  return writeTransaction(() => {
    const ts = now()
    const toWaiting = code === 'no_llm_provider'
    const changed = (toWaiting
      ? ccsDb.prepare(`UPDATE tasks SET status='waiting_user',waiting_question=?,error_code=?,error_message=?,worker_id=NULL,lease_until=NULL,heartbeat_at=NULL,updated_at=?
          WHERE id=? AND worker_id=? AND status IN ('running','verifying','planning')`).run(message.slice(0, 1000), code, message.slice(0, 1000), ts, taskId, workerId)
      : ccsDb.prepare(`UPDATE tasks SET status='failed',error_code=?,error_message=?,completed_at=?,worker_id=NULL,lease_until=NULL,heartbeat_at=NULL,updated_at=?
          WHERE id=? AND worker_id=? AND status IN ('running','verifying','planning')`).run(code, message.slice(0, 1000), ts, ts, taskId, workerId)
    ).changes > 0
    if (changed) appendTaskEvent(taskId, toWaiting ? 'task.waiting_user' : 'task.failed', message.slice(0, 500))
    return changed
  })
}

/** 用户回答 waiting_user 的问题：写入对话与事件，任务重新排队。 */
export function answerTask(taskId: string, userId: string, answer: string) {
  return writeTransaction(() => {
    const task = ccsDb.prepare('SELECT status,thread_id,project_id FROM tasks WHERE id=?').get(taskId) as { status: TaskStatus; thread_id: string; project_id: string } | undefined
    if (!task) throw new Error('任务不存在')
    requireProjectAccess(task.project_id, userId, true)
    if (task.status !== 'waiting_user') throw new Error('该任务当前不在等待回答')
    ccsDb.prepare('INSERT INTO thread_messages(id,thread_id,task_id,role,content,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), task.thread_id, taskId, 'user', answer, now())
    updateTaskStatus(taskId, 'queued', { waiting_question: null, worker_id: null, lease_until: null })
    appendTaskEvent(taskId, 'task.answered', answer.slice(0, 500))
  })
}

/** 给已有 React 任务追加要求，并从当前上下文继续执行。 */
export function continueTask(taskId: string, userId: string, message: string) {
  return writeTransaction(() => {
    const task = ccsDb.prepare('SELECT status,mode,thread_id,project_id FROM tasks WHERE id=?').get(taskId) as
      { status: TaskStatus; mode: string; thread_id: string; project_id: string } | undefined
    if (!task) throw new Error('任务不存在')
    requireProjectAccess(task.project_id, userId, true)
    if (task.mode !== 'react') throw new Error('此任务使用固定步骤，不能追加要求')
    if (['queued', 'planning', 'running', 'verifying'].includes(task.status)) throw new Error('任务正在执行，请完成或暂停后再追加要求')
    ccsDb.prepare('INSERT INTO thread_messages(id,thread_id,task_id,role,content,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), task.thread_id, taskId, 'user', message, now())
    ccsDb.prepare(`UPDATE tasks SET status='queued',waiting_question=NULL,error_code=NULL,error_message=NULL,result=NULL,
      completed_at=NULL,worker_id=NULL,lease_until=NULL,heartbeat_at=NULL,model_calls=0,tool_calls=0,updated_at=? WHERE id=?`)
      .run(now(), taskId)
    appendTaskEvent(taskId, 'task.answered', message.slice(0, 500))
    appendTaskEvent(taskId, 'task.continued', '用户追加要求，任务重新进入队列')
    return getTask(taskId)
  })
}

/** 刷新长期任务的权威目标/规范，不把大段系统上下文伪装成用户聊天消息。 */
export function refreshTaskInstruction(taskId: string, userId: string, instruction: string) {
  return writeTransaction(() => {
    const task = ccsDb.prepare('SELECT project_id FROM tasks WHERE id=?').get(taskId) as { project_id: string } | undefined
    if (!task) throw new Error('任务不存在')
    requireProjectAccess(task.project_id, userId, true)
    const value = String(instruction || '').trim()
    if (!value) throw new Error('任务指令不能为空')
    const ts = now()
    ccsDb.prepare('UPDATE tasks SET instruction=?,updated_at=? WHERE id=?').run(value, ts, taskId)
    ccsDb.prepare('UPDATE task_plans SET goal=?,updated_at=? WHERE task_id=?').run(value, ts, taskId)
    appendTaskEvent(taskId, 'task.instruction_refreshed', '任务规范与验收目标已刷新')
    return getTask(taskId)
  })
}

// ── M9 观测：任务级 Trace 与跨任务统计 ────────────────────────────────

export function taskTrace(taskId: string, userId: string) {
  const task = getTask(taskId)
  if (!task) throw new Error('任务不存在')
  requireProjectAccess(task.project_id, userId)
  const durationMs = task.completed_at && task.started_at ? task.completed_at - task.started_at : null
  const stepDurations = task.steps
    .filter((s) => s.status === 'completed')
    .map((s) => {
      const row = s as unknown as { started_at?: number | null; completed_at?: number | null; title: string; tool_name: string }
      return { title: row.title, tool: row.tool_name, ms: row.completed_at && row.started_at ? row.completed_at - row.started_at : null }
    })
  return {
    id: task.id, title: task.title, status: task.status, mode: task.mode,
    modelCalls: task.model_calls, toolCalls: task.tool_calls,
    durationMs, errorCode: task.error_code, errorMessage: task.error_message,
    steps: stepDurations,
    stepCounts: {
      completed: task.steps.filter((s) => s.status === 'completed').length,
      failed: task.steps.filter((s) => s.status === 'failed').length,
      total: task.steps.length,
    },
    checkpoints: task.checkpoints.length,
    deliverables: task.deliverables.length,
    eventCount: task.events.length,
  }
}

/** 跨任务统计（本人可见项目范围）：状态分布、失败原因、模型/工具用量。 */
export function taskStats(userId: string, sinceMs = 0) {
  const scope = `FROM tasks t JOIN project_members m ON m.project_id=t.project_id AND m.user_id=? WHERE t.created_at>=?`
  const byStatus = ccsDb.prepare(`SELECT t.status AS key, COUNT(*) AS n ${scope} GROUP BY t.status`).all(userId, sinceMs) as { key: string; n: number }[]
  const byError = ccsDb.prepare(`SELECT t.error_code AS key, COUNT(*) AS n ${scope} AND t.error_code IS NOT NULL GROUP BY t.error_code ORDER BY n DESC LIMIT 10`).all(userId, sinceMs) as { key: string; n: number }[]
  const byMode = ccsDb.prepare(`SELECT t.mode AS key, COUNT(*) AS n ${scope} GROUP BY t.mode`).all(userId, sinceMs) as { key: string; n: number }[]
  const usage = ccsDb.prepare(`SELECT COALESCE(SUM(t.model_calls),0) AS modelCalls, COALESCE(SUM(t.tool_calls),0) AS toolCalls,
    COUNT(*) AS tasks, COALESCE(AVG(CASE WHEN t.completed_at IS NOT NULL AND t.started_at IS NOT NULL THEN t.completed_at-t.started_at END),0) AS avgDurationMs
    ${scope}`).get(userId, sinceMs) as { modelCalls: number; toolCalls: number; tasks: number; avgDurationMs: number }
  const recentFailed = ccsDb.prepare(`SELECT t.id,t.title,t.error_code,t.error_message,t.updated_at ${scope}
    AND t.status='failed' ORDER BY t.updated_at DESC LIMIT 8`).all(userId, sinceMs) as
    { id: string; title: string; error_code: string | null; error_message: string | null; updated_at: number }[]
  return { byStatus, byError, byMode, usage, recentFailed }
}

/** 计划第 22 节：thread/项目内查找可恢复任务（“继续”控制命令用）。 */
export function findResumableTasks(userId: string, options: { threadId?: string; projectId?: string }) {
  const base = `SELECT t.* FROM tasks t JOIN project_members m ON m.project_id=t.project_id AND m.user_id=?
    WHERE t.resume_safe=1 AND t.status IN ('interrupted','paused','waiting_user','failed')`
  const rows = options.threadId
    ? ccsDb.prepare(`${base} AND t.thread_id=? ORDER BY t.updated_at DESC`).all(userId, options.threadId) as TaskRow[]
    : options.projectId
      ? ccsDb.prepare(`${base} AND t.project_id=? ORDER BY t.updated_at DESC`).all(userId, options.projectId) as TaskRow[]
      : ccsDb.prepare(`${base} ORDER BY t.updated_at DESC`).all(userId) as TaskRow[]
  return rows.map(hydrateTask)
}

function requeueRunningStep(id: string) {
  ccsDb.prepare("UPDATE task_steps SET status='queued', started_at=NULL WHERE task_id=? AND status='running'").run(id)
}
export function pauseTask(id: string) {
  return writeTransaction(() => {
    const task = ccsDb.prepare('SELECT status FROM tasks WHERE id=?').get(id) as { status: TaskStatus } | undefined
    if (!task) throw new Error('任务不存在')
    if (!['queued', 'planning', 'running', 'verifying'].includes(task.status)) throw new Error('该任务当前不能暂停')
    requeueRunningStep(id)
    updateTaskStatus(id, 'paused', { worker_id: null, lease_until: null, heartbeat_at: null })
    appendTaskEvent(id, 'task.paused', '任务已暂停')
  })
}
export function cancelTask(id: string) {
  return writeTransaction(() => {
    const task = ccsDb.prepare('SELECT status FROM tasks WHERE id=?').get(id) as { status: TaskStatus } | undefined
    if (!task) throw new Error('任务不存在')
    if (['completed', 'cancelled'].includes(task.status)) throw new Error('该任务当前不能取消')
    requeueRunningStep(id)
    updateTaskStatus(id, 'cancelled', { worker_id: null, completed_at: now(), lease_until: null, heartbeat_at: null })
    appendTaskEvent(id, 'task.cancelled', '任务已取消')
  })
}
export function deleteTask(id: string) {
  return writeTransaction(() => {
    const task = ccsDb.prepare('SELECT id,status FROM tasks WHERE id=?').get(id) as { id: string; status: TaskStatus } | undefined
    if (!task) throw new Error('任务不存在')
    requeueRunningStep(id)
    ccsDb.prepare('DELETE FROM task_observations WHERE task_id=?').run(id)
    ccsDb.prepare('DELETE FROM task_checkpoints WHERE task_id=?').run(id)
    ccsDb.prepare('DELETE FROM task_events WHERE task_id=?').run(id)
    ccsDb.prepare('DELETE FROM task_steps WHERE task_id=?').run(id)
    ccsDb.prepare('DELETE FROM task_plans WHERE task_id=?').run(id)
    ccsDb.prepare('DELETE FROM deliverables WHERE task_id=?').run(id)
    ccsDb.prepare('DELETE FROM thread_messages WHERE task_id=?').run(id)
    ccsDb.prepare('DELETE FROM tasks WHERE id=?').run(id)
  })
}
export function resumeTask(id: string) {
  return writeTransaction(() => {
    const task = ccsDb.prepare('SELECT status,error_code,resume_safe,mode FROM tasks WHERE id = ?').get(id) as { status: TaskStatus; error_code: string | null; resume_safe: number; mode: string } | undefined
    if (!task) throw new Error('任务不存在')
    if (!task.resume_safe) throw new Error('该历史任务不可恢复，请创建新任务继续')
    if (!['paused', 'interrupted', 'failed'].includes(task.status)) throw new Error('该任务当前不能恢复')
    if (task.mode === 'actions') {
      // actions 模式：失败步骤重新排队后按原计划重跑
      if (task.status === 'failed' && task.error_code !== 'verification_failed') {
        ccsDb.prepare("UPDATE task_steps SET status='queued',output_json=NULL,started_at=NULL,completed_at=NULL WHERE task_id=? AND status='failed'").run(id)
      }
      const steps = ccsDb.prepare("SELECT COUNT(*) AS count FROM task_steps WHERE task_id=? AND status='queued'").get(id) as { count: number }
      if (!steps.count && task.error_code !== 'verification_failed') throw new Error('任务没有可恢复的步骤')
    } else {
      // react 模式：模型接着已完成的工作续跑；中断遗留步骤由 sealStaleReactSteps 清理
      sealStaleReactSteps(id)
    }
    updateTaskStatus(id, 'queued', { worker_id: null, lease_until: null, heartbeat_at: null, completed_at: null, error_code: null, error_message: null })
    appendTaskEvent(id, 'task.resumed', '任务已重新进入队列')
  })
}

export function canWorkerRunTask(taskId: string) {
  return Boolean(ccsDb.prepare(`SELECT 1 FROM tasks t JOIN project_members m ON m.project_id=t.project_id AND m.user_id=t.created_by
    WHERE t.id=? AND m.can_create_tasks=1`).get(taskId))
}

export function registerWorker(id: string, pid: number, staleAfterMs = 30_000) {
  const ts = now()
  writeTransaction(() => {
    // 被强杀的旧 Worker 不会写 stopped_at；新 Worker 启动时把心跳过期的记录标记为 stopped。
    ccsDb.prepare("UPDATE worker_instances SET status='stopped',stopped_at=? WHERE status='running' AND id<>? AND heartbeat_at<?")
      .run(ts, id, ts - staleAfterMs)
    ccsDb.prepare(`INSERT INTO worker_instances(id,pid,status,started_at,heartbeat_at,stopped_at) VALUES (?,?,'running',?,?,NULL)
      ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,status='running',started_at=excluded.started_at,heartbeat_at=excluded.heartbeat_at,stopped_at=NULL`)
      .run(id, pid, ts, ts)
  })
}
export function heartbeatWorker(id: string) {
  return ccsDb.prepare("UPDATE worker_instances SET heartbeat_at=? WHERE id=? AND status='running'").run(now(), id).changes > 0
}
export function stopWorker(id: string) {
  const ts = now()
  ccsDb.prepare("UPDATE worker_instances SET status='stopped',heartbeat_at=?,stopped_at=? WHERE id=?").run(ts, ts, id)
}
export function workerHealth(staleAfterMs = 5_000) {
  const worker = ccsDb.prepare('SELECT * FROM worker_instances ORDER BY heartbeat_at DESC LIMIT 1').get() as
    { id: string; pid: number; status: string; started_at: number; heartbeat_at: number; stopped_at: number | null } | undefined
  return { available: Boolean(worker && worker.status === 'running' && worker.heartbeat_at >= now() - staleAfterMs), worker: worker || null }
}

export function recoverExpiredTasks() {
  const ts = now()
  const rows = ccsDb.prepare(`SELECT id FROM tasks WHERE status IN ('planning','running','verifying')
    AND lease_until IS NOT NULL AND lease_until < ?`).all(ts) as { id: string }[]
  for (const row of rows) {
    writeTransaction(() => {
      ccsDb.prepare("UPDATE task_steps SET status='queued', started_at=NULL WHERE task_id=? AND status='running'").run(row.id)
      updateTaskStatus(row.id, 'interrupted', { worker_id: null, lease_until: null, heartbeat_at: null })
      appendTaskEvent(row.id, 'task.interrupted', 'Worker 租约已过期，任务可从检查点恢复')
    })
  }
  return rows.length
}

export function claimNextTask(workerId: string, leaseMs: number) {
  return ccsDb.transaction(() => {
    recoverExpiredTasks()
    const task = ccsDb.prepare(`SELECT * FROM tasks WHERE (status='queued' OR (status='interrupted' AND resume_safe=1))
      ORDER BY created_at LIMIT 1`).get() as TaskRow | undefined
    if (!task) return undefined
    const ts = now()
    const change = ccsDb.prepare(`UPDATE tasks SET status='running',worker_id=?,lease_until=?,heartbeat_at=?,started_at=COALESCE(started_at,?),updated_at=?
      WHERE id=? AND (status='queued' OR (status='interrupted' AND resume_safe=1))`).run(workerId, ts + leaseMs, ts, ts, ts, task.id)
    if (!change.changes) return undefined
    appendTaskEvent(task.id, 'task.claimed', `Worker ${workerId} 已领取任务`)
    return getTask(task.id)
  })()
}

export function heartbeatTask(taskId: string, workerId: string, leaseMs: number) {
  const ts = now()
  return ccsDb.prepare("UPDATE tasks SET heartbeat_at=?, lease_until=?, updated_at=? WHERE id=? AND worker_id=? AND status='running'")
    .run(ts, ts + leaseMs, ts, taskId, workerId).changes > 0
}

export function taskIsRunning(taskId: string, workerId: string) {
  return Boolean(ccsDb.prepare("SELECT 1 FROM tasks WHERE id=? AND worker_id=? AND status='running'").get(taskId, workerId))
}

export function enterVerification(taskId: string, workerId: string) {
  return writeTransaction(() => {
    const changed = ccsDb.prepare("UPDATE tasks SET status='verifying',updated_at=? WHERE id=? AND worker_id=? AND status='running'")
      .run(now(), taskId, workerId).changes > 0
    if (changed) appendTaskEvent(taskId, 'task.verifying', '正在验证步骤和交付物')
    return changed
  })
}
export function completeVerifiedTask(taskId: string, workerId: string, result: string) {
  return writeTransaction(() => {
    const ts = now()
    const changed = ccsDb.prepare(`UPDATE tasks SET status='completed',result=?,completed_at=?,current_step_id=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND worker_id=? AND status='verifying'`).run(result, ts, ts, taskId, workerId).changes > 0
    if (changed) {
      ccsDb.prepare("UPDATE deliverables SET verification_status='verified',updated_at=? WHERE task_id=?").run(ts, taskId)
      appendTaskEvent(taskId, 'task.completed', result)
    }
    return changed
  })
}
export function failVerification(taskId: string, workerId: string, message: string) {
  return writeTransaction(() => {
    const ts = now()
    const changed = ccsDb.prepare(`UPDATE tasks SET status='failed',error_code='verification_failed',error_message=?,completed_at=?,lease_until=NULL,updated_at=?
      WHERE id=? AND worker_id=? AND status='verifying'`).run(message, ts, ts, taskId, workerId).changes > 0
    if (changed) appendTaskEvent(taskId, 'task.failed', message)
    return changed
  })
}

export function nextQueuedStep(taskId: string) {
  return ccsDb.prepare("SELECT * FROM task_steps WHERE task_id=? AND status='queued' ORDER BY ordinal LIMIT 1").get(taskId) as
    { id: string; task_id: string; ordinal: number; title: string; tool_name: FileAction['tool']; input_json: string; operation_id: string } | undefined
}

export function startStep(taskId: string, stepId: string, workerId: string) {
  const ts = now()
  // 双重围栏：步骤必须排队中，且任务仍由本 Worker 持有（防止租约过期后旧 Worker 继续执行）
  const changed = ccsDb.prepare(`UPDATE task_steps SET status='running', started_at=? WHERE id=? AND task_id=? AND status='queued'
    AND EXISTS (SELECT 1 FROM tasks WHERE id=? AND worker_id=? AND status='running')`).run(ts, stepId, taskId, taskId, workerId).changes > 0
  if (changed) ccsDb.prepare('UPDATE tasks SET current_step_id=?,updated_at=? WHERE id=? AND status=?').run(stepId, ts, taskId, 'running')
  return changed
}
export function requeueStep(taskId: string, stepId: string) {
  ccsDb.prepare("UPDATE task_steps SET status='queued', started_at=NULL WHERE id=? AND task_id=? AND status='running'").run(stepId, taskId)
}

export function completeStep(taskId: string, stepId: string, workerId: string, output: unknown, deliverable?: { projectId: string; nodeId: string; name: string }) {
  return writeTransaction(() => {
    const ts = now()
    const step = ccsDb.prepare('SELECT operation_id,tool_name FROM task_steps WHERE id=? AND task_id=?').get(stepId, taskId) as { operation_id: string; tool_name: string } | undefined
    const changed = ccsDb.prepare(`UPDATE task_steps SET status='completed', output_json=?, result_summary=?, completed_at=? WHERE id=? AND task_id=? AND status='running'
      AND EXISTS (SELECT 1 FROM tasks WHERE id=? AND worker_id=? AND status='running')`)
      .run(json(output), String((output as { message?: unknown })?.message || '').slice(0, 500), ts, stepId, taskId, taskId, workerId).changes > 0
    if (!changed) return false
    if (step) upsertObservation(taskId, stepId, step.operation_id, step.tool_name, 'completed', String((output as { message?: unknown })?.message || '步骤已完成'), output)
    if (deliverable) addDeliverable(taskId, deliverable.projectId, deliverable.nodeId, deliverable.name)
    addCheckpoint(taskId, stepId, { completedStepId: stepId, output })
    appendTaskEvent(taskId, 'step.completed', String((output as { message?: unknown })?.message || '步骤已完成'), output)
    return true
  })
}

export function failStep(taskId: string, stepId: string, workerId: string, message: string) {
  return writeTransaction(() => {
    const step = ccsDb.prepare('SELECT operation_id,tool_name FROM task_steps WHERE id=? AND task_id=?').get(stepId, taskId) as { operation_id: string; tool_name: string } | undefined
    const changed = ccsDb.prepare(`UPDATE task_steps SET status='failed', output_json=?,result_summary=?, completed_at=? WHERE id=? AND task_id=? AND status='running'
      AND EXISTS (SELECT 1 FROM tasks WHERE id=? AND worker_id=? AND status='running')`)
      .run(json({ error: message }), message.slice(0, 500), now(), stepId, taskId, taskId, workerId).changes > 0
    if (changed) {
      if (step) upsertObservation(taskId, stepId, step.operation_id, step.tool_name, 'failed', message, { error: message })
      appendTaskEvent(taskId, 'step.failed', message, { stepId })
    }
    return changed
  })
}

function upsertObservation(taskId: string, stepId: string, operationId: string, toolName: string, status: string, summary: string, data: unknown) {
  ccsDb.prepare(`INSERT INTO task_observations(id,task_id,step_id,operation_id,tool_name,status,summary,data_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET
      status=excluded.status,summary=excluded.summary,data_json=excluded.data_json,created_at=excluded.created_at`)
    .run(randomUUID(), taskId, stepId, operationId, toolName, status, summary.slice(0, 500), json(data), now())
}

export function findOperation(operationId: string) {
  return ccsDb.prepare('SELECT * FROM tool_operations WHERE operation_id=?').get(operationId) as { status: string; result_json: string | null } | undefined
}
export function beginOperation(operationId: string, taskId: string, toolName: string) {
  const step = ccsDb.prepare('SELECT id,input_json FROM task_steps WHERE operation_id=? AND task_id=?').get(operationId, taskId) as { id: string; input_json: string } | undefined
  ccsDb.prepare(`INSERT OR IGNORE INTO tool_operations(operation_id,task_id,step_id,tool_name,status,input_hash,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(operationId, taskId, step?.id || null, toolName, 'running', step ? hashInput(step.input_json) : null, now())
}
export function finishOperation(operationId: string, result: unknown) {
  ccsDb.prepare("UPDATE tool_operations SET status='completed',result_json=?,completed_at=? WHERE operation_id=?").run(json(result), now(), operationId)
}
export function addDeliverable(taskId: string, projectId: string, nodeId: string, name: string) {
  const ts = now()
  ccsDb.prepare(`INSERT OR IGNORE INTO deliverables(id,task_id,project_id,node_id,name,verification_status,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',?,?)`).run(randomUUID(), taskId, projectId, nodeId, name, ts, ts)
}

/** M4 完成门禁：所有计划步骤完成，且写入类步骤的交付文件仍然存在。 */
const WRITE_TOOLS = new Set(['file.create', 'file.write', 'fs_create', 'fs_write', 'fs_append', 'fs_edit'])
export function verifyTask(taskId: string) {
  const task = getTask(taskId)
  if (!task) return { ok: false, message: '任务不存在' }
  const project = getProject(task.project_id)
  if (!project) return { ok: false, message: '项目不存在' }
  if (!task.steps.length) return { ok: false, message: '任务没有可验证的步骤' }
  // actions 模式：全部步骤必须完成。react 模式：模型可以在失败后换参数重试，
  // 失败/被中断遗留的步骤不算未完成，只要没有仍在运行的步骤且有实际完成的工作。
  if (task.mode === 'actions') {
    const unfinished = task.steps.find((step) => step.status !== 'completed')
    if (unfinished) return { ok: false, message: `步骤未完成：${unfinished.title}` }
  } else {
    const running = task.steps.find((step) => step.status === 'running')
    if (running) return { ok: false, message: `步骤仍在执行：${running.title}` }
    if (!task.steps.some((step) => step.status === 'completed')) return { ok: false, message: '任务没有完成任何实际步骤' }
  }
  // 写入类步骤的产物必须仍然存在于项目内（react + actions 通用）
  for (const step of task.steps) {
    if (!WRITE_TOOLS.has(step.tool_name)) continue
    try {
      const output = JSON.parse(step.output_json || '{}') as { nodeId?: string }
      if (!output.nodeId) continue
      const node = getNode(output.nodeId)
      if (!node || node.trashed || !isWithinRoot(project.root_node_id, node.id)) {
        return { ok: false, message: `交付物缺失或已被移出项目：${step.title}` }
      }
    } catch {
      return { ok: false, message: `步骤结果无效：${step.title}` }
    }
  }
  // actions 模式：内容必须与声明一致（最后一次写入为准）
  if (task.mode === 'actions') for (const [index, step] of task.steps.entries()) {
    if (!['file.create', 'file.write'].includes(step.tool_name)) continue
    try {
      const output = JSON.parse(step.output_json || '{}') as { nodeId?: string }
      const action = JSON.parse(step.input_json || '{}') as FileAction
      const node = output.nodeId ? getNode(output.nodeId) : null
      const resolved = action.path ? findByPath(project.root_node_id, action.path) : null
      if (!node || node.type !== 'file' || node.trashed || !isWithinRoot(project.root_node_id, node.id) || resolved?.id !== node.id) return { ok: false, message: `交付物缺失或无效：${step.title}` }
      const overwrittenLater = task.steps.slice(index + 1).some((later) => {
        if (!['file.create', 'file.write'].includes(later.tool_name)) return false
        try { return (JSON.parse(later.input_json || '{}') as FileAction).path === action.path } catch { return false }
      })
      if (action.content !== undefined && !overwrittenLater && node.content !== action.content) return { ok: false, message: `交付物内容不匹配：${step.title}` }
    } catch {
      return { ok: false, message: `步骤结果无效：${step.title}` }
    }
  }
  return { ok: true, message: '所有步骤和交付物验证通过' }
}

/** 任务完成/失败时把结果写回来源对话（项目视图的对话历史）。 */
export function postTaskMessage(taskId: string, role: 'assistant' | 'system', content: string) {
  const task = ccsDb.prepare('SELECT thread_id FROM tasks WHERE id=?').get(taskId) as { thread_id: string } | undefined
  if (!task) return
  ccsDb.prepare('INSERT INTO thread_messages(id,thread_id,task_id,role,content,created_at) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), task.thread_id, taskId, role, content.slice(0, 8000), now())
}

// ── M7 项目记忆：多对话共享的版本化事实（计划 8.2/8.3）─────────────

export type MemoryRow = {
  id: string; project_id: string; content: string; source_type: string; source_id: string | null
  version: number; replaces_id: string | null; status: string; created_by: string | null
  created_at: number; updated_at: number
}

export function listMemories(projectId: string, includeSuperseded = false) {
  return (includeSuperseded
    ? ccsDb.prepare('SELECT * FROM project_memories WHERE project_id=? ORDER BY updated_at DESC').all(projectId)
    : ccsDb.prepare("SELECT * FROM project_memories WHERE project_id=? AND status='active' ORDER BY updated_at DESC").all(projectId)) as MemoryRow[]
}

/** 新增记忆；replacesId 建立版本链（新决定取代旧决定，旧条目标记 superseded）。 */
export function addMemory(input: { projectId: string; content: string; sourceType?: 'user' | 'task' | 'assistant'; sourceId?: string; createdBy?: string; replacesId?: string }) {
  const content = input.content.trim().slice(0, 2000)
  if (!content) throw new Error('记忆内容不能为空')
  const id = randomUUID(); const ts = now()
  return writeTransaction(() => {
    let version = 1
    if (input.replacesId) {
      const old = ccsDb.prepare('SELECT project_id,version FROM project_memories WHERE id=?').get(input.replacesId) as { project_id: string; version: number } | undefined
      if (!old || old.project_id !== input.projectId) throw new Error('被取代的记忆不存在')
      version = old.version + 1
      ccsDb.prepare("UPDATE project_memories SET status='superseded',updated_at=? WHERE id=?").run(ts, input.replacesId)
    }
    ccsDb.prepare(`INSERT INTO project_memories(id,project_id,content,source_type,source_id,version,replaces_id,status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'active',?,?,?)`)
      .run(id, input.projectId, content, input.sourceType || 'user', input.sourceId || null, version, input.replacesId || null, input.createdBy || null, ts, ts)
    return ccsDb.prepare('SELECT * FROM project_memories WHERE id=?').get(id) as MemoryRow
  })
}

export function removeMemory(projectId: string, memoryId: string) {
  const changed = ccsDb.prepare("UPDATE project_memories SET status='deleted',updated_at=? WHERE id=? AND project_id=?")
    .run(now(), memoryId, projectId).changes > 0
  if (!changed) throw new Error('记忆不存在')
}

export function threadVisibility(threadId: string): 'private' | 'project' {
  const row = ccsDb.prepare('SELECT visibility FROM threads WHERE id=?').get(threadId) as { visibility: string } | undefined
  return row?.visibility === 'private' ? 'private' : 'project'
}
