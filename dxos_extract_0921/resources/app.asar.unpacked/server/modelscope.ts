import type { EditImageInput, GenImage, GenImageParams, ResolvedProvider } from './protocols.ts'

export const MODELSCOPE_CN_BASE_URL = 'https://api-inference.modelscope.cn/v1'
export const MODELSCOPE_GLOBAL_BASE_URL = 'https://api-inference.modelscope.ai/v1'
export const MODELSCOPE_DEFAULTS_VERSION = 3
export const MODELSCOPE_IMAGE_MODELS = [
  'Tongyi-MAI/Z-Image-Turbo',
  'Qwen/Qwen-Image-2512',
  'Qwen/Qwen-Image-Edit-2511',
  'black-forest-labs/FLUX.2-klein-9B',
]
export const MODELSCOPE_CHAT_MODELS = [
  'Qwen/Qwen3-235B-A22B',
  'Qwen/Qwen3-VL-235B-A22B-Instruct',
  'MiniMax/MiniMax-M2.7:MiniMax',
]

export interface ModelScopeLora {
  id: string
  name: string
  target_model: string
  strength: number
  enabled: boolean
  note: string
}

export const MODELSCOPE_DEFAULT_LORAS: ModelScopeLora[] = [
  { id: 'Daniel8152/film', name: 'Z-Image Film', target_model: 'Tongyi-MAI/Z-Image-Turbo', strength: 0.8, enabled: true, note: '' },
  { id: 'Daniel8152/Qwen-Image-2512-Film', name: 'Qwen Image 2512 Film', target_model: 'Qwen/Qwen-Image-2512', strength: 0.8, enabled: true, note: '' },
  { id: 'Daniel8152/Klein-enhance', name: 'Klein enhance', target_model: 'black-forest-labs/FLUX.2-klein-9B', strength: 0.8, enabled: true, note: '' },
]

export function normalizeModelScopeLoras(value: unknown): ModelScopeLora[] {
  if (!Array.isArray(value)) return []
  const out: ModelScopeLora[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const id = String(item.id || '').trim().slice(0, 180)
    const target = String(item.target_model || item.model || '').trim().slice(0, 180)
    if (!id || !target || seen.has(`${target}\n${id}`)) continue
    seen.add(`${target}\n${id}`)
    const parsed = Number(item.strength ?? item.default_strength ?? 0.8)
    out.push({
      id,
      name: String(item.name || id).trim().replace(/\s+/g, ' ').slice(0, 80) || id,
      target_model: target,
      strength: Math.max(0, Math.min(2, Number.isFinite(parsed) ? parsed : 0.8)),
      enabled: item.enabled !== false,
      note: String(item.note || '').trim().slice(0, 300),
    })
  }
  return out
}

function endpoint(baseUrl: string, path: string) {
  return `${String(baseUrl || MODELSCOPE_CN_BASE_URL).trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function imageDataUrl(input: EditImageInput) {
  return `data:${input.mime || 'image/png'};base64,${input.buf.toString('base64')}`
}

function collectImages(payload: any): GenImage[] {
  const values = [
    ...(Array.isArray(payload?.output_images) ? payload.output_images : []),
    ...(Array.isArray(payload?.images) ? payload.images : []),
    ...(Array.isArray(payload?.data) ? payload.data.map((item: any) => item?.url || item?.image_url || item?.b64_json) : []),
  ].filter(Boolean)
  return values.map((value: unknown) => {
    const text = String(value)
    return /^data:image\//i.test(text)
      ? { type: 'b64' as const, value: text.replace(/^data:image\/[^;]+;base64,/i, '') }
      : { type: 'url' as const, value: text }
  })
}

function loraPayload(params: GenImageParams): Record<string, number> | undefined {
  if (params.loras && typeof params.loras === 'object' && !Array.isArray(params.loras)) {
    const out: Record<string, number> = {}
    for (const [id, strength] of Object.entries(params.loras as Record<string, unknown>)) {
      const value = Number(strength)
      if (id.trim() && Number.isFinite(value)) out[id.trim()] = Math.max(0, Math.min(2, value))
    }
    if (Object.keys(out).length) return out
  }
  const id = String(params.modelscope_lora || '').trim()
  if (!id) return undefined
  const strength = Number(params.modelscope_lora_strength ?? 0.8)
  return { [id]: Math.max(0, Math.min(2, Number.isFinite(strength) ? strength : 0.8)) }
}

async function runModelScopeImageTask(provider: ResolvedProvider, model: string, params: GenImageParams, inputs: EditImageInput[], timeoutMs: number) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${String(provider.api_key || '').trim()}`,
    'X-ModelScope-Async-Mode': 'true',
  }
  const body: Record<string, unknown> = { model, prompt: String(params.prompt || '').trim() }
  if (params.size && params.size !== 'auto') body.size = params.size
  if (params.n) body.n = Math.max(1, Math.min(8, Number(params.n) || 1))
  if (inputs.length) body.image_url = inputs.map(imageDataUrl)
  const loras = loraPayload(params)
  if (loras) body.loras = loras

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const submit = await fetch(endpoint(provider.base_url, 'images/generations'), { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    const submitText = await submit.text()
    let payload: any
    try { payload = JSON.parse(submitText) } catch { payload = submitText }
    if (!submit.ok) throw new Error(`HTTP ${submit.status}: ${typeof payload === 'string' ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`)
    let images = collectImages(payload)
    if (images.length) return { images, raw: payload }
    const taskId = String(payload?.task_id || payload?.taskId || payload?.id || '').trim()
    if (!taskId) throw new Error(`ModelScope 未返回 task_id：${JSON.stringify(payload).slice(0, 500)}`)

    let last = payload
    while (!ctrl.signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const result = await fetch(endpoint(provider.base_url, `tasks/${encodeURIComponent(taskId)}`), {
        headers: { ...headers, 'X-ModelScope-Task-Type': 'image_generation' },
        signal: ctrl.signal,
      })
      const text = await result.text()
      try { last = JSON.parse(text) } catch { last = text }
      if (!result.ok) throw new Error(`HTTP ${result.status}: ${typeof last === 'string' ? last.slice(0, 500) : JSON.stringify(last).slice(0, 500)}`)
      images = collectImages(last)
      const status = String(last?.task_status || last?.status || '').toUpperCase()
      if (images.length && (!status || ['SUCCEED', 'SUCCEEDED', 'SUCCESS', 'COMPLETED'].includes(status))) return { images, raw: last }
      if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED', 'TIMEOUT', 'REJECTED'].includes(status)) {
        throw new Error(`ModelScope 图片任务失败：${JSON.stringify(last).slice(0, 500)}`)
      }
    }
    throw new Error('ModelScope 图片生成超时，请稍后重试。')
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('ModelScope 图片生成超时，请稍后重试。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function generateModelScopeImages(provider: ResolvedProvider, model: string, params: GenImageParams, timeoutMs: number) {
  return runModelScopeImageTask(provider, model, params, [], timeoutMs)
}

export function editModelScopeImages(provider: ResolvedProvider, model: string, params: GenImageParams, inputs: EditImageInput[], timeoutMs: number) {
  return runModelScopeImageTask(provider, model, params, inputs, timeoutMs)
}
