import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'
import {
  createNode,
  findByPath,
  listChildren,
  moveNode,
  purgeNode,
  renameNode,
  restoreSubtreeSnapshot,
  setContent,
  snapshotSubtree,
  type FsSubtreeSnapshot,
} from './fs.ts'

const SNAPSHOT_ROOT = dataPath('developer-app-project-snapshots')
const PROJECT_MARKER = '.dx-app-project.json'

interface StoredProjectSnapshot {
  format: 'dx-app-project-snapshot/v1'
  appId: string
  historyId: string
  ownerId: string
  rootId: string
  snapshot: FsSubtreeSnapshot
}

function safeId(value: string, label: string) {
  const id = String(value || '')
  if (!/^[a-zA-Z0-9_.+-]{1,180}$/.test(id)) throw new Error(`${label} 不合法`)
  return id
}

function snapshotDir(appId: string, historyId: string) {
  return join(SNAPSHOT_ROOT, safeId(appId, 'APP ID'), safeId(historyId, '历史版本 ID'))
}

export function saveDeveloperProjectSnapshot(appId: string, historyId: string, ownerId: string, rootId: string) {
  const record: StoredProjectSnapshot = {
    format: 'dx-app-project-snapshot/v1', appId, historyId, ownerId, rootId,
    snapshot: snapshotSubtree(rootId),
  }
  const dir = snapshotDir(appId, historyId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${safeId(ownerId, '账户 ID')}.json`), JSON.stringify(record), 'utf8')
  return record
}

export function hasDeveloperProjectSnapshots(appId: string, historyId: string) {
  const dir = snapshotDir(appId, historyId)
  return existsSync(dir) && readdirSync(dir).some((name) => name.endsWith('.json'))
}

export function deleteDeveloperProjectSnapshots(appId: string) {
  const root = join(SNAPSHOT_ROOT, safeId(appId, 'APP ID'))
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
}

export function deleteDeveloperProjectSnapshot(appId: string, historyId: string) {
  const dir = snapshotDir(appId, historyId)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export function restoreDeveloperProjectSnapshots(appId: string, historyId: string) {
  const dir = snapshotDir(appId, historyId)
  if (!existsSync(dir)) throw new Error('该历史版本没有项目数据快照')
  const restored: Array<{ ownerId: string; rootId: string; nodes: number }> = []
  for (const name of readdirSync(dir).filter((item) => item.endsWith('.json'))) {
    const record = JSON.parse(readFileSync(join(dir, name), 'utf8')) as StoredProjectSnapshot
    if (record.format !== 'dx-app-project-snapshot/v1' || record.appId !== appId || record.historyId !== historyId) throw new Error('项目数据快照身份不匹配')
    restored.push({ ownerId: record.ownerId, rootId: record.rootId, nodes: restoreSubtreeSnapshot(record.rootId, record.snapshot) })
  }
  return restored
}

/** 跨数据版本回滚前，按目标快照中的账户/根目录索引保存当前数据，支持再一键切回。 */
export function saveForwardDeveloperProjectSnapshots(appId: string, referenceHistoryId: string, newHistoryId: string) {
  const dir = snapshotDir(appId, referenceHistoryId)
  if (!existsSync(dir)) throw new Error('缺少用于建立正向回滚点的项目快照')
  const saved: StoredProjectSnapshot[] = []
  for (const name of readdirSync(dir).filter((item) => item.endsWith('.json'))) {
    const reference = JSON.parse(readFileSync(join(dir, name), 'utf8')) as StoredProjectSnapshot
    if (reference.format !== 'dx-app-project-snapshot/v1' || reference.appId !== appId) throw new Error('正向回滚项目快照身份不匹配')
    saved.push(saveDeveloperProjectSnapshot(appId, newHistoryId, reference.ownerId, reference.rootId))
  }
  return saved.length
}

function projectPath(value: unknown) {
  const path = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '')
  const parts = path.split('/')
  if (!path || path.length > 500 || path.startsWith('/') || /^[a-z]:/i.test(path) || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || part.length > 80 || /[\\:*?"<>|]/.test(part))) throw new Error(`迁移项目路径不合法：${path || '(空)'}`)
  return path
}

function ensureParent(rootId: string, path: string, ownerId: string) {
  const parts = path.split('/')
  const leaf = parts.pop()!
  let parentId = rootId
  for (const name of parts) {
    const existing = listChildren(parentId).nodes.find((node) => node.name === name)
    if (existing?.type === 'file') throw new Error(`迁移路径中存在同名文件：${name}`)
    const folder = existing || createNode({ name, type: 'folder', parentId, ownerId })
    parentId = folder.id
  }
  return { parentId, leaf }
}

export function applyDeclarativeProjectMigration(rootId: string, ownerId: string, raw: unknown, from: number, to: number) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  if (doc.format !== 'dx-project-migration/v1') throw new Error(`迁移 ${from}→${to} 缺少 format=dx-project-migration/v1`)
  const operations = Array.isArray(doc.operations) ? doc.operations : []
  if (!operations.length || operations.length > 200) throw new Error(`迁移 ${from}→${to} operations 必须包含 1–200 项`)
  for (const item of operations) {
    const op = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    const kind = String(op.op || '')
    if (kind === 'mkdir') {
      const path = projectPath(op.path)
      const existing = findByPath(rootId, path)
      if (existing?.type === 'file') throw new Error(`迁移无法创建目录，存在同名文件：${path}`)
      if (!existing) ensureParent(rootId, `${path}/.placeholder`, ownerId)
      continue
    }
    if (kind === 'write') {
      const path = projectPath(op.path)
      const content = typeof op.content === 'string' ? op.content : JSON.stringify(op.content ?? null, null, 2)
      if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) throw new Error(`迁移写入文件超过 2 MB：${path}`)
      const existing = findByPath(rootId, path)
      if (existing?.type === 'folder') throw new Error(`迁移无法覆盖同名目录：${path}`)
      if (existing && op.ifMissing === true) continue
      if (existing) setContent(existing.id, content)
      else {
        const target = ensureParent(rootId, path, ownerId)
        createNode({ name: target.leaf, type: 'file', parentId: target.parentId, ownerId, content })
      }
      continue
    }
    if (kind === 'move') {
      const fromPath = projectPath(op.from)
      const toPath = projectPath(op.to)
      const source = findByPath(rootId, fromPath)
      if (!source) {
        if (op.ifExists === true) continue
        throw new Error(`迁移源路径不存在：${fromPath}`)
      }
      if (findByPath(rootId, toPath)) throw new Error(`迁移目标路径已存在：${toPath}`)
      const target = ensureParent(rootId, toPath, ownerId)
      moveNode(source.id, target.parentId)
      renameNode(source.id, target.leaf)
      continue
    }
    if (kind === 'remove') {
      const path = projectPath(op.path)
      const existing = findByPath(rootId, path)
      if (existing) purgeNode(existing.id)
      else if (op.ifExists !== true) throw new Error(`迁移删除路径不存在：${path}`)
      continue
    }
    throw new Error(`不支持的声明式迁移操作：${kind || '(空)'}`)
  }
  const marker = listChildren(rootId).nodes.find((node) => node.type === 'file' && node.name === PROJECT_MARKER)
  if (marker) {
    let value: Record<string, unknown> = {}
    try { value = JSON.parse(marker.content || '{}') } catch { /* replace invalid marker */ }
    setContent(marker.id, JSON.stringify({ ...value, dataVersion: to, migratedAt: Date.now() }, null, 2))
  }
  return operations.length
}
