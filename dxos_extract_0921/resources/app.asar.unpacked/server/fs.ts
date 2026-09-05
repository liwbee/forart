// ══════════════════════════════════════════════════════════════════════
// 虚拟文件系统（JSON 文件版）—— 桌面/访达的后端真源。
// 节点：文件夹 / 文件；支持增/删/改名/改内容/移动；删除文件夹递归。
// ══════════════════════════════════════════════════════════════════════
import { copyFileSync, readFileSync, renameSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { randomUUID } from 'node:crypto'

const DATA_DIR = DATA_ROOT
const FILE = dataPath('fs.json')
const BLOB_DIR = dataPath('blobs')
const THUMBNAIL_DIR = dataPath('cache', 'fs-thumbnails')
const SYSTEM_ROOT_NAME = '.系统目录'

export interface FsNode {
  id: string
  name: string
  type: 'folder' | 'file'
  parentId: string | null
  /** M3 起新建节点绑定创建者；历史节点保持未归属，待 M8 迁移。 */
  ownerId?: string
  /** 共享区标记：'public' 全员可读写；'department:<id>' 本部门可读写；
   *  'canvas:<id>' 由画布的共享成员继承读写权限。
   *  只出现在共享区根文件夹上，子节点通过向上查找继承。 */
  share?: string
  /** 系统文件夹：共享区根由系统创建，不能重命名/移动/删除 */
  system?: boolean
  /** 纯文本文件的内联内容（在编辑器里创建/编辑的） */
  content?: string
  /** 上传文件的类型与大小；二进制存在 blobs/<id> */
  mime?: string
  size?: number
  created_ts: number
  updated_ts: number
  /** 软删除标记：在废纸篓里（隐藏于正常浏览/搜索，可恢复或彻底删除） */
  trashed?: boolean
  /** 移入废纸篓的时间 */
  trashedTs?: number
}

export function blobPath(id: string): string {
  return join(BLOB_DIR, id)
}
export function thumbnailPath(id: string, size?: number): string {
  return join(THUMBNAIL_DIR, `${id}${size ? `-${size}` : ''}.jpg`)
}
export function hasThumbnail(id: string, size?: number): boolean {
  return existsSync(thumbnailPath(id, size))
}
export function saveThumbnail(id: string, buf: Buffer, size?: number) {
  if (!existsSync(THUMBNAIL_DIR)) mkdirSync(THUMBNAIL_DIR, { recursive: true })
  writeFileSync(thumbnailPath(id, size), buf)
}
export function deleteThumbnail(id: string) {
  for (const size of [undefined, 256] as const) {
    try {
      if (existsSync(thumbnailPath(id, size))) unlinkSync(thumbnailPath(id, size))
    } catch {
      /* ignore */
    }
  }
}
export function hasBlob(id: string): boolean {
  return existsSync(blobPath(id))
}
export function saveBlob(id: string, buf: Buffer) {
  if (!existsSync(BLOB_DIR)) mkdirSync(BLOB_DIR, { recursive: true })
  deleteThumbnail(id)
  writeFileSync(blobPath(id), buf)
}
export function adoptBlobFile(id: string, sourcePath: string) {
  if (!existsSync(BLOB_DIR)) mkdirSync(BLOB_DIR, { recursive: true })
  deleteThumbnail(id)
  const target = blobPath(id)
  try {
    renameSync(sourcePath, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    copyFileSync(sourcePath, target)
    unlinkSync(sourcePath)
  }
}
export function readBlob(id: string): Buffer | null {
  return hasBlob(id) ? readFileSync(blobPath(id)) : null
}
function deleteBlob(id: string) {
  deleteThumbnail(id)
  try {
    if (existsSync(blobPath(id))) unlinkSync(blobPath(id))
  } catch {
    /* ignore */
  }
}

function now() {
  return Math.floor(Date.now() / 1000)
}

function seed(): FsNode[] {
  const t = now()
  const docId = randomUUID()
  return [
    { id: docId, name: '文稿', type: 'folder', parentId: null, created_ts: t, updated_ts: t },
    { id: randomUUID(), name: '便签.txt', type: 'file', parentId: null, content: '欢迎使用 DX OS 文件。\n右键桌面可以新建文件夹或文件。', created_ts: t, updated_ts: t },
  ]
}

function load(): FsNode[] {
  try {
    if (!existsSync(FILE)) {
      const s = seed()
      persist(s)
      return s
    }
    return JSON.parse(readFileSync(FILE, 'utf-8')) as FsNode[]
  } catch {
    return []
  }
}

function persist(list: FsNode[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf-8')
}

function sortNodes(nodes: FsNode[]): FsNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
}

/** 同一父目录下的重名 → 追加 (2)(3)… */
function uniqueName(list: FsNode[], parentId: string | null, name: string): string {
  const siblings = new Set(list.filter((n) => n.parentId === parentId && !n.trashed).map((n) => n.name))
  if (!siblings.has(name)) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let i = 2
  while (siblings.has(`${base} (${i})${ext}`)) i++
  return `${base} (${i})${ext}`
}

/** 去掉不安全字符 */
function cleanName(name: string): string {
  return String(name || '').replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 80)
}

export function listChildren(parentId: string | null) {
  const list = load()
  const nodes = sortNodes(list.filter((n) => n.parentId === parentId && !n.trashed))
  // 面包屑：普通根以「桌面」起；隐藏系统根下的固定目录自己就是顶层位置。
  let hasSystemRoot = false
  let cur = parentId ? list.find((n) => n.id === parentId) : null
  const chain: { id: string | null; name: string }[] = []
  const guard = new Set<string>()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    if (isSystemDirectory(cur)) hasSystemRoot = true
    else chain.unshift({ id: cur.id, name: cur.name })
    cur = cur.parentId ? list.find((n) => n.id === cur!.parentId) || null : null
  }
  return { nodes, path: hasSystemRoot ? chain : [{ id: null, name: '桌面' }, ...chain] }
}

export function getNode(id: string): FsNode | null {
  return load().find((n) => n.id === id) || null
}

export function isInTrash(id: string): boolean {
  const list = load()
  let current = list.find((node) => node.id === id)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (current.trashed) return true
    seen.add(current.id)
    current = current.parentId ? list.find((node) => node.id === current!.parentId) : undefined
  }
  return false
}

export function createNode(input: {
  name?: string
  type: 'folder' | 'file'
  parentId?: string | null
  content?: string
  mime?: string
  size?: number
  ownerId?: string
  share?: string
  system?: boolean
}): FsNode {
  const list = load()
  const parentId = input.parentId ?? null
  const parent = parentId ? list.find((n) => n.id === parentId && n.type === 'folder') : undefined
  if (parentId && !parent) {
    throw new Error('父目录不存在')
  }
  if (parentId && isInTrash(parentId)) throw new Error('父目录已在废纸篓中')
  // 共享区（公共/部门文件夹）内成员可以互相创建；私人目录只能本人创建
  const inShareZone = (() => {
    let p = parent
    while (p) {
      if (p.share) return true
      p = p.parentId ? list.find((n) => n.id === p!.parentId) : undefined
    }
    return false
  })()
  if (!inShareZone && parent?.ownerId && input.ownerId && parent.ownerId !== input.ownerId) throw new Error('不能在其他用户的文件夹中创建内容')
  const type = input.type === 'file' ? 'file' : 'folder'
  const rawName = cleanName(input.name || '') || (type === 'folder' ? '未命名文件夹' : '未命名文件.txt')
  const name = uniqueName(list, parentId, rawName)
  const t = now()
  const isUpload = input.mime !== undefined || input.size !== undefined
  const node: FsNode = {
    id: randomUUID(),
    name,
    type,
    parentId,
    // 共享区内 ownerId 只记录创建者本人；私人区继承父目录所有者
    ...(input.ownerId || (!inShareZone && parent?.ownerId) ? { ownerId: input.ownerId || parent?.ownerId } : {}),
    ...(input.share ? { share: input.share } : {}),
    ...(input.system ? { system: true } : {}),
    // 上传文件：记 mime/size，内容在 blob；在编辑器新建的文本：内联 content
    ...(type === 'file' && !isUpload ? { content: input.content ?? '' } : {}),
    ...(input.mime !== undefined ? { mime: input.mime } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
    created_ts: t,
    updated_ts: t,
  }
  list.push(node)
  persist(list)
  return node
}

/**
 * 解析相对路径到 { parentId, leaf }。
 * rootId = 相对的起点（null=文件系统根）；createDirs 时自动创建缺失的中间目录。
 * 例：resolvePath(root, '角色/苏离.png', true) → { parentId: 角色目录id, leaf: '苏离.png' }
 */
export function resolvePath(
  rootId: string | null,
  relPath: string,
  createDirs: boolean,
): { parentId: string | null; leaf: string } {
  const parts = String(relPath || '').split('/').map((s) => s.trim()).filter(Boolean)
  const leaf = parts.pop() || ''
  let pid = rootId
  for (const seg of parts) {
    const list = load()
    let folder = list.find((n) => n.parentId === pid && n.type === 'folder' && n.name === seg && !n.trashed)
    if (!folder) {
      if (!createDirs) throw new Error(`路径不存在：${seg}`)
      folder = createNode({ name: seg, type: 'folder', parentId: pid })
    }
    pid = folder.id
  }
  return { parentId: pid, leaf }
}

/** 按相对路径查已存在的节点；找不到返回 null。 */
export function findByPath(rootId: string | null, relPath: string): FsNode | null {
  try {
    const { parentId, leaf } = resolvePath(rootId, relPath, false)
    return load().find((n) => n.parentId === parentId && n.name === leaf && !n.trashed) || null
  } catch {
    return null
  }
}

export function isWithinRoot(rootId: string, nodeId: string): boolean {
  const list = load()
  let current = list.find((node) => node.id === nodeId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (current.id === rootId) return true
    seen.add(current.id)
    current = current.parentId ? list.find((node) => node.id === current!.parentId) : undefined
  }
  return false
}

/** 找/建一个位于指定父目录（默认根）下的文件夹，返回它的 id。 */
export function ensureFolder(name: string, parentId: string | null = null, ownerId?: string): string {
  const list = load()
  const clean = cleanName(name) || '未命名文件夹'
  const found = list.find((n) => n.parentId === parentId && n.type === 'folder' && n.name === clean && !n.trashed)
  if (found) return found.id
  return createNode({ name: clean, type: 'folder', parentId, ownerId }).id
}

function isSystemDirectory(node: FsNode): boolean {
  return node.type === 'folder' && node.system === true && node.name === SYSTEM_ROOT_NAME
}

/** 找/建隐藏的系统目录。固定位置挂在这里，不直接出现在桌面。 */
export function ensureSystemRoot(): FsNode {
  const list = load()
  const existing = list.find((n) => n.parentId === null && isSystemDirectory(n) && !n.trashed)
  if (existing) return existing
  return createNode({ name: SYSTEM_ROOT_NAME, type: 'folder', parentId: null, system: true })
}

function moveFolderToSystemRoot(node: FsNode, systemRootId: string): FsNode {
  if (node.parentId === systemRootId) return node
  const list = load()
  const current = list.find((n) => n.id === node.id)
  if (!current) return node
  current.parentId = systemRootId
  current.updated_ts = now()
  persist(list)
  return current
}

const USER_FOLDER_ALIASES: Record<string, string[]> = {
  '文稿': ['文稿'],
  '项目': ['项目', '画布'],
  '助理缓存': ['助理缓存'],
  '助理空间': ['助理空间'],
}

function userFolderBaseName(name: string): string {
  return name.replace(/ \(\d+\)$/, '')
}

/**
 * 旧版本把所有用户的固定目录放在同一个隐藏父目录下，又使用了全局防重名，
 * 导致非首个用户得到“文稿 (2)”之类的名字。初始化只找“文稿”，随后每次请求
 * 都会再创建一个后缀目录。这里把同一用户的历史重复目录无损归并到一个目录：
 * 子项全部保留，同名子项沿用普通的 (2) 规则。
 */
function consolidateUserFolders(name: string, ownerId: string, systemRootId: string): FsNode | null {
  const aliases = USER_FOLDER_ALIASES[name] || [name]
  const list = load()
  const matches = list.filter((node) =>
    node.type === 'folder'
    && node.ownerId === ownerId
    && !node.trashed
    && aliases.includes(userFolderBaseName(node.name)))
  if (!matches.length) return null

  const preferredNames = name === '项目' ? ['项目', '画布'] : [name]
  matches.sort((a, b) => {
    const ai = preferredNames.indexOf(a.name)
    const bi = preferredNames.indexOf(b.name)
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    return a.created_ts - b.created_ts || a.id.localeCompare(b.id)
  })
  const keeper = matches[0]
  const duplicateIds = new Set(matches.slice(1).map((node) => node.id))
  if (!duplicateIds.size && keeper.name === name && keeper.parentId === systemRootId) return keeper

  keeper.name = name
  keeper.parentId = systemRootId
  keeper.updated_ts = now()
  for (const node of list) {
    if (!node.parentId || !duplicateIds.has(node.parentId)) continue
    node.parentId = keeper.id
    node.name = uniqueName(list.filter((item) => item.id !== node.id && !duplicateIds.has(item.id)), keeper.id, node.name)
    node.updated_ts = now()
  }
  const consolidated = list.filter((node) => !duplicateIds.has(node.id))
  persist(consolidated)
  return consolidated.find((node) => node.id === keeper.id) || keeper
}

/** 找/建当前用户的固定文件夹（如 文稿 / 项目），位置在隐藏系统目录下。 */
export function ensureUserFolder(name: string, ownerId: string): FsNode {
  const clean = cleanName(name) || '未命名文件夹'
  const systemRoot = ensureSystemRoot()
  const found = consolidateUserFolders(clean, ownerId, systemRoot.id)
  if (found) return found
  createNode({ name: clean, type: 'folder', parentId: systemRoot.id, ownerId })
  // createNode 的普通防重名会因为其他用户的同名固定目录而加后缀；立即规范化。
  return consolidateUserFolders(clean, ownerId, systemRoot.id)!
}

/** 当前用户的「项目」根目录（函数名保留用于兼容已有调用）。 */
export function ensureCanvasRoot(ownerId: string): FsNode {
  return ensureUserFolder('项目', ownerId)
}

/** 创建一个位于「项目」根目录下的项目文件夹。 */
export function createCanvasProjectFolder(ownerId: string, title: string): FsNode {
  const root = ensureCanvasRoot(ownerId)
  const canvasRoot = ensureFolder('无限画布', root.id, ownerId)
  return createNode({ name: title || '未命名项目', type: 'folder', parentId: canvasRoot, ownerId })
}

export function renameNode(id: string, name: string): FsNode {
  const list = load()
  const node = list.find((n) => n.id === id)
  if (!node) throw new Error('节点不存在')
  const clean = cleanName(name)
  if (!clean) throw new Error('名称不能为空')
  node.name = uniqueName(
    list.filter((n) => n.id !== id),
    node.parentId,
    clean,
  )
  node.updated_ts = now()
  persist(list)
  return node
}

export function setContent(id: string, content: string): FsNode {
  const list = load()
  const node = list.find((n) => n.id === id)
  if (!node) throw new Error('节点不存在')
  if (node.type !== 'file') throw new Error('只能编辑文件内容')
  node.content = String(content ?? '')
  node.size = Buffer.byteLength(node.content, 'utf8')
  // 编辑后改用内联存储：删掉旧的 blob，避免 raw 读到过期二进制
  deleteBlob(id)
  node.updated_ts = now()
  persist(list)
  return node
}

export function setBinaryContent(id: string, content: Buffer, mime = 'application/octet-stream'): FsNode {
  const list = load()
  const node = list.find((n) => n.id === id)
  if (!node) throw new Error('节点不存在')
  if (node.type !== 'file') throw new Error('只能写入文件内容')
  delete node.content
  node.mime = String(mime || 'application/octet-stream').slice(0, 160)
  node.size = content.byteLength
  node.updated_ts = now()
  saveBlob(id, content)
  persist(list)
  return node
}

/** 系统初始化（bootstrap）时把 seed/历史无主文件全部归属第一位超管。 */
export function claimOwnerlessNodes(ownerId: string): number {
  const list = load()
  let count = 0
  for (const node of list) if (!node.ownerId && !node.share && !node.system) { node.ownerId = ownerId; count++ }
  if (count) persist(list)
  return count
}

// ── 共享区（公共文件夹 / 部门文件夹）────────────────────────────────
// 共享根是桌面上的系统文件夹：share='public' 或 'department:<部门ID>'。
// 区内内容对可见成员全员可读写；ownerId 仅记录创建者，不用于隔离。

export function ensurePublicRoot(): FsNode {
  const systemRoot = ensureSystemRoot()
  const list = load()
  const existing = list.find((n) => n.share === 'public' && !n.trashed)
  if (existing) return moveFolderToSystemRoot(existing, systemRoot.id)
  return createNode({ name: '公共文件', type: 'folder', parentId: systemRoot.id, share: 'public', system: true })
}

export function ensureDepartmentRoot(departmentId: string, departmentName: string): FsNode {
  const share = `department:${departmentId}`
  const systemRoot = ensureSystemRoot()
  const list = load()
  const existing = list.find((n) => n.share === share && !n.trashed)
  if (existing) return moveFolderToSystemRoot(existing, systemRoot.id)
  return createNode({ name: `${departmentName}（部门）`, type: 'folder', parentId: systemRoot.id, share, system: true })
}

/** 节点所属共享区：向上找最近的 share 根；不在共享区返回 null。 */
export function shareZoneOf(id: string): string | null {
  const list = load()
  let node = list.find((n) => n.id === id) || null
  while (node) {
    if (node.share) return node.share
    node = node.parentId ? list.find((n) => n.id === node!.parentId) || null : null
  }
  return null
}

/** 同步项目文件夹的画布共享区标记。不会覆盖其他画布或系统共享区。 */
export function setCanvasFolderShare(id: string, canvasId: string, shared: boolean): FsNode {
  const list = load()
  const node = list.find((item) => item.id === id && item.type === 'folder')
  if (!node) throw new Error('项目文件夹不存在')
  const marker = `canvas:${canvasId}`
  let changed = false
  if (shared) {
    if (node.share && node.share !== marker) throw new Error('项目文件夹已属于其他共享区')
    if (node.share !== marker) { node.share = marker; changed = true }
  } else if (node.share === marker) {
    delete node.share
    changed = true
  }
  if (changed) { node.updated_ts = now(); persist(list) }
  return node
}

/** 共享区改名（部门重命名时同步） */
export function renameShareRoot(share: string, name: string): void {
  const list = load()
  const root = list.find((n) => n.share === share && !n.trashed)
  if (root) { root.name = uniqueName(list.filter((n) => n.id !== root.id), null, cleanName(name) || root.name); root.updated_ts = now(); persist(list) }
}

/** 删除共享区（部门删除时调用；内容进废纸篓） */
export function removeShareRoot(share: string): void {
  const list = load()
  const root = list.find((n) => n.share === share && !n.trashed)
  if (root) { root.system = false; removeNode(root.id) }
}

/** 仅用于管理员把历史项目目录一次性归属给某个用户。 */
export function claimNodeOwner(id: string, ownerId: string): number {
  const list = load()
  const root = list.find((node) => node.id === id)
  if (!root) throw new Error('节点不存在')
  const ids = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const node of list) if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true }
  }
  for (const node of list) {
    if (ids.has(node.id) && node.ownerId && node.ownerId !== ownerId) throw new Error('目录包含其他用户的内容，不能认领')
  }
  for (const node of list) if (ids.has(node.id)) node.ownerId = ownerId
  persist(list)
  return ids.size
}

export function moveNode(id: string, parentId: string | null): FsNode {
  const list = load()
  const node = list.find((n) => n.id === id)
  if (!node) throw new Error('节点不存在')
  if (isInTrash(id)) throw new Error('节点已在废纸篓中')
  if (parentId && isInTrash(parentId)) throw new Error('目标目录已在废纸篓中')
  if (id === parentId) throw new Error('不能移动到自身')
  // 防止移动到自己的子孙里
  let p = parentId ? list.find((n) => n.id === parentId) : null
  while (p) {
    if (p.id === id) throw new Error('不能移动到自己的子目录')
    p = p.parentId ? list.find((n) => n.id === p!.parentId) || null : null
  }
  node.parentId = parentId
  node.name = uniqueName(list.filter((n) => n.id !== id), parentId, node.name)
  node.updated_ts = now()
  persist(list)
  return node
}

/** 复制（文件夹递归，含 blob）到目标目录；返回新建的根节点。 */
export function copyNode(id: string, targetParentId: string | null): FsNode {
  const list = load()
  const src = list.find((n) => n.id === id)
  if (!src) throw new Error('节点不存在')
  if (isInTrash(id)) throw new Error('节点已在废纸篓中')
  if (targetParentId && isInTrash(targetParentId)) throw new Error('目标目录已在废纸篓中')
  if (targetParentId && !list.find((n) => n.id === targetParentId && n.type === 'folder')) {
    throw new Error('目标目录不存在')
  }
  // 不能把文件夹复制进它自己或其子孙里
  if (src.type === 'folder') {
    let p = targetParentId ? list.find((n) => n.id === targetParentId) : null
    while (p) {
      if (p.id === src.id) throw new Error('不能复制到自己的子目录')
      p = p.parentId ? list.find((x) => x.id === p!.parentId) || null : null
    }
  }
  const t = now()
  const additions: FsNode[] = []
  const clone = (node: FsNode, parentId: string | null): FsNode => {
    const name = uniqueName([...list, ...additions], parentId, node.name)
    const copy: FsNode = {
      id: randomUUID(),
      name,
      type: node.type,
      parentId,
      ...(node.ownerId !== undefined ? { ownerId: node.ownerId } : {}),
      ...(node.type === 'file' && node.content !== undefined ? { content: node.content } : {}),
      ...(node.mime !== undefined ? { mime: node.mime } : {}),
      ...(node.size !== undefined ? { size: node.size } : {}),
      created_ts: t,
      updated_ts: t,
    }
    additions.push(copy)
    if (node.type === 'file' && hasBlob(node.id)) saveBlob(copy.id, readFileSync(blobPath(node.id)))
    if (node.type === 'folder') {
      for (const child of list.filter((c) => c.parentId === node.id)) clone(child, copy.id)
    }
    return copy
  }
  const root = clone(src, targetParentId)
  persist([...list, ...additions])
  return root
}

/** 软删除：移入废纸篓（保留数据与 blob，可恢复）。只标记被删的根节点。 */
export function removeNode(id: string): number {
  const list = load()
  const node = list.find((n) => n.id === id)
  if (!node) return 0
  node.trashed = true
  node.trashedTs = now()
  persist(list)
  return 1
}

/** 彻底删除（文件夹递归，含 blob）；不可恢复。返回删除的节点数。 */
export function purgeNode(id: string): number {
  const list = load()
  const toDelete = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const n of list) {
      if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
        toDelete.add(n.id)
        changed = true
      }
    }
  }
  for (const n of list) {
    if (toDelete.has(n.id) && n.type === 'file') deleteBlob(n.id)
  }
  persist(list.filter((n) => !toDelete.has(n.id)))
  return toDelete.size
}

export interface TrashItem {
  id: string
  name: string
  type: 'folder' | 'file'
  origPath: string
  trashedTs: number
  size?: number
  mime?: string
}

/** 废纸篓列表：所有 trashed 根节点，附原始位置路径。 */
export function listTrash(): TrashItem[] {
  const list = load()
  const byId = new Map(list.map((n) => [n.id, n]))
  const pathOf = (n: FsNode): string => {
    const segs: string[] = []
    let cur: FsNode | undefined = n.parentId ? byId.get(n.parentId) : undefined
    const guard = new Set<string>()
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id)
      segs.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return segs.join('/') || '桌面'
  }
  return list
    .filter((n) => n.trashed)
    .sort((a, b) => (b.trashedTs || 0) - (a.trashedTs || 0))
    .map((n) => ({ id: n.id, name: n.name, type: n.type, origPath: pathOf(n), trashedTs: n.trashedTs || 0, size: n.size, mime: n.mime }))
}

/** 从废纸篓恢复：清除标记；若原位置有同名项则自动改名。 */
export function restoreNode(id: string): FsNode | null {
  const list = load()
  const node = list.find((n) => n.id === id)
  if (!node || !node.trashed) return null
  // 原父目录若已被清除/仍在废纸篓，则恢复到根
  const parent = node.parentId ? list.find((n) => n.id === node.parentId) : null
  if (node.parentId && (!parent || parent.trashed)) node.parentId = null
  node.name = uniqueName(list.filter((n) => n.id !== id), node.parentId, node.name)
  node.trashed = false
  delete node.trashedTs
  node.updated_ts = now()
  persist(list)
  return node
}

/** 清空废纸篓：彻底删除所有 trashed 根及其子树。 */
export function emptyTrash(): number {
  let count = 0
  for (const t of listTrash()) count += purgeNode(t.id)
  return count
}

function fileBytes(node: FsNode): number {
  if (node.type !== 'file') return 0
  if (typeof node.size === 'number') return Math.max(0, node.size)
  if (node.content !== undefined) return Buffer.byteLength(node.content, 'utf8')
  if (hasBlob(node.id)) {
    try {
      return readFileSync(blobPath(node.id)).byteLength
    } catch {
      return 0
    }
  }
  return 0
}

function programFor(node: FsNode): string {
  const mime = (node.mime || '').toLowerCase()
  const ext = (node.name.split('.').pop() || '').toLowerCase()
  if (mime.startsWith('image/')) return '相册'
  if (mime.startsWith('video/')) return '视频'
  if (mime.startsWith('audio/')) return '音乐'
  if (ext === 'md' || ext === 'markdown' || mime.startsWith('text/') || ['txt', 'json', 'log', 'js', 'ts', 'css', 'html', 'xml', 'yaml', 'yml', 'csv'].includes(ext)) return '文本编辑器'
  if (mime.includes('word') || ['doc', 'docx'].includes(ext)) return '文稿'
  if (mime.includes('spreadsheet') || mime.includes('excel') || ['xls', 'xlsx'].includes(ext)) return '表格'
  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF'
  return '文件'
}

function subtreeSize(list: FsNode[], rootId: string): number {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of list) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        changed = true
      }
    }
  }
  return list.reduce((sum, node) => (ids.has(node.id) ? sum + fileBytes(node) : sum), 0)
}

export function subtreeByteSize(rootId: string) {
  return subtreeSize(load(), rootId)
}

export interface StorageBucket {
  id: string
  name: string
  bytes: number
  count: number
}
export interface StorageItem {
  id: string
  name: string
  type: 'folder' | 'file'
  ownerId: string | null
  ownerName: string
  program: string
  bytes: number
  deletable: boolean
}

export function storageReport(userNames: Record<string, string>) {
  const list = load()
  const files = list.filter((node) => node.type === 'file')
  const totalBytes = files.reduce((sum, node) => sum + fileBytes(node), 0)
  const byOwner = new Map<string, StorageBucket>()
  const byProgram = new Map<string, StorageBucket>()
  for (const node of files) {
    const bytes = fileBytes(node)
    const ownerKey = node.ownerId || 'unowned'
    const ownerName = node.ownerId ? userNames[node.ownerId] || '未知账户' : '未归属'
    const owner = byOwner.get(ownerKey) || { id: ownerKey, name: ownerName, bytes: 0, count: 0 }
    owner.bytes += bytes
    owner.count += 1
    byOwner.set(ownerKey, owner)
    const programName = programFor(node)
    const program = byProgram.get(programName) || { id: programName, name: programName, bytes: 0, count: 0 }
    program.bytes += bytes
    program.count += 1
    byProgram.set(programName, program)
  }
  const rootItems: StorageItem[] = list
    .filter((node) => node.parentId === null && !node.trashed)
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      ownerId: node.ownerId || null,
      ownerName: node.ownerId ? userNames[node.ownerId] || '未知账户' : node.share ? '共享区' : '未归属',
      program: node.type === 'file' ? programFor(node) : node.share ? '共享区' : '文件夹',
      bytes: subtreeSize(list, node.id),
      deletable: !node.system,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name, 'zh'))
  return {
    totalBytes,
    byOwner: [...byOwner.values()].sort((a, b) => b.bytes - a.bytes),
    byProgram: [...byProgram.values()].sort((a, b) => b.bytes - a.bytes),
    rootItems,
  }
}

/**
 * 磁盘面板下钻：列出某目录下的所有子项（不做 owner 过滤，供超管管理任意账号/共享区的文件）。
 * 返回子项（含子树体积、归属、可删标记）+ 面包屑路径。
 */
export function storageChildren(parentId: string, userNames: Record<string, string>): { path: { id: string | null; name: string }[]; items: StorageItem[] } {
  const list = load()
  const items: StorageItem[] = list
    .filter((node) => node.parentId === parentId && !node.trashed)
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      ownerId: node.ownerId || null,
      ownerName: node.ownerId ? userNames[node.ownerId] || '未知账户' : node.share ? '共享区' : '未归属',
      program: node.type === 'file' ? programFor(node) : node.share ? '共享区' : '文件夹',
      bytes: node.type === 'folder' ? subtreeSize(list, node.id) : fileBytes(node),
      deletable: !node.system,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name, 'zh'))
  // 面包屑：桌面 → …祖先… → 当前目录
  const path: { id: string | null; name: string }[] = [{ id: null, name: '桌面' }]
  const chain: { id: string | null; name: string }[] = []
  let cur = list.find((n) => n.id === parentId) || null
  const guard = new Set<string>()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    chain.unshift({ id: cur.id, name: cur.name })
    cur = cur.parentId ? list.find((n) => n.id === cur!.parentId) || null : null
  }
  return { path: [...path, ...chain], items }
}

// ── 搜索 / 目录树（供 agent 在大项目里定位与规划）───────────────────────
const TEXTUAL_EXT = ['txt', 'md', 'json', 'csv', 'log', 'js', 'ts', 'css', 'html', 'xml', 'yaml', 'yml']
function isTextual(node: FsNode): boolean {
  const mime = (node.mime || '').toLowerCase()
  const ext = (node.name.split('.').pop() || '').toLowerCase()
  return node.content !== undefined || mime.startsWith('text/') || TEXTUAL_EXT.includes(ext)
}
function nodeText(node: FsNode): string | null {
  if (node.content !== undefined) return node.content
  if (isTextual(node) && hasBlob(node.id)) {
    try {
      return readFileSync(blobPath(node.id)).toString('utf8')
    } catch {
      return null
    }
  }
  return null
}

export interface SearchHit {
  id: string
  name: string
  type: 'folder' | 'file'
  path: string
  snippet?: string
}

/** 在 rootId 子树内按文件名 + 文本内容搜索。 */
export function searchNodes(
  rootId: string | null,
  query: string,
  opts: { name?: boolean; content?: boolean; limit?: number } = {},
): SearchHit[] {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const byName = opts.name !== false
  const byContent = opts.content !== false
  const limit = Math.max(1, Math.min(200, opts.limit || 50))
  const list = load()
  const byId = new Map(list.map((n) => [n.id, n]))
  const pathOf = (n: FsNode): string => {
    const segs: string[] = []
    let cur: FsNode | undefined = n
    while (cur && cur.id !== rootId) {
      segs.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return segs.join('/')
  }
  // 收集子树
  const scope: FsNode[] = []
  const collect = (pid: string | null) => {
    for (const n of list) {
      if (n.parentId === pid && !n.trashed) {
        scope.push(n)
        if (n.type === 'folder') collect(n.id)
      }
    }
  }
  collect(rootId)
  const out: SearchHit[] = []
  for (const n of scope) {
    if (out.length >= limit) break
    if (byName && n.name.toLowerCase().includes(q)) {
      out.push({ id: n.id, name: n.name, type: n.type, path: pathOf(n) })
      continue
    }
    if (byContent && n.type === 'file') {
      const text = nodeText(n)
      if (text && text.toLowerCase().includes(q)) {
        const i = text.toLowerCase().indexOf(q)
        const snippet = text.slice(Math.max(0, i - 30), i + q.length + 40).replace(/\s+/g, ' ').trim()
        out.push({ id: n.id, name: n.name, type: n.type, path: pathOf(n), snippet })
      }
    }
  }
  return out
}

export interface TreeRow {
  name: string
  type: 'folder' | 'file'
  depth: number
}

export interface FsSubtreeSnapshot {
  format: 'dx-fs-subtree/v1'
  rootId: string
  createdAt: number
  nodes: FsNode[]
  blobs: Record<string, string>
}

/** 精确快照一个目录的子节点，用于 APP dataVersion 迁移失败恢复。 */
export function snapshotSubtree(rootId: string): FsSubtreeSnapshot {
  const list = load()
  if (!list.some((node) => node.id === rootId && node.type === 'folder')) throw new Error('快照根目录不存在')
  const ids = new Set<string>()
  let parents = new Set([rootId])
  while (parents.size) {
    const next = new Set<string>()
    for (const node of list) {
      if (node.parentId && parents.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        if (node.type === 'folder') next.add(node.id)
      }
    }
    parents = next
  }
  const nodes = list.filter((node) => ids.has(node.id)).map((node) => ({ ...node }))
  const blobs: Record<string, string> = {}
  for (const node of nodes) {
    if (node.type === 'file' && hasBlob(node.id)) blobs[node.id] = readFileSync(blobPath(node.id)).toString('base64')
  }
  return { format: 'dx-fs-subtree/v1', rootId, createdAt: Date.now(), nodes, blobs }
}

/** 将目录恢复到快照时的精确内容；根目录本身保留，避免外部引用失效。 */
export function restoreSubtreeSnapshot(rootId: string, snapshot: FsSubtreeSnapshot) {
  if (snapshot?.format !== 'dx-fs-subtree/v1' || snapshot.rootId !== rootId || !Array.isArray(snapshot.nodes)) throw new Error('项目快照无效')
  const list = load()
  if (!list.some((node) => node.id === rootId && node.type === 'folder')) throw new Error('恢复根目录不存在')
  const removed = new Set<string>()
  let parents = new Set([rootId])
  while (parents.size) {
    const next = new Set<string>()
    for (const node of list) {
      if (node.parentId && parents.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id)
        if (node.type === 'folder') next.add(node.id)
      }
    }
    parents = next
  }
  for (const id of removed) deleteBlob(id)
  const preserved = list.filter((node) => !removed.has(node.id))
  const preservedIds = new Set(preserved.map((node) => node.id))
  const snapshotIds = new Set(snapshot.nodes.map((node) => node.id))
  if (snapshot.nodes.some((node) => preservedIds.has(node.id) || (node.parentId !== rootId && (!node.parentId || !snapshotIds.has(node.parentId))))) throw new Error('项目快照节点关系无效')
  persist([...preserved, ...snapshot.nodes.map((node) => ({ ...node }))])
  for (const [id, base64] of Object.entries(snapshot.blobs || {})) {
    if (snapshotIds.has(id)) saveBlob(id, Buffer.from(base64, 'base64'))
  }
  return snapshot.nodes.length
}

/** rootId 子树的先序遍历（供 agent 一次性了解项目结构）。 */
export function subtree(rootId: string | null, maxDepth = 5): TreeRow[] {
  const list = load()
  const out: TreeRow[] = []
  const rec = (pid: string | null, depth: number) => {
    if (depth > maxDepth) return
    for (const k of sortNodes(list.filter((n) => n.parentId === pid && !n.trashed))) {
      out.push({ name: k.name, type: k.type, depth })
      if (k.type === 'folder') rec(k.id, depth + 1)
    }
  }
  rec(rootId, 0)
  return out
}

/** 把选中的节点（文件夹递归）摊平成 zip 条目 { 相对路径, 数据 }。 */
export function collectZipEntries(ids: string[]): { name: string; data: Buffer }[] {
  const list = load()
  const byId = new Map(list.map((n) => [n.id, n]))
  const out: { name: string; data: Buffer }[] = []
  const usedTop = new Set<string>()
  const uniqTop = (name: string): string => {
    if (!usedTop.has(name)) {
      usedTop.add(name)
      return name
    }
    const dot = name.lastIndexOf('.')
    let i = 2
    let f: string
    do {
      f = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`
      i++
    } while (usedTop.has(f))
    usedTop.add(f)
    return f
  }
  const fileData = (n: FsNode): Buffer =>
    n.content !== undefined ? Buffer.from(n.content, 'utf8') : hasBlob(n.id) ? readFileSync(blobPath(n.id)) : Buffer.alloc(0)
  const addTree = (n: FsNode, prefix: string) => {
    if (n.type === 'file') {
      out.push({ name: prefix + n.name, data: fileData(n) })
      return
    }
    for (const k of list.filter((c) => c.parentId === n.id)) addTree(k, prefix + n.name + '/')
  }
  for (const id of ids) {
    const n = byId.get(id)
    if (!n) continue
    if (n.type === 'file') out.push({ name: uniqTop(n.name), data: fileData(n) })
    else addTree(n, '')
  }
  return out
}

/** 统计某节点（含自身）会影响多少项，用于删除确认提示。 */
export function countSubtree(id: string): number {
  const list = load()
  const ids = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const n of list) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id)
        changed = true
      }
    }
  }
  return ids.size
}
