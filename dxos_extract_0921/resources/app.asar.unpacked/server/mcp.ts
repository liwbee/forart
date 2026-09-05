// ══════════════════════════════════════════════════════════════════════
// MCP 客户端管理（官方 TS SDK）—— 连接 stdio / Streamable HTTP 的 MCP 服务器，
// 聚合它们的工具给 agent 调用。配置存 DX_DATA_DIR/mcp*.json，敏感 env/header 加密落盘。
// ══════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { decryptSecret, encryptSecret, isEncryptedSecret } from './secretVault.ts'

const DATA_DIR = DATA_ROOT
const FILE = dataPath('mcp.json')
const SYSTEM_FILE = dataPath('mcp.system.json')
const LOCAL_NPM_CACHE = process.env.NPM_CONFIG_CACHE
  || process.env.npm_config_cache
  || join(dirname(fileURLToPath(import.meta.url)), '..', '.npm-cache')
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_ROOT = process.env.CCS_SKILL_ROOT || join(dirname(PROJECT_ROOT), 'skill')

export interface McpServerCfg {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string // stdio：子进程工作目录（本地脚本相对路径需要）
  url?: string
  headers?: Record<string, string> // http：自定义请求头（如远程 MCP 的鉴权 key）
  enabled: boolean
  /** 系统应用随附的连接，不属于 MCP 管理页里的用户配置。 */
  builtin?: boolean
  managedBy?: 'dingtalk' | 'lingxing' | 'ziniao' | 'illustrator' | 'figma' | 'video-editor'
}
interface Runtime {
  client: Client | null
  tools: { name: string; description?: string; inputSchema?: unknown }[]
  status: 'connected' | 'error' | 'disconnected' | 'connecting'
  error?: string
}

let mcpSdkRuntime: Promise<{
  Client: typeof import('@modelcontextprotocol/sdk/client/index.js').Client
  StdioClientTransport: typeof import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport
  StreamableHTTPClientTransport: typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport
}> | null = null

function loadMcpSdk() {
  if (!mcpSdkRuntime) {
    mcpSdkRuntime = Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ]).then(([client, stdio, http]) => ({
      Client: client.Client,
      StdioClientTransport: stdio.StdioClientTransport,
      StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
    })).catch((error) => {
      mcpSdkRuntime = null
      throw error
    })
  }
  return mcpSdkRuntime
}

const runtime = new Map<string, Runtime>()
// 生成给 agent 的工具名 → {serverId, toolName} 的映射
const toolIndex = new Map<string, { serverId: string; toolName: string }>()
// 领星官方 MCP 的每个工具 QPS 为 1，并且认证层也会对紧邻请求限流。
// 在服务端统一排队，避免多个窗口或 Agent 同时调用时绕过前端节流。
const callQueues = new Map<string, Promise<void>>()
const lastCallStartedAt = new Map<string, number>()
interface LingxingGatewayTool {
  toolId: string
  catalogVersion: string
  schemaVersion: string
}
const lingxingGatewayTools = new Map<string, LingxingGatewayTool>()

export function parseLingxingGatewayTool(searchText: string, toolName: string): LingxingGatewayTool {
  const searchResult = JSON.parse(searchText) as {
    code?: number
    success?: boolean
    message?: string
    msg?: string
    data?: Partial<LingxingGatewayTool>
  }
  const data = searchResult.data
  // 领星网关使用 code=1 表示成功；不同 Catalog 版本还可能只通过
  // success=true 或完整的工具元数据表达成功，不能套用常见的 code=0 约定。
  if (searchResult.success === false || searchResult.code === 0) {
    throw new Error(searchResult.message || searchResult.msg || searchText)
  }
  if (!data?.toolId || !data.catalogVersion || !data.schemaVersion) {
    throw new Error(`领星未返回业务工具 ${toolName} 的调用信息`)
  }
  return { toolId: data.toolId, catalogVersion: data.catalogVersion, schemaVersion: data.schemaVersion }
}

const SEARCH_TOOL_RE =
  /\b(search|web|internet|fetch|crawl|scrape|browse|browser|page|url|news|query|weather|bing|google|duckduckgo|brave|tavily|searx|firecrawl|playwright)\b|搜索|联网|网页|抓取|浏览|新闻|天气/i

const SYSTEM_SERVERS: McpServerCfg[] = [
  {
    id: 'video-clip', name: 'AI 剪辑台 · Video Clip MCP', transport: 'stdio', command: 'npx',
    args: ['-y', '@pickstar-2002/video-clip-mcp@latest'], enabled: false, builtin: true, managedBy: 'video-editor',
  },
  {
    id: 'figma', name: 'Framelink MCP for Figma', transport: 'stdio', command: 'npx',
    args: ['-y', 'figma-developer-mcp', '--stdio'], env: { FIGMA_API_KEY: '' },
    enabled: false, builtin: true, managedBy: 'figma',
  },
  {
    // Illustrator APP 直接依赖这个固定 id，并使用其中的条码读取、替换和 PDF 导出工具。
    // 固定兼容版本，避免上游工具名变化导致已发布工作流失效。
    id: 'illustrator', name: 'Adobe Illustrator MCP', transport: 'stdio', command: 'npx',
    args: ['-y', 'illustrator-mcp-server@1.6.2'],
    enabled: false, builtin: true, managedBy: 'illustrator',
  },
  {
    id: 'lingxing', name: '领星 ERP · 官方 MCP', transport: 'http',
    url: 'https://openmcp.lingxing.com/mcp-servers/lingxing-mcp', enabled: false, builtin: true, managedBy: 'lingxing',
  },
  {
    id: 'ziniao', name: '紫鸟超级浏览器', transport: 'stdio', command: 'python',
    args: [join(SKILL_ROOT, 'tools', 'mcp_servers', 'ziniao', 'ccs_stdio_server.py')], cwd: SKILL_ROOT,
    env: { ZINIAO_CLIENT_PATH: 'C:\\Program Files\\ziniao', ZINIAO_VERSION: 'v6', ZINIAO_SOCKET_PORT: '16851' },
    enabled: false, builtin: true, managedBy: 'ziniao',
  },
  {
    id: 'dingtalk-mcp-96cf', name: '钉钉 MCP', transport: 'stdio', command: 'npx',
    args: ['-y', 'dingtalk-mcp@latest'], env: { ACTIVE_PROFILES: 'ALL' },
    enabled: false, builtin: true, managedBy: 'dingtalk',
  },
]
const SYSTEM_IDS = new Set(SYSTEM_SERVERS.map((server) => server.id))

function readCfgFile(file: string): McpServerCfg[] {
  for (const candidate of [file, `${file}.bak`]) {
    try {
      if (!existsSync(candidate)) continue
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as McpServerCfg[]
      if (Array.isArray(parsed)) return parsed.map(revealMcpSecrets)
    } catch {
      /* 主文件损坏时继续读取上一版备份 */
    }
  }
  return []
}

function sensitiveConfigName(name: string) { return /(key|token|secret|password|authorization|cookie|credential)/i.test(name) }
function revealMcpSecrets(config: McpServerCfg): McpServerCfg {
  const reveal = (values?: Record<string, string>) => values
    ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, isEncryptedSecret(value) ? decryptSecret(value) : value]))
    : undefined
  return { ...config, env: reveal(config.env), headers: reveal(config.headers) }
}
function protectMcpSecrets(config: McpServerCfg): McpServerCfg {
  const protect = (values?: Record<string, string>) => values
    ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, sensitiveConfigName(key) && value ? encryptSecret(decryptSecret(value)) : value]))
    : undefined
  return { ...config, env: protect(config.env), headers: protect(config.headers) }
}

function systemDefinition(id: string) { return SYSTEM_SERVERS.find((server) => server.id === id) }
export function isSystemServer(id: string) { return SYSTEM_IDS.has(id) }

function loadCfg(): McpServerCfg[] {
  const legacy = readCfgFile(FILE)
  const storedSystem = readCfgFile(SYSTEM_FILE)
  const systems = SYSTEM_SERVERS.map((base) => {
    const saved = storedSystem.find((item) => item.id === base.id)
      || legacy.find((item) => item.id === base.id)
      || (base.managedBy === 'lingxing' ? legacy.find((item) => /lingxing|领星/i.test(`${item.id} ${item.name}`)) : undefined)
    return { ...base, ...(saved || {}), id: base.id, builtin: true, managedBy: base.managedBy }
  })
  return [...systems, ...legacy.filter((item) => !SYSTEM_IDS.has(item.id) && !SYSTEM_SERVERS.some((base) => base.managedBy === 'lingxing' && /lingxing|领星/i.test(`${item.id} ${item.name}`)))]
}
function persist(list: McpServerCfg[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const systems = list.filter((item) => SYSTEM_IDS.has(item.id)).map((item) => ({ ...item, builtin: true }))
  const users = list.filter((item) => !SYSTEM_IDS.has(item.id)).map(({ builtin: _builtin, managedBy: _managedBy, ...item }) => item)
  writeJsonAtomic(SYSTEM_FILE, systems.map(protectMcpSecrets))
  writeJsonAtomic(FILE, users.map(protectMcpSecrets))
}

function writeJsonAtomic(file: string, value: unknown) {
  const temp = `${file}.tmp`
  try {
    if (existsSync(file)) {
      const previous = JSON.parse(readFileSync(file, 'utf-8')) as McpServerCfg[]
      writeFileSync(`${file}.bak`, JSON.stringify(previous.map(revealMcpSecrets).map(protectMcpSecrets), null, 2), 'utf-8')
    }
  } catch { /* 不用损坏的主文件覆盖有效备份 */ }
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf-8')
  renameSync(temp, file)
}
function slug(s: string) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp'
}
// agent 工具名只能 [a-zA-Z0-9_-]
function safeName(s: string) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function isSearchTool(cfg: McpServerCfg, tool: { name: string; description?: string }) {
  return SEARCH_TOOL_RE.test(`${cfg.name} ${cfg.id} ${tool.name} ${tool.description || ''}`)
}

const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function collectionItemType(label: string): string | null {
  const m = label.match(/^(?:array|list|set|seq|sequence)\s*<\s*(.+?)\s*>$/i)
  return m?.[1] || null
}

function normalizeSchemaType(v: unknown): string | string[] | undefined {
  if (Array.isArray(v)) {
    const types = v
      .map((x) => normalizeSchemaType(x))
      .flatMap((x) => (Array.isArray(x) ? x : x ? [x] : []))
    return types.length ? [...new Set(types)] : undefined
  }
  if (typeof v !== 'string') return undefined
  const raw = v.trim()
  const t = raw.toLowerCase()
  if (JSON_SCHEMA_TYPES.has(t)) return t
  if (t === 'str') return 'string'
  if (t === 'int' || t === 'long') return 'integer'
  if (t === 'float' || t === 'double' || t === 'decimal') return 'number'
  if (t === 'bool') return 'boolean'
  if (/^(map|dict|dictionary|record)\b/.test(t)) return 'object'
  if (/^(array|list|set|seq|sequence)\b/.test(t)) return 'array'
  if (t === 'any' || t === 'unknown' || t === 'object any') return undefined
  return 'string'
}

function sanitizeJsonSchema(schema: unknown, root = false): Record<string, unknown> {
  const src = isRecord(schema) ? schema : {}
  const out: Record<string, unknown> = {}
  const rawType = src.type
  const type = normalizeSchemaType(rawType)
  if (type) out.type = Array.isArray(type) && type.length === 1 ? type[0] : type

  for (const [key, value] of Object.entries(src)) {
    if (key === 'type' || key === '$schema') continue
    if (key === 'properties' && isRecord(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeJsonSchema(v)]))
    } else if (key === 'items') {
      out.items = sanitizeJsonSchema(value)
    } else if (key === 'additionalProperties') {
      out.additionalProperties = isRecord(value) ? sanitizeJsonSchema(value) : value !== false
    } else if ((key === 'oneOf' || key === 'anyOf' || key === 'allOf') && Array.isArray(value)) {
      out[key] = value.map((v) => sanitizeJsonSchema(v))
    } else if ((key === '$defs' || key === 'definitions' || key === 'patternProperties') && isRecord(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeJsonSchema(v)]))
    } else if (key === 'required' && Array.isArray(value)) {
      out.required = value.filter((x): x is string => typeof x === 'string')
    } else {
      out[key] = value
    }
  }

  if (typeof rawType === 'string') {
    const itemType = collectionItemType(rawType.trim())
    if (itemType && !out.items) out.items = sanitizeJsonSchema({ type: itemType })
    if (/^(map|dict|dictionary|record)\b/i.test(rawType.trim()) && out.additionalProperties === undefined) {
      out.additionalProperties = true
    }
  }
  if (root) out.type = 'object'
  if (out.type === 'object' && out.properties === undefined && out.additionalProperties === undefined) out.properties = {}
  if (out.type === 'array' && out.items === undefined) out.items = {}
  return out
}

const CONNECT_TIMEOUT = 60000 // npx 首次下载可能较慢，给足 60s；超时判 error 而非永久挂起
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label}超时（${ms / 1000}s），可能命令无效或 npx 首次下载太慢`)), ms)),
  ])
}

async function withServerCallPacing<T>(serverId: string, task: () => Promise<T>): Promise<T> {
  const cfg = loadCfg().find((item) => item.id === serverId)
  if (cfg?.managedBy !== 'lingxing') return task()
  const previous = callQueues.get(serverId) || Promise.resolve()
  const run = previous.catch(() => undefined).then(async () => {
    const wait = Math.max(0, 1200 - (Date.now() - (lastCallStartedAt.get(serverId) || 0)))
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    lastCallStartedAt.set(serverId, Date.now())
    return task()
  })
  callQueues.set(serverId, run.then(() => undefined, () => undefined))
  return run
}

function stdioErrorSummary(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  const codes = [...text.matchAll(/"code"\s*:\s*"([^"]+)"/g)].map((match) => match[1])
  const serviceCode = codes.find((code) => code !== 'INTERNAL_ERROR')
  const host = [...text.matchAll(/"hostId"\s*:\s*"([^"]+)"/g)].at(-1)?.[1]
  const finalLine = text.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('错误:'))?.trim()
  const detail = [serviceCode, host].filter(Boolean).join(' · ')
  return [finalLine, detail].filter(Boolean).join(' ')
}

async function connectServer(cfg: McpServerCfg): Promise<Runtime> {
  const rt: Runtime = { client: null, tools: [], status: 'connecting' }
  runtime.set(cfg.id, rt)
  let client: Client | null = null
  let stderrText = ''
  try {
    const { Client, StdioClientTransport, StreamableHTTPClientTransport } = await loadMcpSdk()
    client = new Client({ name: 'ccs-os', version: '0.1.0' }, { capabilities: {} })
    let transport
    if (cfg.transport === 'http') {
      if (!cfg.url) throw new Error('缺少 url')
      const opts = cfg.headers && Object.keys(cfg.headers).length ? { requestInit: { headers: cfg.headers } } : undefined
      transport = new StreamableHTTPClientTransport(new URL(cfg.url), opts)
    } else {
      if (!cfg.command) throw new Error('缺少 command')
      // npx 默认写入用户级 npm 缓存；该目录被占用或无写入权限时会导致 MCP 子进程退出。
      // 始终回退到项目内缓存，保证一键启动和命令行启动的行为一致。
      const env = { ...(process.env as Record<string, string>), ...(cfg.env || {}) }
      const npx = cfg.command.toLowerCase() === 'npx'
      if (npx && !env.NPM_CONFIG_CACHE && !env.npm_config_cache) {
        if (!existsSync(LOCAL_NPM_CACHE)) mkdirSync(LOCAL_NPM_CACHE, { recursive: true })
        env.NPM_CONFIG_CACHE = LOCAL_NPM_CACHE
      }
      const configuredArgs = cfg.args || []
      const commandArgs = npx && !configuredArgs.some((arg) => arg === '-y' || arg === '--yes')
        ? ['-y', ...configuredArgs]
        : configuredArgs
      const bundledNpxCli = [
        join(dirname(process.execPath), 'npm-runtime', 'bin', 'npx-cli.js'),
        join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
      ].find(existsSync) || ''
      const useBundledNpx = npx && existsSync(bundledNpxCli)
      const npxArgs = npx && !(cfg.args || []).some((arg) => arg === '--cache' || arg.startsWith('--cache='))
        ? ['--cache', LOCAL_NPM_CACHE, ...commandArgs]
        : commandArgs
      const stdioTransport = new StdioClientTransport({
        command: useBundledNpx ? process.execPath : cfg.command,
        // 在 Windows 上，某些 npm 版本不会把子进程环境中的缓存变量传给 npx。
        // 正式版还要通过内置 Node 直接执行 npx-cli，不能依赖系统 PATH。
        args: useBundledNpx ? [bundledNpxCli, ...npxArgs] : npxArgs,
        env,
        stderr: 'pipe',
        ...(cfg.cwd ? { cwd: cfg.cwd } : {}),
      })
      stdioTransport.stderr?.on('data', (chunk) => {
        stderrText = (stderrText + String(chunk)).slice(-12000)
      })
      transport = stdioTransport
    }
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT, '连接')
    const res = await withTimeout(client.listTools(), 20000, '拉取工具')
    rt.client = client
    rt.tools = res.tools || []
    rt.status = 'connected'
  } catch (e) {
    rt.status = 'error'
    const base = String((e as Error).message || e)
    const detail = stdioErrorSummary(stderrText)
    rt.error = detail ? `${base} · ${detail}` : base
    try {
      await client?.close() // 超时/失败时关掉，避免残留子进程
    } catch {
      /* ignore */
    }
  }
  runtime.set(cfg.id, rt)
  return rt
}

async function disconnect(id: string) {
  const rt = runtime.get(id)
  try {
    await rt?.client?.close()
  } catch {
    /* ignore */
  }
  runtime.delete(id)
  if (id === 'lingxing') lingxingGatewayTools.clear()
}

// ── 敏感值掩码：env/headers 里像密钥的值不回传明文 ───────────────────────
const SECRET_MASK = '••••••'
function isSensitiveKey(k: string): boolean {
  return /key|secret|password|passwd|token|auth/i.test(k)
}
/** 返回一份掩码后的副本：敏感 key 的值 → SECRET_MASK，其余保留明文。 */
function maskMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) out[k] = v && isSensitiveKey(k) ? SECRET_MASK : v
  return out
}
/** 保存时合并：值仍是掩码（未改动）→ 沿用旧的真实值；否则用新值。 */
function mergeSecrets(
  incoming: Record<string, string> | undefined,
  prev: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(incoming)) out[k] = v === SECRET_MASK && prev?.[k] !== undefined ? prev[k] : v
  return Object.keys(out).length ? out : undefined
}

// ── 对外 API ──────────────────────────────────────────────────────────
export function listServers() {
  const cfgs = loadCfg()
  return cfgs.map((c) => {
    const rt = runtime.get(c.id)
    return {
      ...c,
      env: maskMap(c.env), // 不把密钥明文回传前端
      headers: maskMap(c.headers),
      status: c.enabled ? rt?.status || 'disconnected' : 'disconnected',
      error: rt?.error || '',
      toolCount: rt?.tools.length || 0,
      tools: (rt?.tools || []).map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema })),
    }
  })
}

export async function saveServer(obj: Partial<McpServerCfg>): Promise<McpServerCfg> {
  const list = loadCfg()
  let id = String(obj.id || '').trim()
  const name = String(obj.name || '').trim() || 'MCP'
  if (!id) id = slug(name) + '-' + randomUUID().slice(0, 4)
  const prev = list.find((x) => x.id === id)
  // 掩码值（未改动的密钥）合并回真实值，避免保存时把密钥清成 ••••••
  const envIn = obj.env && typeof obj.env === 'object' ? (obj.env as Record<string, string>) : undefined
  const headersIn = obj.headers && typeof obj.headers === 'object' ? (obj.headers as Record<string, string>) : undefined
  const system = systemDefinition(id)
  const cfg: McpServerCfg = {
    ...(system || {}),
    id,
    name,
    transport: obj.transport === 'http' ? 'http' : 'stdio',
    command: obj.command?.trim() || undefined,
    args: Array.isArray(obj.args) ? obj.args : typeof obj.args === 'string' ? String(obj.args).split(/\s+/).filter(Boolean) : [],
    env: mergeSecrets(envIn, prev?.env),
    cwd: obj.cwd?.trim() || undefined,
    url: obj.url?.trim() || undefined,
    headers: mergeSecrets(headersIn, prev?.headers),
    enabled: obj.enabled === false ? false : true,
    ...(system ? { builtin: true, managedBy: system.managedBy } : {}),
  }
  const idx = list.findIndex((x) => x.id === id)
  if (idx >= 0) list[idx] = cfg
  else list.push(cfg)
  persist(list)
  await disconnect(id)
  // 后台连接，不阻塞保存返回（npx 首次下载可能很慢）；状态随后异步更新
  if (cfg.enabled) connectServer(cfg).catch(() => {})
  return cfg
}

export async function deleteServer(id: string) {
  if (isSystemServer(id)) throw new Error('系统 MCP 随应用内置，不能在 MCP 管理中删除')
  const list = loadCfg().filter((x) => x.id !== id)
  persist(list)
  await disconnect(id)
}

/** 仅供对应应用的“清除数据”使用：恢复代码内置定义，不移除连接骨架。 */
export async function resetSystemServer(id: string) {
  const base = systemDefinition(id)
  if (!base) throw new Error('不是系统 MCP')
  const list = loadCfg().filter((item) => item.id !== id)
  list.unshift({ ...base })
  persist(list)
  await disconnect(id)
  if (base.enabled) connectServer(base).catch(() => {})
  return base
}

export async function refreshServer(id: string) {
  const cfg = loadCfg().find((x) => x.id === id)
  await disconnect(id)
  if (cfg?.enabled) connectServer(cfg).catch(() => {}) // 后台重连，立即返回（状态为 connecting）
  return runtime.get(id)
}

/** 只翻转启用开关：立即持久化并连接/断开（不动其它配置字段），点了就生效。 */
export async function setServerEnabled(id: string, enabled: boolean) {
  const list = loadCfg()
  const cfg = list.find((x) => x.id === id)
  if (!cfg) throw new Error('未找到服务器')
  cfg.enabled = enabled
  persist(list)
  await disconnect(id)
  if (enabled) connectServer(cfg).catch(() => {}) // 后台连接，立即返回（状态为 connecting）
  return runtime.get(id)
}

function collectAgentTools(filter?: (cfg: McpServerCfg, tool: { name: string; description?: string; inputSchema?: unknown }) => boolean) {
  const out: { type: 'function'; function: { name: string; description?: string; parameters: unknown } }[] = []
  for (const cfg of loadCfg()) {
    if (!cfg.enabled) continue
    const rt = runtime.get(cfg.id)
    if (rt?.status !== 'connected') continue
    for (const t of rt.tools) {
      if (filter && !filter(cfg, t)) continue
      const fname = `mcp__${safeName(cfg.id)}__${safeName(t.name)}`
      toolIndex.set(fname, { serverId: cfg.id, toolName: t.name })
      out.push({
        type: 'function',
        function: {
          name: fname,
          description: `[MCP:${cfg.name}] ${t.description || t.name}`,
          parameters: sanitizeJsonSchema(t.inputSchema, true),
        },
      })
    }
  }
  return out
}

/** 聚合所有已连接服务器的工具，转成 agent 可用的 function 定义。 */
export function agentTools() {
  toolIndex.clear()
  return collectAgentTools()
}

/** 只聚合某个 MCP 服务器的工具，供管理页用自然语言做隔离测试。 */
export function agentToolsForServer(serverId: string) {
  toolIndex.clear()
  return collectAgentTools((cfg) => cfg.id === serverId)
}

/** 只暴露搜索/抓取/浏览类 MCP 工具，供联网搜索开关和 web_search 技能使用。 */
export function searchAgentTools() {
  toolIndex.clear()
  return collectAgentTools((cfg, tool) => isSearchTool(cfg, tool))
}

/** agent 调用：按生成的工具名调用对应 MCP 工具。 */
export async function callByName(fname: string, args: Record<string, unknown>): Promise<string> {
  if (!toolIndex.has(fname)) agentTools() // 确保索引已建
  const ref = toolIndex.get(fname)
  if (!ref) throw new Error(`未知 MCP 工具：${fname}`)
  const rt = runtime.get(ref.serverId)
  if (!rt?.client) throw new Error('MCP 服务器未连接')
  const res = (await withServerCallPacing(ref.serverId, () => rt.client!.callTool({ name: ref.toolName, arguments: args || {} }))) as {
    content?: { type: string; text?: string }[]
    isError?: boolean
  }
  const text = (res.content || [])
    .map((c) => (c.type === 'text' ? c.text : `[${c.type}]`))
    .join('\n')
  return text || '(无返回内容)'
}

/** 直接按 serverId + tool 调用（供管理页试调用）。 */
export async function callDirect(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const rt = runtime.get(serverId)
  if (!rt?.client) throw new Error('MCP 服务器未连接')
  try {
    const callTool = async (name: string, callArgs: Record<string, unknown>) => {
      const res = (await withServerCallPacing(serverId, () => rt.client!.callTool({ name, arguments: callArgs }))) as {
        content?: { type: string; text?: string }[]
        isError?: boolean
      }
      const text = (res.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') || '(无返回内容)'
      if (res.isError) throw new Error(text)
      return text
    }

    // 领星新版 MCP 只公开 help/search/action 三个网关工具，原业务工具变成
    // Catalog 中的 toolId。APP 仍按稳定的业务工具名调用，由服务端完成
    // search -> action 适配；这样 Catalog/Schema 版本升级时无需改前端。
    const exposedNames = new Set(rt.tools.map((tool) => tool.name))
    const usesLingxingGateway = serverId === 'lingxing'
      && !exposedNames.has(toolName)
      && exposedNames.has('search')
      && exposedNames.has('action')
    if (usesLingxingGateway) {
      let metadata = lingxingGatewayTools.get(toolName)
      if (!metadata) {
        const searchText = await callTool('search', { toolId: toolName })
        metadata = parseLingxingGatewayTool(searchText, toolName)
        lingxingGatewayTools.set(toolName, metadata)
      }
      return await callTool('action', {
        toolId: metadata.toolId,
        catalogVersion: metadata.catalogVersion,
        schemaVersion: metadata.schemaVersion,
        paramsJson: JSON.stringify(args || {}),
      })
    }

    const res = (await withServerCallPacing(serverId, () => rt.client!.callTool({ name: toolName, arguments: args || {} }))) as {
      content?: { type: string; text?: string }[]
      isError?: boolean
    }
    const text = (res.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') || '(无返回内容)'
    if (res.isError) throw new Error(text)
    return text
  } catch (e) {
    // MCP 调用可能因为子进程崩溃、连接断开、超时等原因失败
    const msg = String((e as Error).message || e)
    console.error(`[MCP] 调用工具失败 [${serverId}.${toolName}]:`, msg)
    // 如果是连接错误，标记服务器状态为错误
    if (/disconnect|closed|abort|timeout/i.test(msg)) {
      rt.status = 'error'
      rt.error = `连接中断: ${msg}`
    }
    throw new Error(`MCP 工具调用失败 [${toolName}]: ${msg}`)
  }
}

/** 启动时连接所有启用的服务器（best-effort）。 */
export async function initMcp() {
  const configs = loadCfg()
  // 启动即迁移旧的混合 mcp.json，并补齐所有系统应用连接。
  persist(configs)
  for (const cfg of configs) {
    if (cfg.enabled) connectServer(cfg).catch(() => {})
  }
}

/** Rewrites legacy/plaintext MCP storage without starting any MCP process. */
export function migrateMcpStorage() {
  const configs = loadCfg()
  persist(configs)
  return configs.length
}

// ── 一键导入：解析各种常见的 MCP 配置格式 ─────────────────────────────
// 支持：
//  1. 标准 {"mcpServers": {name: {command,args,env}}}（Claude Desktop / Cursor / npx / uv / uvx …）
//  2. VS Code 风格 {"servers": {...}} 或 {"mcp": {"servers": {...}}}
//  3. 单个服务器对象 {"command": "...", "args": [...]} 或 {"url": "..."}
//  4. 纯 URL（http/https 一行）
//  5. 命令行一行，如：npx -y @scope/some-mcp@latest
export interface ParsedServer {
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

function toStrMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = String(val)
  return Object.keys(out).length ? out : undefined
}

function entryToServer(name: string, v: Record<string, unknown>): ParsedServer | null {
  // http/sse 型：{url} 或 {type:"http"|"sse", url}
  const url = typeof v.url === 'string' ? v.url : typeof v.serverUrl === 'string' ? (v.serverUrl as string) : ''
  if (url) return { name, transport: 'http', url, headers: toStrMap(v.headers) }
  const command = typeof v.command === 'string' ? v.command.trim() : ''
  if (!command) return null
  const args = Array.isArray(v.args) ? v.args.map(String) : []
  const cwd = typeof v.cwd === 'string' && v.cwd.trim() ? v.cwd.trim() : undefined
  return { name, transport: 'stdio', command, args, env: toStrMap(v.env), cwd }
}

/** 从服务器条目里猜一个可读名称（去掉 scope/版本号/-mcp 后缀之类）。 */
function guessName(fallback: string, s: ParsedServer): string {
  if (fallback && fallback !== 'mcp') return fallback
  const src = s.url || (s.args || []).find((a) => a.includes('/') || a.includes('mcp')) || s.command || 'mcp'
  return src.split('/').pop()!.replace(/@latest$/, '').replace(/\.(js|py)$/, '') || 'mcp'
}

export function parseImport(text: string): ParsedServer[] {
  const raw = String(text || '').trim()
  if (!raw) throw new Error('内容为空')

  // 纯 URL
  if (/^https?:\/\/\S+$/i.test(raw)) return [{ name: guessName('', { name: '', transport: 'http', url: raw }), transport: 'http', url: raw }]

  // 命令行一行（npx / uvx / uv / node / python …）
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    const parts = raw.split(/\s+/)
    if (parts.length < 1) throw new Error('无法识别的格式')
    const s: ParsedServer = { name: '', transport: 'stdio', command: parts[0], args: parts.slice(1) }
    s.name = guessName('', s)
    return [s]
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    // 宽容：去掉尾逗号再试一次
    try {
      json = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'))
    } catch {
      throw new Error('JSON 解析失败，请检查格式')
    }
  }
  const obj = json as Record<string, unknown>

  // 找到 servers map
  let map: Record<string, unknown> | null = null
  if (obj.mcpServers && typeof obj.mcpServers === 'object') map = obj.mcpServers as Record<string, unknown>
  else if (obj.servers && typeof obj.servers === 'object') map = obj.servers as Record<string, unknown>
  else if (obj.mcp && typeof obj.mcp === 'object' && (obj.mcp as Record<string, unknown>).servers)
    map = (obj.mcp as Record<string, unknown>).servers as Record<string, unknown>

  const out: ParsedServer[] = []
  if (map) {
    for (const [name, v] of Object.entries(map)) {
      if (!v || typeof v !== 'object') continue
      const s = entryToServer(name, v as Record<string, unknown>)
      if (s) out.push(s)
    }
  } else {
    // 单个服务器对象
    const s = entryToServer('', obj)
    if (s) {
      s.name = guessName('', s)
      out.push(s)
    }
  }
  if (!out.length) throw new Error('没有找到可导入的服务器（支持 mcpServers/servers 格式、单个 {command,args} 对象、URL 或命令行）')
  return out
}

/** 一键导入：解析文本并逐个保存+连接，返回每个的结果。 */
export async function importServers(text: string): Promise<{ saved: McpServerCfg[]; count: number }> {
  const parsed = parseImport(text)
  const saved: McpServerCfg[] = []
  const existing = loadCfg()
  for (const p of parsed) {
    const prev = existing.find((x) => x.name === p.name) // 同名视为更新，避免重复导入
    const cfg = await saveServer({
      id: prev?.id,
      name: p.name,
      transport: p.transport,
      command: p.command,
      args: p.args,
      env: p.env,
      cwd: p.cwd,
      url: p.url,
      headers: p.headers,
      enabled: true,
    })
    saved.push(cfg)
  }
  return { saved, count: saved.length }
}
