import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { isPrivateNetworkAddress } from '../networkSafety.ts'

export type DownloadedProtocolArtifact = { data: Uint8Array; mime: string; sourceUrl: string }
export type ProtocolArtifactDownloader = (url: string, options?: { maxBytes?: number; timeoutMs?: number }) => Promise<DownloadedProtocolArtifact>

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024

export function validateProtocolArtifactUrl(raw: string) {
  let url: URL
  try { url = new URL(String(raw || '')) } catch { throw new Error('协议产物 URL 无效') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('协议产物只允许标准 HTTPS URL')
  }
  return url
}

async function pinnedPublicAddress(url: URL) {
  const addresses = await dnsLookup(url.hostname, { all: true, verbatim: true })
  const publicAddresses = addresses.filter((entry) => !isPrivateNetworkAddress(entry.address))
  if (!addresses.length || publicAddresses.length !== addresses.length) throw new Error('协议产物 URL 解析到了内网或保留地址')
  return publicAddresses[0]!
}

function requestPinned(url: URL, address: { address: string; family: number }, maxBytes: number, timeoutMs: number) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; data: Uint8Array }>((resolve, reject) => {
    const lookup: LookupFunction = (_hostname, _options, callback) => callback(null, address.address, address.family as 4 | 6)
    const request = httpsRequest(url, {
      method: 'GET', lookup, servername: url.hostname,
      headers: { Accept: 'image/*, video/*, audio/*, application/octet-stream' },
    }, (response) => {
      const declared = Number(response.headers['content-length'] || 0)
      if (declared > maxBytes) {
        response.destroy()
        reject(new Error(`协议产物超过大小限制 ${maxBytes} 字节`))
        return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength
        if (bytes > maxBytes) {
          response.destroy(new Error(`协议产物超过大小限制 ${maxBytes} 字节`))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, data: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('协议产物下载超时')))
    request.on('error', reject)
    request.end()
  })
}

export const downloadProtocolArtifact: ProtocolArtifactDownloader = async (raw, options = {}) => {
  const maxBytes = Math.max(1, Math.min(Number(options.maxBytes) || DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES))
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 180_000, 10 * 60_000))
  let url = validateProtocolArtifactUrl(raw)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const address = await pinnedPublicAddress(url)
    const response = await requestPinned(url, address, maxBytes, timeoutMs)
    if (REDIRECTS.has(response.status)) {
      const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location
      if (!location || redirects === 3) throw new Error('协议产物重定向过多或缺少 Location')
      url = validateProtocolArtifactUrl(new URL(location, url).toString())
      continue
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`协议产物下载失败 HTTP ${response.status}`)
    const contentType = Array.isArray(response.headers['content-type']) ? response.headers['content-type'][0] : response.headers['content-type']
    return { data: response.data, mime: String(contentType || 'application/octet-stream').split(';')[0], sourceUrl: url.toString() }
  }
  throw new Error('协议产物下载失败')
}
