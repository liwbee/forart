import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ccsDb } from './ccsDb.ts'

export type DeveloperCollabAccess = 'read' | 'edit' | 'owner'

interface ProjectRow {
  id: string
  app_id: string
  owner_id: string
  name: string
  kind: string
  document_json: string
  version: number
  created_at: number
  updated_at: number
}

interface MemberRow { user_id: string; access: 'read' | 'edit'; created_at: number }
interface InviteRow { id: string; project_id: string; code_hint: string; access: 'read' | 'edit'; created_at: number }

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

ccsDb.exec(`
  CREATE TABLE IF NOT EXISTS developer_collab_projects (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'project',
    document_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_developer_collab_projects_app_owner
    ON developer_collab_projects(app_id,owner_id,updated_at DESC);
  CREATE TABLE IF NOT EXISTS developer_collab_members (
    project_id TEXT NOT NULL REFERENCES developer_collab_projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    access TEXT NOT NULL CHECK(access IN ('read','edit')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(project_id,user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_developer_collab_members_user
    ON developer_collab_members(user_id,project_id);
  CREATE TABLE IF NOT EXISTS developer_collab_invites (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES developer_collab_projects(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    code_hint TEXT NOT NULL,
    access TEXT NOT NULL CHECK(access IN ('read','edit')),
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_developer_collab_invites_project
    ON developer_collab_invites(project_id,revoked_at);
`)

function cleanName(value: unknown) { return String(value || '').trim().slice(0, 100) || '未命名项目' }
function cleanKind(value: unknown) {
  const kind = String(value || 'project').trim().toLowerCase()
  return /^[a-z][a-z0-9-]{0,48}$/.test(kind) ? kind : 'project'
}
function cleanDocument(value: unknown) {
  const json = JSON.stringify(value ?? {})
  if (Buffer.byteLength(json, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('协同项目文档不能超过 2 MB')
  return json
}
function row(id: string) {
  return ccsDb.prepare('SELECT * FROM developer_collab_projects WHERE id=?').get(id) as ProjectRow | undefined
}
function members(id: string) {
  return ccsDb.prepare('SELECT user_id,access,created_at FROM developer_collab_members WHERE project_id=? ORDER BY created_at').all(id) as MemberRow[]
}
function invite(id: string) {
  return ccsDb.prepare(`SELECT id,project_id,code_hint,access,created_at FROM developer_collab_invites
    WHERE project_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(id) as InviteRow | undefined
}
function parseDocument(value: string) {
  try { return JSON.parse(value) as unknown } catch { return {} }
}
function accessFor(project: ProjectRow, userId: string): DeveloperCollabAccess | null {
  if (project.owner_id === userId) return 'owner'
  const member = ccsDb.prepare('SELECT access FROM developer_collab_members WHERE project_id=? AND user_id=?').get(project.id, userId) as { access: 'read' | 'edit' } | undefined
  return member?.access || null
}
function requireProject(appId: string, projectId: string, userId: string, required: 'read' | 'edit' | 'owner' = 'read') {
  const project = row(projectId)
  if (!project || project.app_id !== appId) throw new Error('协同项目不存在')
  const access = accessFor(project, userId)
  if (!access) throw new Error('没有该协同项目的访问权限')
  if (required === 'owner' && access !== 'owner') throw new Error('只有项目所有者可以执行此操作')
  if (required === 'edit' && access === 'read') throw new Error('该协同项目当前为只读')
  return { project, access }
}
function publicProject(project: ProjectRow, userId: string, includeDocument = false) {
  const access = accessFor(project, userId)
  const activeInvite = access === 'owner' ? invite(project.id) : undefined
  return {
    id: project.id,
    appId: project.app_id,
    ownerId: project.owner_id,
    name: project.name,
    kind: project.kind,
    version: project.version,
    access,
    members: members(project.id).map((member) => ({ userId: member.user_id, access: member.access })),
    ...(activeInvite ? { invite: { id: activeInvite.id, codeHint: activeInvite.code_hint, access: activeInvite.access, createdAt: activeInvite.created_at } } : {}),
    ...(includeDocument ? { document: parseDocument(project.document_json) } : {}),
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  }
}

export function createDeveloperCollabProject(appId: string, ownerId: string, input: { name?: unknown; kind?: unknown; document?: unknown }) {
  const id = randomUUID()
  const ts = Date.now()
  ccsDb.prepare(`INSERT INTO developer_collab_projects(id,app_id,owner_id,name,kind,document_json,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,1,?,?)`).run(id, appId, ownerId, cleanName(input.name), cleanKind(input.kind), cleanDocument(input.document), ts, ts)
  return publicProject(row(id)!, ownerId, true)
}

export function listDeveloperCollabProjects(appId: string, userId: string) {
  const rows = ccsDb.prepare(`SELECT DISTINCT p.* FROM developer_collab_projects p
    LEFT JOIN developer_collab_members m ON m.project_id=p.id
    WHERE p.app_id=? AND (p.owner_id=? OR m.user_id=?) ORDER BY p.updated_at DESC`).all(appId, userId, userId) as ProjectRow[]
  return rows.map((project) => publicProject(project, userId, false))
}

export function getDeveloperCollabProject(appId: string, projectId: string, userId: string) {
  const { project } = requireProject(appId, projectId, userId)
  return publicProject(project, userId, true)
}

export function updateDeveloperCollabProject(appId: string, projectId: string, userId: string, input: { baseVersion?: unknown; name?: unknown; kind?: unknown; document?: unknown }) {
  const { project } = requireProject(appId, projectId, userId, 'edit')
  const baseVersion = Number(input.baseVersion)
  if (!Number.isSafeInteger(baseVersion) || baseVersion !== project.version) {
    const error = new Error(`项目版本冲突：当前为 ${project.version}`) as Error & { code?: string; current?: unknown }
    error.code = 'VERSION_CONFLICT'
    error.current = publicProject(project, userId, true)
    throw error
  }
  const name = input.name === undefined ? project.name : cleanName(input.name)
  const kind = input.kind === undefined ? project.kind : cleanKind(input.kind)
  const document = input.document === undefined ? project.document_json : cleanDocument(input.document)
  const version = project.version + 1
  const ts = Date.now()
  ccsDb.prepare('UPDATE developer_collab_projects SET name=?,kind=?,document_json=?,version=?,updated_at=? WHERE id=?')
    .run(name, kind, document, version, ts, project.id)
  return publicProject(row(project.id)!, userId, true)
}

export function setDeveloperCollabMembers(appId: string, projectId: string, ownerId: string, input: unknown) {
  const { project } = requireProject(appId, projectId, ownerId, 'owner')
  const raw = Array.isArray(input) ? input : []
  const clean = new Map<string, 'read' | 'edit'>()
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue
    const userId = String((item as { userId?: unknown }).userId || '')
    if (!userId || userId === ownerId) continue
    const exists = ccsDb.prepare("SELECT 1 FROM auth_users WHERE id=? AND status='active'").get(userId)
    if (exists) clean.set(userId, (item as { access?: unknown }).access === 'edit' ? 'edit' : 'read')
  }
  ccsDb.transaction(() => {
    ccsDb.prepare('DELETE FROM developer_collab_members WHERE project_id=?').run(project.id)
    const insert = ccsDb.prepare('INSERT INTO developer_collab_members(project_id,user_id,access,created_at) VALUES(?,?,?,?)')
    for (const [userId, access] of clean) insert.run(project.id, userId, access, Date.now())
  })()
  return publicProject(row(project.id)!, ownerId, true)
}

function inviteHash(code: string) { return createHash('sha256').update(code.trim().toUpperCase()).digest('hex') }
function inviteCode() {
  const raw = randomBytes(5).toString('hex').toUpperCase()
  return `DXP-${raw.slice(0, 5)}-${raw.slice(5)}`
}

export function createDeveloperCollabInvite(appId: string, projectId: string, ownerId: string, access: unknown) {
  const { project } = requireProject(appId, projectId, ownerId, 'owner')
  const code = inviteCode()
  const id = randomUUID()
  const permission = access === 'edit' ? 'edit' : 'read'
  const ts = Date.now()
  ccsDb.transaction(() => {
    ccsDb.prepare('UPDATE developer_collab_invites SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL').run(ts, project.id)
    ccsDb.prepare(`INSERT INTO developer_collab_invites(id,project_id,code_hash,code_hint,access,created_by,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(id, project.id, inviteHash(code), code.slice(-5), permission, ownerId, ts)
  })()
  return { code, invite: { id, codeHint: code.slice(-5), access: permission, createdAt: ts } }
}

export function revokeDeveloperCollabInvite(appId: string, projectId: string, ownerId: string) {
  requireProject(appId, projectId, ownerId, 'owner')
  ccsDb.prepare('UPDATE developer_collab_invites SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL').run(Date.now(), projectId)
  return { revoked: true, projectId }
}

export function redeemDeveloperCollabInvite(appId: string, userId: string, code: unknown) {
  const normalized = String(code || '').trim().toUpperCase()
  const active = ccsDb.prepare(`SELECT i.project_id AS projectId,i.access FROM developer_collab_invites i
    JOIN developer_collab_projects p ON p.id=i.project_id
    WHERE i.code_hash=? AND i.revoked_at IS NULL AND p.app_id=?`).get(inviteHash(normalized), appId) as { projectId: string; access: 'read' | 'edit' } | undefined
  if (!active) throw new Error('项目邀请口令不存在或已失效')
  const project = row(active.projectId)!
  if (project.owner_id !== userId) ccsDb.prepare(`INSERT INTO developer_collab_members(project_id,user_id,access,created_at) VALUES(?,?,?,?)
    ON CONFLICT(project_id,user_id) DO UPDATE SET access=excluded.access`).run(project.id, userId, active.access, Date.now())
  return publicProject(project, userId, true)
}

export function deleteDeveloperCollabProject(appId: string, projectId: string, ownerId: string) {
  requireProject(appId, projectId, ownerId, 'owner')
  ccsDb.prepare('DELETE FROM developer_collab_projects WHERE id=?').run(projectId)
  return { deleted: true, projectId }
}

export function developerCollabRoomAccess(appId: string, projectId: string, userId: string) {
  const { project, access } = requireProject(appId, projectId, userId)
  return { project, access, allowedUserIds: [project.owner_id, ...members(project.id).map((member) => member.user_id)] }
}

