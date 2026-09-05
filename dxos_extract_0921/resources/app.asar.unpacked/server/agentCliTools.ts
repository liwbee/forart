import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'

const ROOT = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = dirname(ROOT)
const OUTPUT_DIR = dataPath('cli-output', 'openai')
const CODEX_MODELS = ['gpt-5.5']
const CODEX_IMAGE_MODELS = ['gpt-image-2']
const GEMINI_MODELS = ['auto']

export type AgentCliTool = 'codex' | 'gemini'
type ProcResult = { stdout: string; stderr: string; code: number }
type LoginProcess = { exitCode: number | null; kill: () => void }
type LoginSession = { proc: LoginProcess | null; stdout: string; stderr: string; started_at: number }
type Runtime = {
  command: string
  argsPrefix: string[]
  path: string
  label: string
  provider: 'codex' | 'antigravity' | 'gemini'
  detail: string
  mode: 'bundled' | 'host'
  home: string
  env: NodeJS.ProcessEnv
}

const loginSessions: Record<AgentCliTool, LoginSession> = {
  codex: { proc: null, stdout: '', stderr: '', started_at: 0 },
  gemini: { proc: null, stdout: '', stderr: '', started_at: 0 },
}

function envValue(...keys: string[]) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim().replace(/^"|"$/g, '')
    if (value) return value
  }
  return ''
}

function findOnPath(command: string) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', '.ps1', ''] : ['']
  for (const folder of String(process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!folder) continue
    for (const extension of extensions) {
      const candidate = join(folder, extname(command) ? command : command + extension)
      if (existsSync(candidate)) return candidate
    }
  }
  return ''
}

function antigravityCandidate() {
  if (process.platform !== 'win32') return findOnPath('agy')
  const root = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  try {
    const folder = readdirSync(root).filter((name) => /^Google\.AntigravityCLI_/i.test(name)).sort().reverse()[0]
    const candidate = folder ? join(root, folder, 'agy.exe') : ''
    return candidate && existsSync(candidate) ? candidate : ''
  } catch { return '' }
}

function npmJsRuntime(executable: string, tool: 'gemini' | 'gpt-image-2-skill'): Runtime | null {
  if (!/\.(cmd|ps1)$/i.test(executable)) return null
  const base = dirname(executable)
  const script = tool === 'gemini'
    ? join(base, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js')
    : join(base, 'node_modules', 'gpt-image-2-skill', 'bin', 'gpt-image-2-skill.js')
  const node = findOnPath('node')
  if (!node || !existsSync(script)) return null
  const home = join(homedir(), tool === 'gemini' ? '.gemini' : '.codex')
  return { command: node, argsPrefix: [script], path: executable, label: '本机 Google Gemini CLI', provider: 'gemini', detail: '使用本机安装的 Gemini CLI 与当前 Windows 用户登录态。', mode: 'host', home, env: {} }
}

function runtime(tool: AgentCliTool): Runtime | null {
  if (tool === 'codex') {
    const path = envValue('CODEX_BIN') || findOnPath('codex')
    return path ? { command: path, argsPrefix: [], path, label: '本机 OpenAI Codex CLI', provider: 'codex', detail: '使用本机安装的 Codex CLI 与本机登录态；GPT Image 2 Skill 由 DX OS 内置。', mode: 'host', home: join(homedir(), '.codex'), env: {} } : null
  }
  const configuredAgy = envValue('ANTIGRAVITY_BIN', 'AGY_BIN')
  if (configuredAgy) return { command: configuredAgy, argsPrefix: [], path: configuredAgy, label: '本机 Google Antigravity CLI', provider: 'antigravity', detail: '使用本机安装的 Antigravity CLI 与当前 Windows 用户登录态。', mode: 'host', home: join(homedir(), '.gemini'), env: {} }
  const gemini = envValue('GEMINI_BIN') || findOnPath('gemini')
  const agy = findOnPath('agy') || antigravityCandidate()
  if (!gemini && agy) return { command: agy, argsPrefix: [], path: agy, label: '本机 Google Antigravity CLI', provider: 'antigravity', detail: '使用本机安装的 Antigravity CLI 与当前 Windows 用户登录态。', mode: 'host', home: join(homedir(), '.gemini'), env: {} }
  if (!gemini) return null
  return npmJsRuntime(gemini, 'gemini') || { command: gemini, argsPrefix: [], path: gemini, label: '本机 Google Gemini CLI', provider: 'gemini', detail: '使用本机安装的 Gemini CLI 与当前用户登录态。', mode: 'host', home: join(homedir(), '.gemini'), env: {} }
}

function run(rt: Runtime, args: string[], timeoutMs = 30000, input = ''): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(rt.command, [...rt.argsPrefix, ...args], { cwd: WORKSPACE, windowsHide: true, env: { ...process.env, ...rt.env } })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${rt.label} 执行超时`)) }, timeoutMs)
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout: Buffer.concat(stdout).toString('utf8').trim(), stderr: Buffer.concat(stderr).toString('utf8').trim(), code: code ?? -1 })
    })
    if (input) child.stdin.write(input)
    child.stdin.end()
  })
}

function sessionPayload(tool: AgentCliTool, loggedIn = false) {
  const session = loginSessions[tool]
  const text = [session.stdout, session.stderr].filter(Boolean).join('\n').replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '').trim()
  return { success: true, running: !!session.proc && session.proc.exitCode == null && !loggedIn, logged_in: loggedIn, text, login_url: '', verification_uri: '', user_code: '', started_at: session.started_at }
}

function fileHasUsefulJson(path: string) {
  try {
    if (!existsSync(path) || statSync(path).size < 3) return false
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return !!value && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0)
  } catch { return false }
}

function geminiCredentialSnapshot(root: string) {
  const candidates = [
    join(root, 'oauth_creds.json'),
    join(root, 'google_accounts.json'),
    join(root, 'antigravity-cli', 'oauth_creds.json'),
    join(root, 'antigravity', 'oauth_creds.json'),
  ]
  const path = candidates.find(fileHasUsefulJson) || ''
  return { present: !!path, path }
}

export function agentCliInstalled(tool: AgentCliTool) { return !!runtime(tool) }

export async function agentCliDownloadInfo(tool: AgentCliTool) {
  const base = String(process.env.DX_SOFTWARE_API_URL || 'https://api.dx-os.com').trim().replace(/\/+$/, '')
  const baseUrl = new URL(base)
  const localBase = baseUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(baseUrl.hostname)
  if (baseUrl.protocol !== 'https:' && !localBase) throw new Error('CLI 下载服务器必须使用 HTTPS')
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
  const architecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch
  const endpoint = `${base}/v1/software/com.dxos.cli.${tool}/latest?platform=${platform}&architecture=${architecture}&channel=stable&checkedAt=${Date.now()}`
  const response = await fetch(endpoint, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) throw new Error('服务器尚未发布这个 CLI 的安装包')
  if (!response.ok) throw new Error(`CLI 下载服务器返回 HTTP ${response.status}`)
  const payload = await response.json() as any
  const artifact = payload?.artifact || payload?.release?.artifact
  const downloadUrl = new URL(String(artifact?.downloadUrl || ''))
  const localDownload = downloadUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(downloadUrl.hostname)
  if (downloadUrl.protocol !== 'https:' && !localDownload) throw new Error('CLI 安装包地址必须使用 HTTPS')
  return {
    download_url: downloadUrl.toString(),
    file_name: String(artifact?.fileName || ''),
    file_size: Number(artifact?.fileSize || 0),
    version: String(payload?.release?.version || artifact?.version || ''),
    message: `请下载并自行安装 ${tool === 'codex' ? 'Codex CLI' : 'Gemini CLI'}；安装完成后返回刷新状态。`,
  }
}

export async function agentCliStatus(tool: AgentCliTool) {
  const rt = runtime(tool)
  if (!rt) return { installed: false, logged_in: false, login_verified_by: '', message: `未找到${tool === 'codex' ? ' OpenAI Codex' : ' Gemini / Antigravity'} CLI` }
  let version = ''
  try {
    const result = await run(rt, ['--version'], 10000)
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `exit=${result.code}`)
    version = result.stdout || result.stderr
  } catch (error) {
    if (tool === 'gemini' && rt.provider === 'antigravity') {
      const gemini = findOnPath('gemini')
      const fallback = gemini ? (npmJsRuntime(gemini, 'gemini') || { command: gemini, argsPrefix: [], path: gemini, label: '本机 Google Gemini CLI', provider: 'gemini' as const, detail: 'Antigravity 不可执行，已回退到本机 Gemini CLI。', mode: 'host' as const, home: join(homedir(), '.gemini'), env: {} }) : null
      if (fallback) return agentCliStatusWithRuntime(tool, fallback)
    }
    return { installed: false, logged_in: false, login_verified_by: '', runtime: { ...rt, login_mode: 'host' as const }, message: `${rt.label} 检测失败：${String((error as Error).message || error)}` }
  }
  return agentCliStatusWithRuntime(tool, rt, version)
}

async function agentCliStatusWithRuntime(tool: AgentCliTool, rt: Runtime, knownVersion = '') {
  let version = knownVersion
  if (!version) {
    const result = await run(rt, ['--version'], 10000)
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `exit=${result.code}`)
    version = result.stdout || result.stderr
  }
  let loggedIn = false
  let loginMessage = ''
  let verifiedBy = ''
  if (tool === 'codex') {
    const status = await run(rt, ['login', 'status'], 15000)
    loggedIn = status.code === 0 && /logged in|登录/i.test(`${status.stdout}\n${status.stderr}`)
    loginMessage = status.stdout || status.stderr
    verifiedBy = loggedIn ? 'cli' : ''
  } else {
    const token = geminiCredentialSnapshot(rt.home)
    loggedIn = token.present
    loginMessage = loggedIn ? '已检测到 Google CLI 登录凭据。' : '尚未检测到 Google CLI 登录凭据。'
    verifiedBy = loggedIn ? 'credential' : ''
  }
  const helper = tool === 'codex' ? gptImageHelperRuntime() : null
  return {
    installed: true,
    logged_in: loggedIn,
    cli_version: version.match(/\d+(?:\.\d+)+/)?.[0] || version,
    message: loginMessage,
    login_verified_by: verifiedBy,
    image2_helper_installed: !!helper,
    runtime: { label: rt.label, path: rt.path, mode: rt.mode, detail: rt.detail, home: rt.home, login_mode: 'host' as const, provider: rt.provider },
  }
}

export async function agentCliLoginStart(tool: AgentCliTool) {
  const rt = runtime(tool)
  if (!rt) throw new Error(`未找到 ${tool} CLI`)
  const session = loginSessions[tool]
  if (session.proc && session.proc.exitCode == null) session.proc.kill()
  session.proc = null; session.stdout = ''; session.stderr = ''; session.started_at = Date.now()
  if (process.platform !== 'win32') throw new Error('当前版本请先在系统终端中运行 CLI 完成登录')
  const cliArgs = tool === 'codex' ? [...rt.argsPrefix, 'login'] : rt.argsPrefix
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
  const command = `& ${quote(rt.command)}${cliArgs.map((arg) => ` ${quote(arg)}`).join('')}`
  const proc = spawn('powershell.exe', ['-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: WORKSPACE, detached: true, windowsHide: false, stdio: 'ignore', env: { ...process.env, ...rt.env },
  })
  proc.unref()
  session.proc = proc
  session.stdout = `已打开系统终端，请在终端中完成 ${tool === 'codex' ? 'Codex' : 'Gemini'} 登录和首次初始化。`
  return { ...sessionPayload(tool), running: true, terminal_opened: true }
}

export async function agentCliLoginStatus(tool: AgentCliTool) {
  const status = await agentCliStatus(tool)
  const loggedIn = status.logged_in === true
  const session = loginSessions[tool]
  if (loggedIn && session.proc && session.proc.exitCode == null) session.proc.kill()
  return { ...sessionPayload(tool, loggedIn), raw: status, login_verified_by: status.login_verified_by, running: !loggedIn && !!session.proc && session.proc.exitCode == null }
}

export async function agentCliLogout(tool: AgentCliTool) {
  const session = loginSessions[tool]
  if (session.proc && session.proc.exitCode == null) {
    try { session.proc.kill() } catch { /* already stopped */ }
  }
  const rt = runtime(tool)
  if (!rt) throw new Error(`未找到 ${tool} CLI`)
  if (tool === 'codex') {
    const result = await run(rt, ['logout'], 30000)
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || '退出登录失败')
    return { success: true, raw: result }
  }
  return { success: false, manual: true, message: 'Gemini / Antigravity CLI 没有统一的安全退出命令，请在已打开的官方 CLI 中执行 /auth 或账户退出。' }
}

export async function agentCliHelp(tool: AgentCliTool, command = '') {
  const rt = runtime(tool)
  if (!rt) throw new Error(`未找到 ${tool} CLI`)
  const allowed = tool === 'codex' ? new Set(['', 'exec', 'login', 'logout', 'doctor', 'mcp', 'plugin', 'app', 'update']) : new Set(['', 'mcp', 'extensions', 'skills', 'hooks'])
  const value = String(command || '').trim()
  if (!allowed.has(value)) throw new Error('不支持的帮助命令')
  const result = await run(rt, [...(value ? [value] : []), '--help'], 20000)
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || `exit=${result.code}`)
  return { success: true, command: value, text: result.stdout || result.stderr, raw: result }
}

export function agentCliModels(tool: AgentCliTool) {
  const models = tool === 'codex' ? [...CODEX_IMAGE_MODELS, ...CODEX_MODELS] : GEMINI_MODELS
  return { models, model_items: models.map((model) => ({ model, type: tool === 'codex' && CODEX_IMAGE_MODELS.includes(model) ? 'image' : 'llm' })), count: models.length, source: 'cli-defaults', cached: true, ts: Date.now() }
}

export async function runAgentCliChat(tool: AgentCliTool, prompt: string, model = '', timeoutMs = 900000) {
  const rt = runtime(tool)
  if (!rt) throw new Error(`未找到 ${tool} CLI`)
  const started = Date.now()
  let result: ProcResult
  if (tool === 'codex') {
    const args = ['exec', '-C', WORKSPACE, '--sandbox', 'read-only', '--skip-git-repo-check']
    if (model && !/^gpt-image/i.test(model)) args.push('--model', model)
    args.push(String(prompt || ''))
    result = await run(rt, args, timeoutMs)
  } else if (rt.provider === 'antigravity') {
    const args = ['--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`]
    if (model && model !== 'auto') args.push('--model', model)
    args.push('-p', String(prompt || ''))
    result = await run(rt, args, timeoutMs)
  } else {
    const args = ['--output-format', 'json', '--skip-trust']
    if (model && model !== 'auto') args.push('--model', model)
    args.push('--prompt', String(prompt || ''))
    result = await run(rt, args, timeoutMs)
  }
  if (result.code !== 0) throw new Error(`${rt.label} 调用失败：${(result.stderr || result.stdout || `exit=${result.code}`).slice(0, 1600)}`)
  let text = result.stdout
  try {
    const raw = JSON.parse(result.stdout)
    text = String(raw.response || raw.text || raw.content || raw.message || result.stdout)
  } catch { /* plain text */ }
  return { text: text.trim(), latencyMs: Date.now() - started, raw: result }
}

function gptImageHelperRuntime() {
  const bundled = process.platform === 'win32' && process.arch === 'x64' ? join(ROOT, 'cli-runtime', 'openai', 'bin', 'gpt-image-2-skill.exe') : ''
  const path = (bundled && existsSync(bundled) ? bundled : '') || envValue('GPT_IMAGE_2_SKILL_BIN') || findOnPath('gpt-image-2-skill')
  if (!path) return null
  return npmJsRuntime(path, 'gpt-image-2-skill') || {
    command: path,
    argsPrefix: [],
    path,
    label: 'GPT Image 2 Skill',
    provider: 'codex' as const,
    detail: 'DX OS 内置 GPT Image 2 Skill helper，复用本机 Codex 登录态。',
    mode: bundled && path === bundled ? 'bundled' as const : 'host' as const,
    home: join(homedir(), '.codex'),
    env: {},
  }
}

function mimeFor(path: string) {
  const ext = extname(path).toLowerCase()
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
}

async function runCodexImage(command: 'generate' | 'edit', prompt: string, model: string, size: string, referencePaths: string[] = []) {
  const rt = gptImageHelperRuntime()
  if (!rt) throw new Error('未找到 gpt-image-2-skill。请先安装 GPT CLI 附带的 Image 2 Skill helper。')
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const out = join(OUTPUT_DIR, `gpt-image-${Date.now()}.png`)
  const auth = join(homedir(), '.codex', 'auth.json')
  const args = ['--json', ...(existsSync(auth) ? ['--auth-file', auth] : []), 'images', command, '--prompt', prompt, '--out', out, '--model', model || 'gpt-image-2', '--size', size || '1024x1024']
  for (const path of referencePaths.slice(0, 16)) args.push('--ref-image', path)
  const result = await run(rt, args, 600000)
  if (result.code !== 0 || !existsSync(out)) throw new Error(`GPT Image 2 生成失败：${(result.stderr || result.stdout || `exit=${result.code}`).slice(0, 1600)}`)
  const image = `data:${mimeFor(out)};base64,${readFileSync(out).toString('base64')}`
  return { images: [image], raw: result }
}

export function generateCodexImage(prompt: string, model = 'gpt-image-2', size = '1024x1024') {
  return runCodexImage('generate', prompt, model, size)
}

export function editCodexImage(prompt: string, referencePaths: string[], model = 'gpt-image-2', size = '1024x1024') {
  if (!referencePaths.length) throw new Error('GPT Image 2 编辑需要至少一张参考图。')
  return runCodexImage('edit', prompt, model, size, referencePaths)
}
