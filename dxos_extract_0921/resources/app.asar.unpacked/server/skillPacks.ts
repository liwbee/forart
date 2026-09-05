import { randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildZip, type ZipEntry } from './zip.ts'
import { importSkillPackage } from './skillImport.ts'
import { deleteCustomSkillsForPack, listSkills, resolveChatTarget, updateCustomSkillDisplay } from './skills.ts'
import { callChat } from './protocols.ts'
import { dataPath } from './dataPaths.ts'

const DATA_DIR = dataPath('skill-packs')
const INDEX_FILE = join(DATA_DIR, 'index.json')
const BUNDLED_STATE_FILE = dataPath('bundled-skill-packs.json')
const BUNDLED_PACKAGE_DIR = process.env.DX_BUNDLED_SKILL_PACKAGES_DIR
  || process.env.DX_BUNDLED_SKILL_PACKS_DIR
  || join(dirname(fileURLToPath(import.meta.url)), 'bundled-skill-packages')
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024
const MAX_UNPACKED_BYTES = 128 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const SANDBOX_IMAGE = process.env.SKILL_SANDBOX_IMAGE || 'fastapi-fastapi-app:latest'
const RUN_DIR = process.env.SKILL_SANDBOX_RUN_DIR || 'C:\\tmp\\ccs-skill-runs'

export interface SkillPackEntryPoint {
  id: string
  runtime: 'python'
  path: string
}
export interface SkillPack {
  id: string
  name: string
  sourceName: string
  importedAt: number
  skillCount: number
  entryPoints: SkillPackEntryPoint[]
}
interface ZipFile { name: string; data: Buffer }

export interface OnlineSkillSource {
  provider: 'ModelScope'
  method: 'npx' | 'modelscope' | 'bash' | 'url'
  collection: string
  sourceUrl: string
  name: string
}

function fail(message: string): never { throw new Error(`Skill 包错误：${message}`) }
function u16(buf: Buffer, offset: number) { return buf.readUInt16LE(offset) }
function u32(buf: Buffer, offset: number) { return buf.readUInt32LE(offset) }
function safePath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) fail(`存在不安全路径：${path}`)
  return normalized
}

/**
 * 识别 ModelScope 页面 URL、npx、ModelScope SDK 与官方 bash 安装命令。
 * 这里只提取 collection，不会执行用户粘贴的 shell。
 */
export function parseOnlineSkillSource(text: string): OnlineSkillSource {
  const raw = String(text || '').trim()
  if (!raw) fail('请粘贴在线 Skill 地址或安装命令')
  if (raw.length > 12_000) fail('导入内容过长')

  const urlMatch = raw.match(/https:\/\/www\.modelscope\.cn\/collections\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)/i)
  const collectionMatch = raw.match(/--collection(?:=|\s+)["']?([a-z0-9_.-]+)\/([a-z0-9_.-]+)/i)
  const owner = urlMatch?.[1] || collectionMatch?.[1]
  const collectionName = urlMatch?.[2] || collectionMatch?.[2]
  if (!owner || !collectionName) {
    fail('无法识别在线 Skill；请粘贴 ModelScope collection 地址、npx、ModelScope SDK 或官方 bash 安装命令')
  }
  const collection = `${owner}/${collectionName}`
  const method: OnlineSkillSource['method'] = /\bnpx\s+skills\s+add\b/i.test(raw)
    ? 'npx'
    : /\bmodelscope\s+download\b/i.test(raw)
      ? 'modelscope'
      : /install\.sh\s*\|\s*bash/i.test(raw)
        ? 'bash'
        : 'url'
  return {
    provider: 'ModelScope',
    method,
    collection,
    sourceUrl: `https://www.modelscope.cn/collections/${collection}`,
    name: collectionName.replace(/[-_]+/g, ' ').trim() || collectionName,
  }
}

function readZip(buffer: Buffer): ZipFile[] {
  if (buffer.length > MAX_PACKAGE_BYTES) fail('压缩包不能超过 32 MB')
  const searchFrom = Math.max(0, buffer.length - 65_557)
  let eocd = -1
  for (let i = buffer.length - 22; i >= searchFrom; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) fail('不是有效的 ZIP 文件')
  const count = u16(buffer, eocd + 10)
  const centralOffset = u32(buffer, eocd + 16)
  if (!count || count > 1024 || centralOffset >= buffer.length) fail('压缩包目录无效')
  const files: ZipFile[] = []
  let total = 0
  let pos = centralOffset
  for (let index = 0; index < count; index++) {
    if (pos + 46 > buffer.length || u32(buffer, pos) !== 0x02014b50) fail('压缩包目录损坏')
    const method = u16(buffer, pos + 10)
    const compressedSize = u32(buffer, pos + 20)
    const uncompressedSize = u32(buffer, pos + 24)
    const filenameSize = u16(buffer, pos + 28)
    const extraSize = u16(buffer, pos + 30)
    const commentSize = u16(buffer, pos + 32)
    const localOffset = u32(buffer, pos + 42)
    const end = pos + 46 + filenameSize + extraSize + commentSize
    if (end > buffer.length) fail('压缩包目录不完整')
    const name = safePath(buffer.subarray(pos + 46, pos + 46 + filenameSize).toString('utf8'))
    pos = end
    if (name.endsWith('/')) continue
    if (uncompressedSize > MAX_FILE_BYTES || compressedSize > MAX_FILE_BYTES) fail(`文件过大：${name}`)
    total += uncompressedSize
    if (total > MAX_UNPACKED_BYTES) fail('解压总内容超过 128 MB 限制')
    if (localOffset + 30 > buffer.length || u32(buffer, localOffset) !== 0x04034b50) fail(`文件头损坏：${name}`)
    const localNameSize = u16(buffer, localOffset + 26)
    const localExtraSize = u16(buffer, localOffset + 28)
    const start = localOffset + 30 + localNameSize + localExtraSize
    const finish = start + compressedSize
    if (finish > buffer.length) fail(`文件不完整：${name}`)
    const raw = buffer.subarray(start, finish)
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_FILE_BYTES }) : fail(`不支持的压缩方式：${name}`)
    files.push({ name, data })
  }
  return files
}

function loadIndex(): SkillPack[] {
  try { return JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as SkillPack[] } catch { return [] }
}
function decodeUploadName(value: string) {
  // 兼容 Multer 将 UTF-8 文件名按 latin1 读取后的常见乱码；正常中文不二次转换。
  if (/[^\x00-\xff]/.test(value)) return value
  const decoded = Buffer.from(value, 'latin1').toString('utf8')
  return decoded.includes('�') ? value : decoded
}
function saveIndex(packs: SkillPack[]) {
  writeJsonAtomic(INDEX_FILE, packs)
}

interface BundledInstallMarker { version: number; startedAt: number }
interface BundledFailureMarker { version: number; failedAt: number; message: string }
interface BundledSkillPackState {
  installed: Record<string, number>
  installing: Record<string, BundledInstallMarker>
  failed: Record<string, BundledFailureMarker>
}
function writeJsonAtomic(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, file)
  } finally {
    try { unlinkSync(temporary) } catch { /* rename succeeded or the temporary file was never created */ }
  }
}
function loadBundledState(): BundledSkillPackState {
  try {
    const value = JSON.parse(readFileSync(BUNDLED_STATE_FILE, 'utf8')) as Partial<BundledSkillPackState>
    return {
      installed: value.installed && typeof value.installed === 'object' ? value.installed : {},
      installing: value.installing && typeof value.installing === 'object' ? value.installing : {},
      failed: value.failed && typeof value.failed === 'object' ? value.failed : {},
    }
  } catch { return { installed: {}, installing: {}, failed: {} } }
}
function saveBundledState(state: BundledSkillPackState) {
  writeJsonAtomic(BUNDLED_STATE_FILE, state)
}
function cleanupBundledStaging(id: string) {
  if (!existsSync(DATA_DIR)) return
  const prefix = `.${id}.`
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(prefix) && entry.name.endsWith('.installing')) {
      rmSync(join(DATA_DIR, entry.name), { recursive: true, force: true })
    }
  }
}
function installBundledZip(packageFile: string, id: string) {
  const files = readZip(readFileSync(packageFile))
  const skillCount = files.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.name)).length
  if (skillCount !== 9) fail(`MiniMax H3 ZIP 中应包含 9 个 Skill，实际为 ${skillCount}`)
  cleanupBundledStaging(id)
  const stagingPackage = join(DATA_DIR, `.${id}.${randomUUID()}.installing`)
  const stagingSource = join(stagingPackage, 'source')
  mkdirSync(stagingSource, { recursive: true })
  try {
    for (const file of files) {
      const target = resolve(stagingSource, file.name)
      if (!target.startsWith(`${stagingSource}${sep}`)) fail(`ZIP 中存在越界路径：${file.name}`)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.data, { flag: 'wx' })
    }
    const installedSkillCount = collectOnlineEntries(stagingSource)
      .filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.name)).length
    if (installedSkillCount !== 9) fail(`MiniMax H3 解压校验失败：${installedSkillCount}`)
    rmSync(packageRoot(id), { recursive: true, force: true })
    renameSync(stagingPackage, packageRoot(id))
    return installedSkillCount
  } catch (error) {
    rmSync(stagingPackage, { recursive: true, force: true })
    throw error
  }
}

/**
 * 首次运行时把发布包内精选的官方 Skill 复制到用户数据目录。
 * 只复制只读发布资源，不携带开发环境的索引、启停状态或运行记录；用户删除后也不会反复恢复。
 */
export function ensureBundledSkillPacks() {
  const specs = [{
    key: 'minimax-h3-skills', version: 1, id: 'official-minimax-h3-skills',
    name: 'MiniMax H3 Skills', sourceName: 'MiniMax H3 Skills（系统预置）', directory: 'minimax-h3-skills',
  }]
  const state = loadBundledState()
  const packs = loadIndex()
  let installed = 0
  for (const spec of specs) {
    if (Number(state.installed[spec.key] || 0) >= spec.version) continue
    // 开发版或旧测试版可能已由用户手动导入同一套 Skill，保留它并避免重复显示。
    const existing = packs.find((pack) => pack.id === spec.id || /^MiniMax H3 Skills$/i.test(pack.name))
    if (existing) {
      state.installed[spec.key] = spec.version
      delete state.installing[spec.key]
      delete state.failed[spec.key]
      continue
    }
    const interrupted = state.installing[spec.key]
    if (interrupted && interrupted.version >= spec.version) {
      // 上次如果是 Windows 原生快速失败，启动阶段不再触碰同一批文件，
      // 避免清理动作本身再次进入相同的原生文件系统崩溃路径。
      state.failed[spec.key] = {
        version: spec.version,
        failedAt: Date.now(),
        message: '上次 ZIP 安装被异常中断；已停止自动重试以保证 DX OS 可以启动',
      }
      delete state.installing[spec.key]
      console.warn(`系统预置 Skill 上次安装被异常中断，已跳过自动重试：${spec.name}`)
      continue
    }
    if (Number(state.failed[spec.key]?.version || 0) >= spec.version) continue
    const bundledPackage = join(BUNDLED_PACKAGE_DIR, `${spec.directory}.zip`)
    if (!existsSync(bundledPackage)) continue
    state.installing[spec.key] = { version: spec.version, startedAt: Date.now() }
    saveBundledState(state)
    try {
      const skillCount = installBundledZip(bundledPackage, spec.id)
      packs.push({ id: spec.id, name: spec.name, sourceName: spec.sourceName, importedAt: Date.now(), skillCount, entryPoints: [] })
      saveIndex(packs)
      state.installed[spec.key] = spec.version
      delete state.installing[spec.key]
      delete state.failed[spec.key]
      saveBundledState(state)
      installed += 1
    } catch (error) {
      cleanupBundledStaging(spec.id)
      state.failed[spec.key] = {
        version: spec.version,
        failedAt: Date.now(),
        message: String(error instanceof Error ? error.message : error).slice(0, 500),
      }
      delete state.installing[spec.key]
      saveBundledState(state)
      console.warn(`系统预置 Skill ZIP 安装失败，DX OS 将继续启动：${state.failed[spec.key].message}`)
    }
  }
  saveBundledState(state)
  return installed
}
function packageRoot(id: string) { return join(DATA_DIR, id) }
function sourceRoot(id: string) { return join(packageRoot(id), 'source') }
function commonTopLevel(files: ZipFile[]) {
  const first = files[0]?.name.split('/')[0]
  return first && files.length && files.every((file) => file.name.startsWith(`${first}/`)) ? `${first}/` : ''
}

export function listSkillPacks() {
  return loadIndex().map((pack) => ({
    ...pack,
    name: decodeUploadName(pack.name),
    sourceName: decodeUploadName(pack.sourceName),
    skillDocs: listPackSkillDocs(pack.id),
  }))
}

export function importSkillPack(buffer: Buffer, sourceName: string): SkillPack {
  const files = readZip(buffer)
  if (!files.length) fail('压缩包为空')
  const id = randomUUID()
  const root = sourceRoot(id)
  const prefix = commonTopLevel(files)
  mkdirSync(root, { recursive: true })
  try {
    for (const file of files) {
      const target = resolve(root, file.name.slice(prefix.length))
      if (!target.startsWith(`${root}${sep}`)) fail('检测到越界写入')
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.data)
    }
  } catch (error) {
    rmSync(packageRoot(id), { recursive: true, force: true })
    throw error
  }
  const entryPoints = files
    .map((file) => file.name.slice(prefix.length))
    .filter((path) => /\.py$/i.test(path))
    .map((path, index) => ({ id: `python_${index + 1}`, runtime: 'python' as const, path }))
  const skillCount = files.filter((file) => /(^|\/)SKILL\.md$/i.test(file.name)).length
  const decodedSourceName = decodeUploadName(sourceName)
  const name = decodedSourceName.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ').trim() || '未命名 Skill 包'
  const pack: SkillPack = { id, name, sourceName: decodedSourceName, importedAt: Date.now(), skillCount, entryPoints }
  saveIndex([...loadIndex(), pack])
  return pack
}

export function onlineInstallerEnvironment(base: NodeJS.ProcessEnv = process.env) {
  const environment = { ...base }
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') || 'PATH'
  const separator = process.platform === 'win32' ? ';' : ':'
  const runtimeDirectory = dirname(process.execPath)
  const currentPath = String(environment[pathKey] || '')
  const entries = currentPath.split(separator).filter(Boolean)
  if (!entries.some((entry) => resolve(entry).toLowerCase() === resolve(runtimeDirectory).toLowerCase())) {
    entries.unshift(runtimeDirectory)
  }
  environment[pathKey] = entries.join(separator)
  return environment
}

function runOnlineInstaller(command: string, args: string[], cwd: string, timeoutMs = 240_000) {
  return new Promise<string>((resolveRun, rejectRun) => {
    // npx 下载后的 Windows .cmd shim 会再次通过裸命令 `node` 启动 JS。
    // 正式版必须把随应用携带的 node.exe 目录放进 PATH，不能依赖系统安装。
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, env: onlineInstallerEnvironment() })
    let output = ''
    const append = (chunk: Buffer) => { if (output.length < 48_000) output += chunk.toString('utf8') }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); rejectRun(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolveRun(output.trim())
      else rejectRun(new Error(output.trim() || `在线安装器退出码：${code ?? 1}`))
    })
  })
}

function containsSkillDoc(root: string): boolean {
  if (!existsSync(root)) return false
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const target = join(root, entry.name)
    if (entry.isDirectory() && containsSkillDoc(target)) return true
    if (entry.isFile() && /^SKILL\.md$/i.test(entry.name)) return true
  }
  return false
}

function collectOnlineEntries(root: string): ZipEntry[] {
  const entries: ZipEntry[] = []
  const walk = (folder: string, relative: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === '.git') continue
      const absolute = join(folder, entry.name)
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(absolute, path)
      else if (entry.isFile()) {
        if (statSync(absolute).size > MAX_FILE_BYTES) fail(`文件过大：${path}`)
        entries.push({ name: path.replace(/\\/g, '/'), data: readFileSync(absolute) })
      }
    }
  }
  walk(root, '')
  return entries
}

/** 把包内每个 SKILL.md 注册成独立 Agent 工具，AI 才能按描述自动选择。 */
export function registerSkillPackRoutes(pack: SkillPack, buffer?: Buffer) {
  if (!pack.skillCount) return []
  const archive = buffer || buildZip(collectOnlineEntries(sourceRoot(pack.id)))
  const idPrefix = `pack_${pack.id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10)}`
  return importSkillPackage(archive, { idPrefix, packId: pack.id, packName: pack.name }).skills
}

export function importRegisteredSkillPack(buffer: Buffer, sourceName: string) {
  const pack = importSkillPack(buffer, sourceName)
  try {
    return { pack, skills: registerSkillPackRoutes(pack, buffer) }
  } catch (error) {
    deleteSkillPack(pack.id)
    throw error
  }
}

/** 启动迁移：为旧版本已导入的完整包补齐 Agent 路由 Skill。 */
export function syncSkillPackRoutes() {
  let registered = 0
  for (const pack of loadIndex()) {
    if (!pack.skillCount || !existsSync(sourceRoot(pack.id))) continue
    registered += registerSkillPackRoutes(pack).length
  }
  return registered
}

/** 安全的一键在线导入：统一用 skills CLI 安装到隔离目录，再进入现有 Skill 包存储。 */
export async function importOnlineSkillPack(text: string) {
  const source = parseOnlineSkillSource(text)
  const workspace = mkdtempSync(join(tmpdir(), 'dx-os-skill-'))
  try {
    // 让 skills CLI 把临时目录视为项目，不写入用户全局 Skill 目录。
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ private: true }), 'utf8')
    const skillArgs = [
      '-y', 'skills', 'add', source.sourceUrl,
      '--agent', 'codex', '--skill', '*', '-y', '--copy', '--full-depth',
    ]
    const windowsNpxCli = [
      join(dirname(process.execPath), 'npm-runtime', 'bin', 'npx-cli.js'),
      join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    ].find(existsSync) || ''
    const executable = process.platform === 'win32' ? process.execPath : 'npx'
    const installerArgs = process.platform === 'win32' ? [windowsNpxCli, ...skillArgs] : skillArgs
    if (process.platform === 'win32' && !existsSync(windowsNpxCli)) fail('未找到 Node.js 自带的 npx')
    await runOnlineInstaller(executable, installerArgs, workspace)

    const roots = [
      join(workspace, '.agents', 'skills'),
      join(workspace, '.codex', 'skills'),
      join(workspace, '.claude', 'skills'),
      join(workspace, '.cursor', 'skills'),
    ]
    const installedRoot = roots.find(containsSkillDoc) || (containsSkillDoc(workspace) ? workspace : '')
    if (!installedRoot) fail('安装完成，但没有发现 SKILL.md')
    const entries = collectOnlineEntries(installedRoot)
    if (!entries.some((entry) => /(^|\/)SKILL\.md$/i.test(entry.name))) fail('安装结果中没有 SKILL.md')
    const archive = buildZip(entries)
    const { pack, skills } = importRegisteredSkillPack(archive, `${source.name}.zip`)
    return { pack, source, skills }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

export function deleteSkillPack(id: string) {
  const packs = loadIndex()
  if (!packs.some((pack) => pack.id === id)) return false
  rmSync(packageRoot(id), { recursive: true, force: true })
  saveIndex(packs.filter((pack) => pack.id !== id))
  deleteCustomSkillsForPack(id)
  return true
}

export function renameSkillPack(id: string, name: string) {
  const packs = loadIndex()
  const pack = packs.find((item) => item.id === id)
  if (!pack) fail('Skill 包不存在')
  const nextName = String(name || '').trim()
  if (!nextName) fail('名称不能为空')
  pack.name = nextName.slice(0, 80)
  saveIndex(packs)
  return pack
}

/** 用当前 LLM 一次性翻译包名及包内 Skill 的显示名称/简介。 */
export async function translateSkillPackDisplay(id: string) {
  const pack = getPack(id)
  const skills = listSkills().filter((skill) => skill.source?.metadata.packId === id)
  if (!skills.length) fail('包内没有可翻译的 Skill')
  const { provider, model } = resolveChatTarget({})
  const payload = {
    packName: pack.name,
    skills: skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description.slice(0, 500) })),
  }
  const result = await callChat(provider, model, {
    system: '你是软件界面本地化翻译器。把包名、Skill 名称和简介翻译成简体中文；保留 MiniMax、H3、API、JSAPI、POI、Python 等产品名和技术缩写。只返回严格 JSON，不要 Markdown。JSON 结构必须与输入一致，id 原样保留。',
    prompt: JSON.stringify(payload),
  }, {}, 120_000)
  const start = result.text.indexOf('{')
  const end = result.text.lastIndexOf('}')
  if (start < 0 || end <= start) fail('翻译模型未返回有效 JSON')
  let parsed: { packName?: unknown; skills?: Array<{ id?: unknown; name?: unknown; description?: unknown }> }
  try { parsed = JSON.parse(result.text.slice(start, end + 1)) as typeof parsed } catch { fail('翻译结果解析失败') }
  if (typeof parsed.packName === 'string' && parsed.packName.trim()) renameSkillPack(id, parsed.packName)
  const allowedIds = new Set(skills.map((skill) => skill.id))
  for (const item of Array.isArray(parsed.skills) ? parsed.skills : []) {
    const skillId = String(item.id || '')
    if (!allowedIds.has(skillId) || typeof item.name !== 'string') continue
    updateCustomSkillDisplay(skillId, item.name, typeof item.description === 'string' ? item.description : undefined)
  }
  return {
    pack: getPack(id),
    skills: listSkills().filter((skill) => skill.source?.metadata.packId === id),
    model,
  }
}

function getPack(id: string) {
  const pack = loadIndex().find((item) => item.id === id)
  if (!pack) fail('Skill 包不存在')
  return pack
}

function dockerRun(args: string[], timeoutMs = 120_000) {
  return new Promise<{ code: number; output: string }>((resolveRun, rejectRun) => {
    const child = spawn('docker', args, { windowsHide: true })
    let output = ''
    const append = (chunk: Buffer) => { if (output.length < 64_000) output += chunk.toString('utf8') }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.once('error', rejectRun)
    child.once('close', (code) => { clearTimeout(timer); resolveRun({ code: code ?? 1, output: output.trim() }) })
  })
}

/** 仅执行导入包中已发现的 Python 文件；容器不联网，且只挂载当前包的运行副本。 */
export async function runSkillPack(id: string, entryPointId: string, args: string[]) {
  const pack = getPack(id)
  const entry = pack.entryPoints.find((item) => item.id === entryPointId)
  if (!entry) fail('未找到可运行入口')
  const source = sourceRoot(id)
  const runId = randomUUID()
  // Docker Desktop 在部分 Windows 配置中无法直接挂载桌面目录；运行副本放在可共享的临时根目录。
  const workspace = join(RUN_DIR, id, runId)
  mkdirSync(dirname(workspace), { recursive: true })
  cpSync(source, workspace, { recursive: true, dereference: false })
  const sourcePath = resolve(workspace, entry.path)
  if (!sourcePath.startsWith(`${workspace}${sep}`) || !existsSync(sourcePath)) fail('入口文件不存在')
  const cleanArgs = args.map(String).filter((arg) => arg.length <= 500 && !arg.includes('\0')).slice(0, 32)
  const result = await dockerRun([
    'run', '--rm', '--network', 'none', '--read-only', '--pids-limit', '64', '--memory', '512m', '--cpus', '1',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
    '-v', `${workspace}:/workspace:rw`, '--workdir', '/workspace', '--entrypoint', 'python', SANDBOX_IMAGE,
    entry.path, ...cleanArgs,
  ])
  return { runId, exitCode: result.code, output: result.output, workspace: `runs/${runId}` }
}

/** 入口 --help 输出（沙箱内跑一次，进程内缓存），给 Agent 生成参数用。 */
const helpCache = new Map<string, string>()
export async function entryPointHelp(id: string, entryPointId: string) {
  const key = `${id}:${entryPointId}`
  const cached = helpCache.get(key)
  if (cached) return cached
  const result = await runSkillPack(id, entryPointId, ['--help'])
  const help = (result.output || '').slice(0, 8_000)
  if (help) helpCache.set(key, help)
  return help
}

/** 包内的 SKILL.md 文档列表与内容（给 Agent 解析成可 / 调用的 Skill）。 */
export function listPackSkillDocs(id: string) {
  const pack = getPack(id)
  const root = sourceRoot(pack.id)
  const docs: Array<{ path: string; preview: string }> = []
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, relPath)
      else if (/^SKILL\.md$/i.test(entry.name)) {
        const text = readFileSync(abs, 'utf8')
        const description = text.match(/(?:^|\n)description:\s*([^\r\n]+)/i)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
        docs.push({ path: relPath, preview: description?.slice(0, 120) || relPath })
      }
    }
  }
  walk(root, '')
  return docs.slice(0, 24)
}

export function readPackSkillDoc(id: string, docPath: string) {
  const pack = getPack(id)
  const target = resolve(sourceRoot(pack.id), docPath.replace(/\\/g, '/'))
  if (!target.startsWith(`${sourceRoot(pack.id)}${sep}`) || !/SKILL\.md$/i.test(target) || !existsSync(target)) fail('文档不存在')
  return readFileSync(target, 'utf8')
}

/** 为无代码 Skill 的 AI 测试构造完整上下文：SKILL.md + 同目录文本资源。 */
export function buildPackSkillContext(root: string, docPath: string) {
  const normalized = docPath.replace(/\\/g, '/')
  const target = resolve(root, normalized)
  if (!target.startsWith(`${root}${sep}`) || !/^SKILL\.md$/i.test(target.split(/[\\/]/).at(-1) || '') || !existsSync(target)) {
    fail('文档不存在')
  }
  const skillText = readFileSync(target, 'utf8')
  const dir = dirname(target)
  const mentioned = new Set(
    [...skillText.matchAll(/(?:references|assets)\/[A-Za-z0-9._/-]+/g)].map((match) => match[0].replace(/[),.;:'"`]+$/, '')),
  )
  const resources: Array<{ path: string; content: string }> = []
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const abs = join(folder, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (abs !== target && /\.(md|txt|ya?ml|json)$/i.test(entry.name)) {
        const relative = abs.slice(dir.length + 1).replace(/\\/g, '/')
        resources.push({ path: relative, content: readFileSync(abs, 'utf8') })
      }
    }
  }
  walk(dir)
  resources.sort((a, b) => Number(mentioned.has(b.path)) - Number(mentioned.has(a.path)) || a.path.localeCompare(b.path))
  let used = skillText.length
  const included: typeof resources = []
  for (const resource of resources) {
    if (used + resource.content.length > 64_000) continue
    included.push(resource)
    used += resource.content.length
  }
  return {
    sourcePath: normalized,
    instructions: skillText,
    resources: included,
    context: [
      skillText,
      ...included.map((resource) => `\n\n===== Skill resource: ${resource.path} =====\n${resource.content}`),
    ].join(''),
  }
}

export function readPackSkillContext(id: string, docPath?: string) {
  const pack = getPack(id)
  const docs = listPackSkillDocs(id)
  const selected = docPath || (docs.length === 1 ? docs[0].path : '')
  if (!selected) fail(docs.length ? '请选择要测试的 Skill' : '包内没有 SKILL.md')
  if (!docs.some((doc) => doc.path === selected)) fail('文档不存在')
  return buildPackSkillContext(sourceRoot(pack.id), selected)
}
