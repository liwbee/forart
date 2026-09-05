import type { CapabilityIntent } from '../capabilityTypes.ts'

export const PROTOCOL_V2_SCHEMA = 'dx-protocol/v2' as const

export type ProtocolV2Executor =
  | { type: 'declarative'; engine: string }
  | { type: 'native'; adapter: string }

export type ProtocolV2Auth = {
  type: 'bearer' | 'api_key_header' | 'google_api_key' | 'none'
  header?: string
  prefix?: string
  credentialRef?: 'api_key' | 'wallet_api_key'
}

export type ProtocolV2Selector = string | string[]

export type ProtocolV2ResponseMap = {
  taskId?: ProtocolV2Selector
  status?: ProtocolV2Selector
  progress?: ProtocolV2Selector
  resultUrl?: ProtocolV2Selector
  resultUrls?: ProtocolV2Selector
  errorCode?: ProtocolV2Selector
  errorMessage?: ProtocolV2Selector
  data?: ProtocolV2Selector
}

export type ProtocolV2Retry = {
  attempts: number
  delayMs?: number
  backoff?: number
  retryStatus?: number[]
}

export type ProtocolV2Expression =
  | { ref: string }
  | { literal: unknown }
  | { op: 'coalesce' | 'add' | 'multiply' | 'min' | 'max'; values: ProtocolV2Expression[] }
  | { op: 'subtract' | 'divide'; left: ProtocolV2Expression; right: ProtocolV2Expression }
  | { op: 'round' | 'floor' | 'ceil' | 'toString'; value: ProtocolV2Expression }
  | { op: 'clamp'; value: ProtocolV2Expression; min: number; max: number }
  | { op: 'roundMultiple'; value: ProtocolV2Expression; multiple: number; min?: number; max?: number }
  | { op: 'lookup'; value: ProtocolV2Expression; cases: Record<string, unknown>; fallback?: unknown }

export type ProtocolV2Operation = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  requestMode?: 'json' | 'query' | 'path' | 'multipart' | 'binary'
  headersTemplate?: Record<string, unknown>
  queryTemplate?: Record<string, unknown>
  bodyTemplate?: unknown
  derive?: Record<string, ProtocolV2Expression>
  omitEmpty?: boolean
  responseMode?: 'json' | 'text' | 'binary' | 'sse'
  successStatus?: number[]
  response?: ProtocolV2ResponseMap
  timeoutMs?: number
  retry?: ProtocolV2Retry
}

export type ProtocolV2Poll = {
  operation: string
  intervalMs: number
  backoff?: number
  maxIntervalMs?: number
  maxAttempts?: number
  status: {
    pending: string[]
    success: string[]
    failure: string[]
  }
}

export type ProtocolV2Workflow = {
  submit: string
  poll?: ProtocolV2Poll
  download?: string
  result?: {
    operation?: string
    kind: 'image' | 'video' | 'audio' | 'text' | 'file'
    source: 'response' | 'resultUrl' | 'binary'
    mime?: string
  }
}

export type ProtocolV2ModelProfile = {
  label?: string
  match?: string[]
  capabilities: CapabilityIntent[]
  workflows?: Partial<Record<CapabilityIntent, string>>
  defaults?: Record<string, unknown>
  limits?: Record<string, unknown>
}

type ProtocolV2Base = {
  schemaVersion: typeof PROTOCOL_V2_SCHEMA
  id: string
  label: string
  summary?: string
  executor: ProtocolV2Executor
}

export type ProviderProtocolV2 = ProtocolV2Base & {
  kind: 'provider'
  auth: ProtocolV2Auth
  headers?: Record<string, string>
  models: ProtocolV2Operation & { response: ProtocolV2ResponseMap & { data: ProtocolV2Selector } }
  defaults?: { timeoutMs?: number; pollIntervalMs?: number }
  operations?: Record<string, ProtocolV2Operation>
}

export type ModelProtocolV2 = ProtocolV2Base & {
  kind: 'model'
  capabilities: CapabilityIntent[]
  operations: Record<string, ProtocolV2Operation>
  workflows: Record<string, ProtocolV2Workflow>
  modelProfiles?: Record<string, ProtocolV2ModelProfile>
  uiSchemas?: Record<string, unknown[]>
}

export type ProtocolV2 = ProviderProtocolV2 | ModelProtocolV2
