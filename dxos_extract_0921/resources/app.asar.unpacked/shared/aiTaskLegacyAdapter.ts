import type { StandardAiTask } from './aiTaskContract'

export type LegacyCanvasGenerationRequest = {
  canvasId: string
  mode: StandardAiTask['mode']
  outputKind: StandardAiTask['output']['kind']
  audioIntent?: 'audio.tts' | 'audio.music'
  prompt: string
  platform: StandardAiTask['provider']['platform']
  providerId: string | undefined
  model: string | undefined
  size: string | undefined
  quality: StandardAiTask['output']['quality'] | undefined
  n: number
  params: Record<string, unknown>
  inputNodeIds: string[]
  tableRow?: number
  publicInputs?: Record<string, { service?: string; url?: string; remoteName?: string }>
  inputTexts?: string[]
}

export function isStandardAiTask(value: unknown): value is StandardAiTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Partial<StandardAiTask>
  return task.format === 'dx-ai-task/v1'
    && typeof task.requestId === 'string' && task.requestId.length > 0
    && typeof task.source?.canvasId === 'string' && task.source.canvasId.length > 0
    && typeof task.intent === 'string'
    && typeof task.prompt === 'string'
    && !!task.provider && typeof task.provider === 'object'
    && !!task.output && typeof task.output === 'object'
    && Array.isArray(task.inputs)
    && !!task.params && typeof task.params === 'object' && !Array.isArray(task.params)
}

/** Temporary compatibility adapter. Remove after the legacy executor is retired. */
export function toLegacyCanvasGenerationRequest(task: StandardAiTask): LegacyCanvasGenerationRequest {
  const publicInputs = Object.fromEntries(task.inputs
    .filter((asset) => asset.transport)
    .map((asset) => [asset.nodeId, { ...asset.transport }]))
  return {
    canvasId: task.source.canvasId,
    mode: task.mode,
    outputKind: task.output.kind,
    ...(task.output.kind === 'audio' ? { audioIntent: task.intent === 'audio.music' ? 'audio.music' : 'audio.tts' } : {}),
    prompt: task.prompt,
    platform: task.provider.platform,
    providerId: task.provider.providerId,
    model: task.provider.model,
    size: task.output.size,
    quality: task.output.quality,
    n: task.output.count,
    params: { ...task.params },
    inputNodeIds: task.inputs.map((asset) => asset.nodeId),
    ...(task.source.tableRow == null ? {} : { tableRow: task.source.tableRow }),
    ...(Object.keys(publicInputs).length ? { publicInputs } : {}),
    ...(task.extensions?.comfyTextInputs ? { inputTexts: [...task.extensions.comfyTextInputs] } : {}),
  }
}

