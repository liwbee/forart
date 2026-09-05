import {
  PROTOCOL_V2_SCHEMA,
  type ModelProtocolV2,
  type ProtocolV2,
  type ProtocolV2Operation,
  type ProviderProtocolV2,
} from './types.ts'

const ID = /^[a-z0-9][a-z0-9:_-]{1,63}$/
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const REQUEST_MODES = new Set(['json', 'query', 'path', 'multipart', 'binary'])
const RESPONSE_MODES = new Set(['json', 'text', 'binary', 'sse'])
const TEMPLATE_ROOTS = new Set(['model', 'prompt', 'params', 'inputs', 'provider', 'captures', 'derived'])
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'set-cookie'])
const SELECTOR = /^\$(?:\.[A-Za-z0-9_-]+|\[(?:\d+|\*)\])*$/

type JsonObject = Record<string, unknown>

export class ProtocolValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`协议校验失败：${issues.join('；')}`)
    this.name = 'ProtocolValidationError'
  }
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function safePath(path: string) {
  if (path.startsWith('/')) return true
  try {
    const url = new URL(path)
    return url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  } catch { return false }
}

function validateTemplates(value: unknown, path: string, issues: string[], depth = 0) {
  if (depth > 20) { issues.push(`${path} 模板嵌套超过 20 层`); return }
  if (typeof value === 'string') {
    for (const match of value.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
      const expression = match[1].trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\*]))*$/.test(expression)) {
        issues.push(`${path} 包含非法模板表达式「${expression}」`)
        continue
      }
      if (!TEMPLATE_ROOTS.has(expression.split('.')[0])) issues.push(`${path} 使用了未授权模板变量「${expression}」`)
    }
    return
  }
  if (Array.isArray(value)) return value.forEach((item, index) => validateTemplates(item, `${path}[${index}]`, issues, depth + 1))
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as JsonObject)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) issues.push(`${path} 包含危险字段「${key}」`)
    validateTemplates(item, `${path}.${key}`, issues, depth + 1)
  }
}

function validateSelectors(value: unknown, path: string, issues: string[]) {
  const selectors = typeof value === 'string' ? [value] : strings(value)
  if (!selectors.length) { issues.push(`${path} 必须是 JSONPath 字符串或字符串数组`); return }
  for (const selector of selectors) if (!SELECTOR.test(selector)) issues.push(`${path} 包含不受支持的 selector「${selector}」`)
}

const EXPRESSION_OPS = new Set(['coalesce', 'add', 'multiply', 'min', 'max', 'subtract', 'divide', 'round', 'floor', 'ceil', 'toString', 'clamp', 'roundMultiple', 'lookup'])

function validateExpression(value: unknown, path: string, issues: string[], depth = 0) {
  if (depth > 20) { issues.push(`${path} 表达式嵌套超过 20 层`); return }
  const expression = object(value)
  if (typeof expression.ref === 'string') {
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\*]))*$/.test(expression.ref)) issues.push(`${path}.ref 无效`)
    else if (!TEMPLATE_ROOTS.has(expression.ref.split('.')[0])) issues.push(`${path}.ref 使用了未授权变量`)
    return
  }
  if (Object.prototype.hasOwnProperty.call(expression, 'literal')) return
  const op = String(expression.op || '')
  if (!EXPRESSION_OPS.has(op)) { issues.push(`${path}.op 不受支持`); return }
  if (['coalesce', 'add', 'multiply', 'min', 'max'].includes(op)) {
    if (!Array.isArray(expression.values) || !expression.values.length) issues.push(`${path}.values 不能为空`)
    else expression.values.forEach((item, index) => validateExpression(item, `${path}.values[${index}]`, issues, depth + 1))
  } else if (['subtract', 'divide'].includes(op)) {
    validateExpression(expression.left, `${path}.left`, issues, depth + 1)
    validateExpression(expression.right, `${path}.right`, issues, depth + 1)
  } else {
    validateExpression(expression.value, `${path}.value`, issues, depth + 1)
  }
  if (op === 'clamp' && (!(Number(expression.min) <= Number(expression.max)) || !Number.isFinite(Number(expression.min)) || !Number.isFinite(Number(expression.max)))) issues.push(`${path} clamp 范围无效`)
  if (op === 'roundMultiple' && (!(Number(expression.multiple) > 0) || !Number.isFinite(Number(expression.multiple)))) issues.push(`${path}.multiple 必须大于 0`)
  if (op === 'lookup' && !Object.keys(object(expression.cases)).length) issues.push(`${path}.cases 不能为空`)
}

function validateOperation(id: string, value: unknown, path: string, issues: string[]) {
  const operation = object(value)
  const method = String(operation.method || '').toUpperCase()
  const operationPath = String(operation.path || '')
  if (!ID.test(id.replace(/\./g, '_'))) issues.push(`${path} operation id「${id}」无效`)
  if (!METHODS.has(method)) issues.push(`${path}.method 不受支持`)
  if (!operationPath || !safePath(operationPath.replace(/{[A-Za-z_][A-Za-z0-9_]*}/g, 'value'))) issues.push(`${path}.path 必须是相对路径、HTTPS，或 localhost HTTP`)
  if (operation.requestMode != null && !REQUEST_MODES.has(String(operation.requestMode))) issues.push(`${path}.requestMode 不受支持`)
  if (operation.responseMode != null && !RESPONSE_MODES.has(String(operation.responseMode))) issues.push(`${path}.responseMode 不受支持`)
  if (operation.timeoutMs != null && (!(Number(operation.timeoutMs) > 0) || Number(operation.timeoutMs) > 3_600_000)) issues.push(`${path}.timeoutMs 必须在 1–3600000 之间`)
  const headers = object(operation.headersTemplate)
  for (const key of Object.keys(headers)) if (FORBIDDEN_HEADERS.has(key.toLowerCase())) issues.push(`${path}.headersTemplate 禁止设置 ${key}`)
  for (const key of ['headersTemplate', 'queryTemplate', 'bodyTemplate'] as const) validateTemplates(operation[key], `${path}.${key}`, issues)
  for (const [key, expression] of Object.entries(object(operation.derive))) validateExpression(expression, `${path}.derive.${key}`, issues)
  const response = object(operation.response)
  for (const [key, selector] of Object.entries(response)) validateSelectors(selector, `${path}.response.${key}`, issues)
  const retry = object(operation.retry)
  if (operation.retry != null) {
    if (!Number.isInteger(Number(retry.attempts)) || Number(retry.attempts) < 1 || Number(retry.attempts) > 10) issues.push(`${path}.retry.attempts 必须是 1–10 的整数`)
    if (retry.backoff != null && (Number(retry.backoff) < 1 || Number(retry.backoff) > 10)) issues.push(`${path}.retry.backoff 必须在 1–10 之间`)
  }
}

function validateBase(raw: JsonObject, issues: string[]) {
  if (raw.schemaVersion !== PROTOCOL_V2_SCHEMA) issues.push(`schemaVersion 必须是 ${PROTOCOL_V2_SCHEMA}`)
  if (!ID.test(String(raw.id || ''))) issues.push('id 只能使用小写字母、数字、冒号、下划线和短横线，长度 2–64')
  if (!String(raw.label || '').trim()) issues.push('缺少 label')
  const executor = object(raw.executor)
  if (!['declarative', 'native'].includes(String(executor.type || ''))) issues.push('executor.type 必须是 declarative 或 native')
  if (executor.type === 'declarative' && !String(executor.engine || '').trim()) issues.push('declarative executor 缺少 engine')
  if (executor.type === 'native' && !ID.test(String(executor.adapter || ''))) issues.push('native executor 缺少合法 adapter')
}

function validateProvider(raw: JsonObject, issues: string[]) {
  const auth = object(raw.auth)
  if (!['bearer', 'api_key_header', 'google_api_key', 'none'].includes(String(auth.type || ''))) issues.push('auth.type 不受支持')
  if (auth.credentialRef != null && !['api_key', 'wallet_api_key'].includes(String(auth.credentialRef))) issues.push('auth.credentialRef 不受支持')
  for (const key of Object.keys(object(raw.headers))) if (FORBIDDEN_HEADERS.has(key.toLowerCase())) issues.push(`headers 禁止设置 ${key}`)
  validateOperation('models', raw.models, 'models', issues)
  if (!object(raw.models).response) issues.push('models.response 缺失')
  const operations = object(raw.operations)
  if (Object.keys(operations).length > 100) issues.push('operations 不能超过 100 个')
  for (const [id, operation] of Object.entries(operations)) validateOperation(id, operation, `operations.${id}`, issues)
}

function validateModel(raw: JsonObject, issues: string[]) {
  const operations = object(raw.operations)
  const workflows = object(raw.workflows)
  if (!Object.keys(operations).length) issues.push('模型协议至少需要一个 operation')
  if (!Object.keys(workflows).length) issues.push('模型协议至少需要一个 workflow')
  if (Object.keys(operations).length > 100) issues.push('operations 不能超过 100 个')
  if (Object.keys(workflows).length > 100) issues.push('workflows 不能超过 100 个')
  for (const [id, operation] of Object.entries(operations)) validateOperation(id, operation, `operations.${id}`, issues)
  for (const [id, value] of Object.entries(workflows)) {
    const workflow = object(value)
    const submit = String(workflow.submit || '')
    if (!operations[submit]) issues.push(`workflows.${id}.submit 引用了不存在的 operation「${submit}」`)
    const poll = object(workflow.poll)
    if (workflow.poll != null) {
      const operation = String(poll.operation || '')
      if (!operations[operation]) issues.push(`workflows.${id}.poll.operation 引用了不存在的 operation「${operation}」`)
      if (!(Number(poll.intervalMs) >= 100) || Number(poll.intervalMs) > 300_000) issues.push(`workflows.${id}.poll.intervalMs 必须在 100–300000 之间`)
      const status = object(poll.status)
      for (const key of ['pending', 'success', 'failure']) if (!strings(status[key]).length) issues.push(`workflows.${id}.poll.status.${key} 不能为空`)
    }
    const download = String(workflow.download || '')
    if (download && !operations[download]) issues.push(`workflows.${id}.download 引用了不存在的 operation「${download}」`)
  }
  for (const [id, value] of Object.entries(object(raw.modelProfiles))) {
    const profile = object(value)
    if (!strings(profile.capabilities).length) issues.push(`modelProfiles.${id}.capabilities 不能为空`)
    for (const [intent, workflow] of Object.entries(object(profile.workflows))) if (!workflows[String(workflow)]) issues.push(`modelProfiles.${id}.workflows.${intent} 引用了不存在的 workflow「${String(workflow)}」`)
  }
}

export function validateProtocolV2(value: unknown): ProtocolV2 {
  const raw = object(value)
  const issues: string[] = []
  let serialized = ''
  try { serialized = JSON.stringify(value) } catch { issues.push('协议必须可以序列化为 JSON') }
  if (serialized.length > 256 * 1024) issues.push('协议 JSON 不能超过 256 KiB')
  validateBase(raw, issues)
  if (raw.kind === 'provider') validateProvider(raw, issues)
  else if (raw.kind === 'model') validateModel(raw, issues)
  else issues.push('kind 必须是 provider 或 model')
  if (issues.length) throw new ProtocolValidationError(issues)
  return structuredClone(raw) as unknown as ProtocolV2
}

export function isProviderProtocolV2(protocol: ProtocolV2): protocol is ProviderProtocolV2 { return protocol.kind === 'provider' }
export function isModelProtocolV2(protocol: ProtocolV2): protocol is ModelProtocolV2 { return protocol.kind === 'model' }
export type { ProtocolV2Operation }
