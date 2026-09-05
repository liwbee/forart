import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataPath } from '../dataPaths.ts'
import type { ProtocolExecutionOutput } from '../protocol-engine/workflow.ts'
import { downloadProtocolArtifact, type ProtocolArtifactDownloader } from '../protocol-engine/artifactDownload.ts'
import { aiProtocolTaskDb } from './store.ts'

export type AiProtocolArtifact = {
  id: string
  taskId: string
  kind: ProtocolExecutionOutput['kind']
  mime: string
  bytes: number
  sha256: string
  sourceUrl?: string
  createdAt: number
}

const root = process.env.DX_PROTOCOL_ARTIFACT_DIR || dataPath('protocol-artifacts')

aiProtocolTaskDb.exec(`
CREATE TABLE IF NOT EXISTS ai_protocol_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_protocol_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  source_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_protocol_artifacts_task ON ai_protocol_artifacts(task_id, created_at);
`)

function taskDirectory(taskId: string) {
  const directory = join(root, createHash('sha256').update(taskId).digest('hex'))
  mkdirSync(directory, { recursive: true })
  return directory
}

function artifactPath(taskId: string, artifactId: string) { return join(taskDirectory(taskId), `${artifactId}.bin`) }

function safeSourceUrl(value?: string) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch { return undefined }
}

function artifactMime(kind: ProtocolExecutionOutput['kind'], declared?: string, observed?: string) {
  const actual = String(observed && observed !== 'application/octet-stream' ? observed : declared || '').split(';')[0].toLowerCase()
  const fallback = kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : kind === 'text' ? 'text/plain' : 'application/octet-stream'
  const mime = actual || fallback
  const valid = kind === 'file' || kind === 'image' && mime.startsWith('image/') || kind === 'video' && mime.startsWith('video/')
    || kind === 'audio' && mime.startsWith('audio/') || kind === 'text' && mime.startsWith('text/')
  if (!valid || mime === 'text/html') throw new Error(`协议产物 MIME「${mime}」与输出类型 ${kind} 不匹配。`)
  return mime
}

export function saveAiProtocolArtifact(taskId: string, output: ProtocolExecutionOutput, data: Uint8Array, sourceUrl?: string): AiProtocolArtifact {
  if (!aiProtocolTaskDb.prepare('SELECT 1 FROM ai_protocol_tasks WHERE id=?').get(taskId)) throw new Error(`协议任务「${taskId}」不存在。`)
  const id = randomUUID()
  const bytes = data.byteLength
  const sha256 = createHash('sha256').update(data).digest('hex')
  const mime = artifactMime(output.kind, output.mime).slice(0, 200)
  const safeSource = safeSourceUrl(sourceUrl)
  const path = artifactPath(taskId, id)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, data)
  renameSync(temporary, path)
  const createdAt = Date.now()
  try {
    aiProtocolTaskDb.prepare('INSERT INTO ai_protocol_artifacts(id,task_id,kind,mime,bytes,sha256,source_url,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, taskId, output.kind, mime, bytes, sha256, safeSource || null, createdAt)
  } catch (error) {
    rmSync(path, { force: true })
    throw error
  }
  return { id, taskId, kind: output.kind, mime, bytes, sha256, ...(safeSource ? { sourceUrl: safeSource } : {}), createdAt }
}

export function readAiProtocolArtifact(taskId: string, artifactId: string) {
  const row = aiProtocolTaskDb.prepare(`SELECT id,task_id AS taskId,kind,mime,bytes,sha256,source_url AS sourceUrl,created_at AS createdAt
    FROM ai_protocol_artifacts WHERE id=? AND task_id=?`).get(artifactId, taskId) as AiProtocolArtifact | undefined
  if (!row) return null
  const path = artifactPath(taskId, artifactId)
  if (!existsSync(path)) throw new Error(`协议产物「${artifactId}」文件缺失。`)
  const data = readFileSync(path)
  if (data.byteLength !== row.bytes || createHash('sha256').update(data).digest('hex') !== row.sha256) throw new Error(`协议产物「${artifactId}」完整性校验失败。`)
  return { artifact: row, data }
}

export async function materializeAiProtocolOutputs(taskId: string, outputs: ProtocolExecutionOutput[], downloader: ProtocolArtifactDownloader = downloadProtocolArtifact) {
  const artifacts: AiProtocolArtifact[] = []
  for (const output of outputs) {
    if (output.data) {
      artifacts.push(saveAiProtocolArtifact(taskId, output, output.data, output.sourceUrl))
      continue
    }
    if (!output.url) throw new Error(`协议输出 ${output.kind} 没有 URL 或二进制内容。`)
    const downloaded = await downloader(output.url)
    artifacts.push(saveAiProtocolArtifact(taskId, { ...output, mime: artifactMime(output.kind, output.mime, downloaded.mime) }, downloaded.data, downloaded.sourceUrl))
  }
  return artifacts
}
