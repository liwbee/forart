import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { buildZip, type ZipEntry } from './zip.ts'
import { closeCcsDb } from './ccsDb.ts'
import { invalidateAppCatalog } from './appUpdates.ts'
import { publishAppRelease } from './appReleases.ts'

function packageEntries(root: string, directory = root): ZipEntry[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const absolute = resolve(directory, item.name)
    if (item.isDirectory()) return packageEntries(root, absolute)
    if (!item.isFile()) return []
    return [{ name: relative(root, absolute).replace(/\\/g, '/'), data: readFileSync(absolute) }]
  })
}

const [directoryArg, appIdArg, ...notesParts] = process.argv.slice(2)
if (!directoryArg || !appIdArg) {
  throw new Error('用法：tsx server/publishBundledAppRelease.ts <构建目录> <受信 APP ID> [更新说明]')
}

const directory = resolve(directoryArg)
if (!statSync(directory).isDirectory()) throw new Error('构建目录不存在')

try {
  const release = publishAppRelease({
    buffer: buildZip(packageEntries(directory)),
    publisherUserId: 'dx-os-bundled-release',
    channel: 'stable',
    releaseNotes: notesParts.join(' ').trim() || '内置业务 APP 更新',
    trustedAppId: appIdArg,
  })
  invalidateAppCatalog()
  console.log(JSON.stringify({
    ok: true,
    appId: release.appId,
    version: release.version,
    build: release.build,
    channel: release.channel,
    sha256: release.sha256,
    signature: release.signature ? 'Ed25519' : '',
  }))
} finally {
  closeCcsDb()
}
