import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { DATA_ROOT, dataPath } from './dataPaths.ts'

export interface DataSnapshotManifest {
  format: 'dx-system-data-snapshot/v1'
  id: string
  reason: string
  createdAt: number
  dataLayoutVersion: number
  files: Array<{ path: string; size: number; sha256: string }>
}

const SNAPSHOT_ROOT = dataPath('backups', 'system')
const EXCLUDED_TOP_LEVEL = new Set(['backups', 'cli-temp'])

function hashFile(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function safeSnapshotId(value: string) {
  if (!/^[a-z0-9][a-z0-9-]{5,100}$/.test(value)) throw new Error('数据快照 ID 不合法')
  return value
}
function snapshotPath(id: string) {
  const path = resolve(SNAPSHOT_ROOT, safeSnapshotId(id))
  if (!path.startsWith(`${resolve(SNAPSHOT_ROOT)}${sep}`)) throw new Error('数据快照路径越界')
  return path
}

function collectFiles(folder: string, root = folder): Array<{ absolute: string; path: string }> {
  if (!existsSync(folder)) return []
  const files: Array<{ absolute: string; path: string }> = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (root === folder && EXCLUDED_TOP_LEVEL.has(entry.name)) continue
    if (/(?:^|[.-])(?:tmp|shm|wal)$/i.test(entry.name)) continue
    const absolute = join(folder, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(absolute, root))
    else if (entry.isFile()) files.push({ absolute, path: relative(root, absolute).replace(/\\/g, '/') })
  }
  return files
}

export function createSystemDataSnapshot(reason = 'system-update') {
  mkdirSync(SNAPSHOT_ROOT, { recursive: true })
  const id = `${new Date().toISOString().replace(/[:.]/g, '-').toLowerCase()}-${randomUUID().slice(0, 8)}`
  const staging = snapshotPath(`${id}-staging`)
  const target = snapshotPath(id)
  const payload = join(staging, 'data')
  mkdirSync(payload, { recursive: true })
  const files = collectFiles(DATA_ROOT)
  for (const file of files) {
    const destination = join(payload, file.path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(file.absolute, destination, { force: false })
  }
  const manifest: DataSnapshotManifest = {
    format: 'dx-system-data-snapshot/v1', id, reason: String(reason || 'system-update').slice(0, 120),
    createdAt: Date.now(), dataLayoutVersion: 1,
    files: files.map((file) => {
      const copied = join(payload, file.path)
      return { path: file.path, size: statSync(copied).size, sha256: hashFile(copied) }
    }),
  }
  writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  renameSync(staging, target)
  return manifest
}

export function verifySystemDataSnapshot(id: string) {
  const root = snapshotPath(id)
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as DataSnapshotManifest
  if (manifest.format !== 'dx-system-data-snapshot/v1' || manifest.id !== id) throw new Error('数据快照清单无效')
  const failures: string[] = []
  for (const file of manifest.files) {
    const path = resolve(root, 'data', file.path)
    if (!path.startsWith(`${resolve(root, 'data')}${sep}`) || !existsSync(path)) { failures.push(`${file.path}: missing`); continue }
    const stat = statSync(path)
    if (stat.size !== file.size || hashFile(path) !== file.sha256) failures.push(`${file.path}: checksum`)
  }
  return { ok: failures.length === 0, manifest, failures }
}

/** Offline restore hook for the system updater. Databases must be closed first. */
export function restoreSystemDataSnapshot(id: string, databasesClosed = false) {
  if (!databasesClosed) throw new Error('恢复数据快照前必须停止 DX OS 数据库服务')
  const verified = verifySystemDataSnapshot(id)
  if (!verified.ok) throw new Error(`数据快照校验失败：${verified.failures.join('；')}`)
  const payload = join(snapshotPath(id), 'data')
  const preserve = join(DATA_ROOT, 'backups')
  for (const entry of readdirSync(DATA_ROOT, { withFileTypes: true })) {
    const target = join(DATA_ROOT, entry.name)
    if (resolve(target) === resolve(preserve)) continue
    rmSync(target, { recursive: true, force: true })
  }
  for (const entry of readdirSync(payload, { withFileTypes: true })) cpSync(join(payload, entry.name), join(DATA_ROOT, entry.name), { recursive: true })
  return verified.manifest
}

export function checkCurrentDataIntegrity() {
  const failures: string[] = []
  for (const name of ['providers.json', 'skills.json', 'mcp.json', 'mcp.system.json', 'custom-protocols.json', 'fs.json']) {
    const path = dataPath(name)
    if (!existsSync(path)) continue
    try { JSON.parse(readFileSync(path, 'utf8')) } catch { failures.push(`${name}: JSON 损坏`) }
  }
  return { ok: failures.length === 0, dataRoot: DATA_ROOT, failures }
}
