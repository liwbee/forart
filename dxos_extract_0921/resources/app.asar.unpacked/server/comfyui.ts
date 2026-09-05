import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { createServer, Socket } from 'node:net'
import { installComfyBridgeForMainPath } from './comfyBridge.ts'

const DATA_DIR = DATA_ROOT
const CONFIG_PATH = dataPath('comfyui.json')
const PORTABLE_FOLDER = 'ComfyUI_windows_portable'

/** Accept paths copied from documentation, terminals, or rich-text messages. */
export function normalizeComfyPath(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
}

function defaultRoot() {
  const configured = normalizeComfyPath(process.env.COMFYUI_ROOT)
  if (configured) return configured
  if (process.platform === 'win32') {
    for (const code of Array.from({ length: 26 }, (_, index) => 67 + index)) {
      const candidate = `${String.fromCharCode(code)}:\\${PORTABLE_FOLDER}`
      if (existsSync(join(candidate, 'python_embeded', 'python.exe')) && existsSync(join(candidate, 'ComfyUI', 'main.py'))) {
        return candidate
      }
    }
  }
  return `E:\\${PORTABLE_FOLDER}`
}

export interface ComfyInstanceConfig {
  id: string
  name: string
  gpu: number
  port: number
  enabled: boolean
  outputDir?: string
  extraArgs?: string
}
export interface ComfyConfig {
  rootDir: string
  pythonPath: string
  mainPath: string
  listen: string
  outputDir: string
  extraArgs: string
  instances: ComfyInstanceConfig[]
}

type InstanceState = 'missing' | 'stopped' | 'starting' | 'running' | 'error'
interface RuntimeState {
  proc: ChildProcessWithoutNullStreams | null
  startedAt: number
  lastError: string
  stdout: string
  stderr: string
}

const runtimes = new Map<string, RuntimeState>()
const stoppingPids = new Set<number>()

function defaultConfig(): ComfyConfig {
  const rootDir = defaultRoot()
  return {
    rootDir,
    pythonPath: join(rootDir, 'python_embeded', 'python.exe'),
    mainPath: join(rootDir, 'ComfyUI', 'main.py'),
    listen: '0.0.0.0',
    outputDir: 'D:\\SD\\output',
    extraArgs: '--windows-standalone-build --multi-user --disable-auto-launch',
    instances: [
      { id: 'gpu-0', name: 'GPU 0', gpu: 0, port: 8288, enabled: true },
      { id: 'gpu-1', name: 'GPU 1', gpu: 1, port: 8289, enabled: true },
    ],
  }
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function parseArgs(text?: string): string[] {
  return (String(text || '').match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((arg) => arg.replace(/^"|"$/g, ''))
}

function normalizeInstance(input: Partial<ComfyInstanceConfig>, index: number): ComfyInstanceConfig {
  const gpu = Number.isFinite(Number(input.gpu)) ? Math.max(0, Math.floor(Number(input.gpu))) : index
  const port = Number.isFinite(Number(input.port)) ? Math.max(1, Math.floor(Number(input.port))) : 8288 + index
  const id = String(input.id || `gpu-${gpu}`).trim().replace(/[^a-zA-Z0-9_-]/g, '-') || `gpu-${index}`
  return {
    id,
    name: String(input.name || `GPU ${gpu}`).trim() || `GPU ${gpu}`,
    gpu,
    port,
    enabled: input.enabled !== false,
    outputDir: normalizeComfyPath(input.outputDir) || undefined,
    extraArgs: String(input.extraArgs || '').trim() || undefined,
  }
}

function portablePathNeedsRebase(path: string, rootDir: string, suffix: string[]) {
  if (!path || process.platform !== 'win32') return false
  const normalizedPath = win32.normalize(path).toLowerCase()
  const normalizedRoot = win32.normalize(rootDir).toLowerCase()
  const expectedSuffix = win32.join(PORTABLE_FOLDER, ...suffix).toLowerCase()
  return normalizedPath.endsWith(expectedSuffix) && !normalizedPath.startsWith(`${normalizedRoot}\\`)
}

export function normalizeComfyConfig(input: Partial<ComfyConfig>): ComfyConfig {
  const base = defaultConfig()
  const rootDir = normalizeComfyPath(input.rootDir) || base.rootDir
  let pythonPath = normalizeComfyPath(input.pythonPath) || join(rootDir, 'python_embeded', 'python.exe')
  let mainPath = normalizeComfyPath(input.mainPath) || join(rootDir, 'ComfyUI', 'main.py')
  if (portablePathNeedsRebase(pythonPath, rootDir, ['python_embeded', 'python.exe'])) {
    pythonPath = join(rootDir, 'python_embeded', 'python.exe')
  }
  if (portablePathNeedsRebase(mainPath, rootDir, ['ComfyUI', 'main.py'])) {
    mainPath = join(rootDir, 'ComfyUI', 'main.py')
  }
  const config: ComfyConfig = {
    rootDir,
    pythonPath,
    mainPath,
    listen: String(input.listen || base.listen).trim() || '0.0.0.0',
    outputDir: normalizeComfyPath(input.outputDir) || base.outputDir,
    extraArgs: String(input.extraArgs || base.extraArgs).trim(),
    instances: Array.isArray(input.instances) ? input.instances.map(normalizeInstance) : base.instances,
  }
  const seenIds = new Set<string>()
  const seenPorts = new Set<number>()
  config.instances = config.instances.map((inst, index) => {
    let id = inst.id
    while (seenIds.has(id)) id = `${inst.id}-${index}`
    seenIds.add(id)
    if (seenPorts.has(inst.port)) inst.port = 8288 + index
    while (seenPorts.has(inst.port)) inst.port += 1
    seenPorts.add(inst.port)
    return { ...inst, id }
  })
  return config
}

export function loadComfyConfig(): ComfyConfig {
  ensureDataDir()
  if (!existsSync(CONFIG_PATH)) {
    const config = defaultConfig()
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    return config
  }
  try {
    return normalizeComfyConfig(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')))
  } catch {
    return defaultConfig()
  }
}

export function saveComfyConfig(input: Partial<ComfyConfig>): ComfyConfig {
  ensureDataDir()
  const config = normalizeComfyConfig(input)
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  if (existsSync(config.mainPath)) installComfyBridgeForMainPath(config.mainPath)
  return config
}

export function repairComfyBridge() {
  const config = loadComfyConfig()
  if (!existsSync(config.mainPath)) throw new Error(`找不到 ComfyUI main.py：${config.mainPath}`)
  return installComfyBridgeForMainPath(config.mainPath)
}

function tail(text: string, chunk: Buffer) {
  return (text + chunk.toString('utf8')).slice(-6000)
}

function processExitError(runtime: RuntimeState, code: number | null, signal: NodeJS.Signals | null) {
  const detail = runtime.stderr
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  const suffix = signal ? `，信号 ${signal}` : ''
  return `实例已退出，退出码 ${code ?? '未知'}${suffix}${detail ? `：${detail.slice(0, 500)}` : ''}`
}

function runtimeFor(id: string) {
  let runtime = runtimes.get(id)
  if (!runtime) {
    runtime = { proc: null, startedAt: 0, lastError: '', stdout: '', stderr: '' }
    runtimes.set(id, runtime)
  }
  return runtime
}

function isPortOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket()
    socket.setTimeout(600)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
    socket.connect(port, '127.0.0.1')
  })
}

function assertPortBindable(port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', (cause: NodeJS.ErrnoException) => {
      if (cause.code === 'EACCES') {
        reject(new Error(`端口 ${port} 无法监听：该端口可能被 Windows 保留或被系统权限策略阻止`))
        return
      }
      if (cause.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${port} 已被其他程序占用`))
        return
      }
      reject(cause)
    })
    server.listen({ port, host, exclusive: true }, () => {
      server.close((cause) => cause ? reject(cause) : resolve())
    })
  })
}

function portOwnerPid(port: number) {
  if (process.platform !== 'win32') return null
  const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], {
    windowsHide: true,
    encoding: 'utf8',
  })
  if (result.error) return null
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields[0]?.toUpperCase() !== 'TCP' || fields.length < 4) continue
    const localPort = Number(fields[1]?.match(/:(\d+)$/)?.[1])
    const remotePort = Number(fields[2]?.match(/:(\d+)$/)?.[1])
    const pid = Number(fields.at(-1))
    if (localPort === port && remotePort === 0 && Number.isInteger(pid) && pid > 0) return pid
  }
  return null
}

async function isComfyUiPort(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/system_stats`, {
      signal: AbortSignal.timeout(1800),
    })
    if (!response.ok) return false
    const body = await response.json() as Record<string, unknown>
    return !!body && typeof body === 'object' && ('system' in body || 'devices' in body)
  } catch {
    return false
  }
}

async function waitForPortClosed(port: number, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return !(await isPortOpen(port))
}

function killTree(pid: number) {
  const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
    windowsHide: true,
    encoding: 'utf8',
  })
  return {
    ok: !result.error && result.status === 0,
    error: String(result.error?.message || result.stderr || result.stdout || '').trim(),
  }
}

async function instanceState(config: ComfyConfig, inst: ComfyInstanceConfig): Promise<InstanceState> {
  if (!existsSync(config.pythonPath) || !existsSync(config.mainPath)) return 'missing'
  if (await isPortOpen(inst.port)) return 'running'
  const runtime = runtimes.get(inst.id)
  if (runtime?.proc && runtime.proc.exitCode === null && !runtime.proc.killed) {
    return 'starting'
  }
  return runtime?.lastError ? 'error' : 'stopped'
}

function instanceUrl(config: ComfyConfig, inst: ComfyInstanceConfig) {
  const host = config.listen === '0.0.0.0' ? '127.0.0.1' : config.listen
  return `http://${host}:${inst.port}`
}

export async function comfyStatus() {
  const config = loadComfyConfig()
  const instances = await Promise.all(config.instances.map(async (inst) => {
    const runtime = runtimeFor(inst.id)
    const status = await instanceState(config, inst)
    return {
      ...inst,
      status,
      url: instanceUrl(config, inst),
      pid: runtime.proc?.pid || null,
      startedAt: runtime.startedAt || null,
      managed: !!runtime.proc,
      error: status === 'error' ? runtime.lastError || runtime.stderr || 'ComfyUI 启动失败' : '',
      stdout: runtime.stdout,
      stderr: runtime.stderr,
    }
  }))
  return { config, instances }
}

function buildArgs(config: ComfyConfig, inst: ComfyInstanceConfig) {
  const args = [
    config.mainPath,
    ...parseArgs(config.extraArgs),
    '--listen', config.listen,
    '--cuda-device', String(inst.gpu),
    '--port', String(inst.port),
  ]
  const outputDir = inst.outputDir || config.outputDir
  if (outputDir) args.push('--output-directory', outputDir)
  args.push(...parseArgs(inst.extraArgs))
  return args
}

export async function startComfyInstance(id: string) {
  const config = loadComfyConfig()
  const inst = config.instances.find((item) => item.id === id)
  if (!inst) throw new Error('实例不存在')
  if (!existsSync(config.pythonPath)) throw new Error(`找不到 Python：${config.pythonPath}`)
  if (!existsSync(config.mainPath)) throw new Error(`找不到 ComfyUI main.py：${config.mainPath}`)
  installComfyBridgeForMainPath(config.mainPath)
  if (await isPortOpen(inst.port)) {
    if (await isComfyUiPort(inst.port)) return comfyStatus()
    throw new Error(`端口 ${inst.port} 已被其他程序占用`)
  }
  await assertPortBindable(inst.port, config.listen)

  const runtime = runtimeFor(inst.id)
  if (runtime.proc && runtime.proc.exitCode === null && !runtime.proc.killed) return comfyStatus()
  runtime.startedAt = Date.now()
  runtime.lastError = ''
  runtime.stdout = ''
  runtime.stderr = ''
  const proc = spawn(config.pythonPath, buildArgs(config, inst), {
    cwd: config.rootDir,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  })
  runtime.proc = proc
  proc.stdout.on('data', (chunk) => { runtime.stdout = tail(runtime.stdout, Buffer.from(chunk)) })
  proc.stderr.on('data', (chunk) => { runtime.stderr = tail(runtime.stderr, Buffer.from(chunk)) })
  proc.on('error', (err) => {
    const wasStopping = !!proc.pid && stoppingPids.delete(proc.pid)
    if (!wasStopping) runtime.lastError = err.message
    if (runtime.proc === proc) runtime.proc = null
  })
  proc.on('exit', (code, signal) => {
    const wasStopping = !!proc.pid && stoppingPids.delete(proc.pid)
    if (!wasStopping && code && code !== 0) {
      runtime.lastError = processExitError(runtime, code, signal)
    }
    if (runtime.proc === proc) runtime.proc = null
  })
  return comfyStatus()
}

export async function stopComfyInstance(id: string) {
  const config = loadComfyConfig()
  const inst = config.instances.find((item) => item.id === id)
  if (!inst) throw new Error('实例不存在')
  const runtime = runtimeFor(id)
  const managedPid = runtime.proc?.pid || null
  const portWasOpen = await isPortOpen(inst.port)

  if (portWasOpen && !managedPid && !(await isComfyUiPort(inst.port))) {
    throw new Error(`端口 ${inst.port} 正被其他程序占用，未执行停止`)
  }

  const pids = new Set<number>()
  if (managedPid) pids.add(managedPid)
  const ownerPid = portWasOpen ? portOwnerPid(inst.port) : null
  if (ownerPid) pids.add(ownerPid)
  let killError = ''
  for (const pid of pids) {
    if (pid === managedPid) stoppingPids.add(pid)
    const result = killTree(pid)
    if (!result.ok) killError = result.error || `无法结束 PID ${pid}`
  }

  if (runtime.proc && !runtime.proc.killed) {
    try { runtime.proc.kill() } catch { /* taskkill may have already ended it */ }
  }
  if (portWasOpen && !(await waitForPortClosed(inst.port))) {
    throw new Error(`停止失败：端口 ${inst.port} 仍在监听${killError ? `（${killError}）` : ''}`)
  }
  if (!portWasOpen && managedPid && killError) {
    stoppingPids.delete(managedPid)
    throw new Error(`停止失败：${killError}`)
  }
  runtime.proc = null
  runtime.lastError = ''
  return comfyStatus()
}

export async function restartComfyInstance(id: string) {
  await stopComfyInstance(id)
  return startComfyInstance(id)
}

export interface ComfyUploadResult {
  name: string
  subfolder?: string
  type?: string
}

export async function uploadComfyFiles(id: string, files: Array<{ buffer: Buffer; name: string; mime?: string }>) {
  const config = loadComfyConfig()
  const inst = config.instances.find((item) => item.id === id)
  if (!inst) throw new Error('实例不存在')
  if (!(await isPortOpen(inst.port))) throw new Error('ComfyUI 实例尚未运行')
  const uploaded: ComfyUploadResult[] = []
  for (const file of files) {
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(file.buffer)], { type: file.mime || 'application/octet-stream' }), file.name)
    const response = await fetch(`http://127.0.0.1:${inst.port}/upload/image`, { method: 'POST', body: form })
    if (!response.ok) throw new Error(`ComfyUI 上传失败：HTTP ${response.status}`)
    const result = await response.json().catch(() => ({ name: file.name })) as Partial<ComfyUploadResult>
    uploaded.push({
      name: String(result.name || file.name),
      ...(result.subfolder ? { subfolder: String(result.subfolder) } : {}),
      ...(result.type ? { type: String(result.type) } : {}),
    })
  }
  return { uploaded }
}

export async function startEnabledComfyInstances() {
  const config = loadComfyConfig()
  const errors: string[] = []
  for (const inst of config.instances.filter((item) => item.enabled)) {
    try { await startComfyInstance(inst.id) }
    catch (e) { errors.push(`${inst.name}: ${String((e as Error).message || e)}`) }
  }
  return { ...(await comfyStatus()), errors }
}

export async function stopAllComfyInstances() {
  const config = loadComfyConfig()
  for (const instance of config.instances) await stopComfyInstance(instance.id)
  return comfyStatus()
}
