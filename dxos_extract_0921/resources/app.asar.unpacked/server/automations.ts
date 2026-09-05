import { randomUUID } from 'node:crypto'
import { ccsDb } from './ccsDb.ts'

export type AutomationSchedule =
  | { type: 'daily'; hour: number; minute: number; timezone?: string }
  | { type: 'weekly'; weekdays: number[]; hour: number; minute: number; timezone?: string }
  | { type: 'once'; at: number; timezone?: string }

export type AutomationAction = {
  type: 'music_play' | 'music_control' | 'open_app' | 'agent_instruction'
  args: Record<string, unknown>
}

export interface AutomationDefinition {
  title: string
  instruction: string
  schedule: AutomationSchedule
  action: AutomationAction
}

interface AutomationRow {
  id: string
  created_by: string
  title: string
  instruction: string
  action_json: string
  schedule_json: string
  enabled: number
  next_run_at: number | null
  last_run_at: number | null
  last_status: string | null
  last_error: string | null
  created_at: number
  updated_at: number
}

interface RunRow {
  id: string
  automation_id: string
  scheduled_for: number
  status: string
  client_id: string | null
  result: string | null
  error: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
}

function json<T>(value: string): T {
  return JSON.parse(value) as T
}

function mapAutomation(row: AutomationRow) {
  return {
    ...row,
    enabled: !!row.enabled,
    action: json<AutomationAction>(row.action_json),
    schedule: json<AutomationSchedule>(row.schedule_json),
    action_json: undefined,
    schedule_json: undefined,
  }
}

function partsAt(timestamp: number, timezone: string) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((item) => item.type === type)?.value || 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

function timezoneOffset(timestamp: number, timezone: string) {
  const p = partsAt(timestamp, timezone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - timestamp
}

function zonedTimestamp(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  let result = guess - timezoneOffset(guess, timezone)
  result = guess - timezoneOffset(result, timezone)
  return result
}

function plusLocalDays(input: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(input.year, input.month - 1, input.day + days))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

export function nextRunAt(schedule: AutomationSchedule, after = Date.now()): number | null {
  if (schedule.type === 'once') return schedule.at > after ? schedule.at : null
  const timezone = schedule.timezone || 'Asia/Shanghai'
  const local = partsAt(after, timezone)
  for (let offset = 0; offset < 8; offset++) {
    const date = plusLocalDays(local, offset)
    if (schedule.type === 'weekly') {
      const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
      if (!schedule.weekdays.includes(weekday)) continue
    }
    const candidate = zonedTimestamp(date.year, date.month, date.day, schedule.hour, schedule.minute, timezone)
    if (candidate > after) return candidate
  }
  return null
}

function validClock(value: unknown, max: number) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max
}

export function normalizeDefinition(input: Partial<AutomationDefinition>): AutomationDefinition {
  const instruction = String(input.instruction || '').trim()
  const title = String(input.title || instruction.slice(0, 30) || '自动化任务').trim()
  const rawSchedule = input.schedule as AutomationSchedule | undefined
  if (!rawSchedule || !['daily', 'weekly', 'once'].includes(rawSchedule.type)) throw new Error('没有识别到有效的执行时间')
  let schedule: AutomationSchedule
  if (rawSchedule.type === 'once') {
    const at = Number(rawSchedule.at)
    if (!Number.isFinite(at) || at <= Date.now()) throw new Error('单次任务的执行时间必须晚于现在')
    schedule = { type: 'once', at, timezone: rawSchedule.timezone || 'Asia/Shanghai' }
  } else {
    if (!validClock(rawSchedule.hour, 23) || !validClock(rawSchedule.minute, 59)) throw new Error('执行时间无效')
    if (rawSchedule.type === 'weekly') {
      const weekdays = [...new Set((rawSchedule.weekdays || []).map(Number))].filter((day) => day >= 0 && day <= 6)
      if (!weekdays.length) throw new Error('每周任务需要指定星期')
      schedule = { type: 'weekly', weekdays, hour: rawSchedule.hour, minute: rawSchedule.minute, timezone: rawSchedule.timezone || 'Asia/Shanghai' }
    } else {
      schedule = { type: 'daily', hour: rawSchedule.hour, minute: rawSchedule.minute, timezone: rawSchedule.timezone || 'Asia/Shanghai' }
    }
  }
  const rawAction = input.action as AutomationAction | undefined
  if (!rawAction || !['music_play', 'music_control', 'open_app', 'agent_instruction'].includes(rawAction.type)) throw new Error('没有识别到可执行的动作')
  return { title, instruction, schedule, action: { type: rawAction.type, args: rawAction.args || {} } }
}

const chineseWeekday: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

function clockFromText(text: string) {
  const match = text.match(/(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:\s*[:：点时]\s*(\d{1,2})?|\s*点半)/)
  if (!match) return null
  let hour = Number(match[2])
  const minute = text.slice(match.index, (match.index || 0) + match[0].length).includes('半') ? 30 : Number(match[3] || 0)
  if (['下午', '晚上'].includes(match[1]) && hour < 12) hour += 12
  if (match[1] === '中午' && hour < 11) hour += 12
  if (match[1] === '凌晨' && hour === 12) hour = 0
  return validClock(hour, 23) && validClock(minute, 59) ? { hour, minute } : null
}

export function parseAutomationFallback(instruction: string): AutomationDefinition {
  const text = instruction.trim()
  const clock = clockFromText(text)
  if (!clock) throw new Error('请在指令中写明执行时间，例如“每天早上 9 点”')
  let schedule: AutomationSchedule
  const week = text.match(/每(?:周|星期)([一二三四五六日天](?:[、,，和及][一二三四五六日天])*)/)
  if (week) {
    const weekdays = [...week[1]].filter((char) => chineseWeekday[char] !== undefined).map((char) => chineseWeekday[char])
    schedule = { type: 'weekly', weekdays: [...new Set(weekdays)], ...clock, timezone: 'Asia/Shanghai' }
  } else if (/每天|每日/.test(text)) {
    schedule = { type: 'daily', ...clock, timezone: 'Asia/Shanghai' }
  } else {
    const local = partsAt(Date.now(), 'Asia/Shanghai')
    const target = plusLocalDays(local, /明天/.test(text) ? 1 : 0)
    let at = zonedTimestamp(target.year, target.month, target.day, clock.hour, clock.minute, 'Asia/Shanghai')
    if (at <= Date.now() && !/今天/.test(text)) {
      const tomorrow = plusLocalDays(target, 1)
      at = zonedTimestamp(tomorrow.year, tomorrow.month, tomorrow.day, clock.hour, clock.minute, 'Asia/Shanghai')
    }
    schedule = { type: 'once', at, timezone: 'Asia/Shanghai' }
  }

  let action: AutomationAction
  if (/播放|放歌|音乐/.test(text)) {
    const query = text
      .replace(/^.*?(?:自动)?(?:播放|放)(?:一下)?/, '')
      .replace(/(?:的)?(?:歌曲|歌|音乐).*$/, '')
      .trim()
    action = { type: 'music_play', args: { query, shuffle: true } }
  } else if (/打开|启动/.test(text)) {
    const app = text.replace(/^.*?(?:打开|启动)/, '').replace(/(?:应用|APP).*$/i, '').trim()
    action = { type: 'open_app', args: { app } }
  } else {
    action = { type: 'agent_instruction', args: { instruction: text.replace(/^.*?(?:点|时)(?:半|\d{1,2}分?)?\s*/, '') || text } }
  }
  return normalizeDefinition({ title: text.slice(0, 30), instruction: text, schedule, action })
}

export function listAutomations(userId: string) {
  recoverStaleRuns(userId)
  const rows = ccsDb.prepare('SELECT * FROM automations WHERE created_by=? ORDER BY created_at DESC').all(userId) as AutomationRow[]
  const runsStmt = ccsDb.prepare('SELECT * FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC LIMIT 20')
  return rows.map((row) => ({ ...mapAutomation(row), runs: runsStmt.all(row.id) as RunRow[] }))
}

export function createAutomation(userId: string, input: Partial<AutomationDefinition>) {
  const value = normalizeDefinition(input)
  const now = Date.now()
  const id = randomUUID()
  ccsDb.prepare(`INSERT INTO automations(id,created_by,title,instruction,action_json,schedule_json,enabled,next_run_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,1,?,?,?)`).run(id, userId, value.title, value.instruction, JSON.stringify(value.action), JSON.stringify(value.schedule), nextRunAt(value.schedule, now - 1), now, now)
  return mapAutomation(ccsDb.prepare('SELECT * FROM automations WHERE id=?').get(id) as AutomationRow)
}

export function updateAutomation(userId: string, id: string, input: { enabled?: boolean; title?: string }) {
  const row = ccsDb.prepare('SELECT * FROM automations WHERE id=? AND created_by=?').get(id, userId) as AutomationRow | undefined
  if (!row) throw new Error('自动化任务不存在')
  const enabled = input.enabled === undefined ? !!row.enabled : !!input.enabled
  const schedule = json<AutomationSchedule>(row.schedule_json)
  ccsDb.prepare('UPDATE automations SET title=?,enabled=?,next_run_at=?,updated_at=? WHERE id=?').run(
    input.title === undefined ? row.title : String(input.title).trim() || row.title,
    enabled ? 1 : 0,
    enabled ? nextRunAt(schedule, Date.now() - 1) : null,
    Date.now(), id,
  )
  return mapAutomation(ccsDb.prepare('SELECT * FROM automations WHERE id=?').get(id) as AutomationRow)
}

export function deleteAutomation(userId: string, id: string) {
  const result = ccsDb.prepare('DELETE FROM automations WHERE id=? AND created_by=?').run(id, userId)
  if (!result.changes) throw new Error('自动化任务不存在')
}

const claimDueTx = ccsDb.transaction((userId: string, clientId: string) => {
  const now = Date.now()
  const row = ccsDb.prepare(`SELECT * FROM automations WHERE created_by=? AND enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?
    ORDER BY next_run_at LIMIT 1`).get(userId, now) as AutomationRow | undefined
  if (!row) return null
  const runId = randomUUID()
  const scheduledFor = row.next_run_at!
  ccsDb.prepare(`INSERT OR IGNORE INTO automation_runs(id,automation_id,scheduled_for,status,client_id,created_at,started_at)
    VALUES(?,?,?,'running',?,?,?)`).run(runId, row.id, scheduledFor, clientId, now, now)
  const schedule = json<AutomationSchedule>(row.schedule_json)
  ccsDb.prepare('UPDATE automations SET next_run_at=?,last_run_at=?,last_status=?,last_error=NULL,updated_at=? WHERE id=?')
    .run(nextRunAt(schedule, now), now, 'running', now, row.id)
  const run = ccsDb.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId) as RunRow | undefined
  return run ? { automation: mapAutomation(row), run } : null
})

function recoverStaleRuns(userId: string) {
  const cutoff = Date.now() - 10 * 60_000
  const stale = ccsDb.prepare(`SELECT r.id,r.automation_id FROM automation_runs r JOIN automations a ON a.id=r.automation_id
    WHERE a.created_by=? AND r.status='running' AND r.started_at<?`).all(userId, cutoff) as Array<{ id: string; automation_id: string }>
  if (!stale.length) return
  const now = Date.now()
  const recover = ccsDb.transaction(() => {
    const updateRun = ccsDb.prepare(`UPDATE automation_runs SET status='failed',error='桌面会话中断，任务未完成',completed_at=? WHERE id=? AND status='running'`)
    const updateAutomation = ccsDb.prepare(`UPDATE automations SET last_status='failed',last_error='桌面会话中断，任务未完成',updated_at=? WHERE id=? AND last_status='running'`)
    for (const item of stale) {
      updateRun.run(now, item.id)
      updateAutomation.run(now, item.automation_id)
    }
  })
  recover.immediate()
}

export function claimDueAutomation(userId: string, clientId: string) {
  recoverStaleRuns(userId)
  return claimDueTx.immediate(userId, clientId)
}

export function runAutomationNow(userId: string, id: string, clientId: string) {
  const row = ccsDb.prepare('SELECT * FROM automations WHERE id=? AND created_by=?').get(id, userId) as AutomationRow | undefined
  if (!row) throw new Error('自动化任务不存在')
  const now = Date.now()
  const run: RunRow = { id: randomUUID(), automation_id: id, scheduled_for: now, status: 'running', client_id: clientId, result: null, error: null, created_at: now, started_at: now, completed_at: null }
  ccsDb.prepare(`INSERT INTO automation_runs(id,automation_id,scheduled_for,status,client_id,created_at,started_at) VALUES(?,?,?,?,?,?,?)`)
    .run(run.id, id, now, 'running', clientId, now, now)
  ccsDb.prepare('UPDATE automations SET last_run_at=?,last_status=?,last_error=NULL,updated_at=? WHERE id=?').run(now, 'running', now, id)
  return { automation: mapAutomation(row), run }
}

export function completeAutomationRun(userId: string, runId: string, input: { status: 'success' | 'failed'; result?: string; error?: string }) {
  const row = ccsDb.prepare(`SELECT r.*,a.created_by FROM automation_runs r JOIN automations a ON a.id=r.automation_id WHERE r.id=? AND a.created_by=?`)
    .get(runId, userId) as (RunRow & { created_by: string }) | undefined
  if (!row) throw new Error('执行记录不存在')
  const now = Date.now()
  ccsDb.prepare('UPDATE automation_runs SET status=?,result=?,error=?,completed_at=? WHERE id=?')
    .run(input.status, input.result || null, input.error || null, now, runId)
  ccsDb.prepare('UPDATE automations SET last_status=?,last_error=?,updated_at=? WHERE id=?')
    .run(input.status, input.status === 'failed' ? input.error || '执行失败' : null, now, row.automation_id)
}
