import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { Request, Response } from 'express'
import { db } from './authDb.ts'
import { listDeveloperApps } from './developerApps.ts'
import { installedApps } from './userPreferences.ts'
import type { ManagedAppAccessDescriptor } from '../shared/appAccess.ts'
import { currentSignedEntitlement } from './cloudEntitlement.ts'

const scryptAsync = promisify(scrypt)
const SESSION_DAYS = Math.max(1, Number(process.env.AUTH_SESSION_DAYS) || 30)
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000
const COOKIE_NAME = 'ccs_session'
const BASE_LOCAL_ACCOUNT_LIMIT = 3

export type SystemRole = 'superadmin' | 'admin' | 'user'

interface AuthUserRow {
  id: string
  username: string
  username_key: string
  password_hash: string
  department_id: string | null
  role: SystemRole
  status: 'active' | 'disabled'
  force_password_change?: number
  created_at: number
  updated_at: number
}

export interface AuthUser {
  id: string
  username: string
  departmentId: string | null
  role: SystemRole
  status?: 'active' | 'disabled'
  /** 首次登录（默认密码建号）需要修改密码 */
  forcePasswordChange?: boolean
  /** 当前权益额度之外的历史账号：保留数据，但禁止建立或继续使用会话。 */
  entitlementSuspended?: boolean
}

export interface AuthDepartment {
  id: string
  name: string
  parentId: string | null
  status: 'active' | 'disabled'
}

export interface LocalAccountEntitlement {
  maxLocalAccounts: number
  currentAccounts: number
  remainingAccounts: number
  maxDepartments: number
  currentDepartments: number
  departmentsEnabled: boolean
  advancedAppPolicyEnabled: boolean
  source: 'base' | 'signed'
}

export type AppAccessMode = 'all' | 'superadmins' | 'admins' | 'departments'
export interface AppAccessRule {
  mode: AppAccessMode
  departmentIds: string[]
}

export type PermissionDecision = 'allow' | 'deny'
export type DataScope = 'all' | 'department' | 'departments' | 'self' | 'none'
export interface AppPermissionPolicy {
  decision: PermissionDecision
  userIds: string[]
  departmentIds: string[]
  roles: SystemRole[]
  dataScope?: DataScope
}
export interface PermissionManifest {
  appId: string
  appName: string
  permissions: { code: string; label: string; description?: string; dataScope?: boolean }[]
}

export interface AuthContext {
  sessionId: string
  user: AuthUser
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

export type AuthenticatedRequest = Request & { auth?: AuthContext }

db.exec(`
CREATE TABLE IF NOT EXISTS auth_departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  department_id TEXT REFERENCES auth_departments(id),
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES auth_users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  detail_json TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_access_rules (
  app_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('all', 'superadmins', 'admins', 'departments')),
  department_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT REFERENCES auth_users(id),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_permission_policies (
  permission_code TEXT PRIMARY KEY,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  user_ids_json TEXT NOT NULL DEFAULT '[]',
  department_ids_json TEXT NOT NULL DEFAULT '[]',
  roles_json TEXT NOT NULL DEFAULT '[]',
  data_scope TEXT,
  updated_by TEXT REFERENCES auth_users(id),
  updated_at INTEGER NOT NULL
);
`)

// 增量列：首登改密标记。
const userColumns = (db.prepare('PRAGMA table_info(auth_users)').all() as { name: string }[]).map((c) => c.name)
if (!userColumns.includes('force_password_change')) db.exec('ALTER TABLE auth_users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0')

// SQLite 不能直接修改 CHECK 约束；保留已有规则并一次性扩展打开权限模式。
const appAccessSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_access_rules'").get() as { sql?: string } | undefined
if (appAccessSchema?.sql && !appAccessSchema.sql.includes("'superadmins'")) {
  db.exec(`
    BEGIN;
    ALTER TABLE app_access_rules RENAME TO app_access_rules_legacy;
    CREATE TABLE app_access_rules (
      app_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('all', 'superadmins', 'admins', 'departments')),
      department_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_by TEXT REFERENCES auth_users(id),
      updated_at INTEGER NOT NULL
    );
    INSERT INTO app_access_rules (app_id,mode,department_ids_json,updated_by,updated_at)
      SELECT app_id,mode,department_ids_json,updated_by,updated_at FROM app_access_rules_legacy;
    DROP TABLE app_access_rules_legacy;
    COMMIT;
  `)
}

function now() { return Date.now() }
function normalizeUsername(username: string) { return username.trim().toLocaleLowerCase('zh-CN') }
function hashToken(token: string) { return createHash('sha256').update(token).digest('hex') }

// 兼容升级前可能已存在的多端登录：每个账号仅保留最新创建的未撤销会话，
// 再通过部分唯一索引把“单账号单会话”固化成数据库不变量。
db.prepare(`
  UPDATE auth_sessions
  SET revoked_at=?
  WHERE revoked_at IS NULL AND EXISTS (
    SELECT 1 FROM auth_sessions AS newer
    WHERE newer.user_id=auth_sessions.user_id
      AND newer.revoked_at IS NULL
      AND (newer.created_at>auth_sessions.created_at
        OR (newer.created_at=auth_sessions.created_at AND newer.id>auth_sessions.id))
  )
`).run(now())
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_one_active_user ON auth_sessions(user_id) WHERE revoked_at IS NULL')

function loginEligibleUserIds() {
  const entitlement = localAccountEntitlement()
  const maxLocalAccounts = entitlement.maxLocalAccounts
  const rows = db.prepare("SELECT id,role FROM auth_users WHERE status='active' ORDER BY created_at ASC,id ASC").all() as { id: string; role: SystemRole }[]
  const eligible = new Set<string>()
  const oldestSuperadmin = rows.find((row) => row.role === 'superadmin')
  if (oldestSuperadmin && maxLocalAccounts > 0) eligible.add(oldestSuperadmin.id)
  for (const row of rows) {
    if (eligible.size >= maxLocalAccounts) break
    eligible.add(row.id)
  }
  return eligible
}

function publicUser(row: AuthUserRow, eligibleIds = loginEligibleUserIds()): AuthUser {
  return {
    id: row.id, username: row.username, departmentId: row.department_id, role: row.role, status: row.status,
    ...(row.force_password_change ? { forcePasswordChange: true } : {}),
    ...(row.status === 'active' && !eligibleIds.has(row.id) ? { entitlementSuspended: true } : {}),
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const key = await scryptAsync(password, salt, 64) as Buffer
  return `scrypt$${salt}$${key.toString('base64url')}`
}

async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, expected] = encoded.split('$')
  if (algorithm !== 'scrypt' || !salt || !expected) return false
  const derived = await scryptAsync(password, salt, 64) as Buffer
  const stored = Buffer.from(expected, 'base64url')
  return stored.length === derived.length && timingSafeEqual(stored, derived)
}

function validateCredentials(username: string, password: string) {
  if (username.trim().length < 2) throw new Error('用户名至少需要 2 个字符')
  if (!password.length) throw new Error('密码不能为空')
}

function parseCookies(req: Request) {
  const out: Record<string, string> = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    if (!key) continue
    try { out[key] = decodeURIComponent(part.slice(index + 1).trim()) } catch { /* ignore malformed cookie */ }
  }
  return out
}

function cookieSecure(req: Request) {
  if (process.env.AUTH_COOKIE_SECURE === '1') return true
  if (process.env.AUTH_COOKIE_SECURE === '0') return false
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
  return req.secure === true || req.protocol === 'https' || forwardedProtocol === 'https'
}
function setSessionCookie(req: Request, res: Response, token: string) {
  const flags = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_MS / 1000)}`]
  if (cookieSecure(req)) flags.push('Secure')
  res.append('Set-Cookie', flags.join('; '))
}
function clearSessionCookie(req: Request, res: Response) {
  const flags = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (cookieSecure(req)) flags.push('Secure')
  res.append('Set-Cookie', flags.join('; '))
}

function audit(action: string, resourceType: string, input: { actorUserId?: string; resourceId?: string; detail?: object; ip?: string } = {}) {
  db.prepare(`INSERT INTO auth_audit_logs (id,actor_user_id,action,resource_type,resource_id,detail_json,ip,created_at)
    VALUES (@id,@actorUserId,@action,@resourceType,@resourceId,@detailJson,@ip,@createdAt)`).run({
    id: randomUUID(), actorUserId: input.actorUserId || null, action, resourceType, resourceId: input.resourceId || null,
    detailJson: input.detail ? JSON.stringify(input.detail) : null, ip: input.ip || null, createdAt: now(),
  })
}

function findUserByUsername(username: string) {
  return db.prepare('SELECT * FROM auth_users WHERE username_key=?').get(normalizeUsername(username)) as AuthUserRow | undefined
}

function createSession(user: AuthUserRow) {
  return db.transaction(() => {
    const id = randomUUID()
    const token = randomBytes(32).toString('base64url')
    const createdAt = now()
    // 本地账号只允许一个有效会话。新登录与撤销旧会话必须处于同一事务，
    // 避免两个局域网浏览器并发登录时同时留下有效 token。
    const revokedSessionCount = db.prepare(
      'UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
    ).run(createdAt, user.id).changes
    db.prepare(`INSERT INTO auth_sessions (id,user_id,token_hash,created_at,expires_at,last_seen_at)
      VALUES (?,?,?,?,?,?)`).run(id, user.id, hashToken(token), createdAt, createdAt + SESSION_MS, createdAt)
    return { id, token, revokedSessionCount }
  })()
}

export function authStatus() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM auth_users').get() as { count: number }
  return { initialized: row.count > 0, sessionDays: SESSION_DAYS }
}

export async function bootstrap(username: string, password: string, ip?: string) {
  validateCredentials(username, password)
  const passwordHash = await hashPassword(password)
  const create = db.transaction(() => {
    const count = (db.prepare('SELECT COUNT(*) AS count FROM auth_users').get() as { count: number }).count
    if (count) throw new Error('系统已经初始化，请使用登录接口')
    const createdAt = now()
    const user: AuthUserRow = {
      id: randomUUID(), username: username.trim(), username_key: normalizeUsername(username), password_hash: passwordHash,
      department_id: null, role: 'superadmin', status: 'active', created_at: createdAt, updated_at: createdAt,
    }
    db.prepare(`INSERT INTO auth_users (id,username,username_key,password_hash,department_id,role,status,created_at,updated_at)
      VALUES (@id,@username,@username_key,@password_hash,@department_id,@role,@status,@created_at,@updated_at)`).run(user)
    return user
  })
  const user = create()
  const session = createSession(user)
  audit('auth.bootstrap', 'user', { actorUserId: user.id, resourceId: user.id, ip })
  return { user: publicUser(user), token: session.token }
}

export async function login(username: string, password: string, ip?: string) {
  const user = findUserByUsername(username)
  if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
    audit('auth.login.failed', 'session', { detail: { username: username.trim() }, ip })
    return null
  }
  if (!loginEligibleUserIds().has(user.id)) {
    audit('auth.login.entitlement_suspended', 'session', { actorUserId: user.id, detail: { username: user.username }, ip })
    throw new Error('此账号超出当前本地账号额度，数据仍然保留。请使用基础保留账号登录，或恢复会员权益后再登录。')
  }
  const session = createSession(user)
  audit('auth.login', 'session', {
    actorUserId: user.id,
    resourceId: session.id,
    detail: { revokedSessionCount: session.revokedSessionCount },
    ip,
  })
  return { user: publicUser(user), token: session.token }
}

export function getAuth(req: Request): AuthContext | null {
  const token = parseCookies(req)[COOKIE_NAME]
  if (!token) return null
  const row = db.prepare(`SELECT s.id AS session_id, u.* FROM auth_sessions s
    JOIN auth_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active'`).get(hashToken(token), now()) as (AuthUserRow & { session_id: string }) | undefined
  if (!row) return null
  if (!loginEligibleUserIds().has(row.id)) {
    db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE id=?').run(now(), row.session_id)
    audit('auth.session.entitlement_suspended', 'session', { actorUserId: row.id, resourceId: row.session_id })
    return null
  }
  db.prepare('UPDATE auth_sessions SET last_seen_at=? WHERE id=?').run(now(), row.session_id)
  return { sessionId: row.session_id, user: publicUser(row) }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: () => void) {
  const auth = getAuth(req)
  if (!auth) {
    res.status(401).json({ ok: false, error: '请先登录' })
    return
  }
  req.auth = auth
  next()
}

export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: () => void) {
  requireAuth(req, res, () => {
    if (req.auth?.user.role !== 'superadmin') {
      res.status(403).json({ ok: false, error: '需要超级管理员权限' })
      return
    }
    next()
  })
}

// “本地超级管理员”与未来的 DX OS 在线组织角色是两套独立权限。
// 保留旧名称兼容已有路由，新接入云账号/会员能力时使用明确名称，避免混淆。
export const requireLocalSuperAdmin = requireSuperAdmin

export function loginResponse(req: Request, res: Response, result: { user: AuthUser; token: string }) {
  setSessionCookie(req, res, result.token)
  return { user: result.user, sessionDays: SESSION_DAYS }
}

export function logout(req: Request, res: Response, ip?: string) {
  const token = parseCookies(req)[COOKIE_NAME]
  const auth = getAuth(req)
  if (token) db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=?').run(now(), hashToken(token))
  clearSessionCookie(req, res)
  if (auth) audit('auth.logout', 'session', { actorUserId: auth.user.id, resourceId: auth.sessionId, ip })
}

function parseList(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? [...new Set(parsed.map(String).map((item) => item.trim()).filter(Boolean))] : []
  } catch {
    return []
  }
}

function userRows() {
  return db.prepare('SELECT * FROM auth_users ORDER BY created_at ASC').all() as AuthUserRow[]
}

export function listAuthUsers(): AuthUser[] {
  const eligibleIds = loginEligibleUserIds()
  return userRows().map((row) => publicUser(row, eligibleIds))
}

/**
 * 第一层只提供完全离线可验证的基础额度。第二层会在这里接入云端签名权益，
 * 但 createAuthUser 内的服务端事务检查仍是最终安全边界。
 */
export function localAccountEntitlement(): LocalAccountEntitlement {
  const currentAccounts = (db.prepare('SELECT COUNT(*) AS count FROM auth_users').get() as { count: number }).count
  const currentDepartments = (db.prepare('SELECT COUNT(*) AS count FROM auth_departments').get() as { count: number }).count
  const signed = currentSignedEntitlement()
  const maxLocalAccounts = signed?.maxLocalAccounts || BASE_LOCAL_ACCOUNT_LIMIT
  const maxDepartments = signed?.maxDepartments || 0
  return {
    maxLocalAccounts,
    currentAccounts,
    remainingAccounts: Math.max(0, maxLocalAccounts - currentAccounts),
    maxDepartments,
    currentDepartments,
    departmentsEnabled: !!signed?.departmentsEnabled,
    advancedAppPolicyEnabled: !!signed?.advancedAppPolicyEnabled,
    source: signed ? 'signed' : 'base',
  }
}

function requireDepartmentEntitlement(creating = false) {
  const entitlement = localAccountEntitlement()
  if (!entitlement.departmentsEnabled) {
    throw new Error('部门和成员分配属于会员功能。现有部门数据会继续保留，恢复会员权益后即可继续管理。')
  }
  if (creating && entitlement.currentDepartments >= entitlement.maxDepartments) {
    throw new Error(`当前会员最多创建 ${entitlement.maxDepartments} 个部门。`)
  }
}

function requireAdvancedAppPolicyEntitlement() {
  if (!localAccountEntitlement().advancedAppPolicyEnabled) {
    throw new Error('精细 APP 权限属于会员功能。免费版中所有本地账号都可以打开已安装 APP。')
  }
}

export function listAuthDepartments(): AuthDepartment[] {
  return (db.prepare('SELECT id,name,parent_id,status FROM auth_departments ORDER BY name COLLATE NOCASE').all() as {
    id: string; name: string; parent_id: string | null; status: 'active' | 'disabled'
  }[]).map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id, status: row.status }))
}

export function createAuthDepartment(name: string, actor: AuthUser, ip?: string): AuthDepartment {
  requireDepartmentEntitlement(true)
  const trimmed = name.trim()
  if (trimmed.length < 2) throw new Error('部门名称至少需要 2 个字符')
  const department: AuthDepartment = { id: randomUUID(), name: trimmed, parentId: null, status: 'active' }
  const createdAt = now()
  try {
    db.prepare('INSERT INTO auth_departments (id,name,parent_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(department.id, department.name, null, department.status, createdAt, createdAt)
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('已存在同名部门')
    throw error
  }
  audit('department.create', 'department', { actorUserId: actor.id, resourceId: department.id, detail: { name: department.name }, ip })
  return department
}

export function updateAuthDepartment(id: string, name: string, actor: AuthUser, ip?: string): AuthDepartment {
  requireDepartmentEntitlement()
  const trimmed = name.trim()
  if (trimmed.length < 2) throw new Error('部门名称至少需要 2 个字符')
  const existing = db.prepare('SELECT id,name,parent_id,status FROM auth_departments WHERE id=?').get(id) as {
    id: string; name: string; parent_id: string | null; status: 'active' | 'disabled'
  } | undefined
  if (!existing) throw new Error('部门不存在')
  try {
    db.prepare('UPDATE auth_departments SET name=?,updated_at=? WHERE id=?').run(trimmed, now(), id)
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('已存在同名部门')
    throw error
  }
  audit('department.update', 'department', { actorUserId: actor.id, resourceId: id, detail: { before: existing.name, after: trimmed }, ip })
  return { id, name: trimmed, parentId: existing.parent_id, status: existing.status }
}

export function deleteAuthDepartment(id: string, actor: AuthUser, ip?: string) {
  requireDepartmentEntitlement()
  const existing = db.prepare('SELECT id,name FROM auth_departments WHERE id=?').get(id) as { id: string; name: string } | undefined
  if (!existing) throw new Error('部门不存在')
  const remove = db.transaction(() => {
    db.prepare('UPDATE auth_users SET department_id=NULL,updated_at=? WHERE department_id=?').run(now(), id)
    db.prepare('DELETE FROM auth_departments WHERE id=?').run(id)
  })
  remove()
  audit('department.delete', 'department', { actorUserId: actor.id, resourceId: id, detail: { name: existing.name }, ip })
}

function requireDepartmentId(departmentId: string | null | undefined) {
  if (!departmentId) return null
  const row = db.prepare('SELECT id FROM auth_departments WHERE id=? AND status=\'active\'').get(departmentId) as { id: string } | undefined
  if (!row) throw new Error('所属部门不存在或已停用')
  return row.id
}

export async function createAuthUser(input: { username: string; password: string; departmentId?: string | null; role?: SystemRole; forcePasswordChange?: boolean }, actor: AuthUser, ip?: string) {
  validateCredentials(input.username, input.password)
  if (input.departmentId) requireDepartmentEntitlement()
  const role: SystemRole = input.role === 'admin' || input.role === 'superadmin' ? input.role : 'user'
  const createdAt = now()
  const user: AuthUserRow = {
    id: randomUUID(), username: input.username.trim(), username_key: normalizeUsername(input.username), password_hash: await hashPassword(input.password),
    department_id: requireDepartmentId(input.departmentId), role, status: 'active', created_at: createdAt, updated_at: createdAt,
    force_password_change: input.forcePasswordChange ? 1 : 0,
  }
  const insert = db.transaction(() => {
    const entitlement = localAccountEntitlement()
    if (entitlement.currentAccounts >= entitlement.maxLocalAccounts) {
      throw new Error(`当前套餐最多创建 ${entitlement.maxLocalAccounts} 个本地账号。请由超级管理员在官网调整或升级套餐。`)
    }
    db.prepare(`INSERT INTO auth_users (id,username,username_key,password_hash,department_id,role,status,force_password_change,created_at,updated_at)
      VALUES (@id,@username,@username_key,@password_hash,@department_id,@role,@status,@force_password_change,@created_at,@updated_at)`).run(user)
  })
  try {
    insert()
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('用户名已存在')
    throw error
  }
  audit('user.create', 'user', { actorUserId: actor.id, resourceId: user.id, detail: { username: user.username, role, departmentId: user.department_id }, ip })
  return publicUser(user)
}

function ensureAnotherSuperAdmin(id: string, nextRole: SystemRole, nextStatus: 'active' | 'disabled') {
  const current = db.prepare('SELECT role,status FROM auth_users WHERE id=?').get(id) as { role: SystemRole; status: 'active' | 'disabled' } | undefined
  if (!current || current.role !== 'superadmin' || (nextRole === 'superadmin' && nextStatus === 'active')) return
  const count = (db.prepare("SELECT COUNT(*) AS count FROM auth_users WHERE role='superadmin' AND status='active' AND id<>?").get(id) as { count: number }).count
  if (!count) throw new Error('系统必须保留至少一位启用的超级管理员')
}

export function updateAuthUser(id: string, input: { username?: string; departmentId?: string | null; role?: SystemRole; status?: 'active' | 'disabled' }, actor: AuthUser, ip?: string) {
  const existing = db.prepare('SELECT * FROM auth_users WHERE id=?').get(id) as AuthUserRow | undefined
  if (!existing) throw new Error('用户不存在')
  const role: SystemRole = input.role === 'superadmin' || input.role === 'admin' || input.role === 'user' ? input.role : existing.role
  const status: 'active' | 'disabled' = input.status === 'disabled' ? 'disabled' : 'active'
  ensureAnotherSuperAdmin(id, role, status)
  const username = input.username === undefined ? existing.username : input.username.trim()
  if (username.length < 2) throw new Error('用户名至少需要 2 个字符')
  const requestedDepartmentId = input.departmentId === undefined ? existing.department_id : input.departmentId || null
  if (requestedDepartmentId !== existing.department_id) requireDepartmentEntitlement()
  const departmentId = input.departmentId === undefined ? existing.department_id : requireDepartmentId(input.departmentId)
  try {
    db.prepare(`UPDATE auth_users SET username=?,username_key=?,department_id=?,role=?,status=?,updated_at=? WHERE id=?`)
      .run(username, normalizeUsername(username), departmentId, role, status, now(), id)
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('用户名已存在')
    throw error
  }
  if (role !== existing.role || status !== existing.status) db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=?').run(now(), id)
  const row = db.prepare('SELECT * FROM auth_users WHERE id=?').get(id) as AuthUserRow
  audit('user.update', 'user', { actorUserId: actor.id, resourceId: id, detail: { role, departmentId, status }, ip })
  return publicUser(row)
}

export async function resetAuthPassword(id: string, password: string, actor: AuthUser, ip?: string) {
  validateCredentials('valid', password)
  const existing = db.prepare('SELECT id FROM auth_users WHERE id=?').get(id) as { id: string } | undefined
  if (!existing) throw new Error('用户不存在')
  db.prepare('UPDATE auth_users SET password_hash=?,force_password_change=1,updated_at=? WHERE id=?').run(await hashPassword(password), now(), id)
  db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=?').run(now(), id)
  audit('user.password.reset', 'user', { actorUserId: actor.id, resourceId: id, ip })
}

/** 用户本人修改密码（首登强制改密也走这里）。校验旧密码，改完保留当前会话。 */
export async function changeOwnPassword(userId: string, oldPassword: string, newPassword: string, ip?: string) {
  if (newPassword.length < 6) throw new Error('新密码至少 6 位')
  if (newPassword === oldPassword) throw new Error('新密码不能与旧密码相同')
  const row = db.prepare('SELECT * FROM auth_users WHERE id=?').get(userId) as AuthUserRow | undefined
  if (!row || row.status !== 'active') throw new Error('用户不存在')
  if (!(await verifyPassword(oldPassword, row.password_hash))) throw new Error('当前密码不正确')
  db.prepare('UPDATE auth_users SET password_hash=?,force_password_change=0,updated_at=? WHERE id=?').run(await hashPassword(newPassword), now(), userId)
  audit('user.password.change', 'user', { actorUserId: userId, resourceId: userId, ip })
}

export function deleteAuthUser(id: string, actor: AuthUser, ip?: string) {
  ensureAnotherSuperAdmin(id, 'user', 'disabled')
  const existing = db.prepare('SELECT username FROM auth_users WHERE id=?').get(id) as { username: string } | undefined
  if (!existing) throw new Error('用户不存在')
  const remove = db.transaction(() => {
    // 先解除全部外键引用：会话删除；审计与策略保留记录、脱离账号（列可为空，用户名已写入 detail）
    db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id)
    db.prepare('UPDATE auth_audit_logs SET actor_user_id=NULL WHERE actor_user_id=?').run(id)
    db.prepare('UPDATE app_permission_policies SET updated_by=NULL WHERE updated_by=?').run(id)
    db.prepare('UPDATE app_access_rules SET updated_by=NULL WHERE updated_by=?').run(id)
    db.prepare('DELETE FROM auth_users WHERE id=?').run(id)
  })
  remove()
  audit('user.delete', 'user', { actorUserId: actor.id, resourceId: id, detail: { username: existing.username }, ip })
}

export type AppAccessDescriptor = ManagedAppAccessDescriptor

// 系统入口始终存在；其余可配置项完全来自当前真实安装的独立 APP 包。
// APP 名称和说明也随包清单更新，不再维护另一份容易过期的固定名单。
const BUILTIN_APP_ACCESS_CATALOG: AppAccessDescriptor[] = [
  { id: 'market', name: '应用市场', desc: '获取、安装和管理 DX OS 应用。' },
  { id: 'developer-studio', name: 'DX Developer', desc: '开发、测试和安装 DX OS 应用。' },
]

function installedAppAccessCatalog(userId?: string): AppAccessDescriptor[] {
  const catalog = new Map(BUILTIN_APP_ACCESS_CATALOG.map((app) => [app.id, app]))
  const installedIds = userId ? new Set(installedApps(userId)) : null
  for (const pack of listDeveloperApps()) {
    if (installedIds && !installedIds.has(pack.id)) continue
    catalog.set(pack.id, {
      id: pack.id,
      name: pack.manifest.name,
      desc: pack.manifest.subtitle || pack.manifest.description || '已安装应用',
    })
  }
  return [...catalog.values()]
}

function defaultAppAccessRule(appId: string): AppAccessRule {
  return {
    mode: appId === 'lingxing' ? 'admins' : 'all',
    departmentIds: [],
  }
}
const BUILTIN_PERMISSION_MANIFESTS: PermissionManifest[] = []

function developerPermissionManifests(installedIds?: Set<string>): PermissionManifest[] {
  return listDeveloperApps()
    .filter((pack) => !installedIds || installedIds.has(pack.id))
    .filter((pack) => pack.capabilities?.permissions?.length)
    .map((pack) => {
      const tools = pack.capabilities?.tools || []
      return {
        appId: pack.id,
        appName: pack.manifest.name,
        permissions: [...new Set(pack.capabilities.permissions)].map((code) => {
          const tool = tools.find((item) => item.permission === code)
          const standard = ({
            'app-api.call': { label: '调用 APP API', description: '允许 Agent 调用这个 APP 对外开放的接口' },
            'ui.notify': { label: '发送系统通知', description: '允许这个 APP 的 Agent 能力发送系统通知' },
            'ui.external': { label: '打开外部页面', description: '允许这个 APP 的 Agent 能力打开外部页面' },
            'file.write': { label: '写入文件', description: '允许这个 APP 的 Agent 能力写入文件' },
            'realtime.room': { label: '使用实时房间', description: '允许这个 APP 创建、发现和加入局域网实时房间' },
            'collab.project': { label: '使用协同项目', description: '允许这个 APP 创建持久项目并按成员或邀请口令协作' },
          } as Record<string, { label: string; description: string }>)[code.split('.').slice(-2).join('.')]
          return {
            code,
            label: tool?.title || standard?.label || code.split('.').slice(-2).join('.'),
            description: tool?.description || standard?.description || `${pack.manifest.name} 声明的权限`,
          }
        }),
      }
    })
}

function permissionManifests(installedIds?: Set<string>) {
  return [...BUILTIN_PERMISSION_MANIFESTS, ...developerPermissionManifests(installedIds)]
}

function knownPermissionCodes() {
  return new Set(permissionManifests().flatMap((manifest) => manifest.permissions.map((permission) => permission.code)))
}

function ruleAllows(user: AuthUser, rule: AppAccessRule) {
  if (rule.mode === 'all') return true
  if (rule.mode === 'superadmins') return false
  if (rule.mode === 'admins') return user.role === 'admin'
  return !!user.departmentId && rule.departmentIds.includes(user.departmentId)
}

export function canOpenApp(user: AuthUser, appId: string) {
  if (user.role === 'superadmin') return true
  if (appId === 'api-settings' || appId === 'accounts') return false
  if (!installedAppAccessCatalog(user.id).some((app) => app.id === appId)) return true
  const rules = appPermissionSnapshot(user.id).externalAppAccess
  const rule = rules[appId] || defaultAppAccessRule(appId)
  if (ruleAllows(user, rule)) return true
  return false
}

export function canUseAppPermission(user: AuthUser | null | undefined, permissionCode: string) {
  const code = String(permissionCode || '').trim()
  if (!code) return true
  if (!user) return false
  const appId = code.match(/^app\.([a-z0-9][a-z0-9-]{1,48})\./)?.[1]
  // 能力声明是需求清单，不是第二套授权。能打开 APP 的用户自动获得
  // 其全部声明能力；底层文件、MCP、Skill 等操作仍由系统权限校验。
  return appId ? canOpenApp(user, appId) : true
}

function normalizeRule(input: Partial<AppAccessRule>): AppAccessRule {
  const mode: AppAccessMode = input.mode === 'superadmins' || input.mode === 'admins' || input.mode === 'departments' ? input.mode : 'all'
  return { mode, departmentIds: Array.isArray(input.departmentIds) ? [...new Set(input.departmentIds.map(String).filter(Boolean))] : [] }
}

function normalizePolicy(input: Partial<AppPermissionPolicy>): AppPermissionPolicy {
  const scope = input.dataScope
  return {
    decision: input.decision === 'allow' ? 'allow' : 'deny',
    userIds: Array.isArray(input.userIds) ? [...new Set(input.userIds.map(String).filter(Boolean))] : [],
    departmentIds: Array.isArray(input.departmentIds) ? [...new Set(input.departmentIds.map(String).filter(Boolean))] : [],
    roles: Array.isArray(input.roles) ? input.roles.filter((role): role is SystemRole => role === 'superadmin' || role === 'admin' || role === 'user') : [],
    ...(scope === 'all' || scope === 'department' || scope === 'departments' || scope === 'self' || scope === 'none' ? { dataScope: scope } : {}),
  }
}

export function appPermissionSnapshot(userId?: string) {
  const apps = installedAppAccessCatalog(userId)
  const installedIds = new Set(apps.map((app) => app.id))
  if (!localAccountEntitlement().advancedAppPolicyEnabled) {
    return {
      apps,
      externalAppAccess: Object.fromEntries(apps.map((app) => [app.id, { mode: 'all' as const, departmentIds: [] }])),
      permissionPolicies: {} as Record<string, AppPermissionPolicy>,
      permissionManifests: permissionManifests(installedIds),
    }
  }
  const appIds = new Set(apps.map((app) => app.id))
  const externalAppAccess: Record<string, AppAccessRule> = Object.fromEntries(apps.map((app) => [app.id, defaultAppAccessRule(app.id)]))
  for (const row of db.prepare('SELECT app_id,mode,department_ids_json FROM app_access_rules').all() as { app_id: string; mode: AppAccessMode; department_ids_json: string }[]) {
    if (appIds.has(row.app_id)) externalAppAccess[row.app_id] = normalizeRule({ mode: row.mode, departmentIds: parseList(row.department_ids_json) })
  }
  // 应用市场是其他按需 APP 的入口，不能被历史策略锁在管理员账号后面。
  if (appIds.has('market')) externalAppAccess.market = defaultAppAccessRule('market')
  const permissionPolicies: Record<string, AppPermissionPolicy> = {}
  for (const row of db.prepare('SELECT * FROM app_permission_policies').all() as { permission_code: string; decision: PermissionDecision; user_ids_json: string; department_ids_json: string; roles_json: string; data_scope: DataScope | null }[]) {
    permissionPolicies[row.permission_code] = normalizePolicy({ decision: row.decision, userIds: parseList(row.user_ids_json), departmentIds: parseList(row.department_ids_json), roles: parseList(row.roles_json) as SystemRole[], dataScope: row.data_scope || undefined })
  }
  return { apps, externalAppAccess, permissionPolicies, permissionManifests: permissionManifests(installedIds) }
}

export function saveAppAccessRule(appId: string, input: Partial<AppAccessRule>, actor: AuthUser, ip?: string) {
  requireAdvancedAppPolicyEntitlement()
  if (!installedAppAccessCatalog(actor.id).some((app) => app.id === appId)) throw new Error('该 APP 当前未安装，无法配置打开权限')
  const rule = appId === 'market' ? defaultAppAccessRule(appId) : normalizeRule(input)
  if (rule.mode === 'departments') for (const departmentId of rule.departmentIds) requireDepartmentId(departmentId)
  db.prepare(`INSERT INTO app_access_rules (app_id,mode,department_ids_json,updated_by,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(app_id) DO UPDATE SET mode=excluded.mode,department_ids_json=excluded.department_ids_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(appId, rule.mode, JSON.stringify(rule.departmentIds), actor.id, now())
  audit('app_access.update', 'app', { actorUserId: actor.id, resourceId: appId, detail: rule, ip })
  return rule
}

export function saveAppPermissionPolicy(permissionCode: string, input: Partial<AppPermissionPolicy>, actor: AuthUser, ip?: string) {
  requireAdvancedAppPolicyEntitlement()
  if (!knownPermissionCodes().has(permissionCode) && !/^app\.[a-z0-9][a-z0-9-]{1,48}\.[a-z][a-z0-9_.:-]{1,96}$/.test(permissionCode)) throw new Error('不支持的 APP 权限代码')
  const policy = normalizePolicy(input)
  for (const departmentId of policy.departmentIds) requireDepartmentId(departmentId)
  for (const userId of policy.userIds) {
    if (!db.prepare('SELECT id FROM auth_users WHERE id=?').get(userId)) throw new Error('权限目标用户不存在')
  }
  db.prepare(`INSERT INTO app_permission_policies (permission_code,decision,user_ids_json,department_ids_json,roles_json,data_scope,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(permission_code) DO UPDATE SET decision=excluded.decision,user_ids_json=excluded.user_ids_json,department_ids_json=excluded.department_ids_json,roles_json=excluded.roles_json,data_scope=excluded.data_scope,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(permissionCode, policy.decision, JSON.stringify(policy.userIds), JSON.stringify(policy.departmentIds), JSON.stringify(policy.roles), policy.dataScope || null, actor.id, now())
  audit('app_permission.update', 'permission', { actorUserId: actor.id, resourceId: permissionCode, detail: policy, ip })
  return policy
}

export function appAccessSummary(user: AuthUser) {
  const appIds = [...installedAppAccessCatalog(user.id).map((app) => app.id), 'api-settings', 'accounts']
  const summary = Object.fromEntries(appIds.map((appId) => [appId, canOpenApp(user, appId)]))
  return summary
}

export function requireAppOpen(appId: string) {
  return (req: AuthenticatedRequest, res: Response, next: () => void) => {
    requireAuth(req, res, () => {
      if (!req.auth || !canOpenApp(req.auth.user, appId)) {
        res.status(403).json({ ok: false, error: '当前账户没有打开该应用的权限' })
        return
      }
      next()
    })
  }
}
