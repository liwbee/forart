import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { dataPath } from './dataPaths.ts'
import { installRemoteProtocols, type RemoteProtocolBinding, type RemoteProtocolSiteRule, type RemoteProtocolStore } from './protocols.ts'

const CATALOG_BASE = String(process.env.DX_PROTOCOL_CATALOG_URL || 'https://api.dx-os.com').replace(/\/+$/, '')
const REMOTE_FILE = process.env.DX_REMOTE_PROTOCOL_FILE || dataPath('remote-protocols.json')
const LEGACY_PREVIOUS_FILE = `${REMOTE_FILE}.previous`
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024
const MAX_PROTOCOLS_PER_KIND = 200
const MAX_BINDINGS = 300
const MAX_RULES = 1000
const MAX_SITE_RULES_PER_BINDING = 50
const MAX_SITE_RULE_VALUES = 20

type Bundle = {
  format: 'dx-protocol-bundle/v1'
  bundleId: string
  version: string
  minDxOsVersion?: string
  releaseNotes?: string
  providerProtocols: unknown[]
  modelProtocols: unknown[]
  bindings: RemoteProtocolBinding[]
}

type StoredBundle = Bundle & { installedAt: number; sha256?: string }

export type ProtocolUpdateMetadata = {
  id: string
  bundleId: string
  version: string
  minDxOsVersion?: string
  releaseNotes?: string
  fileSize: number
  sha256: string
  downloadUrl: string
  publishedAt?: number
}

let current: StoredBundle | null = null
let latest: ProtocolUpdateMetadata | null = null
let lastCheckedAt = 0

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanId(value: unknown, field: string) {
  const id = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9:_-]{1,63}$/.test(id)) throw new Error(`${field} 只能使用小写字母、数字、冒号、下划线和短横线，长度 2-64。`)
  return id
}

function semverParts(value: string) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/)
  if (!match) throw new Error(`版本号「${value}」不是有效的 SemVer。`)
  return match.slice(1, 4).map(Number)
}

export function compareProtocolVersions(a: string, b: string) {
  const left = semverParts(a)
  const right = semverParts(b)
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i]
  return 0
}

function validateProtocolList(values: unknown, kind: 'provider' | 'model') {
  if (!Array.isArray(values)) throw new Error(`${kind === 'provider' ? 'providerProtocols' : 'modelProtocols'} 必须是数组。`)
  if (values.length > MAX_PROTOCOLS_PER_KIND) throw new Error(`单个更新包最多包含 ${MAX_PROTOCOLS_PER_KIND} 个${kind === 'provider' ? '平台' : '模型'}协议。`)
  const ids = new Set<string>()
  return values.map((value) => {
    const item = object(value)
    const id = cleanId(item.id, `${kind} protocol id`)
    if (ids.has(id)) throw new Error(`更新包中协议 id「${id}」重复。`)
    ids.add(id)
    if (!String(item.label || '').trim()) throw new Error(`协议「${id}」缺少 label。`)
    if (String(item.label).length > 120) throw new Error(`协议「${id}」的 label 过长。`)
    return { ...item, id }
  })
}

export function parseProtocolBundle(input: unknown): Bundle {
  const raw = object(input)
  if (raw.format !== 'dx-protocol-bundle/v1') throw new Error('不支持的协议更新包格式。')
  const bundleId = cleanId(raw.bundleId, 'bundleId')
  const version = String(raw.version || '').trim()
  semverParts(version)
  const providerProtocols = validateProtocolList(raw.providerProtocols, 'provider')
  const modelProtocols = validateProtocolList(raw.modelProtocols, 'model')
  const providerIds = new Set(providerProtocols.map((item) => String(item.id)))
  const modelIds = new Set(modelProtocols.map((item) => String(item.id)))
  for (const id of providerIds) if (modelIds.has(id)) throw new Error(`协议 id「${id}」不能同时用于平台协议和模型协议。`)
  if (!Array.isArray(raw.bindings)) throw new Error('bindings 必须是数组。')
  if (raw.bindings.length > MAX_BINDINGS) throw new Error(`单个更新包最多包含 ${MAX_BINDINGS} 条关联。`)
  let ruleCount = 0
  const bindings = raw.bindings.map((value, index) => {
    const binding = object(value)
    const providerProtocolId = cleanId(binding.providerProtocolId, `bindings[${index}].providerProtocolId`)
    if (!providerIds.has(providerProtocolId)) throw new Error(`关联引用了不存在的平台协议「${providerProtocolId}」。`)
    const allowedModelProtocolIds = Array.isArray(binding.allowedModelProtocolIds) ? binding.allowedModelProtocolIds.map((id) => cleanId(id, 'allowedModelProtocolId')) : []
    for (const id of allowedModelProtocolIds) if (!modelIds.has(id)) throw new Error(`关联引用了不存在的模型协议「${id}」。`)
    const defaultModelProtocolId = binding.defaultModelProtocolId ? cleanId(binding.defaultModelProtocolId, 'defaultModelProtocolId') : undefined
    if (defaultModelProtocolId && !allowedModelProtocolIds.includes(defaultModelProtocolId)) throw new Error(`默认模型协议「${defaultModelProtocolId}」必须包含在 allowedModelProtocolIds 中。`)
    if (binding.siteRules != null && !Array.isArray(binding.siteRules)) throw new Error(`bindings[${index}].siteRules 必须是数组。`)
    if (Array.isArray(binding.siteRules) && binding.siteRules.length > MAX_SITE_RULES_PER_BINDING) throw new Error(`每个平台关联最多包含 ${MAX_SITE_RULES_PER_BINDING} 条站点规则。`)
    const siteRules: RemoteProtocolSiteRule[] = Array.isArray(binding.siteRules) ? binding.siteRules.map((value, ruleIndex) => {
      const rule = object(value)
      const strings = (field: 'hosts' | 'hostSuffixes' | 'pathPrefixes') => {
        const rawValues = rule[field]
        if (rawValues == null) return []
        if (!Array.isArray(rawValues) || rawValues.length > MAX_SITE_RULE_VALUES) throw new Error(`siteRules[${ruleIndex}].${field} 必须是最多 ${MAX_SITE_RULE_VALUES} 项的数组。`)
        return rawValues.map((item) => String(item || '').trim())
      }
      const hosts = strings('hosts').map((value) => value.toLowerCase())
      const hostSuffixes = strings('hostSuffixes').map((value) => value.toLowerCase())
      const pathPrefixes = strings('pathPrefixes')
      if (!hosts.length && !hostSuffixes.length) throw new Error(`siteRules[${ruleIndex}] 至少需要 hosts 或 hostSuffixes。`)
      if (hosts.some((host) => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host))) throw new Error(`siteRules[${ruleIndex}].hosts 只能填写不带协议、端口和路径的域名。`)
      if (hostSuffixes.some((suffix) => !/^\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(suffix))) throw new Error(`siteRules[${ruleIndex}].hostSuffixes 必须以 . 开头并包含完整域名后缀。`)
      if (pathPrefixes.some((prefix) => !prefix.startsWith('/') || prefix.includes('?') || prefix.includes('#'))) throw new Error(`siteRules[${ruleIndex}].pathPrefixes 必须是以 / 开头且不含查询或片段的路径。`)
      const priority = rule.priority == null ? 0 : Number(rule.priority)
      if (!Number.isInteger(priority) || priority < -10000 || priority > 10000) throw new Error(`siteRules[${ruleIndex}].priority 必须是 -10000 到 10000 的整数。`)
      return { hosts, hostSuffixes, pathPrefixes, priority }
    }) : []
    const modelRules = Array.isArray(binding.modelRules) ? binding.modelRules.map((value) => {
      const rule = object(value)
      const pattern = String(rule.pattern || '')
      if (!pattern || pattern.length > 160 || /\(.*[+*].*\)[+*]/.test(pattern)) throw new Error('模型匹配规则为空、过长或可能造成灾难性回溯。')
      try { new RegExp(pattern, 'i') } catch { throw new Error(`模型匹配规则「${pattern}」不是有效正则表达式。`) }
      const modelProtocolId = cleanId(rule.modelProtocolId, 'modelRule.modelProtocolId')
      if (!allowedModelProtocolIds.includes(modelProtocolId)) throw new Error(`模型规则引用的「${modelProtocolId}」未包含在允许列表中。`)
      return { pattern, modelProtocolId }
    }) : []
    ruleCount += modelRules.length
    return { providerProtocolId, siteRules, defaultModelProtocolId, allowedModelProtocolIds, modelRules }
  })
  if (ruleCount > MAX_RULES) throw new Error(`单个更新包最多包含 ${MAX_RULES} 条模型规则。`)
  return {
    format: 'dx-protocol-bundle/v1', bundleId, version,
    minDxOsVersion: raw.minDxOsVersion ? String(raw.minDxOsVersion) : undefined,
    releaseNotes: raw.releaseNotes ? String(raw.releaseNotes).slice(0, 4000) : '',
    providerProtocols, modelProtocols, bindings,
  }
}

function toStore(bundle: Bundle): RemoteProtocolStore {
  return {
    provider: Object.fromEntries(bundle.providerProtocols.map((value) => [String(object(value).id), value])) as RemoteProtocolStore['provider'],
    model: Object.fromEntries(bundle.modelProtocols.map((value) => [String(object(value).id), value])) as RemoteProtocolStore['model'],
    bindings: bundle.bindings,
  }
}

function atomicWrite(path: string, value: StoredBundle) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, path)
}

function readStored(path: string) {
  if (!existsSync(path)) return null
  try { return { ...parseProtocolBundle(JSON.parse(readFileSync(path, 'utf8'))), ...object(JSON.parse(readFileSync(path, 'utf8'))) } as StoredBundle } catch { return null }
}

function decodePackage(buffer: Buffer) {
  const decoded = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer
  if (decoded.byteLength > MAX_PACKAGE_BYTES) throw new Error('解压后的协议更新包超过 4 MB。')
  return parseProtocolBundle(JSON.parse(decoded.toString('utf8')))
}

export function protocolUpdateStatus() {
  if (current && !existsSync(REMOTE_FILE)) {
    installRemoteProtocols({ provider: {}, model: {}, bindings: [] })
    current = null
  }
  return {
    current: current ? { bundleId: current.bundleId, version: current.version, installedAt: current.installedAt, releaseNotes: current.releaseNotes } : null,
    latest,
    lastCheckedAt,
    updateAvailable: !!latest && (!current || compareProtocolVersions(latest.version, current.version) > 0),
  }
}

export async function checkProtocolUpdates() {
  const response = await fetch(`${CATALOG_BASE}/v1/protocols/catalog/latest`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  if (response.status === 404) {
    latest = null
    lastCheckedAt = Date.now()
    return protocolUpdateStatus()
  }
  if (!response.ok) throw new Error(`在线协议库检查失败（HTTP ${response.status}）。`)
  const raw = object(await response.json())
  const downloadUrl = new URL(String(raw.downloadUrl || ''), CATALOG_BASE)
  if (downloadUrl.origin !== new URL(CATALOG_BASE).origin) throw new Error('服务器返回了不受信任的协议包地址。')
  latest = {
    id: String(raw.id || ''), bundleId: cleanId(raw.bundleId, 'bundleId'), version: String(raw.version || ''),
    minDxOsVersion: raw.minDxOsVersion ? String(raw.minDxOsVersion) : undefined,
    releaseNotes: raw.releaseNotes ? String(raw.releaseNotes) : '', fileSize: Number(raw.fileSize || 0),
    sha256: String(raw.sha256 || '').toLowerCase(), downloadUrl: downloadUrl.toString(), publishedAt: Number(raw.publishedAt || 0),
  }
  semverParts(latest.version)
  if (!/^[a-f0-9]{64}$/.test(latest.sha256)) throw new Error('服务器返回的 SHA-256 无效。')
  if (latest.fileSize < 1 || latest.fileSize > MAX_PACKAGE_BYTES) throw new Error('服务器返回的协议包大小无效。')
  lastCheckedAt = Date.now()
  return protocolUpdateStatus()
}

export async function installLatestProtocolUpdate() {
  if (!latest) await checkProtocolUpdates()
  if (!latest) throw new Error('服务器没有可安装的协议更新。')
  const response = await fetch(latest.downloadUrl, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`协议包下载失败（HTTP ${response.status}）。`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_PACKAGE_BYTES) throw new Error('协议更新包超过 4 MB。')
  const digest = createHash('sha256').update(buffer).digest('hex')
  if (digest !== latest.sha256) throw new Error('协议更新包 SHA-256 校验失败，已拒绝安装。')
  const bundle = decodePackage(buffer)
  if (bundle.bundleId !== latest.bundleId || bundle.version !== latest.version) throw new Error('协议包内容与服务器发布元数据不一致。')
  const stored: StoredBundle = { ...bundle, installedAt: Date.now(), sha256: digest }
  installRemoteProtocols(toStore(stored))
  atomicWrite(REMOTE_FILE, stored)
  current = stored
  return protocolUpdateStatus()
}

export function removeInstalledRemoteProtocol(kind: 'provider' | 'model', idValue: string) {
  if (!current) throw new Error('当前没有已安装的在线协议库。')
  const id = cleanId(idValue, 'protocol id')
  const providerProtocols = current.providerProtocols.filter((value) => String(object(value).id) !== id)
  let modelProtocols = current.modelProtocols.filter((value) => String(object(value).id) !== id)
  if (kind === 'provider' && providerProtocols.length === current.providerProtocols.length) throw new Error(`在线平台协议「${id}」不存在。`)
  if (kind === 'model' && modelProtocols.length === current.modelProtocols.length) throw new Error(`在线模型协议「${id}」不存在。`)
  let bindings = current.bindings
  if (kind === 'provider') {
    const removedBindings = bindings.filter((binding) => binding.providerProtocolId === id)
    bindings = bindings.filter((binding) => binding.providerProtocolId !== id)
    const candidates = new Set(removedBindings.flatMap((binding) => binding.allowedModelProtocolIds))
    const stillReferenced = new Set(bindings.flatMap((binding) => binding.allowedModelProtocolIds))
    modelProtocols = modelProtocols.filter((value) => {
      const modelId = String(object(value).id)
      return !candidates.has(modelId) || stillReferenced.has(modelId)
    })
  }
  else bindings = bindings.map((binding) => ({
    ...binding,
    defaultModelProtocolId: binding.defaultModelProtocolId === id ? undefined : binding.defaultModelProtocolId,
    allowedModelProtocolIds: binding.allowedModelProtocolIds.filter((modelId) => modelId !== id),
    modelRules: binding.modelRules?.filter((rule) => rule.modelProtocolId !== id),
  }))
  if (!providerProtocols.length && !modelProtocols.length) {
    installRemoteProtocols({ provider: {}, model: {}, bindings: [] })
    if (existsSync(REMOTE_FILE)) unlinkSync(REMOTE_FILE)
    current = null
    return { ...protocolUpdateStatus(), removed: { kind, id } }
  }
  const next: StoredBundle = { ...current, providerProtocols, modelProtocols, bindings, installedAt: Date.now() }
  installRemoteProtocols(toStore(next))
  atomicWrite(REMOTE_FILE, next)
  current = next
  return { ...protocolUpdateStatus(), removed: { kind, id } }
}

export function removeInstalledRemoteProtocolBundle() {
  if (!current) throw new Error('当前没有已安装的在线协议库。')
  const removed = {
    bundleId: current.bundleId,
    version: current.version,
    providerCount: current.providerProtocols.length,
    modelCount: current.modelProtocols.length,
  }
  installRemoteProtocols({ provider: {}, model: {}, bindings: [] })
  if (existsSync(REMOTE_FILE)) unlinkSync(REMOTE_FILE)
  current = null
  return { ...protocolUpdateStatus(), removed }
}

current = readStored(REMOTE_FILE)
try { if (existsSync(LEGACY_PREVIOUS_FILE)) unlinkSync(LEGACY_PREVIOUS_FILE) } catch { /* 旧回滚文件清理失败不阻止启动 */ }
if (current) {
  try { installRemoteProtocols(toStore(current)) } catch (error) { console.error('[protocol-updates] unable to load remote catalog', error) }
}
