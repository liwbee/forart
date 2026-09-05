import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'
import { inflateRawSync } from 'node:zlib'
import { normalizeDeveloperIcon, type DeveloperIcon } from './developerIcon.ts'
import { deleteDeveloperProjectSnapshot, deleteDeveloperProjectSnapshots, hasDeveloperProjectSnapshots, restoreDeveloperProjectSnapshots, saveForwardDeveloperProjectSnapshots } from './developerProjectMigrations.ts'
import {
  DEFAULT_DEVELOPER_APP_BUILD,
  DEFAULT_DEVELOPER_APP_VERSION,
  appReleaseKey,
  compareAppVersion,
  isValidSemver,
  systemSupportsApp,
  type AppReleaseChannel,
} from '../shared/appLifecycle.ts'
import type { CanvasNodeDefinition, CanvasPluginDeclaration } from '../shared/canvasPlugin.ts'
import { validateCanvasNodeManifest, validateCanvasTemplateManifest } from '../shared/canvasPluginValidation.ts'
import { BUILTIN_CANVAS_NODES } from '../src/apps/canvas/builtinCanvasNodes.ts'

const DATA_DIR = dataPath('developer-apps')
const INDEX_FILE = join(DATA_DIR, 'index.json')
const RUNTIME_HEALTH_FILE = join(DATA_DIR, 'runtime-health.json')
const PROJECT_BUNDLED_APPS_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'bundled-apps')
const RUNTIME_HEALTH_OBSERVATION_MS = 5 * 60 * 1000
function mbLimit(name: string, fallback: number) {
  const raw = Number(process.env[name])
  return Math.max(1, Math.min(512, Number.isFinite(raw) ? Math.round(raw) : fallback))
}
const MAX_PACKAGE_MB = mbLimit('DX_APP_MAX_PACKAGE_MB', 200)
const MAX_PACKAGE_BYTES = MAX_PACKAGE_MB * 1024 * 1024
const MAX_UNPACKED_MB = 500
const MAX_UNPACKED_BYTES = MAX_UNPACKED_MB * 1024 * 1024
const MAX_FILE_MB = 500
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
const MAX_TEXT_BYTES = 256 * 1024
// dx-app.json may contain a validated PNG data URL (icon.image, max 512 KB).
// Keep other JSON manifests small, but allow the application manifest enough room
// for the icon plus ordinary metadata.
const MAX_APP_MANIFEST_BYTES = 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.json', '.txt', '.md', '.yaml', '.yml', '.toml', '.py', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.ogg', '.webm', '.wasm', '.mix', '.map', '.csf'])
const renameWait = new Int32Array(new SharedArrayBuffer(4))

function atomicRenameSync(source: string, target: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try { renameSync(source, target); return }
    catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error
      Atomics.wait(renameWait, 0, 0, 50 * (attempt + 1))
    }
  }
  throw lastError
}

interface ZipFile { name: string; data: Buffer }
export interface DeveloperAppManifest {
  format: 'dx-app/v1' | 'dx-app/v2'
  id: string
  version: string
  build: number
  releaseChannel: AppReleaseChannel
  minSystemVersion: string
  maxSystemVersion?: string
  dataVersion: number
  migrations?: DeveloperAppMigrationDeclaration[]
  releaseNotes?: string
  name: string
  subtitle?: string
  description: string
  category?: 'software' | 'games'
  entry?: string
  icon?: DeveloperIcon
  defaultSize?: { width?: number; height?: number }
  agent?: { summary?: string; toolManifest?: string; skillDocs?: string[] }
  mcp?: DeveloperAppMcpDeclaration[]
  dependencies?: DeveloperAppDependencyDeclaration[]
  permissions?: string[]
  network?: { domains: string[]; methods: string[]; maxResponseBytes: number }
  oauth?: Array<{ id: string; authorizationUrl: string; tokenUrl: string; clientId: string; scopes: string[]; domains: string[] }>
  appApi?: Array<{ method: string; path: string }>
  canvas?: CanvasPluginDeclaration
}
export interface DeveloperAppMigrationDeclaration {
  from: number
  to: number
  type: 'declarative'
  file: string
}
export interface DeveloperAppToolDeclaration {
  name: string
  title: string
  description: string
  whenToUse: string[]
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  permission?: string
  risk: 'read' | 'write' | 'delete' | 'external' | 'system'
  sideEffects: string[]
  handlerType: 'app-api' | 'frontend-bridge' | 'mcp-tool' | 'skill'
  handler: {
    type: 'app-api' | 'frontend-bridge' | 'mcp-tool' | 'skill'
    endpoint?: string
    serverId?: string
    toolName?: string
    skillId?: string
  }
  confirmation?: { required: boolean; message?: string }
}
export interface DeveloperAppMcpDeclaration {
  id: string
  name: string
  transport?: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  cwd?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  secretKeys?: string[]
  configPath?: string
}
export interface DeveloperAppDependencyDeclaration {
  type: 'skill' | 'mcp'
  id: string
  name: string
  version?: string
  required: boolean
  source: 'system' | 'bundled' | 'external'
  path?: string
  installHint?: string
  toolName?: string
}
export interface DeveloperAppSkillDeclaration {
  path: string
  title: string
  preview: string
}
export interface DeveloperAppCapabilities {
  agentSummary: string
  tools: DeveloperAppToolDeclaration[]
  permissions: string[]
  dependencies: DeveloperAppDependencyDeclaration[]
  mcp: DeveloperAppMcpDeclaration[]
  skills: DeveloperAppSkillDeclaration[]
  warnings: string[]
}
export interface DeveloperAppPackage {
  id: string
  storagePath?: string
  runtimeToken: string
  sourceName: string
  importedAt: number
  manifest: DeveloperAppManifest
  capabilities: DeveloperAppCapabilities
}
export interface DeveloperAppHistoryItem {
  historyId: string
  appId: string
  version: string
  build: number
  releaseChannel: AppReleaseChannel
  dataVersion: number
  archivedAt: number
  sourceName: string
}

interface DeveloperAppRuntimeHealthState {
  appId: string
  releaseKey: string
  rollbackHistoryId: string
  installedAt: number
  readyAt?: number
  status: 'pending' | 'healthy' | 'failed' | 'rolled-back'
  lastError?: string
}

function fail(message: string): never { throw new Error(`开发者应用包错误：${message}`) }
function u16(buf: Buffer, offset: number) { return buf.readUInt16LE(offset) }
function u32(buf: Buffer, offset: number) { return buf.readUInt32LE(offset) }
function safePath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) fail(`存在不安全路径：${path}`)
  return normalized
}
function slug(value: string) {
  const raw = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42)
  return /^[a-z]/.test(raw) ? raw : `app-${raw || randomUUID().slice(0, 8)}`
}
function decodeUploadName(value: string) {
  if (/[^\x00-\xff]/.test(value)) return value
  const decoded = Buffer.from(value, 'latin1').toString('utf8')
  return decoded.includes('�') ? value : decoded
}
function readZip(buffer: Buffer): ZipFile[] {
  if (buffer.length > MAX_PACKAGE_BYTES) fail(`压缩包不能超过 ${MAX_PACKAGE_MB} MB`)
  const searchFrom = Math.max(0, buffer.length - 65_557)
  let eocd = -1
  for (let i = buffer.length - 22; i >= searchFrom; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) fail('不是有效的 ZIP 文件')
  const count = u16(buffer, eocd + 10)
  const centralOffset = u32(buffer, eocd + 16)
  if (!count || count > 2048 || centralOffset >= buffer.length) fail('压缩包目录无效')
  const files: ZipFile[] = []
  let total = 0
  let pos = centralOffset
  for (let index = 0; index < count; index++) {
    if (pos + 46 > buffer.length || u32(buffer, pos) !== 0x02014b50) fail('压缩包目录损坏')
    const method = u16(buffer, pos + 10)
    const compressedSize = u32(buffer, pos + 20)
    const uncompressedSize = u32(buffer, pos + 24)
    const filenameSize = u16(buffer, pos + 28)
    const extraSize = u16(buffer, pos + 30)
    const commentSize = u16(buffer, pos + 32)
    const localOffset = u32(buffer, pos + 42)
    const end = pos + 46 + filenameSize + extraSize + commentSize
    if (end > buffer.length) fail('压缩包目录不完整')
    const name = safePath(buffer.subarray(pos + 46, pos + 46 + filenameSize).toString('utf8'))
    pos = end
    if (name.endsWith('/')) continue
    const ext = extname(name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) fail(`不允许的文件类型：${name}`)
    if (uncompressedSize > MAX_FILE_BYTES || compressedSize > MAX_FILE_BYTES) fail(`文件过大：${name}（单文件最大 ${MAX_FILE_MB} MB）`)
    total += uncompressedSize
    if (total > MAX_UNPACKED_BYTES) fail(`解压总内容超过 ${MAX_UNPACKED_MB} MB 限制`)
    if (localOffset + 30 > buffer.length || u32(buffer, localOffset) !== 0x04034b50) fail(`文件头损坏：${name}`)
    const localNameSize = u16(buffer, localOffset + 26)
    const localExtraSize = u16(buffer, localOffset + 28)
    const start = localOffset + 30 + localNameSize + localExtraSize
    const finish = start + compressedSize
    if (finish > buffer.length) fail(`文件不完整：${name}`)
    const raw = buffer.subarray(start, finish)
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_FILE_BYTES }) : fail(`不支持的压缩方式：${name}`)
    files.push({ name, data })
  }
  return files
}
function commonTopLevel(files: ZipFile[]) {
  const first = files[0]?.name.split('/')[0]
  return first && files.length && files.every((file) => file.name.startsWith(`${first}/`)) ? `${first}/` : ''
}
function loadIndex(): DeveloperAppPackage[] {
  try {
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as Array<DeveloperAppPackage & { runtimeToken?: string }>
    let migrated = false
    const items = parsed.map((item) => {
      const appId = String(item.id || item.manifest?.id || '').replace(/^dev-/, '')
      const oldPermissions = item.capabilities?.permissions || item.manifest?.permissions || []
      const permissions = [...new Set(oldPermissions.map((permission) => normalizeAppPermission(permission, appId)).filter(Boolean))]
      const runtimeToken = /^[a-f0-9]{32}$/.test(String(item.runtimeToken || '')) ? item.runtimeToken! : randomUUID().replace(/-/g, '')
      const manifestId = String(item.manifest?.id || appId).replace(/^dev-/, '')
      const version = isValidSemver(item.manifest?.version) ? item.manifest.version : DEFAULT_DEVELOPER_APP_VERSION
      const build = Number.isSafeInteger(item.manifest?.build) && item.manifest.build > 0 ? item.manifest.build : DEFAULT_DEVELOPER_APP_BUILD
      const releaseChannel = ['stable', 'beta', 'dev'].includes(String(item.manifest?.releaseChannel)) ? item.manifest.releaseChannel : 'dev'
      const minSystemVersion = isValidSemver(item.manifest?.minSystemVersion) ? item.manifest.minSystemVersion : '0.1.0'
      const maxSystemVersion = isValidSemver(item.manifest?.maxSystemVersion) ? item.manifest.maxSystemVersion : undefined
      const dataVersion = Number.isSafeInteger(item.manifest?.dataVersion) && item.manifest.dataVersion > 0 ? item.manifest.dataVersion : 1
      if (runtimeToken !== item.runtimeToken || permissions.join('\n') !== oldPermissions.join('\n') || manifestId !== item.manifest?.id || version !== item.manifest?.version || build !== item.manifest?.build || releaseChannel !== item.manifest?.releaseChannel || minSystemVersion !== item.manifest?.minSystemVersion || dataVersion !== item.manifest?.dataVersion) migrated = true
      return {
        ...item,
        runtimeToken,
        manifest: { ...item.manifest, id: manifestId, version, build, releaseChannel, minSystemVersion, maxSystemVersion, dataVersion },
        capabilities: { ...item.capabilities, permissions },
      } as DeveloperAppPackage
    })
    if (migrated) saveIndex(items)
    return items
  } catch { return [] }
}
function saveIndex(items: DeveloperAppPackage[]) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(INDEX_FILE, JSON.stringify(items, null, 2), 'utf8')
}

function loadRuntimeHealthStates(): DeveloperAppRuntimeHealthState[] {
  try {
    const value = JSON.parse(readFileSync(RUNTIME_HEALTH_FILE, 'utf8'))
    return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
  } catch { return [] }
}

function saveRuntimeHealthStates(items: DeveloperAppRuntimeHealthState[]) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(RUNTIME_HEALTH_FILE, JSON.stringify(items, null, 2), 'utf8')
}
function packageRoot(id: string) { return join(DATA_DIR, id) }
function historyRoot(id: string) { return join(DATA_DIR, '.history', id) }
function versionsRoot(id: string) { return join(DATA_DIR, '.versions', id) }
function packageStorageRoot(pack: Pick<DeveloperAppPackage, 'id' | 'storagePath'>) {
  if (!pack.storagePath) return packageRoot(pack.id)
  const target = resolve(DATA_DIR, pack.storagePath)
  if (!target.startsWith(`${DATA_DIR}${sep}`)) fail('安装包存储路径越界')
  return target
}
export function developerAppSourceRoot(id: string) {
  const pack = loadIndex().find((item) => item.id === id)
  return join(pack ? packageStorageRoot(pack) : packageRoot(id), 'source')
}

function readJsonFile(files: ZipFile[], path: string, label: string): unknown {
  const file = files.find((item) => item.name === path)
  if (!file) return null
  if (file.data.length > MAX_TEXT_BYTES) fail(`${label} 过大`)
  try { return JSON.parse(file.data.toString('utf8')) } catch { fail(`${label} 不是有效 JSON`) }
}
function cleanStringList(value: unknown, max = 40) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, max) : []
}
function cleanObject(value: unknown, fallback: Record<string, unknown> = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fallback
}
function normalizeToolName(value: unknown) {
  const name = String(value || '').trim()
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,63}$/.test(name)) fail(`工具名不合法：${name || '(空)'}`)
  return name
}
function normalizePermission(value: unknown) {
  const permission = String(value || '').trim()
  return /^[a-z][a-z0-9_.:-]{2,96}$/.test(permission) ? permission : ''
}
function normalizeAppPermission(value: unknown, appId: string) {
  const permission = normalizePermission(value)
  if (!permission) return ''
  if (['project.info', 'project.list', 'project.read'].includes(permission)) return `app.${appId}.project.read`
  if (['project.write', 'project.mkdir'].includes(permission)) return `app.${appId}.project.write`
  if (permission === 'project.remove') return `app.${appId}.project.delete`
  return permission
}
function normalizeDependencyId(value: unknown, fallback: string) {
  const id = String(value || fallback).trim()
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,120}$/.test(id) ? id : slug(id || fallback)
}
function normalizeCanvasDeclaration(value: unknown, files: ZipFile[], pluginId: string): CanvasPluginDeclaration | undefined {
  if (value === undefined || value === null) return undefined
  const declaration = cleanObject(value)
  const manifestPaths = (raw: unknown, label: string) => {
    if (raw !== undefined && !Array.isArray(raw)) fail(`canvas.${label} 必须是字符串数组`)
    return [...new Set(cleanStringList(raw, 32).map((item) => safePath(item)))].map((path) => {
      const file = files.find((candidate) => candidate.name === path)
      if (!file) fail(`canvas.${label} 文件不存在：${path}`)
      if (extname(path).toLowerCase() !== '.json') fail(`canvas.${label} 只允许 JSON 文件：${path}`)
      if (file.data.length > MAX_TEXT_BYTES) fail(`canvas.${label} 文件过大：${path}`)
      return path
    })
  }
  const parseManifest = (path: string, label: string) => {
    const file = files.find((candidate) => candidate.name === path)!
    try { return JSON.parse(file.data.toString('utf8')) as unknown } catch { fail(`canvas.${label} 不是有效 JSON：${path}`) }
  }
  const nodeManifests = manifestPaths(declaration.nodeManifests, 'nodeManifests')
  const templateManifests = manifestPaths(declaration.templateManifests, 'templateManifests')
  if (!nodeManifests.length && !templateManifests.length) fail('canvas 至少需要声明一个节点或模板清单')
  const definitions: CanvasNodeDefinition[] = []
  for (const path of nodeManifests) {
    try { definitions.push(...validateCanvasNodeManifest(parseManifest(path, 'nodeManifests'), pluginId).nodes) }
    catch (error) { fail(`${path} 校验失败：${String((error as Error).message || error)}`) }
  }
  const allDefinitions = [...BUILTIN_CANVAS_NODES, ...definitions]
  for (const path of templateManifests) {
    try { validateCanvasTemplateManifest(parseManifest(path, 'templateManifests'), pluginId, allDefinitions) }
    catch (error) { fail(`${path} 校验失败：${String((error as Error).message || error)}`) }
  }
  return { nodeManifests, templateManifests }
}
function normalizeManifest(raw: unknown, files: ZipFile[]): DeveloperAppManifest {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Partial<DeveloperAppManifest> : {}
  if (obj.format !== 'dx-app/v1' && obj.format !== 'dx-app/v2') fail('dx-app.json 的 format 必须是 dx-app/v1 或 dx-app/v2')
  const entry = safePath(String(obj.entry || 'index.html'))
  if (!files.some((file) => file.name === entry)) fail(`入口文件不存在：${entry}`)
  const id = slug(String(obj.id || obj.name || 'developer-app'))
  const name = String(obj.name || '').trim()
  if (name.length < 2) fail('应用名称至少 2 个字符')
  const description = String(obj.description || '').trim()
  if (description.length < 8) fail('description 至少 8 个字符')
  const width = Math.max(420, Math.min(1400, Math.round(Number(obj.defaultSize?.width || 860))))
  const height = Math.max(300, Math.min(1000, Math.round(Number(obj.defaultSize?.height || 620))))
  const version = obj.version === undefined ? DEFAULT_DEVELOPER_APP_VERSION : String(obj.version).trim()
  if (!isValidSemver(version)) fail('dx-app.json.version 必须是有效 SemVer，例如 1.2.3')
  const build = obj.build === undefined ? DEFAULT_DEVELOPER_APP_BUILD : Number(obj.build)
  if (!Number.isSafeInteger(build) || build < 1) fail('dx-app.json.build 必须是大于 0 的整数')
  const minSystemVersion = obj.minSystemVersion === undefined ? '0.1.0' : String(obj.minSystemVersion).trim()
  if (!isValidSemver(minSystemVersion)) fail('dx-app.json.minSystemVersion 必须是有效 SemVer')
  const maxSystemVersion = obj.maxSystemVersion === undefined || obj.maxSystemVersion === null || obj.maxSystemVersion === '' ? undefined : String(obj.maxSystemVersion).trim()
  if (maxSystemVersion && !isValidSemver(maxSystemVersion)) fail('dx-app.json.maxSystemVersion 必须是有效 SemVer')
  if (maxSystemVersion && compareAppVersion({ version: minSystemVersion, build: 0 }, { version: maxSystemVersion, build: 0 }) > 0) fail('minSystemVersion 不能高于 maxSystemVersion')
  if (!systemSupportsApp(minSystemVersion, maxSystemVersion)) fail(`当前 DX OS 不兼容此 APP（要求 ${minSystemVersion}${maxSystemVersion ? `–${maxSystemVersion}` : ' 或更高版本'}）`)
  const dataVersion = obj.dataVersion === undefined ? 1 : Number(obj.dataVersion)
  if (!Number.isSafeInteger(dataVersion) || dataVersion < 1) fail('dx-app.json.dataVersion 必须是大于 0 的整数')
  if (obj.releaseChannel !== undefined && obj.releaseChannel !== 'stable' && obj.releaseChannel !== 'beta' && obj.releaseChannel !== 'dev') fail('dx-app.json.releaseChannel 必须是 stable、beta 或 dev')
  const migrations = normalizeMigrationList((obj as { migrations?: unknown }).migrations, files, dataVersion)
  const network = normalizeNetworkDeclaration((obj as { network?: unknown }).network)
  const canvas = normalizeCanvasDeclaration((obj as { canvas?: unknown }).canvas, files, id)
  return {
    format: obj.format,
    id,
    version,
    build,
    releaseChannel: obj.releaseChannel === 'stable' || obj.releaseChannel === 'beta' ? obj.releaseChannel : 'dev',
    minSystemVersion,
    maxSystemVersion,
    dataVersion,
    migrations,
    releaseNotes: obj.releaseNotes ? String(obj.releaseNotes).trim().slice(0, 4000) : undefined,
    name: name.slice(0, 36),
    subtitle: String(obj.subtitle || '开发者应用').slice(0, 28),
    description: description.slice(0, 180),
    category: ['game', 'games'].includes(String(obj.category || '')) ? 'games' : 'software',
    entry,
    icon: normalizeDeveloperIcon(obj.icon),
    defaultSize: { width, height },
    agent: obj.agent && typeof obj.agent === 'object' ? {
      summary: String(obj.agent.summary || '').slice(0, 400),
      toolManifest: obj.agent.toolManifest ? safePath(String(obj.agent.toolManifest)) : undefined,
      skillDocs: cleanStringList(obj.agent.skillDocs, 16).map(safePath),
    } : undefined,
    mcp: normalizeMcpList(obj.mcp),
    dependencies: normalizeDependencyList((obj as { dependencies?: unknown }).dependencies),
    permissions: [...new Set(cleanStringList(obj.permissions, 64).map((permission) => normalizeAppPermission(permission, id)).filter(Boolean))],
    network,
    oauth: normalizeOAuthDeclarations((obj as { oauth?: unknown }).oauth, network),
    appApi: normalizeAppApiDeclarations((obj as { appApi?: unknown }).appApi),
    canvas,
  }
}

function normalizeAppApiDeclarations(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 32) fail('dx-app.json.appApi 必须是最多 32 项的数组')
  const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UPLOAD'])
  return value.map((item) => {
    const obj = cleanObject(item)
    const method = String(obj.method || 'GET').toUpperCase()
    const path = String(obj.path || '').trim().replace(/\/$/, '')
    if (!methods.has(method) || !/^\/[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*$/i.test(path) || path.includes('..')) fail(`appApi 声明无效：${method} ${path}`)
    return { method, path }
  })
}

function normalizeNetworkDeclaration(value: unknown) {
  if (value === undefined) return undefined
  const obj = cleanObject(value)
  const domains = [...new Set(cleanStringList(obj.domains, 32).map((item) => item.toLowerCase()).filter((item) => /^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])$/.test(item) && !item.includes('..')))]
  if (!domains.length) fail('dx-app.json.network.domains 至少声明一个有效域名')
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  const methods = [...new Set(cleanStringList(obj.methods, 8).map((item) => item.toUpperCase()).filter((item) => allowedMethods.has(item)))]
  return { domains, methods: methods.length ? methods : ['GET'], maxResponseBytes: Math.max(1024, Math.min(5 * 1024 * 1024, Math.round(Number(obj.maxResponseBytes) || 1024 * 1024))) }
}

function normalizeOAuthDeclarations(value: unknown, network?: { domains: string[] }) {
  if (value === undefined) return undefined
  if (!network) fail('声明 oauth 前必须声明 network.domains')
  if (!Array.isArray(value) || value.length > 8) fail('dx-app.json.oauth 必须是最多 8 项的数组')
  const seen = new Set<string>()
  return value.map((item) => {
    const obj = cleanObject(item)
    const id = String(obj.id || '').trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{1,80}$/.test(id) || seen.has(id)) fail(`OAuth ID 不合法或重复：${id}`)
    seen.add(id)
    let authorizationUrl: URL
    let tokenUrl: URL
    try { authorizationUrl = new URL(String(obj.authorizationUrl || '')); tokenUrl = new URL(String(obj.tokenUrl || '')) } catch { fail(`OAuth ${id} 的授权或 Token URL 无效`) }
    if (authorizationUrl.protocol !== 'https:' || tokenUrl.protocol !== 'https:') fail(`OAuth ${id} 只允许 HTTPS`)
    const domains = [...new Set(cleanStringList(obj.domains, 12).map((domain) => domain.toLowerCase()))]
    const allowed = (host: string) => network.domains.some((pattern) => pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern)
    if (!allowed(authorizationUrl.hostname) || !allowed(tokenUrl.hostname) || !domains.length || domains.some((domain) => !allowed(domain))) fail(`OAuth ${id} 的域名必须包含在 network.domains 白名单中`)
    const clientId = String(obj.clientId || '').trim()
    if (!clientId || clientId.length > 300) fail(`OAuth ${id} 缺少公开 clientId`)
    return { id, authorizationUrl: authorizationUrl.toString(), tokenUrl: tokenUrl.toString(), clientId, scopes: cleanStringList(obj.scopes, 32), domains }
  })
}

function normalizeMigrationList(value: unknown, files: ZipFile[], targetDataVersion: number): DeveloperAppMigrationDeclaration[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 32) fail('dx-app.json.migrations 必须是最多 32 项的数组')
  const migrations = value.map((item) => {
    const obj = cleanObject(item)
    const from = Number(obj.from)
    const to = Number(obj.to)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to !== from + 1 || to > targetDataVersion) fail('迁移版本必须是连续的正整数 from → from+1，且不能超过 dataVersion')
    if (obj.type !== 'declarative') fail('当前只允许 declarative 数据迁移')
    const file = safePath(String(obj.file || ''))
    if (!file.startsWith('migrations/') || !file.endsWith('.json')) fail('迁移文件必须位于 migrations/*.json')
    if (!files.some((entry) => entry.name === file)) fail(`迁移文件不存在：${file}`)
    readJsonFile(files, file, file)
    return { from, to, type: 'declarative' as const, file }
  })
  const keys = new Set<string>()
  for (const migration of migrations) {
    const key = `${migration.from}-${migration.to}`
    if (keys.has(key)) fail(`迁移版本重复：${key}`)
    keys.add(key)
  }
  return migrations
}
function normalizeMcpList(value: unknown): DeveloperAppMcpDeclaration[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).map((item, index) => {
    const obj = item && typeof item === 'object' && !Array.isArray(item) ? item as Partial<DeveloperAppMcpDeclaration> : {}
    const id = slug(String(obj.id || `mcp-${index + 1}`))
    const name = String(obj.name || id).trim().slice(0, 60)
    const transport = obj.transport === 'http' ? 'http' : 'stdio'
    return {
      id,
      name,
      transport,
      command: obj.command ? String(obj.command).slice(0, 180) : undefined,
      args: cleanStringList(obj.args, 24).map((arg) => arg.slice(0, 240)),
      url: obj.url ? String(obj.url).slice(0, 500) : undefined,
    }
  })
}

function stringMap(value: unknown, limit = 32) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>).slice(0, limit)
  const result: Record<string, string> = {}
  for (const [key, raw] of entries) {
    const cleanKey = key.trim().slice(0, 80)
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(cleanKey)) continue
    result[cleanKey] = String(raw ?? '').slice(0, 500)
  }
  return Object.keys(result).length ? result : undefined
}

function bundledMcpDeclarations(files: ZipFile[]): DeveloperAppMcpDeclaration[] {
  const path = 'mcp/mcp.json'
  const raw = readJsonFile(files, path, path)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const root = raw as Record<string, unknown>
  const nested = root.mcp && typeof root.mcp === 'object' && !Array.isArray(root.mcp) ? root.mcp as Record<string, unknown> : null
  const map = (root.mcpServers && typeof root.mcpServers === 'object' ? root.mcpServers
    : root.servers && typeof root.servers === 'object' ? root.servers
    : nested?.servers && typeof nested.servers === 'object' ? nested.servers
    : null) as Record<string, unknown> | null
  if (!map) fail(`${path} 必须包含 mcpServers、servers 或 mcp.servers`)
  return Object.entries(map).slice(0, 16).map(([rawId, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} 中的 ${rawId} 不是服务器对象`)
    const item = value as Record<string, unknown>
    const id = slug(rawId)
    const url = String(item.url || item.serverUrl || '').trim().slice(0, 500)
    const command = String(item.command || '').trim().slice(0, 180)
    if (!url && !command) fail(`${path} 中的 ${rawId} 缺少 command 或 url`)
    if (url && !/^https:\/\//i.test(url)) fail(`${path} 中的 ${rawId} 只允许 HTTPS URL`)
    const env = stringMap(item.env)
    const headers = stringMap(item.headers)
    const isSecretPlaceholder = (value: string) => /^\$\{secret:[A-Za-z_][A-Za-z0-9_.-]*\}$/.test(value)
    for (const [key, value] of Object.entries(env || {})) {
      if (/(token|key|secret|password|cookie|credential)/i.test(key) && value && !isSecretPlaceholder(value)) {
        fail(`${path} 中的 ${rawId}.${key} 必须使用 \${secret:${key}} 占位符，不能打包真实密钥`)
      }
    }
    for (const [key, value] of Object.entries(headers || {})) {
      if (/(authorization|token|key|cookie)/i.test(key) && value && !isSecretPlaceholder(value)) {
        fail(`${path} 中的 ${rawId}.headers.${key} 必须使用 secret 占位符，不能打包真实凭据`)
      }
    }
    const cwd = item.cwd ? safePath(String(item.cwd)) : undefined
    if (cwd && cwd !== 'mcp' && !cwd.startsWith('mcp/')) fail(`${path} 中的 ${rawId}.cwd 必须位于 mcp/ 内`)
    const placeholders = [...Object.values(env || {}), ...Object.values(headers || {})]
      .flatMap((text) => [...text.matchAll(/^\$\{secret:([A-Za-z_][A-Za-z0-9_.-]*)\}$/g)].map((match) => match[1]))
    return {
      id,
      name: String(item.name || rawId).trim().slice(0, 60) || id,
      transport: url ? 'http' : 'stdio',
      command: command || undefined,
      args: cleanStringList(item.args, 24).map((arg) => arg.slice(0, 240)),
      cwd,
      url: url || undefined,
      env,
      headers,
      secretKeys: [...new Set(placeholders)].slice(0, 32),
      configPath: path,
    }
  })
}
function normalizeDependencyList(value: unknown): DeveloperAppDependencyDeclaration[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 48).map((item, index) => {
    const obj = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    const type = obj.type === 'mcp' ? 'mcp' : 'skill'
    const id = type === 'mcp'
      ? normalizeDependencyId(obj.id || obj.serverId, `mcp-${index + 1}`)
      : normalizeDependencyId(obj.id || obj.skillId, `skill-${index + 1}`)
    const name = String(obj.name || id).trim().slice(0, 80)
    const source = obj.source === 'bundled' || obj.source === 'external' || obj.source === 'system' ? obj.source : 'system'
    return {
      type,
      id,
      name,
      version: obj.version ? String(obj.version).slice(0, 60) : undefined,
      required: obj.required !== false,
      source,
      path: obj.path ? safePath(String(obj.path)) : undefined,
      installHint: obj.installHint ? String(obj.installHint).slice(0, 240) : undefined,
      toolName: obj.toolName ? String(obj.toolName).slice(0, 100) : undefined,
    }
  })
}
function normalizeToolManifest(raw: unknown): DeveloperAppToolDeclaration[] {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { tools?: unknown[] } : {}
  if (!Array.isArray(obj.tools)) return []
  return obj.tools.slice(0, 48).map((item) => {
    const tool = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    const handler = tool.handler && typeof tool.handler === 'object' && !Array.isArray(tool.handler) ? tool.handler as Record<string, unknown> : {}
    const risk = ['read', 'write', 'delete', 'external', 'system'].includes(String(tool.risk)) ? String(tool.risk) as DeveloperAppToolDeclaration['risk'] : 'read'
    const handlerType = ['app-api', 'frontend-bridge', 'mcp-tool', 'skill'].includes(String(handler.type)) ? String(handler.type) as DeveloperAppToolDeclaration['handlerType'] : 'frontend-bridge'
    const permission = normalizePermission(tool.permission)
    const confirmation = cleanObject(tool.confirmation, {})
    const confirmationMessage = String(confirmation.message || '').trim()
    return {
      name: normalizeToolName(tool.name),
      title: String(tool.title || tool.name || '').trim().slice(0, 40),
      description: String(tool.description || '').trim().slice(0, 240),
      whenToUse: cleanStringList(tool.whenToUse, 12).map((hint) => hint.slice(0, 120)),
      inputSchema: cleanObject(tool.inputSchema, { type: 'object', properties: {} }),
      outputSchema: tool.outputSchema && typeof tool.outputSchema === 'object' && !Array.isArray(tool.outputSchema) ? tool.outputSchema as Record<string, unknown> : undefined,
      permission: permission || undefined,
      risk,
      sideEffects: cleanStringList(tool.sideEffects, 12).map((item) => item.slice(0, 80)),
      handlerType,
      handler: {
        type: handlerType,
        endpoint: handler.endpoint ? String(handler.endpoint).slice(0, 300) : undefined,
        serverId: handler.serverId ? String(handler.serverId).slice(0, 100) : undefined,
        toolName: handler.toolName ? String(handler.toolName).slice(0, 100) : undefined,
        skillId: handler.skillId ? String(handler.skillId).slice(0, 100) : undefined,
      },
      confirmation: confirmation.required === true ? { required: true, message: confirmationMessage ? confirmationMessage.slice(0, 180) : undefined } : undefined,
    }
  })
}
function normalizePermissions(files: ZipFile[], manifest: DeveloperAppManifest, tools: DeveloperAppToolDeclaration[]) {
  const raw = readJsonFile(files, 'permissions.json', 'permissions.json')
  const fromFile = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? cleanStringList((raw as { permissions?: unknown }).permissions, 64)
    : cleanStringList(raw, 64)
  return [...new Set([
    ...(manifest.permissions || []),
    ...fromFile.map((permission) => normalizeAppPermission(permission, manifest.id)).filter(Boolean),
    ...tools.map((tool) => normalizeAppPermission(tool.permission, manifest.id)).filter(Boolean),
  ])].slice(0, 96)
}
function scanSkillDocs(files: ZipFile[], manifest: DeveloperAppManifest): DeveloperAppSkillDeclaration[] {
  const declared = new Set((manifest.agent?.skillDocs || []).map((path) => path.toLowerCase()))
  return files
    .filter((file) => /^skills\/.+\.md$/i.test(file.name) || /^skills\/SKILL\.md$/i.test(file.name) || declared.has(file.name.toLowerCase()))
    .slice(0, 24)
    .map((file) => {
      const text = file.data.subarray(0, Math.min(file.data.length, MAX_TEXT_BYTES)).toString('utf8')
      const title = text.split(/\r?\n/).find((line) => /^#\s+/.test(line))?.replace(/^#+\s*/, '').trim() || file.name.split('/').pop() || 'Skill'
      const preview = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#')) || '随应用安装的 Skill 文档。'
      return { path: file.name, title: title.slice(0, 60), preview: preview.slice(0, 180) }
    })
}
function collectCapabilities(files: ZipFile[], manifest: DeveloperAppManifest): DeveloperAppCapabilities {
  const toolPath = manifest.agent?.toolManifest ? safePath(manifest.agent.toolManifest) : 'agent.tools.json'
  const rawTools = readJsonFile(files, toolPath, toolPath)
  const tools = rawTools ? normalizeToolManifest(rawTools) : []
  const permissions = normalizePermissions(files, manifest, tools)
  const mcpMap = new Map<string, DeveloperAppMcpDeclaration>()
  for (const item of normalizeMcpList(manifest.mcp)) mcpMap.set(item.id, item)
  for (const item of bundledMcpDeclarations(files)) mcpMap.set(item.id, item)
  const mcp = [...mcpMap.values()]
  const skills = scanSkillDocs(files, manifest)
  const dependencyMap = new Map<string, DeveloperAppDependencyDeclaration>()
  const addDependency = (dependency: DeveloperAppDependencyDeclaration) => {
    dependencyMap.set(`${dependency.type}:${dependency.id}:${dependency.toolName || ''}`, dependency)
  }
  for (const dependency of manifest.dependencies || []) addDependency(dependency)
  for (const item of mcp) addDependency({ type: 'mcp', id: item.id, name: item.name, required: true, source: 'bundled', installHint: item.command || item.url || '随 APP 包声明的 MCP 服务' })
  for (const skill of skills) addDependency({ type: 'skill', id: slug(skill.title), name: skill.title, required: false, source: 'bundled', path: skill.path, installHint: skill.preview })
  for (const tool of tools) {
    const handler = tool.handler || { type: tool.handlerType }
    if (handler.type === 'skill' && handler.skillId) addDependency({ type: 'skill', id: handler.skillId, name: handler.skillId, required: true, source: 'system', toolName: tool.name, installHint: '工具 handler.skillId 指向的系统 Skill' })
    if (handler.type === 'mcp-tool' && handler.serverId) addDependency({ type: 'mcp', id: handler.serverId, name: handler.serverId, required: true, source: 'system', toolName: handler.toolName || tool.name, installHint: '工具 handler.serverId 指向的系统 MCP' })
  }
  const dependencies = [...dependencyMap.values()].slice(0, 96)
  const warnings: string[] = []
  if (dependencies.length) warnings.push('此包声明了能力依赖；系统已安装并授权的 Skill/MCP 可被 Agent 调用，缺失的依赖会保持待安装状态。')
  if (mcp.length) warnings.push('此包携带 MCP 元数据；上传时只登记，不会自动安装依赖或启动第三方进程。')
  if (tools.length) warnings.push('此包的 Agent 工具已进入 Tool Catalog；可安全映射且已授权的工具可执行，其余工具保持等待状态。')
  if (skills.length) warnings.push('此包包含 Skill 文档；可作为开发者安装 Skill 的说明来源。')
  return { agentSummary: String(manifest.agent?.summary || '').slice(0, 400), tools, permissions, dependencies, mcp, skills, warnings }
}

export function listDeveloperApps() {
  return loadIndex().map((item) => ({
    ...item,
    sourceName: decodeUploadName(item.sourceName),
    capabilities: item.capabilities || { agentSummary: '', tools: [], permissions: [], dependencies: [], mcp: [], skills: [], warnings: [] },
  }))
}

function prepareDeveloperApp(buffer: Buffer) {
  const rawFiles = readZip(buffer)
  if (!rawFiles.length) fail('压缩包为空')
  const prefix = commonTopLevel(rawFiles)
  const files = rawFiles.map((file) => ({ ...file, name: safePath(file.name.slice(prefix.length)) })).filter((file) => file.name)
  const manifestFile = files.find((file) => file.name === 'dx-app.json')
  if (!manifestFile) fail('根目录缺少 dx-app.json')
  if (manifestFile.data.length > MAX_APP_MANIFEST_BYTES) fail('dx-app.json 过大（最大 1 MB）')
  let manifestJson: unknown
  try { manifestJson = JSON.parse(manifestFile.data.toString('utf8')) } catch { fail('dx-app.json 不是有效 JSON') }
  const manifest = normalizeManifest(manifestJson, files)
  const entryFile = files.find((file) => file.name === (manifest.entry || 'index.html'))
  if (entryFile && /\.html?$/i.test(entryFile.name)) {
    const html = entryFile.data.toString('utf8')
    const missing = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => match[1].trim())
      .filter((value) => value && !/^(?:[a-z]+:|\/\/|\/|#|\{)/i.test(value))
      .map((value) => value.split(/[?#]/)[0])
      .filter(Boolean)
      .map((value) => safePath(join(dirname(entryFile.name), value).replace(/\\/g, '/')))
      .filter((path) => !files.some((file) => file.name === path))
    if (missing.length) fail(`入口引用了不存在的资源：${[...new Set(missing)].join('、')}`)
  }
  const id = `dev-${manifest.id}`
  const capabilities = collectCapabilities(files, manifest)
  return { files, manifest, id, capabilities }
}

export function simulateDeveloperAppInstall(buffer: Buffer) {
  const prepared = prepareDeveloperApp(buffer)
  return {
    appId: prepared.id,
    name: prepared.manifest.name,
    version: prepared.manifest.version,
    build: prepared.manifest.build,
    releaseChannel: prepared.manifest.releaseChannel,
    minSystemVersion: prepared.manifest.minSystemVersion,
    maxSystemVersion: prepared.manifest.maxSystemVersion,
    dataVersion: prepared.manifest.dataVersion,
    migrations: prepared.manifest.migrations || [],
    entry: prepared.manifest.entry || 'index.html',
    fileCount: prepared.files.length,
    packageBytes: buffer.length,
    unpackedBytes: prepared.files.reduce((sum, file) => sum + file.data.length, 0),
    permissions: prepared.capabilities.permissions,
    dependencies: prepared.capabilities.dependencies.length,
    mcp: prepared.capabilities.mcp.length,
    skills: prepared.capabilities.skills.length,
  }
}

export interface DeveloperAppImportOptions {
  allowDowngrade?: boolean
  /** Trusted local development installs may refresh code without changing the release version. */
  allowSameVersion?: boolean
  allowDataVersionChange?: boolean
  expectedAppId?: string
  expectedVersion?: string
  expectedBuild?: number
  /** Only DX OS bundled packages may opt out of the dev- namespace. */
  trustedPackageId?: string
}

export function importDeveloperApp(buffer: Buffer, sourceName: string, options: DeveloperAppImportOptions = {}) {
  // 先完成清单、文件、能力与 bundled MCP 校验，再替换已安装文件；
  // 无效包不能破坏旧版本。模拟安装复用完全相同的解析路径。
  const prepared = prepareDeveloperApp(buffer)
  const { files, manifest, capabilities } = prepared
  const id = options.trustedPackageId ? String(options.trustedPackageId) : prepared.id
  if (options.trustedPackageId && options.trustedPackageId !== manifest.id) fail(`受信包 ID 不匹配：期待 ${options.trustedPackageId}，实际 ${manifest.id}`)
  if (options.expectedAppId && options.expectedAppId !== id && options.expectedAppId !== manifest.id) fail(`更新包 ID 不匹配：期待 ${options.expectedAppId}，实际 ${manifest.id}`)
  if (options.expectedVersion && options.expectedVersion !== manifest.version) fail(`更新包版本不匹配：期待 ${options.expectedVersion}，实际 ${manifest.version}`)
  if (options.expectedBuild && options.expectedBuild !== manifest.build) fail(`更新包 build 不匹配：期待 ${options.expectedBuild}，实际 ${manifest.build}`)
  const items = loadIndex()
  const existing = items.find((item) => item.id === id)
  if (existing && !options.allowDowngrade) {
    const comparison = compareAppVersion(manifest, existing.manifest)
    if (comparison < 0) fail(`不能降级安装：当前 ${appReleaseKey(existing.manifest)}，安装包 ${appReleaseKey(manifest)}`)
    if (comparison === 0 && manifest.releaseChannel !== 'dev' && !options.allowSameVersion) fail(`已安装相同版本：${appReleaseKey(manifest)}`)
  }
  if (existing && manifest.dataVersion !== existing.manifest.dataVersion && !options.allowDataVersionChange) {
    fail(`数据版本从 ${existing.manifest.dataVersion} 变为 ${manifest.dataVersion}，但当前 Release 没有可执行的声明式迁移；已停止更新以保护项目文件`)
  }
  const stagingRoot = join(DATA_DIR, '.staging', `${id}-${randomUUID()}`)
  const stagingSource = join(stagingRoot, 'source')
  const installId = `${appReleaseKey(manifest).replace(/[^a-zA-Z0-9.+-]/g, '-')}-${randomUUID().slice(0, 8)}`
  const installRoot = join(versionsRoot(id), installId)
  let historyPath = ''
  let committed = false
  mkdirSync(stagingSource, { recursive: true })
  try {
    for (const file of files) {
      const target = resolve(stagingSource, file.name)
      if (!target.startsWith(`${stagingSource}${sep}`)) fail('检测到越界写入')
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.data)
    }
    if (existing) {
      historyPath = join(historyRoot(id), `${appReleaseKey(existing.manifest).replace(/[^a-zA-Z0-9.+-]/g, '-')}-${Date.now()}`)
      mkdirSync(historyPath, { recursive: true })
      writeFileSync(join(historyPath, 'release.json'), JSON.stringify(existing, null, 2), 'utf8')
    }
    mkdirSync(dirname(installRoot), { recursive: true })
    atomicRenameSync(stagingRoot, installRoot)
    const pack: DeveloperAppPackage = {
      id,
      storagePath: relative(DATA_DIR, installRoot).replace(/\\/g, '/'),
      runtimeToken: randomUUID().replace(/-/g, ''), sourceName: decodeUploadName(sourceName), importedAt: Date.now(), manifest, capabilities,
    }
    try {
      saveIndex([...items.filter((item) => item.id !== id), pack])
    } catch (error) {
      rmSync(installRoot, { recursive: true, force: true })
      if (historyPath) rmSync(historyPath, { recursive: true, force: true })
      throw error
    }
    committed = true
    // 安装成功后只留下刚生成的上一版本回滚点；清理失败不应把已经完成的
    // 原子安装误报为失败，后续启动与版本页加载还会再次执行清理。
    try { pruneDeveloperAppHistory(id, 1) } catch { /* best effort retention cleanup */ }
    return pack
  } catch (error) {
    if (!committed) {
      if (existsSync(installRoot)) rmSync(installRoot, { recursive: true, force: true })
      if (historyPath && existsSync(historyPath)) rmSync(historyPath, { recursive: true, force: true })
    }
    throw error
  } finally {
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true })
  }
}

function historyRecord(id: string, historyId: string) {
  if (!/^[a-zA-Z0-9.+-]{3,180}$/.test(historyId)) return null
  const root = join(historyRoot(id), historyId)
  const metadata = join(root, 'release.json')
  if (!existsSync(metadata)) return null
  try {
    const pack = JSON.parse(readFileSync(metadata, 'utf8')) as DeveloperAppPackage
    if (pack.id !== id || !isValidSemver(pack.manifest?.version) || !Number.isSafeInteger(pack.manifest?.build)) return null
    const storageRoot = existsSync(join(root, 'source')) ? root : packageStorageRoot(pack)
    if (!existsSync(join(storageRoot, 'source'))) return null
    const timestamp = Number(historyId.match(/-(\d{10,})$/)?.[1] || 0)
    return { root, storageRoot, pack, item: {
      historyId, appId: id, version: pack.manifest.version, build: pack.manifest.build,
      releaseChannel: pack.manifest.releaseChannel, dataVersion: pack.manifest.dataVersion,
      archivedAt: timestamp || pack.importedAt || 0, sourceName: pack.sourceName,
    } satisfies DeveloperAppHistoryItem }
  } catch { return null }
}

export function listDeveloperAppHistory(id: string): DeveloperAppHistoryItem[] {
  const root = historyRoot(id)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => historyRecord(id, entry.name)?.item)
    .filter((item): item is DeveloperAppHistoryItem => !!item)
    .sort((a, b) => b.archivedAt - a.archivedAt)
}

/** 仅保留最近的回滚点，并删除不再被当前版本或保留回滚点引用的旧安装包。 */
export function pruneDeveloperAppHistory(id: string, limit = 1): DeveloperAppHistoryItem[] {
  const keepLimit = Math.max(0, Math.min(1, Math.floor(limit)))
  const root = historyRoot(id)
  if (!existsSync(root)) return []
  const records = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, record: historyRecord(id, entry.name) }))
  const valid = records
    .filter((item): item is { name: string; record: NonNullable<ReturnType<typeof historyRecord>> } => !!item.record)
    .sort((a, b) => b.record.item.archivedAt - a.record.item.archivedAt)
  const kept = valid.slice(0, keepLimit)
  const keepIds = new Set(kept.map((item) => item.name))
  for (const item of records) {
    if (keepIds.has(item.name)) continue
    rmSync(join(root, item.name), { recursive: true, force: true })
    deleteDeveloperProjectSnapshot(id, item.name)
  }

  const current = loadIndex().find((item) => item.id === id)
  const referencedRoots = new Set<string>()
  if (current) referencedRoots.add(resolve(packageStorageRoot(current)))
  for (const item of kept) referencedRoots.add(resolve(item.record.storageRoot))
  const versionRoot = versionsRoot(id)
  if (existsSync(versionRoot)) {
    for (const entry of readdirSync(versionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const target = resolve(versionRoot, entry.name)
      if (!referencedRoots.has(target)) rmSync(target, { recursive: true, force: true })
    }
  }
  return kept.map((item) => item.record.item)
}

export function pruneDeveloperAppHistories(limit = 1) {
  return listDeveloperApps().map((app) => ({ appId: app.id, history: pruneDeveloperAppHistory(app.id, limit) }))
}

export function beginDeveloperAppRuntimeObservation(id: string, rollbackHistoryId: string) {
  const pack = loadIndex().find((item) => item.id === id)
  if (!pack) throw new Error('开发者应用不存在')
  if (!historyRecord(id, rollbackHistoryId)) throw new Error('运行时健康检查缺少有效回滚点')
  const state: DeveloperAppRuntimeHealthState = {
    appId: id,
    releaseKey: appReleaseKey(pack.manifest),
    rollbackHistoryId,
    installedAt: Date.now(),
    status: 'pending',
  }
  saveRuntimeHealthStates([...loadRuntimeHealthStates().filter((item) => item.appId !== id), state])
  return state
}

export function developerAppRuntimeHealth(id: string) {
  return loadRuntimeHealthStates().find((item) => item.appId === id) || null
}

export function reportDeveloperAppRuntimeHealth(id: string, status: 'ready' | 'error', detail = '') {
  const states = loadRuntimeHealthStates()
  const state = states.find((item) => item.appId === id)
  const current = loadIndex().find((item) => item.id === id)
  if (!current) throw new Error('开发者应用不存在')
  if (!state || state.releaseKey !== appReleaseKey(current.manifest)) {
    return { observed: false, rolledBack: false, app: current }
  }
  if (status === 'ready') {
    state.status = 'healthy'
    state.readyAt = Date.now()
    saveRuntimeHealthStates(states)
    return { observed: true, rolledBack: false, app: current, state }
  }
  const now = Date.now()
  const stillObserved = state.status === 'pending' || (state.status === 'healthy' && now - (state.readyAt || state.installedAt) <= RUNTIME_HEALTH_OBSERVATION_MS)
  if (!stillObserved) return { observed: false, rolledBack: false, app: current, state }
  state.status = 'failed'
  state.lastError = String(detail || 'APP 运行时错误').slice(0, 2000)
  saveRuntimeHealthStates(states)
  const hasProjectSnapshot = hasDeveloperProjectSnapshots(id, state.rollbackHistoryId)
  const result = rollbackDeveloperApp(id, state.rollbackHistoryId, { allowDataVersionChange: hasProjectSnapshot })
  if (hasProjectSnapshot) saveForwardDeveloperProjectSnapshots(id, state.rollbackHistoryId, result.backupHistoryId)
  const restoredProjects = hasProjectSnapshot ? restoreDeveloperProjectSnapshots(id, state.rollbackHistoryId) : []
  try { pruneDeveloperAppHistory(id, 1) } catch { /* best effort retention cleanup */ }
  state.status = 'rolled-back'
  saveRuntimeHealthStates(states)
  return { observed: true, rolledBack: true, ...result, restoredProjects, error: state.lastError }
}

export function healthCheckDeveloperApp(id: string) {
  const pack = listDeveloperApps().find((item) => item.id === id)
  if (!pack) throw new Error('开发者应用不存在')
  const checks: Array<{ id: string; ok: boolean; detail: string }> = []
  const entry = pack.manifest.entry || 'index.html'
  let html = ''
  try {
    const path = developerAppFilePath(id, entry)
    html = readFileSync(path, 'utf8')
    checks.push({ id: 'entry', ok: html.trim().length > 0, detail: html.trim().length ? `入口可读取：${entry}` : `入口为空：${entry}` })
  } catch (error) {
    checks.push({ id: 'entry', ok: false, detail: String((error as Error).message || error) })
  }
  if (html) {
    const missing = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => match[1].trim())
      .filter((value) => value && !/^(?:[a-z]+:|\/\/|\/|#|\{)/i.test(value))
      .map((value) => value.split(/[?#]/)[0])
      .filter(Boolean)
      .filter((value) => {
        try { developerAppFilePath(id, join(dirname(entry), value).replace(/\\/g, '/')); return false } catch { return true }
      })
    checks.push({ id: 'resources', ok: missing.length === 0, detail: missing.length ? `缺少入口资源：${[...new Set(missing)].join('、')}` : '入口引用的本地资源均存在' })
  }
  return { appId: id, version: pack.manifest.version, build: pack.manifest.build, ok: checks.every((check) => check.ok), checks, checkedAt: Date.now() }
}

export function rollbackDeveloperApp(id: string, historyId: string, options: { allowDataVersionChange?: boolean } = {}) {
  const items = loadIndex()
  const current = items.find((item) => item.id === id)
  if (!current) throw new Error('开发者应用不存在')
  const record = historyRecord(id, historyId)
  if (!record) throw new Error('历史版本不存在')
  if (record.pack.manifest.dataVersion !== current.manifest.dataVersion && !options.allowDataVersionChange) {
    throw new Error(`历史版本 dataVersion=${record.pack.manifest.dataVersion}，当前为 ${current.manifest.dataVersion}；没有数据快照时禁止回滚`)
  }
  const backupId = `${appReleaseKey(current.manifest).replace(/[^a-zA-Z0-9.+-]/g, '-')}-rollback-${Date.now()}`
  const backupRoot = join(historyRoot(id), backupId)
  const restoredRoot = join(versionsRoot(id), `${appReleaseKey(record.pack.manifest).replace(/[^a-zA-Z0-9.+-]/g, '-')}-rollback-${randomUUID().slice(0, 8)}`)
  try {
    mkdirSync(backupRoot, { recursive: true })
    writeFileSync(join(backupRoot, 'release.json'), JSON.stringify(current, null, 2), 'utf8')
    mkdirSync(restoredRoot, { recursive: true })
    cpSync(join(record.storageRoot, 'source'), join(restoredRoot, 'source'), { recursive: true, force: false, errorOnExist: true })
    const restored: DeveloperAppPackage = {
      ...record.pack,
      storagePath: relative(DATA_DIR, restoredRoot).replace(/\\/g, '/'),
      runtimeToken: randomUUID().replace(/-/g, ''),
      sourceName: `${record.pack.sourceName}（回滚）`,
      importedAt: Date.now(),
    }
    saveIndex([...items.filter((item) => item.id !== id), restored])
    const health = healthCheckDeveloperApp(id)
    if (!health.ok) throw new Error(health.checks.filter((check) => !check.ok).map((check) => check.detail).join('；'))
    return { app: restored, health, backupHistoryId: backupId }
  } catch (error) {
    if (existsSync(restoredRoot)) rmSync(restoredRoot, { recursive: true, force: true })
    if (existsSync(backupRoot)) rmSync(backupRoot, { recursive: true, force: true })
    try { saveIndex(items) } catch { /* keep original error */ }
    throw error
  }
}

export function deleteDeveloperApp(id: string) {
  const items = loadIndex()
  const current = items.find((item) => item.id === id)
  if (!current) return false
  const currentRoot = packageStorageRoot(current)
  rmSync(currentRoot, { recursive: true, force: true })
  rmSync(packageRoot(id), { recursive: true, force: true })
  rmSync(versionsRoot(id), { recursive: true, force: true })
  rmSync(historyRoot(id), { recursive: true, force: true })
  deleteDeveloperProjectSnapshots(id)
  saveRuntimeHealthStates(loadRuntimeHealthStates().filter((item) => item.appId !== id))
  saveIndex(items.filter((item) => item.id !== id))
  return true
}

export function developerAppFilePath(id: string, path: string) {
  if (!loadIndex().some((item) => item.id === id)) fail('应用不存在')
  // 画布开发时直读项目构建目录，避免每次调试都要安装到 AppData。
  // 打包桌面端会显式传 NODE_ENV=production，始终使用版本化安装目录。
  const projectRoot = join(PROJECT_BUNDLED_APPS_ROOT, id)
  const useProjectCanvas = id === 'canvas'
    && process.env.NODE_ENV !== 'production'
    && process.env.DX_CANVAS_PROJECT_RUNTIME !== '0'
    && existsSync(join(projectRoot, 'index.html'))
  const root = useProjectCanvas ? projectRoot : developerAppSourceRoot(id)
  const rel = safePath(path || 'index.html')
  const target = resolve(root, rel)
  if (target !== root && !target.startsWith(`${root}${sep}`)) fail('检测到越界读取')
  if (!existsSync(target)) fail('文件不存在')
  return target
}

export function developerAppRuntimeFilePath(runtimeToken: string, path: string) {
  if (!/^[a-f0-9]{32}$/.test(runtimeToken)) fail('运行令牌无效')
  const pack = loadIndex().find((item) => item.runtimeToken === runtimeToken)
  if (!pack) fail('应用运行令牌不存在')
  return developerAppFilePath(pack.id, path)
}
