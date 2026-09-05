import { isAbsolute } from 'node:path'
import { validateTimeline, type TimelineClip, type VideoAsset, type VideoTimeline, type VideoTrackKind } from '../../src/apps/video-editor/videoDomain.ts'

export interface RenderPlanInput {
  index: number
  clipId: string
  assetId: string
  path: string
  kind: VideoAsset['kind']
  trackType: VideoTrackKind
  timelineStartMs: number
  durationMs: number
  sourceInMs: number
  sourceOutMs: number
  volume: number
}

export interface RenderPlan {
  schemaVersion: '1.0'
  timelineVersion: number
  durationMs: number
  canvas: VideoTimeline['canvas']
  outputProfileId: string
  inputs: RenderPlanInput[]
}

function safeAbsolutePath(value: string) {
  if (!value || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('渲染素材必须使用有效的绝对路径')
  return value
}

export function compileRenderPlan(timeline: VideoTimeline, assets: VideoAsset[], resolveAssetPath: (asset: VideoAsset) => string): RenderPlan {
  const errors = validateTimeline(timeline, assets).filter((issue) => issue.severity === 'error')
  if (errors.length) throw new Error(`Timeline 校验失败：${errors.map((issue) => issue.code).join(', ')}`)
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
  const inputs: RenderPlanInput[] = []
  const supportedTracks = new Set<VideoTrackKind>(['video', 'voice', 'music', 'subtitle', 'graphics'])
  for (const track of [...timeline.tracks].sort((a, b) => a.order - b.order)) {
    if (!supportedTracks.has(track.type) || track.hidden || (track.muted && (track.type === 'voice' || track.type === 'music'))) continue
    for (const clip of [...track.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs)) {
      if (!clip.assetId) continue
      const asset = assetMap.get(clip.assetId)
      if (!asset) throw new Error(`缺少素材：${clip.assetId}`)
      if (!clipAllowedOnTrack(clip, track.type, asset.kind)) throw new Error(`素材 ${asset.name} 与轨道 ${track.name} 不兼容`)
      if ((track.type === 'voice' || track.type === 'music') && asset.hasAudio === false) throw new Error(`素材 ${asset.name} 不含音轨`)
      inputs.push({
        index: inputs.length,
        clipId: clip.id,
        assetId: asset.id,
        path: safeAbsolutePath(resolveAssetPath(asset)),
        kind: asset.kind,
        trackType: track.type,
        timelineStartMs: clip.timelineStartMs,
        durationMs: clip.durationMs,
        sourceInMs: clip.sourceInMs,
        sourceOutMs: clip.sourceOutMs,
        volume: clip.volume,
      })
    }
  }
  return {
    schemaVersion: '1.0', timelineVersion: timeline.version, durationMs: timeline.durationMs,
    canvas: structuredClone(timeline.canvas), outputProfileId: timeline.outputProfileId, inputs,
  }
}

function clipAllowedOnTrack(_clip: TimelineClip, track: VideoTrackKind, asset: VideoAsset['kind']) {
  if (track === 'video' || track === 'graphics') return asset === 'video' || asset === 'image'
  if (track === 'voice' || track === 'music') return asset === 'audio' || asset === 'video'
  return track === 'subtitle' && asset === 'subtitle'
}

function seconds(milliseconds: number) {
  return (milliseconds / 1000).toFixed(3)
}

function escapeSubtitlePath(path: string) {
  if (/[\0\r\n;\[\]]/.test(path)) throw new Error('字幕路径包含 FFmpeg 滤镜不允许的字符')
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,')
}

export function buildFfmpegArgs(plan: RenderPlan, outputPath: string) {
  safeAbsolutePath(outputPath)
  if (!/\.mp4$/i.test(outputPath)) throw new Error('Phase 0 仅允许输出 MP4')
  const args = ['-hide_banner', '-loglevel', 'warning']
  for (const input of plan.inputs) {
    if (input.kind === 'image') args.push('-loop', '1', '-t', seconds(input.durationMs))
    args.push('-i', input.path)
  }

  const filters: string[] = []
  const width = plan.canvas.width
  const height = plan.canvas.height
  filters.push(`color=c=black:s=${width}x${height}:r=${plan.canvas.fps}:d=${seconds(plan.durationMs)}[base]`)
  const visuals = plan.inputs.filter((input) => (input.trackType === 'video' || input.trackType === 'graphics') && (input.kind === 'video' || input.kind === 'image'))
  let videoLabel = 'base'
  visuals.forEach((input, index) => {
    const prepared = `vprep${index}`
    const overlaid = `vover${index}`
    const trim = input.kind === 'image' ? `trim=duration=${seconds(input.durationMs)}` : `trim=start=${seconds(input.sourceInMs)}:duration=${seconds(input.durationMs)}`
    filters.push(`[${input.index}:v:0]${trim},setpts=PTS-STARTPTS+${seconds(input.timelineStartMs)}/TB,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${plan.canvas.fps}[${prepared}]`)
    filters.push(`[${videoLabel}][${prepared}]overlay=eof_action=pass:shortest=0[${overlaid}]`)
    videoLabel = overlaid
  })

  const subtitles = plan.inputs.filter((input) => input.trackType === 'subtitle' && input.kind === 'subtitle')
  if (subtitles.length > 1) throw new Error('Phase 0 每条时间线只支持一个字幕文件')
  if (subtitles[0]) {
    if (subtitles[0].timelineStartMs !== 0) throw new Error('Phase 0 字幕片段必须从时间线 0ms 开始')
    filters.push(`[${videoLabel}]subtitles='${escapeSubtitlePath(subtitles[0].path)}'[vsub]`)
    videoLabel = 'vsub'
  }

  const audios = plan.inputs.filter((input) => (input.trackType === 'voice' || input.trackType === 'music') && (input.kind === 'audio' || input.kind === 'video'))
  const audioLabels: string[] = []
  audios.forEach((input, index) => {
    const label = `aprep${index}`
    filters.push(`[${input.index}:a:0]atrim=start=${seconds(input.sourceInMs)}:duration=${seconds(input.durationMs)},asetpts=PTS-STARTPTS,adelay=delays=${input.timelineStartMs}:all=1,volume=${input.volume.toFixed(3)}[${label}]`)
    audioLabels.push(`[${label}]`)
  })
  if (audioLabels.length) filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[aout]`)

  args.push('-filter_complex', filters.join(';'), '-map', `[${videoLabel}]`)
  if (audioLabels.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k')
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(plan.canvas.fps), '-t', seconds(plan.durationMs), '-movflags', '+faststart', '-y', outputPath)
  return args
}
