// ══════════════════════════════════════════════════════════════════════
// 本地音乐库 —— 扫描主机上的歌曲文件夹，向浏览器流式提供音频。
// 每个浏览器用 <audio> 独立播放：各自随机、各自音量，互不干扰。
// 配置存 DX_DATA_DIR/library.json（{ dirs: string[] }）。
// ══════════════════════════════════════════════════════════════════════
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'

let musicMetadataRuntime: Promise<typeof import('music-metadata')> | null = null
type ParseMusicFile = typeof import('music-metadata').parseFile
function loadMusicMetadata() {
  if (!musicMetadataRuntime) {
    musicMetadataRuntime = import('music-metadata').catch((error) => {
      musicMetadataRuntime = null
      throw error
    })
  }
  return musicMetadataRuntime
}

const DATA_DIR = DATA_ROOT
const FILE = dataPath('library.json')
const META_FILE = dataPath('library-meta.json') // { [trackId]: { title?, artist?, album? } }
const TAG_CACHE_FILE = dataPath('library-tags.json')
const LYRICS_CACHE_FILE = dataPath('library-lyrics.json')

const AUDIO_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
}

export interface Track {
  id: string // 路径 hash，稳定且不暴露完整路径
  title: string // 整理后的显示曲名；缺失时为 fileName
  fileName: string // 原始文件名去扩展名，供 AI 整理使用
  folder?: string // 相对曲库根目录的父文件夹，不暴露绝对路径
  ext: string
  size: number
  dir: string // 所属根目录（用于显示来源）
  artist?: string // 歌手（来自手工或 AI 元数据）
  album?: string // 专辑（来自元数据覆盖）
  artistImage?: string // 歌手照片（刮削缓存后的 /api/library/artwork/<id>）
  albumImage?: string // 专辑封面
  albumArtist?: string
  trackNo?: number
  year?: number
  genre?: string[]
  duration?: number
  hasLyrics?: boolean
}

type CachedTags = {
  signature: string
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  trackNo?: number
  year?: number
  genre?: string[]
  duration?: number
  lyrics?: string
  embeddedArtworkId?: string
}
type TagCache = Record<string, CachedTags>
type LyricsCache = Record<string, { lyrics: string; source: 'embedded' | 'sidecar' | 'lrclib' }>

function loadJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as T) : fallback
  } catch {
    return fallback
  }
}
function saveJson(file: string, value: unknown) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8')
}

// ── 元数据（曲名/歌手/专辑）——手工或 AI 整理结果 ──────────────────────
type TrackMeta = { title?: string; artist?: string; album?: string }
type MetaMap = Record<string, TrackMeta>
function loadMeta(): MetaMap {
  try {
    return existsSync(META_FILE) ? (JSON.parse(readFileSync(META_FILE, 'utf-8')) as MetaMap) : {}
  } catch {
    return {}
  }
}
function saveMeta(m: MetaMap) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(META_FILE, JSON.stringify(m, null, 2), 'utf-8')
}
/** 合并保存分类结果；返回写入条数。 */
export function setMeta(items: { id: string; title?: string; artist?: string; album?: string }[]): number {
  const m = loadMeta()
  let n = 0
  for (const it of items || []) {
    const id = String(it?.id || '').trim()
    if (!id) continue
    const cur = m[id] || {}
    if (it.title !== undefined) cur.title = String(it.title).trim()
    if (it.artist !== undefined) cur.artist = String(it.artist).trim()
    if (it.album !== undefined) cur.album = String(it.album).trim()
    m[id] = cur
    n++
  }
  saveMeta(m)
  return n
}
// ── 艺术图刮削（专辑封面 / 歌手照片）——合法音乐 API + 本地缓存 ─────────
const ARTWORK_DIR = dataPath('artwork')
const ARTWORK_META = dataPath('library-artwork.json') // { artists:{name:id}, albums:{"artist\nalbum":id} }
type ArtworkMap = { artists: Record<string, string>; albums: Record<string, string> }
function loadArtwork(): ArtworkMap {
  try {
    if (existsSync(ARTWORK_META)) {
      const r = JSON.parse(readFileSync(ARTWORK_META, 'utf-8'))
      return { artists: r.artists || {}, albums: r.albums || {} }
    }
  } catch {
    /* ignore */
  }
  return { artists: {}, albums: {} }
}
function saveArtwork(m: ArtworkMap) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(ARTWORK_META, JSON.stringify(m, null, 2), 'utf-8')
}
export function artworkPath(id: string): string {
  return join(ARTWORK_DIR, id.replace(/[^a-f0-9]/g, '') + '.jpg')
}
async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'CCS-OS/1.0', Accept: 'application/json' }, signal: ctrl.signal })
    if (!r.ok) return null
    return JSON.parse(await r.text())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
/** 查一张图片 URL：专辑优先 iTunes（中国网络更稳），歌手优先 Deezer。 */
async function findImageUrl(kind: 'artist' | 'album', query: string): Promise<string | null> {
  if (kind === 'album') {
    const it = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=1`)
    const u = it?.results?.[0]?.artworkUrl100
    if (u) return String(u).replace('100x100bb', '600x600bb').replace('100x100', '600x600')
    const dz = await fetchJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=1`)
    return dz?.data?.[0]?.cover_xl || dz?.data?.[0]?.cover_big || null
  }
  const dz = await fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=8`)
  const candidates = Array.isArray(dz?.data) ? dz.data : []
  const normalize = (value: unknown) => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const picture = (candidate: any) => String(candidate?.picture_xl || candidate?.picture_big || '')
  const valid = (candidate: any) => /^https:\/\//i.test(picture(candidate)) && !/\/artist\/\//i.test(picture(candidate))
  const candidate = candidates.find((item: any) => normalize(item.name) === normalize(query) && valid(item))
    || candidates.find((item: any) => valid(item))
  return candidate ? picture(candidate) : null
}
async function downloadImage(url: string): Promise<Buffer | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length < 200 ? null : buf
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface ArtworkTargets {
  artists: string[]
  albums: { artist: string; album: string; key: string }[]
}
/** 当前曲库里“还没有图”的歌手与「歌手+专辑」列表，供刮削 / AI 生成共用。 */
export async function artworkTargets(): Promise<ArtworkTargets> {
  const tracks = await listTracks()
  const art = loadArtwork()
  const artistSet = new Set<string>()
  const albumKeys = new Map<string, { artist: string; album: string }>()
  for (const t of tracks) {
    if (t.artist) artistSet.add(t.artist)
    if (t.artist && t.album) albumKeys.set(`${t.artist}\n${t.album}`, { artist: t.artist, album: t.album })
  }
  const artists = [...artistSet].filter((n) => !art.artists[n])
  const albums = [...albumKeys.entries()].filter(([k]) => !art.albums[k]).map(([key, v]) => ({ ...v, key }))
  return { artists, albums }
}

/** 把一张图片（刮削或 AI 生成的字节）写入艺术图缓存并登记到 map；返回缓存 id。 */
export function putArtwork(scope: 'artist' | 'album', key: string, buf: Buffer): string {
  const id = createHash('md5').update(scope + '|' + key + '|' + buf.length).digest('hex').slice(0, 16)
  if (!existsSync(ARTWORK_DIR)) mkdirSync(ARTWORK_DIR, { recursive: true })
  writeFileSync(artworkPath(id), buf)
  const art = loadArtwork()
  if (scope === 'artist') art.artists[key] = id
  else art.albums[key] = id
  saveArtwork(art)
  return id
}

/** 将客户端发现的可信音乐图片落到本地艺术图缓存，避免每次打开音乐重复请求外站。 */
export async function cacheRemoteArtwork(scope: 'artist' | 'album', key: string, rawUrl: string): Promise<string> {
  const cacheKey = String(key || '').trim()
  if (!cacheKey || cacheKey.length > 300) throw new Error('艺术图缓存键无效')
  let url: URL
  try { url = new URL(String(rawUrl || '').trim()) } catch { throw new Error('艺术图地址无效') }
  const host = url.hostname.toLowerCase()
  const trusted = url.protocol === 'https:' && (host === 'e-cdns-images.dzcdn.net' || host.endsWith('.dzcdn.net') || host === 'is1-ssl.mzstatic.com' || host.endsWith('.mzstatic.com'))
  if (!trusted) throw new Error('只允许缓存受信任音乐服务的图片')
  const buf = await downloadImage(url.toString())
  if (!buf) throw new Error('艺术图下载失败')
  const id = putArtwork(scope, cacheKey, buf)
  const localUrl = `/api/library/artwork/${id}`
  for (const track of trackCache) {
    if (scope === 'artist' && track.artist === cacheKey) track.artistImage = localUrl
    if (scope === 'album' && `${track.albumArtist || track.artist || ''}\n${track.album || ''}` === cacheKey) track.albumImage = localUrl
  }
  return localUrl
}

/**
 * 刮削缺失的封面/歌手照片（合法音乐 API）。best-effort：抓不到（网络受限）就跳过，
 * 之后可用 AI 生成兜底。返回统计。
 */
export async function scrapeArtwork(): Promise<{ artists: number; albums: number; failed: number }> {
  const { artists, albums } = await artworkTargets()
  let artistsDone = 0
  let albumsDone = 0
  let failed = 0
  for (const name of artists) {
    const url = await findImageUrl('artist', name)
    const buf = url ? await downloadImage(url) : null
    if (buf) {
      putArtwork('artist', name, buf)
      artistsDone++
    } else failed++
  }
  for (const { artist, album, key } of albums) {
    const url = await findImageUrl('album', `${artist} ${album}`)
    const buf = url ? await downloadImage(url) : null
    if (buf) {
      putArtwork('album', key, buf)
      albumsDone++
    } else failed++
  }
  await scan() // 让缓存里的 track 带上新图
  return { artists: artistsDone, albums: albumsDone, failed }
}

interface LibConfig {
  dirs: string[]
}

// id → 绝对路径 索引（扫描时重建）
const pathIndex = new Map<string, string>()
let trackCache: Track[] = []
let lastScan = 0

function loadCfg(): LibConfig {
  try {
    if (!existsSync(FILE)) return { dirs: [] }
    const raw = JSON.parse(readFileSync(FILE, 'utf-8')) as LibConfig
    return { dirs: Array.isArray(raw.dirs) ? raw.dirs : [] }
  } catch {
    return { dirs: [] }
  }
}
function persist(cfg: LibConfig) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(cfg, null, 2), 'utf-8')
}

export function getConfig(): LibConfig & { trackCount: number } {
  return { ...loadCfg(), trackCount: trackCache.length }
}

export function setDirs(dirs: string[]): { dirs: string[]; errors: string[] } {
  const errors: string[] = []
  const valid: string[] = []
  for (const d of dirs.map((x) => String(x).trim()).filter(Boolean)) {
    const abs = resolve(d)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      errors.push(`目录不存在：${d}`)
      continue
    }
    if (!valid.includes(abs)) valid.push(abs)
  }
  persist({ dirs: valid })
  return { dirs: valid, errors }
}

/**
 * 把上传的音频文件写入首个曲库目录（用户设定的歌曲文件夹）。
 * 文件名已在路由层做 latin1→utf8 转码。跳过非音频扩展名与目录未配置的情况。
 */
export function uploadFiles(files: { name: string; buffer: Buffer }[]): { saved: number; skipped: string[] } {
  const dirs = loadCfg().dirs
  const target = dirs[0]
  if (!target || !existsSync(target)) {
    return { saved: 0, skipped: files.map((f) => f.name) }
  }
  let saved = 0
  const skipped: string[] = []
  for (const f of files) {
    const name = basename(f.name).trim()
    if (!name || !AUDIO_EXT[extname(name).toLowerCase()]) {
      skipped.push(f.name || '(无名文件)')
      continue
    }
    const dest = join(target, name)
    if (existsSync(dest)) {
      skipped.push(`${name}（已存在）`)
      continue
    }
    try {
      writeFileSync(dest, f.buffer)
      saved++
    } catch (e) {
      skipped.push(`${name}（写入失败：${String((e as Error).message || e)}）`)
    }
  }
  return { saved, skipped }
}

/** 递归扫描（限深 6 层、单库上限 5000 首，防误选超大目录）。 */
async function scanDir(root: string, dir: string, out: Track[], depth: number) {
  if (depth > 6 || out.length >= 5000) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= 5000) return
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) await scanDir(root, full, out, depth + 1)
    } else {
      const ext = extname(e.name).toLowerCase()
      if (!AUDIO_EXT[ext]) continue
      let size = 0
      let modified = 0
      try {
        const stat = statSync(full)
        size = stat.size
        modified = stat.mtimeMs
      } catch {
        continue
      }
      const id = createHash('md5').update(full).digest('hex').slice(0, 16)
      pathIndex.set(id, full)
      const fileName = basename(e.name, extname(e.name))
      const folder = relative(root, dirname(full)).replace(/\\/g, '/') || undefined
      out.push({ id, title: fileName, fileName, folder, ext: ext.slice(1), size, dir: basename(root), _signature: `${size}:${modified}` } as Track)
    }
  }
}

function lyricsText(value: Awaited<ReturnType<ParseMusicFile>>['common']['lyrics']): string | undefined {
  const first = value?.find((item) => item.syncText?.length || item.text)
  if (!first) return undefined
  if (first.syncText?.length) {
    return first.syncText.map((line) => `[${Math.floor((line.timestamp || 0) / 60).toString().padStart(2, '0')}:${((line.timestamp || 0) % 60).toFixed(2).padStart(5, '0')}]${line.text}`).join('\n')
  }
  return first.text?.trim() || undefined
}

async function readSidecarLyrics(audioPath: string): Promise<string | undefined> {
  const lrc = audioPath.slice(0, -extname(audioPath).length) + '.lrc'
  try {
    return (await readFile(lrc, 'utf-8')).trim() || undefined
  } catch {
    return undefined
  }
}

async function enrichTrack(track: Track, tags: TagCache, lyrics: LyricsCache) {
  const file = pathIndex.get(track.id)
  if (!file) return
  const signature = String((track as Track & { _signature?: string })._signature || '')
  let cached = tags[track.id]
  if (!cached || cached.signature !== signature) {
    cached = { signature }
    try {
      const { parseFile } = await loadMusicMetadata()
      const parsed = await parseFile(file, { duration: true, skipCovers: false })
      const c = parsed.common
      cached.title = c.title?.trim() || undefined
      cached.artist = c.artist?.trim() || c.artists?.filter(Boolean).join(' / ') || undefined
      cached.album = c.album?.trim() || undefined
      cached.albumArtist = c.albumartist?.trim() || undefined
      cached.trackNo = c.track.no || undefined
      cached.year = c.year
      cached.genre = c.genre?.filter(Boolean)
      cached.duration = parsed.format.duration
      cached.lyrics = lyricsText(c.lyrics)
      const picture = c.picture?.[0]
      if (picture?.data?.length) {
        const key = `${track.id}\nembedded`
        cached.embeddedArtworkId = putArtwork('album', key, Buffer.from(picture.data))
      }
    } catch {
      // 损坏或不支持的音频仍保留文件名兜底，不能阻断整库扫描。
    }
    const sidecar = await readSidecarLyrics(file)
    if (sidecar) lyrics[track.id] = { lyrics: sidecar, source: 'sidecar' }
    else if (cached.lyrics) lyrics[track.id] = { lyrics: cached.lyrics, source: 'embedded' }
    tags[track.id] = cached
  }
  track.title = cached.title || track.fileName
  track.artist = cached.artist
  track.album = cached.album
  track.albumArtist = cached.albumArtist
  track.trackNo = cached.trackNo
  track.year = cached.year
  track.genre = cached.genre
  track.duration = cached.duration
  track.hasLyrics = !!lyrics[track.id]
  if (cached.embeddedArtworkId) track.albumImage = `/api/library/artwork/${cached.embeddedArtworkId}`
  delete (track as Track & { _signature?: string })._signature
}

export async function scan(): Promise<Track[]> {
  const cfg = loadCfg()
  pathIndex.clear()
  const out: Track[] = []
  for (const d of cfg.dirs) await scanDir(d, d, out, 0)
  // 本地标签是可靠基础层；限制并发，避免大曲库扫描占满文件句柄。
  const tags = loadJson<TagCache>(TAG_CACHE_FILE, {})
  const lyrics = loadJson<LyricsCache>(LYRICS_CACHE_FILE, {})
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(6, out.length) }, async () => {
    while (cursor < out.length) await enrichTrack(out[cursor++], tags, lyrics)
  }))
  saveJson(TAG_CACHE_FILE, tags)
  saveJson(LYRICS_CACHE_FILE, lyrics)
  // 手工/AI 元数据是显式覆盖层，不覆盖时保留音频文件标签。
  const meta = loadMeta()
  const art = loadArtwork()
  for (const t of out) {
    const m = meta[t.id]
    t.title = m?.title || t.title || t.fileName
    t.artist = m?.artist || t.artist
    if (m?.album) t.album = m.album
    if (t.artist && art.artists[t.artist]) t.artistImage = `/api/library/artwork/${art.artists[t.artist]}`
    if (!t.albumImage && t.artist && t.album && art.albums[`${t.artist}\n${t.album}`]) {
      t.albumImage = `/api/library/artwork/${art.albums[`${t.artist}\n${t.album}`]}`
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  trackCache = out
  lastScan = Date.now()
  return out
}

export async function getLyrics(id: string, online = true): Promise<{ lyrics: string; source: string } | null> {
  await listTracks()
  const cached = loadJson<LyricsCache>(LYRICS_CACHE_FILE, {})
  if (cached[id]) return cached[id]
  if (!online) return null
  const track = trackCache.find((item) => item.id === id)
  if (!track?.artist || !track.title) return null
  const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist })
  if (track.album) params.set('album_name', track.album)
  if (track.duration) params.set('duration', String(Math.round(track.duration)))
  const result = await fetchJson(`https://lrclib.net/api/get?${params.toString()}`, 8000)
  const text = String(result?.syncedLyrics || result?.plainLyrics || '').trim()
  if (!text) return null
  cached[id] = { lyrics: text, source: 'lrclib' }
  saveJson(LYRICS_CACHE_FILE, cached)
  const found = trackCache.find((item) => item.id === id)
  if (found) found.hasLyrics = true
  return cached[id]
}

export async function listTracks(): Promise<Track[]> {
  // 5 分钟内的缓存直接用；否则重扫
  if (!trackCache.length || Date.now() - lastScan > 5 * 60_000) await scan()
  return trackCache
}

/** 流式输出音频，支持 Range（浏览器 seek 必需）。 */
export function streamTrack(req: Request, res: Response) {
  const file = pathIndex.get(String(req.params.id))
  if (!file || !existsSync(file)) {
    res.status(404).json({ ok: false, error: '曲目不存在（可能已被移动，请重新扫描）' })
    return
  }
  const size = statSync(file).size
  const mime = AUDIO_EXT[extname(file).toLowerCase()] || 'application/octet-stream'
  const range = req.headers.range
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? parseInt(m[1], 10) : 0
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1
    if (isNaN(start) || start < 0) start = 0
    if (isNaN(end) || end >= size) end = size - 1
    if (start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end()
      return
    }
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Length', end - start + 1)
    res.setHeader('Content-Type', mime)
    createReadStream(file, { start, end }).pipe(res)
  } else {
    res.setHeader('Content-Length', size)
    res.setHeader('Content-Type', mime)
    res.setHeader('Accept-Ranges', 'bytes')
    createReadStream(file).pipe(res)
  }
}
