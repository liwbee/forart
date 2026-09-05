export const VIDEO_TIMELINE_SCHEMA_VERSION = '1.0' as const

export type VideoAssetKind = 'video' | 'image' | 'audio' | 'subtitle'
export type VideoTrackKind = 'video' | 'voice' | 'music' | 'subtitle' | 'graphics'
export type VideoProjectStatus = 'draft' | 'review' | 'approved' | 'archived'

export interface VideoProject {
  id: string
  name: string
  status: VideoProjectStatus
  createdAt: number
  updatedAt: number
}

export interface VideoAsset {
  id: string
  projectId: string
  kind: VideoAssetKind
  name: string
  mime: string
  size: number
  durationMs?: number
  width?: number
  height?: number
  fps?: number
  hasVideo?: boolean
  hasAudio?: boolean
  formatName?: string
  bitRate?: number
  videoCodec?: string
  audioCodec?: string
  audioChannels?: number
  sampleRate?: number
  probeSource?: 'ffprobe' | 'browser'
  serverStored?: boolean
  createdAt: number
}

export interface ClipTransform {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
}

export interface TimelineClip {
  id: string
  trackId: string
  assetId?: string
  name: string
  timelineStartMs: number
  durationMs: number
  sourceInMs: number
  sourceOutMs: number
  transform: ClipTransform
  volume: number
  text?: string
}

export interface TimelineTrack {
  id: string
  type: VideoTrackKind
  name: string
  order: number
  locked: boolean
  muted: boolean
  hidden: boolean
  clips: TimelineClip[]
}

export interface VideoTimeline {
  schemaVersion: typeof VIDEO_TIMELINE_SCHEMA_VERSION
  projectId: string
  version: number
  timebase: 1000
  canvas: {
    width: number
    height: number
    fps: number
  }
  durationMs: number
  tracks: TimelineTrack[]
  outputProfileId: string
  updatedAt: number
}

export interface VideoWorkspaceState {
  project: VideoProject
  assets: VideoAsset[]
  timeline: VideoTimeline
}

export type TimelineIssueSeverity = 'error' | 'warning'

export interface TimelineIssue {
  severity: TimelineIssueSeverity
  code: string
  message: string
  trackId?: string
  clipId?: string
}

function finiteInteger(value: number) {
  return Number.isFinite(value) && Number.isInteger(value)
}

export function validateTimeline(timeline: VideoTimeline, assets: VideoAsset[]): TimelineIssue[] {
  const issues: TimelineIssue[] = []
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
  const assetIds = new Set(assetMap.keys())
  const trackIds = new Set<string>()
  const clipIds = new Set<string>()

  if (timeline.schemaVersion !== VIDEO_TIMELINE_SCHEMA_VERSION) {
    issues.push({ severity: 'error', code: 'schema.unsupported', message: `不支持的时间线协议：${timeline.schemaVersion}` })
  }
  if (timeline.timebase !== 1000) issues.push({ severity: 'error', code: 'timebase.invalid', message: 'Timeline V1 必须使用 1000 毫秒时基' })
  if (!finiteInteger(timeline.durationMs) || timeline.durationMs < 0) issues.push({ severity: 'error', code: 'duration.invalid', message: '时间线总时长必须是非负整数毫秒' })
  if (!finiteInteger(timeline.canvas.width) || !finiteInteger(timeline.canvas.height) || timeline.canvas.width <= 0 || timeline.canvas.height <= 0) {
    issues.push({ severity: 'error', code: 'canvas.invalid', message: '画布尺寸必须是正整数' })
  }
  if (!Number.isFinite(timeline.canvas.fps) || timeline.canvas.fps <= 0 || timeline.canvas.fps > 120) {
    issues.push({ severity: 'error', code: 'fps.invalid', message: '帧率必须在 0–120 之间' })
  }

  for (const track of timeline.tracks) {
    if (trackIds.has(track.id)) issues.push({ severity: 'error', code: 'track.duplicate_id', message: `轨道 ID 重复：${track.id}`, trackId: track.id })
    trackIds.add(track.id)
    const sorted = [...track.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs)
    for (let index = 0; index < sorted.length; index += 1) {
      const clip = sorted[index]
      if (clipIds.has(clip.id)) issues.push({ severity: 'error', code: 'clip.duplicate_id', message: `片段 ID 重复：${clip.id}`, trackId: track.id, clipId: clip.id })
      clipIds.add(clip.id)
      if (clip.trackId !== track.id) issues.push({ severity: 'error', code: 'clip.track_mismatch', message: '片段引用的轨道与所在轨道不一致', trackId: track.id, clipId: clip.id })
      if (!finiteInteger(clip.timelineStartMs) || clip.timelineStartMs < 0 || !finiteInteger(clip.durationMs) || clip.durationMs <= 0) {
        issues.push({ severity: 'error', code: 'clip.time.invalid', message: '片段起点和时长必须是有效整数毫秒', trackId: track.id, clipId: clip.id })
      }
      if (!finiteInteger(clip.sourceInMs) || !finiteInteger(clip.sourceOutMs) || clip.sourceInMs < 0 || clip.sourceOutMs <= clip.sourceInMs) {
        issues.push({ severity: 'error', code: 'clip.source.invalid', message: '片段源素材入点/出点无效', trackId: track.id, clipId: clip.id })
      }
      if (clip.assetId && !assetIds.has(clip.assetId)) issues.push({ severity: 'error', code: 'clip.asset.missing', message: `找不到片段素材：${clip.name}`, trackId: track.id, clipId: clip.id })
      const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined
      if (asset?.durationMs && clip.sourceOutMs > asset.durationMs + 50) issues.push({ severity: 'error', code: 'clip.source.out_of_bounds', message: `片段源出点超出素材：${clip.name}`, trackId: track.id, clipId: clip.id })
      if (clip.timelineStartMs + clip.durationMs > timeline.durationMs) issues.push({ severity: 'error', code: 'clip.out_of_bounds', message: `片段超出时间线：${clip.name}`, trackId: track.id, clipId: clip.id })
      const previous = sorted[index - 1]
      if (previous && previous.timelineStartMs + previous.durationMs > clip.timelineStartMs && track.type !== 'graphics') {
        issues.push({ severity: 'warning', code: 'clip.overlap', message: `${track.name}存在重叠片段`, trackId: track.id, clipId: clip.id })
      }
    }
  }
  return issues
}

export function formatTimecode(milliseconds: number) {
  const value = Math.max(0, Math.round(milliseconds))
  const totalSeconds = Math.floor(value / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const ms = value % 1000
  const parts = [minutes, seconds].map((part) => String(part).padStart(2, '0'))
  if (hours) parts.unshift(String(hours).padStart(2, '0'))
  return `${parts.join(':')}.${String(ms).padStart(3, '0')}`
}
