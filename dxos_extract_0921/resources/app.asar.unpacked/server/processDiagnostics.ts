import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

type MetricValue = string | number | boolean | null | undefined
type Metrics = Record<string, MetricValue>

export interface ProcessDiagnosticsOptions {
  directory?: string
  intervalMs?: number
  maxLogBytes?: number
  getMetrics?: () => Metrics
}

/**
 * Windows 安装器可能直接结束 Electron。子 API/Worker 如果继续存活，会占用
 * 端口和 SQLite；因此封装运行时主动监视桌面父进程，父进程消失后自行退出。
 */
export function startDesktopParentMonitor(role: string, onOrphan: () => void) {
  const parentPid = Number(process.env.DX_DESKTOP_PID)
  if (!Number.isSafeInteger(parentPid) || parentPid < 1) return { stop() {} }
  let stopped = false
  const check = () => {
    if (stopped) return
    try { process.kill(parentPid, 0) }
    catch {
      stopped = true
      clearInterval(timer)
      console.warn(`[DX OS ${role}] desktop parent ${parentPid} exited; stopping orphan process`)
      onOrphan()
    }
  }
  const timer = setInterval(check, 1_000)
  timer.unref()
  return {
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
  }
}

function diagnosticsDirectory() {
  if (process.env.DX_DIAGNOSTICS_DIR) return resolve(process.env.DX_DIAGNOSTICS_DIR)
  const dataRoot = process.env.DX_DATA_DIR || process.env.CCS_DATA_DIR
  if (dataRoot) return resolve(dataRoot, 'diagnostics')
  const platformRoot = process.env.LOCALAPPDATA || process.env.APPDATA || homedir()
  return resolve(platformRoot, 'DXOS', 'data', 'diagnostics')
}

function rotate(path: string, maxLogBytes: number) {
  if (!existsSync(path) || statSync(path).size < maxLogBytes) return
  const previous = `${path}.1`
  if (existsSync(previous)) unlinkSync(previous)
  renameSync(path, previous)
}

export function processMemorySnapshot(role: string, event = 'sample', metrics: Metrics = {}) {
  const memory = process.memoryUsage()
  return {
    ts: new Date().toISOString(),
    event,
    role,
    pid: process.pid,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    ...metrics,
  }
}

export function startProcessDiagnostics(role: string, options: ProcessDiagnosticsOptions = {}) {
  const safeRole = role.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'node'
  const directory = resolve(options.directory || diagnosticsDirectory())
  const path = join(directory, `memory-${safeRole}.jsonl`)
  const intervalMs = Math.max(10_000, options.intervalMs || Number(process.env.DX_MEMORY_LOG_INTERVAL_MS) || 5 * 60_000)
  const maxLogBytes = Math.max(256 * 1024, options.maxLogBytes || 2 * 1024 * 1024)
  let stopped = false
  let warned = false

  const sample = (event = 'sample') => {
    if (stopped) return
    try {
      mkdirSync(directory, { recursive: true })
      rotate(path, maxLogBytes)
      const metrics = options.getMetrics?.() || {}
      appendFileSync(path, `${JSON.stringify(processMemorySnapshot(safeRole, event, metrics))}\n`, 'utf8')
    } catch (error) {
      if (!warned) {
        warned = true
        console.warn(`[DX OS ${safeRole}] memory diagnostics unavailable:`, String((error as Error).message || error))
      }
    }
  }

  console.log(`[DX OS ${safeRole}] pid=${process.pid} node=${process.version} memory-log=${path}`)
  sample('start')
  const timer = setInterval(sample, intervalMs)
  timer.unref()

  return {
    path,
    sample,
    stop() {
      if (stopped) return
      sample('stop')
      stopped = true
      clearInterval(timer)
    },
  }
}
