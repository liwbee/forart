import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { listAuthUsers } from './auth.ts'
import { ccsDb } from './ccsDb.ts'
import { getNode, isInTrash, isWithinRoot, removeNode, restoreNode } from './fs.ts'
import type { CanvasMissingNodeSnapshot, CanvasNodePortDefinition, CanvasPortValueType } from '../shared/canvasPlugin.ts'

// ── 无限画布数据模型（Card 三槽，见「无限画布App架构计划.md」2.2）────────
// 核心不变量：一张 Card = 输入图(inputs) + 参数(params) + 结果(result)。
// result 永远不会被自动写进任何卡的 inputs；mode 显式，不从「有没有图」推断。
// 这从设计上根治了智能画布的两个 bug（模式锁死 / 结果回流成输入）。

export type CardMode = 't2i' | 'i2i' | 't2v' | 'i2v' | 'v2v' | 'ia2v'
export type CanvasSizeMode = 'auto' | 'system' | 'custom'
export type CanvasResolution = '1k' | '2k' | '4k'
export type RunStatus = 'idle' | 'queued' | 'running' | 'ready' | 'error'

export interface MediaRef {
  nodeId: string            // FS 节点 id
  name?: string             // 画布内展示名称（不参与文件权限判断）
  url: string               // '/api/fs/raw/<nodeId>'
  role: 'input' | 'result'
  kind?: 'image' | 'video' | 'audio' | 'file'
  w?: number
  h?: number
  poster?: string            // 视频 JPEG 封面（data URL）
  posterVersion?: number     // 封面生成规格，用于自动升级旧低清封面
  prompt?: string
}

export interface TextRef {
  artifactId: string
  text: string
  role: 'input' | 'result'
  prompt?: string
}

export interface ShortDramaShot {
  id: string
  index: number
  title: string
  script: string
  visualPrompt: string
  characters?: string[]
  scene?: string
  references?: string[]
  dialogue?: string
  durationSec?: number
  status?: 'draft' | 'image-ready' | 'video-ready' | 'error'
  imagePromptCardId?: string
  imageCardId?: string
  videoCardId?: string
}

export interface ShortDramaWorkbenchState {
  kind: 'short-drama'
  sourceScript: string
  shots: ShortDramaShot[]
  updatedAt: number
  model?: string
  rawText?: string
}

export interface CanvasHubState {
  kind: 'junction' | 'run'
  appId?: string
  sourceCardId?: string
  outputCardIds?: string[]
  params?: Partial<CardParams>
  startedAt?: number
  collapsed?: boolean
}

export interface CardParams {
  prompt: string
  negativePrompt?: string
  mode: CardMode            // 显式模式开关
  platform?: 'api' | 'comfy'
  engine: string            // api | comfy | runninghub | modelscope ...
  model: string
  size?: string
  sizeMode?: CanvasSizeMode
  resolution?: CanvasResolution
  customWidth?: number
  customHeight?: number
  quality?: 'auto' | 'standard' | 'hd' | 'high'
  ratio?: string
  count?: number
  protocolParams?: Record<string, unknown>
}

export interface CanvasCard {
  id: string
  nodeType?: string
  nodeVersion?: number
  stateVersion?: number
  pluginState?: Record<string, unknown>
  nodeSnapshot?: CanvasMissingNodeSnapshot
  kind?: 'generator' | 'junction' | 'sticky' | 'prompt' | 'image' | 'group' | 'llm' | 'table'
  groupId?: string
  appId?: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  inputs: MediaRef[]        // 参考/源图：导入的、上游连来的、手动固定的。稳定集合。
  params: CardParams
  result: MediaRef | null   // 最新结果，独立槽，卡片主视觉；【绝不自动进 inputs】
  history: MediaRef[]       // 历次结果
  textResult?: TextRef | null
  textHistory?: TextRef[]
  workflow?: ShortDramaWorkbenchState | null
  hub?: CanvasHubState | null
  run: { status: RunStatus; taskId?: string; startedAt?: number; error?: string }
  createdAt: number
  updatedAt: number
}

export interface CanvasConnection {
  id: string
  from: string              // 上游 card id
  to: string                // 下游 card id
  kind: 'ref' | 'flow'      // ref=参考图流向；flow=派生分支
  fromPort?: string           // SDK 输出端口；旧连线可省略
  toPort?: string            // 多输入节点的目标输入通道
  hub?: CanvasHubState | null
}

export type CanvasVisibility = 'private' | 'public' | 'restricted'
export type CanvasAccess = 'read' | 'edit' | 'owner'
export type CanvasInvitePermission = 'read' | 'edit'

export interface CanvasAssetLibrarySource {
  type: 'canvas' | 'folder'
  id: string
  name: string
  scope?: 'mine' | 'shared' | 'folder'
}

export interface CanvasDocument {
  id: string
  projectId?: string
  ownerId: string
  title: string
  visibility: CanvasVisibility   // public=全部可见；restricted=部分人可见（owner + members）
  members: string[]              // restricted 时的可见成员 userId（不含 owner）
  cards: CanvasCard[]
  connections: CanvasConnection[]
  assetLibrarySources: CanvasAssetLibrarySource[]
  viewport: { x: number; y: number; scale: number }
  version: number
  createdAt: number
  updatedAt: number
  access?: CanvasAccess
}

export interface CanvasSummary {
  id: string
  projectId?: string
  ownerId: string
  ownerName: string
  title: string
  visibility: CanvasVisibility
  members: string[]
  mine: boolean                  // 当前查看者是否为 owner
  cardCount: number
  thumbnail?: string             // 首张卡片主视觉，用于项目卡缩略
  version: number
  createdAt: number
  updatedAt: number
  access: CanvasAccess
  inviteEnabled?: boolean
  invitePermission?: CanvasInvitePermission
}

export interface CanvasInviteSummary {
  id: string
  codeHint: string
  permission: CanvasInvitePermission
  joinCount: number
  createdAt: number
}

export interface CanvasTrashSummary extends CanvasSummary {
  deletedAt: number
}

// 访问者上下文（避免与 auth.ts 强耦合，仅取需要的字段）
export interface CanvasViewer {
  id: string
  role: string
  departmentId?: string | null
}

interface CanvasRow {
  id: string
  project_id: string | null
  owner_id: string
  title: string
  visibility: string | null
  document_json: string
  version: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export class CanvasConflictError extends Error {
  constructor() {
    super('画布已被其他窗口修改，请刷新后重试')
    this.name = 'CanvasConflictError'
  }
}

const now = () => Date.now()
const json = (value: unknown) => JSON.stringify(value ?? null)

function num(v: unknown, d = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
function str(v: unknown, d = ''): string {
  if (typeof v === 'string') return v
  return v == null ? d : String(v)
}

const MODES: CardMode[] = ['t2i', 'i2i', 't2v', 'i2v', 'v2v', 'ia2v']
const STATUSES: RunStatus[] = ['idle', 'queued', 'running', 'ready', 'error']

function safeMediaRef(raw: unknown, role: 'input' | 'result'): MediaRef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const nodeId = str(r.nodeId)
  if (!nodeId) return null
  const ref: MediaRef = { nodeId, url: str(r.url) || `/api/fs/raw/${nodeId}`, role }
  // The filesystem node is the media entity. Canvas references are cached labels only,
  // so a real file rename must win over names stored in older canvas snapshots.
  const name = getNode(nodeId)?.name || str(r.name).trim() || ''
  if (name) ref.name = name.slice(0, 240)
  if (r.kind === 'video' || r.kind === 'image' || r.kind === 'audio' || r.kind === 'file') ref.kind = r.kind
  if (r.w != null) ref.w = num(r.w)
  if (r.h != null) ref.h = num(r.h)
  if (typeof r.poster === 'string' && r.poster.startsWith('data:image/jpeg;base64,') && r.poster.length <= 1_200_000) ref.poster = r.poster
  if (r.posterVersion != null) ref.posterVersion = Math.max(0, Math.min(10, Math.round(num(r.posterVersion))))
  if (r.prompt != null) ref.prompt = str(r.prompt)
  return ref
}

function safeTextRef(raw: unknown, role: 'input' | 'result'): TextRef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = str(r.text).trim()
  if (!text) return null
  const artifactId = str(r.artifactId) || randomUUID()
  const ref: TextRef = { artifactId, text, role }
  if (r.prompt != null) ref.prompt = str(r.prompt)
  return ref
}

function safeShortDramaWorkflow(raw: unknown): ShortDramaWorkbenchState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.kind !== 'short-drama') return null
  const shots = (Array.isArray(r.shots) ? r.shots : []).map((item, index) => {
    const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const shot: ShortDramaShot = {
      id: str(s.id) || randomUUID(),
      index: Math.max(1, Math.round(num(s.index, index + 1))),
      title: str(s.title) || `镜头 ${index + 1}`,
      script: str(s.script),
      visualPrompt: str(s.visualPrompt),
      status: s.status === 'image-ready' || s.status === 'video-ready' || s.status === 'error' ? s.status : 'draft',
    }
    if (s.dialogue != null) shot.dialogue = str(s.dialogue)
    if (Array.isArray(s.characters)) shot.characters = s.characters.map((item) => str(item).trim()).filter(Boolean)
    else if (s.characters != null) shot.characters = str(s.characters).split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean)
    if (s.scene != null) shot.scene = str(s.scene)
    if (Array.isArray(s.references)) shot.references = s.references.map((item) => str(item).trim()).filter(Boolean)
    else if (s.references != null) shot.references = str(s.references).split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean)
    if (s.durationSec != null) shot.durationSec = Math.max(1, Math.round(num(s.durationSec, 5)))
    if (s.imagePromptCardId != null) shot.imagePromptCardId = str(s.imagePromptCardId)
    if (s.imageCardId != null) shot.imageCardId = str(s.imageCardId)
    if (s.videoCardId != null) shot.videoCardId = str(s.videoCardId)
    return shot
  }).filter((shot) => shot.script || shot.visualPrompt || shot.title)
  return {
    kind: 'short-drama',
    sourceScript: str(r.sourceScript),
    shots,
    updatedAt: num(r.updatedAt, now()),
    ...(r.model != null ? { model: str(r.model) } : {}),
    ...(r.rawText != null ? { rawText: str(r.rawText) } : {}),
  }
}

function safeHubState(raw: unknown): CanvasHubState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = r.kind === 'run' ? 'run' : r.kind === 'junction' ? 'junction' : null
  if (!kind) return null
  const params = r.params && typeof r.params === 'object' && !Array.isArray(r.params) ? r.params as Record<string, unknown> : {}
  const hub: CanvasHubState = {
    kind,
    ...(r.appId != null ? { appId: str(r.appId) } : {}),
    ...(r.sourceCardId != null ? { sourceCardId: str(r.sourceCardId) } : {}),
    ...(Array.isArray(r.outputCardIds) ? { outputCardIds: r.outputCardIds.map((item) => str(item)).filter(Boolean) } : {}),
    params: {
      prompt: str(params.prompt),
      mode: MODES.includes(params.mode as CardMode) ? params.mode as CardMode : 't2i',
      platform: params.platform === 'comfy' ? 'comfy' : 'api',
      engine: str(params.engine),
      model: str(params.model),
      ...(params.sizeMode === 'auto' || params.sizeMode === 'system' || params.sizeMode === 'custom' ? { sizeMode: params.sizeMode } : {}),
      ...(params.ratio != null ? { ratio: str(params.ratio) } : {}),
      ...(params.resolution === '1k' || params.resolution === '2k' || params.resolution === '4k' ? { resolution: params.resolution } : {}),
      ...(params.quality === 'auto' || params.quality === 'standard' || params.quality === 'hd' || params.quality === 'high' ? { quality: params.quality } : {}),
      ...(params.count != null ? { count: Math.max(1, Math.min(10, num(params.count, 1))) } : {}),
      ...(params.protocolParams && typeof params.protocolParams === 'object' && !Array.isArray(params.protocolParams) ? { protocolParams: { ...(params.protocolParams as Record<string, unknown>) } } : {}),
    },
    ...(r.startedAt != null ? { startedAt: num(r.startedAt) } : {}),
    collapsed: r.collapsed !== false,
  }
  return hub
}

const CANVAS_PORT_TYPES = new Set<CanvasPortValueType>([
  'text', 'text[]', 'json', 'table', 'file', 'file[]', 'media.image', 'media.image[]',
  'media.video', 'media.video[]', 'media.audio', 'media.audio[]', 'artifact', 'event',
])
function safeNodePorts(raw: unknown): CanvasNodePortDefinition[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set<string>()
  const ports: CanvasNodePortDefinition[] = []
  for (const item of raw.slice(0, 64)) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    const id = str(value.id).trim()
    const type = str(value.type) as CanvasPortValueType
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || ids.has(id) || !CANVAS_PORT_TYPES.has(type)) continue
    ids.add(id)
    ports.push({ id, title: str(value.title, id).slice(0, 80), type, ...(value.required === true ? { required: true } : {}), ...(value.multiple === true ? { multiple: true } : {}) })
  }
  return ports
}
function safeNodeSnapshot(raw: unknown, nodeType: string): CanvasMissingNodeSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const pluginId = str(value.pluginId).trim()
  const snapshotType = str(value.nodeType).trim()
  if (!pluginId || snapshotType !== nodeType || !snapshotType.startsWith(`${pluginId}.`)) return null
  const size = value.defaultSize && typeof value.defaultSize === 'object' ? value.defaultSize as Record<string, unknown> : {}
  return {
    pluginId,
    nodeType: snapshotType,
    nodeVersion: Math.max(1, Math.round(num(value.nodeVersion, 1))),
    stateVersion: Math.max(1, Math.round(num(value.stateVersion, 1))),
    title: str(value.title, snapshotType).slice(0, 120),
    ...(value.description != null ? { description: str(value.description).slice(0, 500) } : {}),
    ...(value.category != null ? { category: str(value.category).slice(0, 80) } : {}),
    ...(value.icon != null ? { icon: str(value.icon).slice(0, 240) } : {}),
    defaultSize: { width: Math.max(48, Math.min(4000, num(size.width, 320))), height: Math.max(32, Math.min(4000, num(size.height, 240))) },
    inputs: safeNodePorts(value.inputs),
    outputs: safeNodePorts(value.outputs),
  }
}

function safeCard(raw: unknown): CanvasCard {
  const ts = now()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const inputs = (Array.isArray(r.inputs) ? r.inputs : [])
    .map((item) => safeMediaRef(item, 'input'))
    .filter((item): item is MediaRef => item !== null)
  const history = (Array.isArray(r.history) ? r.history : [])
    .map((item) => safeMediaRef(item, 'result'))
    .filter((item): item is MediaRef => item !== null)
  const result = r.result ? safeMediaRef(r.result, 'result') : null
  const textHistory = (Array.isArray(r.textHistory) ? r.textHistory : [])
    .map((item) => safeTextRef(item, 'result'))
    .filter((item): item is TextRef => item !== null)
  const textResult = r.textResult ? safeTextRef(r.textResult, 'result') : null
  const p = (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, unknown>
  const run = (r.run && typeof r.run === 'object' ? r.run : {}) as Record<string, unknown>
  const mode = MODES.includes(p.mode as CardMode) ? (p.mode as CardMode) : inputs.length ? 'i2i' : 't2i'
  const hub = safeHubState(r.hub)
  // The standalone Skill card was removed. Keep old canvases usable by folding it
  // into the LLM card's Skill execution mode instead of dropping the card.
  const legacySkill = r.kind === 'skill'
  const acceptedKind = r.kind === 'generator' || r.kind === 'junction' || r.kind === 'sticky' || r.kind === 'prompt' || r.kind === 'image' || r.kind === 'group' || r.kind === 'llm' || r.kind === 'table' ? r.kind : undefined
  const migratedKind = legacySkill ? 'llm' : acceptedKind
  const recoveredKind = migratedKind || (!acceptedKind && hub?.kind === 'junction' && str(r.title) === '转接点' ? 'junction' : undefined)
  const isJunction = recoveredKind === 'junction'
  const legacyJunction = isJunction && !acceptedKind
  const safeWidth = legacyJunction && num(r.w) === 220 ? 68 : num(r.w, isJunction ? 68 : 300)
  const safeHeight = legacyJunction && num(r.h) === 160 ? 42 : num(r.h, isJunction ? 42 : 340)
  const card: CanvasCard = {
    id: str(r.id) || randomUUID(),
    x: num(r.x),
    y: num(r.y),
    w: Math.max(isJunction ? 48 : 220, safeWidth),
    h: Math.max(isJunction ? 32 : 160, safeHeight),
    inputs,
    params: {
      prompt: str(p.prompt),
      mode,
      platform: p.platform === 'comfy' ? 'comfy' : 'api',
      engine: str(p.engine),
      model: str(p.model),
    },
    result,
    history,
    run: { status: STATUSES.includes(run.status as RunStatus) ? (run.status as RunStatus) : 'idle' },
    createdAt: num(r.createdAt, ts),
    updatedAt: ts,
  }
  if (r.appId != null) card.appId = str(r.appId)
  if (/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(str(r.nodeType))) card.nodeType = str(r.nodeType)
  if (Number.isSafeInteger(r.nodeVersion) && num(r.nodeVersion) > 0) card.nodeVersion = num(r.nodeVersion)
  if (Number.isSafeInteger(r.stateVersion) && num(r.stateVersion) > 0) card.stateVersion = num(r.stateVersion)
  if (r.pluginState && typeof r.pluginState === 'object' && !Array.isArray(r.pluginState)) card.pluginState = { ...(r.pluginState as Record<string, unknown>) }
  const nodeSnapshot = card.nodeType ? safeNodeSnapshot(r.nodeSnapshot, card.nodeType) : null
  if (nodeSnapshot) card.nodeSnapshot = nodeSnapshot
  if (recoveredKind) card.kind = recoveredKind
  if (r.groupId != null) card.groupId = str(r.groupId)
  if (r.title != null) card.title = str(r.title)
  // Input-only media cards represent the file itself, so their visible title follows
  // the authoritative filesystem name even when an older canvas saved a stale title.
  if (!card.kind && !card.appId && !result && inputs[0]?.name) card.title = inputs[0].name
  // Recover groups saved by the short-lived client version whose server sanitizer dropped `kind`.
  if (!card.kind && card.title === '新建分组' && card.w === 560 && card.h === 380 && !inputs.length && !result) card.kind = 'group'
  if (textResult) card.textResult = textResult
  if (textHistory.length) card.textHistory = textHistory
  const workflow = safeShortDramaWorkflow(r.workflow)
  if (workflow) card.workflow = workflow
  if (hub) card.hub = hub
  if (p.negativePrompt != null) card.params.negativePrompt = str(p.negativePrompt)
  if (p.size != null) card.params.size = str(p.size)
  if (p.sizeMode === 'system' || p.sizeMode === 'custom') card.params.sizeMode = p.sizeMode
  else if (p.sizeMode === 'auto') card.params.sizeMode = 'auto'
  if (p.resolution === '1k' || p.resolution === '2k' || p.resolution === '4k') card.params.resolution = p.resolution
  if (p.customWidth != null) card.params.customWidth = Math.max(1, Math.round(num(p.customWidth)))
  if (p.customHeight != null) card.params.customHeight = Math.max(1, Math.round(num(p.customHeight)))
  if (p.quality === 'standard' || p.quality === 'hd' || p.quality === 'high') card.params.quality = p.quality
  else if (p.quality === 'auto') card.params.quality = 'auto'
  if (p.ratio != null) card.params.ratio = str(p.ratio)
  if (p.count != null) card.params.count = Math.max(1, Math.min(10, num(p.count, 1)))
  if (p.protocolParams && typeof p.protocolParams === 'object' && !Array.isArray(p.protocolParams)) {
    card.params.protocolParams = { ...(p.protocolParams as Record<string, unknown>) }
  }
  if (legacySkill) {
    const protocolParams = card.params.protocolParams || {}
    card.params.protocolParams = {
      ...protocolParams,
      llmExecutionMode: 'skill',
      llmSkillId: str(protocolParams.skillId),
      llmOutputMode: 'text',
      migratedFromStandaloneSkill: true,
    }
    card.appId = 'canvas.llm'
    card.title = str(r.title) && str(r.title) !== 'Skill' ? str(r.title) : '原 Skill 节点'
    card.w = Math.max(360, card.w)
    card.h = Math.max(310, card.h)
  }
  if (run.taskId != null) card.run.taskId = str(run.taskId)
  if (run.startedAt != null) card.run.startedAt = num(run.startedAt)
  if (run.error != null) card.run.error = str(run.error)
  return card
}

function safeConnection(raw: unknown): CanvasConnection | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const from = str(r.from)
  const to = str(r.to)
  if (!from || !to || from === to) return null
  return { id: str(r.id) || randomUUID(), from, to, kind: r.kind === 'flow' ? 'flow' : 'ref', ...(r.fromPort ? { fromPort: str(r.fromPort) } : {}), ...(r.toPort ? { toPort: str(r.toPort) } : {}), hub: safeHubState(r.hub) }
}

function cardNodeIds(card: CanvasCard): string[] {
  return [
    ...card.inputs.map((ref) => ref.nodeId),
    ...(card.result ? [card.result.nodeId] : []),
    ...card.history.map((ref) => ref.nodeId),
  ].filter(Boolean)
}

function documentNodeIds(doc: CanvasDocument): Set<string> {
  return new Set(doc.cards.flatMap(cardNodeIds))
}

function normVisibility(v: unknown): CanvasVisibility {
  if (v === 'public' || v === 'restricted') return v
  return 'private'
}

function membersOf(canvasId: string): string[] {
  return (ccsDb.prepare('SELECT user_id FROM canvas_members WHERE canvas_id=?').all(canvasId) as { user_id: string }[])
    .map((r) => r.user_id)
}

function setMembers(canvasId: string, ownerId: string, ids: string[]) {
  const clean = [...new Set(ids.map(String).filter(Boolean))].filter((id) => id !== ownerId)
  const tx = ccsDb.transaction(() => {
    ccsDb.prepare('DELETE FROM canvas_members WHERE canvas_id=?').run(canvasId)
    const stmt = ccsDb.prepare('INSERT OR IGNORE INTO canvas_members(canvas_id,user_id) VALUES (?,?)')
    for (const uid of clean) stmt.run(canvasId, uid)
  })
  tx()
}

function defaultDocument(id: string, ownerId: string, title: string, visibility: CanvasVisibility, members: string[], projectId?: string): CanvasDocument {
  const ts = now()
  return {
    id,
    ...(projectId ? { projectId } : {}),
    ownerId,
    title,
    visibility,
    members,
    cards: [],
    connections: [],
    assetLibrarySources: [],
    viewport: { x: 0, y: 0, scale: 1 },
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    access: 'owner',
  }
}

function parseDocument(row: CanvasRow): CanvasDocument {
  let raw: Partial<CanvasDocument> = {}
  try {
    raw = JSON.parse(row.document_json) as Partial<CanvasDocument>
  } catch {
    raw = {}
  }
  const cards = (Array.isArray(raw.cards) ? raw.cards : []).map(safeCard)
  const ids = new Set(cards.map((card) => card.id))
  const connections = (Array.isArray(raw.connections) ? raw.connections : [])
    .map(safeConnection)
    .filter((conn): conn is CanvasConnection => conn !== null && ids.has(conn.from) && ids.has(conn.to))
  const assetLibrarySources = safeAssetLibrarySources(raw.assetLibrarySources)
  return {
    id: row.id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ownerId: row.owner_id,
    title: row.title,
    visibility: normVisibility(row.visibility),
    members: membersOf(row.id),
    cards,
    connections,
    assetLibrarySources,
    viewport: {
      x: num(raw.viewport?.x),
      y: num(raw.viewport?.y),
      scale: Math.max(0.2, Math.min(4, num(raw.viewport?.scale, 1))),
    },
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function safeAssetLibrarySources(value: unknown): CanvasAssetLibrarySource[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: CanvasAssetLibrarySource[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const type = raw.type === 'canvas' || raw.type === 'folder' ? raw.type : null
    const id = str(raw.id).trim()
    if (!type || !id || seen.has(`${type}:${id}`)) continue
    seen.add(`${type}:${id}`)
    const scope = raw.scope === 'mine' || raw.scope === 'shared' || raw.scope === 'folder' ? raw.scope : undefined
    result.push({ type, id, name: str(raw.name).trim().slice(0, 160) || '未命名来源', ...(scope ? { scope } : {}) })
    if (result.length >= 50) break
  }
  return result
}

function firstVisual(doc: CanvasDocument): string | undefined {
  for (const card of doc.cards) {
    const ref = card.result || card.inputs[0]
    if (ref?.url) return ref.url
  }
  return undefined
}

function summaryOf(doc: CanvasDocument, viewer: CanvasViewer, ownerName = '已删除用户'): CanvasSummary {
  const thumb = firstVisual(doc)
  const row = rowById(doc.id)
  const invite = ccsDb.prepare(`
    SELECT permission FROM canvas_invites
    WHERE canvas_id=? AND revoked_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(doc.id) as { permission: CanvasInvitePermission } | undefined
  return {
    id: doc.id,
    ...(doc.projectId ? { projectId: doc.projectId } : {}),
    ownerId: doc.ownerId,
    ownerName,
    title: doc.title,
    visibility: doc.visibility,
    members: doc.members,
    mine: doc.ownerId === viewer.id,
    access: row ? (canvasAccess(row, viewer) || 'read') : 'read',
    ...(invite ? { inviteEnabled: true, invitePermission: invite.permission } : {}),
    cardCount: doc.cards.length,
    ...(thumb ? { thumbnail: thumb } : {}),
    version: doc.version,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function trashSummaryOf(row: CanvasRow, viewer: CanvasViewer, ownerName?: string): CanvasTrashSummary {
  const doc = parseDocument(row)
  return {
    ...summaryOf(doc, viewer, ownerName),
    deletedAt: row.deleted_at || row.updated_at,
  }
}

function rowById(id: string) {
  return ccsDb.prepare('SELECT * FROM canvases WHERE id=?').get(id) as CanvasRow | undefined
}

function inviteAccess(canvasId: string, userId: string): CanvasInvitePermission | null {
  const row = ccsDb.prepare(`
    SELECT i.permission FROM canvas_invites i
    JOIN canvas_invite_members m ON m.invite_id=i.id
    WHERE i.canvas_id=? AND i.revoked_at IS NULL AND m.user_id=?
    ORDER BY i.created_at DESC LIMIT 1
  `).get(canvasId, userId) as { permission: CanvasInvitePermission } | undefined
  return row?.permission || null
}

function canvasAccess(row: CanvasRow, viewer: CanvasViewer): CanvasAccess | null {
  if (row.deleted_at !== null) return null
  if (row.project_id && (!getNode(row.project_id) || isInTrash(row.project_id))) return null
  if (row.owner_id === viewer.id) return 'owner'
  if (normVisibility(row.visibility) === 'public') return 'edit'
  if (normVisibility(row.visibility) === 'restricted' && membersOf(row.id).includes(viewer.id)) return 'edit'
  return inviteAccess(row.id, viewer.id)
}

function canView(row: CanvasRow, viewer: CanvasViewer): boolean {
  return canvasAccess(row, viewer) !== null
}

export function canEditCanvas(id: string, viewer: CanvasViewer): boolean {
  const row = rowById(id)
  const access = row ? canvasAccess(row, viewer) : null
  return access === 'edit' || access === 'owner'
}

function documentReferencesNode(doc: CanvasDocument, nodeId: string): boolean {
  return doc.cards.some((card) =>
    card.inputs.some((media) => media.nodeId === nodeId)
    || card.result?.nodeId === nodeId
    || card.history.some((media) => media.nodeId === nodeId),
  )
}

/** 画布权限只扩展到文档实际引用的文件，不授予其父文件夹或相邻文件权限。 */
export function canViewCanvasMedia(nodeId: string, viewer: CanvasViewer, canvasId?: string): boolean {
  const rows = canvasId
    ? [rowById(canvasId)].filter((row): row is CanvasRow => !!row)
    : ccsDb.prepare('SELECT * FROM canvases WHERE deleted_at IS NULL').all() as CanvasRow[]
  return rows.some((row) => canView(row, viewer) && documentReferencesNode(parseDocument(row), nodeId))
}

function canManage(row: CanvasRow, viewer: CanvasViewer): boolean {
  return row.owner_id === viewer.id
}

function hasActiveProject(row: CanvasRow): boolean {
  return !row.project_id || (!!getNode(row.project_id) && !isInTrash(row.project_id))
}

function requireViewable(id: string, viewer: CanvasViewer): CanvasRow {
  const row = rowById(id)
  if (!row || !canView(row, viewer)) throw new Error('画布不存在或无权访问')
  return row
}

export function listCanvases(viewer: CanvasViewer): CanvasSummary[] {
  const rows = ccsDb
    .prepare(
      `SELECT * FROM canvases
       WHERE deleted_at IS NULL AND (owner_id=@uid OR visibility='public'
          OR id IN (SELECT canvas_id FROM canvas_members WHERE user_id=@uid)
          OR id IN (
            SELECT i.canvas_id FROM canvas_invites i
            JOIN canvas_invite_members m ON m.invite_id=i.id
            WHERE i.revoked_at IS NULL AND m.user_id=@uid
          ))
       ORDER BY updated_at DESC`,
    )
    .all({ uid: viewer.id }) as CanvasRow[]
  const ownerNames = new Map(listAuthUsers().map((user) => [user.id, user.username]))
  return rows
    .filter(hasActiveProject)
    .map((row) => summaryOf(parseDocument(row), viewer, ownerNames.get(row.owner_id)))
}

export function listTrashedCanvases(viewer: CanvasViewer): CanvasTrashSummary[] {
  const rows = ccsDb.prepare('SELECT * FROM canvases WHERE deleted_at IS NOT NULL AND owner_id=? ORDER BY deleted_at DESC').all(viewer.id) as CanvasRow[]
  const ownerNames = new Map(listAuthUsers().map((user) => [user.id, user.username]))
  return rows
    .filter(hasActiveProject)
    .map((row) => trashSummaryOf(row, viewer, ownerNames.get(row.owner_id)))
}

export function createCanvas(input: {
  viewer: CanvasViewer
  title?: string
  projectId?: string
  visibility?: CanvasVisibility
  members?: string[]
}): CanvasDocument {
  const id = randomUUID()
  const ownerId = input.viewer.id
  const title = str(input.title, '').trim() || '未命名项目'
  const visibility = normVisibility(input.visibility)
  const members = visibility === 'restricted' ? [...new Set((input.members || []).map(String).filter(Boolean))].filter((m) => m !== ownerId) : []
  const doc = defaultDocument(id, ownerId, title, visibility, members, input.projectId)
  ccsDb
    .prepare('INSERT INTO canvases(id,project_id,owner_id,title,visibility,document_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, input.projectId || null, ownerId, title, visibility, json(doc), 1, doc.createdAt, doc.updatedAt)
  if (members.length) setMembers(id, ownerId, members)
  return doc
}

export function getCanvas(id: string, viewer: CanvasViewer): CanvasDocument {
  const row = requireViewable(id, viewer)
  return { ...parseDocument(row), access: canvasAccess(row, viewer) || 'read' }
}

export function updateCanvas(
  id: string,
  viewer: CanvasViewer,
  input: {
    baseVersion?: number
    title?: string
    document?: Partial<CanvasDocument>
    visibility?: CanvasVisibility
    members?: string[]
  },
): CanvasDocument {
  const row = requireViewable(id, viewer)
  if ((input.document !== undefined || input.title !== undefined) && !canEditCanvas(id, viewer)) {
    throw new Error('当前邀请仅允许查看，不能编辑画布')
  }
  if (input.baseVersion !== undefined && Number(input.baseVersion) !== row.version) throw new CanvasConflictError()
  const current = parseDocument(row)
  const patch = input.document || {}
  const cards = Array.isArray(patch.cards) ? patch.cards.map(safeCard) : current.cards
  const ids = new Set(cards.map((card) => card.id))
  const connections = (Array.isArray(patch.connections) ? patch.connections.map(safeConnection) : current.connections)
    .filter((conn): conn is CanvasConnection => conn !== null && ids.has(conn.from) && ids.has(conn.to))
  const viewport = patch.viewport
    ? {
        x: num(patch.viewport.x),
        y: num(patch.viewport.y),
        scale: Math.max(0.2, Math.min(4, num(patch.viewport.scale, 1))),
      }
    : current.viewport
  const assetLibrarySources = patch.assetLibrarySources === undefined
    ? current.assetLibrarySources
    : safeAssetLibrarySources(patch.assetLibrarySources)
  const title = str(input.title ?? patch.title ?? current.title).trim() || current.title

  // 共享设置（可见性/成员）仅画布所有者可改；系统管理员不自动获得私有内容权限。
  const manage = canManage(row, viewer)
  const visibility = manage && input.visibility !== undefined ? normVisibility(input.visibility) : current.visibility
  let members = current.members
  if (manage && (input.members !== undefined || input.visibility !== undefined)) {
    members = visibility === 'restricted'
      ? [...new Set((input.members ?? current.members).map(String).filter(Boolean))].filter((m) => m !== row.owner_id)
      : []
    setMembers(id, row.owner_id, members)
  }

  const ts = now()
  const version = row.version + 1
  const saved: CanvasDocument = { ...current, title, visibility, members, cards, connections, assetLibrarySources, viewport, version, updatedAt: ts, access: canvasAccess(row, viewer) || 'read' }
  ccsDb
    .prepare('UPDATE canvases SET title=?,visibility=?,document_json=?,version=?,updated_at=? WHERE id=?')
    .run(title, visibility, json(saved), version, ts, id)
  return saved
}

// 协同保存：按节点合并，避免两个用户修改不同节点时整份文档互相覆盖。
export function syncCanvas(
  id: string,
  viewer: CanvasViewer,
  input: {
    upserts?: unknown[]
    deletedIds?: string[]
    connections?: unknown[]
    viewport?: Partial<CanvasDocument['viewport']>
    assetLibrarySources?: unknown[]
  },
): CanvasDocument {
  const row = requireViewable(id, viewer)
  if (!canEditCanvas(id, viewer)) throw new Error('当前邀请仅允许查看，不能编辑画布')
  const current = parseDocument(row)
  const deleted = new Set((input.deletedIds || []).map(String).filter(Boolean))
  const byId = new Map(current.cards.filter((card) => !deleted.has(card.id)).map((card) => [card.id, card]))
  for (const raw of input.upserts || []) {
    const card = safeCard(raw)
    if (!deleted.has(card.id)) byId.set(card.id, card)
  }
  const cards = [...byId.values()]
  if (current.projectId) {
    const previousReferences = documentNodeIds(current)
    const nextReferences = documentNodeIds({ ...current, cards })
    // 撤销删除会把卡片作为 upsert 重新加入。对应文件若已被上一次
    // deletedIds 同步软删除到废纸篓，这里先恢复文件，再保存卡片引用。
    for (const nodeId of nextReferences) {
      if (!previousReferences.has(nodeId) && isInTrash(nodeId) && isWithinRoot(current.projectId, nodeId)) restoreNode(nodeId)
    }
  }
  if (deleted.size && current.projectId) {
    const candidates = new Set(current.cards.filter((card) => deleted.has(card.id)).flatMap(cardNodeIds))
    const retained = documentNodeIds({ ...current, cards })
    const otherRows = ccsDb.prepare('SELECT * FROM canvases WHERE id<>?').all(id) as CanvasRow[]
    for (const otherRow of otherRows) {
      for (const nodeId of documentNodeIds(parseDocument(otherRow))) retained.add(nodeId)
    }
    for (const nodeId of candidates) {
      if (!retained.has(nodeId) && isWithinRoot(current.projectId, nodeId) && !isInTrash(nodeId)) removeNode(nodeId)
    }
  }
  const ids = new Set(cards.map((card) => card.id))
  const connections = (input.connections ? input.connections.map(safeConnection) : current.connections)
    .filter((conn): conn is CanvasConnection => conn !== null && ids.has(conn.from) && ids.has(conn.to))
  const viewport = input.viewport
    ? { x: num(input.viewport.x, current.viewport.x), y: num(input.viewport.y, current.viewport.y), scale: Math.max(Number.MIN_VALUE, num(input.viewport.scale, current.viewport.scale)) }
    : current.viewport
  const assetLibrarySources = input.assetLibrarySources === undefined
    ? current.assetLibrarySources
    : safeAssetLibrarySources(input.assetLibrarySources)
  const ts = now()
  const saved: CanvasDocument = {
    ...current,
    cards,
    connections,
    assetLibrarySources,
    viewport,
    version: row.version + 1,
    updatedAt: ts,
    access: canvasAccess(row, viewer) || 'read',
  }
  ccsDb.prepare('UPDATE canvases SET document_json=?,version=?,updated_at=? WHERE id=?')
    .run(json(saved), saved.version, ts, id)
  return saved
}

export function trashCanvas(id: string, viewer: CanvasViewer) {
  const row = rowById(id)
  if (!row || !canManage(row, viewer)) throw new Error('画布不存在或无权删除')
  if (row.deleted_at !== null) return
  ccsDb.prepare('UPDATE canvases SET deleted_at=?,updated_at=? WHERE id=?').run(now(), now(), id)
}

export function purgeCanvas(id: string, viewer: CanvasViewer) {
  const row = rowById(id)
  if (!row || row.deleted_at === null || !canManage(row, viewer)) throw new Error('回收站中不存在该项目或无权删除')
  const tx = ccsDb.transaction(() => {
    const invites = ccsDb.prepare('SELECT id FROM canvas_invites WHERE canvas_id=?').all(id) as { id: string }[]
    for (const invite of invites) ccsDb.prepare('DELETE FROM canvas_invite_members WHERE invite_id=?').run(invite.id)
    ccsDb.prepare('DELETE FROM canvas_invites WHERE canvas_id=?').run(id)
    ccsDb.prepare('DELETE FROM canvas_members WHERE canvas_id=?').run(id)
    ccsDb.prepare('DELETE FROM canvases WHERE id=?').run(id)
  })
  tx()
}

export function deleteCanvasesForProjectRoot(rootId: string): number {
  const rows = ccsDb.prepare('SELECT id,project_id FROM canvases WHERE project_id IS NOT NULL').all() as Pick<CanvasRow, 'id' | 'project_id'>[]
  const ids = rows
    .filter((row) => row.project_id && (row.project_id === rootId || isWithinRoot(rootId, row.project_id)))
    .map((row) => row.id)
  if (!ids.length) return 0
  const tx = ccsDb.transaction(() => {
    for (const id of ids) {
      const invites = ccsDb.prepare('SELECT id FROM canvas_invites WHERE canvas_id=?').all(id) as { id: string }[]
      for (const invite of invites) ccsDb.prepare('DELETE FROM canvas_invite_members WHERE invite_id=?').run(invite.id)
      ccsDb.prepare('DELETE FROM canvas_invites WHERE canvas_id=?').run(id)
      ccsDb.prepare('DELETE FROM canvas_members WHERE canvas_id=?').run(id)
      ccsDb.prepare('DELETE FROM canvases WHERE id=?').run(id)
    }
  })
  tx()
  return ids.length
}

export function restoreCanvas(id: string, viewer: CanvasViewer) {
  const row = rowById(id)
  if (!row || row.deleted_at === null || !canManage(row, viewer)) throw new Error('回收站中不存在该项目或无权恢复')
  const ts = now()
  ccsDb.prepare('UPDATE canvases SET deleted_at=NULL,updated_at=? WHERE id=?').run(ts, id)
}

function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function inviteCodeHash(code: string) {
  return createHash('sha256').update(normalizeInviteCode(code)).digest('hex')
}

export function getCanvasInvite(id: string, viewer: CanvasViewer): CanvasInviteSummary | null {
  const row = rowById(id)
  if (!row || !canManage(row, viewer)) throw new Error('画布不存在或无权管理邀请')
  const invite = ccsDb.prepare(`
    SELECT i.id,i.code_hint,i.permission,i.created_at,COUNT(m.user_id) AS join_count
    FROM canvas_invites i LEFT JOIN canvas_invite_members m ON m.invite_id=i.id
    WHERE i.canvas_id=? AND i.revoked_at IS NULL
    GROUP BY i.id ORDER BY i.created_at DESC LIMIT 1
  `).get(id) as { id: string; code_hint: string; permission: CanvasInvitePermission; created_at: number; join_count: number } | undefined
  return invite ? { id: invite.id, codeHint: invite.code_hint, permission: invite.permission, joinCount: invite.join_count, createdAt: invite.created_at } : null
}

export function createCanvasInvite(id: string, viewer: CanvasViewer, permission: CanvasInvitePermission) {
  const row = rowById(id)
  if (!row || !canManage(row, viewer)) throw new Error('画布不存在或无权创建邀请')
  const raw = randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  const normalized = raw.padEnd(8, 'X')
  const code = `${normalized.slice(0, 4)}-${normalized.slice(4)}`
  const inviteId = randomUUID()
  const ts = now()
  const tx = ccsDb.transaction(() => {
    ccsDb.prepare('UPDATE canvas_invites SET revoked_at=? WHERE canvas_id=? AND revoked_at IS NULL').run(ts, id)
    ccsDb.prepare(`INSERT INTO canvas_invites(id,canvas_id,code_hash,code_hint,permission,created_by,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(inviteId, id, inviteCodeHash(code), code.slice(-4), permission === 'edit' ? 'edit' : 'read', viewer.id, ts)
  })
  tx()
  return { invite: getCanvasInvite(id, viewer)!, code }
}

export function revokeCanvasInvite(id: string, viewer: CanvasViewer) {
  const row = rowById(id)
  if (!row || !canManage(row, viewer)) throw new Error('画布不存在或无权撤销邀请')
  ccsDb.prepare('UPDATE canvas_invites SET revoked_at=? WHERE canvas_id=? AND revoked_at IS NULL').run(now(), id)
}

export function redeemCanvasInvite(code: string, viewer: CanvasViewer) {
  const normalized = normalizeInviteCode(code)
  if (normalized.length !== 8) throw new Error('邀请口令格式不正确')
  const invite = ccsDb.prepare(`
    SELECT i.*,c.deleted_at FROM canvas_invites i
    JOIN canvases c ON c.id=i.canvas_id
    WHERE i.code_hash=? AND i.revoked_at IS NULL AND c.deleted_at IS NULL
  `).get(inviteCodeHash(normalized)) as { id: string; canvas_id: string; permission: CanvasInvitePermission } | undefined
  if (!invite) throw new Error('邀请口令不存在或已失效')
  ccsDb.prepare('INSERT OR REPLACE INTO canvas_invite_members(invite_id,user_id,joined_at) VALUES (?,?,?)')
    .run(invite.id, viewer.id, now())
  return { canvas: getCanvas(invite.canvas_id, viewer), permission: invite.permission }
}
