// ══════════════════════════════════════════════════════════════════════
// 钉钉自定义机器人（加签 webhook）—— OS 原生，多机器人可视化配置。
// 配置存 DX_DATA_DIR/dingtalk.json；webhook、secret 和 clientSecret 使用 AES-256-GCM 加密。
// ══════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { decryptSecret, encryptSecret, isEncryptedSecret } from './secretVault.ts'
import { createHmac } from 'node:crypto'

const DATA_DIR = DATA_ROOT
const FILE = dataPath('dingtalk.json')

export interface Channel {
  id: string
  name: string
  webhook: string
  secret: string
  enabled: boolean
}
interface Store {
  channels: Channel[]
  agent?: AgentConfig
}

export interface AgentConfig {
  clientId: string
  clientSecret: string
  robotCode: string
  activeProfiles: string
}

function load(): Store {
  try {
    if (!existsSync(FILE)) return { channels: [] }
    const raw = JSON.parse(readFileSync(FILE, 'utf-8')) as Store
    const store: Store = {
      channels: Array.isArray(raw.channels) ? raw.channels.map((channel) => ({
        ...channel,
        webhook: isEncryptedSecret(channel.webhook) ? decryptSecret(channel.webhook) : channel.webhook,
        secret: channel.secret && isEncryptedSecret(channel.secret) ? decryptSecret(channel.secret) : channel.secret,
      })) : [],
      agent: raw.agent ? {
        ...raw.agent,
        clientSecret: isEncryptedSecret(raw.agent.clientSecret) ? decryptSecret(raw.agent.clientSecret) : raw.agent.clientSecret,
      } : undefined,
    }
    if (raw.channels?.some((channel) => !!channel.webhook && !isEncryptedSecret(channel.webhook)) || (raw.agent?.clientSecret && !isEncryptedSecret(raw.agent.clientSecret))) persist(store)
    return store
  } catch {
    return { channels: [] }
  }
}

function defaultAgent(): AgentConfig {
  return { clientId: '', clientSecret: '', robotCode: '', activeProfiles: 'ALL' }
}

function legacyAgent(): Partial<AgentConfig> {
  try {
    const raw = JSON.parse(readFileSync(join(DATA_DIR, 'mcp.json'), 'utf-8')) as { id?: string; name?: string; env?: Record<string, string> }[]
    const env = raw.find((item) => /ding|钉钉/i.test(`${item.id || ''} ${item.name || ''}`))?.env || {}
    return {
      clientId: env.DINGTALK_Client_ID || env.DINGTALK_CLIENT_ID || '',
      clientSecret: decryptSecret(env.DINGTALK_Client_Secret || env.DINGTALK_CLIENT_SECRET || ''),
      robotCode: env.ROBOT_CODE || '',
      activeProfiles: env.ACTIVE_PROFILES || 'ALL',
    }
  } catch { return {} }
}

function agentConfig(): AgentConfig {
  const s = load()
  return { ...defaultAgent(), ...legacyAgent(), ...(s.agent || {}) }
}

export function getAgentConfig() {
  const config = agentConfig()
  return {
    clientId: config.clientId,
    clientSecretSet: !!config.clientSecret,
    clientSecretMask: maskSecret(config.clientSecret),
    robotCode: config.robotCode,
    activeProfiles: config.activeProfiles,
  }
}

export function getAgentEnv(): AgentConfig { return agentConfig() }

export function saveAgentConfig(input: Partial<AgentConfig>) {
  const s = load()
  const current = agentConfig()
  s.agent = {
    clientId: input.clientId != null ? String(input.clientId).trim() : current.clientId,
    clientSecret: input.clientSecret ? String(input.clientSecret).trim() : current.clientSecret,
    robotCode: input.robotCode != null ? String(input.robotCode).trim() : current.robotCode,
    activeProfiles: input.activeProfiles != null ? String(input.activeProfiles).trim() || 'ALL' : current.activeProfiles,
  }
  persist(s)
  return getAgentConfig()
}
function persist(s: Store) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const stored: Store = {
    channels: s.channels.map((channel) => ({
      ...channel,
      webhook: encryptSecret(channel.webhook),
      secret: channel.secret ? encryptSecret(channel.secret) : '',
    })),
    agent: s.agent ? { ...s.agent, clientSecret: encryptSecret(s.agent.clientSecret) } : undefined,
  }
  writeFileSync(FILE, JSON.stringify(stored, null, 2), 'utf-8')
}
function slug(name: string): string {
  return (
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'bot'
  )
}
function maskSecret(s: string): string {
  if (!s) return ''
  return s.length <= 8 ? '•'.repeat(s.length) : `${s.slice(0, 4)}••••${s.slice(-4)}`
}

/** 对外列表：掩码 secret，只告诉是否已设。 */
export function listChannels() {
  return load().channels.map((c) => ({
    id: c.id,
    name: c.name,
    webhook: c.webhook,
    secretSet: !!c.secret,
    secretMask: maskSecret(c.secret),
    enabled: c.enabled !== false,
  }))
}

/** 新增/编辑机器人。secret 留空=保留原值（改名不必重填密钥）。 */
export function saveChannel(obj: Partial<Channel>): { id: string } {
  const s = load()
  let id = String(obj.id || '').trim()
  const name = String(obj.name || '').trim() || '机器人'
  if (!id) id = slug(name) + '-' + Math.random().toString(36).slice(2, 6)
  const webhook = String(obj.webhook || '').trim()
  const secret = obj.secret != null ? String(obj.secret).trim() : ''
  const idx = s.channels.findIndex((c) => c.id === id)
  if (idx >= 0) {
    const prev = s.channels[idx]
    s.channels[idx] = {
      ...prev,
      name,
      webhook: webhook || prev.webhook,
      secret: secret || prev.secret, // 空=不改
      enabled: obj.enabled === false ? false : true,
    }
  } else {
    s.channels.push({ id, name, webhook, secret, enabled: obj.enabled === false ? false : true })
  }
  persist(s)
  return { id }
}

export function deleteChannel(id: string): boolean {
  const s = load()
  const before = s.channels.length
  s.channels = s.channels.filter((c) => c.id !== id)
  persist(s)
  return s.channels.length < before
}

export function resetDingTalkData() {
  persist({ channels: [], agent: defaultAgent() })
}

function resolveChannel(channelId?: string): Channel | null {
  const s = load()
  if (channelId) return s.channels.find((c) => c.id === channelId) || null
  return s.channels.find((c) => c.enabled !== false && c.webhook) || null // 默认第一个启用的
}

/** 发送（text / markdown），加签。channelId 不填=第一个启用的机器人。 */
export async function send(
  channelId: string | undefined,
  msg: { text?: string; title?: string; markdown?: string },
): Promise<{ ok: boolean; channel: string; error?: string }> {
  const ch = resolveChannel(channelId)
  if (!ch) return { ok: false, channel: '', error: '没有可用的钉钉机器人，请先在「钉钉」里添加' }
  if (!ch.webhook) return { ok: false, channel: ch.name, error: '该机器人缺少 webhook' }

  let url = ch.webhook
  if (ch.secret) {
    const ts = Date.now()
    const sign = createHmac('sha256', ch.secret).update(`${ts}\n${ch.secret}`).digest('base64')
    const sep = url.includes('?') ? '&' : '?'
    url += `${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`
  }
  const body = msg.markdown
    ? { msgtype: 'markdown', markdown: { title: msg.title || '通知', text: msg.markdown } }
    : { msgtype: 'text', text: { content: msg.text || '' } }

  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const raw = (await resp.json().catch(() => ({}))) as { errcode?: number; errmsg?: string }
    if (raw.errcode === 0) return { ok: true, channel: ch.name }
    return { ok: false, channel: ch.name, error: `钉钉返回 ${raw.errcode}: ${raw.errmsg || '未知'}` }
  } catch (e) {
    return { ok: false, channel: ch.name, error: String((e as Error).message || e) }
  }
}
