import { randomBytes, randomUUID } from 'node:crypto'
import { ccsDb } from './ccsDb.ts'

export interface InstallationIdentity {
  installationId: string
  devicePublicId: string
  createdAt: number
  schemaVersion: number
}

interface InstallationIdentityRow {
  installation_id: string
  device_public_id: string
  created_at: number
  schema_version: number
}

function publicIdentity(row: InstallationIdentityRow): InstallationIdentity {
  return {
    installationId: row.installation_id,
    devicePublicId: row.device_public_id,
    createdAt: row.created_at,
    schemaVersion: row.schema_version,
  }
}

const readIdentity = ccsDb.prepare(`
  SELECT installation_id, device_public_id, created_at, schema_version
  FROM installation_identity WHERE singleton = 1
`)

const ensureIdentity = ccsDb.transaction(() => {
  let row = readIdentity.get() as InstallationIdentityRow | undefined
  if (!row) {
    const createdAt = Date.now()
    ccsDb.prepare(`
      INSERT INTO installation_identity (
        singleton, installation_id, device_public_id, created_at, schema_version
      ) VALUES (1, ?, ?, ?, 1)
    `).run(randomUUID(), `dxdev_${randomBytes(24).toString('base64url')}`, createdAt)
    row = readIdentity.get() as InstallationIdentityRow
  }
  return publicIdentity(row)
})

/** 一次安装只生成一份身份；本地账号切换、注销和软件升级都不会改变它。 */
export function getInstallationIdentity(): InstallationIdentity {
  return ensureIdentity.immediate()
}
