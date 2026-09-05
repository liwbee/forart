import { inflateRawSync } from 'node:zlib'
import { saveCustomSkill, type SkillDef, type SkillSourceSnapshot } from './skills.ts'

const MAX_PACKAGE_BYTES = 32 * 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED_BYTES = 48 * 1024 * 1024
const MAX_TEXT_ENTRY_BYTES = 384 * 1024
const MAX_SOURCE_TEXT_BYTES = 2 * 1024 * 1024

export interface SkillImportCandidate {
  id: string
  name: string
  description: string
  systemPrompt: string
  sourcePath: string
}

interface SkillFrontmatter {
  name?: string
  description?: string
}

function fail(message: string): never { throw new Error(`Skill 导入失败：${message}`) }
function u16(buf: Buffer, offset: number) { return buf.readUInt16LE(offset) }
function u32(buf: Buffer, offset: number) { return buf.readUInt32LE(offset) }

/** 只读取标准 Skill 的文本资料，不把压缩包写入磁盘或执行其中任何文件。 */
function readSkillTexts(buffer: Buffer) {
  if (buffer.length > MAX_PACKAGE_BYTES) fail('压缩包不能超过 32 MB')
  const searchFrom = Math.max(0, buffer.length - 65_557)
  let eocd = -1
  for (let i = buffer.length - 22; i >= searchFrom; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) fail('不是有效的 ZIP 文件')
  const entryCount = u16(buffer, eocd + 10)
  const centralOffset = u32(buffer, eocd + 16)
  if (!entryCount || entryCount > 512 || centralOffset >= buffer.length) fail('压缩包目录无效')

  const entries = new Map<string, string>()
  let totalUncompressed = 0
  let pos = centralOffset
  for (let index = 0; index < entryCount; index++) {
    if (pos + 46 > buffer.length || u32(buffer, pos) !== 0x02014b50) fail('压缩包目录损坏')
    const compression = u16(buffer, pos + 10)
    const compressedSize = u32(buffer, pos + 20)
    const uncompressedSize = u32(buffer, pos + 24)
    const filenameSize = u16(buffer, pos + 28)
    const extraSize = u16(buffer, pos + 30)
    const commentSize = u16(buffer, pos + 32)
    const localOffset = u32(buffer, pos + 42)
    const end = pos + 46 + filenameSize + extraSize + commentSize
    if (end > buffer.length) fail('压缩包目录不完整')
    const name = buffer.subarray(pos + 46, pos + 46 + filenameSize).toString('utf8').replace(/\\/g, '/')
    pos = end
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) fail('解压总内容超出限制')
    const isRootManifest = name === 'skill.json'
    const isSkillText = /\.(md|txt|ya?ml|json)$/i.test(name)
    if (!isRootManifest && !isSkillText) continue
    if (uncompressedSize > MAX_TEXT_ENTRY_BYTES || compressedSize > MAX_TEXT_ENTRY_BYTES) fail(`说明文件过大：${name}`)
    if (localOffset + 30 > buffer.length || u32(buffer, localOffset) !== 0x04034b50) fail(`文件头损坏：${name}`)
    const localNameSize = u16(buffer, localOffset + 26)
    const localExtraSize = u16(buffer, localOffset + 28)
    const dataStart = localOffset + 30 + localNameSize + localExtraSize
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) fail(`文件内容不完整：${name}`)
    const raw = buffer.subarray(dataStart, dataEnd)
    const content = compression === 0 ? raw : compression === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_TEXT_ENTRY_BYTES }) : fail('只支持标准 ZIP 的存储或 Deflate 压缩')
    entries.set(name, content.toString('utf8'))
  }
  return entries
}

function unquoteYaml(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  return trimmed
}

/** Agent Skills 只强制 name/description；这里有意做小而稳的 YAML 子集解析。 */
export function parseSkillFrontmatter(markdown: string): { metadata: SkillFrontmatter; body: string } {
  const match = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return { metadata: {}, body: markdown }
  const lines = match[1].split(/\r?\n/)
  const metadata: SkillFrontmatter = {}
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^(name|description):[ \t]*(.*)$/)
    if (!field) continue
    const key = field[1] as keyof SkillFrontmatter
    const value = field[2].trim()
    if (value === '|' || value === '>') {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) block.push(lines[++i].trim())
      metadata[key] = value === '>' ? block.join(' ') : block.join('\n')
    } else if (value) metadata[key] = unquoteYaml(value)
  }
  return { metadata, body: markdown.slice(match[0].length) }
}

function openAiMetadata(entries: Map<string, string>, skillDir: string) {
  const yaml = entries.get(`${skillDir}agents/openai.yaml`) || entries.get(`${skillDir}agents/openai.yml`) || ''
  const implicit = yaml.match(/(?:^|\n)\s*allow_implicit_invocation:\s*(true|false)\s*(?:#.*)?(?:\n|$)/i)
  const display = yaml.match(/(?:^|\n)\s*display_name:\s*([^\r\n#]+)/i)
  return {
    ...(implicit ? { allowImplicitInvocation: implicit[1].toLowerCase() === 'true' } : {}),
    ...(display ? { displayName: unquoteYaml(display[1]) } : {}),
  }
}

function sourceFiles(entries: Map<string, string>, sourcePath: string) {
  const dir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : ''
  const instruction = entries.get(sourcePath) || ''
  const mentioned = new Set(
    [...instruction.matchAll(/(?:references|assets)\/[A-Za-z0-9._/-]+/g)].map((match) => match[0].replace(/[),.;:'"`]+$/, '')),
  )
  const candidates = [...entries.entries()]
    .filter(([path]) => path !== sourcePath && path.startsWith(dir))
    .map(([path, content]) => ({ path: path.slice(dir.length), content }))
    .sort((a, b) => Number(mentioned.has(b.path)) - Number(mentioned.has(a.path)) || a.path.localeCompare(b.path))
  const files: Array<{ path: string; content: string }> = []
  let bytes = 0
  for (const file of candidates) {
    const size = Buffer.byteLength(file.content, 'utf8')
    if (bytes + size > MAX_SOURCE_TEXT_BYTES) continue
    files.push(file)
    bytes += size
  }
  return files
}

function cleanName(path: string) {
  return path.split('/').filter(Boolean).at(-2)?.replace(/[-_]+/g, ' ').trim() || '功能 Skill'
}
function summary(markdown: string, fallback: string, preferBodyTitle = false) {
  const parsed = parseSkillFrontmatter(markdown)
  const lines = parsed.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const firstTitle = lines.find((line) => /^#\s+/.test(line))?.replace(/^#+\s*/, '').trim()
  const firstText = lines.find((line) => !/^#|^```|^[-*]\s|^>/.test(line) && line.length > 12)
  return {
    name: (preferBodyTitle ? firstTitle || parsed.metadata.name : parsed.metadata.name || firstTitle) || fallback,
    description: (parsed.metadata.description || firstText || fallback).slice(0, 180),
  }
}
function slug(sourcePath: string, index: number) {
  const base = sourcePath.split('/').filter(Boolean).at(-2) || `skill_${index + 1}`
  const normalized = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(normalized) ? normalized.slice(0, 48) : `skill_${index + 1}`
}

export function previewSkillPackage(buffer: Buffer): SkillImportCandidate[] {
  const entries = readSkillTexts(buffer)
  const manifestText = entries.get('skill.json')
  if (manifestText && entries.has('SKILL.md')) {
    let manifest: Partial<SkillDef> & { format?: unknown }
    try { manifest = JSON.parse(manifestText) as Partial<SkillDef> & { format?: unknown } } catch { fail('skill.json 不是有效 JSON') }
    if (manifest.format !== 'ccs-skill/v1') fail('不支持的 Skill 包格式')
    if (manifest.kind && manifest.kind !== 'text') fail('第一版只允许导入文本型功能 Skill')
    const systemPrompt = String(manifest.systemPrompt || '').trim()
    if (!systemPrompt) fail('skill.json 缺少 systemPrompt')
    return [{ id: String(manifest.id || ''), name: String(manifest.name || ''), description: String(manifest.description || ''), systemPrompt, sourcePath: 'SKILL.md' }]
  }

  const skillFiles = [...entries.entries()].filter(([path]) => /(^|\/)SKILL\.md$/i.test(path))
  if (!skillFiles.length) fail('未找到可导入的 SKILL.md；标准包需包含 skill.json 和 SKILL.md')
  return skillFiles.slice(0, 24).map(([sourcePath, markdown], index) => {
    const localizedPath = sourcePath.replace(/SKILL\.md$/i, 'SKILL.cn.md')
    const localized = entries.get(localizedPath)
    const info = localized
      ? summary(localized, cleanName(sourcePath), true)
      : summary(markdown, cleanName(sourcePath))
    return { id: slug(sourcePath, index), name: info.name, description: info.description, systemPrompt: markdown, sourcePath }
  })
}

export function importSkillPackage(
  buffer: Buffer,
  options: { idPrefix?: string; packId?: string; packName?: string } = {},
) {
  const candidates = previewSkillPackage(buffer)
  if (!candidates.length) fail('压缩包内没有可导入的 Skill')
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) fail(`多个 Skill 生成了相同 ID：${candidate.id}`)
    seen.add(candidate.id)
  }
  const skills = candidates.map((candidate) => {
    const doc = skillDocumentFromPackage(buffer, candidate.sourcePath)
    const id = options.idPrefix ? `${options.idPrefix}_${candidate.id}`.slice(0, 64) : candidate.id
    return saveCustomSkill({
      ...candidate,
      id,
      // 完整包路由同时注入同目录 references，让被 AI 选中后能按原始资料执行。
      ...(options.packId ? { systemPrompt: doc.markdown.slice(0, 64_000) } : {}),
      source: {
        ...doc.source,
        metadata: {
          ...doc.source.metadata,
          ...(options.packId ? { packId: options.packId } : {}),
          ...(options.packName ? { packName: options.packName } : {}),
        },
      },
      ...(typeof doc.allowImplicitInvocation === 'boolean'
        ? { allowImplicitInvocation: doc.allowImplicitInvocation }
        : {}),
    })
  })
  return {
    skills,
    ...(skills.length === 1 ? { skill: skills[0], readme: candidates[0].systemPrompt } : {}),
  }
}

/** Agent 解析路径：取包内指定（或唯一）SKILL.md，并带上同目录的参考文档（模板/参数表常拆在别的 md 里）。 */
export function skillDocumentFromPackage(buffer: Buffer, sourcePath?: string) {
  const candidates = previewSkillPackage(buffer)
  const chosen = sourcePath ? candidates.find((c) => c.sourcePath === sourcePath) : candidates.length === 1 ? candidates[0] : undefined
  if (!chosen) fail(candidates.length > 1 ? '包内有多个 Skill，请指定 sourcePath' : '未找到可解析的 SKILL.md')
  const entries = readSkillTexts(buffer)
  const dir = chosen.sourcePath.includes('/') ? chosen.sourcePath.slice(0, chosen.sourcePath.lastIndexOf('/') + 1) : ''
  const parsed = parseSkillFrontmatter(chosen.systemPrompt)
  const openai = openAiMetadata(entries, dir)
  const files = sourceFiles(entries, chosen.sourcePath)
  // 被 SKILL.md 点名的资料优先，保证大包截断时核心 references 仍进入分析上下文。
  const siblings = files
    .filter((file) => /\.(md|txt)$/i.test(file.path))
    .slice(0, 24)
    .map((file) => `\n\n===== 参考文件：${file.path} =====\n${file.content}`)
    .join('')
  const source: SkillSourceSnapshot = {
    format: 'agentskills/v1',
    sourcePath: chosen.sourcePath,
    instructions: chosen.systemPrompt,
    files,
    metadata: {
      ...parsed.metadata,
      ...(openai.displayName ? { displayName: openai.displayName } : {}),
    },
  }
  return {
    markdown: chosen.systemPrompt + siblings,
    sourcePath: chosen.sourcePath,
    fallback: chosen,
    source,
    allowImplicitInvocation: openai.allowImplicitInvocation,
  }
}
