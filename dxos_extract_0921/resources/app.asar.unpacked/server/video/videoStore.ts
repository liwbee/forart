import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from '../dataPaths.ts'
import { ccsDb } from '../ccsDb.ts'
import { compileRenderPlan } from './renderPlan.ts'
import type { MediaProbeResult } from './mediaProbe.ts'
import type { VideoAsset, VideoTimeline } from '../../src/apps/video-editor/videoDomain.ts'

const VIDEO_DIR = process.env.CCS_VIDEO_DATA_DIR || dataPath('video')
const ASSET_DIR = join(VIDEO_DIR, 'assets')
const RENDER_DIR = join(VIDEO_DIR, 'renders')
for (const path of [VIDEO_DIR, ASSET_DIR, RENDER_DIR]) if (!existsSync(path)) mkdirSync(path, { recursive: true })

ccsDb.exec(`
CREATE TABLE IF NOT EXISTS video_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS video_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS video_render_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  timeline_json TEXT NOT NULL,
  timeline_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  lease_until INTEGER,
  heartbeat_at INTEGER,
  output_path TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_video_assets_project ON video_assets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_jobs_queue ON video_render_jobs(status, lease_until, created_at);
CREATE INDEX IF NOT EXISTS idx_video_jobs_project ON video_render_jobs(project_id, created_at DESC);
`)

export type VideoRenderStatus = 'queued' | 'running' | 'interrupted' | 'completed' | 'failed' | 'cancelled'
export interface VideoAssetRow {
  id: string; project_id: string; owner_id: string; name: string; mime: string; size: number; kind: VideoAsset['kind']
  file_path: string; metadata_json: string; created_at: number
}
export interface VideoRenderJobRow {
  id: string; project_id: string; owner_id: string; timeline_json: string; timeline_version: number; status: VideoRenderStatus
  progress: number; worker_id: string | null; lease_until: number | null; heartbeat_at: number | null; output_path: string | null
  error: string | null; created_at: number; updated_at: number; started_at: number | null; completed_at: number | null
}

function now() { return Date.now() }
function requireUuid(value: string, label: string) {
  const id = String(value || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error(`${label}无效`)
  return id
}

export function ensureVideoProject(input: { id: string; ownerId: string; name?: string }) {
  const id = requireUuid(input.id, '视频项目 ID')
  const existing = ccsDb.prepare('SELECT * FROM video_projects WHERE id=?').get(id) as { owner_id: string } | undefined
  if (existing && existing.owner_id !== input.ownerId) throw new Error('没有该视频项目的权限')
  const ts = now()
  ccsDb.prepare(`INSERT INTO video_projects(id,owner_id,name,status,created_at,updated_at) VALUES (?,?,?,'draft',?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at WHERE owner_id=excluded.owner_id`)
    .run(id, input.ownerId, String(input.name || '未命名视频项目').trim().slice(0, 120) || '未命名视频项目', ts, ts)
  return id
}

function kindFromMime(mime: string, name: string): VideoAsset['kind'] {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  if (/\.(srt|vtt)$/i.test(name)) return 'subtitle'
  throw new Error('不支持的素材类型')
}

export function saveVideoAsset(input: { projectId: string; ownerId: string; projectName?: string; name: string; mime: string; buffer: Buffer; probe: MediaProbeResult }) {
  const projectId = ensureVideoProject({ id: input.projectId, ownerId: input.ownerId, name: input.projectName })
  const id = randomUUID()
  const sourceExt = extname(input.name).toLowerCase()
  const extension = /^\.[a-z0-9]{1,8}$/.test(sourceExt) ? sourceExt : '.bin'
  const filePath = join(ASSET_DIR, `${id}${extension}`)
  const kind = kindFromMime(input.mime, input.name)
  const ts = now()
  writeFileSync(filePath, input.buffer, { flag: 'wx' })
  try {
    ccsDb.prepare(`INSERT INTO video_assets(id,project_id,owner_id,name,mime,size,kind,file_path,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, input.ownerId, input.name.slice(0, 255), input.mime, input.buffer.length, kind, filePath, JSON.stringify(input.probe), ts)
  } catch (error) {
    try { unlinkSync(filePath) } catch { /* ignore cleanup failure */ }
    throw error
  }
  return videoAssetView(getVideoAssetRow(id, input.ownerId)!)
}

export function getVideoAssetRow(id: string, ownerId?: string) {
  return ccsDb.prepare(`SELECT * FROM video_assets WHERE id=?${ownerId ? ' AND owner_id=?' : ''}`).get(...(ownerId ? [id, ownerId] : [id])) as VideoAssetRow | undefined
}

export function listVideoAssetRows(projectId: string, ownerId: string) {
  ensureOwnedProject(projectId, ownerId)
  return ccsDb.prepare('SELECT * FROM video_assets WHERE project_id=? AND owner_id=? ORDER BY created_at DESC').all(projectId, ownerId) as VideoAssetRow[]
}

export function deleteVideoAsset(id: string, ownerId: string) {
  const row = getVideoAssetRow(id, ownerId)
  if (!row) throw new Error('素材不存在或无权删除')
  const active = ccsDb.prepare("SELECT id FROM video_render_jobs WHERE project_id=? AND owner_id=? AND status IN ('queued','running','interrupted') LIMIT 1")
    .get(row.project_id, ownerId)
  if (active) throw new Error('项目存在进行中的渲染任务，请先取消后再删除素材')
  if (existsSync(row.file_path)) unlinkSync(row.file_path)
  const changed = ccsDb.prepare('DELETE FROM video_assets WHERE id=? AND owner_id=?').run(id, ownerId).changes
  if (!changed) throw new Error('素材删除失败')
  return { id, projectId: row.project_id }
}

export function videoAssetView(row: VideoAssetRow): VideoAsset & { serverStored: true } {
  const metadata = JSON.parse(row.metadata_json || '{}') as MediaProbeResult
  return {
    id: row.id, projectId: row.project_id, kind: row.kind, name: row.name, mime: row.mime, size: row.size,
    durationMs: metadata.durationMs, width: metadata.width, height: metadata.height, fps: metadata.fps, hasVideo: metadata.hasVideo, hasAudio: metadata.hasAudio,
    formatName: metadata.formatName, bitRate: metadata.bitRate, videoCodec: metadata.videoCodec, audioCodec: metadata.audioCodec,
    audioChannels: metadata.audioChannels, sampleRate: metadata.sampleRate, probeSource: 'ffprobe', serverStored: true, createdAt: row.created_at,
  }
}

function ensureOwnedProject(projectId: string, ownerId: string) {
  const row = ccsDb.prepare('SELECT id FROM video_projects WHERE id=? AND owner_id=?').get(projectId, ownerId)
  if (!row) throw new Error('视频项目不存在或无权访问')
}

export function createVideoRenderJob(input: { projectId: string; ownerId: string; projectName?: string; timeline: VideoTimeline }) {
  ensureVideoProject({ id: input.projectId, ownerId: input.ownerId, name: input.projectName })
  const rows = listVideoAssetRows(input.projectId, input.ownerId)
  const assets = rows.map(videoAssetView)
  compileRenderPlan(input.timeline, assets, (asset) => {
    const row = rows.find((candidate) => candidate.id === asset.id)
    if (!row) throw new Error(`服务端缺少素材：${asset.name}`)
    return row.file_path
  })
  const id = randomUUID(); const ts = now()
  ccsDb.prepare(`INSERT INTO video_render_jobs(id,project_id,owner_id,timeline_json,timeline_version,status,progress,created_at,updated_at)
    VALUES (?,?,?,?,?,'queued',0,?,?)`).run(id, input.projectId, input.ownerId, JSON.stringify(input.timeline), input.timeline.version, ts, ts)
  return getVideoRenderJob(id, input.ownerId)!
}

export function getVideoRenderJob(id: string, ownerId?: string) {
  return ccsDb.prepare(`SELECT * FROM video_render_jobs WHERE id=?${ownerId ? ' AND owner_id=?' : ''}`).get(...(ownerId ? [id, ownerId] : [id])) as VideoRenderJobRow | undefined
}

export function publicVideoRenderJob(row: VideoRenderJobRow) {
  return {
    id: row.id, projectId: row.project_id, timelineVersion: row.timeline_version, status: row.status, progress: row.progress,
    error: row.error, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at,
    downloadUrl: row.status === 'completed' ? `/api/video/render-jobs/${row.id}/file` : undefined,
  }
}

export function recoverExpiredVideoJobs() {
  const ts = now()
  return ccsDb.prepare(`UPDATE video_render_jobs SET status='interrupted',worker_id=NULL,lease_until=NULL,heartbeat_at=NULL,updated_at=?
    WHERE status='running' AND lease_until IS NOT NULL AND lease_until<?`).run(ts, ts).changes
}

export function claimNextVideoRenderJob(workerId: string, leaseMs: number) {
  return ccsDb.transaction(() => {
    recoverExpiredVideoJobs()
    const row = ccsDb.prepare("SELECT id FROM video_render_jobs WHERE status IN ('queued','interrupted') ORDER BY created_at LIMIT 1").get() as { id: string } | undefined
    if (!row) return undefined
    const ts = now()
    const changed = ccsDb.prepare(`UPDATE video_render_jobs SET status='running',worker_id=?,lease_until=?,heartbeat_at=?,started_at=COALESCE(started_at,?),progress=MAX(progress,1),error=NULL,updated_at=?
      WHERE id=? AND status IN ('queued','interrupted')`).run(workerId, ts + leaseMs, ts, ts, ts, row.id).changes
    return changed ? getVideoRenderJob(row.id) : undefined
  }).immediate() as VideoRenderJobRow | undefined
}

export function heartbeatVideoRenderJob(id: string, workerId: string, leaseMs: number, progress?: number) {
  const ts = now()
  const safeProgress = progress == null ? undefined : Math.max(1, Math.min(99, Math.round(progress)))
  const result = safeProgress == null
    ? ccsDb.prepare("UPDATE video_render_jobs SET heartbeat_at=?,lease_until=?,updated_at=? WHERE id=? AND worker_id=? AND status='running'").run(ts, ts + leaseMs, ts, id, workerId)
    : ccsDb.prepare("UPDATE video_render_jobs SET heartbeat_at=?,lease_until=?,progress=?,updated_at=? WHERE id=? AND worker_id=? AND status='running'").run(ts, ts + leaseMs, safeProgress, ts, id, workerId)
  return result.changes > 0
}

export function completeVideoRenderJob(id: string, workerId: string, partialPath: string) {
  const outputPath = join(RENDER_DIR, `${id}.mp4`)
  if (existsSync(outputPath)) unlinkSync(outputPath)
  renameSync(partialPath, outputPath)
  const ts = now()
  const changed = ccsDb.prepare(`UPDATE video_render_jobs SET status='completed',progress=100,output_path=?,lease_until=NULL,heartbeat_at=NULL,completed_at=?,updated_at=?
    WHERE id=? AND worker_id=? AND status='running'`).run(outputPath, ts, ts, id, workerId).changes
  if (!changed) {
    try { unlinkSync(outputPath) } catch { /* ignore */ }
    throw new Error('渲染任务已不再由当前 Worker 持有')
  }
  return outputPath
}

export function failVideoRenderJob(id: string, workerId: string, error: string) {
  const ts = now()
  return ccsDb.prepare(`UPDATE video_render_jobs SET status='failed',error=?,lease_until=NULL,heartbeat_at=NULL,completed_at=?,updated_at=?
    WHERE id=? AND worker_id=? AND status='running'`).run(error.slice(0, 2000), ts, ts, id, workerId).changes > 0
}

export function cancelVideoRenderJob(id: string, ownerId: string) {
  const ts = now()
  const changed = ccsDb.prepare(`UPDATE video_render_jobs SET status='cancelled',lease_until=NULL,completed_at=?,updated_at=?
    WHERE id=? AND owner_id=? AND status IN ('queued','running','interrupted')`).run(ts, ts, id, ownerId).changes
  if (!changed) throw new Error('渲染任务不存在或无法取消')
  return getVideoRenderJob(id, ownerId)!
}

export function renderJobExecutionData(job: VideoRenderJobRow, attemptId = '') {
  const rows = listVideoAssetRows(job.project_id, job.owner_id)
  const timeline = JSON.parse(job.timeline_json) as VideoTimeline
  const plan = compileRenderPlan(timeline, rows.map(videoAssetView), (asset) => {
    const row = rows.find((candidate) => candidate.id === asset.id)
    if (!row) throw new Error(`服务端缺少素材：${asset.name}`)
    return row.file_path
  })
  const attempt = attemptId.replace(/[^a-z0-9_-]/gi, '').slice(0, 80)
  return { plan, partialPath: join(RENDER_DIR, `${job.id}${attempt ? `.${attempt}` : ''}.partial.mp4`) }
}
