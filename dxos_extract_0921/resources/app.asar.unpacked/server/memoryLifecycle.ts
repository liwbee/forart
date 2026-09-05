export interface ExpiringRecord {
  expiresAt: number
}

export interface OwnedByteRecord extends ExpiringRecord {
  ownerId: string
  bytes: number
}

export class ExpiringStore<T extends ExpiringRecord> {
  private readonly records = new Map<string, T>()

  constructor(private readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('maxEntries 必须是正整数')
  }

  cleanup(now = Date.now()) {
    let removed = 0
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(key)
        removed += 1
      }
    }
    return removed
  }

  set(key: string, record: T, now = Date.now()) {
    this.cleanup(now)
    if (!this.records.has(key) && this.records.size >= this.maxEntries) throw new Error('临时链接数量已达上限，请稍后重试')
    this.records.set(key, record)
    return record
  }

  get(key: string, now = Date.now()) {
    const record = this.records.get(key)
    if (!record) return undefined
    if (record.expiresAt <= now) {
      this.records.delete(key)
      return undefined
    }
    return record
  }

  delete(key: string) {
    return this.records.delete(key)
  }

  stats(now = Date.now()) {
    this.cleanup(now)
    return { entries: this.records.size }
  }
}

export class OwnedByteStore<T extends OwnedByteRecord> {
  private readonly records = new Map<string, T>()

  constructor(
    private readonly maxEntriesPerOwner: number,
    private readonly maxBytes: number,
  ) {
    if (!Number.isSafeInteger(maxEntriesPerOwner) || maxEntriesPerOwner < 1) throw new Error('maxEntriesPerOwner 必须是正整数')
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes 必须是正整数')
  }

  cleanup(now = Date.now()) {
    let removed = 0
    let releasedBytes = 0
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(key)
        removed += 1
        releasedBytes += record.bytes
      }
    }
    return { removed, releasedBytes }
  }

  create(key: string, record: T, now = Date.now()) {
    this.cleanup(now)
    if (this.records.has(key)) throw new Error('临时上传 ID 已存在')
    let ownerEntries = 0
    for (const item of this.records.values()) if (item.ownerId === record.ownerId) ownerEntries += 1
    if (ownerEntries >= this.maxEntriesPerOwner) throw new Error(`同时进行的分片上传不能超过 ${this.maxEntriesPerOwner} 个`)
    if (this.totalBytes() + record.bytes > this.maxBytes) throw new Error('服务器分片上传暂存空间不足，请稍后重试')
    this.records.set(key, record)
    return record
  }

  get(key: string, now = Date.now()) {
    const record = this.records.get(key)
    if (!record) return undefined
    if (record.expiresAt <= now) {
      this.records.delete(key)
      return undefined
    }
    return record
  }

  reserveBytes(key: string, bytes: number, now = Date.now()) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('暂存字节数无效')
    const record = this.get(key, now)
    if (!record) return undefined
    if (this.totalBytes() + bytes > this.maxBytes) throw new Error('服务器分片上传暂存空间不足，请稍后重试')
    record.bytes += bytes
    return record
  }

  delete(key: string) {
    return this.records.delete(key)
  }

  stats(now = Date.now()) {
    this.cleanup(now)
    const owners = new Set<string>()
    for (const record of this.records.values()) owners.add(record.ownerId)
    return { entries: this.records.size, owners: owners.size, bytes: this.totalBytes() }
  }

  private totalBytes() {
    let bytes = 0
    for (const record of this.records.values()) bytes += record.bytes
    return bytes
  }
}

export function startMemoryLifecycleSweep(cleanups: Array<() => unknown>, intervalMs = 60_000) {
  const timer = setInterval(() => {
    for (const cleanup of cleanups) cleanup()
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
