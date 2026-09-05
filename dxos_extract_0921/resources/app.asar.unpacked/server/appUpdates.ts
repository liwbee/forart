import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'
import {
  DX_BRIDGE_VERSION,
  DX_OS_VERSION,
  compareAppVersion,
  isValidSemver,
  systemSupportsApp,
  type AppReleaseChannel,
  type AppVersionIdentity,
} from '../shared/appLifecycle.ts'
import { getAppRelease, localReleaseCatalog, readAppReleasePackage, verifyReleaseSignature } from './appReleases.ts'

const LOCAL_CATALOG_FILE = dataPath('app-catalog.json')
const CACHE_MS = 5 * 60 * 1000
const MAX_UPDATE_PACKAGE_BYTES = 24 * 1024 * 1024
const DEFAULT_APP_CATALOG_URL = 'https://api.dx-os.com/v1/apps/catalog'
const DEFAULT_APP_CATALOG_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAoCzllFVIiunTu6LEJc1vOZylzGGETMe4ouuHR0r6U5w=
-----END PUBLIC KEY-----`

export interface AppCatalogRelease extends AppVersionIdentity {
  appId: string
  channel: AppReleaseChannel
  delivery: 'dx-app' | 'system-bundle'
  packageUrl?: string
  packageSize?: number
  sha256?: string
  signature?: string
  signingKeyId?: string
  dataVersion: number
  minSystemVersion: string
  maxSystemVersion?: string
  mandatory: boolean
  rolloutPercent: number
  releaseNotes: string
  publishedAt: number
}

export interface InstalledAppVersion extends AppVersionIdentity {
  appId: string
  channel?: AppReleaseChannel
  updateMode?: 'system' | 'market'
}

type CatalogPayload = { generatedAt?: number; releases?: unknown[] }
let cached: { at: number; source: string; releases: AppCatalogRelease[] } | null = null

function safeCatalogUrl(value: string) {
  const url = new URL(value)
  if (url.protocol === 'https:') return url
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return url
  throw new Error('应用市场目录只允许 HTTPS，开发环境可使用 localhost')
}

function normalizeRelease(value: unknown): AppCatalogRelease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const appId = String(item.appId || item.id || '').trim()
  const version = String(item.version || '').trim()
  const build = Number(item.build)
  const minSystemVersion = String(item.minSystemVersion || '0.1.0').trim()
  const maxSystemVersion = item.maxSystemVersion ? String(item.maxSystemVersion).trim() : undefined
  if (!/^[a-z][a-z0-9-]{1,100}$/.test(appId) || !isValidSemver(version) || !Number.isSafeInteger(build) || build < 1 || !isValidSemver(minSystemVersion) || (maxSystemVersion && !isValidSemver(maxSystemVersion))) return null
  const packageUrl = item.packageUrl ? String(item.packageUrl).trim() : undefined
  const sha256 = item.sha256 ? String(item.sha256).trim().toLowerCase() : undefined
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) return null
  return {
    appId,
    version,
    build,
    channel: item.channel === 'beta' || item.channel === 'dev' ? item.channel : 'stable',
    delivery: item.delivery === 'system-bundle' ? 'system-bundle' : 'dx-app',
    packageUrl,
    packageSize: Number.isFinite(Number(item.packageSize)) ? Math.max(0, Math.round(Number(item.packageSize))) : undefined,
    sha256,
    signature: item.signature ? String(item.signature).slice(0, 2000) : undefined,
    signingKeyId: item.signingKeyId ? String(item.signingKeyId).trim().toLowerCase().slice(0, 128) : undefined,
    dataVersion: Math.max(1, Math.round(Number(item.dataVersion) || 1)),
    minSystemVersion,
    maxSystemVersion,
    mandatory: item.mandatory === true,
    rolloutPercent: Math.max(0, Math.min(100, Math.round(Number(item.rolloutPercent ?? 100)))),
    releaseNotes: String(item.releaseNotes || '').slice(0, 8000),
    publishedAt: Math.max(0, Math.round(Number(item.publishedAt) || Date.now())),
  }
}

function parseCatalog(raw: unknown) {
  const payload = Array.isArray(raw) ? { releases: raw } : raw && typeof raw === 'object' ? raw as CatalogPayload : {}
  return (payload.releases || []).map(normalizeRelease).filter((item): item is AppCatalogRelease => !!item)
}

async function readRemoteCatalog(url: URL) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`应用市场版本服务返回 HTTP ${response.status}`)
  return parseCatalog(await response.json())
}

export async function appCatalog(force = false) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached
  const configured = String(process.env.DX_APP_CATALOG_URL ?? DEFAULT_APP_CATALOG_URL).trim()
  if (configured && configured.toLowerCase() !== 'local') {
    const url = safeCatalogUrl(configured)
    try {
      const releases = await readRemoteCatalog(url)
      cached = { at: Date.now(), source: url.toString(), releases }
      return cached
    } catch (error) {
      console.warn(`远程应用市场暂时不可用，回退到本地目录：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const databaseReleases = parseCatalog(localReleaseCatalog())
  const legacyReleases = existsSync(LOCAL_CATALOG_FILE) ? parseCatalog(JSON.parse(readFileSync(LOCAL_CATALOG_FILE, 'utf8'))) : []
  // Catalog source applies to the whole response. Do not mix database packages with
  // legacy URL entries, otherwise a legacy entry could be mistaken for a local file.
  const releases = databaseReleases.length ? databaseReleases : legacyReleases
  cached = { at: Date.now(), source: databaseReleases.length ? 'local-release-service' : legacyReleases.length ? 'local' : 'unconfigured', releases }
  return cached
}

export function invalidateAppCatalog() { cached = null }

export async function checkAppUpdates(installed: InstalledAppVersion[], force = false, audienceKey?: string) {
  const catalog = await appCatalog(force)
  const updates = selectAppUpdates(installed, catalog.releases, audienceKey)
  return { systemVersion: DX_OS_VERSION, bridgeVersion: DX_BRIDGE_VERSION, source: catalog.source, checkedAt: Date.now(), updates }
}

export function releaseAvailableToAudience(release: AppCatalogRelease, audienceKey?: string) {
  if (release.rolloutPercent <= 0) return false
  if (release.rolloutPercent >= 100 || !audienceKey) return true
  const digest = createHash('sha256').update(`${audienceKey}:${release.appId}:${release.version}:${release.build}:${release.channel}`).digest()
  return digest.readUInt32BE(0) % 100 < release.rolloutPercent
}

export function selectAppUpdates(installed: InstalledAppVersion[], releases: AppCatalogRelease[], audienceKey?: string) {
  return installed
    .filter((item) => item.updateMode !== 'system' && /^[a-z][a-z0-9-]{1,100}$/.test(item.appId) && isValidSemver(item.version))
    .flatMap((item) => {
      const channel = item.channel || 'stable'
      const candidates = releases
        .filter((release) => release.appId === item.appId && release.channel === channel && releaseAvailableToAudience(release, audienceKey) && systemSupportsApp(release.minSystemVersion, release.maxSystemVersion))
        .sort((a, b) => compareAppVersion(b, a))
      const target = candidates[0]
      if (!target || compareAppVersion(target, item) <= 0) return []
      return [{ ...target, currentVersion: item.version, currentBuild: item.build, compatible: true }]
    })
}

export async function catalogRelease(appId: string, version: string, build: number, channel?: AppReleaseChannel) {
  const catalog = await appCatalog(true)
  const release = catalog.releases.find((item) => item.appId === appId && item.version === version && item.build === build && (!channel || item.channel === channel))
  if (!release) throw new Error('应用市场中没有找到指定 Release')
  return { release, catalogSource: catalog.source }
}

export async function downloadCatalogRelease(release: AppCatalogRelease, catalogSource: string) {
  if (release.delivery !== 'dx-app') throw new Error('该更新属于系统构建，不能作为独立 APP 安装')
  if (!release.packageUrl || !release.sha256) throw new Error('Release 缺少 packageUrl 或 sha256')
  if (catalogSource === 'local-release-service') {
    const local = getAppRelease(release.appId, release.version, release.build, release.channel)
    if (!local) throw new Error('本地 Release 已撤回或不存在')
    return readAppReleasePackage(local)
  }
  const base = catalogSource === 'local' || catalogSource === 'unconfigured' ? undefined : safeCatalogUrl(catalogSource)
  const url = safeCatalogUrl(base ? new URL(release.packageUrl, base).toString() : release.packageUrl)
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`更新包下载失败：HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_UPDATE_PACKAGE_BYTES) throw new Error('更新包超过 24 MB 限制')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length || buffer.length > MAX_UPDATE_PACKAGE_BYTES) throw new Error('更新包为空或超过 24 MB 限制')
  if (release.packageSize && buffer.length !== release.packageSize) throw new Error(`更新包大小校验失败：期待 ${release.packageSize}，实际 ${buffer.length}`)
  const digest = createHash('sha256').update(buffer).digest('hex')
  if (digest !== release.sha256) throw new Error('更新包 SHA-256 校验失败')
  const trustedPublicKey = String(process.env.DX_APP_CATALOG_PUBLIC_KEY || DEFAULT_APP_CATALOG_PUBLIC_KEY).replace(/\\n/g, '\n').trim()
  if (!release.signature) throw new Error('远程 Release 缺少签名')
  if (!trustedPublicKey) throw new Error('未配置远程 Catalog 受信公钥 DX_APP_CATALOG_PUBLIC_KEY')
  if (!verifyReleaseSignature({ ...release, sha256: release.sha256, signature: release.signature, packageSize: release.packageSize || buffer.length }, trustedPublicKey)) throw new Error('远程 Release 签名校验失败')
  return buffer
}
