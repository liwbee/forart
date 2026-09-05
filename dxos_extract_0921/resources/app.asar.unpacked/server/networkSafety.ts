import { isIP } from 'node:net'

export function isPrivateNetworkAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return a === 0 || a === 10 || (a === 100 && b >= 64 && b <= 127) || a === 127
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113) || a >= 224
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase()
    if (value.startsWith('::ffff:')) {
      const mapped = value.slice(7)
      if (isIP(mapped) === 4) return isPrivateNetworkAddress(mapped)
      const words = mapped.split(':')
      if (words.length === 2) {
        const high = Number.parseInt(words[0] || '', 16)
        const low = Number.parseInt(words[1] || '', 16)
        if (Number.isInteger(high) && Number.isInteger(low)) return isPrivateNetworkAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
      }
    }
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
      || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
      || value.startsWith('ff') || value.startsWith('2001:db8:') || value.startsWith('2001:2:')
  }
  return true
}
