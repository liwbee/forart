// ══════════════════════════════════════════════════════════════════════
// 夸克网盘 App —— 以子进程驱动官方 quark-drive CLI。
// CLI 厂商锁定在 server/vendor/quark-drive.cjs（1.0.11），stdout 输出
// NDJSON（每行 {code,msg,action,type:'result'|'list'|'progress'|'artifact',data}）。
// 登录态由 CLI 自行管理：凭据自举自 open-api-drive.quark.cn，token 持久化在
// ~/.quark-drive/config.json（与即梦/钉钉 MCP 子进程同类，见 server/cliTools.ts）。
// ══════════════════════════════════════════════════════════════════════
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'

const ROOT = dirname(fileURLToPath(import.meta.url))
const CLI = join(ROOT, 'vendor', 'quark-drive.cjs')
const WORK_DIR = dataPath('quark')
// Downloads are short-lived response staging files, not persistent app data.
// Keeping them below DATA_ROOT makes development sandboxes fail with EPERM once
// the independent data directory moves outside the workspace. The OS temp root
// is writable in both packaged production and restricted development runtimes.
const DOWNLOAD_DIR = join(tmpdir(), 'DXOS', 'quark-downloads')
const MAX_OUTPUT = 8 * 1024 * 1024
// CLI 运行时根目录（即梦模式，见 cliTools.ts CLI_HOME_DIR）：全部凭据/设备ID/
// 搜索缓存都落在项目 data 目录下，不碰电脑真实 home，也不进仓库。
// vendor/quark-drive.cjs 的 Di 已 patch 为优先使用 QUARK_DRIVE_HOME。
const CLI_HOME = join(WORK_DIR, 'cli-home')
// fe() 被 patch 为未知 Agent 环境时回退 "claudecode"（见 vendor/quark-drive.cjs），
// 因此配置固定落在 cli-home/claudecode/config.json。
const CLI_CONFIG_FILE = join(CLI_HOME, 'claudecode', 'config.json')
const SEARCH_HISTORY_FILE = join(WORK_DIR, 'search-history.json')

export interface QuarkFile {
  fid: string
  filename: string
  size?: number
  includeItems?: number
  category?: number
  objCategory?: string
  updatedAt?: number
  bigThumbnail?: string
  pdirFid?: string
  isDir: boolean
  checkLink?: string
}

interface NdjsonRow {
  code?: number
  msg?: string
  action?: string
  type?: string
  data?: Record<string, unknown>
}

interface RunResult {
  rows: NdjsonRow[]
  exitCode: number
  stdout: string
  stderr: string
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readSearchHistoryStore(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(readFileSync(SEARCH_HISTORY_FILE, 'utf8')) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).map(([userId, entries]) => [userId, Array.isArray(entries) ? entries.map(String).filter(Boolean).slice(0, 12) : []]))
  } catch { return {} }
}

function writeSearchHistoryStore(store: Record<string, string[]>) {
  ensureDir(WORK_DIR)
  writeFileSync(SEARCH_HISTORY_FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

export function quarkSearchHistory(userId: string) {
  return readSearchHistoryStore()[userId] || []
}

export function quarkRecordSearch(userId: string, query: string) {
  const value = String(query || '').trim().slice(0, 80)
  if (!value) return quarkSearchHistory(userId)
  const store = readSearchHistoryStore()
  store[userId] = [value, ...(store[userId] || []).filter((item) => item !== value)].slice(0, 12)
  writeSearchHistoryStore(store)
  return store[userId]
}

export function quarkClearSearchHistory(userId: string) {
  const store = readSearchHistoryStore()
  delete store[userId]
  writeSearchHistoryStore(store)
}

/** 受控 CLI 环境（即梦模式，见 cliTools.ts:234-243）：把 HOME/APPDATA 等全部
 *  重定向到项目 data 目录，并给出 QUARK_DRIVE_HOME 供 patch 后的 Di 使用，
 *  使 CLI 完全内置在我们的软件环境里、不依赖电脑环境。 */
function quarkCliEnv(): NodeJS.ProcessEnv {
  const home = join(WORK_DIR, 'home')
  return {
    ...process.env,
    // 凭据统一保存在 cli-home/claudecode；不能让启动 API 的宿主环境
    // （例如 Codex 开发终端）把同一应用误判成另一套 agent 配置目录。
    CLAUDECODE: '1',
    QUARK_DRIVE_HOME: CLI_HOME,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(WORK_DIR, 'appdata'),
    LOCALAPPDATA: join(WORK_DIR, 'localappdata'),
    XDG_CONFIG_HOME: join(WORK_DIR, 'config'),
    XDG_CACHE_HOME: join(WORK_DIR, 'cache'),
    XDG_DATA_HOME: join(WORK_DIR, 'data'),
  }
}

/** 逐行解析 CLI stdout 中的 NDJSON；忽略引导/进度噪音行。 */
function parseRows(stdout: string): NdjsonRow[] {
  const rows: NdjsonRow[] = []
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    try {
      const obj = JSON.parse(text)
      if (obj && typeof obj === 'object') rows.push(obj as NdjsonRow)
    } catch { /* 非 JSON 行跳过 */ }
  }
  return rows
}

/** 最后一行 type:'result'（CLI 约定：命令终态）。 */
function lastResult(rows: NdjsonRow[]) {
  return [...rows].reverse().find((row) => row.type === 'result') || null
}

/** 结果行为错误（code≠0）或裸失败（无输出且退出码非 0）时抛错。 */
function throwIfError(rows: NdjsonRow[], exitCode: number, stderr: string) {
  const result = lastResult(rows)
  if (result && typeof result.code === 'number' && result.code !== 0) {
    throw new Error(`${result.msg || '夸克网盘操作失败'}${result.code ? `（错误码 ${result.code}）` : ''}`)
  }
  if (!rows.length && exitCode !== 0) {
    throw new Error((stderr.trim() || `命令失败（exit ${exitCode}）`).slice(0, 600))
  }
}

function runQuark(args: string[], opts: { timeoutMs?: number; cwd?: string } = {}): Promise<RunResult> {
  const { timeoutMs = 120_000, cwd = WORK_DIR } = opts
  ensureDir(cwd)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, windowsHide: true, env: quarkCliEnv() })
    let stdout = ''
    let stderr = ''
    let done = false
    child.stdout.on('data', (chunk) => { if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { if (stderr.length < 256_000) stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill() } catch { /* ignore */ }
      reject(new Error(`夸克网盘操作超时（${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)
    child.once('error', (error) => { if (!done) { done = true; clearTimeout(timer); reject(error) } })
    child.once('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ rows: parseRows(stdout), exitCode: code ?? 1, stdout, stderr })
    })
  })
}

/** 归一化 BrowseFileItem → QuarkFile（search / browse 同源字段）。 */
function normalizeFile(raw: Record<string, unknown>): QuarkFile {
  const category = Number(raw.category ?? raw.obj_category ?? -1)
  const includeItems = Number(raw.includeItems ?? raw.include_items ?? 0)
  const isDir =
    raw.dir === true ||
    raw.is_dir === true ||
    raw.f_type === 0 ||
    category === 0 ||
    String(raw.obj_category ?? '') === '文件夹'
  return {
    fid: String(raw.fid ?? raw.file_id ?? raw.fileId ?? raw.id ?? ''),
    filename: String(raw.filename ?? raw.file_name ?? raw.name ?? '未命名'),
    size: raw.size != null ? Number(raw.size) : undefined,
    includeItems: includeItems > 0 ? includeItems : undefined,
    category: Number.isFinite(category) && category >= 0 ? category : undefined,
    objCategory: raw.obj_category ? String(raw.obj_category) : undefined,
    updatedAt: raw.updated_at != null ? Number(raw.updated_at) : undefined,
    bigThumbnail: raw.big_thumbnail ? String(raw.big_thumbnail) : undefined,
    pdirFid: raw.pdir_fid != null ? String(raw.pdir_fid) : undefined,
    isDir,
    checkLink: raw.check_link ? String(raw.check_link) : undefined,
  }
}

/** CLI 自己的 config.json 是否已含账号（token 兜底，见 server/cliTools.ts 的 token 快照模式）。 */
function cliHasAccount(): boolean {
  try {
    const config = JSON.parse(readFileSync(CLI_CONFIG_FILE, 'utf8')) as Record<string, unknown>
    if (typeof config.currentUserId === 'string' && config.currentUserId) return true
    if (config.accounts && typeof config.accounts === 'object' && Object.keys(config.accounts as object).length > 0) return true
    if (typeof config.access_token === 'string' && config.access_token) return true
    return false
  } catch {
    return false
  }
}

// ── 登录态（即梦模式：spawn login → 轮询 get-user-info，见 cliTools.ts:438-489） ──
let loginProc: ChildProcess | null = null
let loginAuthUrl = ''
let loginLastExit: { code: number | null; signal: string | null; stderr: string; at: string } | null = null
const LOGIN_DEBUG = join(WORK_DIR, 'login-debug.log')

function logLoginDebug(line: string) {
  try {
    ensureDir(WORK_DIR)
    if (!existsSync(LOGIN_DEBUG) || statSync(LOGIN_DEBUG).size > 1024 * 1024) rmSync(LOGIN_DEBUG, { force: true })
    appendFileSync(LOGIN_DEBUG, `[${new Date().toISOString()}] ${line}\n`)
  } catch { /* ignore */ }
}

/**
 * 启动登录：以 --verbose 派生 CLI，从追踪日志中提取授权页 URL 交给前端打开
 * （浏览器打开改由前端 window.open 完成，保证落在用户可见的浏览器会话中；
 * 厂商 CLI 的本地 `start` 已被 patch 为 no-op，见 vendor/quark-drive.cjs 的 nS）。
 */
export function quarkStartLogin() {
  if (loginProc && loginProc.exitCode == null) return { started: true, alreadyRunning: true }
  ensureDir(WORK_DIR)
  loginAuthUrl = ''
  loginLastExit = null
  const child = spawn(process.execPath, [CLI, 'login', '--verbose'], {
    cwd: WORK_DIR,
    windowsHide: true,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: quarkCliEnv(),
  })
  child.unref()
  logLoginDebug(`spawned pid=${child.pid} exe=${process.execPath} cli=${CLI}`)
  let stderrBuf = ''
  child.stderr?.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8')
    if (stderrBuf.length > 512_000) stderrBuf = stderrBuf.slice(-64_000)
    if (!loginAuthUrl) {
      const m = stderrBuf.match(/"authorize_page_url":"([^"]+)"/)
      if (m?.[1]) loginAuthUrl = m[1]
    }
  })
  child.on('error', (error) => {
    loginLastExit = { code: null, signal: null, stderr: `spawn error: ${(error as Error).message}`, at: new Date().toISOString() }
    logLoginDebug(`child ERROR: ${(error as Error).message}`)
  })
  child.on('exit', (code, signal) => {
    loginLastExit = { code, signal, stderr: stderrBuf.slice(-1200), at: new Date().toISOString() }
    logLoginDebug(`child EXIT code=${code} signal=${signal} stderr=${JSON.stringify(stderrBuf.slice(-400))}`)
  })
  loginProc = child
  return { started: true }
}

export function quarkStopLogin() {
  if (loginProc && loginProc.exitCode == null) {
    try { loginProc.kill() } catch { /* ignore */ }
  }
  loginProc = null
  loginAuthUrl = ''
}

export async function quarkStatus(): Promise<{ loggedIn: boolean; user?: { nickname?: string; userId?: string }; error?: string; authUrl?: string; loginPending?: boolean; loginPid?: number; loginExit?: { code: number | null; signal: string | null; stderr: string; at: string } | null }> {
  const pending = !!(loginProc && loginProc.exitCode == null)
  try {
    const { rows } = await runQuark(['get-user-info'], { timeoutMs: 30_000 })
    const result = lastResult(rows)
    if (result && result.code === 0) {
      const data = (result.data || {}) as Record<string, unknown>
      const info = (data.userInfo || {}) as Record<string, unknown>
      const user = {
        nickname: String(info.nickname ?? data.nickname ?? data.user_name ?? data.userName ?? data.name ?? ''),
        userId: String(info.userId ?? info.user_id ?? data.userId ?? data.user_id ?? ''),
      }
      if (pending) quarkStopLogin()
      loginAuthUrl = ''
      return { loggedIn: true, user }
    }
    if (cliHasAccount()) return { loggedIn: true, user: {}, authUrl: loginAuthUrl || undefined }
    return { loggedIn: false, loginPending: pending, authUrl: loginAuthUrl || undefined, loginPid: loginProc?.pid, loginExit: loginLastExit }
  } catch (error) {
    if (cliHasAccount()) return { loggedIn: true, user: {} }
    return { loggedIn: false, error: String((error as Error).message || error), loginPending: pending, authUrl: loginAuthUrl || undefined, loginPid: loginProc?.pid, loginExit: loginLastExit }
  }
}

// ── 搜索 ──
export async function quarkSearch(q: string, category?: number): Promise<{ files: QuarkFile[]; total: number; checkAllLink?: string }> {
  const keyword = String(q || '').trim().slice(0, 50)
  if (!keyword) throw new Error('请输入搜索关键词')
  const args = ['search', '--keyword', keyword, '--size', '100', '--stdout-only']
  if (category != null && Number.isInteger(category) && category >= 0 && category <= 8) {
    args.push('--category', String(category))
  }
  const { rows, exitCode, stderr } = await runQuark(args, { timeoutMs: 60_000 })
  throwIfError(rows, exitCode, stderr)

  const result = lastResult(rows)
  const data = (result?.data || {}) as Record<string, unknown>
  let files: QuarkFile[] = []
  if (Array.isArray(data.file_list)) files = (data.file_list as Record<string, unknown>[]).map(normalizeFile)
  files = files.concat(rows.filter((row) => row.type === 'list').map((row) => row.data).filter((d): d is Record<string, unknown> => !!d).map(normalizeFile))

  // 完整结果在 artifact jsonl（stdout 的 file_list 最多 5 条预览），读取全量 FID。
  const artifact = rows.find((row) => row.type === 'artifact')
  const artifactPath = artifact?.data?.file_path
  if (artifactPath && typeof artifactPath === 'string' && existsSync(artifactPath)) {
    try {
      const all = readFileSync(artifactPath, 'utf8')
        .split(/\r?\n/).filter(Boolean)
        .map((line) => { try { return normalizeFile(JSON.parse(line)) } catch { return null } })
        .filter((item): item is QuarkFile => !!item)
      if (all.length) files = all
    } catch { /* 读 artifact 失败则沿用预览 */ }
  }
  const total = Number(data.total ?? (artifact?.data?.count ?? files.length))
  return { files, total, checkAllLink: data.check_all_link ? String(data.check_all_link) : undefined }
}

// ── 目录浏览（隐藏命令，模块加载失败时降级为 search 模式） ──
export async function quarkBrowse(pdirFid = '0'): Promise<{ mode: 'browse'; files: QuarkFile[] } | { mode: 'search'; unsupported: true; files: [] }> {
  try {
    const { rows, exitCode, stderr } = await runQuark(['browse', '--pdir-fid', String(pdirFid)], { timeoutMs: 60_000 })
    throwIfError(rows, exitCode, stderr)
    const files = rows.filter((row) => row.type === 'list').map((row) => row.data).filter((d): d is Record<string, unknown> => !!d).map(normalizeFile)
    return { mode: 'browse', files }
  } catch (error) {
    const msg = String((error as Error).message || error)
    // 文件浏览器模块未加载 / 命令未注册 → 前端自动落回搜索视图。
    if (/browse|浏览器实例|不存在|Unknown command|unknown command|unrecognized|not found/i.test(msg)) {
      return { mode: 'search', unsupported: true, files: [] }
    }
    throw error
  }
}

// ── 下载：整文件落盘后返回文件路径（路由层 sendFile，仿 comfy 代理模式） ──
export async function quarkDownload(fid: string, outDir: string): Promise<string> {
  ensureDir(outDir)
  const { rows, exitCode, stderr } = await runQuark(
    ['download', '--fid', String(fid), '--output-dir', outDir, '--overwrite'],
    { timeoutMs: 5 * 60_000 },
  )
  throwIfError(rows, exitCode, stderr)
  // 落盘路径以目录中最新文件为准（CLI 可能输出到 result/artifact，兜底取 mtime 最新）。
  const entries = readdirSync(outDir).map((name) => {
    const abs = join(outDir, name)
    return { name, abs, mtime: statSync(abs).mtimeMs }
  })
  entries.sort((a, b) => b.mtime - a.mtime)
  const newest = entries[0]
  if (!newest) throw new Error('下载完成但未找到输出文件')
  return newest.abs
}

// ── 上传 ──
export async function quarkUpload(parentFid: string | undefined, filePath: string) {
  const args = ['upload', filePath]
  if (parentFid != null && String(parentFid).trim() !== '' && String(parentFid) !== '0') {
    args.push('--parent-fid', String(parentFid).trim())
  }
  const { rows, exitCode, stderr } = await runQuark(args, { timeoutMs: 10 * 60_000 })
  throwIfError(rows, exitCode, stderr)
  const result = lastResult(rows)
  const data = (result?.data || {}) as Record<string, unknown>
  return {
    fids: Array.isArray(data.fids) ? (data.fids as string[]) : [],
    fileNames: Array.isArray(data.fileNames) ? (data.fileNames as string[]) : [],
    successCount: Number(data.successCount ?? 0),
    fileCount: Number(data.fileCount ?? 0),
  }
}

// ── 登出 ──
export async function quarkLogout() {
  quarkStopLogin()
  try {
    const { rows, exitCode, stderr } = await runQuark(['unauthorize'], { timeoutMs: 30_000 })
    throwIfError(rows, exitCode, stderr)
  } catch { /* 已失效时忽略 */ }
}

/** 供路由使用的路径常量。 */
export const quarkPaths = { workDir: WORK_DIR, downloadDir: DOWNLOAD_DIR }

/** 清理下载临时产物（保留最近 N 分钟），避免磁盘膨胀。 */
export function quarkCleanDownloads(olderThanMs = 24 * 60 * 60 * 1000) {
  try {
    if (!existsSync(DOWNLOAD_DIR)) return
    const now = Date.now()
    for (const name of readdirSync(DOWNLOAD_DIR)) {
      const abs = join(DOWNLOAD_DIR, name)
      try { if (statSync(abs).mtimeMs < now - olderThanMs) rmSync(abs, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
