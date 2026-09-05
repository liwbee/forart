import { spawn } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { buildFfmpegArgs } from './renderPlan.ts'
import { runFfprobe } from './mediaProbe.ts'
import {
  claimNextVideoRenderJob,
  completeVideoRenderJob,
  failVideoRenderJob,
  getVideoRenderJob,
  heartbeatVideoRenderJob,
  renderJobExecutionData,
  type VideoRenderJobRow,
} from './videoStore.ts'

function renderWithFfmpeg(job: VideoRenderJobRow, workerId: string, leaseMs: number) {
  const { plan, partialPath } = renderJobExecutionData(job, workerId)
  const args = buildFfmpegArgs(plan, partialPath)
  args.splice(3, 0, '-progress', 'pipe:1', '-nostats')
  const executable = String(process.env.FFMPEG_PATH || 'ffmpeg').trim()
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let progressBuffer = ''
    let stopped = false
    const stop = (error?: Error) => {
      if (stopped) return
      stopped = true
      clearInterval(heartbeat)
      if (error) reject(error)
      else resolve(partialPath)
    }
    const heartbeat = setInterval(() => {
      if (!heartbeatVideoRenderJob(job.id, workerId, leaseMs)) child.kill()
    }, Math.max(1000, Math.floor(leaseMs / 3)))
    child.stdout.on('data', (chunk: Buffer) => {
      progressBuffer += chunk.toString('utf8')
      const lines = progressBuffer.split(/\r?\n/)
      progressBuffer = lines.pop() || ''
      for (const line of lines) {
        const [key, rawValue] = line.split('=', 2)
        if (key !== 'out_time_us') continue
        const outputMs = Number(rawValue) / 1000
        if (Number.isFinite(outputMs) && plan.durationMs > 0) heartbeatVideoRenderJob(job.id, workerId, leaseMs, 2 + (outputMs / plan.durationMs) * 94)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-16_000)
    })
    child.once('error', (error) => stop(new Error(`无法启动 FFmpeg：${error.message}`)))
    child.once('close', (code) => {
      if (code === 0) stop()
      else stop(new Error(`FFmpeg 渲染失败：${stderr.trim() || `exit ${code}`}`))
    })
  })
}

export async function executeNextVideoRenderJob(workerId: string, leaseMs: number) {
  const job = claimNextVideoRenderJob(workerId, leaseMs)
  if (!job) return false
  let partialPath = ''
  try {
    partialPath = await renderWithFfmpeg(job, workerId, leaseMs)
    const current = getVideoRenderJob(job.id)
    if (current?.status !== 'running' || current.worker_id !== workerId) {
      if (existsSync(partialPath)) unlinkSync(partialPath)
      return true
    }
    const probe = await runFfprobe(partialPath)
    const { plan } = renderJobExecutionData(job)
    if (!probe.hasVideo) throw new Error('渲染结果缺少视频轨')
    if (probe.width !== plan.canvas.width || probe.height !== plan.canvas.height) throw new Error(`渲染尺寸错误：${probe.width}×${probe.height}`)
    if (Math.abs(probe.durationMs - plan.durationMs) > 750) throw new Error(`渲染时长错误：${probe.durationMs}ms`)
    completeVideoRenderJob(job.id, workerId, partialPath)
  } catch (error) {
    if (partialPath && existsSync(partialPath)) try { unlinkSync(partialPath) } catch { /* ignore */ }
    const current = getVideoRenderJob(job.id)
    if (current?.status === 'running' && current.worker_id === workerId) failVideoRenderJob(job.id, workerId, String((error as Error).message || error))
  }
  return true
}
