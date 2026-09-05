import type { StandardAiTask } from '../../shared/aiTaskContract.ts'
import type { Provider } from '../store.ts'
import { compileProtocolPlan, type StandardProtocolAsset, type StandardProtocolTask } from '../protocol-engine/compiler.ts'
import { protocolExecutionEnabled } from '../protocol-engine/flags.ts'
import { getProtocolV2 } from '../protocol-engine/repository.ts'

export type CanvasDeclarativeFallbackReason =
  | 'non_api_provider'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'protocol_v2_missing'
  | 'unsupported_local_input'
  | 'execution_flag_disabled'

export type CanvasDeclarativeRoute =
  | { mode: 'legacy'; reason: CanvasDeclarativeFallbackReason }
  | {
      mode: 'declarative'
      providerProtocolId: string
      providerProtocolVersion: number
      modelProtocolId: string
      modelProtocolVersion: number
      profileId: string
      baseUrl: string
      credential?: string
      task: StandardProtocolTask
    }

function assetFromTask(input: StandardAiTask['inputs'][number]): StandardProtocolAsset | null {
  const url = String(input.transport?.url || '').trim()
  const remoteName = String(input.transport?.remoteName || '').trim()
  if (!/^https?:\/\//i.test(url) && !remoteName) return null
  return {
    kind: input.kind,
    ...(url ? { url } : {}),
    ...(remoteName ? { name: remoteName } : {}),
    ...(input.role ? { role: input.role } : {}),
  }
}

export function standardProtocolTaskFromCanvas(task: StandardAiTask): StandardProtocolTask | null {
  const assets = task.inputs.map(assetFromTask)
  if (assets.some((asset) => !asset)) return null
  const grouped: StandardProtocolTask['inputs'] = { images: [], videos: [], audios: [], files: [] }
  for (const asset of assets as StandardProtocolAsset[]) {
    if (asset.kind === 'image') grouped.images.push(asset)
    else if (asset.kind === 'video') grouped.videos.push(asset)
    else if (asset.kind === 'audio') grouped.audios.push(asset)
    else grouped.files.push(asset)
  }
  return {
    requestId: task.requestId,
    model: String(task.provider.model || ''),
    intent: task.intent,
    prompt: task.prompt,
    params: {
      ...(task.output.size ? { size: task.output.size } : {}),
      ...(task.output.quality ? { quality: task.output.quality } : {}),
      n: task.output.count,
      ...task.params,
    },
    inputs: grouped,
  }
}

function credentialFor(provider: Provider, credentialRef: 'api_key' | 'wallet_api_key' | undefined) {
  return credentialRef === 'wallet_api_key' ? provider.wallet_api_key : provider.api_key
}

/**
 * Makes the production canary decision without performing a network request.
 * A caller must invoke exactly one executor after this function returns.
 */
export function resolveCanvasDeclarativeRoute(task: StandardAiTask, provider: Provider | null): CanvasDeclarativeRoute {
  if (task.provider.platform !== 'api') return { mode: 'legacy', reason: 'non_api_provider' }
  if (!provider || !provider.enabled) return { mode: 'legacy', reason: 'provider_unavailable' }
  const model = String(task.provider.model || '').trim()
  const modelEntry = provider.models.find((entry) => entry.model === model)
  if (!modelEntry) return { mode: 'legacy', reason: 'model_unavailable' }

  const providerProtocol = getProtocolV2('provider', provider.protocol)
  const modelProtocol = getProtocolV2('model', modelEntry.protocol)
  if (!providerProtocol || !modelProtocol) return { mode: 'legacy', reason: 'protocol_v2_missing' }
  const protocolTask = standardProtocolTaskFromCanvas(task)
  if (!protocolTask) return { mode: 'legacy', reason: 'unsupported_local_input' }

  const plan = compileProtocolPlan({
    providerProtocol: providerProtocol.protocol,
    modelProtocol: modelProtocol.protocol,
    baseUrl: provider.base_url,
    task: protocolTask,
    redactSecrets: true,
  })
  const profileId = String(plan.protocol.profile || '')
  if (!profileId || !protocolExecutionEnabled({
    providerProtocolId: providerProtocol.protocol.id,
    modelProtocolId: modelProtocol.protocol.id,
    profileId,
    intent: protocolTask.intent,
  })) return { mode: 'legacy', reason: 'execution_flag_disabled' }

  const credential = credentialFor(provider, providerProtocol.protocol.kind === 'provider' ? providerProtocol.protocol.auth.credentialRef : undefined)
  if (providerProtocol.protocol.kind === 'provider' && providerProtocol.protocol.auth.type !== 'none' && !credential) {
    throw new Error(`声明式执行已启用，但站点「${provider.name}」缺少所需凭据。`)
  }
  return {
    mode: 'declarative',
    providerProtocolId: providerProtocol.protocol.id,
    providerProtocolVersion: providerProtocol.version,
    modelProtocolId: modelProtocol.protocol.id,
    modelProtocolVersion: modelProtocol.version,
    profileId,
    baseUrl: provider.base_url,
    ...(credential ? { credential } : {}),
    task: protocolTask,
  }
}
