import { PROTOCOLS, PROVIDER_PROTOCOLS, modelProtocolAlias, normalizeProtocol, type ProtocolDef } from './protocols.ts'
import type { CapabilityIntent, CapabilityRequirement, CapabilitySource, ModelCapabilityManifest, TaskIntent } from './capabilityTypes.ts'

type RawProfile = {
  label?: string
  match?: string[]
  capabilities?: string[]
  uiSchemas?: string[]
  operationPreference?: string[]
  defaults?: Record<string, unknown>
  limits?: Record<string, unknown>
  priority?: number
}

const COARSE_TO_INTENTS: Record<string, CapabilityIntent[]> = {
  llm: ['llm.chat'],
  vlm: ['llm.chat.vision'],
  vision: ['llm.chat.vision'],
  tools: ['llm.tools'],
  responses: ['llm.responses'],
  image: ['image.generate'],
  video: ['video.generate'],
  audio: ['audio.tts'],
  embedding: ['embeddings.create'],
  embeddings: ['embeddings.create'],
  moderation: ['moderation.create'],
  files: ['files.upload'],
  batches: ['batches.create'],
}

// 精细视频能力对旧协议 operation 的兼容映射。能力 ID 用于路由和理解，
// 实际平台仍可复用同一个提交端点，不要求每个平台复制一套请求实现。
const OPERATION_FALLBACKS: Record<string, CapabilityIntent[]> = {
  'video.text_to_video': ['video.generate'],
  'video.first_last_frame': ['video.image_to_video'],
  'video.multi_reference': ['video.image_to_video'],
  'video.video_to_video': ['video.image_to_video'],
  'video.audio_reference': ['video.image_to_video'],
  'video.multimodal': ['video.image_to_video'],
}

const TASK_INTENT_REQUIREMENTS: Record<string, CapabilityRequirement> = {
  'agent.project.write': { taskIntent: 'agent.project.write', requiresAll: ['llm.tools'], requiresAny: [] },
  'agent.code.review': { taskIntent: 'agent.code.review', requiresAll: ['llm.tools'], requiresAny: ['llm.structured_output', 'llm.chat'] },
  'agent.analyze_image_and_write': { taskIntent: 'agent.analyze_image_and_write', requiresAll: ['llm.chat.vision', 'llm.tools'], requiresAny: [] },
  'app.canvas.generate_image': { taskIntent: 'app.canvas.generate_image', requiresAll: ['image.generate'], requiresAny: [] },
  'app.canvas.edit_image': { taskIntent: 'app.canvas.edit_image', requiresAll: ['image.edit'], requiresAny: [] },
  'skill.video.compose': { taskIntent: 'skill.video.compose', requiresAll: [], requiresAny: ['video.generate', 'video.image_to_video'] },
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

function manifestProtocolId(protocolId: string) {
  const direct = String(protocolId || '').trim().toLowerCase()
  return PROTOCOLS[direct] || PROVIDER_PROTOCOLS[direct] ? direct : normalizeProtocol(protocolId)
}

function manifestDefinition(protocolId: string): ProtocolDef | undefined {
  const id = manifestProtocolId(protocolId)
  return PROTOCOLS[id] || PROVIDER_PROTOCOLS[id] as unknown as ProtocolDef | undefined
}

function mergeLimitObjects(baseValue: unknown, overrideValue: unknown): Record<string, unknown> {
  const base = asRecord(baseValue)
  const override = asRecord(overrideValue)
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = Object.keys(asRecord(value)).length && Object.keys(asRecord(base[key])).length
      ? mergeLimitObjects(base[key], value)
      : value
  }
  return out
}

function effectiveLimits(rawLimits: unknown, intent: CapabilityIntent) {
  const limits = asRecord(rawLimits)
  const { byCapability: _byCapability, ...base } = limits
  const byCapability = asRecord(limits.byCapability)
  return mergeLimitObjects(base, byCapability[intent])
}

function limitOptions(rule: Record<string, unknown>) {
  return Array.isArray(rule.options) ? rule.options : Array.isArray(rule.values) ? rule.values : []
}

function applyLimitsToFields(fields: unknown[], limits: Record<string, unknown>) {
  const features = asRecord(limits.features)
  return fields.flatMap((field) => {
    const data = asRecord(field)
    const key = String(data.key || '')
    if (!key || features[key] === false) return []
    const rule = asRecord(limits[key])
    if (rule.supported === false) return []
    const next: Record<string, unknown> = { ...data }
    const options = limitOptions(rule)
    if (options.length) next.options = options.map((value) => typeof value === 'object' && value ? value : { label: String(value).toUpperCase(), value })
    else if (Array.isArray(next.options) && (rule.min != null || rule.max != null)) {
      next.options = next.options.filter((option) => {
        const value = Number(asRecord(option).value ?? option)
        return Number.isFinite(value) && (rule.min == null || value >= Number(rule.min)) && (rule.max == null || value <= Number(rule.max))
      })
    }
    for (const prop of ['min', 'max', 'step', 'default', 'readonly']) {
      if (Object.prototype.hasOwnProperty.call(rule, prop)) next[prop] = rule[prop]
    }
    if (next.type === 'select' && Array.isArray(next.options) && next.options.length) {
      const values = next.options.map((option) => asRecord(option).value ?? option)
      if (!values.some((value) => String(value) === String(next.default))) next.default = rule.default ?? values[0]
    }
    return [next]
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function schemaDefaults(fields: unknown): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  if (!Array.isArray(fields)) return defaults
  for (const field of fields) {
    const obj = asRecord(field)
    const key = String(obj.key || '').trim()
    if (key && Object.prototype.hasOwnProperty.call(obj, 'default')) defaults[key] = obj.default
  }
  return defaults
}

function fallbackIntents(def: ProtocolDef) {
  const sources: Partial<Record<CapabilityIntent, CapabilitySource>> = {}
  const capabilities = Object.keys(def.capabilities || {}).flatMap((cap) => COARSE_TO_INTENTS[cap] || [])
  for (const intent of capabilities) sources[intent] = 'fallback'
  return { capabilities: unique(capabilities), sources }
}

function rawProfiles(def: ProtocolDef) {
  return Object.entries(def.modelProfiles || {}).map(([id, raw]) => ({ id, data: asRecord(raw) as RawProfile }))
}

function matchesProfile(profileId: string, profile: RawProfile, model: string) {
  const normalized = model.toLowerCase()
  if (profileId.toLowerCase() === normalized) return true
  return (profile.match || []).some((pattern) => normalized.startsWith(String(pattern).toLowerCase()))
}

function pickOperation(def: ProtocolDef, capabilities: CapabilityIntent[], profile?: RawProfile, intent?: CapabilityIntent) {
  const operations = asRecord(def.operations)
  const preferred = [
    ...(intent ? [intent] : []),
    ...(intent ? OPERATION_FALLBACKS[intent] || [] : []),
    ...((profile?.operationPreference || []) as string[]),
    ...capabilities,
  ]
  return preferred.find((operationId) => !!operations[operationId]) || Object.keys(operations)[0] || ''
}

function operationUiSchemaId(operation: Record<string, unknown>) {
  return typeof operation.uiSchema === 'string' ? operation.uiSchema : undefined
}

export function listProtocolPackages() {
  return Object.values(PROTOCOLS).map((def) => ({
    id: def.id,
    label: def.label,
    summary: def.summary,
    categories: def.categories || [],
    capabilities: protocolCapabilities(def.id),
    operations: Object.keys(def.operations || {}),
    modelProfiles: Object.keys(def.modelProfiles || {}),
    uiSchemas: Object.keys(def.uiSchemas || {}),
  }))
}

export function protocolCapabilities(protocolId: string): CapabilityIntent[] {
  const def = manifestDefinition(protocolId)
  if (!def) return []
  const fallback = fallbackIntents(def).capabilities
  const profileCaps = rawProfiles(def).flatMap((profile) => (profile.data.capabilities || []).map(String))
  const operationCaps = Object.keys(def.operations || {})
  return unique([...fallback, ...profileCaps, ...operationCaps])
}

export function taskIntentRequirement(taskIntent?: TaskIntent, intent?: CapabilityIntent): CapabilityRequirement {
  if (taskIntent && TASK_INTENT_REQUIREMENTS[taskIntent]) return TASK_INTENT_REQUIREMENTS[taskIntent]
  return {
    taskIntent,
    intent,
    requiresAll: intent ? [intent] : [],
    requiresAny: [],
  }
}

export function resolveProtocolModelProfile(protocolId: string, model: string): ModelCapabilityManifest {
  const alias = modelProtocolAlias(protocolId)
  const resolvedProtocolId = manifestProtocolId(protocolId)
  const def = manifestDefinition(resolvedProtocolId)
  if (!def) throw new Error(`协议不存在：${protocolId}`)

  const fallback = fallbackIntents(def)
  const profileEntry = rawProfiles(def).find((entry) => matchesProfile(entry.id, entry.data, model))
  const profile = profileEntry?.data
  const profileCapabilities = profile ? (profile.capabilities || []).map(String) : alias ? alias.capabilities.map(String) : []
  const capabilities = alias || profile ? unique(profileCapabilities) : fallback.capabilities
  const capabilitySources: Partial<Record<CapabilityIntent, CapabilitySource>> = alias || profile ? {} : { ...fallback.sources }
  for (const capability of profileCapabilities) capabilitySources[capability] = 'profile'

  const operationId = pickOperation(def, capabilities, profile)
  const operation = asRecord(asRecord(def.operations)[operationId])
  const uiSchemaId = operationUiSchemaId(operation) || (profile?.uiSchemas || [])[0]
  const uiSchemas = unique([...(profile?.uiSchemas || []).map(String), ...(uiSchemaId ? [uiSchemaId] : [])])
  const defaults = {
    ...schemaDefaults(uiSchemaId ? asRecord(def.uiSchemas)[uiSchemaId] : undefined),
    ...asRecord(profile?.defaults),
  }

  return {
    protocolId: alias ? String(protocolId || '').trim().toLowerCase() : resolvedProtocolId,
    model,
    coarseCaps: Object.keys(def.capabilities || {}).map((cap) => cap === 'llm' || cap === 'image' || cap === 'video' ? cap : 'other'),
    capabilities,
    defaultOperations: Object.fromEntries(capabilities.map((capability) => [capability, pickOperation(def, capabilities, profile, capability)]).filter(([, op]) => op)),
    uiSchemas,
    defaults,
    limits: asRecord(profile?.limits),
    capabilitySources,
    priority: Number(profile?.priority ?? 999999),
    profileId: profileEntry?.id,
    profileLabel: profile?.label,
  }
}

export function resolveOperation(protocolId: string, model: string, intent: CapabilityIntent): { id: string; operation: Record<string, unknown> } | null {
  const def = manifestDefinition(protocolId)
  if (!def) return null
  const manifest = resolveProtocolModelProfile(protocolId, model)
  const operationId = manifest.defaultOperations[intent] || pickOperation(def, manifest.capabilities, undefined, intent)
  const operation = asRecord(asRecord(def.operations)[operationId])
  return operationId && Object.keys(operation).length ? { id: operationId, operation } : null
}

export function resolveUiSchema(protocolId: string, operationId: string, model?: string): { id: string; fields: unknown[]; defaults: Record<string, unknown> } | null {
  const def = manifestDefinition(protocolId)
  if (!def) return null
  const operation = asRecord(asRecord(def.operations)[operationId])
  const uiSchemaId = operationUiSchemaId(operation) || (model ? resolveProtocolModelProfile(protocolId, model).uiSchemas[0] : undefined)
  if (!uiSchemaId) return null
  const fields = asRecord(def.uiSchemas)[uiSchemaId]
  if (!Array.isArray(fields)) return null
  return { id: uiSchemaId, fields, defaults: schemaDefaults(fields) }
}

function capabilityGroup(intent: CapabilityIntent): 'llm' | 'image' | 'video' | 'audio' | 'embedding' | 'moderation' | 'files' | 'batches' {
  if (intent.startsWith('image.')) return 'image'
  if (intent.startsWith('video.')) return 'video'
  if (intent.startsWith('audio.')) return 'audio'
  if (intent.startsWith('embedding') || intent.startsWith('rag.embedding')) return 'embedding'
  if (intent.startsWith('moderation.')) return 'moderation'
  if (intent.startsWith('files.')) return 'files'
  if (intent.startsWith('batches.')) return 'batches'
  return 'llm'
}

function fieldVisibleForModel(field: unknown, model: string) {
  const showWhen = asRecord(asRecord(field).showWhen)
  const models = Array.isArray(showWhen.models) ? showWhen.models.map(String).filter(Boolean) : []
  return !models.length || models.includes(model)
}

export function resolveParameterSchema(
  protocolId: string,
  model: string,
  intent: CapabilityIntent,
): {
  protocolId: string
  model: string
  intent: CapabilityIntent
  operationId: string
  operation: Record<string, unknown>
  schemaId: string
  source: 'uiSchema' | 'paramSchema'
  fields: unknown[]
  defaults: Record<string, unknown>
  limits: Record<string, unknown>
} | null {
  const resolvedProtocolId = manifestProtocolId(protocolId)
  const def = manifestDefinition(resolvedProtocolId)
  if (!def) return null
  const manifest = resolveProtocolModelProfile(resolvedProtocolId, model)
  const limits = effectiveLimits(manifest.limits, intent)
  const operation = resolveOperation(resolvedProtocolId, model, intent)
  const uiSchema = operation ? resolveUiSchema(resolvedProtocolId, operation.id, model) : null
  if (uiSchema) {
    const fields = applyLimitsToFields(uiSchema.fields.filter((field) => fieldVisibleForModel(field, model)), limits)
    return {
      protocolId: resolvedProtocolId,
      model,
      intent,
      operationId: operation?.id || intent,
      operation: operation?.operation || {},
      schemaId: uiSchema.id,
      source: 'uiSchema',
      fields,
      defaults: { ...manifest.defaults, ...schemaDefaults(fields) },
      limits,
    }
  }
  const group = capabilityGroup(intent)
  const fields = (def.paramSchema?.[group] || []).filter((field) => fieldVisibleForModel(field, model))
  if (!fields.length) return null
  const limitedFields = applyLimitsToFields(fields, limits)
  return {
    protocolId: resolvedProtocolId,
    model,
    intent,
    operationId: operation?.id || intent,
    operation: operation?.operation || {},
    schemaId: `${resolvedProtocolId}.${group}`,
    source: 'paramSchema',
    fields: limitedFields,
    defaults: { ...manifest.defaults, ...schemaDefaults(limitedFields) },
    limits,
  }
}

export function validateProtocolParameters(
  protocolId: string,
  model: string,
  intent: CapabilityIntent,
  params: Record<string, unknown>,
  references: { images?: number; videos?: number; audios?: number } = {},
) {
  const manifest = resolveProtocolModelProfile(protocolId, model)
  const limits = effectiveLimits(manifest.limits, intent)
  const label = manifest.profileLabel || model
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    const rule = asRecord(limits[key])
    if (rule.supported === false || asRecord(limits.features)[key] === false) {
      if (value === false) continue
      throw new Error(`${label} 不支持参数「${key}」。`)
    }
    const number = typeof value === 'number' ? value : Number(value)
    if (rule.integer === true && !Number.isInteger(number)) throw new Error(`${label} 的「${key}」必须是整数。`)
    if (rule.min != null && Number.isFinite(number) && number < Number(rule.min)) throw new Error(`${label} 的「${key}」不能小于 ${rule.min}。`)
    if (rule.max != null && Number.isFinite(number) && number > Number(rule.max)) throw new Error(`${label} 的「${key}」不能大于 ${rule.max}。`)
    const options = limitOptions(rule).map((option) => String(asRecord(option).value ?? option).toLowerCase())
    if (options.length && !options.includes(String(value).toLowerCase())) throw new Error(`${label} 的「${key}」只支持：${options.join('、')}。`)
  }
  const referenceLimits = asRecord(limits.references)
  for (const kind of ['images', 'videos', 'audios'] as const) {
    const count = Number(references[kind] || 0)
    const rule = asRecord(referenceLimits[kind])
    if (rule.min != null && count < Number(rule.min)) throw new Error(`${label} 至少需要 ${rule.min} 个${kind === 'images' ? '图片' : kind === 'videos' ? '视频' : '音频'}参考。`)
    if (rule.max != null && count > Number(rule.max)) throw new Error(`${label} 最多支持 ${rule.max} 个${kind === 'images' ? '图片' : kind === 'videos' ? '视频' : '音频'}参考。`)
  }
  return limits
}

export function listTaskIntentRequirements() {
  return { ...TASK_INTENT_REQUIREMENTS }
}
