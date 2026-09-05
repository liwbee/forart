import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { randomUUID } from 'node:crypto'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = DATA_ROOT
const OUTPUT_DIR = dataPath('cli-output')
const TEMP_DIR = join(tmpdir(), 'DXOS', 'cli-temp')
const CLI_RUNTIME_DIR = join(ROOT, 'cli-runtime', 'jimeng')
const CLI_HOME_DIR = dataPath('cli-home', 'jimeng')
const MIN_JIMENG_VERSION = [1, 4, 2] as const
const JIMENG_TEST_TIMEOUT_MS = 10 * 60 * 1000
const JIMENG_PROCESS_TIMEOUT_MS = JIMENG_TEST_TIMEOUT_MS

type RunResult = { stdout: string; stderr: string }
type LoginSession = { proc: ChildProcessWithoutNullStreams | null; stdout: string; stderr: string; started_at: number }
export type JimengModelsResult = { ts: number; models: string[]; source: 'cli-help' | 'fallback'; cached: boolean; refreshing?: boolean }
type JimengRuntime = {
  command: string
  binPath: string
  argsPrefix: string[]
  usesWsl: boolean
  mode: 'bundled' | 'bundled-wsl' | 'configured' | 'path' | 'managed-wsl' | 'missing'
  label: string
  path: string
  detail?: string
  home: string
  launcher?: string
}
type JimengLoginMode = 'runtime' | 'isolated' | 'host'

const jimengLoginSession: LoginSession = { proc: null, stdout: '', stderr: '', started_at: 0 }
let jimengLoginProbe: Promise<unknown> | null = null
let jimengLoginProbeAt = 0
let jimengLoginCheck: Promise<unknown> | null = null
let jimengModelCache: Omit<JimengModelsResult, 'cached' | 'refreshing'> | null = null
let jimengModelRefresh: Promise<Omit<JimengModelsResult, 'cached' | 'refreshing'>> | null = null

function ensureDirs() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true })
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })
}

function ensureCliHome() {
  const dirs = [
    CLI_HOME_DIR,
    join(CLI_HOME_DIR, 'home'),
    join(CLI_HOME_DIR, 'config'),
    join(CLI_HOME_DIR, 'cache'),
    join(CLI_HOME_DIR, 'data'),
    CLI_RUNTIME_DIR,
  ]
  for (const dir of dirs) if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function envValue(key: string) {
  return String(process.env[key] || '').trim()
}

function useWsl() {
  return jimengRuntime().usesWsl
}

function findOnPath(command: string) {
  const pathext = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  const names = extname(command) ? [command] : pathext.map((ext) => command + ext.toLowerCase()).concat(pathext.map((ext) => command + ext.toUpperCase()))
  for (const dir of (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    for (const name of names) {
      const full = join(dir, name)
      if (existsSync(full)) return full
    }
  }
  return ''
}

function decode(buf: Buffer) {
  if (!buf.length) return ''
  const zeroBytes = [...buf].filter((value) => value === 0).length
  const encoding: BufferEncoding = zeroBytes >= Math.max(2, Math.floor(buf.length / 12)) ? 'utf16le' : 'utf8'
  return buf.toString(encoding).replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim()
}

function cleanWslStderr(text: string) {
  return String(text || '').split(/\r?\n/).map((line) => line.replace(/\u0000/g, '').trim()).filter((line) => {
    const low = line.toLowerCase()
    return line && !(low.includes('localhost') && low.includes('wsl') && (low.includes('nat') || low.includes('proxy') || line.includes('代理')))
  }).join('\n').trim()
}

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function wslBaseArgs(exe: string): string[] | null {
  const configured = envValue('JIMENG_WSL_DISTRO')
  let names: string[] = []
  try {
    const proc = spawnSync(exe, ['-l', '-q'], { windowsHide: true, timeout: 5000 })
    names = decode(proc.stdout || Buffer.alloc(0)).split(/\r?\n/).map((line) => line.trim().replace(/^\*/, '').trim()).filter(Boolean)
  } catch {
    names = []
  }
  if (!names.length) return null
  if (configured) return names.includes(configured) ? ['-d', configured] : null
  const ubuntu = names.find((name) => /^Ubuntu($|-)/i.test(name))
  return ubuntu ? ['-d', ubuntu] : ['-d', names[0]]
}

function bundledNativeJimeng() {
  const candidates = process.platform === 'win32'
    ? ['dreamina.exe', 'dreamina.cmd', 'dreamina.bat', 'dreamina']
    : ['dreamina']
  return candidates.map((name) => join(CLI_RUNTIME_DIR, 'bin', name)).find((file) => existsSync(file)) || ''
}

function bundledWslJimeng() {
  const path = join(CLI_RUNTIME_DIR, 'wsl', 'bin', 'dreamina')
  return existsSync(path) ? windowsPathToWsl(path) : ''
}

function windowsPathToWsl(path: string) {
  const m = String(path).replace(/\\/g, '/').match(/^([A-Za-z]):\/(.*)$/)
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2]}` : String(path).replace(/\\/g, '/')
}

function wslPathToWindows(path: string) {
  const m = String(path).match(/^\/mnt\/([a-zA-Z])\/(.*)$/)
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : path
}

function jimengExecutable() {
  return jimengRuntime().command
}

function jimengRuntimeSource() {
  const runtime = jimengRuntime()
  return {
    mode: runtime.mode,
    path: runtime.path,
    label: runtime.label,
    detail: runtime.detail,
    home: runtime.home,
    launcher: runtime.launcher,
    login_mode: jimengUsesHostLogin(runtime) ? 'host' : 'isolated',
  }
}

function jimengUsesHostLogin(runtime = jimengRuntime()) {
  return runtime.mode === 'path' || runtime.mode === 'managed-wsl'
}

function jimengRuntime(): JimengRuntime {
  ensureCliHome()
  const home = join(CLI_HOME_DIR, 'home')
  const bundled = bundledNativeJimeng()
  if (bundled) return { command: bundled, binPath: bundled, argsPrefix: [], usesWsl: false, mode: 'bundled', label: 'OS 内置 CLI', path: bundled, home }

  const configured = envValue('JIMENG_BIN') || envValue('DREAMINA_BIN')
  if (configured) return { command: configured, binPath: configured, argsPrefix: [], usesWsl: false, mode: 'configured', label: '配置路径（OS 独立登录）', path: configured, home }

  const native = findOnPath('dreamina') || findOnPath('dreamina.exe') || findOnPath('dreamina.cmd')
  const wslFlag = envValue('JIMENG_USE_WSL').toLowerCase()
  const forceWsl = ['1', 'true', 'yes', 'on', 'wsl'].includes(wslFlag)
  const disableWsl = wslFlag && ['0', 'false', 'no', 'off', 'native'].includes(wslFlag)
  if (native && !forceWsl) return { command: native, binPath: native, argsPrefix: [], usesWsl: false, mode: 'path', label: '本机 dreamina', path: native, home, detail: '使用本机 dreamina 登录态，无需 API Key。' }

  const wsl = process.platform === 'win32' && !disableWsl ? (findOnPath('wsl.exe') || 'wsl.exe') : ''
  const wslArgs = wsl ? wslBaseArgs(wsl) : null
  if (wsl && wslArgs) {
    const bundledWsl = bundledWslJimeng()
    const isBundled = !!bundledWsl
    return {
      command: wsl,
      binPath: bundledWsl,
      argsPrefix: wslArgs,
      usesWsl: true,
      mode: isBundled ? 'bundled-wsl' : 'managed-wsl',
      label: isBundled ? 'OS 内置 CLI' : '本机 WSL dreamina',
      path: isBundled ? join(CLI_RUNTIME_DIR, 'wsl', 'bin', 'dreamina') : CLI_RUNTIME_DIR,
      detail: isBundled ? '通过 OS 管理的 WSL 启动器运行，登录数据保存在 OS 独立目录。' : '使用本机 dreamina 登录态，无需 API Key。',
      home,
      launcher: wsl,
    }
  }
  return { command: '', binPath: '', argsPrefix: [], usesWsl: false, mode: 'missing', label: '未检测到', path: '', home }
}

export function jimengCliInstalled() {
  return !!jimengExecutable()
}

function jimengPathArg(path: string) {
  return useWsl() ? windowsPathToWsl(path) : path
}

function jimengCommand(args: string[], exe = jimengExecutable(), loginMode: JimengLoginMode = 'runtime') {
  const runtime = jimengRuntime()
  const useHostLogin = loginMode === 'host' || (loginMode === 'runtime' && jimengUsesHostLogin(runtime))
  if (runtime.usesWsl) {
    if (useHostLogin) {
      const dreaminaLookup = runtime.binPath
        ? `DREAMINA_BIN=${shellQuote(runtime.binPath)}`
        : 'DREAMINA_BIN=$(command -v dreamina || find "$HOME" -maxdepth 5 -type f -name dreamina 2>/dev/null | head -n 1)'
      const shellLine = [
        '. "$HOME/.profile" >/dev/null 2>&1 || true',
        '. "$HOME/.bashrc" >/dev/null 2>&1 || true',
        dreaminaLookup,
        'if [ -z "$DREAMINA_BIN" ]; then echo "dreamina CLI not found in WSL" >&2; exit 127; fi',
        '"$DREAMINA_BIN" ' + args.map(shellQuote).join(' '),
      ].join('; ')
      return { command: runtime.command || exe, args: [...runtime.argsPrefix, '-e', 'sh', '-lc', shellLine], env: {} as NodeJS.ProcessEnv }
    }
    const wslHome = windowsPathToWsl(join(CLI_HOME_DIR, 'home'))
    const wslConfig = windowsPathToWsl(join(CLI_HOME_DIR, 'config'))
    const wslCache = windowsPathToWsl(join(CLI_HOME_DIR, 'cache'))
    const wslData = windowsPathToWsl(join(CLI_HOME_DIR, 'data'))
    const dreaminaLookup = runtime.binPath
      ? `DREAMINA_BIN=${shellQuote(runtime.binPath)}`
      : 'DREAMINA_BIN=$(command -v dreamina || find "$ORIGINAL_HOME" -maxdepth 5 -type f -name dreamina 2>/dev/null | head -n 1)'
    const shellLine = [
      'ORIGINAL_HOME="$HOME"',
      '. "$ORIGINAL_HOME/.profile" >/dev/null 2>&1 || true',
      '. "$ORIGINAL_HOME/.bashrc" >/dev/null 2>&1 || true',
      `export HOME=${shellQuote(wslHome)}`,
      `export USERPROFILE=${shellQuote(wslHome)}`,
      `export XDG_CONFIG_HOME=${shellQuote(wslConfig)}`,
      `export XDG_CACHE_HOME=${shellQuote(wslCache)}`,
      `export XDG_DATA_HOME=${shellQuote(wslData)}`,
      'mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"',
      dreaminaLookup,
      'if [ -z "$DREAMINA_BIN" ]; then echo "dreamina CLI not found in WSL" >&2; exit 127; fi',
      '"$DREAMINA_BIN" ' + args.map(shellQuote).join(' '),
    ].join('; ')
    return { command: runtime.command || exe, args: [...runtime.argsPrefix, '-e', 'sh', '-lc', shellLine], env: {} as NodeJS.ProcessEnv }
  }
  const nativeEnv: NodeJS.ProcessEnv = {
    HOME: join(CLI_HOME_DIR, 'home'),
    USERPROFILE: join(CLI_HOME_DIR, 'home'),
    APPDATA: join(CLI_HOME_DIR, 'config'),
    LOCALAPPDATA: join(CLI_HOME_DIR, 'data'),
    XDG_CONFIG_HOME: join(CLI_HOME_DIR, 'config'),
    XDG_CACHE_HOME: join(CLI_HOME_DIR, 'cache'),
    XDG_DATA_HOME: join(CLI_HOME_DIR, 'data'),
    DREAMINA_HOME: join(CLI_HOME_DIR, 'home'),
  }
  return { command: runtime.command || exe, args, env: useHostLogin ? {} : nativeEnv }
}

function runProcess(command: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, windowsHide: true, env: { ...process.env, ...(env || {}) } })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('即梦 CLI 执行超时'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const out = decode(Buffer.concat(stdout))
      const err = jimengRuntime().usesWsl ? cleanWslStderr(decode(Buffer.concat(stderr))) : decode(Buffer.concat(stderr))
      if (code !== 0) reject(new Error((err || out || `exit=${code}`).slice(0, 1200)))
      else resolve({ stdout: out, stderr: err })
    })
  })
}

function extractJson(text: string): any {
  const source = String(text || '').trim()
  if (!source) return {}
  const parsed: Array<{ index: number; value: unknown }> = []
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch !== '{' && ch !== '[') continue
    try {
      parsed.push({ index: i, value: JSON.parse(source.slice(i)) })
    } catch {
      const end = Math.max(source.lastIndexOf('}'), source.lastIndexOf(']'))
      if (end > i) try { parsed.push({ index: i, value: JSON.parse(source.slice(i, end + 1)) }) } catch { /* ignore */ }
    }
  }
  if (!parsed.length) return { text: source }
  const score = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 1
    const keys = new Set(Object.keys(value as Record<string, unknown>).map((k) => k.toLowerCase()))
    return ['submit_id', 'gen_status', 'result_json', 'images', 'videos', 'data', 'total_credit'].reduce((sum, key) => sum + (keys.has(key) ? 10 : 0), 0)
  }
  return parsed.sort((a, b) => score(b.value) - score(a.value) || a.index - b.index)[0].value
}

export async function runJimengCli(args: string[], timeoutMs = 120000, rawText = false, loginMode: JimengLoginMode = 'runtime') {
  const exe = jimengExecutable()
  if (!exe) throw new Error('未找到 dreamina CLI。请先安装或把 JIMENG_BIN / DREAMINA_BIN 指向内置 dreamina。')
  const cmd = jimengCommand(args.map(String), exe, loginMode)
  const result = await runProcess(cmd.command, cmd.args, timeoutMs, cmd.env)
  if (rawText) return { _stdout: result.stdout, _stderr: result.stderr }
  const raw = extractJson(`${result.stdout}\n${result.stderr}`.trim())
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...raw, _stdout: result.stdout, ...(result.stderr ? { _stderr: result.stderr } : {}) }
  }
  return raw
}

function parseVersion(text: string) {
  const m = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

async function jimengVersion() {
  for (const flag of ['--version', '-V', 'version']) {
    try {
      const raw = await runJimengCli([flag], 15000, true) as { _stdout?: string; _stderr?: string }
      const text = `${raw._stdout || ''}\n${raw._stderr || ''}`.trim()
      const version = parseVersion(text)
      if (version) return { version, text }
    } catch { /* try next */ }
  }
  return { version: null as number[] | null, text: '' }
}

function versionOk(version: number[] | null) {
  if (!version) return null
  for (let i = 0; i < MIN_JIMENG_VERSION.length; i++) {
    if (version[i] > MIN_JIMENG_VERSION[i]) return true
    if (version[i] < MIN_JIMENG_VERSION[i]) return false
  }
  return true
}

export async function jimengStatus() {
  const exe = jimengExecutable()
  const runtime = jimengRuntimeSource()
  if (!exe) return { installed: false, logged_in: false, message: '未找到 dreamina CLI', runtime }
  const v = await jimengVersion()
  try {
    const raw = await runJimengCli(['user_credit'], 30000)
    return { installed: true, logged_in: true, raw, login_verified_by: 'cli', cli_version: v.version?.join('.') || null, version_ok: versionOk(v.version), min_version: MIN_JIMENG_VERSION.join('.'), runtime }
  } catch (e) {
    const token = jimengTokenSnapshot()
    if (token.present) {
      return { installed: true, logged_in: true, token_present: true, login_verified_by: 'token', message: '已检测到网页登录凭据，积分检测暂不可用。', credit_error: String((e as Error).message || e), cli_version: v.version?.join('.') || null, version_ok: versionOk(v.version), min_version: MIN_JIMENG_VERSION.join('.'), runtime }
    }
    return { installed: true, logged_in: false, message: String((e as Error).message || e), cli_version: v.version?.join('.') || null, version_ok: versionOk(v.version), min_version: MIN_JIMENG_VERSION.join('.'), runtime }
  }
}

export async function jimengCredit() {
  try {
    return { success: true, available: true, logged_in: true, raw: await runJimengCli(['user_credit'], 30000) }
  } catch (e) {
    const token = jimengTokenSnapshot()
    if (token.present) {
      return {
        success: true,
        available: false,
        logged_in: true,
        token_present: true,
        message: '已检测到网页登录凭据，但官方 CLI 暂时没有返回可读积分。',
        error: String((e as Error).message || e),
      }
    }
    throw e
  }
}

export async function jimengLogout() {
  return { success: true, raw: await runJimengCli(['logout'], 30000) }
}

function loginText() {
  return [jimengLoginSession.stdout, jimengLoginSession.stderr].map((v) => v.trim()).filter(Boolean).join('\n').trim()
}

function qrFromText(text: string) {
  const candidates = [...String(text || '').matchAll(/(https?:\/\/[^\s"'<>]+|dreamina:\/\/[^\s"'<>]+|data:image\/[^\s"'<>]+)/g)].map((m) => m[1])
  return candidates.find((value) => /login|qr/i.test(value) || value.startsWith('data:image') || value.startsWith('dreamina://')) || candidates[0] || ''
}

function jimengTokenSnapshot() {
  const candidates = [
    join(CLI_HOME_DIR, 'home', '.local', 'share', 'dreamina', 'byted_cli_user_token.json'),
    join(CLI_HOME_DIR, 'home', '.dreamina_cli', 'byted_cli_user_token.json'),
    join(CLI_HOME_DIR, 'config', 'dreamina', 'byted_cli_user_token.json'),
    join(CLI_HOME_DIR, 'data', 'dreamina', 'byted_cli_user_token.json'),
  ]
  const path = candidates.find((file) => {
    try {
      if (!existsSync(file)) return false
      const text = readFileSync(file, 'utf8')
      if (text.length < 20) return false
      const parsed = JSON.parse(text) as Record<string, unknown>
      const keys = Object.keys(parsed).map((key) => key.toLowerCase())
      return keys.some((key) => /(^|_)(access|refresh|session|auth)?_?token$|cookie/.test(key) && String(parsed[key] || '').length > 20)
    } catch {
      return false
    }
  }) || ''
  return { present: !!path, path }
}

function loginInfoFromText(text: string) {
  const source = String(text || '')
  const field = (name: string) => source.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || ''
  return {
    verification_uri: field('verification_uri'),
    user_code: field('user_code'),
    device_code: field('device_code'),
    expires_at: field('expires_at'),
    qr_url: qrFromText(source),
  }
}

async function loginPayload(proc: ChildProcessWithoutNullStreams | null) {
  const text = loginText()
  const info = loginInfoFromText(text)
  return {
    success: true,
    running: (!!proc && proc.exitCode == null) || !!info.device_code,
    text,
    qr_url: info.qr_url,
    login_url: info.verification_uri || info.qr_url,
    verification_uri: info.verification_uri,
    user_code: info.user_code,
    device_code: info.device_code,
    expires_at: info.expires_at,
    started_at: jimengLoginSession.started_at,
  }
}

function attachLoginReaders(proc: ChildProcessWithoutNullStreams) {
  proc.stdout.on('data', (chunk) => { jimengLoginSession.stdout += decode(Buffer.from(chunk)) + '\n' })
  proc.stderr.on('data', (chunk) => { jimengLoginSession.stderr += (jimengRuntime().usesWsl ? cleanWslStderr(decode(Buffer.from(chunk))) : decode(Buffer.from(chunk))) + '\n' })
}

export async function jimengLoginStart() {
  if (jimengLoginSession.proc && jimengLoginSession.proc.exitCode == null) jimengLoginSession.proc.kill()
  const exe = jimengExecutable()
  if (!exe) throw new Error('未找到 dreamina CLI')
  jimengLoginSession.proc = null
  jimengLoginSession.stdout = ''
  jimengLoginSession.stderr = ''
  jimengLoginSession.started_at = Date.now()
  const cmd = jimengCommand(['login', '--headless'], exe)
  const proc = spawn(cmd.command, cmd.args, { cwd: ROOT, windowsHide: true, env: { ...process.env, ...(cmd.env || {}) } })
  jimengLoginSession.proc = proc
  attachLoginReaders(proc)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  return loginPayload(proc)
}

export async function jimengLoginStatus() {
  const proc = jimengLoginSession.proc
  const running = !!proc && proc.exitCode == null
  let logged_in = false
  let raw: unknown = null
  const payload = await loginPayload(proc)
  const deviceCode = loginInfoFromText(loginText()).device_code
  if (running && !jimengLoginProbe && Date.now() - jimengLoginProbeAt < 5000) {
    return { ...payload, running: true, logged_in: false, raw }
  }
  if (deviceCode) {
    try {
      if (!jimengLoginCheck) {
        jimengLoginCheck = runJimengCli(['login', 'checklogin', `--device_code=${deviceCode}`], 15000)
          .finally(() => { jimengLoginCheck = null })
      }
      raw = await jimengLoginCheck
      logged_in = true
    } catch {
      logged_in = false
    }
  } else if (jimengLoginProbe) {
    try {
      raw = await jimengLoginProbe
      logged_in = true
    } catch {
      logged_in = false
    }
  } else {
    jimengLoginProbeAt = Date.now()
    jimengLoginProbe = runJimengCli(['user_credit'], 12000)
      .finally(() => { jimengLoginProbe = null })
    try {
      raw = await jimengLoginProbe
      logged_in = true
    } catch {
      logged_in = false
    }
  }
  const token = jimengTokenSnapshot()
  if (!logged_in && token.present) {
    logged_in = true
    raw = { token_present: true }
  }
  if (logged_in && proc && proc.exitCode == null) {
    try { proc.kill() } catch { /* ignore */ }
  }
  return { ...payload, running: (running || !!deviceCode) && !logged_in, logged_in, token_present: token.present, login_verified_by: raw && (raw as Record<string, unknown>).token_present ? 'token' : logged_in ? 'cli' : '', raw }
}

export async function jimengHelp(command = '') {
  const allowed = new Set(['', 'login', 'logout', 'user_credit', 'text2image', 'image2image', 'image_upscale', 'text2video', 'image2video', 'multimodal2video', 'frames2video', 'multiframe2video', 'list_task', 'query_result'])
  const cmd = String(command || '').trim()
  if (!allowed.has(cmd)) throw new Error('不支持的帮助命令')
  const raw = await runJimengCli(cmd ? [cmd, '-h'] : ['-h'], 30000, true) as { _stdout?: string; _stderr?: string }
  return { success: true, command: cmd, text: `${raw._stdout || ''}\n${raw._stderr || ''}`.trim(), raw }
}

const JIMENG_MODEL_FALLBACK = ['jimeng-5.0Pro', 'jimeng-5.0', 'jimeng-4.7', 'jimeng-4.6', 'jimeng-4.5', 'jimeng-4.1', 'jimeng-4.0', 'jimeng-3.1', 'jimeng-3.0', 'seedance2.0fast', 'seedance2.0', 'seedance2.0mini', 'seedance2.0_vip', 'seedance2.0fast_vip', 'seedance1.5pro', 'seedance1.0fast']

async function refreshJimengModels(): Promise<Omit<JimengModelsResult, 'cached' | 'refreshing'>> {
  const commands = ['text2image', 'image2image', 'text2video', 'image2video', 'multimodal2video', 'frames2video', 'multiframe2video']
  const found = new Set<string>()
  await Promise.allSettled(commands.map(async (command) => {
    try {
      const help = await jimengHelp(command)
      const text = help.text || ''
      for (const match of text.matchAll(/\b(3\.0|3\.1|4\.0|4\.1|4\.5|4\.6|4\.7|5\.0Pro|5\.0)\b/g)) found.add(`jimeng-${match[1]}`)
      for (const match of text.matchAll(/\b(seedance(?:1\.0fast|1\.5pro|2\.0fast_vip|2\.0_vip|2\.0fast|2\.0mini|2\.0))\b/g)) found.add(match[1])
    } catch {
      /* help parsing is best-effort; fall back below */
    }
  }))
  const ordered = JIMENG_MODEL_FALLBACK.filter((model) => found.has(model))
  for (const model of found) if (!ordered.includes(model)) ordered.push(model)
  const result: Omit<JimengModelsResult, 'cached' | 'refreshing'> = {
    ts: Date.now(),
    models: ordered.length ? ordered : JIMENG_MODEL_FALLBACK,
    source: ordered.length ? 'cli-help' : 'fallback',
  }
  jimengModelCache = result
  return result
}

export async function jimengModels(force = false): Promise<JimengModelsResult> {
  const ttl = 12 * 60 * 60 * 1000
  const cached = jimengModelCache
  const fresh = !!cached && Date.now() - cached.ts < ttl
  if (fresh && !force) return { ...cached, cached: true }
  const ensureRefresh = () => {
    if (!jimengModelRefresh) {
      jimengModelRefresh = refreshJimengModels().finally(() => { jimengModelRefresh = null })
    }
    return jimengModelRefresh
  }
  if (!force) {
    if (cached) {
      ensureRefresh()
      return { ...cached, cached: true, refreshing: true }
    }
    ensureRefresh()
    return { ts: Date.now(), models: JIMENG_MODEL_FALLBACK, source: 'fallback', cached: false, refreshing: true }
  }
  const snap = await ensureRefresh()
  return { ...snap, cached: false }
}

function parseSize(size: string) {
  const m = String(size || '').match(/(\d+)\D+(\d+)/)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1024, height: 1024 }
}

function ratioFromSize(size: string) {
  const { width, height } = parseSize(size)
  const choices = [[21, 9], [16, 9], [3, 2], [4, 3], [1, 1], [3, 4], [2, 3], [9, 16]]
  const [left, right] = choices.sort((a, b) => Math.abs(width / height - a[0] / a[1]) - Math.abs(width / height - b[0] / b[1]))[0]
  return `${left}:${right}`
}

function normalizeImageModel(model: string) {
  if (/\b5(?:\.0)?\s*[-_ ]?pro\b/i.test(model)) return '5.0Pro'
  return String(model || '').match(/(\d+\.\d+)/)?.[1] || ''
}

function imageModelVersion(model: string, mode: 'text2image' | 'image2image') {
  const version = normalizeImageModel(model)
  const allowed = mode === 'image2image' ? new Set(['4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro']) : new Set(['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro'])
  return allowed.has(version) ? version : ''
}

function imageResolution(model: string, size: string, mode: 'text2image' | 'image2image') {
  const text = String(model || '').toLowerCase()
  let desired = text.includes('4k') ? '4k' : text.includes('2k') ? '2k' : /1(?:\.5)?k/.test(text) ? '1.5k' : '1.5k'
  if (!/(?:1(?:\.5)?|2|4)k/.test(text)) {
    const { width, height } = parseSize(size)
    const longest = Math.max(width, height)
    desired = longest > 3072 ? '4k' : longest > 1536 ? '2k' : '1.5k'
  }
  const version = normalizeImageModel(model)
  if (mode === 'image2image') return version === '5.0Pro' ? desired : desired === '4k' ? '4k' : '2k'
  if (['3.0', '3.1', '5.0Pro'].includes(version)) return version === '5.0Pro' && desired === '4k' ? '4k' : desired === '1.5k' ? '1.5k' : '2k'
  return desired === '4k' ? '4k' : '2k'
}

export type JimengImageMode = 'text2image' | 'image2image'
export type JimengVideoCommand = 'text2video' | 'image2video' | 'multimodal2video' | 'frames2video' | 'multiframe2video'
export interface JimengSubmitOptions { pollSeconds?: number; deferPending?: boolean }
export interface JimengVideoOptions {
  imagePath?: string
  imagePaths?: string[]
  imageRoles?: string[]
  videoPaths?: string[]
  audioPaths?: string[]
  duration?: number
  aspect_ratio?: string
  resolution?: string
  multimodal?: boolean
  pollSeconds?: number
  deferPending?: boolean
}

const JIMENG_VIDEO_HIGH_RES_MODELS = new Set(['seedance2.0_vip'])
const JIMENG_VIDEO_MODELS_BY_COMMAND: Record<Exclude<JimengVideoCommand, 'multiframe2video'>, Set<string>> = {
  text2video: new Set(['seedance2.0', 'seedance2.0fast', 'seedance2.0_vip', 'seedance2.0fast_vip', 'seedance2.0mini']),
  image2video: new Set(['seedance1.0fast', 'seedance1.5pro', 'seedance2.0', 'seedance2.0fast', 'seedance2.0_vip', 'seedance2.0fast_vip', 'seedance2.0mini']),
  multimodal2video: new Set(['seedance2.0', 'seedance2.0fast', 'seedance2.0_vip', 'seedance2.0fast_vip', 'seedance2.0mini']),
  frames2video: new Set(['seedance1.5pro', 'seedance2.0', 'seedance2.0fast', 'seedance2.0_vip', 'seedance2.0fast_vip', 'seedance2.0mini']),
}

function videoModelVersion(model: string) {
  const low = String(model || '').trim().toLowerCase()
  return ['seedance1.0fast', 'seedance1.5pro', 'seedance2.0fast_vip', 'seedance2.0_vip', 'seedance2.0mini', 'seedance2.0fast', 'seedance2.0']
    .find((item) => low.includes(item)) || ''
}

function videoModelForCommand(model: string, command: Exclude<JimengVideoCommand, 'multiframe2video'>) {
  const version = videoModelVersion(model)
  const allowed = JIMENG_VIDEO_MODELS_BY_COMMAND[command]
  if (allowed.has(version)) return version
  throw new Error(`即梦 ${command} 不支持模型「${model}」。可用模型：${[...allowed].sort().join('、')}。`)
}

function videoResolution(model: string, resolution = '720p') {
  const version = videoModelVersion(model)
  const raw = String(resolution || '720p').trim().toLowerCase()
  const requested = ['4k', '4kp'].includes(raw) ? '4k' : ['1080', '1080p'].includes(raw) ? '1080p' : ['720', '720p'].includes(raw) ? '720p' : ''
  if (!requested) throw new Error('即梦视频只支持 720p；seedance2.0_vip 额外支持 1080p 和 4k。')
  if (!JIMENG_VIDEO_HIGH_RES_MODELS.has(version) && requested !== '720p') throw new Error(`即梦模型 ${version || model} 只支持 720p。`)
  return requested
}

function multiframeResolution(resolution = '720p') {
  const raw = String(resolution || '720p').trim().toLowerCase()
  if (['720', '720p'].includes(raw)) return '720p'
  if (['1080', '1080p'].includes(raw)) return '1080p'
  throw new Error('即梦多帧视频只支持 720p 或 1080p。')
}

function videoDuration(duration: number | undefined, model: string, command: Exclude<JimengVideoCommand, 'multiframe2video'>) {
  const version = videoModelVersion(model)
  const [low, high] = command === 'image2video' && version === 'seedance1.0fast' ? [5, 10]
    : ['image2video', 'frames2video'].includes(command) && version === 'seedance1.5pro' ? [5, 12]
      : [4, 15]
  const value = duration == null ? Math.max(low, Math.min(high, 5)) : Number(duration)
  if (!Number.isInteger(value) || value < low || value > high) throw new Error(`即梦模型 ${version || model} 只支持 ${low}-${high} 秒整数时长。`)
  return value
}

function videoRatio(value = '16:9') {
  const ratio = String(value || '16:9').trim() || '16:9'
  if (!new Set(['1:1', '3:4', '16:9', '4:3', '9:16', '21:9']).has(ratio)) throw new Error('即梦视频比例仅支持 1:1、3:4、16:9、4:3、9:16、21:9。')
  return ratio
}

function transitionDuration(totalDuration: number | undefined, transitionCount: number) {
  const total = Number(totalDuration) || 0
  return Math.max(1, Math.min(8, Math.round(total <= 0 ? 3 : total / Math.max(1, transitionCount))))
}

function transitionPrompts(prompt: string, segments: number) {
  const values = String(prompt || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  if (!values.length) return []
  while (values.length < segments) values.push(values[values.length - 1])
  return values.slice(0, segments)
}

export function buildJimengImageArgs(prompt: string, model = 'jimeng-5.0Pro', size = '1024x1024', imagePaths: string[] = [], submit: JimengSubmitOptions = {}) {
  const mode: JimengImageMode = imagePaths.length ? 'image2image' : 'text2image'
  const version = imageModelVersion(model, mode)
  const poll = Math.max(0, Math.min(600, Math.round(Number(submit.pollSeconds ?? 600) || 0)))
  const args = imagePaths.length
    // dreamina image2image 与原项目一致，不接受 --ratio；参考图决定输出比例。
    ? ['image2image', `--images=${imagePaths.slice(0, 10).map(jimengPathArg).join(',')}`, `--prompt=${prompt}`, `--resolution_type=${imageResolution(model, size, mode)}`, `--poll=${poll}`]
    : ['text2image', `--prompt=${prompt}`, `--ratio=${ratioFromSize(size)}`, `--resolution_type=${imageResolution(model, size, mode)}`, `--poll=${poll}`]
  if (version) args.push(`--model_version=${version}`)
  return { command: mode, args }
}

export function buildJimengVideoArgs(prompt: string, model = 'seedance2.0fast', opts: JimengVideoOptions = {}) {
  const imagePaths = [...(opts.imagePaths || []), ...(opts.imagePath ? [opts.imagePath] : [])].slice(0, 20)
  const imageRoles = opts.imageRoles || []
  const videoPaths = (opts.videoPaths || []).slice(0, 3)
  const audioPaths = (opts.audioPaths || []).slice(0, 3)
  const poll = Math.max(0, Math.min(600, Math.round(Number(opts.pollSeconds ?? 600) || 0)))
  let command: JimengVideoCommand
  let args: string[]
  if (opts.multimodal || videoPaths.length || audioPaths.length) {
    if (!imagePaths.length && !videoPaths.length) throw new Error('即梦全能参考至少需要一张图片或一个视频，音频不能单独生成视频。')
    command = 'multimodal2video'
    const version = videoModelForCommand(model, command)
    args = [command, `--prompt=${prompt}`, `--duration=${videoDuration(opts.duration, version, command)}`, `--poll=${poll}`, `--ratio=${videoRatio(opts.aspect_ratio)}`, `--model_version=${version}`, `--video_resolution=${videoResolution(version, opts.resolution)}`]
    for (const path of imagePaths.slice(0, 9)) args.push(`--image=${jimengPathArg(path)}`)
    for (const path of videoPaths) args.push(`--video=${jimengPathArg(path)}`)
    for (const path of audioPaths) args.push(`--audio=${jimengPathArg(path)}`)
  } else if (imagePaths.length >= 2) {
    const firstIndex = imageRoles.findIndex((role) => String(role).toLowerCase() === 'first_frame')
    const lastIndex = imageRoles.findIndex((role) => String(role).toLowerCase() === 'last_frame')
    if (firstIndex >= 0 && lastIndex >= 0) {
      command = 'frames2video'
      const version = videoModelForCommand(model, command)
      args = [command, `--first=${jimengPathArg(imagePaths[firstIndex])}`, `--last=${jimengPathArg(imagePaths[lastIndex])}`, `--prompt=${prompt}`, `--duration=${videoDuration(opts.duration, version, command)}`, `--poll=${poll}`, `--model_version=${version}`, `--video_resolution=${videoResolution(version, opts.resolution)}`]
    } else {
      command = 'multiframe2video'
      const segments = Math.max(1, imagePaths.length - 1)
      const duration = transitionDuration(opts.duration, segments)
      args = [command, `--images=${imagePaths.map(jimengPathArg).join(',')}`, `--poll=${poll}`, `--video_resolution=${multiframeResolution(opts.resolution)}`]
      if (imagePaths.length <= 2) {
        if (String(prompt || '').trim()) args.push(`--prompt=${prompt}`)
        args.push(`--duration=${duration}`)
      } else {
        for (const value of transitionPrompts(prompt, segments)) args.push(`--transition-prompt=${value}`)
        for (let i = 0; i < segments; i++) args.push(`--transition-duration=${duration}`)
      }
    }
  } else if (imagePaths.length) {
    command = 'image2video'
    const version = videoModelForCommand(model, command)
    // image2video 的画幅由输入图决定，dreamina 不提供 --ratio 参数。
    args = [command, `--image=${jimengPathArg(imagePaths[0])}`, `--prompt=${prompt}`, `--duration=${videoDuration(opts.duration, version, command)}`, `--poll=${poll}`, `--model_version=${version}`, `--video_resolution=${videoResolution(version, opts.resolution)}`]
  } else {
    command = 'text2video'
    const version = videoModelForCommand(model, command)
    args = [command, `--prompt=${prompt}`, `--duration=${videoDuration(opts.duration, version, command)}`, `--ratio=${videoRatio(opts.aspect_ratio)}`, `--poll=${poll}`, `--model_version=${version}`, `--video_resolution=${videoResolution(version, opts.resolution)}`]
  }
  return { command, args }
}

function submitId(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const found: string[] = []
  const visit = (value: any) => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (['submit_id', 'submitid', 'task_id', 'taskid'].includes(key.toLowerCase()) && item) found.push(String(item))
      else visit(item)
    }
  }
  visit(raw)
  return found[0] || ''
}

function collectMedia(value: unknown, out: string[]) {
  const mediaExt = /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|flac|ogg)(\?|#|$)/i
  if (typeof value === 'string') {
    const text = value.trim()
    if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('file://') || text.startsWith('/mnt/') || /^[A-Za-z]:[\\/]/.test(text) || mediaExt.test(text))) out.push(text)
  } else if (Array.isArray(value)) value.forEach((item) => collectMedia(item, out))
  else if (value && typeof value === 'object') Object.entries(value).forEach(([, item]) => collectMedia(item, out))
}

function mimeFor(path: string, kind: 'image' | 'video' | 'audio') {
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.flac') return 'audio/flac'
  return kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/png'
}

function mediaValueToDisplay(value: string, kind: 'image' | 'video' | 'audio') {
  let text = String(value || '').trim()
  if (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:')) return text
  if (text.startsWith('file://')) text = decodeURIComponent(new URL(text).pathname).replace(/^\/([A-Za-z]:\/)/, '$1')
  if (text.startsWith('/mnt/')) text = wslPathToWindows(text)
  if (!existsSync(text)) return ''
  const data = readFileSync(text).toString('base64')
  return `data:${mimeFor(text, kind)};base64,${data}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mediaUrlsFromRaw(raw: unknown, kind: 'image' | 'video' | 'audio') {
  const values: string[] = []
  collectMedia(raw, values)
  return [...new Set(values)].map((value) => mediaValueToDisplay(value, kind)).filter(Boolean)
}

function failedTaskReason(raw: unknown): string {
  const hits: Array<{ key: string; text: string }> = []
  const visit = (value: unknown, key = '') => {
    if (Array.isArray(value)) value.forEach((item) => visit(item, key))
    else if (value && typeof value === 'object') {
      for (const [k, item] of Object.entries(value as Record<string, unknown>)) visit(item, k)
    } else if (/status|state|error|message|reason/i.test(key)) {
      const text = String(value ?? '').trim()
      if (/fail|error|cancel|reject|失败|错误|取消|拒绝/i.test(text)) hits.push({ key, text })
    }
  }
  visit(raw)
  const generic = /^(fail(?:ed|ure)?|error|cancel(?:ed|led)?|reject(?:ed)?|失败|错误|取消|拒绝)$/i
  return hits
    .sort((a, b) => {
      const aDetail = generic.test(a.text) ? 0 : 1
      const bDetail = generic.test(b.text) ? 0 : 1
      const aErrorKey = /error|message|reason/i.test(a.key) ? 1 : 0
      const bErrorKey = /error|message|reason/i.test(b.key) ? 1 : 0
      return bDetail - aDetail || bErrorKey - aErrorKey || b.text.length - a.text.length
    })[0]?.text || ''
}

export function jimengFailureMessage(raw: unknown): string {
  const reason = failedTaskReason(raw)
  if (!reason) return ''
  const id = submitId(raw)
  const task = id ? `（submit_id=${id}）` : ''
  if (/^(?:generation failed:\s*)?final generation failed$/i.test(reason)) {
    return `即梦云端未完成生成，可能触发提示词、名人/版权内容审核，或云端生成失败。请调整提示词后重试${task}`
  }
  return `即梦任务失败：${reason}${task}`
}

function queueInfo(raw: unknown): Record<string, unknown> {
  let found: Record<string, unknown> | null = null
  const visit = (value: unknown) => {
    if (found || value == null) return
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (typeof value !== 'object') return
    const item = value as Record<string, unknown>
    if (item.queue_info && typeof item.queue_info === 'object' && !Array.isArray(item.queue_info)) {
      found = item.queue_info as Record<string, unknown>
      return
    }
    Object.values(item).forEach(visit)
  }
  visit(raw)
  return found || {}
}

export class JimengPendingError extends Error {
  constructor(public submit_id: string, public kind: 'image' | 'video' | 'audio', public queue_info: Record<string, unknown>, public raw: unknown) {
    super(`即梦任务仍在生成中，submit_id=${submit_id}`)
    this.name = 'JimengPendingError'
  }
}

export function jimengPendingPayload(error: JimengPendingError) {
  const index = error.queue_info.queue_idx
  const length = error.queue_info.queue_length
  const hasQueuePosition = Number.isFinite(Number(index)) && Number(index) > 0
    && Number.isFinite(Number(length)) && Number(length) > 0
  const queueText = hasQueuePosition
    ? `即梦云端排队中（第 ${index}/${length} 位）`
    : '即梦云端生成中'
  return {
    jimeng_pending: true,
    status: 'pending' as const,
    submit_id: error.submit_id,
    kind: error.kind,
    queue_info: error.queue_info,
    queue_index: hasQueuePosition ? Number(index) : undefined,
    queue_total: hasQueuePosition ? Number(length) : undefined,
    queue_status: error.queue_info.queue_status,
    queue_text: queueText,
    updated_at: Date.now(),
    message: `${queueText}，任务未丢失，可继续查询。submit_id=${error.submit_id}`,
  }
}

async function storeOutputs(raw: unknown, kind: 'image' | 'video', allowQuery = true): Promise<string[]> {
  const initialFailure = jimengFailureMessage(raw)
  if (initialFailure) throw new Error(initialFailure)
  const urls = mediaUrlsFromRaw(raw, kind)
  if (urls.length) return urls
  const id = submitId(raw)
  if (id && allowQuery) {
    const deadline = Date.now() + JIMENG_TEST_TIMEOUT_MS
    let lastRaw = raw
    let lastError = ''
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      try {
        const queried = await runJimengCli(['query_result', `--submit_id=${id}`, `--download_dir=${jimengPathArg(OUTPUT_DIR)}`], Math.min(60000, Math.max(1000, remaining)))
        const queriedUrls = mediaUrlsFromRaw(queried, kind)
        if (queriedUrls.length) return queriedUrls
        lastRaw = queried
        const failed = jimengFailureMessage(queried)
        if (failed) throw new Error(failed)
      } catch (e) {
        lastError = String((e as Error).message || e)
        if (!/生成中|pending|running|processing|queue|timeout|超时|result|结果|not.*ready/i.test(lastError)) throw e
      }
      if (Date.now() < deadline) await sleep(Math.min(5000, Math.max(500, deadline - Date.now())))
    }
    const failed = jimengFailureMessage(lastRaw)
    if (failed) throw new Error(failed)
    if (lastError && !/超时/.test(lastError) && !/pending|running|processing|queue|result|结果|not.*ready/i.test(lastError)) throw new Error(lastError)
    throw new JimengPendingError(id, kind, queueInfo(lastRaw), lastRaw)
  }
  if (id) throw new JimengPendingError(id, kind, queueInfo(raw), raw)
  throw new Error(`即梦 CLI 未返回可用${kind === 'video' ? '视频' : '图片'}结果`)
}

export async function queryJimengMedia(submitIdValue: string, kind: 'image' | 'video' | 'audio' = 'image') {
  const id = String(submitIdValue || '').trim()
  if (!id) throw new Error('缺少 submit_id')
  let raw: unknown
  try {
    raw = await runJimengCli(['query_result', `--submit_id=${id}`, `--download_dir=${jimengPathArg(OUTPUT_DIR)}`], 360000)
  } catch (error) {
    const message = String((error as Error).message || error)
    if (/生成中|pending|running|processing|queue|not.*ready|超时/i.test(message)) {
      const pending = new JimengPendingError(id, kind, {}, { message })
      return { ...jimengPendingPayload(pending), raw: pending.raw }
    }
    throw error
  }
  const urls = mediaUrlsFromRaw(raw, kind)
  if (urls.length) return { status: 'succeeded' as const, submit_id: id, kind, urls, raw }
  const failed = jimengFailureMessage(raw)
  if (failed) return { status: 'failed' as const, submit_id: id, kind, error: failed, raw }
  const pending = new JimengPendingError(id, kind, queueInfo(raw), raw)
  return { ...jimengPendingPayload(pending), raw }
}

export async function listJimengTasks() {
  const raw = await runJimengCli(['list_task'], 30000)
  return { success: true, raw }
}

export async function generateJimengImage(prompt: string, model = 'jimeng-5.0Pro', size = '1024x1024', imagePaths: string[] = [], submit: JimengSubmitOptions = {}) {
  ensureDirs()
  try {
    const spec = buildJimengImageArgs(prompt, model, size, imagePaths, submit)
    const raw = await runJimengCli(spec.args, JIMENG_PROCESS_TIMEOUT_MS)
    let urls = mediaUrlsFromRaw(raw, 'image')
    if (!urls.length && submit.deferPending) {
      const failed = jimengFailureMessage(raw)
      if (failed) throw new Error(failed)
      const id = submitId(raw)
      if (id) throw new JimengPendingError(id, 'image', queueInfo(raw), raw)
    }
    if (!urls.length) urls = await storeOutputs(raw, 'image')
    return { image: urls[0], images: urls, command: spec.command, raw, submit_id: submitId(raw) || undefined }
  } finally {
    for (const path of imagePaths) try { unlinkSync(path) } catch { /* ignore */ }
  }
}

export function tempMediaFile(buf: Buffer, mime = 'application/octet-stream', fallbackExt = '.bin') {
  ensureDirs()
  const ext = mime.includes('png') ? '.png' : mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : mime.includes('webp') ? '.webp' : mime.includes('mp4') ? '.mp4' : fallbackExt
  const path = join(TEMP_DIR, `${randomUUID()}${ext}`)
  writeFileSync(path, buf)
  return path
}

export async function upscaleJimengImage(imagePath: string, resolution = '2k', submit: JimengSubmitOptions = {}) {
  ensureDirs()
  const value = String(resolution || '').trim().toLowerCase()
  const normalized = new Set(['2k', '4k', '8k']).has(value) ? value : '2k'
  try {
    const poll = Math.max(0, Math.min(600, Math.round(Number(submit.pollSeconds ?? 600) || 0)))
    const raw = await runJimengCli(['image_upscale', `--image=${jimengPathArg(imagePath)}`, `--resolution_type=${normalized}`, `--poll=${poll}`], JIMENG_PROCESS_TIMEOUT_MS)
    let images = mediaUrlsFromRaw(raw, 'image')
    if (!images.length && submit.deferPending) {
      const failed = failedTaskReason(raw)
      if (failed) throw new Error(`即梦任务失败：${failed}`)
      const id = submitId(raw)
      if (id) throw new JimengPendingError(id, 'image', queueInfo(raw), raw)
    }
    if (!images.length) images = await storeOutputs(raw, 'image')
    return { image: images[0], images, command: 'image_upscale' as const, raw, submit_id: submitId(raw) || undefined }
  } finally {
    try { unlinkSync(imagePath) } catch { /* ignore */ }
  }
}

export async function generateJimengVideo(prompt: string, model = 'seedance2.0fast', opts: JimengVideoOptions = {}) {
  ensureDirs()
  const cleanup = [...(opts.imagePaths || []), ...(opts.imagePath ? [opts.imagePath] : []), ...(opts.videoPaths || []), ...(opts.audioPaths || [])]
  try {
    const spec = buildJimengVideoArgs(prompt, model, opts)
    const raw = await runJimengCli(spec.args, JIMENG_PROCESS_TIMEOUT_MS)
    let videos = mediaUrlsFromRaw(raw, 'video')
    if (!videos.length && opts.deferPending) {
      const failed = failedTaskReason(raw)
      if (failed) throw new Error(`即梦任务失败：${failed}`)
      const id = submitId(raw)
      if (id) throw new JimengPendingError(id, 'video', queueInfo(raw), raw)
    }
    if (!videos.length) videos = await storeOutputs(raw, 'video')
    return { videos, command: spec.command, raw, submit_id: submitId(raw) || undefined }
  } finally {
    for (const path of cleanup) try { unlinkSync(path) } catch { /* ignore */ }
  }
}
