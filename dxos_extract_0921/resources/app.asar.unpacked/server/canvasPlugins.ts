import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { appReleaseKey } from '../shared/appLifecycle.ts'
import {
  CANVAS_PLUGIN_REGISTRY_FORMAT,
  type CanvasNodeManifest,
  type CanvasPluginRegistryEntry,
  type CanvasPluginRegistrySnapshot,
  type CanvasRegisteredTemplate,
  type CanvasTemplateManifest,
} from '../shared/canvasPlugin.ts'
import { CanvasNodeRegistry } from '../src/apps/canvas/canvasNodeRegistry.ts'
import { BUILTIN_CANVAS_NODES } from '../src/apps/canvas/builtinCanvasNodes.ts'
import { validateCanvasNodeManifest, validateCanvasTemplateManifest } from '../shared/canvasPluginValidation.ts'
import { dataPath } from './dataPaths.ts'
import { deleteDeveloperApp, developerAppSourceRoot, listDeveloperApps } from './developerApps.ts'

const PLUGIN_DATA_ROOT = dataPath('canvas-plugins')
const REGISTRY_FILE = resolve(PLUGIN_DATA_ROOT, 'registry.json')
const MAX_MANIFEST_BYTES = 256 * 1024

function safeManifestPath(root: string, path: string) {
  const target = resolve(root, path)
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`插件清单路径越界：${path}`)
  return target
}

function readNodeManifest(root: string, path: string, pluginId: string): CanvasNodeManifest {
  const target = safeManifestPath(root, path)
  if (!existsSync(target)) throw new Error(`节点清单不存在：${path}`)
  const content = readFileSync(target)
  if (content.length > MAX_MANIFEST_BYTES) throw new Error(`节点清单过大：${path}`)
  const value = JSON.parse(content.toString('utf8'))
  return validateCanvasNodeManifest(value, pluginId)
}
function readTemplateManifest(root: string, path: string, pluginId: string, definitions: readonly import('../shared/canvasPlugin.ts').CanvasNodeDefinition[]): CanvasTemplateManifest {
  const target = safeManifestPath(root, path)
  if (!existsSync(target)) throw new Error(`模板清单不存在：${path}`)
  const content = readFileSync(target)
  if (content.length > MAX_MANIFEST_BYTES) throw new Error(`模板清单过大：${path}`)
  return validateCanvasTemplateManifest(JSON.parse(content.toString('utf8')), pluginId, definitions)
}

function readSnapshot(): CanvasPluginRegistrySnapshot | null {
  try {
    const value = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')) as CanvasPluginRegistrySnapshot
    return value.format === CANVAS_PLUGIN_REGISTRY_FORMAT && Array.isArray(value.plugins) && Array.isArray(value.nodes) ? { ...value, templates: Array.isArray(value.templates) ? value.templates : [] } : null
  } catch { return null }
}

function writeSnapshot(snapshot: CanvasPluginRegistrySnapshot) {
  mkdirSync(dirname(REGISTRY_FILE), { recursive: true })
  const temporary = `${REGISTRY_FILE}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(snapshot, null, 2), 'utf8')
  renameSync(temporary, REGISTRY_FILE)
}

/**
 * Rebuilds the runtime registry exclusively from persistent developer-app installs.
 * No generated file is written into the replaceable Canvas application package.
 */
export function rebuildCanvasPluginRegistry(): CanvasPluginRegistrySnapshot {
  const previous = readSnapshot()
  const previousById = new Map((previous?.plugins || []).map((plugin) => [plugin.pluginId, plugin]))
  const registry = new CanvasNodeRegistry()
  const templates: CanvasRegisteredTemplate[] = []
  const plugins: CanvasPluginRegistryEntry[] = []
  const installedPluginIds = new Set<string>()

  for (const pack of listDeveloperApps()) {
    const declaration = pack.manifest.canvas
    if (!declaration) continue
    const pluginId = pack.manifest.id
    installedPluginIds.add(pluginId)
    const old = previousById.get(pluginId)
    const enabled = old?.enabled ?? true
    const entry: CanvasPluginRegistryEntry = {
      pluginId,
      appId: pack.id,
      name: pack.manifest.name,
      description: pack.manifest.description,
      releaseKey: appReleaseKey(pack.manifest),
      enabled,
      status: enabled ? 'active' : 'disabled',
      nodeTypes: [],
      nodeManifests: [...declaration.nodeManifests],
      templateManifests: [...declaration.templateManifests],
    }
    const pluginTemplates: CanvasRegisteredTemplate[] = []
    try {
      const sourceRoot = resolve(developerAppSourceRoot(pack.id))
      const pluginDefinitions: import('../shared/canvasPlugin.ts').CanvasNodeDefinition[] = []
      for (const manifestPath of declaration.nodeManifests) {
        const manifest = readNodeManifest(sourceRoot, manifestPath, pluginId)
        for (const node of manifest.nodes) {
          pluginDefinitions.push(node)
          if (enabled) registry.register(node, { kind: 'plugin', pluginId, releaseKey: entry.releaseKey })
          else {
            const validator = new CanvasNodeRegistry()
            validator.register(node, { kind: 'plugin', pluginId, releaseKey: entry.releaseKey })
          }
          entry.nodeTypes.push(node.type)
        }
      }
      for (const manifestPath of declaration.templateManifests) {
        const manifest = readTemplateManifest(sourceRoot, manifestPath, pluginId, [...BUILTIN_CANVAS_NODES, ...pluginDefinitions])
        pluginTemplates.push(...manifest.templates.map((template) => ({ ...template, owner: { kind: 'plugin' as const, pluginId, releaseKey: entry.releaseKey } })))
      }
      entry.nodeTypes = [...new Set(entry.nodeTypes)].sort()
      if (enabled) templates.push(...pluginTemplates)
    } catch (error) {
      registry.unregisterPlugin(pluginId)
      entry.status = 'incompatible'
      entry.error = String((error as Error).message || error).slice(0, 500)
    }
    plugins.push(entry)
  }

  // Keep a tombstone when an installation temporarily disappears. A host update
  // may not reinterpret that event as permission to uninstall or erase a plugin.
  for (const old of previous?.plugins || []) {
    if (installedPluginIds.has(old.pluginId)) continue
    plugins.push({ ...old, status: 'missing', nodeTypes: [], error: '插件安装记录暂不可用；代码与用户数据均未删除' })
  }

  const snapshot: CanvasPluginRegistrySnapshot = {
    format: CANVAS_PLUGIN_REGISTRY_FORMAT,
    updatedAt: Date.now(),
    plugins: plugins.sort((left, right) => left.pluginId.localeCompare(right.pluginId)),
    nodes: registry.list(),
    templates,
  }
  writeSnapshot(snapshot)
  return snapshot
}

export function getCanvasPluginRegistry() {
  const snapshot = readSnapshot()
  if (!snapshot) return rebuildCanvasPluginRegistry()
  const installed = listDeveloperApps().filter((pack) => !!pack.manifest.canvas)
  const activeById = new Map(snapshot.plugins.filter((plugin) => plugin.status !== 'missing').map((plugin) => [plugin.pluginId, plugin]))
  const stale = installed.length !== activeById.size || installed.some((pack) => activeById.get(pack.manifest.id)?.releaseKey !== appReleaseKey(pack.manifest))
  return stale ? rebuildCanvasPluginRegistry() : snapshot
}

export function setCanvasPluginEnabled(pluginId: string, enabled: boolean) {
  const snapshot = getCanvasPluginRegistry()
  const plugin = snapshot.plugins.find((item) => item.pluginId === pluginId)
  if (!plugin) throw new Error(`画布插件不存在：${pluginId}`)
  plugin.enabled = enabled
  writeSnapshot(snapshot)
  return rebuildCanvasPluginRegistry()
}

/** Intentionally uninstalls plugin code while preserving per-user plugin data. */
export function deleteCanvasPlugin(pluginId: string) {
  const pack = listDeveloperApps().find((item) => item.manifest.id === pluginId && !!item.manifest.canvas)
  const previous = readSnapshot()
  const recorded = previous?.plugins.find((item) => item.pluginId === pluginId)
  if (!pack && !recorded) throw new Error(`画布插件不存在：${pluginId}`)
  if (pack && !deleteDeveloperApp(pack.id)) throw new Error(`画布插件卸载失败：${pluginId}`)
  // Remove the previous entry first so rebuild does not mistake an intentional
  // uninstall for a temporarily missing installation and create a tombstone.
  if (previous) {
    writeSnapshot({
      ...previous,
      updatedAt: Date.now(),
      plugins: previous.plugins.filter((item) => item.pluginId !== pluginId),
      nodes: previous.nodes.filter((item) => item.owner.kind !== 'plugin' || item.owner.pluginId !== pluginId),
      templates: previous.templates.filter((item) => item.owner.kind !== 'plugin' || item.owner.pluginId !== pluginId),
    })
  }
  return { appId: pack?.id || recorded!.appId, registry: rebuildCanvasPluginRegistry() }
}

export function canvasPluginDataRoot(pluginId: string, userId: string) {
  const safePluginId = pluginId.replace(/[^a-z0-9-]/gi, '-')
  const safeUserId = userId.replace(/[^a-z0-9._-]/gi, '-')
  const target = resolve(PLUGIN_DATA_ROOT, 'data', safeUserId, safePluginId)
  if (relative(PLUGIN_DATA_ROOT, target).startsWith('..')) throw new Error('插件数据路径越界')
  return target
}

function canvasPluginStorageLimit(pluginId: string) {
  const snapshot = getCanvasPluginRegistry()
  const plugin = snapshot.plugins.find((item) => item.pluginId === pluginId)
  if (!plugin || !plugin.enabled || plugin.status !== 'active') throw new Error('插件未安装、未启用或不兼容')
  const limits = snapshot.nodes
    .filter((node) => node.owner.kind === 'plugin' && node.owner.pluginId === pluginId && node.host?.storage?.enabled)
    .map((node) => node.host?.storage?.maxBytes || 1024 * 1024)
  if (!limits.length) throw new Error('插件 Manifest 没有声明 host.storage.enabled')
  return Math.min(...limits)
}

function canvasPluginDataFile(pluginId: string, userId: string, key: string) {
  const safeKey = String(key || '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(safeKey) || safeKey.includes('..')) throw new Error('插件数据 key 不合法')
  const root = canvasPluginDataRoot(pluginId, userId)
  const target = resolve(root, `${safeKey}.json`)
  if (relative(root, target).startsWith('..')) throw new Error('插件数据路径越界')
  return { root, target, key: safeKey }
}

export function accessCanvasPluginData(pluginId: string, userId: string, request: { action?: unknown; key?: unknown; value?: unknown }) {
  const limit = canvasPluginStorageLimit(pluginId)
  const action = String(request.action || '')
  const root = canvasPluginDataRoot(pluginId, userId)
  if (action === 'list') {
    if (!existsSync(root)) return { keys: [] }
    return { keys: readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name.slice(0, -5)).sort() }
  }
  const file = canvasPluginDataFile(pluginId, userId, String(request.key || ''))
  if (action === 'get') {
    if (!existsSync(file.target)) return { key: file.key, exists: false, value: null }
    const content = readFileSync(file.target)
    if (content.length > limit) throw new Error('插件数据超过声明的容量限制')
    return { key: file.key, exists: true, value: JSON.parse(content.toString('utf8')) }
  }
  if (action === 'delete') {
    if (existsSync(file.target)) unlinkSync(file.target)
    return { key: file.key, deleted: true }
  }
  if (action === 'set') {
    const content = Buffer.from(JSON.stringify(request.value ?? null), 'utf8')
    if (content.length > limit) throw new Error(`插件数据超过容量限制（${limit} bytes）`)
    mkdirSync(file.root, { recursive: true })
    const temporary = `${file.target}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporary, content)
    renameSync(temporary, file.target)
    return { key: file.key, saved: true, bytes: content.length }
  }
  throw new Error('插件数据 action 只支持 get、set、delete、list')
}
