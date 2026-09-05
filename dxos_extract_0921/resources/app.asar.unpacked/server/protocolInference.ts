import { PROTOCOLS, normalizeProtocol, normalizeProtocolId } from './protocols.ts'

export type InferredModelType = 'llm' | 'image' | 'video' | 'audio' | 'other'

export interface InferredModel {
  model: string
  type: InferredModelType
  caps: string[]
  protocol: string
  confidence: number
  reasons: string[]
}

export interface ProtocolInferenceResult {
  providerProtocol: string
  providerProtocolSuggestion: string
  confidence: number
  reasons: string[]
  models: InferredModel[]
  customProtocols: string[]
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

function hasProtocol(id: string) {
  return !!normalizeProtocolId(id, '')
}

function defaultModelProtocol(providerProtocol: string, type: InferredModelType) {
  if (providerProtocol === 'agtoken-video' || providerProtocol === 'agtoken') return 'agtoken-video'
  if (providerProtocol === 'zkki-model' || providerProtocol === 'zkki') return 'zkki-model'
  if (providerProtocol === 'grok2api') return 'grok2api'
  if (providerProtocol === 'modelscope') return 'modelscope'
  if (providerProtocol === 'volcengine') return 'volcengine'
  if (providerProtocol === 'agnes') return 'agnes'
  if (providerProtocol === 'v2-unified' && (type === 'image' || type === 'video')) return 'v2-unified'
  if (type === 'image') return 'openai-image'
  if (type === 'audio') return 'openai-audio'
  return 'openai-chat'
}

const PLATFORM_PROTOCOLS = new Set(['openai', 'apimart', 'agtoken', 'zkki', 'grok2api', 'agnes', 'modelscope', 'volcengine', 'runninghub'])

function normalizePlatformProtocol(protocol: string) {
  if (String(protocol || '').trim().toLowerCase() === 'agtoken') return 'agtoken'
  if (String(protocol || '').trim().toLowerCase() === 'zkki') return 'zkki'
  const normalized = normalizeProtocol(protocol || 'openai')
  return PLATFORM_PROTOCOLS.has(normalized) ? normalized : 'openai'
}

function platformProtocolFromBaseUrl(baseUrl: string, fallback: string) {
  const url = String(baseUrl || '').toLowerCase()
  if (normalizePlatformProtocol(fallback) === 'grok2api') return { protocol: 'grok2api', confidence: 98, reason: '已选择 Grok2API 网关协议' }
  if (/agtoken\.vip/.test(url)) return { protocol: 'agtoken', confidence: 98, reason: 'Base URL 命中 AGToken 视频平台' }
  if (/api\.zkki\.net/.test(url)) return { protocol: 'zkki', confidence: 98, reason: 'Base URL 命中 ZKKI 平台' }
  if (/api-inference\.modelscope\.(cn|ai)/.test(url)) return { protocol: 'modelscope', confidence: 96, reason: 'Base URL 命中 ModelScope 推理平台' }
  if (/ark\.[a-z0-9-]+\.volces\.com|volcengine\.com/.test(url)) return { protocol: 'volcengine', confidence: 98, reason: 'Base URL 命中火山方舟平台' }
  if (/apihub\.agnes-ai\.com/.test(url)) return { protocol: 'agnes', confidence: 96, reason: 'Base URL 命中 Agnes AI 平台' }
  if (/api\.apimart\.ai|(^|\/)apib\.ai(?=\/|$)/.test(url)) return { protocol: 'apimart', confidence: 92, reason: 'Base URL 命中已知异步聚合平台' }
  if (/api\.openai\.com|\/v1($|\/)/.test(url)) return { protocol: 'openai', confidence: 65, reason: 'Base URL 命中 OpenAI v1 形状' }
  if (/generativelanguage\.googleapis\.com|anthropic\.com|kling|kuaishou|suno|minimax|hailuo|pixverse|pika|vidu/.test(url)) {
    return { protocol: normalizePlatformProtocol(fallback), confidence: 45, reason: 'Base URL 命中厂商特征，厂商差异按模型协议处理' }
  }
  return { protocol: normalizePlatformProtocol(fallback), confidence: 35, reason: '未命中明显站点形态，沿用当前站点协议' }
}

function inferByModelName(model: string, providerProtocol: string, baseUrl = ''): InferredModel {
  const s = model.toLowerCase()
  const reasons: string[] = []
  let protocol = defaultModelProtocol(providerProtocol, 'llm')
  let type: InferredModelType = 'llm'
  let caps = ['llm']
  let confidence = 45

  const set = (next: Partial<InferredModel>, reason: string) => {
    if (next.protocol) protocol = next.protocol
    if (next.type) type = next.type
    if (next.caps) caps = next.caps
    if (next.confidence) confidence = Math.max(confidence, next.confidence)
    reasons.push(reason)
  }

  if (providerProtocol === 'volcengine' && /(?:doubao-)?seedream/.test(s)) {
    set({ protocol: 'volcengine', type: 'image', caps: ['image'], confidence: 98 }, '模型名命中火山 Seedream 图片模型')
  } else if (providerProtocol === 'volcengine' && /(?:doubao-)?seedance/.test(s)) {
    set({ protocol: 'volcengine', type: 'video', caps: ['video'], confidence: 98 }, '模型名命中火山 Seedance 视频模型')
  } else if (providerProtocol === 'grok2api' && /grok-imagine-image/.test(s)) {
    set({ protocol: 'grok2api', type: 'image', caps: ['image'], confidence: 96 }, '模型名命中 Grok2API 图片模型')
  } else if (providerProtocol === 'grok2api' && /grok-imagine-video/.test(s)) {
    set({ protocol: 'grok2api', type: 'video', caps: ['video'], confidence: 96 }, '模型名命中 Grok2API 视频模型')
  } else if (providerProtocol === 'grok2api' && /grok-(voice|stt)/.test(s)) {
    set({ protocol: 'grok2api', type: 'audio', caps: ['audio'], confidence: 96 }, '模型名命中 Grok2API 语音模型')
  } else if (providerProtocol === 'grok2api' && /^grok[-_.\d]/.test(s)) {
    set({ protocol: 'grok2api', type: 'llm', caps: ['llm'], confidence: 92 }, '模型名命中 Grok2API 对话模型')
  } else if (/(text-embedding|embedding|embed-|bge|e5-|gte-)/.test(s)) {
    set({ protocol: 'openai-embedding', type: 'other', caps: ['embedding'], confidence: 90 }, '模型名命中 embedding')
  } else if (/(whisper|transcribe|speech-to-text|stt)/.test(s)) {
    set({ protocol: 'openai-audio', type: 'audio', caps: ['audio'], confidence: 88 }, '模型名命中语音转写')
  } else if (/(tts|speech|voice)/.test(s)) {
    set({ protocol: 'openai-audio', type: 'audio', caps: ['audio'], confidence: 85 }, '模型名命中语音合成')
  } else if (/(suno|music|song|udio)/.test(s)) {
    set({ protocol: 'suno', type: 'audio', caps: ['audio'], confidence: 88 }, '模型名命中音乐生成')
  } else if (/(kling|可灵)/.test(s)) {
    set({ protocol: 'kling', type: 'video', caps: ['video'], confidence: 90 }, '模型名命中 Kling/可灵')
  } else if (/(pixverse)/.test(s)) {
    set({ protocol: 'pixverse', type: 'video', caps: ['video'], confidence: 90 }, '模型名命中 PixVerse')
  } else if (/(pika)/.test(s)) {
    set({ protocol: 'pika', type: 'video', caps: ['video'], confidence: 90 }, '模型名命中 Pika')
  } else if (/(vidu)/.test(s)) {
    set({ protocol: 'vidu', type: 'video', caps: ['video'], confidence: 90 }, '模型名命中 Vidu')
  } else if (/(minimax|hailuo|海螺)/.test(s)) {
    set({ protocol: 'minimax', type: 'video', caps: ['video'], confidence: 86 }, '模型名命中 MiniMax/海螺')
  } else if (/(wanx|wan\b|wan-|通义万相|qwen-image|qwen.?image)/.test(s)) {
    const isImage = /(image|img|qwen)/.test(s)
    set({ protocol: 'wanxiang', type: isImage ? 'image' : 'video', caps: [isImage ? 'image' : 'video'], confidence: 84 }, '模型名命中通义万相/Wan')
  } else if (/(sora|veo|runway|luma|video|cogvideo|seedance|hailuo|ray|(?:^|[-_])gen-?[34](?:\b|[-_.]))/.test(s)) {
    set({ protocol: hasProtocol(providerProtocol) && providerProtocol !== 'openai' ? providerProtocol : 'v2-unified', type: 'video', caps: ['video'], confidence: 76 }, '模型名命中视频生成')
  } else if (/(gpt-image|dall.?e|image|img|flux|stable.?diffusion|sdxl|sd3|midjourney|imagen|recraft|ideogram|photon|cogview)/.test(s)) {
    // OpenAI-compatible relay sites commonly expose Gemini/Nano Banana images
    // through /v1/images/generations. Only select Google's native
    // generateContent runtime when the configured endpoint is actually Google.
    const nativeGeminiEndpoint = /generativelanguage\.googleapis\.com/i.test(baseUrl)
    let comflyGenerationsEndpoint = false
    try { comflyGenerationsEndpoint = new URL(baseUrl).hostname.toLowerCase() === 'ai.comfly.org' } catch { /* invalid/partial URL */ }
    const isGeminiImage = /(gemini|imagen|nano[-_.]?banana)/.test(s)
    const imageProtocol = isGeminiImage
      ? nativeGeminiEndpoint ? 'gemini-image' : comflyGenerationsEndpoint ? 'gemini-generations' : 'openai-image'
      : 'openai-image'
    set({ protocol: imageProtocol, type: 'image', caps: ['image'], confidence: 82 }, '模型名命中图像生成')
  } else if (/(claude)/.test(s)) {
    set({ protocol: 'anthropic-chat', type: 'llm', caps: ['llm'], confidence: 85 }, '模型名命中 Claude')
  } else if (/(gemini)/.test(s)) {
    set({ protocol: 'gemini-chat', type: 'llm', caps: ['llm'], confidence: 80 }, '模型名命中 Gemini')
  } else if (/(gpt|o\d|deepseek|qwen|glm|yi-|moonshot|kimi|doubao|llama|mistral|mixtral|ernie|hunyuan)/.test(s)) {
    set({ protocol: defaultModelProtocol(providerProtocol, 'llm'), type: 'llm', caps: ['llm'], confidence: 72 }, '模型名命中 LLM')
  } else {
    reasons.push('未命中模型名规则，按默认 LLM 处理')
  }

  if (providerProtocol === 'modelscope') {
    protocol = 'modelscope'
    reasons.push('ModelScope 模型统一使用原生异步图片/兼容对话协议')
  } else if (providerProtocol === 'volcengine') {
    protocol = 'volcengine'
    reasons.push('火山方舟模型统一使用兼容对话、Seedream 图片或 Seedance 视频协议')
  } else if (providerProtocol === 'agnes') {
    protocol = 'agnes'
    reasons.push('Agnes 模型统一使用原生图片/视频和兼容对话协议')
  } else if (providerProtocol === 'agtoken' || providerProtocol === 'agtoken-video') {
    protocol = 'agtoken-video'
    type = 'video'
    caps = ['video']
    confidence = Math.max(confidence, 96)
    reasons.push('AGToken 模型统一使用 AG 视频模型协议')
  } else if (providerProtocol === 'zkki' || providerProtocol === 'zkki-model') {
    protocol = 'zkki-model'
    if (/seedream|gpt-image/i.test(s)) {
      type = 'image'
      caps = [type]
    } else {
      type = 'video'
      caps = ['video']
    }
    confidence = Math.max(confidence, 96)
    reasons.push('ZKKI 模型统一使用 ZKKI 模型协议')
  } else if (!hasProtocol(protocol)) {
    reasons.push(`协议 ${protocol} 未在内置协议中声明，回退到 ${defaultModelProtocol(providerProtocol, type)}`)
    protocol = defaultModelProtocol(providerProtocol, type)
    confidence = Math.min(confidence, 55)
  }

  return { model, type, caps: unique(caps), protocol, confidence, reasons }
}

export function inferProviderProtocols(input: {
  baseUrl?: string
  protocol?: string
  models?: string[]
}): ProtocolInferenceResult {
  const base = platformProtocolFromBaseUrl(input.baseUrl || '', input.protocol || 'openai')
  const models = unique((input.models || []).map(String).map((item) => item.trim()).filter(Boolean))
  const inferredModels = models.map((model) => inferByModelName(model, base.protocol, input.baseUrl || ''))
  const asyncScore = inferredModels
    .filter((model) => model.type === 'video' || model.caps.includes('audio'))
    .reduce((sum, model) => sum + model.confidence, 0)
  const providerProtocol = base.protocol
  const reasons = [base.reason]
  const normalizedModels = inferredModels.map((model) => ({
    ...model,
    protocol: model.protocol === providerProtocol ? '' : model.protocol,
  }))
  return {
    providerProtocol,
    providerProtocolSuggestion: providerProtocol,
    confidence: Math.max(base.confidence, Math.round(asyncScore / Math.max(1, models.length))),
    reasons,
    models: normalizedModels,
    customProtocols: unique(normalizedModels.map((model) => model.protocol).filter(Boolean)),
  }
}
