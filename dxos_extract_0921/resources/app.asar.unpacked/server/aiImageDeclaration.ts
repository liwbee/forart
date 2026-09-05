import { inflateRawSync } from 'node:zlib'
import sharp from 'sharp'
import { buildZip, type ZipEntry } from './zip.ts'

export const DECLARATION_LABEL = 'contains-synthetic-performer'
export const DECLARATION_URI = `http://cv.iptc.org/newscodes/digitalsourcetype/${DECLARATION_LABEL}`

const XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_ARCHIVE_ENTRIES = 2000
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let value = n
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[n] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer) {
  let value = 0xffffffff
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function xmpPacket(existing?: string) {
  if (existing) {
    const attr = /\s+Iptc4xmpExt:DigitalSourceType=(['"])[\s\S]*?\1/
    if (attr.test(existing)) return existing.replace(attr, ` Iptc4xmpExt:DigitalSourceType="${DECLARATION_URI}"`)
    const description = /<rdf:Description\b/
    if (description.test(existing)) {
      const namespace = existing.includes('xmlns:Iptc4xmpExt=')
        ? ''
        : ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"'
      return existing.replace(description, `<rdf:Description${namespace} Iptc4xmpExt:DigitalSourceType="${DECLARATION_URI}"`)
    }
  }
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="DX OS AI图片声明">\n` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ` +
    `Iptc4xmpExt:DigitalSourceType="${DECLARATION_URI}"/>\n` +
    `</rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`
}

/**
 * 写入 Windows 资源管理器“属性 → 详细信息 → 标记”读取的 XPKeywords。
 * 使用新的 IFD0 表指向原 TIFF 数据，避免移动相机 EXIF 数据后破坏其内部偏移。
 */
function addWindowsKeyword(input: Buffer) {
  const exifHeader = Buffer.from('Exif\0\0', 'ascii')
  let offset = 2
  let exifStart = -1
  let exifEnd = -1
  let existingTiff: Buffer | null = null
  while (offset + 4 <= input.length && input[offset] === 0xff) {
    const marker = input[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    const segmentLength = input.readUInt16BE(offset + 2)
    const end = offset + 2 + segmentLength
    if (segmentLength < 2 || end > input.length) throw new Error('JPEG 段结构无效')
    if (marker === 0xe1 && input.subarray(offset + 4, offset + 10).equals(exifHeader)) {
      exifStart = offset
      exifEnd = end
      existingTiff = Buffer.from(input.subarray(offset + 10, end))
      break
    }
    offset = end
  }

  const keyword = Buffer.from(`${DECLARATION_LABEL}\0`, 'utf16le')
  let tiff: Buffer
  if (existingTiff) {
    if (existingTiff.length < 8) throw new Error('EXIF 数据无效')
    const byteOrder = existingTiff.subarray(0, 2).toString('ascii')
    const little = byteOrder === 'II'
    if (!little && byteOrder !== 'MM') throw new Error('EXIF 字节序无效')
    const read16 = (at: number) => little ? existingTiff!.readUInt16LE(at) : existingTiff!.readUInt16BE(at)
    const read32 = (at: number) => little ? existingTiff!.readUInt32LE(at) : existingTiff!.readUInt32BE(at)
    const write16 = (target: Buffer, value: number, at: number) => little ? target.writeUInt16LE(value, at) : target.writeUInt16BE(value, at)
    const write32 = (target: Buffer, value: number, at: number) => little ? target.writeUInt32LE(value, at) : target.writeUInt32BE(value, at)
    if (read16(2) !== 42) throw new Error('EXIF TIFF 标识无效')
    const oldIfdOffset = read32(4)
    if (oldIfdOffset + 2 > existingTiff.length) throw new Error('EXIF IFD0 无效')
    const oldCount = read16(oldIfdOffset)
    const oldEntriesEnd = oldIfdOffset + 2 + oldCount * 12
    if (oldEntriesEnd + 4 > existingTiff.length) throw new Error('EXIF IFD0 不完整')
    const entries: Buffer[] = []
    for (let index = 0; index < oldCount; index++) {
      const entry = Buffer.from(existingTiff.subarray(oldIfdOffset + 2 + index * 12, oldIfdOffset + 14 + index * 12))
      if (read16(oldIfdOffset + 2 + index * 12) !== 0x9c9e) entries.push(entry)
    }
    const xpEntry = Buffer.alloc(12)
    write16(xpEntry, 0x9c9e, 0)
    write16(xpEntry, 1, 2) // BYTE；Windows XPKeywords 的规范类型
    write32(xpEntry, keyword.length, 4)
    entries.push(xpEntry)
    entries.sort((a, b) => (little ? a.readUInt16LE(0) - b.readUInt16LE(0) : a.readUInt16BE(0) - b.readUInt16BE(0)))

    const padding = existingTiff.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
    const newIfdOffset = existingTiff.length + padding.length
    const newIfd = Buffer.alloc(2 + entries.length * 12 + 4)
    write16(newIfd, entries.length, 0)
    entries.forEach((entry, index) => entry.copy(newIfd, 2 + index * 12))
    const nextIfd = read32(oldEntriesEnd)
    write32(newIfd, nextIfd, 2 + entries.length * 12)
    const keywordOffset = newIfdOffset + newIfd.length
    const xpIndex = entries.findIndex((entry) => (little ? entry.readUInt16LE(0) : entry.readUInt16BE(0)) === 0x9c9e)
    write32(newIfd, keywordOffset, 2 + xpIndex * 12 + 8)
    tiff = Buffer.concat([existingTiff, padding, newIfd, keyword])
    write32(tiff, newIfdOffset, 4)
  } else {
    tiff = Buffer.alloc(8 + 2 + 12 + 4 + keyword.length)
    tiff.write('II', 0, 2, 'ascii')
    tiff.writeUInt16LE(42, 2)
    tiff.writeUInt32LE(8, 4)
    tiff.writeUInt16LE(1, 8)
    tiff.writeUInt16LE(0x9c9e, 10)
    tiff.writeUInt16LE(1, 12)
    tiff.writeUInt32LE(keyword.length, 14)
    tiff.writeUInt32LE(26, 18)
    tiff.writeUInt32LE(0, 22)
    keyword.copy(tiff, 26)
  }

  const payload = Buffer.concat([exifHeader, tiff])
  if (payload.length + 2 > 0xffff) throw new Error('EXIF 元数据过大，无法添加 Windows 标记')
  const segment = Buffer.alloc(4)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(payload.length + 2, 2)
  const fullSegment = Buffer.concat([segment, payload])
  if (exifStart >= 0) return Buffer.concat([input.subarray(0, exifStart), fullSegment, input.subarray(exifEnd)])
  return Buffer.concat([input.subarray(0, 2), fullSegment, input.subarray(2)])
}

function addJpegDeclaration(input: Buffer) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new Error('JPEG 文件无效')
  let offset = 2
  let existingStart = -1
  let existingEnd = -1
  let existingXmp: string | undefined
  while (offset + 4 <= input.length && input[offset] === 0xff) {
    const marker = input[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    const segmentLength = input.readUInt16BE(offset + 2)
    const end = offset + 2 + segmentLength
    if (segmentLength < 2 || end > input.length) throw new Error('JPEG 段结构无效')
    if (marker === 0xe1 && input.subarray(offset + 4, offset + 4 + XMP_HEADER.length).equals(XMP_HEADER)) {
      existingStart = offset
      existingEnd = end
      existingXmp = input.subarray(offset + 4 + XMP_HEADER.length, end).toString('utf8')
      break
    }
    offset = end
  }
  const payload = Buffer.concat([XMP_HEADER, Buffer.from(xmpPacket(existingXmp), 'utf8')])
  if (payload.length + 2 > 0xffff) throw new Error('XMP 元数据过大')
  const segment = Buffer.alloc(4)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(payload.length + 2, 2)
  const fullSegment = Buffer.concat([segment, payload])
  if (existingStart >= 0) return Buffer.concat([input.subarray(0, existingStart), fullSegment, input.subarray(existingEnd)])
  return Buffer.concat([input.subarray(0, 2), fullSegment, input.subarray(2)])
}

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type, 'ascii')
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  name.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return out
}

function addPngDeclaration(input: Buffer) {
  if (!input.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('PNG 文件无效')
  const chunks: Buffer[] = [PNG_SIGNATURE]
  let offset = 8
  let inserted = false
  let existingXmp: string | undefined
  const parsed: Array<{ type: string; raw: Buffer; data: Buffer }> = []
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > input.length) throw new Error('PNG 块结构无效')
    const type = input.subarray(offset + 4, offset + 8).toString('ascii')
    const data = input.subarray(offset + 8, offset + 8 + length)
    const isXmp = type === 'iTXt' && data.subarray(0, 18).toString('latin1') === 'XML:com.adobe.xmp\0'
    if (isXmp) {
      const separators = [] as number[]
      for (let i = 0; i < data.length && separators.length < 5; i++) if (data[i] === 0) separators.push(i)
      const textStart = separators.length >= 5 ? separators[4] + 1 : 22
      existingXmp = data.subarray(textStart).toString('utf8')
    } else parsed.push({ type, raw: input.subarray(offset, end), data })
    offset = end
    if (type === 'IEND') break
  }
  const xmpData = Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'), Buffer.from(xmpPacket(existingXmp), 'utf8')])
  for (const chunk of parsed) {
    if (!inserted && chunk.type === 'IDAT') {
      chunks.push(pngChunk('iTXt', xmpData))
      inserted = true
    }
    chunks.push(chunk.raw)
  }
  if (!inserted) throw new Error('PNG 缺少图像数据')
  return Buffer.concat(chunks)
}

function riffChunk(type: string, data: Buffer) {
  const out = Buffer.alloc(8 + data.length + (data.length % 2))
  out.write(type, 0, 4, 'ascii')
  out.writeUInt32LE(data.length, 4)
  data.copy(out, 8)
  return out
}

function addWebpDeclaration(input: Buffer) {
  if (input.length < 12 || input.subarray(0, 4).toString('ascii') !== 'RIFF' || input.subarray(8, 12).toString('ascii') !== 'WEBP') throw new Error('WebP 文件无效')
  const chunks: Buffer[] = []
  let offset = 12
  let existingXmp: string | undefined
  while (offset + 8 <= input.length) {
    const type = input.subarray(offset, offset + 4).toString('ascii')
    const length = input.readUInt32LE(offset + 4)
    const end = offset + 8 + length + (length % 2)
    if (end > input.length) throw new Error('WebP 块结构无效')
    const data = Buffer.from(input.subarray(offset + 8, offset + 8 + length))
    if (type === 'XMP ') existingXmp = data.toString('utf8')
    else {
      if (type === 'VP8X' && data.length) data[0] |= 0x04
      chunks.push(riffChunk(type, data))
    }
    offset = end
  }
  chunks.push(riffChunk('XMP ', Buffer.from(xmpPacket(existingXmp), 'utf8')))
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks])
  const header = Buffer.alloc(8)
  header.write('RIFF', 0, 4, 'ascii')
  header.writeUInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

type ImageKind = 'jpeg' | 'png' | 'webp'

/** 先按真实字节识别，扩展名只作为损坏文件的错误提示兜底。 */
function imageKind(name: string, data: Buffer): ImageKind | null {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return 'jpeg'
  if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'png'
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (/\.jpe?g$/i.test(name)) return 'jpeg'
  if (/\.png$/i.test(name)) return 'png'
  if (/\.webp$/i.test(name)) return 'webp'
  return null
}

async function normalizeToJpeg(name: string, data: Buffer) {
  const kind = imageKind(name, data)
  if (!kind) return null
  if (kind === 'jpeg') return data
  return sharp(data)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer()
}

export async function addDeclaration(name: string, data: Buffer) {
  const jpeg = await normalizeToJpeg(name, data)
  return jpeg ? addWindowsKeyword(addJpegDeclaration(jpeg)) : null
}

/** 所有输入统一输出为 JPEG，错误扩展名也会同步修正。 */
function normalizedJpegName(name: string) {
  const current = name.match(/\.[^./]+$/)?.[0].toLowerCase()
  const valid = current === '.jpg' || current === '.jpeg'
  return valid ? name : current ? `${name.slice(0, -current.length)}.jpg` : `${name}.jpg`
}

function safeZipName(name: string) {
  const clean = name.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean || clean.split('/').some((part) => part === '..')) throw new Error('ZIP 中包含不安全路径')
  return clean
}

function readZip(input: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = input.length - 22; i >= Math.max(0, input.length - 65557); i--) {
    if (input.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP 文件无效或不受支持')
  const count = input.readUInt16LE(eocd + 10)
  const centralOffset = input.readUInt32LE(eocd + 16)
  if (count > MAX_ARCHIVE_ENTRIES) throw new Error(`ZIP 文件数量超过 ${MAX_ARCHIVE_ENTRIES} 个`)
  const entries: ZipEntry[] = []
  let total = 0
  let offset = centralOffset
  for (let index = 0; index < count; index++) {
    if (offset + 46 > input.length || input.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 目录结构无效')
    const flags = input.readUInt16LE(offset + 8)
    const method = input.readUInt16LE(offset + 10)
    const compressedSize = input.readUInt32LE(offset + 20)
    const size = input.readUInt32LE(offset + 24)
    const nameLength = input.readUInt16LE(offset + 28)
    const extraLength = input.readUInt16LE(offset + 30)
    const commentLength = input.readUInt16LE(offset + 32)
    const localOffset = input.readUInt32LE(offset + 42)
    const rawName = input.subarray(offset + 46, offset + 46 + nameLength)
    const name = safeZipName(rawName.toString(flags & 0x0800 ? 'utf8' : 'latin1'))
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (flags & 0x0001) throw new Error('暂不支持加密 ZIP')
    if (localOffset + 30 > input.length || input.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP 文件项无效')
    const localNameLength = input.readUInt16LE(localOffset + 26)
    const localExtraLength = input.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const compressed = input.subarray(start, start + compressedSize)
    if (compressed.length !== compressedSize) throw new Error('ZIP 文件项不完整')
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null
    if (!data) throw new Error(`ZIP 使用了不支持的压缩方式：${method}`)
    if (data.length !== size) throw new Error('ZIP 文件项大小校验失败')
    total += data.length
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('ZIP 解压后超过 500 MB')
    entries.push({ name, data })
  }
  return entries
}

export interface ProcessedDeclaration {
  data: Buffer
  filename: string
  mime: string
  imageCount: number
}

export async function processDeclarationUpload(files: Array<{ name: string; data: Buffer }>): Promise<ProcessedDeclaration> {
  if (!files.length) throw new Error('请选择图片或 ZIP 文件')
  const output: ZipEntry[] = []
  let imageCount = 0
  let archiveInput = false
  for (const file of files) {
    const isZip = /\.zip$/i.test(file.name) || file.data.subarray(0, 4).toString('binary') === 'PK\x03\x04'
    if (isZip) {
      archiveInput = true
      const prefix = files.length > 1 ? `${file.name.replace(/\.zip$/i, '')}/` : ''
      for (const entry of readZip(file.data)) {
        const kind = imageKind(entry.name, entry.data)
        const declared = kind ? await addDeclaration(entry.name, entry.data) : null
        if (declared) imageCount++
        output.push({ name: `${prefix}${kind ? normalizedJpegName(entry.name) : entry.name}`, data: declared || entry.data })
      }
    } else {
      const kind = imageKind(file.name, file.data)
      const declared = kind ? await addDeclaration(file.name, file.data) : null
      if (!declared || !kind) throw new Error(`不支持的图片格式：${file.name}（支持 JPG、PNG、WebP）`)
      imageCount++
      output.push({ name: safeZipName(normalizedJpegName(file.name)), data: declared })
    }
  }
  if (!imageCount) throw new Error('没有找到可处理的 JPG、PNG 或 WebP 图片')
  if (files.length === 1 && !archiveInput && output.length === 1) {
    const entry = output[0]
    return { data: entry.data, filename: entry.name, mime: 'image/jpeg', imageCount }
  }
  return { data: buildZip(output), filename: 'AI图片声明_已处理.zip', mime: 'application/zip', imageCount }
}
