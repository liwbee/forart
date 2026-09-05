import { randomUUID } from 'node:crypto'
import { ccsDb } from './ccsDb.ts'

function sanitize(value: unknown) {
  return String(value || '').slice(0, 4000)
    .replace(/(authorization|api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
}

export function recordAppRuntimeEvent(input: { appId: string; version: string; build: number; userId: string; eventType: string; detail?: unknown }) {
  ccsDb.prepare('INSERT INTO app_runtime_events(id,app_id,version,build,user_id,event_type,detail,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), input.appId, input.version, input.build, input.userId, input.eventType.slice(0, 60), sanitize(input.detail), Date.now())
}

export function appRuntimeDiagnostics(appId: string, days = 30) {
  const since = Date.now() - Math.max(1, Math.min(90, Math.round(days))) * 86_400_000
  const summary = ccsDb.prepare(`SELECT version,build,event_type AS eventType,COUNT(*) AS count,MAX(created_at) AS lastAt
    FROM app_runtime_events WHERE app_id=? AND created_at>=? GROUP BY version,build,event_type ORDER BY lastAt DESC`).all(appId, since)
  const recent = ccsDb.prepare(`SELECT version,build,event_type AS eventType,detail,created_at AS createdAt
    FROM app_runtime_events WHERE app_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 100`).all(appId, since)
  const network = ccsDb.prepare(`SELECT origin,method,status,COUNT(*) AS count,SUM(response_bytes) AS responseBytes,MAX(created_at) AS lastAt
    FROM app_network_audit WHERE app_id=? AND created_at>=? GROUP BY origin,method,status ORDER BY lastAt DESC LIMIT 100`).all(appId, since)
  return { appId, since, summary, recent, network }
}
