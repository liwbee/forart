// ══════════════════════════════════════════════════════════════════════
// 站点凭据库（JSON 文件版）—— 数据量小时够用，将来长大再换 SQLite。
// api_key 只在服务端存明文；对外一律掩码，前端只知道「是否已存」。
// ══════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { normalizeProviderProtocolId, normalizeProtocolId } from './protocols.ts'
import { normalizeModelScopeLoras, type ModelScopeLora } from './modelscope.ts'
import { decryptSecret, encryptSecret, isEncryptedSecret } from './secretVault.ts'
import { jimengCliInstalled } from './cliTools.ts'
import { agentCliInstalled } from './agentCliTools.ts'

const DATA_DIR = DATA_ROOT
const FILE = dataPath('providers.json')
const SETTINGS_FILE = dataPath('provider-settings.json')
export type ProviderCapability = 'llm' | 'image' | 'video' | 'audio'

export interface ModelEntry {
  model: string
  name?: string
  caps: string[]
  protocol: string
  cap_sort?: Partial<Record<ProviderCapability, number>>
}

export interface Provider {
  id: string
  name: string
  base_url: string
  api_key: string
  wallet_api_key?: string
  protocol: string
  source?: 'api' | 'cli'
  cli_tool?: string
  custom_protocols?: string[]
  models: ModelEntry[]
  rh_apps?: Record<string, unknown>[]
  rh_workflows?: Record<string, unknown>[]
  ms_loras?: ModelScopeLora[]
  ms_defaults_version?: number
  enabled: boolean
  sort: number
  cap_sort?: Partial<Record<ProviderCapability, number>>
  created_ts: number
  updated_ts: number
}

export interface PublicProvider extends Omit<Provider, 'api_key' | 'wallet_api_key'> {
  has_key: boolean
  key_mask: string
  has_wallet_key: boolean
  wallet_key_mask: string
}

function now() {
  return Math.floor(Date.now() / 1000)
}

function load(): Provider[] {
  for (const candidate of [FILE, `${FILE}.bak`]) {
    try {
      if (!existsSync(candidate)) continue
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as Provider[]
      if (Array.isArray(parsed)) {
        const hadPlainSecrets = parsed.some((provider) => (!!provider.api_key && !isEncryptedSecret(provider.api_key)) || (!!provider.wallet_api_key && !isEncryptedSecret(provider.wallet_api_key)))
        const hadLegacyProviderProtocols = parsed.some((provider) => normalizeProviderProtocolId(provider.protocol, provider.protocol) !== provider.protocol)
        const providers = parsed.map((provider) => ({
          ...provider,
          protocol: provider.source === 'cli' ? provider.protocol : normalizeProviderProtocolId(provider.protocol, provider.protocol || 'openai'),
          api_key: decryptSecret(provider.api_key || ''),
          wallet_api_key: provider.wallet_api_key ? decryptSecret(provider.wallet_api_key) : undefined,
        }))
        for (const provider of providers) for (const model of provider.models || []) {
          if (model.caps?.length === 1 && model.caps[0] === 'other' && /(whisper|transcribe|speech-to-text|stt|\btts\b|audio|speech|voice|suno|udio|music)/i.test(model.model)) model.caps = ['audio']
        }
        if (candidate === FILE && (hadPlainSecrets || hadLegacyProviderProtocols)) persist(providers)
        return providers
      }
    } catch {
      /* 主文件损坏时继续读取上一版备份 */
    }
  }
  return []
}

function persist(list: Provider[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const temp = `${FILE}.tmp`
  const stored = list.map((provider) => ({
    ...provider,
    api_key: encryptSecret(provider.api_key || ''),
    wallet_api_key: provider.wallet_api_key ? encryptSecret(provider.wallet_api_key) : undefined,
  }))
  try {
    if (existsSync(FILE)) {
      const previous = JSON.parse(readFileSync(FILE, 'utf-8')) as Provider[]
      const encryptedPrevious = previous.map((provider) => ({
        ...provider,
        api_key: encryptSecret(decryptSecret(provider.api_key || '')),
        wallet_api_key: provider.wallet_api_key ? encryptSecret(decryptSecret(provider.wallet_api_key)) : undefined,
      }))
      writeFileSync(`${FILE}.bak`, JSON.stringify(encryptedPrevious, null, 2), 'utf-8')
    }
  } catch { /* 不用损坏的主文件覆盖有效备份 */ }
  writeFileSync(temp, JSON.stringify(stored, null, 2), 'utf-8')
  renameSync(temp, FILE)
}
export function getAutoFallback(): boolean { try { return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')).autoFallback !== false } catch { return true } }
export function setAutoFallback(autoFallback: boolean) { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(SETTINGS_FILE, JSON.stringify({ autoFallback }), 'utf-8'); return autoFallback }

function maskKey(key: string): string {
  const k = String(key || '')
  if (!k) return ''
  if (k.length <= 8) return '•'.repeat(k.length)
  return `${k.slice(0, 4)}••••••${k.slice(-4)}`
}

function toPublic(p: Provider): PublicProvider {
  const { api_key, wallet_api_key, ...rest } = p
  return {
    ...rest,
    has_key: !!api_key,
    key_mask: maskKey(api_key),
    has_wallet_key: !!wallet_api_key,
    wallet_key_mask: maskKey(wallet_api_key || ''),
  }
}

function normRhEntries(value: unknown, kind: 'app' | 'workflow'): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  const out: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const id = String(item.id || (kind === 'app' ? item.appId : item.workflowId) || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      ...item,
      id,
      [kind === 'app' ? 'appId' : 'workflowId']: id,
      title: String(item.title || `${kind === 'app' ? 'AI 应用' : '工作流'} ${id.slice(-6)}`),
      enabled: item.enabled !== false,
      fields: Array.isArray(item.fields) ? item.fields : [],
    })
  }
  return out
}

function slugify(text: string): string {
  const s = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || `api-${now()}`
}

function uniqueId(base: string, list: Provider[]): string {
  const taken = new Set(list.map((x) => x.id))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function normModels(models: unknown): ModelEntry[] {
  const out: ModelEntry[] = []
  const seen = new Set<string>()
  for (const raw of (models as unknown[]) || []) {
    const m = typeof raw === 'string' ? { model: raw } : (raw as Record<string, unknown>)
    const name = String(m?.model || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    let caps = (Array.isArray(m.caps) ? m.caps : []).map((c) => String(c).trim()).filter(Boolean)
    if (caps.length === 1 && caps[0] === 'other' && /(whisper|transcribe|speech-to-text|stt|\btts\b|audio|speech|voice|suno|udio|music)/i.test(name)) caps = ['audio']
    const rawProtocol = String(m.protocol || '').trim().toLowerCase()
    out.push({
      model: name,
      name: String(m.name || m.label || '').trim() || undefined,
      caps: caps.length ? caps : ['llm'],
      protocol: rawProtocol ? normalizeProtocolId(rawProtocol, rawProtocol) : '',
      cap_sort: typeof m.cap_sort === 'object' && m.cap_sort ? m.cap_sort as Partial<Record<ProviderCapability, number>> : undefined,
    })
  }
  return out
}

function normCustomProtocols(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 30)
}

export interface ModelCandidate { provider: Provider; model: ModelEntry }
export function modelCandidates(cap: ProviderCapability): ModelCandidate[] {
  return load().filter((p) => isUsableProvider(p, cap)).flatMap((provider) => provider.models.filter((model) => model.caps.includes(cap)).map((model) => ({ provider, model }))).sort((a, b) => (a.model.cap_sort?.[cap] ?? 999999) - (b.model.cap_sort?.[cap] ?? 999999) || capabilitySort(a.provider, cap) - capabilitySort(b.provider, cap))
}
export function reorderModels(cap: ProviderCapability, entries: { providerId: string; model: string }[]): PublicProvider[] {
  const ranks = new Map(entries.map((entry, i) => [`${entry.providerId}:${entry.model}`, i + 1]))
  const list = load()
  for (const provider of list) for (const model of provider.models) { const rank = ranks.get(`${provider.id}:${model.model}`); if (rank) { model.cap_sort ||= {}; model.cap_sort[cap] = rank } }
  persist(list)
  return listProviders()
}

export function listProviders(): PublicProvider[] {
  return load()
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.sort - b.sort || a.created_ts - b.created_ts)
    .map(toPublic)
}

export function getProvider(id: string): PublicProvider | null {
  const p = load().find((x) => x.id === id)
  return p ? toPublic(p) : null
}

/** 内部用：拿到带真实 key 的记录（供 test / models / chat 解析凭据）。 */
export function revealProvider(id: string): Provider | null {
  return load().find((x) => x.id === id) || null
}

/** 内部用：全部站点（带真实 key，按 sort 排序），供 agent/skill 选型扫描。 */
export function allProviders(): Provider[] {
  return load().sort((a, b) => a.sort - b.sort || a.created_ts - b.created_ts)
}

function capabilitySort(p: Provider, cap: ProviderCapability): number {
  return p.cap_sort?.[cap] ?? p.sort
}

function allProvidersForCapability(cap: ProviderCapability): Provider[] {
  return load().sort((a, b) => capabilitySort(a, cap) - capabilitySort(b, cap) || a.sort - b.sort || a.created_ts - b.created_ts)
}

function hasCapability(p: Provider, cap: ProviderCapability): boolean {
  return p.models.some((m) => (m.caps || []).includes(cap))
}

function isUsableProvider(p: Provider, cap: ProviderCapability): boolean {
  if (p.source === 'cli') {
    if (p.cli_tool === 'jimeng' && !jimengCliInstalled()) return false
    if ((p.cli_tool === 'codex' || p.cli_tool === 'gemini') && !agentCliInstalled(p.cli_tool)) return false
    return !!(p.enabled && p.cli_tool && hasCapability(p, cap))
  }
  return !!(p.enabled && p.api_key && p.base_url && hasCapability(p, cap))
}

/** 第一个「启用 + 有 key + 有指定能力模型」的站点，给 agent 默认调用用。 */
export function firstUsableProvider(cap: ProviderCapability = 'llm'): Provider | null {
  const list = allProvidersForCapability(cap)
  return list.find((p) => isUsableProvider(p, cap)) || null
}

export function saveProvider(obj: Record<string, unknown>): PublicProvider {
  const list = load()
  const explicitId = String(obj.id || '').trim()
  let id = explicitId
  const name = String(obj.name || '').trim()
  const source = obj.source === 'cli' ? 'cli' : 'api'
  const cli_tool = source === 'cli' ? String(obj.cli_tool || obj.cliTool || '').trim().toLowerCase() : ''
  const base_url = source === 'cli' ? String(obj.base_url || obj.baseUrl || `cli://${cli_tool || 'tool'}`).trim() : String(obj.base_url || obj.baseUrl || '').trim().replace(/\/+$/, '')
  const protocol = normalizeProviderProtocolId(String(obj.protocol || obj.default_protocol || ''), '')
  const customProtocolsProvided = Array.isArray(obj.custom_protocols)
  const custom_protocols = normCustomProtocols(obj.custom_protocols)
  const models = normModels(obj.models)
  const enabled = obj.enabled === false ? false : true
  const rawKey = obj.api_key ?? obj.apiKey
  const newKey = rawKey != null ? String(rawKey).trim() : ''
  const rawWalletKey = obj.wallet_api_key ?? obj.walletApiKey
  const newWalletKey = rawWalletKey != null ? String(rawWalletKey).trim() : ''
  const rhAppsProvided = Array.isArray(obj.rh_apps)
  const rhWorkflowsProvided = Array.isArray(obj.rh_workflows)
  const msLorasProvided = Array.isArray(obj.ms_loras)
  const msDefaultsVersionProvided = obj.ms_defaults_version !== undefined

  if (!id) id = uniqueId(slugify(name || base_url || 'api'), list)

  const idx = explicitId ? list.findIndex((x) => x.id === id) : -1
  const ts = now()
  if (idx >= 0) {
    const prev = list[idx]
    list[idx] = {
      ...prev,
      name: name || prev.name,
      base_url,
      api_key: newKey || prev.api_key, // 空 key 保留旧值，避免误清空
      wallet_api_key: newWalletKey || prev.wallet_api_key,
      protocol: source === 'cli' ? `cli:${cli_tool || 'tool'}` : protocol || prev.protocol,
      source,
      cli_tool,
      custom_protocols: customProtocolsProvided ? custom_protocols : prev.custom_protocols || [],
      models,
      rh_apps: rhAppsProvided ? normRhEntries(obj.rh_apps, 'app') : prev.rh_apps || [],
      rh_workflows: rhWorkflowsProvided ? normRhEntries(obj.rh_workflows, 'workflow') : prev.rh_workflows || [],
      ms_loras: msLorasProvided ? normalizeModelScopeLoras(obj.ms_loras) : prev.ms_loras || [],
      ms_defaults_version: msDefaultsVersionProvided ? Math.max(0, Number(obj.ms_defaults_version) || 0) : prev.ms_defaults_version || 0,
      enabled,
      updated_ts: ts,
    }
  } else {
    const maxSort = list.reduce((m, x) => Math.max(m, x.sort), 0)
    list.push({
      id,
      name: name || id,
      base_url,
      api_key: newKey,
      wallet_api_key: newWalletKey,
      protocol: source === 'cli' ? `cli:${cli_tool || 'tool'}` : protocol || 'openai',
      source,
      cli_tool,
      custom_protocols,
      models,
      rh_apps: normRhEntries(obj.rh_apps, 'app'),
      rh_workflows: normRhEntries(obj.rh_workflows, 'workflow'),
      ms_loras: normalizeModelScopeLoras(obj.ms_loras),
      ms_defaults_version: Math.max(0, Number(obj.ms_defaults_version) || 0),
      enabled,
      sort: maxSort + 1,
      created_ts: ts,
      updated_ts: ts,
    })
  }
  persist(list)
  return toPublic(list.find((x) => x.id === id)!)
}

export function setProviderEnabled(id: string, enabled: boolean): PublicProvider | null {
  const list = load()
  const p = list.find((x) => x.id === id)
  if (!p) return null
  p.enabled = enabled
  p.updated_ts = now()
  persist(list)
  return toPublic(p)
}

export function setProviderKeys(
  id: string,
  values: { apiKey?: string; walletApiKey?: string; clearApiKey?: boolean; clearWalletApiKey?: boolean },
): PublicProvider | null {
  const list = load()
  const provider = list.find((item) => item.id === id)
  if (!provider) return null
  if (values.clearApiKey) provider.api_key = ''
  else if (values.apiKey !== undefined) provider.api_key = String(values.apiKey || '').trim()
  if (values.clearWalletApiKey) provider.wallet_api_key = ''
  else if (values.walletApiKey !== undefined) provider.wallet_api_key = String(values.walletApiKey || '').trim()
  provider.updated_ts = now()
  persist(list)
  return toPublic(provider)
}

export function reorderProviders(ids: string[], cap?: ProviderCapability): PublicProvider[] {
  const order = new Map(ids.map((id, i) => [id, i + 1]))
  const list = load()
  const maxSort = list.reduce((m, x) => Math.max(m, x.sort), 0)
  for (const p of list) {
    const next = order.get(p.id)
    if (cap) {
      if (!p.cap_sort) p.cap_sort = {}
      if (next) p.cap_sort[cap] = next
    } else {
      p.sort = next || p.sort || maxSort + 1
    }
  }
  persist(list)
  return listProviders()
}

export function deleteProvider(id: string): boolean {
  const list = load()
  const next = list.filter((x) => x.id !== id)
  if (next.length === list.length) return false
  persist(next)
  return true
}
