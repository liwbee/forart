import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataPath } from './dataPaths.ts'

const PREFIX = 'dxenc:v1:'
const KEY_FILE = dataPath('security', 'master.key')

function masterKey() {
  mkdirSync(dirname(KEY_FILE), { recursive: true })
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32), { mode: 0o600, flag: 'wx' })
  const key = readFileSync(KEY_FILE)
  if (key.length !== 32) throw new Error('DX OS 数据加密主密钥无效')
  return key
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function encryptSecret(value: string) {
  const plain = String(value || '')
  if (!plain || isEncryptedSecret(plain)) return plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`
}

export function decryptSecret(value: string) {
  const stored = String(value || '')
  if (!isEncryptedSecret(stored)) return stored
  const payload = Buffer.from(stored.slice(PREFIX.length), 'base64')
  if (payload.length < 29) throw new Error('加密配置内容无效')
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const encrypted = payload.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
