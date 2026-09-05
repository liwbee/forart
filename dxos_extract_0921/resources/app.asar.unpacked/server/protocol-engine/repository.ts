import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataPath } from '../dataPaths.ts'
import type { ProtocolV2 } from './types.ts'
import { validateProtocolV2 } from './validator.ts'

export type ProtocolV2Kind = 'provider' | 'model'

export type StoredProtocolV2Version = {
  version: number
  hash: string
  createdAt: number
  protocol: ProtocolV2
}

export type StoredProtocolV2Entry = {
  id: string
  kind: ProtocolV2Kind
  activeVersion: number
  versions: Record<string, StoredProtocolV2Version>
}

type ProtocolV2Store = {
  format: 'dx-custom-protocols/v2'
  provider: Record<string, StoredProtocolV2Entry>
  model: Record<string, StoredProtocolV2Entry>
}

const STORE_FILE = process.env.DX_PROTOCOL_V2_FILE || dataPath('custom-protocols-v2.json')
let loaded = false
let store: ProtocolV2Store = { format: 'dx-custom-protocols/v2', provider: {}, model: {} }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function protocolV2Hash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseEntry(raw: unknown, expectedKind: ProtocolV2Kind): StoredProtocolV2Entry | null {
  const value = object(raw)
  const id = String(value.id || '')
  const versions: Record<string, StoredProtocolV2Version> = {}
  for (const [versionKey, versionRaw] of Object.entries(object(value.versions))) {
    try {
      const versionObject = object(versionRaw)
      const protocol = validateProtocolV2(versionObject.protocol)
      const version = Number(versionObject.version || versionKey)
      if (protocol.kind !== expectedKind || protocol.id !== id || !Number.isInteger(version) || version < 1) continue
      const hash = protocolV2Hash(protocol)
      if (versionObject.hash && String(versionObject.hash) !== hash) continue
      versions[String(version)] = { version, hash, createdAt: Number(versionObject.createdAt) || 0, protocol }
    } catch { /* skip damaged version */ }
  }
  const keys = Object.keys(versions).map(Number).sort((left, right) => left - right)
  if (!id || !keys.length) return null
  const requestedActive = Number(value.activeVersion)
  const activeVersion = versions[String(requestedActive)] ? requestedActive : keys[keys.length - 1]
  return { id, kind: expectedKind, activeVersion, versions }
}

function ensureLoaded() {
  if (loaded) return
  loaded = true
  if (!existsSync(STORE_FILE)) return
  try {
    const raw = object(JSON.parse(readFileSync(STORE_FILE, 'utf8')))
    if (raw.format !== 'dx-custom-protocols/v2') return
    for (const kind of ['provider', 'model'] as const) {
      for (const rawEntry of Object.values(object(raw[kind]))) {
        const entry = parseEntry(rawEntry, kind)
        if (entry) store[kind][entry.id] = entry
      }
    }
  } catch { /* damaged v2 store does not block startup */ }
}

function persist() {
  mkdirSync(dirname(STORE_FILE), { recursive: true })
  const temporary = `${STORE_FILE}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  renameSync(temporary, STORE_FILE)
}

function publicEntry(entry: StoredProtocolV2Entry) {
  const active = entry.versions[String(entry.activeVersion)]
  return {
    id: entry.id,
    kind: entry.kind,
    activeVersion: entry.activeVersion,
    activeHash: active.hash,
    protocol: structuredClone(active.protocol),
    versions: Object.values(entry.versions).sort((left, right) => right.version - left.version).map(({ version, hash, createdAt }) => ({ version, hash, createdAt })),
  }
}

export function listProtocolsV2(kind?: ProtocolV2Kind) {
  ensureLoaded()
  const kinds = kind ? [kind] : ['provider', 'model'] as const
  return kinds.flatMap((entryKind) => Object.values(store[entryKind]).map(publicEntry)).sort((left, right) => left.id.localeCompare(right.id))
}

export function getProtocolV2(kind: ProtocolV2Kind, idValue: string, version?: number) {
  ensureLoaded()
  const id = String(idValue || '').trim().toLowerCase()
  const entry = store[kind][id]
  if (!entry) return null
  const selected = entry.versions[String(version || entry.activeVersion)]
  return selected ? structuredClone(selected) : null
}

export function saveProtocolV2(kind: ProtocolV2Kind, value: unknown, createdAt = Date.now()) {
  ensureLoaded()
  const protocol = validateProtocolV2(value)
  if (protocol.kind !== kind) throw new Error(`协议 kind 是 ${protocol.kind}，不能保存到 ${kind} 仓库。`)
  if (protocol.executor.type !== 'declarative') throw new Error('用户自定义 v2 协议只能使用 declarative executor。')
  const collection = store[kind]
  const existing = collection[protocol.id]
  const hash = protocolV2Hash(protocol)
  if (existing) {
    const same = Object.values(existing.versions).find((item) => item.hash === hash)
    if (same) {
      existing.activeVersion = same.version
      persist()
      return publicEntry(existing)
    }
  }
  const version = existing ? Math.max(...Object.keys(existing.versions).map(Number)) + 1 : 1
  const versionEntry: StoredProtocolV2Version = { version, hash, createdAt, protocol }
  const entry: StoredProtocolV2Entry = existing || { id: protocol.id, kind, activeVersion: version, versions: {} }
  entry.versions[String(version)] = versionEntry
  entry.activeVersion = version
  collection[protocol.id] = entry
  persist()
  return publicEntry(entry)
}

export function activateProtocolV2(kind: ProtocolV2Kind, idValue: string, version: number) {
  ensureLoaded()
  const id = String(idValue || '').trim().toLowerCase()
  const entry = store[kind][id]
  if (!entry) throw new Error(`v2 ${kind} 协议「${id}」不存在。`)
  if (!entry.versions[String(version)]) throw new Error(`v2 协议「${id}」版本 ${version} 不存在。`)
  entry.activeVersion = version
  persist()
  return publicEntry(entry)
}

export function removeProtocolV2(kind: ProtocolV2Kind, idValue: string) {
  ensureLoaded()
  const id = String(idValue || '').trim().toLowerCase()
  if (!store[kind][id]) throw new Error(`v2 ${kind} 协议「${id}」不存在。`)
  delete store[kind][id]
  persist()
  return id
}

export function resetProtocolV2RepositoryForTests() {
  loaded = false
  store = { format: 'dx-custom-protocols/v2', provider: {}, model: {} }
}

