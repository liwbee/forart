import type { CapabilityIntent } from '../capabilityTypes.ts'
import { validateProtocolV2 } from './validator.ts'
import { isModelProtocolV2, isProviderProtocolV2 } from './validator.ts'
import type { ModelProtocolV2, ProtocolV2Expression, ProtocolV2Operation, ProtocolV2Workflow, ProviderProtocolV2 } from './types.ts'

export type StandardProtocolAsset = {
  kind: 'image' | 'video' | 'audio' | 'file'
  url?: string
  dataUrl?: string
  name?: string
  mime?: string
  role?: string
}

export type StandardProtocolTask = {
  requestId: string
  model: string
  intent: CapabilityIntent
  prompt?: string
  params: Record<string, unknown>
  inputs: {
    images: StandardProtocolAsset[]
    videos: StandardProtocolAsset[]
    audios: StandardProtocolAsset[]
    files: StandardProtocolAsset[]
  }
}

export type CompiledProtocolRequest = {
  method: string
  url: string
  headers: Record<string, string>
  requestMode: string
  responseMode: string
  body?: unknown
}

export type CompiledProtocolStep = {
  id: 'submit' | 'poll' | 'download'
  operation: string
  request: CompiledProtocolRequest
  capture?: Record<string, unknown>
  repeat?: ProtocolV2Workflow['poll']
  result?: ProtocolV2Workflow['result']
}

export type CompiledExecutionPlan = {
  format: 'dx-protocol-plan/v1'
  requestId: string
  protocol: { provider: string; model: string; profile?: string }
  intent: CapabilityIntent
  workflow: string
  steps: CompiledProtocolStep[]
}

type CompileContext = {
  model: string
  prompt: string
  params: Record<string, unknown>
  inputs: StandardProtocolTask['inputs']
  provider: { id: string; baseUrl: string }
  captures: Record<string, unknown>
  derived: Record<string, unknown>
}

const UNDEFINED = Symbol('protocol-template-undefined')
const WHOLE_TEMPLATE = /^{{\s*([^{}]+?)\s*}}$/

function expressionParts(expression: string) {
  return expression.replace(/\[\*]/g, '.*').split('.').filter(Boolean)
}

function expressionValue(root: unknown, expression: string): unknown | typeof UNDEFINED {
  let values: unknown[] = [root]
  let hasWildcard = false
  for (const part of expressionParts(expression)) {
    if (part === '*') {
      hasWildcard = true
      values = values.flatMap((value) => Array.isArray(value) ? value : [])
      continue
    }
    values = values.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      return Object.prototype.hasOwnProperty.call(value, part) ? [(value as Record<string, unknown>)[part]] : []
    })
  }
  if (hasWildcard) return values.filter((value) => value !== undefined)
  return values.length ? values[0] : UNDEFINED
}

function renderString(value: string, context: CompileContext): unknown | typeof UNDEFINED {
  const whole = value.match(WHOLE_TEMPLATE)
  if (whole) return expressionValue(context, whole[1].trim())
  return value.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, expression) => {
    const resolved = expressionValue(context, String(expression).trim())
    return resolved === UNDEFINED || resolved == null ? '' : String(resolved)
  })
}

function renderTemplate(value: unknown, context: CompileContext, depth = 0): unknown | typeof UNDEFINED {
  if (depth > 20) throw new Error('协议模板嵌套超过 20 层')
  if (typeof value === 'string') return renderString(value, context)
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, context, depth + 1)).filter((item) => item !== UNDEFINED)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const rendered = renderTemplate(item, context, depth + 1)
    if (rendered !== UNDEFINED) result[key] = rendered
  }
  return result
}

function finiteNumber(value: unknown, path: string) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${path} 没有得到有限数字`)
  return number
}

function evaluateExpression(expression: ProtocolV2Expression, context: CompileContext, path: string, depth = 0): unknown {
  if (depth > 20) throw new Error(`${path} 表达式嵌套超过 20 层`)
  if ('ref' in expression) {
    const value = expressionValue(context, expression.ref)
    return value === UNDEFINED ? undefined : value
  }
  if ('literal' in expression) return structuredClone(expression.literal)
  const evaluate = (value: ProtocolV2Expression, suffix: string) => evaluateExpression(value, context, `${path}.${suffix}`, depth + 1)
  if (expression.op === 'coalesce') {
    for (let index = 0; index < expression.values.length; index += 1) {
      const value = evaluate(expression.values[index], `values[${index}]`)
      if (value !== undefined && value !== null && value !== '') return value
    }
    return undefined
  }
  if (expression.op === 'add' || expression.op === 'multiply' || expression.op === 'min' || expression.op === 'max') {
    const values = expression.values.map((value, index) => finiteNumber(evaluate(value, `values[${index}]`), path))
    if (expression.op === 'add') return values.reduce((sum, value) => sum + value, 0)
    if (expression.op === 'multiply') return values.reduce((product, value) => product * value, 1)
    return expression.op === 'min' ? Math.min(...values) : Math.max(...values)
  }
  if (expression.op === 'subtract' || expression.op === 'divide') {
    const left = finiteNumber(evaluate(expression.left, 'left'), path)
    const right = finiteNumber(evaluate(expression.right, 'right'), path)
    if (expression.op === 'divide' && right === 0) throw new Error(`${path} 不能除以 0`)
    return expression.op === 'subtract' ? left - right : left / right
  }
  if (!('value' in expression)) throw new Error(`${path} 表达式缺少 value`)
  const value = evaluate(expression.value, 'value')
  if (expression.op === 'toString') return String(value ?? '')
  if (expression.op === 'round') return Math.round(finiteNumber(value, path))
  if (expression.op === 'floor') return Math.floor(finiteNumber(value, path))
  if (expression.op === 'ceil') return Math.ceil(finiteNumber(value, path))
  if (expression.op === 'clamp') return Math.max(expression.min, Math.min(expression.max, finiteNumber(value, path)))
  if (expression.op === 'roundMultiple') {
    const rounded = Math.round(finiteNumber(value, path) / expression.multiple) * expression.multiple
    return Math.max(expression.min ?? -Infinity, Math.min(expression.max ?? Infinity, rounded))
  }
  if (expression.op === 'lookup') {
    const key = String(value ?? '')
    return structuredClone(Object.prototype.hasOwnProperty.call(expression.cases, key) ? expression.cases[key] : expression.fallback)
  }
  throw new Error(`${path} 使用了未知表达式`)
}

function pathValue(context: CompileContext, key: string) {
  const direct = expressionValue(context, key.includes('.') ? key : `captures.${key}`)
  return direct === UNDEFINED ? `<capture:${key}>` : encodeURIComponent(String(direct))
}

function joinUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function authHeader(provider: ProviderProtocolV2, credential: string | undefined, redactSecrets: boolean) {
  if (provider.auth.type === 'none') return {}
  const header = provider.auth.header || (provider.auth.type === 'google_api_key' ? 'x-goog-api-key' : provider.auth.type === 'api_key_header' ? 'x-api-key' : 'Authorization')
  const prefix = provider.auth.prefix ?? (provider.auth.type === 'bearer' ? 'Bearer ' : '')
  const secret = redactSecrets ? `<secret:${provider.auth.credentialRef || 'api_key'}>` : String(credential || '')
  return { [header]: `${prefix}${secret}` }
}

function compileOperation(
  operation: ProtocolV2Operation,
  context: CompileContext,
  provider: ProviderProtocolV2,
  credential: string | undefined,
  redactSecrets: boolean,
): CompiledProtocolRequest {
  context.derived = {}
  for (const [key, expression] of Object.entries(operation.derive || {})) context.derived[key] = evaluateExpression(expression, context, `derive.${key}`)
  const renderedPath = operation.path.replace(/{([A-Za-z_][A-Za-z0-9_.]*)}/g, (_match, key) => pathValue(context, String(key)))
  const query = renderTemplate(operation.queryTemplate || {}, context) as Record<string, unknown>
  const url = new URL(joinUrl(context.provider.baseUrl, renderedPath))
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)))
    else url.searchParams.set(key, String(value))
  }
  const renderedHeaders = renderTemplate(operation.headersTemplate || {}, context) as Record<string, unknown>
  const headers = Object.fromEntries(Object.entries({
    ...(provider.headers || {}),
    ...authHeader(provider, credential, redactSecrets),
    ...Object.fromEntries(Object.entries(renderedHeaders).map(([key, value]) => [key, String(value)])),
  }).sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase())))
  const body = renderTemplate(operation.bodyTemplate, context)
  return {
    method: operation.method,
    url: url.toString(),
    headers,
    requestMode: operation.requestMode || 'json',
    responseMode: operation.responseMode || 'json',
    ...(body === UNDEFINED || body === undefined ? {} : { body }),
  }
}

function profileFor(modelProtocol: ModelProtocolV2, model: string) {
  const normalized = model.toLowerCase()
  return Object.entries(modelProtocol.modelProfiles || {}).find(([id, profile]) =>
    id.toLowerCase() === normalized || (profile.match || []).some((pattern) => normalized.startsWith(pattern.toLowerCase())),
  )
}

function workflowFor(modelProtocol: ModelProtocolV2, model: string, intent: CapabilityIntent) {
  const profile = profileFor(modelProtocol, model)
  const requested = profile?.[1].workflows?.[intent]
  const id = requested || (modelProtocol.workflows[intent] ? intent : Object.keys(modelProtocol.workflows)[0])
  if (!id || !modelProtocol.workflows[id]) throw new Error(`模型协议「${modelProtocol.id}」没有匹配 ${intent} 的 workflow`)
  return { id, workflow: modelProtocol.workflows[id], profileId: profile?.[0] }
}

export function compileProtocolPlan(args: {
  providerProtocol: unknown
  modelProtocol: unknown
  baseUrl: string
  credential?: string
  task: StandardProtocolTask
  redactSecrets?: boolean
}): CompiledExecutionPlan {
  const provider = validateProtocolV2(args.providerProtocol)
  const model = validateProtocolV2(args.modelProtocol)
  if (!isProviderProtocolV2(provider)) throw new Error('providerProtocol 必须是平台协议')
  if (!isModelProtocolV2(model)) throw new Error('modelProtocol 必须是模型协议')
  if (provider.executor.type !== 'declarative' || model.executor.type !== 'declarative') throw new Error('纯函数编译器只接受 declarative v2 协议')
  const selected = workflowFor(model, args.task.model, args.task.intent)
  const context: CompileContext = {
    model: args.task.model,
    prompt: String(args.task.prompt || ''),
    params: { ...args.task.params },
    inputs: structuredClone(args.task.inputs),
    provider: { id: provider.id, baseUrl: args.baseUrl },
    captures: {},
    derived: {},
  }
  const operation = (id: string) => {
    const value = model.operations[id] || provider.operations?.[id]
    if (!value) throw new Error(`workflow 引用了不存在的 operation「${id}」`)
    return value
  }
  const steps: CompiledProtocolStep[] = [{
    id: 'submit',
    operation: selected.workflow.submit,
    request: compileOperation(operation(selected.workflow.submit), context, provider, args.credential, args.redactSecrets !== false),
    capture: operation(selected.workflow.submit).response,
    result: selected.workflow.result,
  }]
  if (selected.workflow.poll) steps.push({
    id: 'poll', operation: selected.workflow.poll.operation,
    request: compileOperation(operation(selected.workflow.poll.operation), context, provider, args.credential, args.redactSecrets !== false),
    capture: operation(selected.workflow.poll.operation).response,
    repeat: selected.workflow.poll,
  })
  if (selected.workflow.download) steps.push({
    id: 'download', operation: selected.workflow.download,
    request: compileOperation(operation(selected.workflow.download), context, provider, args.credential, args.redactSecrets !== false),
    result: selected.workflow.result,
  })
  return {
    format: 'dx-protocol-plan/v1', requestId: args.task.requestId,
    protocol: { provider: provider.id, model: model.id, ...(selected.profileId ? { profile: selected.profileId } : {}) },
    intent: args.task.intent, workflow: selected.id, steps,
  }
}
