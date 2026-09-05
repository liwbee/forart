export type ProviderCapability = 'llm' | 'image' | 'video' | 'audio'
export type CoarseCapability = ProviderCapability | 'other'

export type CapabilityIntent =
  | 'llm.chat'
  | 'llm.chat.stream'
  | 'llm.chat.vision'
  | 'llm.tools'
  | 'llm.responses'
  | 'llm.responses.stream'
  | 'llm.structured_output'
  | 'rag.search'
  | 'rag.embeddings'
  | 'embeddings.create'
  | 'image.generate'
  | 'image.edit'
  | 'image.upscale'
  | 'image.describe'
  | 'video.generate'
  | 'video.text_to_video'
  | 'video.image_to_video'
  | 'video.first_last_frame'
  | 'video.multi_reference'
  | 'video.video_to_video'
  | 'video.audio_reference'
  | 'video.multimodal'
  | 'audio.tts'
  | 'audio.transcribe'
  | 'audio.translate'
  | 'audio.music'
  | 'moderation.create'
  | 'files.upload'
  | 'files.list'
  | 'files.retrieve'
  | 'files.delete'
  | 'batches.create'
  | 'batches.retrieve'
  | 'batches.cancel'
  | string

export type TaskIntent =
  | 'agent.project.write'
  | 'agent.code.review'
  | 'agent.analyze_image_and_write'
  | 'app.canvas.generate_image'
  | 'app.canvas.edit_image'
  | 'skill.video.compose'
  | string

export type FallbackPolicy = 'strict' | 'compatible' | 'best_available'
export type CapabilitySource = 'manual' | 'observed' | 'profile' | 'model_caps' | 'fallback'

export interface PreferredModel {
  providerId?: string
  model: string
  weight?: number
  reason?: string
}

export interface CapabilityRequirement {
  taskIntent?: TaskIntent
  intent?: CapabilityIntent
  requiresAll: CapabilityIntent[]
  requiresAny: CapabilityIntent[]
}

export interface ModelCapabilityManifest {
  providerId?: string
  providerName?: string
  protocolId: string
  model: string
  enabled?: boolean
  source?: 'api' | 'cli'
  coarseCaps: CoarseCapability[]
  capabilities: CapabilityIntent[]
  defaultOperations: Record<string, string>
  uiSchemas: string[]
  defaults: Record<string, unknown>
  limits: Record<string, unknown>
  capabilitySources: Partial<Record<CapabilityIntent, CapabilitySource>>
  priority: number
  profileId?: string
  profileLabel?: string
}

export interface ResolvedModelRoute {
  providerId: string
  providerName: string
  provider: {
    base_url: string
    api_key: string
    protocol: string
  }
  model: string
  intent: CapabilityIntent
  operationId: string
  operation: Record<string, unknown>
  uiSchemaId?: string
  uiSchema?: unknown[]
  defaults: Record<string, unknown>
  satisfied: CapabilityIntent[]
  missing: CapabilityIntent[]
  reasons: string[]
  warnings: string[]
  alternatives: Array<{ providerId: string; providerName: string; model: string; reason: string }>
}

export interface RouteRequest {
  taskIntent?: TaskIntent
  intent?: CapabilityIntent
  requiresAll?: CapabilityIntent[]
  requiresAny?: CapabilityIntent[]
  providerId?: string
  model?: string
  preferredModel?: string
  preferredModels?: PreferredModel[]
  fallbackPolicy?: FallbackPolicy
  actorId?: string
}
