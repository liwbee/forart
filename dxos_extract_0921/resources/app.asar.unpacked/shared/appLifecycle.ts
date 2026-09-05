export const DX_OS_VERSION = '0.1.0'
export const DX_OS_BUILD = 1000
export const DX_BRIDGE_VERSION = '1.0.0'
export const DEFAULT_DEVELOPER_APP_VERSION = '0.1.0'
export const DEFAULT_DEVELOPER_APP_BUILD = 1

export type AppReleaseChannel = 'stable' | 'beta' | 'dev'
export type AppUpdateMode = 'system' | 'market'
export type AppDeliveryMode = 'system-bundle' | 'dx-app'

export const SYSTEM_COMPONENT_APP_IDS = new Set([
  'settings', 'api-settings', 'accounts',
  'files', 'trash',
  'skills', 'mcp', 'calendar', 'music', 'market', 'developer-studio',
  'agent', 'tasks', 'photos', 'weather', 'text-editor',
  'welcome',
])

export function isSystemComponentApp(appId: string) {
  return SYSTEM_COMPONENT_APP_IDS.has(appId)
}

export interface AppVersionIdentity {
  version: string
  build: number
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function isValidSemver(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_RE.test(value.trim())
}

function semverParts(value: string) {
  const match = value.trim().match(SEMVER_RE)
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

export function compareSemver(left: string, right: string) {
  const a = semverParts(left)
  const b = semverParts(right)
  if (!a || !b) throw new Error(`无法比较无效版本：${left} / ${right}`)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1
  if (!b.prerelease.length) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index]
    const bv = b.prerelease[index]
    if (av === undefined) return -1
    if (bv === undefined) return 1
    if (av === bv) continue
    const an = /^\d+$/.test(av)
    const bn = /^\d+$/.test(bv)
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1
    if (an !== bn) return an ? -1 : 1
    return av > bv ? 1 : -1
  }
  return 0
}

export function compareAppVersion(left: AppVersionIdentity, right: AppVersionIdentity) {
  const version = compareSemver(left.version, right.version)
  if (version) return version
  const leftBuild = Math.max(0, Math.round(Number(left.build) || 0))
  const rightBuild = Math.max(0, Math.round(Number(right.build) || 0))
  return leftBuild === rightBuild ? 0 : leftBuild > rightBuild ? 1 : -1
}

export function appReleaseKey(value: AppVersionIdentity) {
  return `${value.version}+${Math.max(0, Math.round(value.build))}`
}

export function systemSupportsApp(minSystemVersion?: string, maxSystemVersion?: string | null) {
  if (minSystemVersion && compareSemver(DX_OS_VERSION, minSystemVersion) < 0) return false
  if (maxSystemVersion && compareSemver(DX_OS_VERSION, maxSystemVersion) > 0) return false
  return true
}
