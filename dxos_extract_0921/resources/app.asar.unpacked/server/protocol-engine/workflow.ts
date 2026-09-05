import type { CompiledExecutionPlan, CompiledProtocolRequest, CompiledProtocolStep } from './compiler.ts'
import { defaultProtocolClock, defaultProtocolTransport, type ProtocolClock, type ProtocolTransport } from './transport.ts'

export type ProtocolExecutionEvent =
  | { type: 'submitted'; taskId?: string }
  | { type: 'progress'; status: string; progress?: number }
  | { type: 'completed'; outputs: ProtocolExecutionOutput[] }
  | { type: 'failed'; message: string; code?: string }

export type ProtocolExecutionOutput = {
  kind: 'image' | 'video' | 'audio' | 'text' | 'file'
  mime?: string
  url?: string
  data?: Uint8Array
  sourceUrl?: string
}

export type ProtocolExecutionResult = {
  taskId?: string
  outputs: ProtocolExecutionOutput[]
  captures: Record<string, unknown>
  raw: unknown
}

export type ProtocolWorkflowCheckpoint = {
  phase: 'poll'
  captures: Record<string, unknown>
  attempt: number
  intervalMs: number
  nextPollAt: number
}

export type ProtocolWorkflowAdvance =
  | { status: 'pending'; checkpoint: ProtocolWorkflowCheckpoint; taskId?: string }
  | { status: 'completed'; result: ProtocolExecutionResult }

function selectorParts(selector: string) {
  const parts: Array<string | number | '*'> = []
  for (const match of selector.slice(1).matchAll(/\.([A-Za-z0-9_-]+)|\[(\d+|\*)]/g)) {
    parts.push(match[1] || (match[2] === '*' ? '*' : Number(match[2])))
  }
  return parts
}

function select(value: unknown, selector: string): unknown {
  let values: unknown[] = [value]
  let wildcard = false
  for (const part of selectorParts(selector)) {
    if (part === '*') {
      wildcard = true
      values = values.flatMap((item) => Array.isArray(item) ? item : [])
    } else if (typeof part === 'number') {
      values = values.flatMap((item) => Array.isArray(item) && item.length > part ? [item[part]] : [])
    } else {
      values = values.flatMap((item) => item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, part) ? [(item as Record<string, unknown>)[part]] : [])
    }
  }
  return wildcard ? values : values[0]
}

function selectFirst(value: unknown, selector: unknown) {
  const selectors = typeof selector === 'string' ? [selector] : Array.isArray(selector) ? selector.map(String) : []
  for (const candidate of selectors) {
    const selected = select(value, candidate)
    if (selected !== undefined && selected !== null && selected !== '') return selected
  }
  return undefined
}

function capture(step: CompiledProtocolStep, payload: unknown, captures: Record<string, unknown>) {
  for (const [key, selector] of Object.entries(step.capture || {})) {
    const value = selectFirst(payload, selector)
    if (value !== undefined) captures[key] = value
  }
}

function captureToken(key: string) {
  return [`<capture:${key}>`, encodeURIComponent(`<capture:${key}>`).replace(/%3A/gi, ':')]
}

function substituteString(value: string, captures: Record<string, unknown>) {
  let output = value
  for (const [key, captured] of Object.entries(captures)) {
    for (const token of captureToken(key)) output = output.split(token).join(encodeURIComponent(String(captured)))
  }
  return output
}

function substitute(value: unknown, captures: Record<string, unknown>): unknown {
  if (typeof value === 'string') return substituteString(value, captures)
  if (Array.isArray(value)) return value.map((item) => substitute(item, captures))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, substitute(item, captures)]))
}

function runtimeRequest(request: CompiledProtocolRequest, captures: Record<string, unknown>): CompiledProtocolRequest {
  const resolved = substitute(request, captures) as CompiledProtocolRequest
  if (/%3[cC]capture:|<capture:/i.test(JSON.stringify(resolved))) throw new Error('协议请求仍包含未解析的 capture，提交响应可能缺少任务 ID。')
  return resolved
}

async function executeRequest(request: CompiledProtocolRequest, transport: ProtocolTransport, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('协议任务已取消')
  const headers = { ...request.headers }
  let body: BodyInit | undefined
  if (request.body !== undefined && !['GET', 'HEAD'].includes(request.method)) {
    if (request.requestMode === 'json') body = JSON.stringify(request.body)
    else if (typeof request.body === 'string' || request.body instanceof Blob || request.body instanceof FormData || request.body instanceof URLSearchParams) body = request.body
    else body = JSON.stringify(request.body)
  }
  const response = await transport.fetch(request.url, { method: request.method, headers, body, signal })
  const mode = request.responseMode || 'json'
  if (mode === 'binary') {
    const data = new Uint8Array(await response.arrayBuffer())
    if (!response.ok) throw new Error(`协议请求失败 HTTP ${response.status}`)
    return { payload: data as unknown, response }
  }
  const text = await response.text()
  let payload: unknown = text
  if (mode === 'json') {
    try { payload = JSON.parse(text) } catch { throw new Error(`协议期望 JSON，但收到不可解析响应：${text.slice(0, 160)}`) }
  }
  if (!response.ok) throw new Error(`协议请求失败 HTTP ${response.status}：${typeof payload === 'string' ? payload.slice(0, 300) : JSON.stringify(payload).slice(0, 300)}`)
  return { payload, response }
}

function normalizedStatus(value: unknown) { return String(value || '').trim().toLowerCase() }

function checkpointCaptures(captures: Record<string, unknown>) {
  const safe: Record<string, unknown> = {}
  for (const key of ['taskId', 'status', 'progress', 'errorCode', 'errorMessage']) {
    const value = captures[key]
    if (value !== undefined && value !== null && typeof value !== 'object') safe[key] = value
  }
  return safe
}

function outputFromCaptures(plan: CompiledExecutionPlan, step: CompiledProtocolStep, captures: Record<string, unknown>, payload: unknown): ProtocolExecutionOutput[] {
  const result = step.result || plan.steps.find((item) => item.result)?.result
  if (!result) return []
  const values = Array.isArray(captures.resultUrls)
    ? captures.resultUrls
    : captures.resultUrl ? [captures.resultUrl] : []
  if (result.source === 'resultUrl') return values.map((url) => ({ kind: result.kind, mime: result.mime, url: String(url), sourceUrl: String(url) }))
  if (result.source === 'response' && payload !== undefined) return [{ kind: result.kind, mime: result.mime, ...(typeof payload === 'string' ? { url: payload } : {}) }]
  return []
}

async function completedResult(plan: CompiledExecutionPlan, step: CompiledProtocolStep, captures: Record<string, unknown>, raw: unknown, transport: ProtocolTransport, signal?: AbortSignal) {
  let payload = raw
  let outputs = outputFromCaptures(plan, step, captures, payload)
  const download = plan.steps.find((item) => item.id === 'download')
  const submit = plan.steps.find((item) => item.id === 'submit')!
  const resultSpec = download?.result || submit.result
  if (download && resultSpec?.source === 'binary') {
    const downloaded = await executeRequest(runtimeRequest(download.request, captures), transport, signal)
    payload = downloaded.payload
    if (!(downloaded.payload instanceof Uint8Array)) throw new Error('下载 operation 没有返回二进制数据')
    outputs = [{ kind: resultSpec.kind, mime: resultSpec.mime || downloaded.response.headers.get('content-type') || undefined, data: downloaded.payload }]
  }
  if (!outputs.length) throw new Error('协议任务已完成，但没有标准化输出')
  return { taskId: captures.taskId ? String(captures.taskId) : undefined, outputs, captures, raw: payload } satisfies ProtocolExecutionResult
}

export async function startProtocolPlan(args: {
  plan: CompiledExecutionPlan
  transport?: ProtocolTransport
  signal?: AbortSignal
  now?: number
  onEvent?: (event: ProtocolExecutionEvent) => void
}): Promise<ProtocolWorkflowAdvance> {
  const transport = args.transport || defaultProtocolTransport
  const captures: Record<string, unknown> = {}
  const submit = args.plan.steps.find((step) => step.id === 'submit')
  if (!submit) throw new Error('协议计划缺少 submit step')
  const submitted = await executeRequest(runtimeRequest(submit.request, captures), transport, args.signal)
  capture(submit, submitted.payload, captures)
  args.onEvent?.({ type: 'submitted', ...(captures.taskId ? { taskId: String(captures.taskId) } : {}) })
  const immediate = outputFromCaptures(args.plan, submit, captures, submitted.payload)
  const poll = args.plan.steps.find((step) => step.id === 'poll')
  if (immediate.length || !poll?.repeat) {
    const result = await completedResult(args.plan, submit, captures, submitted.payload, transport, args.signal)
    args.onEvent?.({ type: 'completed', outputs: result.outputs })
    return { status: 'completed', result }
  }
  // Validate required submit captures before persisting a pending task. This
  // turns malformed/HTML submit responses into an immediate failure instead
  // of storing a task that can never build its poll URL.
  runtimeRequest(poll.request, captures)
  const intervalMs = poll.repeat.intervalMs
  return {
    status: 'pending',
    taskId: captures.taskId ? String(captures.taskId) : undefined,
    checkpoint: { phase: 'poll', captures: checkpointCaptures(captures), attempt: 0, intervalMs, nextPollAt: (args.now ?? Date.now()) + intervalMs },
  }
}

export async function resumeProtocolPlan(args: {
  plan: CompiledExecutionPlan
  checkpoint: ProtocolWorkflowCheckpoint
  transport?: ProtocolTransport
  signal?: AbortSignal
  now?: number
  onEvent?: (event: ProtocolExecutionEvent) => void
}): Promise<ProtocolWorkflowAdvance> {
  const transport = args.transport || defaultProtocolTransport
  const poll = args.plan.steps.find((step) => step.id === 'poll')
  if (!poll?.repeat) throw new Error('协议计划没有可恢复的 poll step')
  const now = args.now ?? Date.now()
  if (now < args.checkpoint.nextPollAt) return { status: 'pending', taskId: String(args.checkpoint.captures.taskId || '') || undefined, checkpoint: args.checkpoint }
  const maxAttempts = poll.repeat.maxAttempts || 1000
  if (args.checkpoint.attempt >= maxAttempts) throw new Error(`协议任务轮询超过最大次数 ${maxAttempts}`)
  const captures = { ...args.checkpoint.captures }
  const response = await executeRequest(runtimeRequest(poll.request, captures), transport, args.signal)
  capture(poll, response.payload, captures)
  const status = normalizedStatus(captures.status)
  const progress = captures.progress == null ? undefined : Number(captures.progress)
  args.onEvent?.({ type: 'progress', status, ...(Number.isFinite(progress) ? { progress } : {}) })
  if (poll.repeat.status.failure.map(normalizedStatus).includes(status)) throw new Error(String(captures.errorMessage || captures.errorCode || `协议任务失败：${status}`))
  if (poll.repeat.status.success.map(normalizedStatus).includes(status)) {
    const result = await completedResult(args.plan, poll, captures, response.payload, transport, args.signal)
    args.onEvent?.({ type: 'completed', outputs: result.outputs })
    return { status: 'completed', result }
  }
  if (!poll.repeat.status.pending.map(normalizedStatus).includes(status)) throw new Error(`协议返回未知任务状态「${status || 'empty'}」`)
  const intervalMs = Math.min(Math.round(args.checkpoint.intervalMs * (poll.repeat.backoff || 1)), poll.repeat.maxIntervalMs || args.checkpoint.intervalMs)
  return {
    status: 'pending',
    taskId: captures.taskId ? String(captures.taskId) : undefined,
    checkpoint: { phase: 'poll', captures: checkpointCaptures(captures), attempt: args.checkpoint.attempt + 1, intervalMs, nextPollAt: now + intervalMs },
  }
}

export async function executeProtocolPlan(args: {
  plan: CompiledExecutionPlan
  transport?: ProtocolTransport
  clock?: ProtocolClock
  signal?: AbortSignal
  onEvent?: (event: ProtocolExecutionEvent) => void
}): Promise<ProtocolExecutionResult> {
  const transport = args.transport || defaultProtocolTransport
  const clock = args.clock || defaultProtocolClock
  try {
    let advance = await startProtocolPlan({ plan: args.plan, transport, signal: args.signal, now: clock.now(), onEvent: args.onEvent })
    while (advance.status === 'pending') {
      await clock.sleep(Math.max(0, advance.checkpoint.nextPollAt - clock.now()))
      advance = await resumeProtocolPlan({ plan: args.plan, checkpoint: advance.checkpoint, transport, signal: args.signal, now: clock.now(), onEvent: args.onEvent })
    }
    return advance.result
  } catch (error) {
    const message = String((error as Error).message || error)
    args.onEvent?.({ type: 'failed', message })
    throw error
  }
}
