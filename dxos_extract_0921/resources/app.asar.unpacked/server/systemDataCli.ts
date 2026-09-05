import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { dataPath, DATA_ROOT } from './dataPaths.ts'
import { checkCurrentDataIntegrity, createSystemDataSnapshot, restoreSystemDataSnapshot, verifySystemDataSnapshot } from './systemDataProtection.ts'

function databaseCheck(path: string, checkpoint = false) {
  if (!existsSync(path)) return { exists: false, ok: true }
  const database = new Database(path)
  try {
    if (checkpoint) database.pragma('wal_checkpoint(TRUNCATE)')
    return { exists: true, ok: String(database.pragma('quick_check', { simple: true })) === 'ok' }
  } finally { database.close() }
}

const [command = 'integrity', id, confirmation] = process.argv.slice(2)
if (command === 'backup') {
  const databases = { ccs: databaseCheck(dataPath('ccs.db'), true), auth: databaseCheck(dataPath('auth.db'), true) }
  if (!databases.ccs.ok || !databases.auth.ok) throw new Error('数据库完整性检查失败，已停止创建更新快照')
  const snapshot = createSystemDataSnapshot('system-update-cli')
  const verification = verifySystemDataSnapshot(snapshot.id)
  if (!verification.ok) throw new Error(`系统数据快照校验失败：${verification.failures.join('；')}`)
  console.log(JSON.stringify({ ok: true, dataRoot: DATA_ROOT, snapshot: { ...snapshot, files: snapshot.files.length }, verification: { ok: true, failures: [] }, databases }, null, 2))
} else if (command === 'verify') {
  if (!id) throw new Error('请提供快照 ID')
  console.log(JSON.stringify(verifySystemDataSnapshot(id), null, 2))
} else if (command === 'restore') {
  if (!id || confirmation !== '--confirm-offline') throw new Error('恢复必须提供快照 ID 和 --confirm-offline，并先停止 DX OS')
  console.log(JSON.stringify({ ok: true, restored: restoreSystemDataSnapshot(id, true) }, null, 2))
} else if (command === 'integrity') {
  const files = checkCurrentDataIntegrity()
  const databases = { ccs: databaseCheck(dataPath('ccs.db')), auth: databaseCheck(dataPath('auth.db')) }
  console.log(JSON.stringify({ ok: files.ok && databases.ccs.ok && databases.auth.ok, dataRoot: DATA_ROOT, files, databases }, null, 2))
} else if (command === 'migrate') {
  const providers = (await import('./store.ts')).listProviders()
  const mcpCount = (await import('./mcp.ts')).migrateMcpStorage()
  const dingtalk = (await import('./dingtalk.ts')).getAgentConfig()
  const files = checkCurrentDataIntegrity()
  console.log(JSON.stringify({ ok: files.ok, dataRoot: DATA_ROOT, providers: providers.length, mcpServers: mcpCount, dingtalkConfigured: dingtalk.clientSecretSet, files }, null, 2))
} else {
  throw new Error('命令仅支持 backup、verify、restore、integrity、migrate')
}
