export interface DeveloperIcon {
  gradient: string
  svg?: string
  image?: string
  imageScale?: number
  imageOffsetX?: number
  imageOffsetY?: number
  imageBackground?: boolean
}

const FALLBACK_SVG = '<svg viewBox="0 0 64 64"><path d="M18 14h28a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Zm6 16h16v-6H24v6Zm0 12h10v-6H24v6Z"/></svg>'
const PALETTES = [['#0a84ff','#5856d6'],['#ff375f','#ff9f0a'],['#30d158','#00a7a0'],['#bf5af2','#5e5ce6'],['#ff9f0a','#ff453a'],['#64d2ff','#0a84ff']]

function escapeXml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[char] || char)) }
function safeGradient(value: unknown) {
  const gradient = String(value || '').trim()
  if (gradient === 'transparent') return gradient
  return /^(?:linear|radial)-gradient\([^;{}]{8,150}\)$/i.test(gradient) ? gradient : 'linear-gradient(145deg,#0a84ff,#5856d6)'
}
export function sanitizeDeveloperSvg(value: unknown) {
  const svg = String(value || '').trim().slice(0, 16_000)
  if (!/^<svg\b/i.test(svg) || !/<\/svg>$/i.test(svg)) throw new Error('SVG 图标必须包含完整的 <svg> 根元素')
  if (/<(?:script|foreignObject|iframe|object|embed|image)\b/i.test(svg) || /\son[a-z]+\s*=/i.test(svg) || /(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)/i.test(svg)) throw new Error('SVG 图标包含不安全内容')
  return svg
}
export function pngDataUrl(buffer: Buffer) {
  if (!buffer.length || buffer.length > 512 * 1024) throw new Error('PNG 图标不能超过 512 KB')
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('文件不是有效的 PNG 图标')
  return `data:image/png;base64,${buffer.toString('base64')}`
}
export function normalizeDeveloperIcon(value: unknown, fallback = true): DeveloperIcon | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback ? { gradient:'linear-gradient(145deg,#0a84ff,#5856d6)', svg:FALLBACK_SVG } : undefined
  const icon = value as { gradient?: unknown; svg?: unknown; image?: unknown; imageScale?: unknown; imageOffsetX?: unknown; imageOffsetY?: unknown; imageBackground?: unknown }
  const gradient = safeGradient(icon.gradient)
  const presentation = {
    imageScale: Math.max(0.5, Math.min(1.8, Number(icon.imageScale) || 1)),
    imageOffsetX: Math.max(-50, Math.min(50, Number(icon.imageOffsetX) || 0)),
    imageOffsetY: Math.max(-50, Math.min(50, Number(icon.imageOffsetY) || 0)),
    imageBackground: icon.imageBackground === true,
  }
  const image = String(icon.image || '').trim()
  if (image) {
    if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(image) || image.length > 720_000) throw new Error('PNG 图标数据无效或超过限制')
    pngDataUrl(Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'))
    return { gradient, image, ...presentation }
  }
  if (icon.svg) return { gradient, svg:sanitizeDeveloperSvg(icon.svg), ...presentation }
  return fallback ? { gradient, svg:FALLBACK_SVG } : undefined
}
export function autoDeveloperIcon(name: string, id: string): DeveloperIcon {
  let hash = 0
  for (const char of `${id}:${name}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const [from,to] = PALETTES[hash % PALETTES.length]
  const glyph = escapeXml((name.trim().match(/[\p{L}\p{N}]/u)?.[0] || 'A').toUpperCase())
  return { gradient:`linear-gradient(145deg,${from},${to})`, svg:`<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 10h28a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8Z" fill="none" stroke="currentColor" stroke-width="2" opacity=".28"/><text x="32" y="40" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="25" font-weight="750" fill="currentColor">${glyph}</text></svg>` }
}
