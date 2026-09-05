export type AiTaskIntent =
  | 'image.generate'
  | 'image.edit'
  | 'video.text_to_video'
  | 'video.image_to_video'
  | 'video.first_last_frame'
  | 'video.multi_reference'
  | 'video.video_to_video'
  | 'video.audio_reference'
  | 'audio.tts'
  | 'audio.music'

export type AiTaskAssetKind = 'image' | 'video' | 'audio' | 'file'

export type AiTaskInputAsset = {
  nodeId: string
  kind: AiTaskAssetKind
  role?: string
  transport?: {
    service?: string
    url?: string
    remoteName?: string
  }
}

/**
 * Surface-independent generation request. It contains user intent and asset
 * references only; provider URLs, authentication, polling and downloads belong
 * to the server-side executor.
 */
export type StandardAiTask = {
  format: 'dx-ai-task/v1'
  requestId: string
  mode: 't2i' | 'i2i' | 't2v' | 'i2v' | 'v2v' | 'ia2v'
  source: {
    surface: 'canvas'
    canvasId: string
    nodeId?: string
    tableRow?: number
  }
  intent: AiTaskIntent
  provider: {
    platform: 'api' | 'comfy'
    providerId?: string
    model?: string
  }
  prompt: string
  params: Record<string, unknown>
  inputs: AiTaskInputAsset[]
  output: {
    kind: 'image' | 'video' | 'audio'
    count: number
    size?: string
    quality?: 'auto' | 'standard' | 'hd' | 'high'
  }
  extensions?: {
    comfyTextInputs?: string[]
  }
}
