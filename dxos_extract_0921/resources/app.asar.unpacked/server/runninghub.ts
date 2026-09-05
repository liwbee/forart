import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Provider } from './store.ts'
import type { ChatInput, GenImage, GenImageParams, GenVideo, GenVideoParams, ResolvedProvider } from './protocols.ts'
import { dataPath } from './dataPaths.ts'

const PUBLIC_RH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'runninghub')
const CATALOG_FILE = join(PUBLIC_RH_DIR, 'catalog.json')
const WORKFLOW_FILE = join(PUBLIC_RH_DIR, 'workflows.json')
const PUBLIC_THUMB_DIR = join(PUBLIC_RH_DIR, 'thumbnails')
export const RUNNINGHUB_DEFAULT_BASE_URL = 'https://www.runninghub.ai'
const LLM_BASE_URL = 'https://llm.runninghub.ai/v1'
const MODEL_REGISTRY_URL = 'https://raw.githubusercontent.com/HM-RunningHub/ComfyUI_RH_OpenAPI/main/models_registry.json'
const MODEL_REGISTRY_CACHE_FILE = dataPath('cache', 'runninghub-models.json')
const MODEL_REGISTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FALLBACK_CHAT = ['google/gemini-3.1-flash-lite-preview', 'qwen/qwen3-vl-235b-a22b-instruct', 'qwen/qwen-plus', 'openai/gpt-5.1']
const FALLBACK_IMAGE = [
  'gpt-image-2.0/text-to-image-channel-low-price',
  'gpt-image-2.0/edit-channel-low-price',
  'gpt-image-2/text-to-image-official-stable',
  'gpt-image-2/image-to-image-official-stable',
  'nano-banana/text-to-image-official-stable',
  'nano-banana/edit-official-stable',
]
const FALLBACK_VIDEO = [
  'google/veo3.1-fast/text-to-video-channel-low-price',
  'sora-2/text-to-video-official-stable',
  'seedance-2.0-global/text-to-video',
  'seedance-2.0-global/image-to-video',
]
const ENDPOINT_ALIASES: Record<string, string> = {
  'gpt-image-2.0/text-to-image-channel-low-price': 'rhart-image-g-2/text-to-image',
  'gpt-image-2/text-to-image-channel-low-price': 'rhart-image-g-2/text-to-image',
  'gpt-image-2.0/edit-channel-low-price': 'rhart-image-g-2/image-to-image',
  'gpt-image-2/edit-channel-low-price': 'rhart-image-g-2/image-to-image',
  'gpt-image-2.0/image-to-image-channel-low-price': 'rhart-image-g-2/image-to-image',
  'gpt-image-2/image-to-image-channel-low-price': 'rhart-image-g-2/image-to-image',
  'nano-banana/text-to-image-channel-low-price': 'rhart-image-v1/text-to-image',
  'nano-banana/edit-channel-low-price': 'rhart-image-v1/edit',
  'Seedance2.0 Image to Video': 'bytedance/seedance-2.0-global/image-to-video',
  'Seedance2.0 Text to Video': 'bytedance/seedance-2.0-global/text-to-video',
}

export interface RunningHubField {
  id: string
  nodeId: string
  fieldName: string
  fieldValue: string
  fieldType: string
  label: string
  enabled: boolean
  sourceFromUpstream?: boolean
  group?: string
  note?: string
  options?: string[]
  random_enabled?: boolean
  min?: string | number
  max?: string | number
  step?: string | number
  imageOrder?: number
  required?: boolean
}
export interface RunningHubEntry {
  id: string
  appId?: string
  workflowId?: string
  title: string
  note?: string
  thumbnail?: string
  enabled: boolean
  hidden?: boolean
  fields?: RunningHubField[]
  workflowJson?: Record<string, unknown>
  optionalImageMode?: string
  raw?: Record<string, unknown>
  updatedAt?: number
}

function readJson(path: string): any {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null } catch { return null }
}

function normalizeField(raw: any): RunningHubField {
  const nodeId = String(raw?.nodeId || raw?.node_id || '')
  const fieldName = String(raw?.fieldName || raw?.inputName || raw?.name || '')
  const value = raw?.fieldValue ?? raw?.defaultValue ?? raw?.value ?? ''
  const options = Array.isArray(raw?.options) ? raw.options.map(String) : typeof raw?.options === 'string' ? raw.options.split(/[\r\n,]+/).map((x: string) => x.trim()).filter(Boolean) : []
  return {
    ...raw,
    id: String(raw?.id || `${nodeId}::${fieldName}`), nodeId, fieldName,
    fieldValue: typeof value === 'object' ? JSON.stringify(value) : String(value),
    fieldType: String(raw?.fieldType || inferFieldType(fieldName, value)),
    label: String(raw?.label || fieldName), enabled: raw?.enabled !== false, options,
  }
}

function normalizeEntry(raw: any, kind: 'app' | 'workflow'): RunningHubEntry | null {
  const id = String(raw?.id || (kind === 'app' ? raw?.appId : raw?.workflowId) || '').trim()
  if (!id) return null
  const builtinThumb = kind === 'workflow' && existsSync(join(PUBLIC_THUMB_DIR, `workflow-${id}.jpg`)) ? `/runninghub/thumbnails/workflow-${id}.jpg` : ''
  return {
    ...raw, id, [kind === 'app' ? 'appId' : 'workflowId']: id,
    title: String(raw?.title || `${kind === 'app' ? 'AI 应用' : '工作流'} ${id.slice(-6)}`),
    thumbnail: builtinThumb || String(raw?.thumbnail || '').replace(/^\/static\/runninghub\//, '/runninghub/'),
    enabled: raw?.enabled !== false,
    fields: Array.isArray(raw?.fields) ? raw.fields.map(normalizeField) : [],
  }
}

function mergeEntries(system: RunningHubEntry[], user: Record<string, unknown>[] | undefined, kind: 'app' | 'workflow') {
  const map = new Map(system.map((item) => [item.id, item]))
  for (const raw of user || []) {
    const item = normalizeEntry(raw, kind)
    if (!item) continue
    const builtin = map.get(item.id)
    map.set(item.id, {
      ...(builtin || {}),
      ...item,
      // 旧站点数据里有些条目只有 ID/标题。迁移时不能让空数组或空对象
      // 覆盖内置库中已经解析好的参数与工作流 JSON。
      fields: item.fields?.length ? item.fields : builtin?.fields || [],
      workflowJson: item.workflowJson && Object.keys(item.workflowJson).length ? item.workflowJson : builtin?.workflowJson,
      raw: item.raw && Object.keys(item.raw).length ? item.raw : builtin?.raw,
    })
  }
  // 保留隐藏墓碑给设置页，避免内置卡片删除后下一次打开又被合并回来。
  return [...map.values()]
}

export function runningHubCatalog(provider?: Provider | null) {
  const raw = readJson(CATALOG_FILE)
  const source = Array.isArray(raw) ? raw.find((item) => item?.id === 'runninghub') : raw
  const workflowStore = readJson(WORKFLOW_FILE) || {}
  const apps = (source?.rh_apps || []).map((item: any) => normalizeEntry(item, 'app')).filter(Boolean) as RunningHubEntry[]
  const workflows = (source?.rh_workflows || []).map((item: any) => {
    const id = String(item?.workflowId || item?.id || '')
    return normalizeEntry({ ...item, ...(workflowStore[id] || {}) }, 'workflow')
  }).filter(Boolean) as RunningHubEntry[]
  return {
    apps: mergeEntries(apps, provider?.rh_apps, 'app'),
    workflows: mergeEntries(workflows, provider?.rh_workflows, 'workflow'),
  }
}

function providerBase(provider: Pick<ResolvedProvider, 'base_url'>) { return String(provider.base_url || RUNNINGHUB_DEFAULT_BASE_URL).replace(/\/+$/, '') }
function openApiUrl(provider: Pick<ResolvedProvider, 'base_url'>, path: string) {
  const base = providerBase(provider).endsWith('/openapi/v2') ? providerBase(provider) : `${providerBase(provider)}/openapi/v2`
  return `${base}/${String(path || '').replace(/^\/+/, '')}`
}
function key(provider: ResolvedProvider, wallet = false) {
  const value = wallet ? provider.wallet_api_key : provider.api_key || provider.wallet_api_key
  if (!value) throw new Error(wallet ? '未配置 RunningHub 账户余额 API Key' : '未配置 RunningHub RH币 API Key')
  return value
}
function headers(provider: ResolvedProvider, wallet = false) {
  return { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${key(provider, wallet)}` }
}
async function requestJson(url: string, init: RequestInit, timeoutMs = 180000): Promise<any> {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await response.text()
    let payload: any
    try { payload = text ? JSON.parse(text) : {} } catch { payload = text }
    if (!response.ok) throw new Error(`RunningHub HTTP ${response.status}: ${typeof payload === 'string' ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`)
    return payload
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('RunningHub 请求超时')
    throw error
  } finally { clearTimeout(timer) }
}

function registryItems(raw: any): any[] {
  for (const value of [raw, raw?.data, raw?.models, raw?.list, raw?.items, raw?.records, raw?.result]) {
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object')
    for (const nested of [value?.models, value?.list, value?.items, value?.records, value?.data]) if (Array.isArray(nested)) return nested
  }
  return []
}
function modelId(item: any) { return String(item?.name_en || item?.id || item?.name || item?.endpoint || '').trim() }
function classifyModel(item: any) {
  const declared = String(item?.output_type || item?.outputType || '').toLowerCase()
  if (declared === 'image' || declared === 'video') return declared
  if (declared === 'chat' || declared === 'llm' || declared === 'text') return 'llm'
  const id = modelId(item).toLowerCase()
  if (/(video|veo|sora|seedance|kling)/.test(id)) return 'video'
  if (/(image|banana|flux|seedream|rhart-image)/.test(id)) return 'image'
  return 'llm'
}

function modelLabel(item: any, id = modelId(item)) {
  for (const key of ['name_cn', 'name_zh', 'zh_name', 'cn_name', 'display_name', 'displayName', 'title', 'label', 'nameCn', 'nameZh', 'chinese_name', 'chineseName']) {
    const value = String(item?.[key] || '').replace(/\s+/g, ' ').trim()
    if (value && value !== id) return value.slice(0, 160)
  }
  const name = String(item?.name || '').replace(/\s+/g, ' ').trim()
  return name && name !== id && !/^[A-Za-z0-9_./:-]+$/.test(name) ? name.slice(0, 160) : ''
}

type RunningHubRegistryCache = { updatedAt: number; items: any[] }
let memoryRegistryCache: RunningHubRegistryCache | null = null

function readRegistryCache(): RunningHubRegistryCache | null {
  if (memoryRegistryCache?.items?.length) return memoryRegistryCache
  try {
    const raw = JSON.parse(readFileSync(MODEL_REGISTRY_CACHE_FILE, 'utf8'))
    const items = registryItems(raw?.items)
    if (!items.length) return null
    memoryRegistryCache = { updatedAt: Number(raw?.updatedAt) || 0, items }
    return memoryRegistryCache
  } catch { return null }
}

function writeRegistryCache(items: any[]) {
  if (!items.length) return
  const cache = { updatedAt: Date.now(), items }
  memoryRegistryCache = cache
  try {
    mkdirSync(dirname(MODEL_REGISTRY_CACHE_FILE), { recursive: true })
    const temp = `${MODEL_REGISTRY_CACHE_FILE}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(cache), 'utf8')
    renameSync(temp, MODEL_REGISTRY_CACHE_FILE)
  } catch { /* 网络结果仍可用于本次请求 */ }
}

async function optionalRegistryRequest(url: string, init: RequestInit, timeoutMs: number) {
  try { return registryItems(await requestJson(url, init, timeoutMs)) } catch { return [] }
}

export async function fetchRunningHubModels(provider: ResolvedProvider, timeoutMs = 30000) {
  const cached = readRegistryCache()
  const cacheFresh = !!cached?.items?.length && Date.now() - cached.updatedAt < MODEL_REGISTRY_CACHE_TTL_MS
  const requestTimeout = Math.max(3000, Math.min(12000, timeoutMs))
  // 三个来源必须并发；旧实现逐个等待，在网络抖动时会叠加到几十秒。
  const [openApiItems, githubItems, llmItems] = await Promise.all([
    optionalRegistryRequest(openApiUrl(provider, 'models'), { headers: headers(provider, true) }, requestTimeout),
    cacheFresh ? Promise.resolve([]) : optionalRegistryRequest(MODEL_REGISTRY_URL, { headers: { Accept: 'application/json' } }, requestTimeout),
    optionalRegistryRequest(`${LLM_BASE_URL}/models`, { headers: headers(provider, true) }, requestTimeout),
  ])
  if (githubItems.length >= 100) writeRegistryCache(githubItems)
  const found: any[] = [
    ...(githubItems.length ? githubItems : cached?.items || []),
    ...openApiItems,
    ...llmItems,
  ]
  const byId = new Map<string, any>()
  for (const item of found) {
    const id = modelId(item)
    if (id) byId.set(id, { ...(byId.get(id) || {}), ...item })
  }
  for (const id of FALLBACK_CHAT) if (!byId.has(id)) byId.set(id, { name_en: id, output_type: 'chat' })
  for (const id of FALLBACK_IMAGE) if (!byId.has(id)) byId.set(id, { name_en: id, output_type: 'image' })
  for (const id of FALLBACK_VIDEO) if (!byId.has(id)) byId.set(id, { name_en: id, output_type: 'video' })
  return [...byId].map(([model, raw]) => ({ model, name: modelLabel(raw, model), type: classifyModel(raw), protocol: 'runninghub', raw }))
}

export async function callRunningHubChat(provider: ResolvedProvider, model: string, input: ChatInput, params: Record<string, unknown>, timeoutMs: number) {
  const started = Date.now()
  const prompt = String(input.prompt || '')
  const messages = Array.isArray(input.messages) ? input.messages : [{ role: 'user', content: prompt }]
  const raw = await requestJson(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST', headers: headers(provider, true), body: JSON.stringify({ model, messages, stream: false, ...params }),
  }, timeoutMs)
  return { text: String(raw?.choices?.[0]?.message?.content || raw?.choices?.[0]?.text || ''), usage: raw?.usage, latencyMs: Date.now() - started, raw }
}

export async function describeRunningHubImage(provider: ResolvedProvider, model: string, dataUrl: string | string[], prompt: string, timeoutMs: number) {
  const images = (Array.isArray(dataUrl) ? dataUrl : [dataUrl]).filter(Boolean)
  const raw = await requestJson(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST', headers: headers(provider, true), body: JSON.stringify({
      model, stream: false,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] }],
    }),
  }, timeoutMs)
  return String(raw?.choices?.[0]?.message?.content || raw?.choices?.[0]?.text || '')
}

function endpointForModel(model: string) {
  const clean = String(model).replace(/^\/?openapi\/v2\//, '').replace(/^\/+/, '')
  return ENDPOINT_ALIASES[clean] || clean
}

async function modelDefinition(provider: ResolvedProvider, model: string, timeoutMs: number) {
  const requested = String(model || '').replace(/^\/?openapi\/v2\//, '').replace(/^\/+/, '')
  const items = await fetchRunningHubModels(provider, timeoutMs)
  const found = items.find((item) => {
    const endpoint = String(item.raw?.endpoint || '').replace(/^\/?openapi\/v2\//, '').replace(/^\/+/, '')
    return item.model === requested || endpoint === requested
  })
  const raw = found?.raw || {}
  return {
    ...raw,
    name_en: found?.model || requested,
    endpoint: String(raw?.endpoint || endpointForModel(found?.model || requested)).replace(/^\/?openapi\/v2\//, '').replace(/^\/+/, ''),
    params: Array.isArray(raw?.params) ? raw.params : [],
  }
}

function schemaOptions(field: any) {
  return (Array.isArray(field?.options) ? field.options : []).map((item: any) => String(item && typeof item === 'object' ? item.value : item ?? '')).filter(Boolean)
}
function schemaField(params: any[], ...keys: string[]) {
  const wanted = new Set(keys.map((item) => item.toLowerCase()))
  return params.find((field) => wanted.has(String(field?.fieldKey || '').toLowerCase()) || wanted.has(String(field?.label || '').toLowerCase()))
}
function schemaValue(field: any, preferred: unknown) {
  const wanted = String(preferred ?? '').trim()
  const options = schemaOptions(field)
  if (wanted && (!options.length || options.includes(wanted))) return wanted
  if (field?.defaultValue !== undefined && field.defaultValue !== '') return field.defaultValue
  return options[0] ?? preferred
}
function applySchemaDefaults(body: Record<string, unknown>, params: any[]) {
  for (const field of params) {
    const key = String(field?.fieldKey || '').trim()
    if (!key || key in body) continue
    let value = field?.defaultValue
    const options = schemaOptions(field)
    if ((value === undefined || value === '') && field?.required && options.length) value = options[0]
    if (value === undefined || value === '') continue
    const type = String(field?.type || '').toUpperCase()
    if (type === 'BOOLEAN') body[key] = typeof value === 'string' ? value.toLowerCase() === 'true' : !!value
    else if (type === 'INT' || type === 'INTEGER') body[key] = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : value
    else if (type === 'FLOAT' || type === 'NUMBER') body[key] = Number.isFinite(Number(value)) ? Number(value) : value
    else body[key] = value
  }
}
function aspectFromSize(size: string, fallback = '1:1') {
  const pair = /^(\d+)x(\d+)$/i.exec(String(size || '').trim())
  if (pair) {
    let a = Number(pair[1]); let b = Number(pair[2])
    const gcd = (x: number, y: number): number => y ? gcd(y, x % y) : x
    const divisor = gcd(a, b) || 1; a /= divisor; b /= divisor
    return `${a}:${b}`
  }
  return /^\d+\s*:\s*\d+$/.test(size) ? size.replace(/\s/g, '') : fallback
}
function resolutionFromSize(size: string, fallback = '2k') {
  const pair = /^(\d+)x(\d+)$/i.exec(String(size || '').trim())
  if (pair) {
    const edge = Math.max(Number(pair[1]), Number(pair[2]))
    return edge >= 3072 ? '4k' : edge >= 1536 ? '2k' : '1k'
  }
  const raw = String(size || '').trim().toLowerCase()
  return ['1k', '2k', '4k', '480p', '720p', '1080p', 'native1080p'].includes(raw) ? raw : fallback
}
async function uploadBuffer(provider: ResolvedProvider, input: { buf: Buffer; mime: string; name: string }, useWallet = true) {
  const form = new FormData()
  form.append('apiKey', key(provider, useWallet))
  form.append('fileType', 'input')
  form.append('file', new Blob([new Uint8Array(input.buf)], { type: input.mime || 'application/octet-stream' }), input.name || 'asset.bin')
  const raw = await requestJson(`${providerBase(provider)}/task/openapi/upload`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${key(provider, useWallet)}` }, body: form }, 240000)
  const value = String(raw?.data?.fileName || raw?.data?.url || raw?.fileName || raw?.url || '')
  if (!value) throw new Error(String(raw?.msg || 'RunningHub 素材上传失败'))
  return value
}

async function uploadModelReference(
  provider: ResolvedProvider,
  input: { buf: Buffer; mime: string; name: string; publicUrl?: string },
) {
  const publicUrl = String(input.publicUrl || '').trim()
  if (/^https?:\/\//i.test(publicUrl)) return publicUrl
  const form = new FormData()
  const fileName = basename(input.name || 'asset.bin') || 'asset.bin'
  form.append('file', new Blob([new Uint8Array(input.buf)], { type: input.mime || 'application/octet-stream' }), fileName)
  const raw = await requestJson(openApiUrl(provider, 'media/upload/binary'), {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${key(provider, true)}` },
    body: form,
  }, 240000)
  const roots = [raw, raw?.data].filter((value) => value && typeof value === 'object')
  for (const value of roots) {
    const url = String(value.download_url || value.downloadUrl || value.url || value.fileUrl || value.file_url || '').trim()
    if (/^https?:\/\//i.test(url)) return url
  }
  throw new Error(`RunningHub 模型素材上传未返回 download_url：${JSON.stringify(raw).slice(0, 500)}`)
}
export async function uploadRunningHubAsset(provider: ResolvedProvider, input: { buf: Buffer; mime: string; name: string }, useWallet = false) {
  return uploadBuffer(provider, input, useWallet)
}
export function runningHubOutputUrls(raw: any, kind: 'image' | 'video' = 'image'): string[] {
  const out: string[] = []
  const mediaKey = kind === 'image' ? /image|file|download|output|result|url/i : /video|file|download|output|result|url/i
  const directUrlKey = kind === 'image'
    ? /^(url|uri|file_?url|download_?url|image_?url|grid_?image_?url)$/i
    : /^(url|uri|file_?url|download_?url|video_?url)$/i
  const mediaExt = kind === 'image' ? /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i : /\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i
  const visit = (value: any, depth = 0, keyHint = '') => {
    if (depth > 8 || value == null) return
    if (typeof value === 'string') {
      if (/^data:image\//i.test(value) && kind === 'image' && !out.includes(value)) out.push(value)
      else if (/^https?:\/\//i.test(value) && (mediaKey.test(keyHint) || mediaExt.test(value)) && !out.includes(value)) out.push(value)
      return
    }
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1, keyHint))
    if (typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) if (/^(data|results?|outputs?|files?|images?|videos?|content)$/i.test(key) || directUrlKey.test(key)) visit(item, depth + 1, key)
  }
  for (const root of [raw, raw?.data]) visit(root)
  return out
}
function taskId(raw: any) { return String(raw?.taskId || raw?.task_id || raw?.id || raw?.data?.taskId || raw?.data?.task_id || raw?.data?.id || '') }
async function waitOpenApi(provider: ResolvedProvider, id: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const raw = await requestJson(openApiUrl(provider, 'query'), { method: 'POST', headers: headers(provider, true), body: JSON.stringify({ taskId: id }) }, Math.min(60000, timeoutMs))
    const urls = runningHubOutputUrls(raw)
    const status = String(raw?.status || raw?.data?.status || raw?.state || raw?.data?.state || '').toUpperCase()
    if (urls.length || ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'DONE', 'FINISHED'].includes(status)) return raw
    if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(status)) throw new Error(String(raw?.msg || raw?.message || 'RunningHub 任务失败'))
  }
  throw new Error('RunningHub 任务超时')
}

export async function generateRunningHubImages(provider: ResolvedProvider, model: string, params: GenImageParams, timeoutMs: number): Promise<{ images: GenImage[]; raw: unknown }> {
  const definition = await modelDefinition(provider, model, Math.min(timeoutMs, 12000))
  const schema = definition.params
  const body: Record<string, unknown> = { prompt: String(params.prompt || '') }
  const size = String(params.size || '')
  const pair = /^(\d+)x(\d+)$/.exec(size)
  const aspectField = schemaField(schema, 'aspectRatio', 'ratio')
  const resolutionField = schemaField(schema, 'resolution')
  if (aspectField) body[String(aspectField.fieldKey)] = schemaValue(aspectField, aspectFromSize(size))
  else if (!schema.length && size.includes(':')) body.aspectRatio = size
  if (resolutionField) body[String(resolutionField.fieldKey)] = schemaValue(resolutionField, resolutionFromSize(size))
  if (pair) {
    const widthField = schemaField(schema, 'width'); const heightField = schemaField(schema, 'height')
    if (widthField || !schema.length) body[String(widthField?.fieldKey || 'width')] = Number(pair[1])
    if (heightField || !schema.length) body[String(heightField?.fieldKey || 'height')] = Number(pair[2])
  }
  const refs = (params as any).reference_images || []
  if (refs.length) {
    const imageField = schemaField(schema, 'imageUrls', 'imageUrl', 'images', 'image')
    const imageKey = String(imageField?.fieldKey || 'imageUrls')
    body[imageKey] = imageField && imageField.multipleInputs !== true && !imageKey.endsWith('s') ? refs[0] : refs
  }
  applySchemaDefaults(body, schema)
  let raw = await requestJson(openApiUrl(provider, definition.endpoint || endpointForModel(model)), { method: 'POST', headers: headers(provider, true), body: JSON.stringify(body) }, timeoutMs)
  const id = taskId(raw)
  if (id && !runningHubOutputUrls(raw).length) raw = await waitOpenApi(provider, id, timeoutMs)
  const images = runningHubOutputUrls(raw).map((value) => ({ type: value.startsWith('data:') ? 'b64' as const : 'url' as const, value: value.startsWith('data:') ? value.split(',')[1] || value : value }))
  if (!images.length) throw new Error(`RunningHub 任务完成但没有返回图片：${JSON.stringify(raw).slice(0, 800)}`)
  return { images, raw }
}

export async function editRunningHubImages(provider: ResolvedProvider, model: string, params: GenImageParams, inputs: { buf: Buffer; mime: string; name: string; remoteName?: string; publicUrl?: string }[], timeoutMs: number) {
  if (!inputs.length) throw new Error('RunningHub 图像编辑需要至少一张参考图')
  const imageUrls = await Promise.all(inputs.map((input) => uploadModelReference(provider, input)))
  return generateRunningHubImages(provider, model, { ...params, reference_images: imageUrls } as GenImageParams & { reference_images: string[] }, timeoutMs)
}

export async function generateRunningHubVideos(provider: ResolvedProvider, model: string, params: GenVideoParams, timeoutMs: number): Promise<{ videos: GenVideo[]; raw: unknown }> {
  const body: Record<string, unknown> = {
    prompt: String(params.prompt || ''),
    duration: params.duration,
    aspectRatio: params.aspect_ratio,
    resolution: params.resolution,
  }
  const [refs, videoRefs, audioRefs] = await Promise.all([
    Promise.all((params.images || []).map((item) => uploadModelReference(provider, item))),
    Promise.all((params.videos || []).map((item) => uploadModelReference(provider, item))),
    Promise.all((params.audios || []).map((item) => uploadModelReference(provider, item))),
  ])
  // RunningHub OpenAPI 以 imageUrls 的顺序区分首帧与尾帧；上层已在首尾帧模式中
  // 限定为按输入顺序排列的两张图片，不向模型端发送未声明的额外字段。
  if (refs.length) body.imageUrls = refs
  if (videoRefs.length) body.videoUrls = videoRefs
  if (audioRefs.length) body.audioUrls = audioRefs
  const definition = await modelDefinition(provider, model, Math.min(timeoutMs, 12000))
  let raw = await requestJson(openApiUrl(provider, definition.endpoint || endpointForModel(model)), { method: 'POST', headers: headers(provider, true), body: JSON.stringify(body) }, timeoutMs)
  const id = taskId(raw)
  if (id && !runningHubOutputUrls(raw, 'video').length) raw = await waitOpenApi(provider, id, timeoutMs)
  const videos = runningHubOutputUrls(raw, 'video').map((value) => ({ type: 'url' as const, value }))
  if (!videos.length) throw new Error('RunningHub 任务完成但没有返回视频')
  return { videos, raw }
}

function inferFieldType(name: string, value: unknown) {
  const keyName = String(name).toLowerCase()
  if (/image|photo|picture|mask/.test(keyName)) return 'IMAGE'
  if (/video/.test(keyName)) return 'VIDEO'
  if (/seed/.test(keyName)) return 'INT'
  if (typeof value === 'boolean' || /^(true|false)$/i.test(String(value))) return 'BOOLEAN'
  if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value))) return 'NUMBER'
  return 'TEXT'
}
export function fieldsFromWorkflow(workflow: any): RunningHubField[] {
  const fields: RunningHubField[] = []
  if (!workflow || typeof workflow !== 'object') return fields
  for (const [nodeId, node] of Object.entries<any>(workflow)) {
    if (!node?.inputs || typeof node.inputs !== 'object') continue
    for (const [fieldName, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number') continue
      fields.push(normalizeField({ nodeId, fieldName, fieldValue: value, fieldType: inferFieldType(fieldName, value), label: fieldName, enabled: false, group: node?._meta?.title || node?.class_type || '', required: /image/i.test(fieldName) }))
    }
  }
  return fields
}

export async function inspectRunningHubApp(provider: ResolvedProvider, appId: string) {
  const apiKey = key(provider)
  const url = `${providerBase(provider)}/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(apiKey)}&webappId=${encodeURIComponent(appId)}`
  const raw = await requestJson(url, { headers: headers(provider) })
  if (raw?.code != null && ![0, '0'].includes(raw.code)) throw new Error(String(raw?.msg || 'RunningHub AI 应用解析失败'))
  return raw?.data || raw
}
export async function inspectRunningHubWorkflow(provider: ResolvedProvider, workflowId: string) {
  const raw = await requestJson(`${providerBase(provider)}/api/openapi/getJsonApiFormat`, { method: 'POST', headers: headers(provider), body: JSON.stringify({ apiKey: key(provider), workflowId }) })
  if (raw?.code != null && ![0, '0'].includes(raw.code)) throw new Error(String(raw?.msg || 'RunningHub 工作流解析失败'))
  const prompt = raw?.data?.prompt
  const workflowJson = typeof prompt === 'string' ? JSON.parse(prompt || '{}') : prompt || {}
  return { workflowId, fields: fieldsFromWorkflow(workflowJson), workflowJson, raw }
}
function sanitizeNodeInfo(fields: any[]) {
  return (fields || []).filter((field) => field?.enabled !== false && field?.nodeId && field?.fieldName).map((field) => ({ nodeId: String(field.nodeId), fieldName: String(field.fieldName), fieldValue: String(field.fieldValue ?? '') }))
}
export async function submitRunningHubEntry(provider: ResolvedProvider, kind: 'app' | 'workflow', id: string, fields: any[], useWallet = false, workflow?: unknown, instanceType = '') {
  const body: Record<string, unknown> = { apiKey: key(provider, useWallet), nodeInfoList: sanitizeNodeInfo(fields) }
  if (instanceType.trim()) body.instanceType = instanceType.trim()
  let path = '/task/openapi/ai-app/run'
  if (kind === 'app') body.webappId = id
  else { path = '/task/openapi/create'; body.workflowId = id; body.addMetadata = true; if (workflow) body.workflow = typeof workflow === 'string' ? workflow : JSON.stringify(workflow) }
  const raw = await requestJson(`${providerBase(provider)}${path}`, { method: 'POST', headers: headers(provider, useWallet), body: JSON.stringify(body) })
  if (raw?.code != null && ![0, '0'].includes(raw.code)) throw new Error(String(raw?.msg || raw?.message || 'RunningHub 提交失败'))
  const idOut = taskId(raw)
  if (!idOut) throw new Error('RunningHub 未返回 taskId')
  return { taskId: idOut, raw }
}
export async function queryRunningHubTask(provider: ResolvedProvider, id: string, useWallet = false) {
  const raw = await requestJson(`${providerBase(provider)}/task/openapi/outputs`, { method: 'POST', headers: headers(provider, useWallet), body: JSON.stringify({ apiKey: key(provider, useWallet), taskId: id }) }, 240000)
  const code = raw?.code
  const status = [0, '0'].includes(code) ? 'SUCCESS' : [804, '804'].includes(code) ? 'RUNNING' : [813, '813'].includes(code) ? 'QUEUED' : [805, '805'].includes(code) ? 'FAILED' : 'UNKNOWN'
  return { status, urls: runningHubOutputUrls(raw?.data), failReason: raw?.msg || raw?.message || '', code, raw }
}
