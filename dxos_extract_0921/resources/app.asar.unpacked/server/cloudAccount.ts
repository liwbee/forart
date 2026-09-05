import { randomUUID } from 'node:crypto'
import { ccsDb } from './ccsDb.ts'
import { getInstallationIdentity } from './installationIdentity.ts'
import { decryptSecret, encryptSecret } from './secretVault.ts'
import {
  clearCloudEntitlement,
  currentCloudMembership,
  persistCloudEntitlement,
  type CloudMembershipView,
  type SignedEntitlementEnvelope,
} from './cloudEntitlement.ts'

const DEFAULT_API_BASE_URL = 'https://api.dx-os.com'
const REQUEST_TIMEOUT_MS = 12_000
const ACCESS_REFRESH_WINDOW_MS = 60_000
const ACCOUNT_VERIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000

interface CloudTokenResponse {
  accessToken: string
  accessTokenExpiresIn: number
  refreshToken: string
  refreshTokenExpiresIn: number
  user: { id: string; email: string; displayName?: string | null }
  organizationId?: string | null
  organization?: { id?: string | null } | null
  deviceId?: string | null
  device?: { id?: string | null } | null
  entitlement?: SignedEntitlementEnvelope | null
}

interface CloudMeResponse {
  authenticated: boolean
  user: { id: string; email: string; displayName?: string | null }
  organizationId?: string | null
  organization?: { id?: string | null } | null
  deviceId?: string | null
  device?: { id?: string | null } | null
  entitlement?: SignedEntitlementEnvelope | null
}

interface StoredCloudSession {
  installation_id: string
  cloud_user_id: string
  email: string
  display_name: string | null
  access_token_enc: string
  refresh_token_enc: string
  access_expires_at: number
  refresh_expires_at: number
  updated_at: number
}

interface StoredCloudBinding {
  id: string
  installation_id: string
  cloud_user_id: string
  organization_id: string | null
  device_id: string | null
  status: 'active' | 'revoked' | 'unbound'
  bound_by_local_user_id: string
  bound_at: number
  last_verified_at: number | null
  unbound_at: number | null
  updated_at: number
}

interface LegacyCloudSession {
  local_user_id: string
  cloud_user_id: string
  email: string
  display_name: string | null
  access_token_enc: string
  refresh_token_enc: string
  access_expires_at: number
  refresh_expires_at: number
  updated_at: number
}

export interface CloudAccountView {
  loggedIn: true
  online: boolean
  user: { id: string; email: string; displayName: string | null; emailVerified: true }
  binding: {
    installationId: string
    devicePublicId: string
    organizationId: string | null
    deviceId: string | null
  }
  membership: CloudMembershipView | null
  accessExpiresAt: number
  refreshExpiresAt: number
}

export type CloudAccountStatus = CloudAccountView | { loggedIn: false; online: boolean; user: null }
export interface CloudAccountOptions { fetchImpl?: typeof fetch; now?: () => number }

export interface CloudTemporaryMediaResult {
  uploaded: true
  id: string
  url: string
  fileName: string
  fileSize: number
  contentType: string
  expiresAt: number
  expiresIn: number
}

class CloudAccountRemoteError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'CloudAccountRemoteError'
  }
}

const installation = getInstallationIdentity()
const refreshes = new Map<string, Promise<StoredCloudSession>>()
const rowByInstallation = ccsDb.prepare('SELECT * FROM cloud_installation_sessions WHERE installation_id = ?')
const bindingByInstallation = ccsDb.prepare('SELECT * FROM cloud_installation_binding WHERE installation_id = ?')
const deleteSession = ccsDb.prepare('DELETE FROM cloud_installation_sessions WHERE installation_id = ?')
const saveSession = ccsDb.prepare(`
  INSERT INTO cloud_installation_sessions (
    installation_id, cloud_user_id, email, display_name,
    access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(installation_id) DO UPDATE SET
    cloud_user_id=excluded.cloud_user_id, email=excluded.email, display_name=excluded.display_name,
    access_token_enc=excluded.access_token_enc, refresh_token_enc=excluded.refresh_token_enc,
    access_expires_at=excluded.access_expires_at, refresh_expires_at=excluded.refresh_expires_at,
    updated_at=excluded.updated_at
`)
const saveBinding = ccsDb.prepare(`
  INSERT INTO cloud_installation_binding (
    id, installation_id, cloud_user_id, organization_id, device_id, status,
    bound_by_local_user_id, bound_at, last_verified_at, unbound_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?)
  ON CONFLICT(installation_id) DO UPDATE SET
    cloud_user_id=excluded.cloud_user_id,
    organization_id=COALESCE(excluded.organization_id, cloud_installation_binding.organization_id),
    device_id=COALESCE(excluded.device_id, cloud_installation_binding.device_id),
    status='active',
    bound_by_local_user_id=CASE WHEN cloud_installation_binding.status='active' THEN cloud_installation_binding.bound_by_local_user_id ELSE excluded.bound_by_local_user_id END,
    bound_at=CASE WHEN cloud_installation_binding.status='active' THEN cloud_installation_binding.bound_at ELSE excluded.bound_at END,
    last_verified_at=excluded.last_verified_at,
    unbound_at=NULL, updated_at=excluded.updated_at
`)

function apiBaseUrl() {
  return String(process.env.DX_CLOUD_ACCOUNT_API_BASE_URL || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '')
}
function stored() { return rowByInstallation.get(installation.installationId) as StoredCloudSession | undefined }
function storedBinding() { return bindingByInstallation.get(installation.installationId) as StoredCloudBinding | undefined }
function organizationId(value: CloudTokenResponse | CloudMeResponse) { return String(value.organizationId || value.organization?.id || '').trim() || null }
function deviceId(value: CloudTokenResponse | CloudMeResponse) { return String(value.deviceId || value.device?.id || '').trim() || null }

function publicView(row: StoredCloudSession, online: boolean, now = Date.now()): CloudAccountView {
  const binding = storedBinding()
  return {
    loggedIn: true,
    online,
    user: { id: row.cloud_user_id, email: row.email, displayName: row.display_name, emailVerified: true },
    binding: {
      installationId: installation.installationId,
      devicePublicId: installation.devicePublicId,
      organizationId: binding?.organization_id || null,
      deviceId: binding?.device_id || null,
    },
    membership: currentCloudMembership(now),
    accessExpiresAt: row.access_expires_at,
    refreshExpiresAt: row.refresh_expires_at,
  }
}

function errorMessage(code: string, fallback: string) {
  const messages: Record<string, string> = {
    invalid_credentials: '邮箱或密码不正确', email_not_verified: '请先完成邮箱验证后再登录',
    account_disabled: '此账号已被停用', account_temporarily_locked: '登录尝试过多，账号已被临时锁定',
    invalid_access_token: '登录状态已失效，请重新登录', invalid_refresh_token: '登录状态已失效，请重新登录',
    device_already_bound: '此安装已经绑定其他在线组织，请先解绑',
  }
  return messages[code] || fallback || 'DX OS 账号服务暂时不可用'
}

async function remote<T>(path: string, init: RequestInit, options: CloudAccountOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await (options.fetchImpl || fetch)(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        'X-DX-Installation-Id': installation.installationId,
        'X-DX-Device-Public-Id': installation.devicePublicId,
        ...init.headers,
      },
      signal: controller.signal,
    })
    let body: Record<string, unknown> = {}
    try { body = await response.json() as Record<string, unknown> } catch { /* provider returned no JSON */ }
    if (!response.ok) {
      const code = String(body.error || 'cloud_account_error')
      throw new CloudAccountRemoteError(response.status, code, errorMessage(code, String(body.message || '')))
    }
    return body as T
  } catch (error) {
    if (error instanceof CloudAccountRemoteError) throw error
    if ((error as Error)?.name === 'AbortError') throw new Error('连接 DX OS 账号服务超时，请稍后重试')
    throw new Error('无法连接 DX OS 账号服务，请检查网络后重试')
  } finally { clearTimeout(timer) }
}

function persist(boundByLocalUserId: string, tokens: CloudTokenResponse, now: number, operation: 'bind' | 'refresh') {
  if (!tokens.accessToken || !tokens.refreshToken || !tokens.user?.id || !tokens.user?.email) throw new Error('DX OS 账号服务返回了无效的登录数据')
  const row: StoredCloudSession = {
    installation_id: installation.installationId, cloud_user_id: tokens.user.id,
    email: tokens.user.email.trim().toLowerCase(), display_name: tokens.user.displayName || null,
    access_token_enc: encryptSecret(tokens.accessToken), refresh_token_enc: encryptSecret(tokens.refreshToken),
    access_expires_at: now + Math.max(0, Number(tokens.accessTokenExpiresIn) || 0) * 1000,
    // 刷新成功代表服务器确认当前登录仍有效。使用服务器本次返回的新有效期，
    // 不再沿用首次登录时的固定截止时间。
    refresh_expires_at: now + Math.max(0, Number(tokens.refreshTokenExpiresIn) || 0) * 1000,
    updated_at: now,
  }
  const save = ccsDb.transaction(() => {
    const currentSession = stored()
    const currentBinding = storedBinding()
    if (operation === 'bind' && (currentSession || currentBinding?.status === 'active')) {
      throw new Error('此 DX OS 安装已经绑定在线账号，如需更换请先明确注销当前绑定')
    }
    if (operation === 'refresh' && (!currentSession || currentSession.cloud_user_id !== row.cloud_user_id || currentBinding?.status !== 'active' || currentBinding.cloud_user_id !== row.cloud_user_id)) {
      throw new Error('本地在线绑定状态不一致，请注销后重新绑定')
    }
    saveSession.run(row.installation_id, row.cloud_user_id, row.email, row.display_name, row.access_token_enc, row.refresh_token_enc, row.access_expires_at, row.refresh_expires_at, row.updated_at)
    saveBinding.run(randomUUID(), row.installation_id, row.cloud_user_id, organizationId(tokens), deviceId(tokens), boundByLocalUserId, now, now, now)
  })
  save.immediate()
  persistCloudEntitlement(tokens.entitlement, now)
  return row
}

/** 旧版按本地用户存储多份会话；升级时只采用最近使用的一份，旧表结构保留供代码回退。 */
export function migrateLegacyCloudAccountSession() {
  if (stored() || storedBinding()) return false
  const legacy = ccsDb.prepare('SELECT * FROM cloud_account_sessions ORDER BY updated_at DESC LIMIT 1').get() as LegacyCloudSession | undefined
  if (!legacy) return false
  const migrate = ccsDb.transaction(() => {
    saveSession.run(installation.installationId, legacy.cloud_user_id, legacy.email, legacy.display_name, legacy.access_token_enc, legacy.refresh_token_enc, legacy.access_expires_at, legacy.refresh_expires_at, legacy.updated_at)
    saveBinding.run(randomUUID(), installation.installationId, legacy.cloud_user_id, null, null, legacy.local_user_id, legacy.updated_at, legacy.updated_at, legacy.updated_at)
    // 旧代码回退后应看到“未登录”，不能重新激活迁移前可能已过期或已更换的账号。
    ccsDb.prepare('DELETE FROM cloud_account_sessions').run()
  })
  migrate.immediate()
  return true
}
migrateLegacyCloudAccountSession()

function clearLocalBinding(now: number, status: 'revoked' | 'unbound') {
  const clear = ccsDb.transaction(() => {
    deleteSession.run(installation.installationId)
    ccsDb.prepare('UPDATE cloud_installation_binding SET status=?, unbound_at=?, updated_at=? WHERE installation_id=?')
      .run(status, now, now, installation.installationId)
  })
  clear.immediate()
  clearCloudEntitlement()
}

async function refreshSession(boundByLocalUserId: string, row: StoredCloudSession, options: CloudAccountOptions) {
  const existing = refreshes.get(installation.installationId)
  if (existing) return existing
  const promise = (async () => {
    const now = (options.now || Date.now)()
    const tokens = await remote<CloudTokenResponse>('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: decryptSecret(row.refresh_token_enc), installationId: installation.installationId, devicePublicId: installation.devicePublicId }),
    }, options)
    return persist(boundByLocalUserId, tokens, now, 'refresh')
  })()
  refreshes.set(installation.installationId, promise)
  try { return await promise } finally { refreshes.delete(installation.installationId) }
}

async function currentUser(row: StoredCloudSession, options: CloudAccountOptions) {
  const me = await remote<CloudMeResponse>('/v1/auth/me', { method: 'GET', headers: { Authorization: `Bearer ${decryptSecret(row.access_token_enc)}` } }, options)
  persistCloudEntitlement(me.entitlement, (options.now || Date.now)())
  return me
}

export async function loginCloudAccount(localUserId: string, email: string, password: string, options: CloudAccountOptions = {}): Promise<CloudAccountView> {
  if (stored() || storedBinding()?.status === 'active') throw new Error('此 DX OS 安装已经绑定在线账号，如需更换请先明确注销当前绑定')
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!/^[^@\s:]+@[^@\s:]+\.[^@\s:]+$/.test(normalizedEmail)) throw new Error('请输入有效的邮箱地址')
  if (!password || password.length > 1024) throw new Error('请输入账号密码')
  const now = (options.now || Date.now)()
  const tokens = await remote<CloudTokenResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: normalizedEmail, password, deviceName: 'DX OS Desktop', installationId: installation.installationId, devicePublicId: installation.devicePublicId }),
  }, options)
  return publicView(persist(localUserId, tokens, now, 'bind'), true, now)
}

export async function cloudAccountStatus(localUserId: string, options: CloudAccountOptions = {}): Promise<CloudAccountStatus> {
  let row = stored()
  if (!row) return { loggedIn: false, online: true, user: null }
  const now = (options.now || Date.now)()
  const initialBinding = storedBinding()
  if (initialBinding?.status !== 'active' || initialBinding.cloud_user_id !== row.cloud_user_id) {
    clearLocalBinding(now, 'revoked')
    return { loggedIn: false, online: true, user: null }
  }
  const verifiedElapsed = initialBinding.last_verified_at == null ? Number.POSITIVE_INFINITY : now - initialBinding.last_verified_at
  if (verifiedElapsed >= 0 && verifiedElapsed < ACCOUNT_VERIFICATION_INTERVAL_MS) {
    return publicView(row, true, now)
  }
  try {
    if (row.access_expires_at <= now + ACCESS_REFRESH_WINDOW_MS) row = await refreshSession(localUserId, row, options)
    const me = await currentUser(row, options)
    if (!me.authenticated || !me.user?.id || me.user.id !== row.cloud_user_id) throw new CloudAccountRemoteError(401, 'invalid_access_token', '登录状态已失效，请重新登录')
    const nextEmail = me.user.email.trim().toLowerCase()
    const nextDisplayName = me.user.displayName || null
    if (nextEmail !== row.email || nextDisplayName !== row.display_name) {
      row = { ...row, email: nextEmail, display_name: nextDisplayName, updated_at: now }
      saveSession.run(row.installation_id, row.cloud_user_id, row.email, row.display_name, row.access_token_enc, row.refresh_token_enc, row.access_expires_at, row.refresh_expires_at, row.updated_at)
    }
    ccsDb.prepare(`UPDATE cloud_installation_binding
      SET organization_id=COALESCE(?, organization_id), device_id=COALESCE(?, device_id), last_verified_at=?, updated_at=?
      WHERE installation_id=? AND status='active'`).run(organizationId(me), deviceId(me), now, now, installation.installationId)
    return publicView(row, true, now)
  } catch (error) {
    if (error instanceof CloudAccountRemoteError && error.status === 401) {
      try {
        row = await refreshSession(localUserId, row, options)
        await currentUser(row, options)
        return publicView(row, true, now)
      } catch (refreshError) {
        if (refreshError instanceof CloudAccountRemoteError && refreshError.status === 401) {
          clearLocalBinding(now, 'revoked')
          return { loggedIn: false, online: true, user: null }
        }
        throw refreshError
      }
    }
    return publicView(row, false, now)
  }
}

export async function uploadCloudTemporaryMedia(
  localUserId: string,
  input: { data: Buffer; mime: string; name: string },
  options: CloudAccountOptions = {},
): Promise<CloudTemporaryMediaResult> {
  if (!input.data.length) throw new Error('上传文件不能为空')
  if (input.data.length > 50 * 1024 * 1024) throw new Error('大雄图床单个文件不能超过 50 MB')
  if (!/^(?:image|video|audio)\/[a-z0-9][a-z0-9.+-]{0,126}$/i.test(input.mime)) {
    throw new Error('大雄图床仅支持图片、视频和音频文件')
  }
  let row = stored()
  const binding = storedBinding()
  if (!row || binding?.status !== 'active' || binding.cloud_user_id !== row.cloud_user_id) {
    throw new Error('使用大雄图床前，请先在“系统设置 → 系统信息”登录 DX OS 在线账号')
  }
  const now = (options.now || Date.now)()
  if (row.access_expires_at <= now + ACCESS_REFRESH_WINDOW_MS) row = await refreshSession(localUserId, row, options)

  const send = async (session: StoredCloudSession) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 240_000)
    try {
      return await (options.fetchImpl || fetch)(`${apiBaseUrl()}/v1/media/temp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${decryptSecret(session.access_token_enc)}`,
          'Content-Type': input.mime,
          'Content-Length': String(input.data.length),
          'X-File-Name': encodeURIComponent(input.name || 'media.bin'),
          'X-DX-Installation-Id': installation.installationId,
          'X-DX-Device-Public-Id': installation.devicePublicId,
        },
        body: input.data,
        signal: controller.signal,
      })
    } finally { clearTimeout(timer) }
  }

  try {
    let response = await send(row)
    if (response.status === 401) {
      row = await refreshSession(localUserId, row, options)
      response = await send(row)
    }
    let body: Record<string, unknown> = {}
    try { body = await response.json() as Record<string, unknown> } catch { /* keep empty response */ }
    if (!response.ok) {
      const message = String(body.message || body.error || `HTTP ${response.status}`)
      if (response.status === 401) throw new Error('DX OS 在线账号登录已失效，请重新登录')
      throw new Error(message)
    }
    const url = String(body.url || '')
    if (!/^https:\/\//i.test(url)) throw new Error('大雄图床返回了无效的公网地址')
    return {
      uploaded: true,
      id: String(body.id || ''),
      url,
      fileName: String(body.fileName || input.name),
      fileSize: Number(body.fileSize || input.data.length),
      contentType: String(body.contentType || input.mime),
      expiresAt: Number(body.expiresAt || 0),
      expiresIn: Number(body.expiresIn || 86_400),
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw new Error('上传大雄图床超时，请稍后重试')
    throw error
  }
}

export async function logoutCloudAccount(_localUserId: string, options: CloudAccountOptions = {}) {
  const row = stored()
  const now = (options.now || Date.now)()
  clearLocalBinding(now, 'unbound')
  if (!row) return { loggedOut: true, remoteLogout: true }
  try {
    await remote('/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: decryptSecret(row.refresh_token_enc), installationId: installation.installationId, devicePublicId: installation.devicePublicId }),
    }, options)
    return { loggedOut: true, remoteLogout: true }
  } catch { return { loggedOut: true, remoteLogout: false } }
}
