import Database from 'better-sqlite3'
import { dataPath } from '../dataPaths.ts'

export type LegacyAiTaskStatus = 'queued' | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled'

export type LegacyAiTaskRow = {
  id: string
  owner_id: string
  canvas_id: string
  status: LegacyAiTaskStatus
  request_json: string
  remote_task_id: string | null
  output_kind: string
  prompt: string
  response_json: string | null
  error_message: string | null
  http_status: number | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

const dbPath = process.env.DX_LEGACY_AI_TASK_DB || dataPath('ai-tasks.db')
const db = new Database(dbPath)
db.pragma('busy_timeout = 30000')
db.pragma('journal_mode = WAL')
db.exec(`
CREATE TABLE IF NOT EXISTS legacy_ai_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  remote_task_id TEXT,
  output_kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response_json TEXT,
  error_message TEXT,
  http_status INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_legacy_ai_tasks_owner ON legacy_ai_tasks(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_legacy_ai_tasks_status ON legacy_ai_tasks(status, updated_at);
`)

export function createLegacyAiTask(input: {
  id: string
  ownerId: string
  canvasId: string
  request: unknown
  outputKind: string
  prompt: string
}) {
  const existing = getLegacyAiTask(input.id)
  if (existing) return { task: existing, created: false }
  const now = Date.now()
  db.prepare(`INSERT INTO legacy_ai_tasks(
    id,owner_id,canvas_id,status,request_json,remote_task_id,output_kind,prompt,
    response_json,error_message,http_status,created_at,updated_at,completed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.id, input.ownerId, input.canvasId, 'queued', JSON.stringify(input.request), null,
    input.outputKind, input.prompt, null, null, null, now, now, null,
  )
  return { task: getLegacyAiTask(input.id)!, created: true }
}

export function getLegacyAiTask(id: string) {
  return (db.prepare('SELECT * FROM legacy_ai_tasks WHERE id=?').get(id) as LegacyAiTaskRow | undefined) || null
}

export function updateLegacyAiTask(id: string, patch: Partial<Pick<LegacyAiTaskRow,
  'status' | 'remote_task_id' | 'response_json' | 'error_message' | 'http_status' | 'updated_at' | 'completed_at'>>) {
  const keys = Object.keys(patch) as Array<keyof typeof patch>
  if (!keys.length) return getLegacyAiTask(id)
  db.prepare(`UPDATE legacy_ai_tasks SET ${keys.map((key) => `${key}=?`).join(',')} WHERE id=?`)
    .run(...keys.map((key) => patch[key]), id)
  return getLegacyAiTask(id)
}

export function cancelLegacyAiTask(id: string) {
  const now = Date.now()
  return updateLegacyAiTask(id, { status: 'cancelled', updated_at: now, completed_at: now })
}

export function closeLegacyAiTaskStore() { db.close() }

