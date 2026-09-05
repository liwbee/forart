import { createPublicKey, verify } from 'node:crypto'
import { ccsDb } from './ccsDb.ts'
import { getInstallationIdentity } from './installationIdentity.ts'

const ENTITLEMENT_KEY_ID = 'dx-entitlement-ed25519-2026-01'
const ENTITLEMENT_PUBLIC_KEY_SPKI_B64 = 'MCowBQYDK2VwAyEAMhKfk+fyLvWUyenYRRNO9R7rnpsouL3mWPHyxyLP+p0='
const CLOCK_SKEW_TOLERANCE_SECONDS = 5 * 60

export interface SignedEntitlementEnvelope {
  keyId: string
  algorithm: 'Ed25519'
  token: string
  signature: string
}

export interface CloudEntitlementPayload {
  organizationId: string
  deviceId: string
  plan: string
  planName: string
  planGroup: string
  subscriptionId: string | null
  subscriptionStatus: 'trialing' | 'active' | 'inactive'
  currentPeriodStart: number | null
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  maxLocalAccounts: number
  maxDepartments: number
  departmentsEnabled: boolean
  advancedAppPolicyEnabled: boolean
  issuedAt: number
  expiresAt: number
  graceUntil: number
  entitlementVersion: number
}

export interface CloudMembershipView extends CloudEntitlementPayload {
  active: boolean
  inGracePeriod: boolean
}

interface CachedEntitlementRow {
  key_id: string
  algorithm: string
  token: string
  signature: string
  fetched_at: number
  expires_at: number
  grace_until: number
}

interface ActiveBindingRow {
  organization_id: string | null
  device_id: string | null
  status: string
}

const installation = getInstallationIdentity()
const entitlementByInstallation = ccsDb.prepare('SELECT * FROM cloud_entitlement_cache WHERE installation_id=?')
const bindingByInstallation = ccsDb.prepare('SELECT organization_id,device_id,status FROM cloud_installation_binding WHERE installation_id=?')
const deleteEntitlement = ccsDb.prepare('DELETE FROM cloud_entitlement_cache WHERE installation_id=?')
const saveEntitlement = ccsDb.prepare(`
  INSERT INTO cloud_entitlement_cache (
    installation_id,key_id,algorithm,token,signature,
    fetched_at,expires_at,grace_until,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?)
  ON CONFLICT(installation_id) DO UPDATE SET
    key_id=excluded.key_id,algorithm=excluded.algorithm,
    token=excluded.token,signature=excluded.signature,
    fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,
    grace_until=excluded.grace_until,updated_at=excluded.updated_at
`)

function finiteInteger(value: unknown, minimum = 0) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum ? number : null
}

function parsePayload(token: string): CloudEntitlementPayload | null {
  try {
    const value = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Partial<CloudEntitlementPayload>
    const maxLocalAccounts = finiteInteger(value.maxLocalAccounts, 3)
    const maxDepartments = finiteInteger(value.maxDepartments, 0)
    const issuedAt = finiteInteger(value.issuedAt, 1)
    const expiresAt = finiteInteger(value.expiresAt, 1)
    const graceUntil = finiteInteger(value.graceUntil, 1)
    const entitlementVersion = finiteInteger(value.entitlementVersion, 0)
    const currentPeriodStart = value.currentPeriodStart === null ? null : finiteInteger(value.currentPeriodStart, 1)
    const currentPeriodEnd = value.currentPeriodEnd === null ? null : finiteInteger(value.currentPeriodEnd, 1)
    if (
      typeof value.organizationId !== 'string' || !value.organizationId ||
      typeof value.deviceId !== 'string' || !value.deviceId ||
      typeof value.plan !== 'string' || !value.plan ||
      typeof value.planName !== 'string' || !value.planName ||
      typeof value.planGroup !== 'string' || !value.planGroup ||
      (value.subscriptionId !== null && typeof value.subscriptionId !== 'string') ||
      !['trialing', 'active', 'inactive'].includes(String(value.subscriptionStatus)) ||
      maxLocalAccounts === null || maxDepartments === null || issuedAt === null ||
      expiresAt === null || graceUntil === null || entitlementVersion === null ||
      (value.currentPeriodStart !== null && currentPeriodStart === null) ||
      (value.currentPeriodEnd !== null && currentPeriodEnd === null) ||
      expiresAt < issuedAt || graceUntil < expiresAt ||
      typeof value.cancelAtPeriodEnd !== 'boolean' ||
      typeof value.departmentsEnabled !== 'boolean' ||
      typeof value.advancedAppPolicyEnabled !== 'boolean'
    ) return null
    return {
      organizationId: value.organizationId,
      deviceId: value.deviceId,
      plan: value.plan,
      planName: value.planName,
      planGroup: value.planGroup,
      subscriptionId: value.subscriptionId || null,
      subscriptionStatus: value.subscriptionStatus as CloudEntitlementPayload['subscriptionStatus'],
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: value.cancelAtPeriodEnd,
      maxLocalAccounts,
      maxDepartments,
      departmentsEnabled: value.departmentsEnabled,
      advancedAppPolicyEnabled: value.advancedAppPolicyEnabled,
      issuedAt,
      expiresAt,
      graceUntil,
      entitlementVersion,
    }
  } catch { return null }
}

export function verifyCloudEntitlement(envelope: SignedEntitlementEnvelope, expected?: { organizationId?: string | null; deviceId?: string | null }) {
  if (!envelope || envelope.keyId !== ENTITLEMENT_KEY_ID || envelope.algorithm !== 'Ed25519' || !envelope.token || !envelope.signature) return null
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(process.env.DX_ENTITLEMENT_PUBLIC_KEY_SPKI_B64 || ENTITLEMENT_PUBLIC_KEY_SPKI_B64, 'base64'),
      format: 'der',
      type: 'spki',
    })
    if (!verify(null, Buffer.from(envelope.token), publicKey, Buffer.from(envelope.signature, 'base64url'))) return null
    const payload = parsePayload(envelope.token)
    if (!payload) return null
    if (expected?.organizationId && payload.organizationId !== expected.organizationId) return null
    if (expected?.deviceId && payload.deviceId !== expected.deviceId) return null
    return payload
  } catch { return null }
}

export function persistCloudEntitlement(envelope: SignedEntitlementEnvelope | null | undefined, fetchedAt = Date.now()) {
  const binding = bindingByInstallation.get(installation.installationId) as ActiveBindingRow | undefined
  if (!envelope || binding?.status !== 'active' || !binding.organization_id || !binding.device_id) {
    deleteEntitlement.run(installation.installationId)
    return null
  }
  const payload = verifyCloudEntitlement(envelope, { organizationId: binding.organization_id, deviceId: binding.device_id })
  const fetchedAtSeconds = Math.floor(fetchedAt / 1000)
  // 服务器签发时间明显位于本机未来时，拒绝缓存，避免通过回拨系统时间延长权益。
  if (!payload || payload.issuedAt > fetchedAtSeconds + CLOCK_SKEW_TOLERANCE_SECONDS) {
    deleteEntitlement.run(installation.installationId)
    return null
  }
  saveEntitlement.run(
    installation.installationId,
    envelope.keyId,
    envelope.algorithm,
    envelope.token,
    envelope.signature,
    fetchedAt,
    payload.expiresAt,
    payload.graceUntil,
    fetchedAt,
  )
  return payload
}

export function clearCloudEntitlement() {
  deleteEntitlement.run(installation.installationId)
}

export function currentCloudMembership(now = Date.now()): CloudMembershipView | null {
  const binding = bindingByInstallation.get(installation.installationId) as ActiveBindingRow | undefined
  const cached = entitlementByInstallation.get(installation.installationId) as CachedEntitlementRow | undefined
  if (!cached || binding?.status !== 'active' || !binding.organization_id || !binding.device_id) return null
  const payload = verifyCloudEntitlement({
    keyId: cached.key_id,
    algorithm: cached.algorithm as 'Ed25519',
    token: cached.token,
    signature: cached.signature,
  }, { organizationId: binding.organization_id, deviceId: binding.device_id })
  const nowSeconds = Math.floor(now / 1000)
  const fetchedAtSeconds = Math.floor(cached.fetched_at / 1000)
  if (
    !payload ||
    nowSeconds > payload.graceUntil ||
    nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS < payload.issuedAt ||
    nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS < fetchedAtSeconds
  ) return null
  const paid = payload.plan !== 'free' && (payload.subscriptionStatus === 'active' || payload.subscriptionStatus === 'trialing')
  return {
    ...payload,
    active: paid,
    inGracePeriod: paid && nowSeconds > payload.expiresAt,
  }
}

export function currentSignedEntitlement(now = Date.now()) {
  const membership = currentCloudMembership(now)
  if (membership?.active) return membership
  return membership?.plan === 'free' && membership.subscriptionStatus === 'inactive'
    ? membership
    : null
}

