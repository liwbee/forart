import Database from 'better-sqlite3'
import { dataPath } from '../dataPaths.ts'

export type AiProtocolTaskStatus = 'dry_run' | 'queued' | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled'

export type AiProtocolTaskRow = {
  id: string
  owner_id: string | null
  canvas_id: string | null
  provider_site_id: string | null
  base_url: string | null
  status: AiProtocolTaskStatus
  mode: 'dry-run' | 'execute'
  request_json: string
  plan_json: string
  plan_hash: string
  provider_protocol_id: string
  provider_protocol_version: number
  provider_protocol_hash: string
  model_protocol_id: string
  model_protocol_version: number
  model_protocol_hash: string
  profile_id: string
  intent: string
  remote_task_id: string | null
  result_json: string | null
  error_message: string | null
  workflow_state_json: string | null
  next_poll_at: number | null
  poll_attempt: number
  created_at: number
  updated_at: number
  started_at: number | null
  completed_at: number | null
}

export type AiProtocolTaskEventRow = {
  id: number
  task_id: string
  sequence: number
  type: string
  data_json: string
  created_at: number
}

const dbPath = process.env.DX_PROTOCOL_TASK_DB || dataPath('protocol-tasks.db')
export const aiProtocolTaskDb = new Database(dbPath)
aiProtocolTaskDb.pragma('busy_timeout = 30000')
aiProtocolTaskDb.pragma('journal_mode = WAL')
aiProtocolTaskDb.pragma('foreign_keys = ON')
aiProtocolTaskDb.exec(`
CREATE TABLE IF NOT EXISTS ai_protocol_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  canvas_id TEXT,
  provider_site_id TEXT,
  base_url TEXT,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  request_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  provider_protocol_id TEXT NOT NULL,
  provider_protocol_version INTEGER NOT NULL,
  provider_protocol_hash TEXT NOT NULL,
  model_protocol_id TEXT NOT NULL,
  model_protocol_version INTEGER NOT NULL,
  model_protocol_hash TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  remote_task_id TEXT,
  result_json TEXT,
  error_message TEXT,
  workflow_state_json TEXT,
  next_poll_at INTEGER,
  poll_attempt INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_protocol_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES ai_protocol_tasks(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(task_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_ai_protocol_tasks_status ON ai_protocol_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_protocol_events_task ON ai_protocol_task_events(task_id, sequence);
`)

const taskColumns = new Set((aiProtocolTaskDb.prepare('PRAGMA table_info(ai_protocol_tasks)').all() as Array<{ name: string }>).map((column) => column.name))
if (!taskColumns.has('owner_id')) aiProtocolTaskDb.exec('ALTER TABLE ai_protocol_tasks ADD COLUMN owner_id TEXT')
if (!taskColumns.has('canvas_id')) aiProtocolTaskDb.exec('ALTER TABLE ai_protocol_tasks ADD COLUMN canvas_id TEXT')
if (!taskColumns.has('provider_site_id')) aiProtocolTaskDb.exec('ALTER TABLE ai_protocol_tasks ADD COLUMN provider_site_id TEXT')
if (!taskColumns.has('base_url')) aiProtocolTaskDb.exec('ALTER TABLE ai_protocol_tasks ADD COLUMN base_url TEXT')
if (!taskColumns.has('workflow_state_json')) aiProtocolTaskDb.exec('ALTER TABLE ai_protocol_tasks ADD COLUMN workflow_state_json TEXT')
if (!taskColumns.has('next_poll_at')) aiProtocolTaskDb.exec('ALTER TABLE ai_protocol_tasks ADD COLUMN next_poll_at INTEGER')
if (!taskColumns.has('poll_attempt')) aiProtocolTaskDb.exec('ALTER TABLE ai_protocol_tasks ADD COLUMN poll_attempt INTEGER NOT NULL DEFAULT 0')
aiProtocolTaskDb.exec('CREATE INDEX IF NOT EXISTS idx_ai_protocol_tasks_owner ON ai_protocol_tasks(owner_id, created_at)')

export function createAiProtocolTask(value: Omit<AiProtocolTaskRow, 'owner_id' | 'canvas_id' | 'provider_site_id' | 'base_url' | 'remote_task_id' | 'result_json' | 'error_message' | 'workflow_state_json' | 'next_poll_at' | 'poll_attempt' | 'started_at' | 'completed_at'> & { owner_id?: string | null; canvas_id?: string | null; provider_site_id?: string | null; base_url?: string | null }) {
  aiProtocolTaskDb.prepare(`INSERT INTO ai_protocol_tasks (
    id,owner_id,canvas_id,provider_site_id,base_url,status,mode,request_json,plan_json,plan_hash,
    provider_protocol_id,provider_protocol_version,provider_protocol_hash,
    model_protocol_id,model_protocol_version,model_protocol_hash,profile_id,intent,
    remote_task_id,result_json,error_message,workflow_state_json,next_poll_at,poll_attempt,created_at,updated_at,started_at,completed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    value.id, value.owner_id || null, value.canvas_id || null, value.provider_site_id || null, value.base_url || null, value.status, value.mode, value.request_json, value.plan_json, value.plan_hash,
    value.provider_protocol_id, value.provider_protocol_version, value.provider_protocol_hash,
    value.model_protocol_id, value.model_protocol_version, value.model_protocol_hash, value.profile_id, value.intent,
    null, null, null, null, null, 0, value.created_at, value.updated_at, null, null,
  )
  return getAiProtocolTask(value.id)!
}

export function getAiProtocolTask(id: string) {
  const task = aiProtocolTaskDb.prepare('SELECT * FROM ai_protocol_tasks WHERE id=?').get(id) as AiProtocolTaskRow | undefined
  if (!task) return null
  const events = aiProtocolTaskDb.prepare('SELECT * FROM ai_protocol_task_events WHERE task_id=? ORDER BY sequence').all(id) as AiProtocolTaskEventRow[]
  return { ...task, events }
}

export function listDueAiProtocolTasks(now = Date.now(), limit = 20) {
  return aiProtocolTaskDb.prepare(`SELECT * FROM ai_protocol_tasks
    WHERE status='pending' AND next_poll_at IS NOT NULL AND next_poll_at<=?
    ORDER BY next_poll_at,created_at LIMIT ?`).all(now, Math.max(1, Math.min(limit, 100))) as AiProtocolTaskRow[]
}

export function updateAiProtocolTask(id: string, patch: Partial<Pick<AiProtocolTaskRow, 'status' | 'remote_task_id' | 'result_json' | 'error_message' | 'workflow_state_json' | 'next_poll_at' | 'poll_attempt' | 'updated_at' | 'started_at' | 'completed_at'>>) {
  const keys = Object.keys(patch) as Array<keyof typeof patch>
  if (!keys.length) return getAiProtocolTask(id)
  aiProtocolTaskDb.prepare(`UPDATE ai_protocol_tasks SET ${keys.map((key) => `${key}=?`).join(',')} WHERE id=?`).run(...keys.map((key) => patch[key]), id)
  return getAiProtocolTask(id)
}

export function appendAiProtocolTaskEvent(taskId: string, type: string, data: unknown, createdAt = Date.now()) {
  const row = aiProtocolTaskDb.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM ai_protocol_task_events WHERE task_id=?').get(taskId) as { sequence: number }
  aiProtocolTaskDb.prepare('INSERT INTO ai_protocol_task_events(task_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?)')
    .run(taskId, row.sequence, type, JSON.stringify(data ?? null), createdAt)
}

export function closeAiProtocolTaskStore() { aiProtocolTaskDb.close() }
