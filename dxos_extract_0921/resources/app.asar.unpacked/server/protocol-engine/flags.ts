import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataPath } from '../dataPaths.ts'
import type { CapabilityIntent } from '../capabilityTypes.ts'

export type ProtocolExecutionFlagKey = {
  providerProtocolId: string
  modelProtocolId: string
  profileId: string
  intent: CapabilityIntent
}

export type ProtocolExecutionFlag = ProtocolExecutionFlagKey & {
  enabled: boolean
  updatedAt: number
}

type FlagStore = { format: 'dx-protocol-execution-flags/v1'; rules: ProtocolExecutionFlag[] }

const FLAG_FILE = process.env.DX_PROTOCOL_FLAG_FILE || dataPath('protocol-execution-flags.json')
let loaded = false
let store: FlagStore = { format: 'dx-protocol-execution-flags/v1', rules: [] }

function normalize(value: ProtocolExecutionFlagKey): ProtocolExecutionFlagKey {
  return {
    providerProtocolId: String(value.providerProtocolId || '').trim().toLowerCase(),
    modelProtocolId: String(value.modelProtocolId || '').trim().toLowerCase(),
    profileId: String(value.profileId || '').trim().toLowerCase(),
    intent: String(value.intent || '').trim() as CapabilityIntent,
  }
}

function same(left: ProtocolExecutionFlagKey, right: ProtocolExecutionFlagKey) {
  return left.providerProtocolId === right.providerProtocolId && left.modelProtocolId === right.modelProtocolId && left.profileId === right.profileId && left.intent === right.intent
}

function load() {
  if (loaded) return
  loaded = true
  if (!existsSync(FLAG_FILE)) return
  try {
    const raw = JSON.parse(readFileSync(FLAG_FILE, 'utf8')) as Partial<FlagStore>
    if (raw.format !== 'dx-protocol-execution-flags/v1' || !Array.isArray(raw.rules)) return
    store.rules = raw.rules.flatMap((rule) => {
      const key = normalize(rule)
      return key.providerProtocolId && key.modelProtocolId && key.profileId && key.intent
        ? [{ ...key, enabled: rule.enabled === true, updatedAt: Number(rule.updatedAt) || 0 }]
        : []
    })
  } catch { /* damaged flags mean all declarative execution remains disabled */ }
}

function persist() {
  mkdirSync(dirname(FLAG_FILE), { recursive: true })
  const temporary = `${FLAG_FILE}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  renameSync(temporary, FLAG_FILE)
}

export function listProtocolExecutionFlags() {
  load()
  return structuredClone(store.rules)
}

export function protocolExecutionEnabled(value: ProtocolExecutionFlagKey) {
  load()
  const key = normalize(value)
  return store.rules.find((rule) => same(rule, key))?.enabled === true
}

export function setProtocolExecutionFlag(value: ProtocolExecutionFlagKey & { enabled: boolean }, updatedAt = Date.now()) {
  load()
  const key = normalize(value)
  if (!key.providerProtocolId || !key.modelProtocolId || !key.profileId || !key.intent) throw new Error('执行开关必须精确指定 providerProtocolId/modelProtocolId/profileId/intent。')
  const rule: ProtocolExecutionFlag = { ...key, enabled: value.enabled === true, updatedAt }
  const index = store.rules.findIndex((item) => same(item, key))
  if (index >= 0) store.rules[index] = rule
  else store.rules.push(rule)
  persist()
  return structuredClone(rule)
}

export function resetProtocolExecutionFlagsForTests() {
  loaded = false
  store = { format: 'dx-protocol-execution-flags/v1', rules: [] }
}

