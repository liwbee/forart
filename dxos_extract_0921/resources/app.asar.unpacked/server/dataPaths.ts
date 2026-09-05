import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEGACY_DATA_ROOT = resolve(process.env.DX_LEGACY_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data'))

function defaultDataRoot() {
  const platformRoot = process.env.LOCALAPPDATA || process.env.APPDATA
  return join(platformRoot || homedir(), 'DX OS', 'data')
}

export const DATA_ROOT = resolve(process.env.DX_DATA_DIR || process.env.CCS_DATA_DIR || defaultDataRoot())
export const DATA_LAYOUT_VERSION = 1

function directoryHasEntries(path: string) {
  try { return readdirSync(path).some((name) => name !== '.data-layout.json') }
  catch { return false }
}

function mergeMissing(source: string, target: string) {
  if (!existsSync(source)) return
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) mergeMissing(from, to)
    else if (entry.isFile() && !existsSync(to)) {
      const temp = `${to}.migrating-${process.pid}.tmp`
      rmSync(temp, { force: true })
      copyFileSync(from, temp)
      renameSync(temp, to)
    }
  }
}

/**
 * Runs before databases and stores are opened. The legacy directory is copied,
 * never removed, so an interrupted first launch can safely be retried.
 */
export function ensureExternalDataLayout() {
  mkdirSync(DATA_ROOT, { recursive: true })
  const markerPath = join(DATA_ROOT, '.data-layout.json')
  let marker: { version?: number } | null = null
  try { marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { version?: number } } catch { /* first launch */ }
  const sameLocation = resolve(DATA_ROOT).toLowerCase() === resolve(LEGACY_DATA_ROOT).toLowerCase()
  if (!sameLocation && (!marker || marker.version !== DATA_LAYOUT_VERSION)) mergeMissing(LEGACY_DATA_ROOT, DATA_ROOT)
  if (!marker || marker.version !== DATA_LAYOUT_VERSION) {
    writeFileSync(markerPath, JSON.stringify({
      version: DATA_LAYOUT_VERSION,
      migratedAt: Date.now(),
      migratedFrom: sameLocation ? null : LEGACY_DATA_ROOT,
      legacyHadData: !sameLocation && directoryHasEntries(LEGACY_DATA_ROOT),
    }, null, 2), 'utf8')
  }
  return DATA_ROOT
}

ensureExternalDataLayout()

export function dataPath(...segments: string[]) { return join(DATA_ROOT, ...segments) }
export function ensureDataDir(...segments: string[]) {
  const path = dataPath(...segments)
  mkdirSync(path, { recursive: true })
  return path
}

export function dataFileInfo(path: string) {
  const stat = statSync(path)
  return { size: stat.size, updatedAt: stat.mtimeMs }
}
