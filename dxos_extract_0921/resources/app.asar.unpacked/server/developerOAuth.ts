import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'
import { ccsDb } from './ccsDb.ts'
import { isPrivateNetworkAddress } from './networkSafety.ts'

export interface DeveloperOAuthDeclaration { id: string; authorizationUrl: string; tokenUrl: string; clientId: string; scopes: string[]; domains: string[] }
interface PendingOAuth { state: string; userId: string; appId: string; config: DeveloperOAuthDeclaration; verifier: string; redirectUri: string; expiresAt: number }

const DATA_DIR = dataPath('app-security')
const KEY_FILE = join(DATA_DIR, 'oauth-token.key')
const pending = new Map<string, PendingOAuth>()

function base64url(value: Buffer) { return value.toString('base64url') }
function key() {
  mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(KEY_FILE)) {
    writeFileSync(KEY_FILE, randomBytes(32))
    try { chmodSync(KEY_FILE, 0o600) } catch { /* Windows ACL is inherited from data directory */ }
  }
  const value = readFileSync(KEY_FILE)
  if (value.byteLength !== 32) throw new Error('OAuth Token 加密密钥无效')
  return value
}
function encrypt(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${base64url(iv)}.${base64url(cipher.getAuthTag())}.${base64url(encrypted)}`
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split('.').map((item) => Buffer.from(item, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function beginDeveloperOAuth(userId: string, appId: string, config: DeveloperOAuthDeclaration, origin: string) {
  const state = base64url(randomBytes(24))
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const redirectUri = `${origin.replace(/\/$/, '')}/api/developer-oauth/callback`
  const record: PendingOAuth = { state, userId, appId, config, verifier, redirectUri, expiresAt: Date.now() + 10 * 60_000 }
  pending.set(state, record)
  const url = new URL(config.authorizationUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (config.scopes.length) url.searchParams.set('scope', config.scopes.join(' '))
  return { state, url: url.toString(), expiresAt: record.expiresAt }
}

export async function completeDeveloperOAuth(state: string, code: string) {
  const record = pending.get(state)
  pending.delete(state)
  if (!record || record.expiresAt < Date.now()) throw new Error('OAuth 授权状态不存在或已过期')
  if (!code) throw new Error('OAuth 回调缺少授权码')
  const tokenUrl = new URL(record.config.tokenUrl)
  const addresses = await lookup(tokenUrl.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((item) => isPrivateNetworkAddress(item.address))) throw new Error('OAuth Token 地址解析到了内网或保留地址')
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: record.redirectUri, client_id: record.config.clientId, code_verifier: record.verifier })
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`OAuth Token 交换失败：HTTP ${response.status}`)
  const raw = await response.text()
  if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('OAuth Token 响应过大')
  const token = JSON.parse(raw) as { access_token?: string; refresh_token?: string; token_type?: string; scope?: string; expires_in?: number }
  if (!token.access_token) throw new Error('OAuth Token 响应缺少 access_token')
  const expiresAt = Number(token.expires_in) > 0 ? Date.now() + Number(token.expires_in) * 1000 : null
  ccsDb.prepare(`INSERT INTO app_oauth_tokens(user_id,app_id,oauth_id,access_token_enc,refresh_token_enc,token_type,scope,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,app_id,oauth_id) DO UPDATE SET access_token_enc=excluded.access_token_enc,refresh_token_enc=excluded.refresh_token_enc,token_type=excluded.token_type,scope=excluded.scope,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
    .run(record.userId, record.appId, record.config.id, encrypt(token.access_token), token.refresh_token ? encrypt(token.refresh_token) : null, token.token_type || 'Bearer', token.scope || record.config.scopes.join(' '), expiresAt, Date.now())
  return { appId: record.appId, oauthId: record.config.id, state, authorized: true }
}

export function developerOAuthStatus(userId: string, appId: string, oauthId: string) {
  const row = ccsDb.prepare('SELECT token_type AS tokenType,scope,expires_at AS expiresAt,updated_at AS updatedAt FROM app_oauth_tokens WHERE user_id=? AND app_id=? AND oauth_id=?').get(userId, appId, oauthId) as { tokenType: string; scope: string | null; expiresAt: number | null; updatedAt: number } | undefined
  return row ? { oauthId, authorized: true, expired: !!row.expiresAt && row.expiresAt <= Date.now(), ...row } : { oauthId, authorized: false }
}

export async function developerOAuthAccess(userId: string, appId: string, config: DeveloperOAuthDeclaration) {
  const row = ccsDb.prepare('SELECT access_token_enc AS accessToken,refresh_token_enc AS refreshToken,token_type AS tokenType,expires_at AS expiresAt FROM app_oauth_tokens WHERE user_id=? AND app_id=? AND oauth_id=?').get(userId, appId, config.id) as { accessToken: string; refreshToken: string | null; tokenType: string; expiresAt: number | null } | undefined
  if (!row) throw new Error('OAuth 尚未授权')
  if (row.expiresAt && row.expiresAt <= Date.now() + 30_000) {
    if (!row.refreshToken) throw new Error('OAuth access_token 已过期且没有 refresh_token，请重新授权')
    const tokenUrl = new URL(config.tokenUrl)
    const addresses = await lookup(tokenUrl.hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some((item) => isPrivateNetworkAddress(item.address))) throw new Error('OAuth Token 地址解析到了内网或保留地址')
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(row.refreshToken), client_id: config.clientId })
    const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`OAuth Token 刷新失败：HTTP ${response.status}`)
    const raw = await response.text()
    if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('OAuth Token 刷新响应过大')
    const token = JSON.parse(raw) as { access_token?: string; refresh_token?: string; token_type?: string; scope?: string; expires_in?: number }
    if (!token.access_token) throw new Error('OAuth Token 刷新响应缺少 access_token')
    row.accessToken = encrypt(token.access_token)
    row.refreshToken = token.refresh_token ? encrypt(token.refresh_token) : row.refreshToken
    row.tokenType = token.token_type || row.tokenType || 'Bearer'
    row.expiresAt = Number(token.expires_in) > 0 ? Date.now() + Number(token.expires_in) * 1000 : null
    ccsDb.prepare('UPDATE app_oauth_tokens SET access_token_enc=?,refresh_token_enc=?,token_type=?,scope=COALESCE(?,scope),expires_at=?,updated_at=? WHERE user_id=? AND app_id=? AND oauth_id=?')
      .run(row.accessToken, row.refreshToken, row.tokenType, token.scope || null, row.expiresAt, Date.now(), userId, appId, config.id)
  }
  return { accessToken: decrypt(row.accessToken), tokenType: row.tokenType || 'Bearer', domains: config.domains }
}

export function oauthCallbackHtml(result: { state: string; ok: boolean; message?: string }) {
  const payload = JSON.stringify({ dxos: 'v1', type: 'oauth.result', ...result }).replace(/</g, '\\u003c')
  return `<!doctype html><meta charset="utf-8"><title>DX OS OAuth</title><body><p>${result.ok ? '授权完成，可以关闭此窗口。' : '授权失败，请返回 DX OS 重试。'}</p><script>if(window.opener)window.opener.postMessage(${payload},location.origin);setTimeout(function(){window.close()},600)</script></body>`
}
