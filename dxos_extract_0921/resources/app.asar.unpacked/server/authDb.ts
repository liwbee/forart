import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataPath, ensureExternalDataLayout } from './dataPaths.ts'

ensureExternalDataLayout()

const authPath = process.env.CCS_AUTH_DB_PATH || dataPath('auth.db')
const legacyPath = dataPath('ops.db')

// One-time migration from the former shared operations database. VACUUM INTO
// creates a consistent snapshot even when the legacy database uses WAL mode.
if (!existsSync(authPath) && existsSync(legacyPath)) {
  mkdirSync(dirname(authPath), { recursive: true })
  const legacy = new Database(legacyPath)
  const escaped = authPath.replace(/'/g, "''")
  legacy.exec(`VACUUM INTO '${escaped}'`)
  legacy.close()
}

export const db = new Database(authPath)
// 设置等待策略必须早于 journal_mode。安装器替换桌面进程时，旧 API 可能
// 还在释放 WAL 锁；没有 busy_timeout 会让新 API 在首次 PRAGMA 处立即退出。
db.pragma('busy_timeout = 30000')
db.pragma('journal_mode = WAL')
db.exec(`
  DROP TABLE IF EXISTS ops_perf;
  DROP TABLE IF EXISTS ops_sync;
`)

export function closeAuthDb() { db.close() }
