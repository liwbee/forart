import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'
import { ccsDb } from './ccsDb.ts'

const WALLPAPER_DIR = dataPath('wallpapers')
if (!existsSync(WALLPAPER_DIR)) mkdirSync(WALLPAPER_DIR, { recursive: true })

interface WallpaperRow {
  id: string
  user_id: string
  name: string
  mime: string
  size: number
  created_at: number
}

export interface AccountWallpaper {
  id: string
  name: string
  mime: string
  size: number
  createdAt: number
}

function wallpaperView(row: WallpaperRow): AccountWallpaper {
  return { id: row.id, name: row.name, mime: row.mime, size: row.size, createdAt: row.created_at }
}

function rowFor(userId: string, id: string) {
  return ccsDb.prepare('SELECT * FROM user_wallpapers WHERE id=? AND user_id=?').get(id, userId) as WallpaperRow | undefined
}

export function wallpaperPath(userId: string, id: string) {
  const row = rowFor(userId, id)
  if (!row) throw new Error('壁纸不存在')
  return { path: join(WALLPAPER_DIR, row.id), mime: row.mime }
}

export function getWallpaperPreferences(userId: string) {
  const pref = ccsDb.prepare('SELECT active_wallpaper_id FROM user_preferences WHERE user_id=?').get(userId) as { active_wallpaper_id: string } | undefined
  const rows = ccsDb.prepare('SELECT * FROM user_wallpapers WHERE user_id=? ORDER BY created_at ASC').all(userId) as WallpaperRow[]
  const requested = pref?.active_wallpaper_id || 'system-default'
  const activeId = requested === 'system-default' || rows.some((row) => row.id === requested) ? requested : 'system-default'
  return { activeId, wallpapers: rows.map(wallpaperView) }
}

export function addWallpapers(userId: string, files: Array<{ originalname: string; mimetype: string; size: number; buffer: Buffer }>) {
  const images = files.filter((file) => file.mimetype.startsWith('image/'))
  if (!images.length) throw new Error('请选择图片文件')
  if (images.some((file) => file.size > 30 * 1024 * 1024)) throw new Error('每张壁纸不能超过 30 MB')
  const count = Number((ccsDb.prepare('SELECT COUNT(*) AS count FROM user_wallpapers WHERE user_id=?').get(userId) as { count: number }).count)
  if (count + images.length > 12) throw new Error('最多保存 12 张自定义壁纸')
  const now = Date.now()
  const created: AccountWallpaper[] = []
  const insert = ccsDb.prepare('INSERT INTO user_wallpapers(id,user_id,name,mime,size,created_at) VALUES (?,?,?,?,?,?)')
  for (const [index, file] of images.entries()) {
    const id = randomUUID()
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 240) || '自定义壁纸'
    writeFileSync(join(WALLPAPER_DIR, id), file.buffer)
    insert.run(id, userId, name, file.mimetype, file.size, now + index)
    created.push({ id, name, mime: file.mimetype, size: file.size, createdAt: now + index })
  }
  return created
}

export function selectWallpaper(userId: string, id: string) {
  if (id !== 'system-default' && !rowFor(userId, id)) throw new Error('壁纸不存在')
  ccsDb.prepare(`
    INSERT INTO user_preferences(user_id,active_wallpaper_id,updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET active_wallpaper_id=excluded.active_wallpaper_id,updated_at=excluded.updated_at
  `).run(userId, id, Date.now())
}

export function removeWallpaper(userId: string, id: string) {
  const row = rowFor(userId, id)
  if (!row) throw new Error('壁纸不存在')
  const tx = ccsDb.transaction(() => {
    ccsDb.prepare('DELETE FROM user_wallpapers WHERE id=? AND user_id=?').run(id, userId)
    ccsDb.prepare("UPDATE user_preferences SET active_wallpaper_id='system-default',updated_at=? WHERE user_id=? AND active_wallpaper_id=?").run(Date.now(), userId, id)
  })
  tx()
  const path = join(WALLPAPER_DIR, id)
  if (existsSync(path)) unlinkSync(path)
}

export function installedApps(userId: string) {
  return (ccsDb.prepare('SELECT app_id FROM user_installed_apps WHERE user_id=? ORDER BY installed_at').all(userId) as Array<{ app_id: string }>).map((row) => row.app_id)
}

export function installedAppRecords(userId: string) {
  return ccsDb.prepare('SELECT app_id AS appId,installed_version AS version,installed_build AS build,release_channel AS releaseChannel,installed_at AS installedAt,updated_at AS updatedAt FROM user_installed_apps WHERE user_id=? ORDER BY installed_at').all(userId) as Array<{ appId: string; version: string; build: number; releaseChannel: string; installedAt: number; updatedAt: number }>
}

export function setAppInstalled(userId: string, appId: string, installed: boolean, release?: { version?: unknown; build?: unknown; releaseChannel?: unknown }) {
  const id = String(appId || '').trim()
  if (!/^[a-z][a-z0-9-]{1,100}$/.test(id)) throw new Error('APP ID 不合法')
  const version = String(release?.version || '0.0.0').trim()
  const build = Math.max(0, Math.round(Number(release?.build) || 0))
  const releaseChannel = release?.releaseChannel === 'beta' || release?.releaseChannel === 'dev' ? release.releaseChannel : 'stable'
  const tx = ccsDb.transaction(() => {
    ccsDb.prepare('INSERT OR IGNORE INTO user_app_install_state(user_id,migrated_at) VALUES (?,?)').run(userId, Date.now())
    if (installed) ccsDb.prepare('INSERT INTO user_installed_apps(user_id,app_id,installed_at,installed_version,installed_build,release_channel,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,app_id) DO UPDATE SET installed_version=excluded.installed_version,installed_build=excluded.installed_build,release_channel=excluded.release_channel,updated_at=excluded.updated_at').run(userId, id, Date.now(), version, build, releaseChannel, Date.now())
    else ccsDb.prepare('DELETE FROM user_installed_apps WHERE user_id=? AND app_id=?').run(userId, id)
  })
  tx()
  return installedApps(userId)
}

export function migrateInstalledApps(userId: string, appIds: unknown, requiredAppIds: unknown = []) {
  const ids = Array.isArray(appIds) ? [...new Set(appIds.map(String).filter((id) => /^[a-z][a-z0-9-]{1,100}$/.test(id)).slice(0, 200))] : []
  const requiredIds = Array.isArray(requiredAppIds) ? [...new Set(requiredAppIds.map(String).filter((id) => /^[a-z][a-z0-9-]{1,100}$/.test(id)).slice(0, 200))] : []
  const tx = ccsDb.transaction(() => {
    const state = ccsDb.prepare('SELECT migrated_at,catalog_migrated_at FROM user_app_install_state WHERE user_id=?').get(userId) as { migrated_at: number; catalog_migrated_at: number | null } | undefined
    const insert = ccsDb.prepare('INSERT OR IGNORE INTO user_installed_apps(user_id,app_id,installed_at) VALUES (?,?,?)')
    if (!state?.catalog_migrated_at) {
      ids.forEach((id, index) => insert.run(userId, id, Date.now() + index))
      // Bundled APP packages are a one-time convenience install for a new
      // account/data environment. They are not persistent system components:
      // an explicit uninstall must survive refresh, restart and OS upgrades.
      requiredIds.forEach((id, index) => insert.run(userId, id, Date.now() + ids.length + index))
      if (state) ccsDb.prepare('UPDATE user_app_install_state SET catalog_migrated_at=? WHERE user_id=?').run(Date.now(), userId)
      else ccsDb.prepare('INSERT INTO user_app_install_state(user_id,migrated_at,catalog_migrated_at) VALUES (?,?,?)').run(userId, Date.now(), Date.now())
    }
  })
  tx()
  return installedApps(userId)
}

export function removeInstalledAppEverywhere(appId: string) {
  ccsDb.prepare('DELETE FROM user_installed_apps WHERE app_id=?').run(appId)
}

const SIMPLE_MODE_KEY = 'interface.simpleMode'
const SIMPLE_SHOW_SYSTEM_APPS_KEY = 'interface.simpleShowSystemApps'

export function getSystemInterfacePreferences() {
  const rows = ccsDb.prepare('SELECT preference_key,preference_value FROM system_preferences WHERE preference_key IN (?,?)').all(SIMPLE_MODE_KEY, SIMPLE_SHOW_SYSTEM_APPS_KEY) as Array<{ preference_key: string; preference_value: string }>
  const values = new Map(rows.map((row) => [row.preference_key, row.preference_value]))
  return {
    simpleMode: values.get(SIMPLE_MODE_KEY) === '1',
    simpleShowSystemApps: values.get(SIMPLE_SHOW_SYSTEM_APPS_KEY) !== '0',
  }
}

export function setSystemInterfacePreferences(userId: string, patch: { simpleMode?: boolean; simpleShowSystemApps?: boolean }) {
  const upsert = ccsDb.prepare(`
    INSERT INTO system_preferences(preference_key,preference_value,updated_by,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(preference_key) DO UPDATE SET preference_value=excluded.preference_value,updated_by=excluded.updated_by,updated_at=excluded.updated_at
  `)
  const tx = ccsDb.transaction(() => {
    const now = Date.now()
    if (typeof patch.simpleMode === 'boolean') upsert.run(SIMPLE_MODE_KEY, patch.simpleMode ? '1' : '0', userId, now)
    if (typeof patch.simpleShowSystemApps === 'boolean') upsert.run(SIMPLE_SHOW_SYSTEM_APPS_KEY, patch.simpleShowSystemApps ? '1' : '0', userId, now)
  })
  tx()
  return getSystemInterfacePreferences()
}
