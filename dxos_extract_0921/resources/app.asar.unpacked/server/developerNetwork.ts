import { lookup } from 'node:dns/promises'
import { ccsDb } from './ccsDb.ts'
import { getProvider, revealProvider } from './store.ts'
import { isPrivateNetworkAddress } from './networkSafety.ts'
import { developerOAuthAccess, type DeveloperOAuthDeclaration } from './developerOAuth.ts'
export { isPrivateNetworkAddress } from './networkSafety.ts'

interface NetworkPolicy { domains: string[]; methods: string[]; maxResponseBytes: number }
interface CredentialBinding { bindingId: string; providerId: string; authType: string; headerName: string | null; boundAt: number }
const requestWindows = new Map<string, number[]>()

function enforceRateLimit(userId: string, appId: string) {
  const key = `${userId}:${appId}`
  const now = Date.now()
  const window = (requestWindows.get(key) || []).filter((stamp) => stamp > now - 60_000)
  if (window.length >= 60) throw new Error('APP 安全网络请求超过每分钟 60 次配额')
  window.push(now)
  requestWindows.set(key, window)
}

function audit(userId: string, appId: string, method: string, url: URL, status: number, bytes: number, credentialRef: boolean) {
  ccsDb.prepare('INSERT INTO app_network_audit(user_id,app_id,method,origin,pathname,status,response_bytes,credential_ref,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(userId, appId, method, url.origin, url.pathname.slice(0, 500), status, bytes, credentialRef ? 1 : 0, Date.now())
}

function domainAllowed(hostname: string, patterns: string[]) {
  const host = hostname.toLowerCase()
  return patterns.some((pattern) => pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2) : host === pattern)
}

export function validateDeveloperNetworkUrl(raw: unknown, policy: NetworkPolicy) {
  let url: URL
  try { url = new URL(String(raw || '')) } catch { throw new Error('网络请求 URL 无效') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new Error('开发者 APP 网络请求只允许标准 HTTPS')
  if (!domainAllowed(url.hostname, policy.domains)) throw new Error(`域名未在 APP 网络白名单中：${url.hostname}`)
  return url
}

async function assertPublicDns(url: URL) {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((item) => isPrivateNetworkAddress(item.address))) throw new Error('网络请求解析到了内网或保留地址')
}

function bindingRow(userId: string, appId: string, bindingId: string) {
  return ccsDb.prepare(`SELECT binding_id AS bindingId,provider_id AS providerId,auth_type AS authType,header_name AS headerName,bound_at AS boundAt
    FROM app_credential_bindings WHERE user_id=? AND app_id=? AND binding_id=?`).get(userId, appId, bindingId) as CredentialBinding | undefined
}

export function bindDeveloperCredential(userId: string, appId: string, input: { bindingId?: unknown; providerId?: unknown; authType?: unknown; headerName?: unknown }) {
  const bindingId = String(input.bindingId || '').trim()
  const providerId = String(input.providerId || '').trim()
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{1,80}$/.test(bindingId)) throw new Error('Credential bindingId 不合法')
  if (!getProvider(providerId)) throw new Error('要绑定的 API 平台不存在')
  const authType = ['bearer', 'api-key-header'].includes(String(input.authType)) ? String(input.authType) : 'bearer'
  const headerName = authType === 'api-key-header' ? String(input.headerName || 'x-api-key').trim().toLowerCase() : null
  if (headerName && !/^[a-z][a-z0-9-]{1,60}$/.test(headerName)) throw new Error('Credential Header 名称不合法')
  ccsDb.prepare(`INSERT INTO app_credential_bindings(user_id,app_id,binding_id,provider_id,auth_type,header_name,bound_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id,app_id,binding_id) DO UPDATE SET provider_id=excluded.provider_id,auth_type=excluded.auth_type,header_name=excluded.header_name,bound_at=excluded.bound_at`)
    .run(userId, appId, bindingId, providerId, authType, headerName, Date.now())
  return credentialStatus(userId, appId, bindingId)
}

export function credentialStatus(userId: string, appId: string, bindingId: string) {
  const binding = bindingRow(userId, appId, bindingId)
  if (!binding) return { bindingId, bound: false }
  const provider = getProvider(binding.providerId)
  return { bindingId, bound: true, providerId: binding.providerId, providerName: provider?.name || binding.providerId, hasKey: provider?.has_key === true, authType: binding.authType, boundAt: binding.boundAt }
}

export async function developerNetworkRequest(userId: string, appId: string, policy: NetworkPolicy, input: Record<string, unknown>, oauth: DeveloperOAuthDeclaration[] = []) {
  enforceRateLimit(userId, appId)
  let url = validateDeveloperNetworkUrl(input.url, policy)
  const method = String(input.method || 'GET').toUpperCase()
  if (!policy.methods.includes(method)) throw new Error(`APP 未声明网络方法：${method}`)
  const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' }
  const requestedHeaders = input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers) ? input.headers as Record<string, unknown> : {}
  for (const [name, value] of Object.entries(requestedHeaders)) {
    const key = name.toLowerCase()
    if (key === 'accept' || key === 'content-type') headers[key] = String(value).slice(0, 500)
  }
  const bindingId = String(input.credentialId || input.secretRef || '')
  if (bindingId) {
    if (bindingId.startsWith('oauth:')) {
      const config = oauth.find((item) => item.id === bindingId.slice(6))
      if (!config) throw new Error('OAuth 引用未在 APP 清单声明')
      if (!domainAllowed(url.hostname, config.domains)) throw new Error('为防止 Token 泄露，OAuth 只能发送到声明的资源域名')
      const token = await developerOAuthAccess(userId, appId, config)
      headers.Authorization = `${token.tokenType} ${token.accessToken}`
    } else {
    const binding = bindingRow(userId, appId, bindingId)
    if (!binding) throw new Error('Credential 尚未绑定')
    const provider = revealProvider(binding.providerId)
    if (!provider?.api_key) throw new Error('绑定的平台没有可用 API Key')
    const providerHost = new URL(provider.base_url).hostname.toLowerCase()
    if (url.hostname.toLowerCase() !== providerHost) throw new Error('为防止密钥泄露，Credential 只能发送到所绑定平台的域名')
    if (binding.authType === 'api-key-header') headers[binding.headerName || 'x-api-key'] = provider.api_key
    else headers.Authorization = `Bearer ${provider.api_key}`
    }
  }
  let body: string | undefined
  if (method !== 'GET' && input.body !== undefined) {
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body)
    if (!headers['content-type']) headers['content-type'] = typeof input.body === 'string' ? 'text/plain; charset=utf-8' : 'application/json'
    if (Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024) throw new Error('网络请求体不能超过 2 MB')
  }
  let response: Response | null = null
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicDns(url)
    response = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location || redirect === 3) throw new Error('网络请求重定向过多或缺少 Location')
    url = validateDeveloperNetworkUrl(new URL(location, url).toString(), policy)
  }
  if (!response) throw new Error('网络请求失败')
  const declaredBytes = Number(response.headers.get('content-length') || 0)
  if (declaredBytes > policy.maxResponseBytes) throw new Error('网络响应超过 APP 声明的大小限制')
  const data = Buffer.from(await response.arrayBuffer())
  if (data.byteLength > policy.maxResponseBytes) throw new Error('网络响应超过 APP 声明的大小限制')
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  audit(userId, appId, method, url, response.status, data.byteLength, !!bindingId)
  if (input.responseType === 'base64') return { status: response.status, ok: response.ok, url: url.toString(), contentType, encoding: 'base64', body: data.toString('base64') }
  const text = data.toString('utf8')
  if (input.responseType === 'json' || contentType.includes('application/json')) {
    try { return { status: response.status, ok: response.ok, url: url.toString(), contentType, body: JSON.parse(text) } } catch { /* return text */ }
  }
  return { status: response.status, ok: response.ok, url: url.toString(), contentType, body: text }
}
