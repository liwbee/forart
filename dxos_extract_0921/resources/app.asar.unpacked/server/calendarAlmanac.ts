import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDataDir } from './dataPaths.ts'

const SOURCE = 'https://uapis.cn/api/v1/misc/holiday-calendar'
const cacheDir = ensureDataDir('cache', 'calendar-almanac')
const inflight = new Map<number, Promise<CalendarYearResult>>()

export interface OnlineCalendarDay {
  date: string
  legal_holiday_name?: string
  legal_holiday_type?: 'rest' | 'workday_adjust' | string
  solar_festival?: string
  lunar_festival?: string
  solar_term?: string
  lunar_month_name?: string
  lunar_day_name?: string
}

interface CalendarCacheFile {
  version: 1
  source: string
  year: number
  fetchedAt: number
  fetchedDay: string
  days: OnlineCalendarDay[]
}

export interface CalendarYearResult extends CalendarCacheFile {
  cached: boolean
  stale: boolean
}

function shanghaiDateKey(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function cachePath(year: number) {
  return join(cacheDir, `${year}.json`)
}

function readCache(year: number): CalendarCacheFile | null {
  const path = cachePath(year)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CalendarCacheFile
    if (parsed.version !== 1 || parsed.year !== year || !Array.isArray(parsed.days) || !parsed.days.length) return null
    return parsed
  } catch {
    return null
  }
}

function saveCache(cache: CalendarCacheFile) {
  const path = cachePath(cache.year)
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(cache), 'utf8')
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
}

async function refreshYear(year: number): Promise<CalendarYearResult> {
  const cached = readCache(year)
  const today = shanghaiDateKey()
  if (cached?.fetchedDay === today) return { ...cached, cached: true, stale: false }

  try {
    const url = new URL(SOURCE)
    url.searchParams.set('year', String(year))
    url.searchParams.set('timezone', 'Asia/Shanghai')
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'DX-OS-Calendar/1.0' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`在线万年历返回 HTTP ${response.status}`)
    const body = await response.json() as { days?: OnlineCalendarDay[]; message?: string }
    const days = Array.isArray(body.days)
      ? body.days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day?.date || '')))
      : []
    if (days.length < 28) throw new Error(body.message || '在线万年历没有返回完整日期数据')
    const next: CalendarCacheFile = {
      version: 1,
      source: SOURCE,
      year,
      fetchedAt: Date.now(),
      fetchedDay: today,
      days,
    }
    saveCache(next)
    return { ...next, cached: false, stale: false }
  } catch (error) {
    if (cached) return { ...cached, cached: true, stale: true }
    throw error
  }
}

function loadYear(year: number) {
  const current = inflight.get(year)
  if (current) return current
  const task = refreshYear(year).finally(() => inflight.delete(year))
  inflight.set(year, task)
  return task
}

export async function onlineCalendarYears(years: number[]) {
  const normalized = [...new Set(years.map(Math.trunc))]
  if (!normalized.length || normalized.length > 3 || normalized.some((year) => year < 1900 || year > 2100)) {
    throw new Error('年份参数无效，每次最多查询 3 个 1900–2100 年之间的年份')
  }
  return Promise.all(normalized.map(loadYear))
}

