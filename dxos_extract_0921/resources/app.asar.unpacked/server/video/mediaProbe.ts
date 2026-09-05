import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

export interface MediaProbeResult {
  durationMs: number
  sizeBytes: number
  formatName: string
  bitRate?: number
  hasVideo: boolean
  hasAudio: boolean
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  audioChannels?: number
  sampleRate?: number
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  channels?: number
  sample_rate?: string
  duration?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string; size?: string; format_name?: string; bit_rate?: string }
}

const PROBE_DIR = join(tmpdir(), 'dx-os-video-probe')
const MAX_STDOUT = 4 * 1024 * 1024

function finiteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function rational(value?: string) {
  if (!value) return undefined
  const [numerator, denominator] = value.split('/').map(Number)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined
  const result = numerator / denominator
  return Number.isFinite(result) && result > 0 ? Math.round(result * 1000) / 1000 : undefined
}

export function parseFfprobeOutput(raw: string): MediaProbeResult {
  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(raw) as FfprobeOutput
  } catch {
    throw new Error('ffprobe 返回了无法解析的结果')
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const video = streams.find((stream) => stream.codec_type === 'video')
  const audio = streams.find((stream) => stream.codec_type === 'audio')
  const formatDuration = finiteNumber(parsed.format?.duration)
  const streamDuration = Math.max(0, ...streams.map((stream) => finiteNumber(stream.duration) || 0))
  const duration = formatDuration ?? streamDuration
  return {
    durationMs: Math.max(0, Math.round(duration * 1000)),
    sizeBytes: Math.max(0, Math.round(finiteNumber(parsed.format?.size) || 0)),
    formatName: String(parsed.format?.format_name || ''),
    bitRate: finiteNumber(parsed.format?.bit_rate),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video?.width,
    height: video?.height,
    fps: rational(video?.avg_frame_rate) || rational(video?.r_frame_rate),
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    audioChannels: audio?.channels,
    sampleRate: finiteNumber(audio?.sample_rate),
  }
}

export function runFfprobe(filePath: string, timeoutMs = 20_000): Promise<MediaProbeResult> {
  const executable = String(process.env.FFPROBE_PATH || 'ffprobe').trim()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath,
    ], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error, result?: MediaProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result as MediaProbeResult)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`媒体探测超时（${timeoutMs}ms）`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > MAX_STDOUT) {
        child.kill()
        finish(new Error('ffprobe 输出异常过大'))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', (error) => finish(new Error(`无法启动 ffprobe：${error.message}`)))
    child.once('close', (code) => {
      if (settled) return
      if (code !== 0) return finish(new Error(`媒体探测失败：${stderr.trim() || `ffprobe exit ${code}`}`))
      try { finish(undefined, parseFfprobeOutput(stdout)) } catch (error) { finish(error as Error) }
    })
  })
}

export async function probeMediaBuffer(buffer: Buffer, originalName: string, mimeType: string) {
  await mkdir(PROBE_DIR, { recursive: true })
  const sourceExtension = extname(originalName).toLowerCase()
  const extension = /^\.[a-z0-9]{1,8}$/.test(sourceExtension)
    ? sourceExtension
    : mimeType.startsWith('video/') ? '.mp4' : mimeType.startsWith('audio/') ? '.wav' : '.bin'
  const filePath = join(PROBE_DIR, `${randomUUID()}${extension}`)
  await writeFile(filePath, buffer, { flag: 'wx' })
  try {
    return await runFfprobe(filePath)
  } finally {
    await unlink(filePath).catch(() => undefined)
  }
}

export async function probeUploadedAsset(buffer: Buffer, originalName: string, mimeType: string): Promise<MediaProbeResult> {
  if (mimeType.startsWith('image/')) {
    const metadata = await sharp(buffer, { failOn: 'error' }).metadata()
    return {
      durationMs: 5_000, sizeBytes: buffer.length, formatName: metadata.format || mimeType,
      hasVideo: true, hasAudio: false, width: metadata.width, height: metadata.height,
    }
  }
  if (/\.(srt|vtt)$/i.test(originalName)) {
    const preview = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8')
    if (!preview.trim()) throw new Error('字幕文件为空')
    return { durationMs: 0, sizeBytes: buffer.length, formatName: extname(originalName).slice(1), hasVideo: false, hasAudio: false }
  }
  return probeMediaBuffer(buffer, originalName, mimeType)
}
