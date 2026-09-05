import type { CanvasNodeDefinition, CanvasRegisteredNode } from '../../../shared/canvasPlugin'
import { registerBuiltinCanvasNodes } from './builtinCanvasNodes'

function assertNodeType(type: string, owner: CanvasRegisteredNode['owner']) {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(type)) throw new Error(`画布节点类型不合法：${type}`)
  if (owner.kind === 'builtin' && !type.startsWith('builtin.')) throw new Error(`内置节点必须使用 builtin.* 命名空间：${type}`)
  if (owner.kind === 'plugin' && !type.startsWith(`${owner.pluginId}.`)) throw new Error(`插件节点必须使用 ${owner.pluginId}.* 命名空间：${type}`)
}

function assertDefinition(definition: CanvasNodeDefinition) {
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) throw new Error(`${definition.type} 的 version 必须是正整数`)
  if (!Number.isSafeInteger(definition.stateVersion) || definition.stateVersion < 1) throw new Error(`${definition.type} 的 stateVersion 必须是正整数`)
  if (!definition.title.trim()) throw new Error(`${definition.type} 缺少标题`)
  if (!Number.isFinite(definition.defaultSize.width) || !Number.isFinite(definition.defaultSize.height)) throw new Error(`${definition.type} 的默认尺寸无效`)
  for (const ports of [definition.inputs, definition.outputs]) {
    const ids = new Set<string>()
    for (const port of ports) {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(port.id) || ids.has(port.id)) throw new Error(`${definition.type} 存在无效或重复端口：${port.id}`)
      ids.add(port.id)
    }
  }
}

export class CanvasNodeRegistry {
  private readonly nodes = new Map<string, CanvasRegisteredNode>()

  register(definition: CanvasNodeDefinition, owner: CanvasRegisteredNode['owner']) {
    assertNodeType(definition.type, owner)
    assertDefinition(definition)
    const existing = this.nodes.get(definition.type)
    if (existing && (existing.owner.kind !== owner.kind || existing.owner.kind === 'plugin' && owner.kind === 'plugin' && existing.owner.pluginId !== owner.pluginId)) {
      throw new Error(`画布节点类型已被占用：${definition.type}`)
    }
    const registered: CanvasRegisteredNode = { ...definition, owner }
    this.nodes.set(definition.type, registered)
    return registered
  }

  unregisterPlugin(pluginId: string) {
    for (const [type, node] of this.nodes) if (node.owner.kind === 'plugin' && node.owner.pluginId === pluginId) this.nodes.delete(type)
  }

  get(type: string) { return this.nodes.get(type) }

  list() {
    return [...this.nodes.values()].sort((left, right) => (left.category || '').localeCompare(right.category || '') || left.title.localeCompare(right.title))
  }

  clearPlugins() {
    for (const [type, node] of this.nodes) if (node.owner.kind === 'plugin') this.nodes.delete(type)
  }
}

export const canvasNodeRegistry = registerBuiltinCanvasNodes(new CanvasNodeRegistry())
