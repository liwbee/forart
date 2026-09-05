import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import { createNode, ensureCanvasRoot, ensureFolder, findByPath, getNode, isInTrash, listChildren, readBlob, renameNode, saveBlob, setContent } from './fs.ts'
import { firstUsableProvider } from './store.ts'
import { callChat, editImages, generateImages, type EditImageInput, type GenImage, type ResolvedProvider } from './protocols.ts'

const DATA_DIR = DATA_ROOT
const FILE = dataPath('short-drama-projects.json')

export type DramaStage = 'script' | 'design' | 'storyboard' | 'generate' | 'timeline'
export interface DramaShot {
  id: string
  episodeId?: string
  title: string
  scene: string
  script?: string
  characterIds?: string[]
  prompt: string
  duration: number
  imageStatus: 'idle' | 'queued' | 'ready'
  videoStatus: 'idle' | 'queued' | 'ready'
  images: DramaImage[]
  selectedImageId?: string
}
export interface DramaImage {
  id: string
  nodeId: string
  url: string
  prompt: string
  kind: 'generated' | 'edited'
  createdAt: number
}
export interface DramaEpisode {
  id: string
  number: number
  title: string
  summary: string
  hook: string
  characterNames?: string[]
  locationNames?: string[]
}
export interface DramaBlueprint {
  logline: string
  tone: string
  episodes: DramaEpisode[]
  generatedAt: number
  provider: string
  model: string
}
export interface DramaCharacterDesign {
  id: string
  name: string
  role: string
  appearance: string
  costume: string
  signature: string
  images: DramaImage[]
  selectedImageId?: string
}
export interface DramaLocationDesign {
  id: string
  name: string
  atmosphere: string
  visual: string
  props: string
  images: DramaImage[]
  selectedImageId?: string
}
export interface DramaVisualDesign {
  style: string
  characters: DramaCharacterDesign[]
  locations: DramaLocationDesign[]
  generatedAt: number
  provider: string
  model: string
}
export interface DramaProject {
  id: string
  name: string
  folderId: string
  folders: Record<string, string>
  createdAt: number
  updatedAt: number
  stage: DramaStage
  sourceText: string
  shots: DramaShot[]
  blueprint?: DramaBlueprint
  visualDesign?: DramaVisualDesign
}

function load(): DramaProject[] {
  try {
    const items = JSON.parse(readFileSync(FILE, 'utf8')) as DramaProject[]
    return Array.isArray(items) ? items.map((item) => ({
      ...item,
      shots: Array.isArray(item.shots) ? item.shots.map((shot) => ({ ...shot, characterIds: Array.isArray(shot.characterIds) ? shot.characterIds : [], images: Array.isArray(shot.images) ? shot.images : [] })) : [],
      visualDesign: item.visualDesign ? {
        ...item.visualDesign,
        characters: Array.isArray(item.visualDesign.characters) ? item.visualDesign.characters.map((character) => ({ ...character, images: Array.isArray(character.images) ? character.images : [] })) : [],
        locations: Array.isArray(item.visualDesign.locations) ? item.visualDesign.locations.map((location) => ({ ...location, images: Array.isArray(location.images) ? location.images : [] })) : [],
      } : undefined,
    })) : []
  } catch { return [] }
}
function save(projects: DramaProject[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(projects, null, 2), 'utf8')
}
function find(projects: DramaProject[], id: string) {
  const project = projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  const folder = getNode(project.folderId)
  if (!folder || isInTrash(project.folderId)) throw new Error('项目文件夹已删除，请先从废纸篓恢复')
  return project
}
function touch(project: DramaProject) { project.updatedAt = Date.now() }

function syncProjectFile(project: DramaProject, path: string, content: string) {
  const existing = findByPath(project.folderId, path)
  if (existing) setContent(existing.id, content)
  else {
    const parts = path.split('/')
    const name = parts.pop() || 'untitled.txt'
    let parentId = project.folderId
    for (const part of parts) parentId = ensureFolder(part, parentId)
    createNode({ name, type: 'file', parentId, content })
  }
}

function jsonFromModel(text: string): Record<string, unknown> {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回可识别的项目数据')
  try { return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown> } catch { throw new Error('模型返回的项目数据格式不正确，请重试') }
}

function safeText(value: unknown, limit: number) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit) }

function resolveModel() {
  const provider = firstUsableProvider('llm')
  if (!provider) throw new Error('请先在「API 设置」中配置并启用一个语言模型，再使用 AI 生产流程。')
  const model = provider.models.find((item) => item.caps.includes('llm'))?.model
  if (!model) throw new Error('当前语言模型站点没有可用模型。')
  return { provider, model, resolved: { base_url: provider.base_url, api_key: provider.api_key, protocol: provider.protocol } as ResolvedProvider }
}

function resolveImageModel() {
  const provider = firstUsableProvider('image')
  if (!provider) throw new Error('请先在「API 设置」中配置并启用一个图像模型，再生成分镜图。')
  const entry = provider.models.find((item) => item.caps.includes('image'))
  const model = entry?.model
  if (!model) throw new Error('当前图像站点没有可用图像模型。')
  return { provider, model, resolved: { base_url: provider.base_url, api_key: provider.api_key, protocol: entry.protocol || provider.protocol } as ResolvedProvider }
}

function imagePrompt(project: DramaProject, shot: DramaShot) {
  const visual = project.visualDesign
  const characterGuide = visual?.characters.map((item) => `${item.name}：${item.appearance}；服装：${item.costume}`).join('\n') || ''
  return [
    '竖屏短剧高质量分镜关键帧，9:16 画幅，电影感构图，人物与服装在后续镜头中必须保持一致。',
    visual?.style ? `总体影像风格：${visual.style}` : '',
    characterGuide ? `角色造型参考：\n${characterGuide}` : '',
    `镜头名称：${shot.title}`, shot.scene ? `场景：${shot.scene}` : '', `画面要求：${shot.prompt}`,
    '不要添加文字、水印、logo、边框或拼贴画面。',
  ].filter(Boolean).join('\n\n')
}

async function persistImages(project: DramaProject, owner: { images: DramaImage[]; selectedImageId?: string }, label: string, images: GenImage[], prompt: string, kind: DramaImage['kind'], folderName = 'frames') {
  const assetsId = project.folders.assets || ensureFolder('assets', project.folderId)
  project.folders.assets = assetsId
  const frameFolder = ensureFolder(folderName, assetsId)
  const saved: DramaImage[] = []
  for (const [index, image] of images.entries()) {
    let buf: Buffer
    let mime = 'image/png'
    if (image.type === 'b64') buf = Buffer.from(image.value, 'base64')
    else {
      const response = await fetch(image.value)
      if (!response.ok) throw new Error(`下载生成图片失败：HTTP ${response.status}`)
      mime = (response.headers.get('content-type') || '').split(';')[0].trim() || mime
      buf = Buffer.from(await response.arrayBuffer())
    }
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
    const node = createNode({ name: `${label.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30) || 'image'}-${Date.now()}-${index + 1}.${ext}`, type: 'file', parentId: frameFolder, mime, size: buf.length })
    saveBlob(node.id, buf)
    saved.push({ id: randomUUID(), nodeId: node.id, url: `/api/fs/raw/${node.id}`, prompt, kind, createdAt: Date.now() })
  }
  owner.images.push(...saved)
  owner.selectedImageId = saved.at(-1)?.id || owner.selectedImageId
  return saved
}

export function listDramaProjects() {
  return load()
    .filter((project) => !!getNode(project.folderId) && !isInTrash(project.folderId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function createDramaProject(name: string, ownerId?: string) {
  const title = String(name || '').trim().slice(0, 50)
  if (!title) throw new Error('请输入项目名称')
  const appRoot = ownerId ? ensureCanvasRoot(ownerId).id : null
  const appFolders = appRoot ? listChildren(appRoot).nodes.filter((node) => node.type === 'folder') : []
  const legacyRoot = appFolders.find((node) => node.name === '短剧项目')
  if (legacyRoot && !appFolders.some((node) => node.name === '短剧工坊')) renameNode(legacyRoot.id, '短剧工坊')
  const projectsRoot = ensureFolder('短剧工坊', appRoot, ownerId)
  const folderId = ensureFolder(title, projectsRoot, ownerId)
  const folders = {
    inputs: ensureFolder('inputs', folderId, ownerId),
    scripts: ensureFolder('scripts', folderId, ownerId),
    assets: ensureFolder('assets', folderId, ownerId),
    episodes: ensureFolder('episodes', folderId, ownerId),
    renders: ensureFolder('renders', folderId, ownerId),
  }
  const createdAt = Date.now()
  const project: DramaProject = { id: randomUUID(), name: title, folderId, folders, createdAt, updatedAt: createdAt, stage: 'script', sourceText: '', shots: [] }
  createNode({ name: 'project.json', type: 'file', parentId: folderId, content: JSON.stringify({ version: 1, projectId: project.id, name: project.name, createdAt }, null, 2) })
  const projects = load()
  projects.push(project)
  save(projects)
  return project
}

export function updateDramaProject(id: string, patch: Partial<Pick<DramaProject, 'stage' | 'sourceText' | 'blueprint' | 'visualDesign'>>) {
  const projects = load()
  const project = find(projects, id)
  if (patch.stage && ['script', 'design', 'storyboard', 'generate', 'timeline'].includes(patch.stage)) project.stage = patch.stage
  if (typeof patch.sourceText === 'string') {
    project.sourceText = patch.sourceText.slice(0, 200_000)
    syncProjectFile(project, 'scripts/source-script.txt', project.sourceText)
  }
  if (patch.blueprint && typeof patch.blueprint === 'object') {
    const source = patch.blueprint
    const episodes = Array.isArray(source.episodes) ? source.episodes.slice(0, 30).map((entry, index) => ({
      id: typeof entry?.id === 'string' ? entry.id : randomUUID(), number: index + 1,
      title: safeText(entry?.title, 60) || `第 ${index + 1} 集`, summary: safeText(entry?.summary, 900), hook: safeText(entry?.hook, 300),
      characterNames: Array.isArray(entry?.characterNames) ? entry.characterNames.slice(0, 20).map((name: unknown) => safeText(name, 60)).filter(Boolean) : [],
      locationNames: Array.isArray(entry?.locationNames) ? entry.locationNames.slice(0, 20).map((name: unknown) => safeText(name, 80)).filter(Boolean) : [],
    })) : []
    project.blueprint = { logline: safeText(source.logline, 500), tone: safeText(source.tone, 300), episodes, generatedAt: project.blueprint?.generatedAt || Date.now(), provider: project.blueprint?.provider || '手动编辑', model: project.blueprint?.model || '手动编辑' }
    syncProjectFile(project, 'scripts/story-blueprint.json', JSON.stringify(project.blueprint, null, 2))
  }
  if (patch.visualDesign && typeof patch.visualDesign === 'object') {
    const source = patch.visualDesign
    const existingCharacters = new Map((project.visualDesign?.characters || []).map((entry) => [entry.id, entry]))
    const existingLocations = new Map((project.visualDesign?.locations || []).map((entry) => [entry.id, entry]))
    const characters = Array.isArray(source.characters) ? source.characters.slice(0, 20).map((entry) => {
      const id = typeof entry?.id === 'string' ? entry.id : randomUUID()
      const previous = existingCharacters.get(id)
      return { id, name: safeText(entry?.name, 60) || '未命名角色', role: safeText(entry?.role, 180), appearance: safeText(entry?.appearance, 700), costume: safeText(entry?.costume, 700), signature: safeText(entry?.signature, 300), images: previous?.images || [], selectedImageId: previous?.selectedImageId }
    }) : []
    const locations = Array.isArray(source.locations) ? source.locations.slice(0, 20).map((entry) => {
      const id = typeof entry?.id === 'string' ? entry.id : randomUUID()
      const previous = existingLocations.get(id)
      return { id, name: safeText(entry?.name, 80) || '未命名场景', atmosphere: safeText(entry?.atmosphere, 400), visual: safeText(entry?.visual, 700), props: safeText(entry?.props, 400), images: previous?.images || [], selectedImageId: previous?.selectedImageId }
    }) : []
    project.visualDesign = { style: safeText(source.style, 700), characters, locations, generatedAt: project.visualDesign?.generatedAt || Date.now(), provider: project.visualDesign?.provider || '手动编辑', model: project.visualDesign?.model || '手动编辑' }
    syncProjectFile(project, 'assets/visual-bible.json', JSON.stringify(project.visualDesign, null, 2))
  }
  touch(project)
  save(projects)
  return project
}

export async function generateDramaOutline(id: string, episodeCount = 8) {
  const projects = load()
  const project = find(projects, id)
  const source = project.sourceText.trim()
  if (source.length < 30) throw new Error('请先输入至少一段剧情素材，再开始 AI 拆解。')
  const count = Math.max(1, Math.min(30, Number(episodeCount) || 8))
  const { provider, model, resolved } = resolveModel()
  const prompt = [
    '你是一名成熟的竖屏短剧总编剧。根据用户提供的原始素材，设计适合连续生产的短剧蓝图。',
    `规划 ${count} 集，每集必须有明确的冲突升级和结尾钩子。不要编造用户没有给出的关键人物关系。`,
    '只输出 JSON，不要 Markdown。结构必须是：{"logline":"一句话卖点","tone":"视觉与叙事基调","episodes":[{"number":1,"title":"集名","summary":"本集剧情","hook":"结尾钩子","characterNames":["本集出场角色"],"locationNames":["本集场景"]}]}。',
    `原始素材：\n${source.slice(0, 80_000)}`,
  ].join('\n\n')
  const response = await callChat(resolved, model, { prompt }, { temperature: 0.65, max_tokens: 6000 }, 180000)
  const data = jsonFromModel(response.text)
  const rawEpisodes = Array.isArray(data.episodes) ? data.episodes : []
  if (!rawEpisodes.length) throw new Error('模型没有生成分集内容，请重试或补充更具体的素材。')
  const episodes = rawEpisodes.slice(0, count).map((item, index) => {
    const row = item as Record<string, unknown>
    return {
      id: randomUUID(), number: index + 1,
      title: safeText(row.title, 60) || `第 ${index + 1} 集`,
      summary: safeText(row.summary, 900), hook: safeText(row.hook, 300),
      characterNames: Array.isArray(row.characterNames) ? row.characterNames.slice(0, 20).map((name) => safeText(name, 60)).filter(Boolean) : [],
      locationNames: Array.isArray(row.locationNames) ? row.locationNames.slice(0, 20).map((name) => safeText(name, 80)).filter(Boolean) : [],
    }
  })
  project.blueprint = { logline: safeText(data.logline, 500), tone: safeText(data.tone, 300), episodes, generatedAt: Date.now(), provider: provider.name, model }
  project.stage = 'design'
  touch(project)
  syncProjectFile(project, 'scripts/story-blueprint.json', JSON.stringify(project.blueprint, null, 2))
  save(projects)
  return project
}

export async function generateDramaVisualDesign(id: string) {
  const projects = load()
  const project = find(projects, id)
  if (!project.blueprint?.episodes.length) throw new Error('请先完成剧本拆解，生成分集集纲。')
  const { provider, model, resolved } = resolveModel()
  const prompt = [
    '你是短剧的美术指导、服装造型师和场景设计师。根据项目蓝图制定一份可直接交给分镜和图像生成的视觉设定。',
    '设计必须保持跨集一致性，服装要能区分人物身份与阵营；场景要注明氛围、空间结构、光线、主色和反复出现的关键道具。',
    '只输出 JSON，不要 Markdown。结构必须为：{"style":"总体影像风格","characters":[{"name":"人物名","role":"身份与戏剧功能","appearance":"年龄感、体态、五官、发型等外观","costume":"主服装、材质、配色、随剧情变化","signature":"辨识道具或动作细节"}],"locations":[{"name":"场景名","atmosphere":"氛围、光线、色调","visual":"空间、建筑、景别与画面要点","props":"关键道具与陈设"}]}。',
    `故事卖点：${project.blueprint.logline}\n叙事基调：${project.blueprint.tone}\n集纲：${JSON.stringify(project.blueprint.episodes.slice(0, 8))}`,
  ].join('\n\n')
  const response = await callChat(resolved, model, { prompt }, { temperature: 0.65, max_tokens: 7000 }, 180000)
  const data = jsonFromModel(response.text)
  const rawCharacters = Array.isArray(data.characters) ? data.characters : []
  const rawLocations = Array.isArray(data.locations) ? data.locations : []
  if (!rawCharacters.length && !rawLocations.length) throw new Error('模型没有生成可用的视觉设定，请重试。')
  project.visualDesign = {
    style: safeText(data.style, 700),
    characters: rawCharacters.slice(0, 12).map((item) => {
      const row = item as Record<string, unknown>
      return { id: randomUUID(), name: safeText(row.name, 60) || '未命名角色', role: safeText(row.role, 180), appearance: safeText(row.appearance, 700), costume: safeText(row.costume, 700), signature: safeText(row.signature, 300), images: [] }
    }),
    locations: rawLocations.slice(0, 12).map((item) => {
      const row = item as Record<string, unknown>
      return { id: randomUUID(), name: safeText(row.name, 80) || '未命名场景', atmosphere: safeText(row.atmosphere, 400), visual: safeText(row.visual, 700), props: safeText(row.props, 400), images: [] }
    }),
    generatedAt: Date.now(), provider: provider.name, model,
  }
  project.stage = 'storyboard'
  touch(project)
  syncProjectFile(project, 'assets/visual-bible.json', JSON.stringify(project.visualDesign, null, 2))
  save(projects)
  return project
}

function visualDesignImagePrompt(project: DramaProject, kind: 'character' | 'location', item: DramaCharacterDesign | DramaLocationDesign) {
  const style = project.visualDesign?.style || '高质量竖屏短剧，电影感写实影像'
  if (kind === 'character') {
    const character = item as DramaCharacterDesign
    return [
      '竖屏短剧角色服化道设定图，单人全身，干净的角色概念展示，写实电影质感，9:16 画幅。',
      `项目视觉风格：${style}`, `角色：${character.name}，${character.role}`, `外观：${character.appearance}`, `服装：${character.costume}`, `辨识细节：${character.signature}`,
      '保持人物形象稳定，不要文字、水印、logo、拼贴或多余人物。',
    ].filter(Boolean).join('\n\n')
  }
  const location = item as DramaLocationDesign
  return [
    '竖屏短剧场景概念图，空镜或少量远景人物，电影感写实影像，9:16 画幅。',
    `项目视觉风格：${style}`, `场景：${location.name}`, `氛围与光线：${location.atmosphere}`, `空间与画面：${location.visual}`, `关键道具：${location.props}`,
    '不要文字、水印、logo、边框或拼贴画面。',
  ].filter(Boolean).join('\n\n')
}

export async function generateVisualReferenceImage(id: string, kind: 'character' | 'location', itemId: string) {
  const projects = load()
  const project = find(projects, id)
  const design = project.visualDesign
  if (!design) throw new Error('请先生成视觉设定。')
  const items = kind === 'character' ? design.characters : design.locations
  const item = items.find((entry) => entry.id === itemId)
  if (!item) throw new Error(kind === 'character' ? '角色不存在' : '场景不存在')
  const { provider, model, resolved } = resolveImageModel()
  const prompt = visualDesignImagePrompt(project, kind, item)
  const { images } = await generateImages(resolved, model, { prompt, size: '1024x1536', n: 1 }, 300000)
  if (!images.length) throw new Error('图像模型未返回图片。')
  await persistImages(project, item, item.name, images, prompt, 'generated', kind === 'character' ? 'character-designs' : 'location-designs')
  touch(project)
  syncProjectFile(project, 'assets/visual-reference-manifest.json', JSON.stringify({ characters: design.characters.map((entry) => ({ id: entry.id, name: entry.name, selectedImageId: entry.selectedImageId, images: entry.images })), locations: design.locations.map((entry) => ({ id: entry.id, name: entry.name, selectedImageId: entry.selectedImageId, images: entry.images })) }, null, 2))
  save(projects)
  return { project, provider: provider.name, model }
}

export async function editVisualReferenceImage(id: string, kind: 'character' | 'location', itemId: string, imageId: string, instruction: string) {
  const projects = load()
  const project = find(projects, id)
  const design = project.visualDesign
  if (!design) throw new Error('请先生成视觉设定。')
  const items = kind === 'character' ? design.characters : design.locations
  const item = items.find((entry) => entry.id === itemId)
  if (!item) throw new Error(kind === 'character' ? '角色不存在' : '场景不存在')
  const source = item.images.find((entry) => entry.id === imageId)
  if (!source) throw new Error('找不到要修改的图片版本。')
  const note = String(instruction || '').trim().slice(0, 3000)
  if (!note) throw new Error('请说明希望怎样修改图片。')
  const node = getNode(source.nodeId)
  const buf = readBlob(source.nodeId)
  if (!node || !buf) throw new Error('原始图片文件不存在，无法修改。')
  const { provider, model, resolved } = resolveImageModel()
  const prompt = `${visualDesignImagePrompt(project, kind, item)}\n\n基于参考图修改：${note}\n保持未要求变化的角色设定、服装、场景和整体风格一致。`
  const input: EditImageInput = { buf, mime: node.mime || 'image/png', name: node.name || 'reference.png' }
  const { images } = await editImages(resolved, model, { prompt, size: '1024x1536', n: 1 }, [input], 300000)
  if (!images.length) throw new Error('图像模型未返回修改后的图片。')
  await persistImages(project, item, item.name, images, prompt, 'edited', kind === 'character' ? 'character-designs' : 'location-designs')
  touch(project)
  syncProjectFile(project, 'assets/visual-reference-manifest.json', JSON.stringify({ characters: design.characters.map((entry) => ({ id: entry.id, name: entry.name, selectedImageId: entry.selectedImageId, images: entry.images })), locations: design.locations.map((entry) => ({ id: entry.id, name: entry.name, selectedImageId: entry.selectedImageId, images: entry.images })) }, null, 2))
  save(projects)
  return { project, provider: provider.name, model }
}

export async function generateDramaStoryboards(id: string, episodeId?: string) {
  const projects = load()
  const project = find(projects, id)
  if (!project.blueprint?.episodes.length) throw new Error('请先完成剧本拆解，生成分集集纲。')
  if (!project.visualDesign) throw new Error('请先完成角色、服化道与场景的视觉设定。')
  const { provider, model, resolved } = resolveModel()
  const targetEpisodes = episodeId ? project.blueprint.episodes.filter((episode) => episode.id === episodeId) : project.blueprint.episodes
  if (!targetEpisodes.length) throw new Error('指定分集不存在。')
  const prompt = [
    `你是短剧分镜导演。根据下列项目蓝图，为${episodeId ? '指定的单集' : '全部剧集'}分别设计 4 到 8 个适合生成图像和视频的关键镜头。`,
    '每个镜头应独立、画面明确，持续 3 到 10 秒。prompt 必须是中文画面描述，含人物、场景、动作、镜头语言与光线，不要出现品牌或技术说明。',
    '只输出 JSON，不要 Markdown。结构：{"shots":[{"episodeNumber":1,"title":"镜头名","scene":"场景","script":"本镜头台词或动作脚本","characterNames":["出场角色"],"prompt":"画面提示词","duration":5}]}。',
    `故事卖点：${project.blueprint.logline}\n基调：${project.blueprint.tone}\n角色与场景视觉设定：${JSON.stringify(project.visualDesign)}\n目标集纲：${JSON.stringify(targetEpisodes)}`,
  ].join('\n\n')
  const response = await callChat(resolved, model, { prompt }, { temperature: 0.7, max_tokens: 7000 }, 180000)
  const data = jsonFromModel(response.text)
  const rawShots = Array.isArray(data.shots) ? data.shots : []
  if (!rawShots.length) throw new Error('模型没有生成可用分镜，请重试。')
  const generatedShots: DramaShot[] = rawShots.slice(0, episodeId ? 12 : 120).map((item, index) => {
    const row = item as Record<string, unknown>
    const episodeNumber = Math.max(1, Number(row.episodeNumber) || targetEpisodes[0].number)
    const episode = targetEpisodes.find((entry) => entry.number === episodeNumber) || targetEpisodes[0]
    const names = Array.isArray(row.characterNames) ? row.characterNames.map((name) => safeText(name, 60)).filter(Boolean) : []
    const characterIds = (project.visualDesign?.characters || []).filter((character) => names.includes(character.name)).map((character) => character.id)
    return {
      id: randomUUID(), episodeId: episode.id, title: safeText(row.title, 80) || `镜头 ${index + 1}`,
      scene: safeText(row.scene, 120), script: safeText(row.script, 4000), characterIds, prompt: safeText(row.prompt, 10_000),
      duration: Math.max(1, Math.min(30, Number(row.duration) || 5)), imageStatus: 'idle', videoStatus: 'idle', images: [],
    }
  })
  project.shots = episodeId ? [...project.shots.filter((shot) => shot.episodeId !== episodeId), ...generatedShots] : generatedShots
  project.stage = 'storyboard'
  touch(project)
  syncProjectFile(project, 'episodes/storyboards.json', JSON.stringify(project.shots, null, 2))
  save(projects)
  return project
}

export function addDramaShot(id: string, input: Partial<Omit<DramaShot, 'id' | 'imageStatus' | 'videoStatus'>>) {
  const projects = load()
  const project = find(projects, id)
  const shot: DramaShot = {
    id: randomUUID(), episodeId: typeof input.episodeId === 'string' ? input.episodeId : undefined, title: String(input.title || `镜头 ${project.shots.length + 1}`).trim().slice(0, 80),
    scene: String(input.scene || '').trim().slice(0, 120), script: String(input.script || '').trim().slice(0, 4000), characterIds: Array.isArray(input.characterIds) ? input.characterIds.slice(0, 20) : [], prompt: String(input.prompt || '').trim().slice(0, 10_000),
    duration: Math.max(1, Math.min(30, Number(input.duration) || 5)), imageStatus: 'idle', videoStatus: 'idle', images: [],
  }
  project.shots.push(shot)
  touch(project)
  save(projects)
  return shot
}

export function updateDramaShot(id: string, shotId: string, patch: Partial<Omit<DramaShot, 'id'>>) {
  const projects = load()
  const project = find(projects, id)
  const shot = project.shots.find((item) => item.id === shotId)
  if (!shot) throw new Error('分镜不存在')
  if (typeof patch.title === 'string') shot.title = patch.title.slice(0, 80)
  if (typeof patch.scene === 'string') shot.scene = patch.scene.slice(0, 120)
  if (typeof patch.episodeId === 'string') shot.episodeId = patch.episodeId
  if (typeof patch.script === 'string') shot.script = patch.script.slice(0, 4000)
  if (Array.isArray(patch.characterIds)) shot.characterIds = patch.characterIds.slice(0, 20)
  if (typeof patch.prompt === 'string') shot.prompt = patch.prompt.slice(0, 10_000)
  if (patch.duration !== undefined) shot.duration = Math.max(1, Math.min(30, Number(patch.duration) || 5))
  if (patch.imageStatus === 'idle' || patch.imageStatus === 'queued' || patch.imageStatus === 'ready') shot.imageStatus = patch.imageStatus
  if (patch.videoStatus === 'idle' || patch.videoStatus === 'queued' || patch.videoStatus === 'ready') shot.videoStatus = patch.videoStatus
  touch(project)
  save(projects)
  return shot
}

export async function generateDramaShotImage(id: string, shotId: string) {
  const projects = load()
  const project = find(projects, id)
  const shot = project.shots.find((item) => item.id === shotId)
  if (!shot) throw new Error('分镜不存在')
  if (!shot.prompt.trim()) throw new Error('请先补充镜头画面描述，再生成图片。')
  const { provider, model, resolved } = resolveImageModel()
  const prompt = imagePrompt(project, shot)
  const { images } = await generateImages(resolved, model, { prompt, size: '1024x1536', n: 1 }, 300000)
  if (!images.length) throw new Error('图像模型未返回图片。')
  await persistImages(project, shot, shot.title, images, prompt, 'generated')
  shot.imageStatus = 'ready'
  touch(project)
  syncProjectFile(project, 'assets/image-manifest.json', JSON.stringify(project.shots.map((item) => ({ shotId: item.id, title: item.title, selectedImageId: item.selectedImageId, images: item.images })), null, 2))
  save(projects)
  return { project, provider: provider.name, model }
}

export async function editDramaShotImage(id: string, shotId: string, imageId: string, instruction: string) {
  const projects = load()
  const project = find(projects, id)
  const shot = project.shots.find((item) => item.id === shotId)
  if (!shot) throw new Error('分镜不存在')
  const source = shot.images.find((item) => item.id === imageId)
  if (!source) throw new Error('找不到要修改的图片版本。')
  const note = String(instruction || '').trim().slice(0, 3000)
  if (!note) throw new Error('请说明希望怎样修改图片。')
  const node = getNode(source.nodeId)
  const buf = readBlob(source.nodeId)
  if (!node || !buf) throw new Error('原始图片文件不存在，无法修改。')
  const { provider, model, resolved } = resolveImageModel()
  const prompt = `${imagePrompt(project, shot)}\n\n基于参考图修改：${note}\n保持角色身份、服化道和场景连续性，除非修改要求明确改变。`
  const input: EditImageInput = { buf, mime: node.mime || 'image/png', name: node.name || 'reference.png' }
  const { images } = await editImages(resolved, model, { prompt, size: '1024x1536', n: 1 }, [input], 300000)
  if (!images.length) throw new Error('图像模型未返回修改后的图片。')
  await persistImages(project, shot, shot.title, images, prompt, 'edited')
  shot.imageStatus = 'ready'
  touch(project)
  syncProjectFile(project, 'assets/image-manifest.json', JSON.stringify(project.shots.map((item) => ({ shotId: item.id, title: item.title, selectedImageId: item.selectedImageId, images: item.images })), null, 2))
  save(projects)
  return { project, provider: provider.name, model }
}
