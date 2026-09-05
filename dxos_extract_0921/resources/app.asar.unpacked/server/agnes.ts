import type { EditImageInput, GenImage, GenImageParams, GenVideo, GenVideoParams, ResolvedProvider } from './protocols.ts'
import { defaultProtocolClock, defaultProtocolTransport, type ProtocolClock, type ProtocolTransport } from './protocol-engine/transport.ts'

export const AGNES_BASE_URL = 'https://apihub.agnes-ai.com'
export const AGNES_KEY_URL = 'https://platform.agnes-ai.com/settings/apiKeys'
export const AGNES_IMAGE_MODELS = ['agnes-image-2.1-flash', 'agnes-image-2.0-flash']
export const AGNES_VIDEO_MODELS = ['agnes-video-2.5-flash', 'agnes-video-v2.0']

function endpoint(baseUrl: string, path: string) {
  return `${String(baseUrl || AGNES_BASE_URL).trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function authHeaders(provider: ResolvedProvider) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${String(provider.api_key || '').trim()}`,
  }
}

function dataUrl(input: EditImageInput) {
  return `data:${input.mime || 'image/png'};base64,${input.buf.toString('base64')}`
}

function imageResults(payload: any): GenImage[] {
  const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.images) ? payload.images : []
  return items.flatMap((item: any) => {
    if (typeof item === 'string') return [{ type: 'url' as const, value: item }]
    if (item?.url || item?.image_url) return [{ type: 'url' as const, value: String(item.url || item.image_url) }]
    if (item?.b64_json) return [{ type: 'b64' as const, value: String(item.b64_json) }]
    return []
  })
}

async function runAgnesImage(provider: ResolvedProvider, model: string, params: GenImageParams, inputs: EditImageInput[], timeoutMs: number, transport: ProtocolTransport) {
  const extraBody: Record<string, unknown> = { response_format: 'url' }
  if (inputs.length) extraBody.image = inputs.map(dataUrl)
  const body = { model, prompt: String(params.prompt || '').trim(), size: params.size || '1024x1024', extra_body: extraBody }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await transport.fetch(endpoint(provider.base_url, '/v1/images/generations'), {
      method: 'POST', headers: authHeaders(provider), body: JSON.stringify(body), signal: ctrl.signal,
    })
    const text = await response.text()
    let payload: any
    try { payload = JSON.parse(text) } catch { payload = text }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof payload === 'string' ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`)
    const images = imageResults(payload)
    if (!images.length) throw new Error(`Agnes 图片接口未返回图片：${JSON.stringify(payload).slice(0, 500)}`)
    return { images, raw: payload }
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('Agnes 图片生成超时，请稍后重试。')
    throw error
  } finally { clearTimeout(timer) }
}

export function generateAgnesImages(provider: ResolvedProvider, model: string, params: GenImageParams, timeoutMs: number, transport: ProtocolTransport = defaultProtocolTransport) {
  return runAgnesImage(provider, model, params, [], timeoutMs, transport)
}

export function editAgnesImages(provider: ResolvedProvider, model: string, params: GenImageParams, inputs: EditImageInput[], timeoutMs: number, transport: ProtocolTransport = defaultProtocolTransport) {
  return runAgnesImage(provider, model, params, inputs, timeoutMs, transport)
}

export function agnesDimensions(aspectRatio = '16:9', resolution = '720p') {
  const [baseWidth, baseHeight] = ({
    '16:9': [1152, 648], '9:16': [648, 1152], '4:3': [1024, 768], '3:4': [768, 1024],
    '1:1': [768, 768], '21:9': [1280, 544], '9:21': [544, 1280],
  } as Record<string, [number, number]>)[aspectRatio] || [1152, 768]
  const scale = ({ '480p': 0.625, '720p': 1, '780p': 1, '1080p': 1.5 } as Record<string, number>)[resolution.toLowerCase()] || 1
  return { width: Math.max(64, Math.round(baseWidth * scale / 8) * 8), height: Math.max(64, Math.round(baseHeight * scale / 8) * 8) }
}

export function agnesFrameCount(duration = 5, fps = 24) {
  const seconds = Math.max(1, Math.min(18, Math.round(Number(duration) || 5)))
  const frameRate = Math.max(1, Math.min(60, Math.round(Number(fps) || 24)))
  const target = Math.min(441, Math.max(9, seconds * frameRate))
  return { num_frames: Math.min(441, Math.max(9, 8 * Math.max(1, Math.round((target - 1) / 8)) + 1)), frame_rate: frameRate }
}

function videoUrls(value: any, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || value == null) return out
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && /\.(mp4|webm|mov)(\?|$)/i.test(value)) out.push(value)
    return out
  }
  if (Array.isArray(value)) { for (const item of value) videoUrls(item, out, depth + 1); return out }
  if (typeof value !== 'object') return out
  for (const key of ['video_url', 'videoUrl', 'url', 'output', 'outputs', 'videos', 'result', 'data']) {
    if (key in value) videoUrls(value[key], out, depth + 1)
  }
  return out
}

function taskStatus(payload: any) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  return String(data?.status || data?.task_status || payload?.status || '').toUpperCase()
}

export async function generateAgnesVideos(provider: ResolvedProvider, model: string, params: GenVideoParams, timeoutMs: number, transport: ProtocolTransport = defaultProtocolTransport, clock: ProtocolClock = defaultProtocolClock): Promise<{ videos: GenVideo[]; raw: unknown }> {
  const selectedModel = model || AGNES_VIDEO_MODELS[0]
  const isVideo25Flash = /^agnes-video-(?:v)?2\.5-flash(?:$|[-_])/i.test(selectedModel)
  const images = (params.images || []).slice(0, 4).map(dataUrl)
  let body: Record<string, unknown>
  if (isVideo25Flash) {
    const supportedRatios = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
    const requestedRatio = String(params.aspect_ratio || params.size || '16:9')
    const seconds = Math.max(4, Math.min(12, Math.round(Number(params.duration) || 5)))
    body = {
      model: selectedModel,
      prompt: String(params.prompt || ''),
      mode: images.length ? (params.multimodal || params.images?.some((item) => ['first_frame', 'last_frame'].includes(String(item.role || ''))) ? 'keyframe' : 'reference') : 'text',
      size: '720P',
      aspect_ratio: supportedRatios.has(requestedRatio) ? requestedRatio : '16:9',
      seconds: String(seconds),
      n: 1,
    }
  } else {
    // Agnes Video v2.0 使用像素尺寸与帧数；这些字段在 2.5 Flash 中会直接触发 HTTP 400。
    const { width, height } = agnesDimensions(String(params.aspect_ratio || params.size || '16:9'), String(params.resolution || '720p'))
    const frames = agnesFrameCount(params.duration, 24)
    body = { model: selectedModel, prompt: String(params.prompt || ''), width, height, ...frames }
  }
  if (isVideo25Flash && images.length) {
    body.images = images
  } else {
    if (images.length === 1) body.image = images[0]
    if (images.length > 1) {
      body.extra_body = { image: images, ...(params.multimodal || params.images?.some((item) => ['first_frame', 'last_frame'].includes(String(item.role || ''))) ? { mode: 'keyframes' } : {}) }
    }
  }
  if (params.seed !== undefined) body.seed = params.seed

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const submit = await transport.fetch(endpoint(provider.base_url, '/v1/videos'), { method: 'POST', headers: authHeaders(provider), body: JSON.stringify(body), signal: ctrl.signal })
    const text = await submit.text()
    let payload: any
    try { payload = JSON.parse(text) } catch { payload = text }
    if (!submit.ok) throw new Error(`HTTP ${submit.status}: ${typeof payload === 'string' ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`)
    let urls = videoUrls(payload)
    if (urls.length) return { videos: urls.map((value) => ({ type: 'url', value })), raw: payload }
    const videoId = String(payload?.video_id || payload?.task_id || payload?.id || '').trim()
    if (!videoId) throw new Error(`Agnes 未返回 video_id：${JSON.stringify(payload).slice(0, 500)}`)
    let last = payload
    let delay = 5000
    while (!ctrl.signal.aborted) {
      await clock.sleep(delay)
      const query = new URLSearchParams({ video_id: videoId, model_name: selectedModel })
      let response = await transport.fetch(endpoint(provider.base_url, `/agnesapi?${query}`), { headers: authHeaders(provider), signal: ctrl.signal })
      if (!response.ok) response = await transport.fetch(endpoint(provider.base_url, `/v1/videos/${encodeURIComponent(videoId)}`), { headers: authHeaders(provider), signal: ctrl.signal })
      const resultText = await response.text()
      try { last = JSON.parse(resultText) } catch { last = resultText }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${resultText.slice(0, 500)}`)
      urls = videoUrls(last)
      if (urls.length) return { videos: urls.map((value) => ({ type: 'url', value })), raw: last }
      const status = taskStatus(last)
      if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED', 'TIMEOUT', 'REJECTED'].includes(status)) throw new Error(`Agnes 视频任务失败：${JSON.stringify(last).slice(0, 500)}`)
      delay = Math.min(Math.round(delay * 1.35), 12000)
    }
    throw new Error('Agnes 视频生成超时，请稍后重试。')
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('Agnes 视频生成超时，请稍后重试。')
    throw error
  } finally { clearTimeout(timer) }
}
