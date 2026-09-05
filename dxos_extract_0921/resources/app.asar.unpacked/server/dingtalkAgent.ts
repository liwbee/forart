// ══════════════════════════════════════════════════════════════════════
// 钉钉 Stream Agent：本机后端主动连接钉钉 Stream 网关，接收机器人文本消息，
// 调用 CCS Agent 能力后用 sessionWebhook 原路回复。
// ══════════════════════════════════════════════════════════════════════
import type { DWClient, DWClientDownStream, RobotTextMessage } from 'dingtalk-stream'
import { callChat, type ResolvedProvider } from './protocols.ts'
import { firstUsableProvider } from './store.ts'
import { getWeather } from './weather.ts'
import { callDirect as mcpCallDirect } from './mcp.ts'
import { getAgentEnv } from './dingtalk.ts'

const DING_API = 'https://api.dingtalk.com'

type Status = {
  enabled: boolean
  connected: boolean
  running: boolean
  error: string
  lastMessageAt?: number
  lastReplyAt?: number
  lastUser?: string
  lastText?: string
  contextCount?: number
}
type ChatMsg = { role: 'user' | 'assistant'; content: string }

let client: DWClient | null = null
let starting = false
let dingTalkStreamRuntime: Promise<typeof import('dingtalk-stream')> | null = null

function loadDingTalkStream() {
  if (!dingTalkStreamRuntime) {
    dingTalkStreamRuntime = import('dingtalk-stream').catch((error) => {
      dingTalkStreamRuntime = null
      throw error
    })
  }
  return dingTalkStreamRuntime
}
const seen = new Map<string, number>()
const contexts = new Map<string, ChatMsg[]>()
const status: Status = { enabled: true, connected: false, running: false, error: '' }
let tokenCache: { token: string; expireAt: number } | null = null

function loadDingTalkEnv() {
  const env = process.env
  const config = getAgentEnv()
  const clientId = String(env.DINGTALK_Client_ID || env.DINGTALK_CLIENT_ID || config.clientId || '').trim()
  const clientSecret = String(env.DINGTALK_Client_Secret || env.DINGTALK_CLIENT_SECRET || config.clientSecret || '').trim()
  const robotCode = String(env.ROBOT_CODE || config.robotCode || '').trim()
  return { clientId, clientSecret, robotCode, serverId: 'dingtalk-mcp-96cf' }
}

function trimSeen() {
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const [k, ts] of seen) if (ts < cutoff) seen.delete(k)
}

function cityFromText(text: string) {
  const m = text.match(/(?:查|看|问)?([\u4e00-\u9fa5A-Za-z]{2,20})(?:今天|明天|现在|未来)?的?天气/)
  const city = m?.[1]?.replace(/今天|明天|现在|未来|一下|怎么样|如何/g, '').trim()
  return city && city !== '天气' ? city : '成都'
}

function weatherSummary(w: Awaited<ReturnType<typeof getWeather>>) {
  const today = w.daily[0]
  const line2 = today ? `今天 ${today.icon}${today.text}，${today.min}~${today.max}℃，降水概率 ${today.pop}%。` : ''
  return `${w.city}${w.country ? `（${w.country}）` : ''}现在 ${w.current.icon}${w.current.text}，${w.current.temp}℃，体感 ${w.current.feels}℃，湿度 ${w.current.humidity}%，风速 ${w.current.wind} km/h。${line2 ? '\n' + line2 : ''}`
}

function contextKey(msg: RobotTextMessage) {
  return `${msg.conversationId || 'single'}:${msg.senderStaffId || msg.senderId || 'unknown'}`
}

function getContext(key: string) {
  return contexts.get(key) || []
}

function pushContext(key: string, userText: string, assistantText: string) {
  const next = [...getContext(key), { role: 'user' as const, content: userText }, { role: 'assistant' as const, content: assistantText }].slice(-12)
  contexts.set(key, next)
  status.contextCount = contexts.size
}

function clearContext(key: string) {
  contexts.delete(key)
  status.contextCount = contexts.size
}

function isFollowUp(text: string) {
  return /^(那|那么|再|继续|还有|明天|后天|这个|它|他|她|他们|呢|然后|换成|改成)/.test(text.trim()) || text.trim().length <= 8
}

function tryJson<T = Record<string, unknown>>(text: string): T | null {
  try { return JSON.parse(text) as T } catch { return null }
}

function deepFindString(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return ''
  const rec = obj as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  for (const v of Object.values(rec)) {
    const found = deepFindString(v, keys)
    if (found) return found
  }
  return ''
}

async function getUnionId(userId: string) {
  const { serverId } = loadDingTalkEnv()
  const raw = await mcpCallDirect(serverId, 'getUserDetailByUserId', { userid: userId, language: 'zh_CN' })
  const json = tryJson(raw)
  return deepFindString(json, ['unionId', 'unionid', 'union_id'])
}

async function dingToken() {
  const { clientId, clientSecret } = loadDingTalkEnv()
  if (!clientId || !clientSecret) throw new Error('缺少 DINGTALK_Client_ID / DINGTALK_Client_Secret')
  if (tokenCache && Date.now() < tokenCache.expireAt) return tokenCache.token
  const r = await fetch(`https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(clientId)}&appsecret=${encodeURIComponent(clientSecret)}`)
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; errmsg?: string }
  if (!j.access_token) throw new Error(`获取钉钉 access_token 失败：${j.errmsg || JSON.stringify(j)}`)
  tokenCache = { token: j.access_token, expireAt: Date.now() + Math.max(60, Number(j.expires_in || 7200) - 300) * 1000 }
  return tokenCache.token
}

async function dingOpenApi(path: string, init: RequestInit = {}) {
  const token = await dingToken()
  const r = await fetch(DING_API + path, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': token,
      ...(init.headers || {}),
    },
  })
  const text = await r.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* keep raw */ }
  if (!r.ok) throw new Error(`钉钉 OpenAPI HTTP ${r.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  const rec = data as Record<string, unknown>
  const code = rec?.code
  const errcode = rec?.errcode
  if ((code !== undefined && String(code) !== '0') || (errcode !== undefined && Number(errcode) !== 0)) {
    throw new Error(`钉钉 OpenAPI 返回错误：${JSON.stringify(data)}`)
  }
  return data
}

function friendlyMeetingRoomError(err: unknown, action = '查询会议室') {
  const text = String(err instanceof Error ? err.message : err || '')
  if (/VideoConference\.Conference\.Read/.test(text)) {
    return `${action}还差一个钉钉权限：VideoConference.Conference.Read。请在钉钉开放平台把这个权限开通后再试。`
  }
  if (/AccessDenied|Forbidden/i.test(text)) {
    return `${action}被钉钉拒绝了，像是权限还没完全开通。原始信息：${text}`
  }
  return text
}

function localIso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+08:00`
}

function parseCalendarRange(text: string) {
  const day = new Date()
  if (/后天/.test(text)) day.setDate(day.getDate() + 2)
  else if (/明天/.test(text)) day.setDate(day.getDate() + 1)
  const span = text.match(/(\d{1,2})(?::(\d{1,2}))?\s*(?:点|:)?\s*(?:到|至|-)\s*(\d{1,2})(?::(\d{1,2}))?\s*(?:点)?/)
  if (span) {
    const start = new Date(day)
    start.setHours(Number(span[1]), Number(span[2] || 0), 0, 0)
    const end = new Date(day)
    end.setHours(Number(span[3]), Number(span[4] || 0), 0, 0)
    return { start, end }
  }
  const one = text.match(/(\d{1,2})(?::(\d{1,2}))?\s*点/)
  if (one) {
    const start = new Date(day)
    start.setHours(Number(one[1]), Number(one[2] || 0), 0, 0)
    const end = new Date(start)
    end.setHours(end.getHours() + 1)
    return { start, end }
  }
  const start = new Date(day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(day)
  end.setHours(23, 59, 59, 0)
  return { start, end }
}

function isoUtc(d: Date) {
  return d.toISOString()
}

function extractRoomName(text: string) {
  const after = text.match(/会议室\s*([\u4e00-\u9fa5A-Za-z0-9_-]{1,20})/)
  if (after?.[1] && !/闲忙|空闲|占用|可用/.test(after[1])) return after[1]
  const before = text.match(/([\u4e00-\u9fa5A-Za-z0-9_-]{1,20})会议室/)
  return before?.[1] || ''
}

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) if (typeof obj[k] === 'string' && String(obj[k]).trim()) return String(obj[k]).trim()
  return ''
}

function collectRooms(obj: unknown): Record<string, unknown>[] {
  if (Array.isArray(obj)) return obj.flatMap(collectRooms)
  if (!obj || typeof obj !== 'object') return []
  const rec = obj as Record<string, unknown>
  const arrays = ['result', 'list', 'data', 'items', 'rooms', 'meetingRooms'].flatMap((k) => collectRooms(rec[k]))
  const id = pickString(rec, ['roomId', 'meetingRoomId', 'id'])
  const name = pickString(rec, ['roomName', 'name', 'title'])
  return id || name ? [rec, ...arrays] : arrays
}

async function listMeetingRooms() {
  const attempts = [
    () => dingOpenApi('/v1.0/rooms/meetingRoomLists?maxResults=100'),
    () => dingOpenApi('/v1.0/rooms/meetingRoomLists?pageSize=100&pageNumber=1'),
  ]
  const errors: string[] = []
  for (const fn of attempts) {
    try {
      const data = await fn()
      const rooms = collectRooms(data)
      if (rooms.length) return rooms
      errors.push('接口成功但没有解析到会议室列表：' + JSON.stringify(data).slice(0, 500))
    } catch (e) {
      errors.push(friendlyMeetingRoomError(e, '获取会议室列表'))
    }
  }
  throw new Error(errors.join('\n'))
}

async function resolveMeetingRoom(roomName: string) {
  const rooms = await listMeetingRooms()
  if (!roomName) return { rooms }
  const hit = rooms.find((r) => JSON.stringify(r).includes(roomName))
  if (!hit) return { rooms, error: `没在会议室列表里找到「${roomName}」。可用会议室示例：${rooms.slice(0, 8).map((r) => pickString(r, ['roomName', 'name', 'title']) || pickString(r, ['roomId', 'meetingRoomId', 'id'])).filter(Boolean).join('、')}` }
  const roomId = pickString(hit, ['roomId', 'meetingRoomId', 'id'])
  const name = pickString(hit, ['roomName', 'name', 'title']) || roomName
  if (!roomId) return { rooms, error: `找到了「${name}」，但没有解析到 roomId：${JSON.stringify(hit).slice(0, 400)}` }
  return { rooms, room: hit, roomId, name }
}

function collectSchedules(obj: unknown): Record<string, unknown>[] {
  if (Array.isArray(obj)) return obj.flatMap(collectSchedules)
  if (!obj || typeof obj !== 'object') return []
  const rec = obj as Record<string, unknown>
  const arrays = ['result', 'list', 'data', 'items', 'schedules', 'busyTimes', 'scheduleItems'].flatMap((k) => collectSchedules(rec[k]))
  const looksBusy = rec.start || rec.end || rec.startTime || rec.endTime || rec.eventId || rec.summary
  return looksBusy ? [rec, ...arrays] : arrays
}

function scheduleLine(s: Record<string, unknown>) {
  const title = String(s.summary || s.title || s.eventName || '占用')
  const start = String(s.startTime || s.start || '')
  const end = String(s.endTime || s.end || '')
  return `- ${title}${start ? `｜${start.slice(11, 16)}-${end.slice(11, 16)}` : ''}`
}

async function meetingRoomBusyAnswer(text: string, senderUserId: string) {
  if (!senderUserId) return '我需要知道你的钉钉 userId 才能查询会议室；当前消息里没有拿到发送人身份。'
  const unionId = await getUnionId(senderUserId)
  if (!unionId) return '我查到了发送人，但没有拿到 unionId，暂时无法查询会议室。'
  const roomName = extractRoomName(text)
  let resolved
  try {
    resolved = await resolveMeetingRoom(roomName)
  } catch (e) {
    return friendlyMeetingRoomError(e, '查询会议室状态')
  }
  if (resolved.error) return resolved.error
  if (!resolved.roomId) {
    return `我可以查会议室闲忙。请告诉我会议室名称和时间，例如：\n“明天 10 点到 11 点 查 A会议室是否空闲”。\n可用会议室示例：${resolved.rooms?.slice(0, 8).map((r) => pickString(r, ['roomName', 'name', 'title'])).filter(Boolean).join('、') || '暂未解析到名称'}`
  }
  const range = parseCalendarRange(text)
  let data
  try {
    data = await dingOpenApi(`/v1.0/calendar/users/${encodeURIComponent(unionId)}/meetingRooms/schedules/query`, {
      method: 'POST',
      body: JSON.stringify({ meetingRoomIds: [resolved.roomId], startTime: isoUtc(range.start), endTime: isoUtc(range.end) }),
    })
  } catch (e) {
    return friendlyMeetingRoomError(e, '查询会议室状态')
  }
  const busy = collectSchedules(data)
  if (!busy.length) return `「${resolved.name}」在 ${localIso(range.start).slice(0, 16)} 到 ${localIso(range.end).slice(11, 16)} 看起来是空闲的。`
  return `「${resolved.name}」这段时间已有占用：\n${busy.slice(0, 8).map(scheduleLine).join('\n')}`
}

async function addMeetingRoomAnswer(text: string, senderUserId: string) {
  if (!senderUserId) return '我需要知道你的钉钉 userId 才能添加会议室；当前消息里没有拿到发送人身份。'
  const eventId = text.match(/(?:eventId|日程ID|日程id)[:：\s]*([A-Za-z0-9_\-=]+)/)?.[1]
  if (!eventId) return '可以添加会议室，但官方接口需要一个已有日程 ID。请这样发：\n“给日程ID xxx 添加 A会议室”。'
  const roomName = extractRoomName(text)
  if (!roomName) return '请告诉我要添加哪个会议室，例如：“给日程ID xxx 添加 A会议室”。'
  const unionId = await getUnionId(senderUserId)
  if (!unionId) return '我查到了发送人，但没有拿到 unionId，暂时无法添加会议室。'
  let resolved
  try {
    resolved = await resolveMeetingRoom(roomName)
  } catch (e) {
    return friendlyMeetingRoomError(e, '添加会议室')
  }
  if (resolved.error) return resolved.error
  if (!resolved.roomId) return '没有解析到会议室 roomId，暂时不能添加。'
  let data
  try {
    data = await dingOpenApi(`/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars/primary/events/${encodeURIComponent(eventId)}/meetingRooms`, {
      method: 'POST',
      body: JSON.stringify({ meetingRoomIds: [resolved.roomId] }),
    })
  } catch (e) {
    return friendlyMeetingRoomError(e, '添加会议室')
  }
  return `已尝试把「${resolved.name}」添加到日程 ${eventId}。钉钉返回：${JSON.stringify(data).slice(0, 800)}`
}

function collectEvents(obj: unknown): Record<string, unknown>[] {
  if (Array.isArray(obj)) return obj.flatMap(collectEvents)
  if (!obj || typeof obj !== 'object') return []
  const rec = obj as Record<string, unknown>
  const arrays = ['items', 'events', 'data', 'list', 'result'].flatMap((k) => collectEvents(rec[k]))
  const looksLikeEvent = rec.summary || rec.start || rec.end || rec.location
  return looksLikeEvent ? [rec, ...arrays] : arrays
}

function eventLine(e: Record<string, unknown>) {
  const title = String(e.summary || e.title || '未命名日程')
  const loc = typeof e.location === 'object' && e.location ? String((e.location as Record<string, unknown>).displayName || '') : String(e.location || '')
  const start = typeof e.start === 'object' && e.start ? String((e.start as Record<string, unknown>).dateTime || (e.start as Record<string, unknown>).date || '') : ''
  const end = typeof e.end === 'object' && e.end ? String((e.end as Record<string, unknown>).dateTime || (e.end as Record<string, unknown>).date || '') : ''
  return `- ${title}${loc ? `｜地点：${loc}` : ''}${start ? `｜${start.slice(11, 16)}-${end.slice(11, 16)}` : ''}`
}

async function calendarBusyAnswer(text: string, senderUserId: string) {
  if (!senderUserId) return '我需要知道你的钉钉 userId 才能读取日程；当前消息里没有拿到发送人身份。'
  const unionId = await getUnionId(senderUserId)
  if (!unionId) return '我查到了发送人，但没有拿到 unionId，暂时无法读取日程视图。'
  const { serverId } = loadDingTalkEnv()
  const range = parseCalendarRange(text)
  const raw = await mcpCallDirect(serverId, 'getCalendarView', {
    unionId,
    calendarId: 'primary',
    timeMin: localIso(range.start),
    timeMax: localIso(range.end),
    maxResults: 50,
    maxAttendees: 20,
  })
  const json = tryJson(raw)
  const room = extractRoomName(text)
  let events = collectEvents(json)
  if (room) events = events.filter((e) => JSON.stringify(e).includes(room))
  if (!events.length) {
    return `${room ? `我在你的日程里没看到「${room}会议室」` : '我在你的日程里没看到会议室相关'}的占用记录。\n注意：这只是读取“你的日程视图”，不是全公司会议室资源的全局闲忙。`
  }
  return `${room ? `你日程里「${room}会议室」相关记录：` : '你日程里会议室/地点相关记录：'}\n${events.slice(0, 8).map(eventLine).join('\n')}\n\n注意：这是从你的日程视图读取，不等同于全局会议室资源闲忙。`
}

async function roomAnswer(text: string, senderUserId: string) {
  if (/添加|加入|预约|预定|订/.test(text)) return await addMeetingRoomAnswer(text, senderUserId)
  if (/闲忙|空闲|占用|可用|有没有空|是否有空/.test(text)) {
    return await meetingRoomBusyAnswer(text, senderUserId)
  }
  return '我可以查询会议室闲忙，也可以给已有日程添加会议室。你可以说：“明天 10 点到 11 点查 A会议室是否空闲”，或“给日程ID xxx 添加 A会议室”。'
}

async function answerText(text: string, ctx: ChatMsg[], senderUserId: string) {
  if (/清空上下文|忘记上文|重置对话|重新开始/.test(text)) return '__CLEAR_CONTEXT__'
  if (/会议室/.test(text)) return roomAnswer(text, senderUserId)

  const withContext = isFollowUp(text) && ctx.length ? `${ctx.slice(-4).map((m) => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`).join('\n')}\n用户继续问：${text}` : text
  const recent = ctx.slice(-4).map((m) => m.content).join('\n')
  const weatherIntent = /天气|气温|下雨|降雨|温度/.test(text) || (isFollowUp(text) && /天气|气温|下雨|降雨|温度|℃/.test(recent))
  if (weatherIntent) {
    const w = await getWeather(cityFromText(withContext))
    return weatherSummary(w)
  }
  const stored = firstUsableProvider()
  if (!stored) return '我这边还没有可用的模型站点，请先在 DX OS 的「API 设置」里配置模型。'
  const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }
  const model = stored.models?.find((m) => (m.caps || []).includes('llm'))?.model || stored.models?.[0]?.model || ''
  if (!model) return '模型站点还没有配置模型。'
  const r = await callChat(
    provider,
    model,
    {
      messages: [...ctx, { role: 'user', content: text }],
      system:
        '你是 DX OS 在钉钉里的简洁中文助理。回答要短、直接、适合 IM 聊天。你能结合本会话上文连续回答。' +
        '不要执行敏感外部操作；涉及发消息、创建日程、删除/修改数据时先要求用户确认。',
    },
    {},
    120000,
  )
  return r.text || '我想了一下，但没有生成有效回复。'
}

async function replyBySessionWebhook(webhook: string, text: string) {
  const clipped = text.length > 3500 ? text.slice(0, 3500) + '\n…（内容较长，已截断）' : text
  const resp = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: clipped } }),
  })
  const raw = (await resp.json().catch(() => ({}))) as { errcode?: number; errmsg?: string }
  if (raw.errcode && raw.errcode !== 0) throw new Error(`钉钉回复失败 ${raw.errcode}: ${raw.errmsg || '未知'}`)
}

async function handleRobotMessage(msg: RobotTextMessage) {
  const { robotCode } = loadDingTalkEnv()
  if (robotCode && msg.robotCode && msg.robotCode !== robotCode) return
  if (seen.has(msg.msgId)) return
  trimSeen()
  seen.set(msg.msgId, Date.now())

  const text = String(msg.text?.content || '').trim()
  if (!text) return
  status.lastMessageAt = Date.now()
  status.lastUser = msg.senderNick || msg.senderStaffId || msg.senderId
  status.lastText = text
  const key = contextKey(msg)
  try {
    let answer = await answerText(text, getContext(key), msg.senderStaffId || '')
    if (answer === '__CLEAR_CONTEXT__') {
      clearContext(key)
      answer = '好，我已经清空这段钉钉对话的上下文。'
    } else {
      pushContext(key, text, answer)
    }
    await replyBySessionWebhook(msg.sessionWebhook, answer)
    status.lastReplyAt = Date.now()
    status.error = ''
  } catch (e) {
    status.error = String((e as Error).message || e)
    try { await replyBySessionWebhook(msg.sessionWebhook, '我收到消息了，但处理时出错：' + status.error) } catch { /* ignore */ }
  }
}

function onRobotCallback(downstream: DWClientDownStream) {
  try {
    const data = JSON.parse(downstream.data) as RobotTextMessage
    if (data.msgtype === 'text') void handleRobotMessage(data)
  } catch (e) {
    status.error = String((e as Error).message || e)
  }
}

export async function startDingTalkAgentStream() {
  if (starting || client) return getDingTalkAgentStatus()
  const { clientId, clientSecret } = loadDingTalkEnv()
  status.enabled = true
  if (!clientId || !clientSecret) {
    status.error = '缺少 DINGTALK_Client_ID / DINGTALK_Client_Secret，无法启动 Stream Agent。'
    return getDingTalkAgentStatus()
  }
  starting = true
  try {
    const { DWClient, TOPIC_ROBOT } = await loadDingTalkStream()
    client = new DWClient({ clientId, clientSecret, keepAlive: true, ua: 'CCS-OS-DingTalk-Agent/1.0' })
    client.registerCallbackListener(TOPIC_ROBOT, onRobotCallback)
    await client.connect()
    status.running = true
    status.connected = true
    status.error = ''
  } catch (e) {
    status.connected = false
    status.running = false
    status.error = String((e as Error).message || e)
    client = null
  } finally {
    starting = false
  }
  return getDingTalkAgentStatus()
}

export function stopDingTalkAgentStream() {
  client?.disconnect()
  client = null
  status.running = false
  status.connected = false
  status.enabled = false
  return getDingTalkAgentStatus()
}

export function getDingTalkAgentStatus() {
  return { ...status, connected: !!client?.connected, running: !!client }
}

export function clearDingTalkAgentContexts() {
  contexts.clear()
  status.contextCount = 0
  return getDingTalkAgentStatus()
}

/** 使用钉钉机器人的同一套提示词和模型路由进行本地 AI 调用测试。 */
export async function testDingTalkAgentAi(prompt: string) {
  const answer = await answerText(String(prompt || '请回复：钉钉 AI 调用正常。').trim(), [], '')
  return { answer }
}
