const DEFAULT_MARKETPLACE_API_BASE_URL = 'https://api.dx-os.com'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_MS = 5 * 60 * 1000

export interface MarketplaceBanner {
  id: string
  tag: string
  title: string
  description: string
  imageUrl?: string
  appId?: string
  tone: 'blue' | 'green' | 'purple' | 'dark'
}

export interface MarketplaceAppSummary {
  id: string
  name: string
  category: 'software' | 'games'
  categoryIds: string[]
  subtitle: string
  summary: string
  iconUrl?: string
  coverImageUrl?: string
  tags: string[]
  featured: boolean
  version: string
  build: number
  channel: 'stable' | 'beta' | 'dev'
  packageSize: number
  publishedAt: number
}

export interface MarketplaceCategory {
  id: string
  name: string
  icon: string
  description: string
  count: number
}

export type MarketplaceSectionLayout = 'hero' | 'cards' | 'ranked' | 'compact' | 'grid'

export interface MarketplaceSectionItem {
  appId: string
  rank: number
  eyebrow: string
  headline: string
  summary: string
  imageUrl?: string
  tone?: MarketplaceBanner['tone']
  badge: string
  actionLabel: string
}

export interface MarketplaceSection {
  id: string
  collectionId: string
  title: string
  subtitle: string
  layout: MarketplaceSectionLayout
  categoryId?: string
  items: MarketplaceSectionItem[]
}

export interface MarketplaceExplorePayload {
  generatedAt: number
  page: { id: string; title: string }
  banners: MarketplaceBanner[]
  categories: MarketplaceCategory[]
  sections: MarketplaceSection[]
  apps: MarketplaceAppSummary[]
}

export interface MarketplaceAppDetailPayload {
  app: MarketplaceAppSummary & {
    descriptionMarkdown: string
    screenshots: string[]
    features: string[]
    publisherName: string
    websiteUrl?: string
    privacyUrl?: string
  }
  release: {
    id: string
    version: string
    build: number
    channel: 'stable' | 'beta' | 'dev'
    mandatory: boolean
    releaseNotes: string
    releaseNotesUrl?: string
    packageSize: number
    publishedAt: number
  }
}

let exploreCache: { at: number; payload: MarketplaceExplorePayload } | null = null
const detailCache = new Map<string, { at: number; payload: MarketplaceAppDetailPayload }>()

function apiBaseUrl() {
  const value = String(process.env.DX_MARKETPLACE_API_BASE_URL || DEFAULT_MARKETPLACE_API_BASE_URL).trim().replace(/\/+$/, '')
  const url = new URL(value)
  if (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))) return url.toString().replace(/\/+$/, '')
  throw new Error('应用市场内容服务只允许 HTTPS，开发环境可使用 localhost')
}

function stringValue(value: unknown, max = 500) { return String(value || '').trim().slice(0, max) }
function optionalUrl(value: unknown) {
  const text = stringValue(value, 2048)
  if (!text) return undefined
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) ? url.toString() : undefined
  } catch { return undefined }
}
function stringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return value.map((item) => stringValue(item, 2048)).filter(Boolean).slice(0, limit)
}
function channel(value: unknown): 'stable' | 'beta' | 'dev' { return value === 'beta' || value === 'dev' ? value : 'stable' }
function category(value: unknown): 'software' | 'games' { return value === 'games' ? 'games' : 'software' }
function identifier(value: unknown, max = 120) {
  const text = stringValue(value, max)
  return /^[a-zA-Z0-9._-]+$/.test(text) ? text : ''
}

async function request(path: string) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`应用市场内容服务返回 HTTP ${response.status}`)
  return response.json() as Promise<Record<string, unknown>>
}

function normalizeApp(value: unknown): MarketplaceAppSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = stringValue(item.id, 120)
  const name = stringValue(item.name, 120)
  const version = stringValue(item.version, 64)
  const build = Number(item.build)
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || !name || !version || !Number.isSafeInteger(build) || build < 1) return null
  return {
    id, name,
    category: category(item.category),
    categoryIds: [...new Set(stringArray(item.categoryIds, 30).map((value) => identifier(value)).filter(Boolean))],
    subtitle: stringValue(item.subtitle, 160),
    summary: stringValue(item.summary, 800),
    iconUrl: optionalUrl(item.iconUrl),
    coverImageUrl: optionalUrl(item.coverImageUrl),
    tags: stringArray(item.tags, 12),
    featured: item.featured === true,
    version, build,
    channel: channel(item.channel),
    packageSize: Math.max(0, Math.round(Number(item.packageSize) || 0)),
    publishedAt: Math.max(0, Math.round(Number(item.publishedAt) || 0)),
  }
}

export async function marketplaceExplore(force = false): Promise<MarketplaceExplorePayload> {
  if (!force && exploreCache && Date.now() - exploreCache.at < CACHE_MS) return exploreCache.payload
  const raw = await request('/v1/market/explore')
  const apps = (Array.isArray(raw.apps) ? raw.apps : []).map(normalizeApp).filter((item): item is MarketplaceAppSummary => !!item)
  const banners = (Array.isArray(raw.banners) ? raw.banners : []).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const item = value as Record<string, unknown>
    const id = stringValue(item.id, 120)
    const title = stringValue(item.title, 180)
    if (!id || !title) return []
    const tone: MarketplaceBanner['tone'] = item.tone === 'green' || item.tone === 'purple' || item.tone === 'dark' ? item.tone : 'blue'
    return [{ id, tag: stringValue(item.tag, 60), title, description: stringValue(item.description, 500), imageUrl: optionalUrl(item.imageUrl), appId: stringValue(item.appId, 120) || undefined, tone }]
  })
  for (const app of apps) if (!app.categoryIds.length) app.categoryIds = [app.category]
  const counts = new Map<string, number>()
  for (const app of apps) for (const id of app.categoryIds) counts.set(id, (counts.get(id) || 0) + 1)
  const categories = (Array.isArray(raw.categories) ? raw.categories : []).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const item = value as Record<string, unknown>
    const id = identifier(item.id)
    const name = stringValue(item.name, 80)
    if (!id || !name || ['all', 'updates', 'developer', 'system'].includes(id)) return []
    return [{
      id,
      name,
      icon: stringValue(item.icon, 12),
      description: stringValue(item.description, 240),
      count: Math.max(0, Math.round(Number(item.count) || counts.get(id) || 0)),
    }]
  })
  if (!categories.length) categories.push(
    { id: 'software', name: '普通软件', icon: '▦', description: '', count: counts.get('software') || 0 },
    { id: 'games', name: '游戏', icon: '◈', description: '', count: counts.get('games') || 0 },
  )
  const appIds = new Set(apps.map((app) => app.id))
  const sections: MarketplaceSection[] = (Array.isArray(raw.sections) ? raw.sections : []).flatMap((value): MarketplaceSection[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const item = value as Record<string, unknown>
    const id = identifier(item.id)
    const collectionId = identifier(item.collectionId)
    const layout: MarketplaceSectionLayout | '' = item.layout === 'hero' || item.layout === 'cards' || item.layout === 'ranked' || item.layout === 'compact' || item.layout === 'grid' ? item.layout : ''
    if (!id || !collectionId || !layout) return []
    const items: MarketplaceSectionItem[] = (Array.isArray(item.items) ? item.items : []).flatMap((value, index): MarketplaceSectionItem[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const row = value as Record<string, unknown>
      const appId = identifier(row.appId)
      if (!appId || !appIds.has(appId)) return []
      const tone: MarketplaceBanner['tone'] | undefined = row.tone === 'blue' || row.tone === 'green' || row.tone === 'purple' || row.tone === 'dark' ? row.tone : undefined
      return [{
        appId,
        rank: Math.max(1, Math.round(Number(row.rank) || index + 1)),
        eyebrow: stringValue(row.eyebrow, 80),
        headline: stringValue(row.headline, 180),
        summary: stringValue(row.summary, 600),
        imageUrl: optionalUrl(row.imageUrl),
        tone,
        badge: stringValue(row.badge, 60),
        actionLabel: stringValue(row.actionLabel, 40),
      }]
    })
    if (!items.length) return []
    return [{
      id,
      collectionId,
      title: stringValue(item.title, 120),
      subtitle: stringValue(item.subtitle, 240),
      layout,
      categoryId: identifier(item.categoryId) || undefined,
      items,
    }]
  })
  if (!sections.length) {
    const heroItems = banners.flatMap((banner, index) => banner.appId && appIds.has(banner.appId) ? [{ appId: banner.appId, rank: index + 1, eyebrow: banner.tag, headline: banner.title, summary: banner.description, imageUrl: banner.imageUrl, tone: banner.tone, badge: '', actionLabel: '查看详情' }] : [])
    const featuredItems = apps.filter((app) => app.featured).map((app, index) => ({ appId: app.id, rank: index + 1, eyebrow: '', headline: '', summary: '', badge: '推荐', actionLabel: '' }))
    const allItems = apps.map((app, index) => ({ appId: app.id, rank: index + 1, eyebrow: '', headline: '', summary: '', badge: '', actionLabel: '' }))
    if (heroItems.length) sections.push({ id: 'legacy-hero', collectionId: 'legacy-hero', title: '', subtitle: '', layout: 'hero', items: heroItems })
    if (featuredItems.length) sections.push({ id: 'legacy-featured', collectionId: 'legacy-featured', title: '为你推荐', subtitle: '最近值得试试的应用', layout: 'cards', items: featuredItems })
    if (allItems.length) sections.push({ id: 'legacy-all', collectionId: 'legacy-all', title: '全部应用', subtitle: '浏览所有已发布应用', layout: 'grid', items: allItems })
  }
  const pageRaw = raw.page && typeof raw.page === 'object' && !Array.isArray(raw.page) ? raw.page as Record<string, unknown> : {}
  const payload: MarketplaceExplorePayload = {
    generatedAt: Math.max(0, Math.round(Number(raw.generatedAt) || Date.now())),
    page: { id: identifier(pageRaw.id) || 'explore', title: stringValue(pageRaw.title, 120) || '探索' },
    banners,
    categories,
    sections,
    apps,
  }
  exploreCache = { at: Date.now(), payload }
  return payload
}

export async function marketplaceAppDetail(appId: string, force = false): Promise<MarketplaceAppDetailPayload> {
  if (!/^[a-zA-Z0-9._-]+$/.test(appId)) throw new Error('APP ID 不合法')
  const cached = detailCache.get(appId)
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.payload
  const raw = await request(`/v1/market/apps/${encodeURIComponent(appId)}`)
  const appRaw = raw.app && typeof raw.app === 'object' && !Array.isArray(raw.app) ? raw.app as Record<string, unknown> : {}
  const releaseRaw = raw.release && typeof raw.release === 'object' && !Array.isArray(raw.release) ? raw.release as Record<string, unknown> : {}
  // Release 也有自己的 id（并且允许包含 `+` 等版本字符），不能覆盖 APP id。
  // 详情摘要只从 release 提取版本字段，其余身份与展示字段始终来自 app。
  const summary = normalizeApp({
    ...appRaw,
    version: releaseRaw.version,
    build: releaseRaw.build,
    channel: releaseRaw.channel,
    packageSize: releaseRaw.packageSize,
    publishedAt: releaseRaw.publishedAt,
  })
  if (!summary) throw new Error('应用市场返回了无效的 APP 详情')
  const payload: MarketplaceAppDetailPayload = {
    app: {
      ...summary,
      descriptionMarkdown: stringValue(appRaw.descriptionMarkdown, 40_000),
      screenshots: stringArray(appRaw.screenshots, 12).map(optionalUrl).filter((item): item is string => !!item),
      features: stringArray(appRaw.features, 20),
      publisherName: stringValue(appRaw.publisherName, 120) || 'DX OS',
      websiteUrl: optionalUrl(appRaw.websiteUrl),
      privacyUrl: optionalUrl(appRaw.privacyUrl),
    },
    release: {
      id: stringValue(releaseRaw.id, 120),
      version: summary.version,
      build: summary.build,
      channel: summary.channel,
      mandatory: releaseRaw.mandatory === true,
      releaseNotes: stringValue(releaseRaw.releaseNotes, 8_000),
      releaseNotesUrl: optionalUrl(releaseRaw.releaseNotesUrl),
      packageSize: summary.packageSize,
      publishedAt: summary.publishedAt,
    },
  }
  detailCache.set(appId, { at: Date.now(), payload })
  return payload
}
