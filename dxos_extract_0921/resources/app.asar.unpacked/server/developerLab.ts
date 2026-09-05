import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'
import { buildZip } from './zip.ts'
import { autoDeveloperIcon, normalizeDeveloperIcon, type DeveloperIcon } from './developerIcon.ts'
import { isValidSemver } from '../shared/appLifecycle.ts'

const LAB_DIR = dataPath('developer-lab')
const MAX_FILES = 80
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
// AI responses carry UTF-8 source strings. Binary assets must be added later through
// the regular ZIP importer instead of being silently corrupted in the lab.
const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.txt', '.md', '.svg'])

export interface DeveloperLabFile { path: string; content: string }
export interface DeveloperLabCheck { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface DeveloperLabDraft {
  id: string
  ownerId?: string
  previewToken?: string
  name: string
  appId: string
  summary: string
  files: Array<{ path: string; bytes: number }>
  checks: DeveloperLabCheck[]
  createdAt: number
  previewUrl: string
  downloadUrl: string
  icon?: DeveloperIcon
}

function safePath(value: string) {
  const path = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = path.split('/')
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`不安全文件路径：${value}`)
  if (!ALLOWED_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error(`开发者实验室不支持该文件类型：${path}`)
  return path
}

function draftRoot(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('开发草稿 ID 无效')
  return join(LAB_DIR, id)
}

function readDraftFiles(id: string): DeveloperLabFile[] {
  const root = draftRoot(id)
  const meta = JSON.parse(readFileSync(join(root, 'draft.json'), 'utf8')) as { paths: string[] }
  return meta.paths.map((path) => ({ path, content: readFileSync(join(root, 'files', ...path.split('/')), 'utf8') }))
}

function analyze(files: DeveloperLabFile[], manifest: Record<string, unknown>): DeveloperLabCheck[] {
  const combined = files.map((file) => file.content).join('\n')
  const appId = String(manifest.id || '')
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.map(String) : []
  const usesRealtime = combined.includes('realtime.room.')
  const usesCollab = combined.includes('collab.project.')
  const themeListener = combined.includes('system.context') && /dataset\.theme|setAttribute\(['"]data-theme|classList\.(?:add|toggle)\(['"]theme-dark/.test(combined)
  const themeStyles = /\[data-theme=["']?dark|\.theme-dark|prefers-color-scheme\s*:\s*dark/.test(combined)
  const localizedText = combined.includes('interfaceLocale') && combined.includes('zh-CN') && combined.includes('en-US')
  const unsafePath = /(?:[A-Za-z]:\\|file:\/\/|\.\.\/)/.test(combined)
  const hiddenProjectPath = /\b\w*(?:dir|path)\w*\s*=\s*["']\.[^./]/i.test(combined)
  const unsafeParentAccess = /window\.parent\.(?!postMessage\b)[A-Za-z_$]/.test(combined)
  const manifestProblems = [
    manifest.format !== 'dx-app/v2' ? 'format 必须是 dx-app/v2' : '',
    !isValidSemver(manifest.version) ? 'version 必须是 SemVer，例如 1.0.0' : '',
    !Number.isSafeInteger(Number(manifest.build)) || Number(manifest.build) < 1 ? 'build 必须是大于 0 的整数' : '',
    !isValidSemver(manifest.minSystemVersion) ? 'minSystemVersion 必须是 SemVer' : '',
    String(manifest.name || '').trim().length < 2 ? '应用名称至少 2 个字符' : '',
    String(manifest.description || '').trim().length < 8 ? 'description 至少 8 个字符' : '',
    usesRealtime && !permissions.includes(`app.${appId}.realtime.room`) ? `使用 realtime.room.* 必须声明 app.${appId}.realtime.room` : '',
    usesCollab && !permissions.includes(`app.${appId}.collab.project`) ? `使用 collab.project.* 必须声明 app.${appId}.collab.project` : '',
  ].filter(Boolean)
  const checks: DeveloperLabCheck[] = [
    { id: 'manifest', label: '应用清单', status: manifestProblems.length ? 'fail' : 'pass', detail: manifestProblems.length ? manifestProblems.join('；') : 'dx-app/v2 清单有效' },
    { id: 'entry', label: '入口文件', status: files.some((file) => file.path === String(manifest.entry || 'index.html')) ? 'pass' : 'fail', detail: `入口：${String(manifest.entry || 'index.html')}` },
    { id: 'theme', label: '主题同步', status: themeListener && themeStyles ? 'pass' : 'warn', detail: themeListener && themeStyles ? '源码会应用 DX OS light/dark 上下文' : '建议监听 system.context、设置 data-theme，并提供深色主题 CSS；运行时兼容桥会提供基础适配' },
    { id: 'context', label: '主动上下文', status: combined.includes('system.getContext') ? 'pass' : 'warn', detail: combined.includes('system.getContext') ? '支持主动读取系统上下文' : '建议通过 system.getContext 获取初始设置；运行时兼容桥会主动请求' },
    { id: 'language', label: '语言同步', status: localizedText ? 'pass' : 'warn', detail: localizedText ? '包含 zh-CN/en-US 文案并消费 interfaceLocale' : '建议使用 interfaceLocale 切换至少 zh-CN/en-US 两套可见文案' },
    { id: 'storage', label: '项目存储', status: /localStorage|indexedDB/.test(combined) && !/project\.(write|read|list)/.test(combined) ? 'warn' : 'pass', detail: /localStorage|indexedDB/.test(combined) && !/project\.(write|read|list)/.test(combined) ? '检测到浏览器存储；不能用作项目主数据源' : '未发现项目主数据依赖浏览器存储' },
    { id: 'sandbox', label: '沙箱兼容', status: unsafeParentAccess ? 'fail' : 'pass', detail: unsafeParentAccess ? '不能读取 window.parent 的属性；跨域沙箱只允许 parent.postMessage' : '未发现跨域父窗口属性访问' },
    { id: 'paths', label: '路径安全', status: unsafePath || hiddenProjectPath ? 'fail' : 'pass', detail: unsafePath ? '发现绝对路径或越界路径' : hiddenProjectPath ? '项目存储路径不能以点号开头；请使用普通 APP 子目录' : '未发现本机绝对路径、越界引用或隐藏项目目录' },
  ]
  return checks
}

export function createDeveloperLabDraft(input: { files: DeveloperLabFile[]; summary?: string; ownerId: string }): DeveloperLabDraft {
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > MAX_FILES) throw new Error(`文件数量必须为 1–${MAX_FILES}`)
  const unique = new Map<string, DeveloperLabFile>()
  let total = 0
  for (const item of input.files) {
    const path = safePath(item.path)
    if (unique.has(path)) throw new Error(`存在重复文件路径：${path}`)
    const content = String(item.content ?? '')
    total += Buffer.byteLength(content, 'utf8')
    if (total > MAX_TOTAL_BYTES) throw new Error('开发草稿不能超过 8 MB')
    unique.set(path, { path, content })
  }
  const files = [...unique.values()]
  const manifestFile = files.find((file) => file.path === 'dx-app.json')
  if (!manifestFile) throw new Error('AI 结果缺少 dx-app.json')
  let manifest: Record<string, unknown>
  try { manifest = JSON.parse(manifestFile.content) as Record<string, unknown> } catch { throw new Error('dx-app.json 不是有效 JSON') }
  const appId = String(manifest.id || '').trim()
  const name = String(manifest.name || '').trim()
  if (!/^[a-z][a-z0-9-]{2,42}$/.test(appId)) throw new Error('dx-app.json.id 必须使用英文小写、数字和短横线')
  if (!name) throw new Error('dx-app.json.name 不能为空')
  const entry = String(manifest.entry || 'index.html')
  if (!files.some((file) => file.path === entry)) throw new Error(`缺少入口文件：${entry}`)
  const id = randomUUID()
  const root = draftRoot(id)
  for (const file of files) {
    const target = resolve(root, 'files', ...file.path.split('/'))
    const base = join(root, 'files')
    if (!target.startsWith(`${base}${sep}`)) throw new Error('文件路径越界')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content, 'utf8')
  }
  const checks = analyze(files, manifest)
  const icon = normalizeDeveloperIcon(manifest.icon, false)
  const previewToken = randomUUID()
  const draft: DeveloperLabDraft = {
    id, ownerId: String(input.ownerId), previewToken,
    name: name.slice(0, 80), appId, summary: String(input.summary || '').slice(0, 500),
    files: files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content, 'utf8') })), checks,
    createdAt: Date.now(), previewUrl: `/api/market/developer-lab/${id}/preview/${previewToken}/${entry}`, downloadUrl: `/api/market/developer-lab/${id}/download`, icon,
  }
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'draft.json'), JSON.stringify({ ...draft, paths: files.map((file) => file.path) }, null, 2), 'utf8')
  return draft
}

export function getDeveloperLabDraft(id: string): DeveloperLabDraft {
  const root = draftRoot(id)
  const metaPath = join(root, 'draft.json')
  const data = JSON.parse(readFileSync(metaPath, 'utf8')) as DeveloperLabDraft & { paths?: string[] }
  try {
    const files = readDraftFiles(id)
    const manifest = JSON.parse(files.find((file) => file.path === 'dx-app.json')?.content || '{}') as Record<string, unknown>
    const entry = String(manifest.entry || 'index.html')
    data.previewToken = data.previewToken || randomUUID()
    data.previewUrl = `/api/market/developer-lab/${id}/preview/${data.previewToken}/${entry}`
    data.checks = analyze(files, manifest)
    data.icon = normalizeDeveloperIcon(manifest.icon, false)
    writeFileSync(metaPath, JSON.stringify({ ...data, paths: data.paths || files.map((file) => file.path) }, null, 2), 'utf8')
  } catch { /* 读取接口仍返回原始草稿，具体文件错误由编辑/安装流程报告 */ }
  return data
}

export function listDeveloperLabDrafts(): DeveloperLabDraft[] {
  if (!existsSync(LAB_DIR)) return []
  const drafts: DeveloperLabDraft[] = []
  for (const id of readdirSync(LAB_DIR)) {
    try { drafts.push(getDeveloperLabDraft(id)) } catch { /* ignore incomplete drafts */ }
  }
  return drafts.sort((a, b) => b.createdAt - a.createdAt)
}

export function setDeveloperLabDraftOwner(id: string, ownerId: string) {
  const root = draftRoot(id)
  const metaPath = join(root, 'draft.json')
  const data = JSON.parse(readFileSync(metaPath, 'utf8')) as DeveloperLabDraft & { paths?: string[] }
  if (data.ownerId && data.ownerId !== ownerId) throw new Error('开发项目属于其他账户')
  data.ownerId = ownerId
  writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf8')
  return getDeveloperLabDraft(id)
}

export function deleteDeveloperLabDraft(id: string) {
  const root = draftRoot(id)
  if (!existsSync(root)) return false
  rmSync(root, { recursive: true, force: true })
  return true
}

export function readDeveloperLabFile(id: string, rawPath: string): DeveloperLabFile {
  const path = safePath(rawPath)
  const file = readDraftFiles(id).find((item) => item.path === path)
  if (!file) throw new Error('开发文件不存在')
  return file
}

export function writeDeveloperLabFile(id: string, rawPath: string, rawContent: unknown): DeveloperLabDraft {
  const path = safePath(rawPath)
  const files = readDraftFiles(id)
  const target = files.find((item) => item.path === path)
  if (!target) throw new Error('开发文件不存在')
  const content = String(rawContent ?? '')
  target.content = content
  const total = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0)
  if (total > MAX_TOTAL_BYTES) throw new Error('开发草稿不能超过 8 MB')
  const manifestFile = files.find((file) => file.path === 'dx-app.json')
  if (!manifestFile) throw new Error('开发草稿缺少 dx-app.json')
  let manifest: Record<string, unknown>
  try { manifest = JSON.parse(manifestFile.content) as Record<string, unknown> } catch { throw new Error('dx-app.json 不是有效 JSON') }
  const appId = String(manifest.id || '').trim()
  const name = String(manifest.name || '').trim()
  if (!/^[a-z][a-z0-9-]{2,42}$/.test(appId)) throw new Error('dx-app.json.id 必须使用英文小写、数字和短横线')
  if (!name) throw new Error('dx-app.json.name 不能为空')
  const entry = String(manifest.entry || 'index.html')
  if (!files.some((file) => file.path === entry)) throw new Error(`缺少入口文件：${entry}`)
  const root = draftRoot(id)
  const draft = getDeveloperLabDraft(id)
  writeFileSync(join(root, 'files', ...path.split('/')), content, 'utf8')
  const updated: DeveloperLabDraft = {
    ...draft, name: name.slice(0, 80), appId,
    icon: normalizeDeveloperIcon(manifest.icon, false),
    files: files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content, 'utf8') })),
    checks: analyze(files, manifest),
    previewUrl: `/api/market/developer-lab/${id}/preview/${draft.previewToken}/${entry}`,
  }
  writeFileSync(join(root, 'draft.json'), JSON.stringify({ ...updated, paths: files.map((file) => file.path) }, null, 2), 'utf8')
  return updated
}

export function setDeveloperLabIcon(id: string, value?: unknown) {
  const manifestFile = readDeveloperLabFile(id, 'dx-app.json')
  const manifest = JSON.parse(manifestFile.content) as Record<string, unknown>
  manifest.icon = value ? normalizeDeveloperIcon(value) : autoDeveloperIcon(String(manifest.name || ''), String(manifest.id || id))
  return writeDeveloperLabFile(id, 'dx-app.json', JSON.stringify(manifest, null, 2))
}

export function developerLabZip(id: string) {
  const draft = getDeveloperLabDraft(id)
  const files = readDraftFiles(id)
  return { draft, buffer: buildZip(files.map((file) => ({ name: file.path, data: Buffer.from(file.content, 'utf8') }))) }
}

const MIME: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/markdown' }

export function developerLabPreview(id: string, rawPath: string) {
  const path = safePath(rawPath || 'index.html')
  const root = join(draftRoot(id), 'files')
  const target = resolve(root, ...path.split('/'))
  if (!target.startsWith(`${root}${sep}`) || !existsSync(target)) throw new Error('预览文件不存在')
  let data = readFileSync(target)
  if (extname(path).toLowerCase() === '.html') {
    const bridge = developerSystemBridge(true)
    const html = data.toString('utf8')
    data = Buffer.from(html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`, 'utf8')
  }
  return { data, mime: MIME[extname(path).toLowerCase()] || 'application/octet-stream' }
}

export function verifyDeveloperLabPreviewToken(id: string, token: string) {
  const draft = getDeveloperLabDraft(id)
  if (!draft.previewToken || token !== draft.previewToken) throw new Error('开发预览凭证无效')
  return draft
}

export function developerSystemBridge(preview = false) {
  const reportType = preview ? 'developer.preview.report' : 'developer.runtime.report'
  const readyType = preview ? 'developer.preview.ready' : 'developer.runtime.ready'
  const reporting = `function text(v){if(v instanceof Error)return v.stack||v.message;try{return typeof v==='string'?v:JSON.stringify(v)}catch(_){return String(v)}}function report(level,args){parent.postMessage({dxos:'v1',type:'${reportType}',level:level,message:Array.prototype.map.call(args,text).join(' ')},'*')}addEventListener('error',function(e){if(e.target&&e.target!==window){report('error',['资源加载失败：',e.target.src||e.target.href||e.target.tagName]);return}report('error',[e.error&&e.error.stack?e.error.stack:e.message||'Runtime error'])},true);addEventListener('unhandledrejection',function(e){report('error',[e.reason||'Unhandled rejection'])});`
  const previewConsole = preview ? `['log','info','warn','error'].forEach(function(level){var original=console[level];console[level]=function(){report(level,arguments);return original.apply(console,arguments)}});` : ''
  return `<style id="dx-system-theme">:root{--dx-system-bg:#f5f5f7;--dx-system-surface:#fff;--dx-system-text:#1d1d1f;--dx-system-muted:#6e6e73;--dx-system-line:rgba(0,0,0,.12);color-scheme:light}:root[data-theme="dark"]{--dx-system-bg:#101114;--dx-system-surface:#1c1d22;--dx-system-text:#f5f5f7;--dx-system-muted:#a1a1aa;--dx-system-line:rgba(255,255,255,.14);color-scheme:dark}html,body{background-color:var(--dx-system-bg);color:var(--dx-system-text)}</style><script>(function(){var pending=new Map(),sequence=0;function apply(c){if(!c)return;var d=document.documentElement,a=c.appearance==='dark'?'dark':'light';d.dataset.theme=a;d.classList.toggle('theme-dark',a==='dark');d.classList.toggle('theme-light',a!=='dark');d.lang=c.interfaceLocale||c.locale||'zh-CN';d.dir=c.direction||'ltr';d.style.colorScheme=a;d.style.setProperty('--dx-display-scale',String(c.displayScale||1));if(document.body)document.body.dataset.theme=a;dispatchEvent(new CustomEvent('dx-system-context',{detail:c}))}function invoke(action,args){return new Promise(function(resolve,reject){var id='dx-bridge-'+Date.now().toString(36)+'-'+(++sequence),requested=Number(args&&args.bridgeTimeoutMs),timeout=Number.isFinite(requested)&&requested>=1000?Math.min(requested,900000):30000,timer=setTimeout(function(){pending.delete(id);reject(new Error('DX API 请求超时：'+action))},timeout);pending.set(id,{resolve:resolve,reject:reject,timer:timer});var request={dxos:'v1',type:'request',id:id,action:String(action||'')};if(args&&typeof args==='object')Object.keys(args).forEach(function(key){if(key!=='dxos'&&key!=='type'&&key!=='id'&&key!=='action'&&key!=='bridgeTimeoutMs')request[key]=args[key]});parent.postMessage(request,'*')})}var existing=window.dx&&typeof window.dx==='object'?window.dx:{};existing.invoke=invoke;existing.call=invoke;window.dx=existing;${reporting}${previewConsole}addEventListener('message',function(e){if(e.source!==parent)return;var m=e.data;if(!m||m.dxos!=='v1')return;if(m.type==='system.context')apply(m.context);if(m.id&&pending.has(m.id)){var request=pending.get(m.id);pending.delete(m.id);clearTimeout(request.timer);if(m.ok){request.resolve(m.result);if(m.id==='dx-system-initial')apply(m.result)}else request.reject(new Error(m.error||'DX API 调用失败'))}});addEventListener('DOMContentLoaded',function(){parent.postMessage({dxos:'v1',type:'${readyType}'},'*');invoke('system.getContext').then(apply).catch(function(){})})})();</script>`
}
