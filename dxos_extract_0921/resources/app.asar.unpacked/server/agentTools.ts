import { randomUUID } from 'node:crypto'
import {
  copyNode, createNode, findByPath, getNode, isWithinRoot, listChildren, moveNode,
  removeNode, renameNode, resolvePath, setContent, shareZoneOf,
} from './fs.ts'

/**
 * M3 Tool Registry：Worker 侧文件工具的统一目录。
 * - 暴露前过滤：按任务作用域（项目根）+ 工具白名单决定发给模型哪些工具
 * - 执行前检查：路径必须在项目根内、共享/私有权限、系统文件夹保护
 * - 幂等：所有写操作接受 operationId（由 taskStore.tool_operations 记账）
 */

export type ToolErrorCode =
  | 'invalid_input' | 'not_found' | 'permission_denied'
  | 'conflict' | 'unsupported' | 'internal'

export class ToolError extends Error {
  code: ToolErrorCode
  constructor(code: ToolErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export type ToolResult = {
  message: string
  nodeId?: string
  name?: string
  content?: string
  entries?: Array<{ name: string; type: string }>
  /** 交付物候选：创建/写入的文件 */
  deliverable?: boolean
}

type ToolContext = {
  rootNodeId: string
  /** 任务创建者，用于共享区权限判定（预留；项目根已按创建者校验） */
  userId: string
}

type ToolDef = {
  name: string
  description: string
  /** 是否有副作用（决定是否走 operationId 幂等记账） */
  mutates: boolean
  parameters: Record<string, unknown>
  run: (ctx: ToolContext, args: Record<string, unknown>) => ToolResult
}

function relPath(raw: unknown): string {
  const normalized = String(raw ?? '').replace(/\\/g, '/').trim()
  const parts = normalized.split('/')
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || parts.some((p) => !p || p === '.' || p === '..')) {
    throw new ToolError('invalid_input', '文件路径必须是项目根目录内的规范相对路径')
  }
  return normalized
}

function requireInRoot(ctx: ToolContext, nodeId: string) {
  if (!isWithinRoot(ctx.rootNodeId, nodeId)) throw new ToolError('permission_denied', '目标不在项目目录内')
}

function findFile(ctx: ToolContext, path: string) {
  const node = findByPath(ctx.rootNodeId, path)
  if (!node) throw new ToolError('not_found', `找不到：${path}`)
  requireInRoot(ctx, node.id)
  if (node.system) throw new ToolError('permission_denied', '系统共享文件夹不能修改')
  return node
}

function ensureParent(ctx: ToolContext, path: string) {
  const target = resolvePath(ctx.rootNodeId, path, true)
  if (!target.leaf) throw new ToolError('invalid_input', '文件路径不能为空')
  return target
}

const str = (description: string) => ({ type: 'string', description })
const PATH_DESC = '相对项目根目录的路径，如 docs/brief.md'

export const FILE_TOOLS: ToolDef[] = [
  {
    name: 'fs_list',
    description: '列出项目内某个文件夹的内容（path 留空为项目根目录）',
    mutates: false,
    parameters: { type: 'object', properties: { path: str('文件夹路径，留空为根目录') } },
    run(ctx, args) {
      const path = String(args.path ?? '').trim()
      const folder = path ? findFile(ctx, relPath(path)) : getNode(ctx.rootNodeId)
      if (!folder || folder.type !== 'folder') throw new ToolError('not_found', `不是文件夹：${path || '(根目录)'}`)
      const entries = listChildren(folder.id).nodes.map((n) => ({ name: n.name, type: n.type }))
      return { message: `${path || '(根目录)'} 共 ${entries.length} 项`, entries }
    },
  },
  {
    name: 'fs_read',
    description: '读取项目内一个文本文件的内容（不能解析图片、视频或音频；媒体内容必须调用对应 Skill，并直接传项目相对路径）',
    mutates: false,
    parameters: { type: 'object', properties: { path: str(PATH_DESC) }, required: ['path'] },
    run(ctx, args) {
      const node = findFile(ctx, relPath(args.path))
      if (node.type !== 'file') throw new ToolError('invalid_input', `不是文件：${args.path}`)
      return { nodeId: node.id, name: node.name, message: `已读取 ${args.path}`, content: node.content ?? '' }
    },
  },
  {
    name: 'fs_mkdir',
    description: '在项目内创建文件夹（多级路径自动创建）',
    mutates: true,
    parameters: { type: 'object', properties: { path: str('文件夹路径，如 docs/图片') }, required: ['path'] },
    run(ctx, args) {
      const path = relPath(args.path)
      const existing = findByPath(ctx.rootNodeId, path)
      if (existing) {
        if (existing.type !== 'folder') throw new ToolError('conflict', `同名文件已存在：${path}`)
        return { nodeId: existing.id, name: existing.name, message: `文件夹已存在：${path}` }
      }
      const target = ensureParent(ctx, path)
      const node = createNode({ name: target.leaf, type: 'folder', parentId: target.parentId })
      return { nodeId: node.id, name: node.name, message: `已创建文件夹 ${path}` }
    },
  },
  {
    name: 'fs_create',
    description: '在项目内新建文本文件并写入内容（文件已存在时报错，改用 fs_write 覆盖）',
    mutates: true,
    parameters: { type: 'object', properties: { path: str(PATH_DESC), content: str('完整文件内容') }, required: ['path', 'content'] },
    run(ctx, args) {
      const path = relPath(args.path)
      const content = String(args.content ?? '')
      const existing = findByPath(ctx.rootNodeId, path)
      if (existing) {
        // 幂等恢复窗口：内容一致视为本操作已完成
        if (existing.type === 'file' && existing.content === content) {
          return { nodeId: existing.id, name: existing.name, message: `文件已存在且内容一致：${path}`, deliverable: true }
        }
        throw new ToolError('conflict', `文件已存在：${path}（覆盖请用 fs_write）`)
      }
      const target = ensureParent(ctx, path)
      const node = createNode({ name: target.leaf, type: 'file', parentId: target.parentId, content })
      return { nodeId: node.id, name: node.name, message: `已创建 ${path}（${content.length} 字）`, deliverable: true }
    },
  },
  {
    name: 'fs_write',
    description: '覆盖写入项目内的文本文件（不存在则创建）',
    mutates: true,
    parameters: { type: 'object', properties: { path: str(PATH_DESC), content: str('完整文件内容') }, required: ['path', 'content'] },
    run(ctx, args) {
      const path = relPath(args.path)
      const content = String(args.content ?? '')
      const existing = findByPath(ctx.rootNodeId, path)
      if (existing) {
        if (existing.type !== 'file') throw new ToolError('conflict', `目标是文件夹：${path}`)
        requireInRoot(ctx, existing.id)
        const node = setContent(existing.id, content)
        return { nodeId: node.id, name: node.name, message: `已写入 ${path}（${content.length} 字）`, deliverable: true }
      }
      const target = ensureParent(ctx, path)
      const node = createNode({ name: target.leaf, type: 'file', parentId: target.parentId, content })
      return { nodeId: node.id, name: node.name, message: `已创建 ${path}（${content.length} 字）`, deliverable: true }
    },
  },
  {
    name: 'fs_append',
    description: '在项目内文本文件末尾追加内容（不存在则创建）',
    mutates: true,
    parameters: { type: 'object', properties: { path: str(PATH_DESC), content: str('要追加的内容') }, required: ['path', 'content'] },
    run(ctx, args) {
      const path = relPath(args.path)
      const add = String(args.content ?? '')
      const existing = findByPath(ctx.rootNodeId, path)
      if (existing) {
        if (existing.type !== 'file') throw new ToolError('conflict', `目标是文件夹：${path}`)
        const cur = existing.content ?? ''
        // 崩溃恢复窗口的幂等保护：内容已以待追加文本结尾时视为已完成
        if (add && cur.endsWith(add)) {
          return { nodeId: existing.id, name: existing.name, message: `内容已存在于 ${path} 末尾，未重复追加`, deliverable: true }
        }
        const node = setContent(existing.id, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + add)
        return { nodeId: node.id, name: node.name, message: `已追加到 ${path}（+${add.length} 字）`, deliverable: true }
      }
      const target = ensureParent(ctx, path)
      const node = createNode({ name: target.leaf, type: 'file', parentId: target.parentId, content: add })
      return { nodeId: node.id, name: node.name, message: `已创建 ${path}（${add.length} 字）`, deliverable: true }
    },
  },
  {
    name: 'fs_edit',
    description: '在项目内文本文件中查找并替换文本（find 必须精确匹配现有内容）',
    mutates: true,
    parameters: {
      type: 'object',
      properties: { path: str(PATH_DESC), find: str('要被替换的原文'), replace: str('替换后的文本'), all: { type: 'boolean', description: '是否替换全部匹配，默认只替换第一处' } },
      required: ['path', 'find', 'replace'],
    },
    run(ctx, args) {
      const node = findFile(ctx, relPath(args.path))
      if (node.type !== 'file') throw new ToolError('invalid_input', `不是文件：${args.path}`)
      const find = String(args.find ?? '')
      if (!find) throw new ToolError('invalid_input', '需要提供 find')
      const cur = node.content ?? ''
      if (!cur.includes(find)) throw new ToolError('not_found', `文件中没有找到要替换的文本：${find.slice(0, 60)}`)
      const replace = String(args.replace ?? '')
      const next = args.all ? cur.split(find).join(replace) : cur.replace(find, replace)
      const saved = setContent(node.id, next)
      return { nodeId: saved.id, name: saved.name, message: `已修改 ${args.path}`, deliverable: true }
    },
  },
  {
    name: 'fs_rename',
    description: '重命名项目内的文件或文件夹',
    mutates: true,
    parameters: { type: 'object', properties: { path: str(PATH_DESC), new_name: str('新名字（不含路径）') }, required: ['path', 'new_name'] },
    run(ctx, args) {
      const node = findFile(ctx, relPath(args.path))
      const newName = String(args.new_name ?? '').trim()
      if (!newName) throw new ToolError('invalid_input', '新名字不能为空')
      const saved = renameNode(node.id, newName)
      return { nodeId: saved.id, name: saved.name, message: `已重命名为 ${saved.name}` }
    },
  },
  {
    name: 'fs_move',
    description: '把项目内的文件/文件夹移动到项目内另一个文件夹',
    mutates: true,
    parameters: { type: 'object', properties: { from: str('源路径'), to: str('目标文件夹路径，留空为项目根') }, required: ['from'] },
    run(ctx, args) {
      const node = findFile(ctx, relPath(args.from))
      const toPath = String(args.to ?? '').trim()
      let parentId = ctx.rootNodeId
      if (toPath) {
        const folder = findFile(ctx, relPath(toPath))
        if (folder.type !== 'folder') throw new ToolError('invalid_input', `目标不是文件夹：${toPath}`)
        parentId = folder.id
      }
      const saved = moveNode(node.id, parentId)
      return { nodeId: saved.id, name: saved.name, message: `已移动 ${args.from} → ${toPath || '(根目录)'}` }
    },
  },
  {
    name: 'fs_copy',
    description: '在项目内复制文件或文件夹',
    mutates: true,
    parameters: { type: 'object', properties: { from: str('源路径'), to: str('目标文件夹路径，留空为项目根') }, required: ['from'] },
    run(ctx, args) {
      const node = findFile(ctx, relPath(args.from))
      const toPath = String(args.to ?? '').trim()
      let parentId = ctx.rootNodeId
      if (toPath) {
        const folder = findFile(ctx, relPath(toPath))
        if (folder.type !== 'folder') throw new ToolError('invalid_input', `目标不是文件夹：${toPath}`)
        parentId = folder.id
      }
      const saved = copyNode(node.id, parentId)
      return { nodeId: saved.id, name: saved.name, message: `已复制 ${args.from} → ${toPath || '(根目录)'}`, deliverable: node.type === 'file' }
    },
  },
  {
    name: 'fs_delete',
    description: '删除项目内的文件或文件夹（移入废纸篓，可恢复）',
    mutates: true,
    parameters: { type: 'object', properties: { path: str(PATH_DESC) }, required: ['path'] },
    run(ctx, args) {
      const node = findFile(ctx, relPath(args.path))
      removeNode(node.id)
      return { nodeId: node.id, name: node.name, message: `已删除 ${args.path}（在废纸篓可恢复）` }
    },
  },
]

const TOOL_MAP = new Map(FILE_TOOLS.map((t) => [t.name, t]))

/** 暴露给模型的 OpenAI function 声明（暴露前过滤：按白名单）。 */
export function toolSchemas(allow?: Set<string>) {
  return FILE_TOOLS
    .filter((t) => !allow || allow.has(t.name))
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
}

export function getTool(name: string) {
  return TOOL_MAP.get(name)
}

/** 执行前检查 + 执行。调用方负责 operationId 幂等记账。 */
export function runTool(name: string, ctx: ToolContext, args: Record<string, unknown>, allow?: Set<string>): ToolResult {
  const tool = TOOL_MAP.get(name)
  if (!tool) throw new ToolError('unsupported', `未知工具：${name}`)
  if (allow && !allow.has(name)) throw new ToolError('permission_denied', `工具未授权：${name}`)
  const root = getNode(ctx.rootNodeId)
  if (!root || root.type !== 'folder' || root.trashed) throw new ToolError('not_found', '项目根文件夹不存在')
  return tool.run(ctx, args)
}

/** 旧 M2 action 工具名 → 新注册表名（兼容既有队列里的任务）。 */
export const LEGACY_TOOL_ALIAS: Record<string, string> = {
  'file.read': 'fs_read',
  'file.create': 'fs_create',
  'file.write': 'fs_write',
}

export function newOperationId(taskId: string) {
  return `${taskId}:op-${randomUUID().slice(0, 12)}`
}
