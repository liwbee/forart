import type { Provider } from './store.ts'
import { allProviders } from './store.ts'
import { resolveOperation, resolveProtocolModelProfile, taskIntentRequirement } from './protocolManifest.ts'
import type { CapabilityIntent, FallbackPolicy, PreferredModel, ResolvedModelRoute, RouteRequest } from './capabilityTypes.ts'

type Candidate = {
  provider: Provider
  model: Provider['models'][number]
  capabilities: CapabilityIntent[]
  satisfied: CapabilityIntent[]
  missing: CapabilityIntent[]
  score: number
  reasons: string[]
  warnings: string[]
  familyMatch: boolean
}

const COARSE_TO_INTENTS: Record<string, CapabilityIntent[]> = {
  llm: ['llm.chat'],
  vlm: ['llm.chat.vision'],
  image: ['image.generate'],
  video: ['video.generate'],
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

function providerUsable(provider: Provider) {
  if (!provider.enabled) return false
  if (provider.source === 'cli') return !!provider.cli_tool
  return !!(provider.api_key && provider.base_url)
}

function coarseForIntent(intent: CapabilityIntent) {
  if (intent.startsWith('image.')) return 'image'
  if (intent.startsWith('video.')) return 'video'
  return 'llm'
}

function capabilitySort(provider: Provider, intent: CapabilityIntent) {
  const coarse = coarseForIntent(intent)
  return provider.cap_sort?.[intent as never] ?? provider.cap_sort?.[coarse] ?? provider.sort ?? 999999
}

function modelSort(model: Provider['models'][number], intent: CapabilityIntent) {
  const coarse = coarseForIntent(intent)
  return model.cap_sort?.[intent as never] ?? model.cap_sort?.[coarse] ?? 999999
}

function capsFromModelEntry(model: Provider['models'][number]) {
  return (model.caps || []).flatMap((cap) => COARSE_TO_INTENTS[cap] || [cap])
}

function capabilityFamily(capability: string) {
  if (capability.startsWith('llm.')) return 'llm'
  if (capability.startsWith('image.')) return 'image'
  if (capability.startsWith('video.')) return 'video'
  if (capability.startsWith('audio.')) return 'audio'
  return capability.split('.')[0]
}

function requestRequirements(request: RouteRequest) {
  const mapped = taskIntentRequirement(request.taskIntent, request.intent)
  const requiresAll = unique([...(mapped.requiresAll || []), ...(request.requiresAll || [])])
  const requiresAny = unique([...(mapped.requiresAny || []), ...(request.requiresAny || [])])
  if (!requiresAll.length && !requiresAny.length && request.intent) requiresAll.push(request.intent)
  return { requiresAll, requiresAny, taskIntent: request.taskIntent || mapped.taskIntent, intent: request.intent || requiresAll[0] || requiresAny[0] || 'llm.chat' }
}

function preferredWeight(provider: Provider, model: Provider['models'][number], preferredModels: PreferredModel[]) {
  let best = 0
  for (const preferred of preferredModels) {
    if (preferred.providerId && preferred.providerId !== provider.id) continue
    if (preferred.model !== model.model) continue
    best = Math.max(best, preferred.weight ?? 100)
  }
  return best
}

function candidateFor(provider: Provider, model: Provider['models'][number], request: RouteRequest): Candidate {
  const protocolId = model.protocol || provider.protocol
  const manifest = resolveProtocolModelProfile(protocolId, model.model)
  const capabilities = unique([...manifest.capabilities, ...capsFromModelEntry(model)])
  const { requiresAll, requiresAny, intent } = requestRequirements(request)
  const requestedFamilies = new Set([...requiresAll, ...requiresAny, intent].map(capabilityFamily))
  const declaredFamilies = new Set(capsFromModelEntry(model).map(capabilityFamily))
  const authoritativeFamilies = new Set(Object.entries(manifest.capabilitySources)
    .filter(([, source]) => source === 'profile')
    .map(([capability]) => capabilityFamily(capability)))
  const declaredFamilyMatch = !declaredFamilies.size || [...declaredFamilies].some((family) => requestedFamilies.has(family))
  const authoritativeFamilyMatch = !authoritativeFamilies.size || [...authoritativeFamilies].some((family) => requestedFamilies.has(family))
  const anySatisfied = !requiresAny.length || requiresAny.some((capability) => capabilities.includes(capability))
  const required = unique([...requiresAll, ...(requiresAny.length && anySatisfied ? [] : requiresAny)])
  const satisfied = unique([...requiresAll, ...requiresAny].filter((capability) => capabilities.includes(capability)))
  const missing = required.filter((capability) => !capabilities.includes(capability))
  const preferredModels = [
    ...(request.preferredModel ? [{ model: request.preferredModel, weight: 100 }] : []),
    ...(request.preferredModels || []),
    ...(request.model ? [{ providerId: request.providerId, model: request.model, weight: 1000 }] : []),
  ]
  const preference = preferredWeight(provider, model, preferredModels)
  const matchScore = satisfied.length * 100
  const primaryIntent = intent || satisfied[0] || requiresAll[0] || requiresAny[0] || 'llm.chat'
  const score = preference + matchScore - (missing.length * 100000) - modelSort(model, primaryIntent) - capabilitySort(provider, primaryIntent) - (provider.sort || 0)
  const reasons = [
    `${provider.name}/${model.model} 支持 ${capabilities.join(', ') || '未声明能力'}`,
    satisfied.length ? `满足能力：${satisfied.join(', ')}` : '未匹配到目标能力',
  ]
  const warnings = missing.length ? [`缺少能力：${missing.join(', ')}`] : []
  return { provider, model, capabilities, satisfied, missing, score, reasons, warnings, familyMatch: declaredFamilyMatch && authoritativeFamilyMatch }
}

function candidateAllowedByRequest(candidate: Candidate, request: RouteRequest, fallbackPolicy: FallbackPolicy) {
  if (fallbackPolicy !== 'strict') return true
  if (request.providerId && candidate.provider.id !== request.providerId) return false
  if (request.model && candidate.model.model !== request.model) return false
  return true
}

function routeFromCandidate(candidate: Candidate, request: RouteRequest, allCandidates: Candidate[]): ResolvedModelRoute {
  const { intent } = requestRequirements(request)
  const operation = resolveOperation(candidate.model.protocol || candidate.provider.protocol, candidate.model.model, intent)
  const alternatives = allCandidates
    .filter((item) => item !== candidate && !item.missing.length)
    .slice(0, 5)
    .map((item) => ({ providerId: item.provider.id, providerName: item.provider.name, model: item.model.model, reason: item.reasons.join('；') }))
  return {
    providerId: candidate.provider.id,
    providerName: candidate.provider.name,
    provider: {
      base_url: candidate.provider.base_url,
      api_key: candidate.provider.api_key,
      protocol: candidate.model.protocol || candidate.provider.protocol,
    },
    model: candidate.model.model,
    intent,
    operationId: operation?.id || intent,
    operation: operation?.operation || {},
    defaults: resolveProtocolModelProfile(candidate.model.protocol || candidate.provider.protocol, candidate.model.model).defaults,
    satisfied: candidate.satisfied,
    missing: candidate.missing,
    reasons: candidate.reasons,
    warnings: candidate.warnings,
    alternatives,
  }
}

export function resolveModelFromProviders(providers: Provider[], request: RouteRequest): ResolvedModelRoute {
  const fallbackPolicy = request.fallbackPolicy || (request.providerId || request.model ? 'strict' : 'best_available')
  const candidates = providers
    .filter(providerUsable)
    .flatMap((provider) => provider.models.map((model) => candidateFor(provider, model, request)).filter((candidate) => candidate.familyMatch && candidateAllowedByRequest(candidate, request, fallbackPolicy)))
    .sort((a, b) => b.score - a.score)

  if (!candidates.length) throw new Error('没有可用的模型站点：请在「API 设置」中启用模型站点')
  const exact = candidates.find((candidate) => !candidate.missing.length)
  if (exact) return routeFromCandidate(exact, request, candidates)

  const alternatives = candidates
    .filter((candidate) => candidate.satisfied.length)
    .slice(0, 5)
    .map((candidate) => `${candidate.provider.name}/${candidate.model.model}：${candidate.warnings.join('；')}`)
  if (fallbackPolicy === 'strict') {
    const missing = candidates[0]?.missing.join(', ') || '未知能力'
    throw new Error(`指定模型不支持所需能力：${missing}${alternatives.length ? `。可选替代：${alternatives.join('；')}` : ''}`)
  }
  return routeFromCandidate(candidates[0], request, candidates)
}

export function resolveModel(request: RouteRequest): ResolvedModelRoute {
  return resolveModelFromProviders(allProviders(), request)
}
