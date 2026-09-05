import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { ccsDb } from './ccsDb.ts'
import { simulateDeveloperAppInstall } from './developerApps.ts'
import { compareAppVersion, isValidSemver, type AppReleaseChannel } from '../shared/appLifecycle.ts'

const SERVER_DATA_DIR = DATA_ROOT
const RELEASES_DIR = resolve(process.env.DX_APP_RELEASES_DIR || dataPath('app-releases'))
const SIGNING_DIR = resolve(process.env.DX_APP_SIGNING_DIR || dataPath('app-signing'))
const PRIVATE_KEY_FILE = join(SIGNING_DIR, 'ed25519-private.pem')
const PUBLIC_KEY_FILE = join(SIGNING_DIR, 'ed25519-public.pem')
const MAX_RELEASE_BYTES = 24 * 1024 * 1024

export interface AppReleaseRecord {
  appId: string
  version: string
  build: number
  channel: AppReleaseChannel
  delivery: 'dx-app' | 'system-bundle'
  packagePath: string
  packageSize: number
  sha256: string
  signature: string
  signingKeyId: string
  minSystemVersion: string
  maxSystemVersion?: string
  dataVersion: number
  mandatory: boolean
  rolloutPercent: number
  releaseNotes: string
  publisherUserId: string
  publishedAt: number
  revokedAt?: number
  reviewStatus: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  reviewedAt?: number
}

type ReleaseRow = {
  app_id: string; version: string; build: number; channel: AppReleaseChannel
  delivery: 'dx-app' | 'system-bundle'; package_path: string; package_size: number
  sha256: string; signature: string; signing_key_id: string; min_system_version: string
  max_system_version: string | null; data_version: number; mandatory: number
  rollout_percent: number; release_notes: string; publisher_user_id: string
  published_at: number; revoked_at: number | null
  review_status: 'pending' | 'approved' | 'rejected'; reviewed_by: string | null; reviewed_at: number | null
}

function releaseFromRow(row: ReleaseRow): AppReleaseRecord {
  return {
    appId: row.app_id, version: row.version, build: row.build, channel: row.channel,
    delivery: row.delivery, packagePath: row.package_path, packageSize: row.package_size,
    sha256: row.sha256, signature: row.signature, signingKeyId: row.signing_key_id,
    minSystemVersion: row.min_system_version, maxSystemVersion: row.max_system_version || undefined,
    dataVersion: row.data_version, mandatory: row.mandatory === 1,
    rolloutPercent: row.rollout_percent, releaseNotes: row.release_notes,
    publisherUserId: row.publisher_user_id, publishedAt: row.published_at,
    revokedAt: row.revoked_at || undefined,
    reviewStatus: row.review_status || 'approved', reviewedBy: row.reviewed_by || undefined, reviewedAt: row.reviewed_at || undefined,
  }
}

function ensureSigningKeys() {
  mkdirSync(SIGNING_DIR, { recursive: true })
  const hasPrivateKey = existsSync(PRIVATE_KEY_FILE)
  const hasPublicKey = existsSync(PUBLIC_KEY_FILE)
  if (!hasPrivateKey && hasPublicKey) throw new Error('Release 签名私钥缺失；为避免签名身份被静默替换，已停止发布')
  if (hasPrivateKey && !hasPublicKey) {
    const privateKey = readFileSync(PRIVATE_KEY_FILE, 'utf8')
    const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
    writeFileSync(PUBLIC_KEY_FILE, publicPem, { encoding: 'utf8', mode: 0o644, flag: 'wx' })
  } else if (!hasPrivateKey && !hasPublicKey) {
    const pair = generateKeyPairSync('ed25519')
    const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const nonce = `${process.pid}-${Date.now()}`
    const privateTemp = `${PRIVATE_KEY_FILE}.${nonce}.tmp`
    const publicTemp = `${PUBLIC_KEY_FILE}.${nonce}.tmp`
    writeFileSync(privateTemp, privatePem, { encoding: 'utf8', mode: 0o600 })
    writeFileSync(publicTemp, publicPem, { encoding: 'utf8', mode: 0o644 })
    renameSync(privateTemp, PRIVATE_KEY_FILE)
    renameSync(publicTemp, PUBLIC_KEY_FILE)
  }
  const privateKey = readFileSync(PRIVATE_KEY_FILE, 'utf8')
  const publicKey = readFileSync(PUBLIC_KEY_FILE, 'utf8')
  const keyId = createHash('sha256').update(publicKey).digest('hex')
  return { privateKey, publicKey, keyId }
}

export function releaseSignaturePayload(release: Pick<AppReleaseRecord, 'appId' | 'version' | 'build' | 'channel' | 'sha256' | 'packageSize' | 'minSystemVersion' | 'maxSystemVersion' | 'dataVersion'>) {
  return Buffer.from(JSON.stringify({
    appId: release.appId, version: release.version, build: release.build,
    channel: release.channel, sha256: release.sha256, packageSize: release.packageSize,
    minSystemVersion: release.minSystemVersion, maxSystemVersion: release.maxSystemVersion || null,
    dataVersion: release.dataVersion,
  }), 'utf8')
}

export function signingPublicInfo() {
  const { publicKey, keyId } = ensureSigningKeys()
  return { algorithm: 'Ed25519' as const, keyId, publicKey }
}

export function verifyReleaseSignature(release: Pick<AppReleaseRecord, 'appId' | 'version' | 'build' | 'channel' | 'sha256' | 'packageSize' | 'minSystemVersion' | 'maxSystemVersion' | 'dataVersion' | 'signature'>, publicKey?: string) {
  const trustedKey = publicKey || ensureSigningKeys().publicKey
  try { return verify(null, releaseSignaturePayload(release), trustedKey, Buffer.from(release.signature, 'base64')) } catch { return false }
}

function safeReleasePath(path: string) {
  const target = resolve(path)
  if (target !== RELEASES_DIR && !target.startsWith(`${RELEASES_DIR}${sep}`)) throw new Error('Release 包路径越界')
  return target
}

export function listAppReleases(options: { includeRevoked?: boolean; appId?: string; channel?: AppReleaseChannel } = {}) {
  const clauses: string[] = []
  const values: unknown[] = []
  if (!options.includeRevoked) clauses.push('revoked_at IS NULL')
  if (options.appId) { clauses.push('app_id=?'); values.push(options.appId) }
  if (options.channel) { clauses.push('channel=?'); values.push(options.channel) }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  return (ccsDb.prepare(`SELECT * FROM app_market_releases${where} ORDER BY published_at DESC`).all(...values) as ReleaseRow[]).map(releaseFromRow)
}

export function getAppRelease(appId: string, version: string, build: number, channel?: AppReleaseChannel, includeRevoked = false) {
  const channels = channel ? ' AND channel=?' : ''
  const revoked = includeRevoked ? '' : ' AND revoked_at IS NULL'
  const values = channel ? [appId, version, build, channel] : [appId, version, build]
  const row = ccsDb.prepare(`SELECT * FROM app_market_releases WHERE app_id=? AND version=? AND build=?${channels}${revoked} ORDER BY published_at DESC LIMIT 1`).get(...values) as ReleaseRow | undefined
  return row ? releaseFromRow(row) : undefined
}

export function publishAppRelease(input: {
  buffer: Buffer; publisherUserId: string; channel?: AppReleaseChannel; releaseNotes?: string
  mandatory?: boolean; rolloutPercent?: number; trustedAppId?: string
  reviewStatus?: 'pending' | 'approved'
}) {
  if (!input.buffer.length || input.buffer.length > MAX_RELEASE_BYTES) throw new Error('发布包为空或超过 24 MB 限制')
  const simulation = simulateDeveloperAppInstall(input.buffer)
  const appId = input.trustedAppId ? String(input.trustedAppId) : simulation.appId
  if (input.trustedAppId && simulation.appId !== `dev-${input.trustedAppId}`) throw new Error('受信商店 APP 的清单 ID 与发布目标不一致')
  const channel = input.channel === 'stable' || input.channel === 'beta' || input.channel === 'dev' ? input.channel : simulation.releaseChannel
  if (simulation.releaseChannel !== channel) throw new Error(`dx-app.json.releaseChannel=${simulation.releaseChannel}，与发布渠道 ${channel} 不一致`)
  if (!isValidSemver(simulation.version)) throw new Error('Release 版本号不是有效 SemVer')
  const current = listAppReleases({ appId, channel })[0]
  if (current && channel !== 'dev' && compareAppVersion(simulation, current) <= 0) {
    throw new Error(`新 Release 必须高于当前 ${current.version} (${current.build})`)
  }
  if (getAppRelease(appId, simulation.version, simulation.build, channel, true)) throw new Error('相同 APP、版本、build 和渠道已发布，不能覆盖')
  const sha256 = createHash('sha256').update(input.buffer).digest('hex')
  const packageSize = input.buffer.length
  const keys = ensureSigningKeys()
  const unsigned = {
    appId, version: simulation.version, build: simulation.build, channel,
    sha256, packageSize, minSystemVersion: simulation.minSystemVersion,
    maxSystemVersion: simulation.maxSystemVersion, dataVersion: simulation.dataVersion,
  }
  const signature = sign(null, releaseSignaturePayload(unsigned), keys.privateKey).toString('base64')
  const relativePath = join(appId, channel, `${simulation.version}+${simulation.build}.zip`)
  const packagePath = safeReleasePath(join(RELEASES_DIR, relativePath))
  mkdirSync(dirname(packagePath), { recursive: true })
  const tempPath = `${packagePath}.${process.pid}-${Date.now()}.tmp`
  writeFileSync(tempPath, input.buffer)
  renameSync(tempPath, packagePath)
  const record: AppReleaseRecord = {
    ...unsigned, delivery: 'dx-app', packagePath, signature, signingKeyId: keys.keyId,
    mandatory: input.mandatory === true,
    rolloutPercent: Math.max(0, Math.min(100, Math.round(Number(input.rolloutPercent ?? 100)))),
    releaseNotes: String(input.releaseNotes || simulation.name).trim().slice(0, 8000),
    publisherUserId: input.publisherUserId, publishedAt: Date.now(),
    reviewStatus: input.reviewStatus === 'pending' ? 'pending' : 'approved',
  }
  try {
    ccsDb.prepare(`INSERT INTO app_market_releases (
      app_id,version,build,channel,delivery,package_path,package_size,sha256,signature,signing_key_id,
      min_system_version,max_system_version,data_version,mandatory,rollout_percent,release_notes,publisher_user_id,published_at,review_status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      record.appId, record.version, record.build, record.channel, record.delivery, record.packagePath,
      record.packageSize, record.sha256, record.signature, record.signingKeyId, record.minSystemVersion,
      record.maxSystemVersion || null, record.dataVersion, record.mandatory ? 1 : 0,
      record.rolloutPercent, record.releaseNotes, record.publisherUserId, record.publishedAt, record.reviewStatus,
    )
  } catch (error) {
    try { unlinkSync(packagePath) } catch { /* best effort; DB remains authoritative */ }
    throw error
  }
  return record
}

export function readAppReleasePackage(release: AppReleaseRecord) {
  const buffer = readFileSync(safeReleasePath(release.packagePath))
  if (!buffer.length || buffer.length > MAX_RELEASE_BYTES) throw new Error('Release 包为空或超过 24 MB 限制')
  if (buffer.length !== release.packageSize) throw new Error('Release 包大小校验失败')
  if (createHash('sha256').update(buffer).digest('hex') !== release.sha256) throw new Error('Release 包 SHA-256 校验失败')
  if (!verifyReleaseSignature(release)) throw new Error('Release 签名校验失败')
  return buffer
}

export function revokeAppRelease(appId: string, version: string, build: number, channel?: AppReleaseChannel) {
  const release = getAppRelease(appId, version, build, channel)
  if (!release) throw new Error('Release 不存在或已撤回')
  const changed = ccsDb.prepare('UPDATE app_market_releases SET revoked_at=? WHERE app_id=? AND version=? AND build=? AND channel=? AND revoked_at IS NULL')
    .run(Date.now(), release.appId, release.version, release.build, release.channel).changes
  return { ...release, revokedAt: Date.now(), revoked: changed === 1 }
}

export function reviewAppRelease(appId: string, version: string, build: number, channel: AppReleaseChannel, decision: 'approved' | 'rejected', reviewerUserId: string) {
  const release = getAppRelease(appId, version, build, channel, true)
  if (!release) throw new Error('Release 不存在')
  if (release.revokedAt) throw new Error('已撤回 Release 不能审核')
  const reviewedAt = Date.now()
  ccsDb.prepare('UPDATE app_market_releases SET review_status=?,reviewed_by=?,reviewed_at=? WHERE app_id=? AND version=? AND build=? AND channel=?')
    .run(decision, reviewerUserId, reviewedAt, appId, version, build, channel)
  return { ...release, reviewStatus: decision, reviewedBy: reviewerUserId, reviewedAt }
}

export function localReleaseCatalog() {
  return listAppReleases().filter((release) => release.reviewStatus === 'approved').map((release) => ({
    appId: release.appId, version: release.version, build: release.build, channel: release.channel,
    delivery: release.delivery, packageUrl: `/api/market/releases/${encodeURIComponent(release.appId)}/${encodeURIComponent(release.version)}/${release.build}/download?channel=${release.channel}`,
    packageSize: release.packageSize, sha256: release.sha256, signature: release.signature,
    signingKeyId: release.signingKeyId, minSystemVersion: release.minSystemVersion,
    maxSystemVersion: release.maxSystemVersion, dataVersion: release.dataVersion,
    mandatory: release.mandatory, rolloutPercent: release.rolloutPercent,
    releaseNotes: release.releaseNotes, publishedAt: release.publishedAt,
  }))
}

export function publicAppRelease(release: AppReleaseRecord) {
  const { packagePath: _packagePath, publisherUserId: _publisherUserId, ...publicRelease } = release
  return publicRelease
}
