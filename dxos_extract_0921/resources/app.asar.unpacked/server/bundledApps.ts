import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareAppVersion, isValidSemver } from '../shared/appLifecycle.ts'
import { importDeveloperApp, listDeveloperApps } from './developerApps.ts'
import { buildZip } from './zip.ts'

const BUNDLED_APPS_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'bundled-apps')
const BUNDLED_APP_PACKAGES_ROOT = resolve(
  process.env.DX_BUNDLED_APP_PACKAGES_DIR || join(dirname(fileURLToPath(import.meta.url)), 'bundled-app-packages'),
)

export const STABLE_BUNDLED_APP_IDS = [
  'ai-image-declaration',
  'barcode',
  'canvas',
  'comfyui',
  'dingtalk',
  'lingxing',
  'quark',
  'snake',
] as const

const stableBundledAppIds = new Set<string>(STABLE_BUNDLED_APP_IDS)
const packageNamePattern = /^(.+)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\+(\d+)\.zip$/

function packageFiles(root: string, folder = root): Array<{ name: string; data: Buffer }> {
  const files: Array<{ name: string; data: Buffer }> = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(folder, entry.name)
    if (entry.isDirectory()) files.push(...packageFiles(root, path))
    else if (entry.isFile()) files.push({ name: relative(root, path).replace(/\\/g, '/'), data: readFileSync(path) })
  }
  return files
}

export function ensureBundledApps(options: { excludeIds?: Iterable<string> } = {}) {
  const excluded = new Set(options.excludeIds || [])
  const installed = listDeveloperApps()
  const results: Array<{ id: string; action: 'installed' | 'upgraded' | 'current' }> = []

  // 正式版直接使用已经上传应用市场的 ZIP，确保预装包与市场包逐字节一致。
  if (existsSync(BUNDLED_APP_PACKAGES_ROOT)) {
    const packages = new Map<string, { path: string; version: string; build: number }>()
    for (const entry of readdirSync(BUNDLED_APP_PACKAGES_ROOT, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const match = packageNamePattern.exec(entry.name)
      if (!match || !stableBundledAppIds.has(match[1])) continue
      if (packages.has(match[1])) throw new Error(`内置 APP 存在多个发布包：${match[1]}`)
      packages.set(match[1], {
        path: join(BUNDLED_APP_PACKAGES_ROOT, entry.name),
        version: match[2],
        build: Number(match[3]),
      })
    }
    for (const id of STABLE_BUNDLED_APP_IDS) {
      if (excluded.has(id)) continue
      const bundled = packages.get(id)
      if (!bundled) throw new Error(`内置 APP 发布包缺失：${id}`)
      const current = installed.find((item) => item.id === id)
      if (current && compareAppVersion(current.manifest, bundled) >= 0) {
        results.push({ id, action: 'current' })
        continue
      }
      importDeveloperApp(readFileSync(bundled.path), `DX OS bundled ${id}`, {
        trustedPackageId: id,
        expectedAppId: id,
        expectedVersion: bundled.version,
        expectedBuild: bundled.build,
      })
      results.push({ id, action: current ? 'upgraded' : 'installed' })
    }
    return results
  }

  // 开发环境保留目录构建回退，但也只引导稳定版白名单，不触碰其他开发 APP。
  if (!existsSync(BUNDLED_APPS_ROOT)) return []
  for (const entry of readdirSync(BUNDLED_APPS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z][a-z0-9-]{2,42}$/.test(entry.name)) continue
    if (!stableBundledAppIds.has(entry.name)) continue
    if (excluded.has(entry.name)) continue
    const root = join(BUNDLED_APPS_ROOT, entry.name)
    const manifestPath = join(root, 'dx-app.json')
    const entryPath = join(root, 'index.html')
    if (!existsSync(manifestPath) || !existsSync(entryPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id?: string; version?: string; build?: number }
    if (manifest.id !== entry.name || !isValidSemver(manifest.version) || !Number.isSafeInteger(manifest.build) || Number(manifest.build) < 1) {
      throw new Error(`内置 APP ${entry.name} 的版本清单不合法`)
    }
    const current = installed.find((item) => item.id === entry.name)
    if (current && compareAppVersion(current.manifest, { version: manifest.version, build: Number(manifest.build) }) >= 0) {
      results.push({ id: entry.name, action: 'current' })
      continue
    }
    const buffer = buildZip(packageFiles(root))
    importDeveloperApp(buffer, `DX OS bundled ${entry.name}`, {
      trustedPackageId: entry.name,
      expectedAppId: entry.name,
      expectedVersion: manifest.version,
      expectedBuild: Number(manifest.build),
    })
    results.push({ id: entry.name, action: current ? 'upgraded' : 'installed' })
  }
  return results
}
