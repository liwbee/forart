import {
  CANVAS_NODE_MANIFEST_FORMAT,
  CANVAS_TEMPLATE_MANIFEST_FORMAT,
  type CanvasNodeDefinition,
  type CanvasNodeExecutor,
  type CanvasNodeHostCapabilities,
  type CanvasNodeManifest,
  type CanvasNodeStateMigration,
  type CanvasNodePortDefinition,
  type CanvasPortValueType,
  type CanvasTemplateManifest,
} from './canvasPlugin.ts'
import { canvasPortCompatibility } from './canvasPortCompatibility.ts'

const PORT_TYPES = new Set<CanvasPortValueType>([
  'text', 'text[]', 'json', 'table', 'file', 'file[]', 'media.image', 'media.image[]',
  'media.video', 'media.video[]', 'media.audio', 'media.audio[]', 'artifact', 'event',
])
const PORT_TYPE_HINT = '合法类型：text、text[]、json、table、file、file[]、media.image、media.image[]、media.video、media.video[]、media.audio、media.audio[]、artifact、event；图片/视频/音频不要写 image、video、audio 或 media'

function object(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function identifier(value: unknown, label: string) {
  const result = String(value || '').trim()
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(result)) throw new Error(`${label} 不合法`)
  return result
}

function positiveInteger(value: unknown, label: string) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} 必须是正整数`)
  return result
}

function ports(value: unknown, label: string): CanvasNodePortDefinition[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`)
  if (value.length > 64) throw new Error(`${label} 最多允许 64 个端口`)
  const ids = new Set<string>()
  return value.map((raw, index) => {
    const port = object(raw, `${label}[${index}]`)
    const id = identifier(port.id, `${label}[${index}].id`)
    if (ids.has(id)) throw new Error(`${label} 存在重复端口：${id}`)
    ids.add(id)
    const type = String(port.type || '') as CanvasPortValueType
    if (!PORT_TYPES.has(type)) throw new Error(`${label}.${id} 使用了未知端口类型：${type || '(空)'}。${PORT_TYPE_HINT}`)
    const title = String(port.title || '').trim()
    if (!title || title.length > 80) throw new Error(`${label}.${id}.title 长度必须为 1–80`)
    return { id, title, type, ...(port.required === true ? { required: true } : {}), ...(port.multiple === true ? { multiple: true } : {}) }
  })
}

function executor(value: unknown, label: string): CanvasNodeExecutor {
  const raw = object(value, label)
  const type = String(raw.type || '')
  const required = (key: string) => {
    const result = String(raw[key] || '').trim()
    if (!result || result.length > 160) throw new Error(`${label}.${key} 不能为空且不能超过 160 字符`)
    return result
  }
  if (type === 'builtin') return { type, id: required('id') }
  if (type === 'skill') return { type, skillId: required('skillId') }
  if (type === 'mcp-tool') return { type, serverId: required('serverId'), toolName: required('toolName') }
  if (type === 'agent-tool') return { type, toolName: required('toolName') }
  if (type === 'workflow') return { type, workflowId: required('workflowId') }
  if (type === 'app-bridge') return { type, action: required('action') }
  throw new Error(`${label}.type 不受支持：${type || '(空)'}`)
}

function parameterSchema(value: unknown, label: string, outputs: CanvasNodePortDefinition[]) {
  if (value === undefined) return undefined
  const schema = object(value, label)
  if (schema.type !== undefined && schema.type !== 'object') throw new Error(`${label}.type 只支持 object`)
  const rawProperties = schema.properties === undefined ? schema : object(schema.properties, `${label}.properties`)
  const properties = Object.entries(rawProperties).filter(([key]) => key !== 'type').map(([key, raw]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key)) throw new Error(`${label}.properties.${key} 字段名不合法`)
    const field = object(raw, `${label}.properties.${key}`)
    const type = String(field.type || 'string')
    if (!['string', 'number', 'integer', 'boolean'].includes(type)) throw new Error(`${label}.properties.${key}.type 暂不支持：${type}`)
    const values = field.enum
    if (values !== undefined && (!Array.isArray(values) || !values.length || values.length > 100)) throw new Error(`${label}.properties.${key}.enum 必须是 1–100 项数组`)
    if (field.enumNames !== undefined && (!Array.isArray(field.enumNames) || !Array.isArray(values) || field.enumNames.length !== values.length)) throw new Error(`${label}.properties.${key}.enumNames 必须与 enum 等长`)
    if (Array.isArray(values) && field.default !== undefined && !values.some((candidate) => Object.is(candidate, field.default))) throw new Error(`${label}.properties.${key}.default 必须属于 enum`)
    if ((type === 'number' || type === 'integer') && field.minimum !== undefined && field.maximum !== undefined && Number(field.minimum) > Number(field.maximum)) throw new Error(`${label}.properties.${key} 的 minimum 不能大于 maximum`)
    return { key, field }
  })
  const byKey = new Map(properties.map((item) => [item.key, item.field]))
  const outputTarget = byKey.get('canvasOutputTarget')
  if (Array.isArray(outputTarget?.enum) && outputTarget.enum.some((item) => !['inline', 'text-node', 'table-node'].includes(String(item)))) throw new Error(`${label}.canvasOutputTarget 包含未知输出目标`)
  const outputPort = byKey.get('canvasOutputPort')
  if (Array.isArray(outputPort?.enum) && outputPort.enum.some((item) => !outputs.some((port) => port.id === String(item)))) throw new Error(`${label}.canvasOutputPort 必须引用 outputs 中已声明的端口`)
  return schema
}

function hostCapabilities(value: unknown, nodeExecutor: CanvasNodeExecutor, outputs: CanvasNodePortDefinition[], label: string): CanvasNodeHostCapabilities | undefined {
  if (value === undefined) return undefined
  const host = object(value, label)
  const result: CanvasNodeHostCapabilities = {}
  if (host.generation !== undefined) {
    const generation = object(host.generation, `${label}.generation`)
    const kind = String(generation.kind || '') as CanvasNodeHostCapabilities['generation'] extends infer T ? T extends { kind: infer K } ? K : never : never
    if (!['text', 'image', 'video', 'audio'].includes(String(kind))) throw new Error(`${label}.generation.kind 不受支持`)
    if (generation.parameterPanel !== 'standard') throw new Error(`${label}.generation.parameterPanel 必须是 standard`)
    const outputPort = String(generation.outputPort || '')
    const output = outputs.find((port) => port.id === outputPort)
    if (!output) throw new Error(`${label}.generation.outputPort 必须引用 outputs 端口`)
    const expected = kind === 'text' ? 'text' : `media.${kind}`
    if (!output.type.startsWith(expected)) throw new Error(`${label}.generation.outputPort 类型必须匹配 ${kind}`)
    if (nodeExecutor.type !== 'agent-tool' || nodeExecutor.toolName !== (kind === 'text' ? 'canvas.ai.generate-text' : 'canvas.ai.generate')) throw new Error(`${label}.generation 必须使用对应的 canvas.ai agent-tool 执行器`)
    const allowedFields = new Set(['platform', 'model', 'ratio', 'resolution', 'quality', 'count', 'duration', 'seed'])
    const fields = generation.fields === undefined ? undefined : [...new Set((Array.isArray(generation.fields) ? generation.fields : []).map(String))]
    if (generation.fields !== undefined && (!Array.isArray(generation.fields) || fields!.some((field) => !allowedFields.has(field)))) throw new Error(`${label}.generation.fields 包含未知标准字段`)
    result.generation = { kind, parameterPanel: 'standard', outputPort, ...(fields ? { fields: fields as NonNullable<CanvasNodeHostCapabilities['generation']>['fields'] } : {}) }
  }
  if (host.output !== undefined) {
    const output = object(host.output, `${label}.output`)
    const allowed = new Set(['inline', 'text-node', 'table-node'])
    if (!Array.isArray(output.targets) || !output.targets.length) throw new Error(`${label}.output.targets 至少需要一项`)
    const targets = [...new Set(output.targets.map(String))]
    if (targets.some((target) => !allowed.has(target))) throw new Error(`${label}.output.targets 包含未知目标`)
    const defaultTarget = String(output.defaultTarget || '')
    if (!targets.includes(defaultTarget)) throw new Error(`${label}.output.defaultTarget 必须属于 targets`)
    const defaultPort = String(output.defaultPort || '')
    if (!outputs.some((port) => port.id === defaultPort)) throw new Error(`${label}.output.defaultPort 必须引用 outputs 端口`)
    result.output = { targets: targets as NonNullable<CanvasNodeHostCapabilities['output']>['targets'], defaultTarget: defaultTarget as NonNullable<CanvasNodeHostCapabilities['output']>['defaultTarget'], defaultPort }
  }
  if (host.storage !== undefined) {
    const storage = object(host.storage, `${label}.storage`)
    if (storage.enabled !== true) throw new Error(`${label}.storage.enabled 必须是 true`)
    const maxBytes = storage.maxBytes === undefined ? undefined : Number(storage.maxBytes)
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 5 * 1024 * 1024)) throw new Error(`${label}.storage.maxBytes 必须在 1KB–5MB`)
    result.storage = { enabled: true, ...(maxBytes ? { maxBytes } : {}) }
  }
  if (host.cancellable !== undefined) result.cancellable = host.cancellable === true
  return result
}

function stateMigrations(value: unknown, stateVersion: number, label: string): CanvasNodeStateMigration[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 32) throw new Error(`${label} 必须是最多 32 项的数组`)
  const safePath = (raw: unknown, pathLabel: string) => {
    const path = String(raw || '').trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*)*$/.test(path) || path.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error(`${pathLabel} 不合法`)
    return path
  }
  const migrations = value.map((raw, index) => {
    const migration = object(raw, `${label}[${index}]`)
    const from = positiveInteger(migration.from, `${label}[${index}].from`)
    const to = positiveInteger(migration.to, `${label}[${index}].to`)
    if (to !== from + 1 || to > stateVersion) throw new Error(`${label}[${index}] 必须逐版本迁移且不能超过 stateVersion`)
    if (!Array.isArray(migration.operations) || migration.operations.length > 64) throw new Error(`${label}[${index}].operations 必须是最多 64 项的数组`)
    const operations = migration.operations.map((operationRaw, operationIndex) => {
      const operation = object(operationRaw, `${label}[${index}].operations[${operationIndex}]`)
      if (operation.type === 'set-default') return { type: 'set-default' as const, path: safePath(operation.path, 'set-default.path'), value: operation.value }
      if (operation.type === 'rename') return { type: 'rename' as const, from: safePath(operation.from, 'rename.from'), to: safePath(operation.to, 'rename.to') }
      if (operation.type === 'delete') return { type: 'delete' as const, path: safePath(operation.path, 'delete.path') }
      throw new Error(`${label}[${index}] 存在未知迁移操作`)
    })
    return { from, to, operations }
  }).sort((left, right) => left.from - right.from)
  const seen = new Set<number>()
  for (const migration of migrations) {
    if (seen.has(migration.from)) throw new Error(`${label} 存在重复 from：${migration.from}`)
    seen.add(migration.from)
  }
  return migrations
}

export function validateCanvasNodeManifest(value: unknown, pluginId?: string): CanvasNodeManifest {
  const manifest = object(value, 'canvas.nodes.json')
  if (manifest.format !== CANVAS_NODE_MANIFEST_FORMAT) throw new Error(`节点清单 format 必须是 ${CANVAS_NODE_MANIFEST_FORMAT}`)
  if (!Array.isArray(manifest.nodes) || !manifest.nodes.length) throw new Error('节点清单至少需要一个节点')
  if (manifest.nodes.length > 128) throw new Error('单个节点清单最多允许 128 个节点')
  const types = new Set<string>()
  const nodes: CanvasNodeDefinition[] = manifest.nodes.map((raw, index) => {
    const node = object(raw, `nodes[${index}]`)
    const type = String(node.type || '').trim()
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(type)) throw new Error(`nodes[${index}].type 不合法`)
    if (pluginId && !type.startsWith(`${pluginId}.`)) throw new Error(`插件节点必须使用 ${pluginId}.* 命名空间：${type}`)
    if (types.has(type)) throw new Error(`节点类型重复：${type}`)
    types.add(type)
    const title = String(node.title || '').trim()
    if (!title || title.length > 120) throw new Error(`${type}.title 长度必须为 1–120`)
    const size = object(node.defaultSize, `${type}.defaultSize`)
    const width = Number(size.width)
    const height = Number(size.height)
    if (!Number.isFinite(width) || width < 48 || width > 4000 || !Number.isFinite(height) || height < 32 || height > 4000) throw new Error(`${type}.defaultSize 超出允许范围`)
    const version = positiveInteger(node.version, `${type}.version`)
    const nodeStateVersion = positiveInteger(node.stateVersion, `${type}.stateVersion`)
    const migrations = stateMigrations(node.stateMigrations, nodeStateVersion, `${type}.stateMigrations`)
    const inputs = ports(node.inputs, `${type}.inputs`)
    const outputs = ports(node.outputs, `${type}.outputs`)
    const nodeExecutor = executor(node.executor, `${type}.executor`)
    const parameters = parameterSchema(node.parameters, `${type}.parameters`, outputs)
    const host = hostCapabilities(node.host, nodeExecutor, outputs, `${type}.host`)
    return {
      type,
      version,
      stateVersion: nodeStateVersion,
      title,
      ...(node.description ? { description: String(node.description).slice(0, 500) } : {}),
      ...(node.category ? { category: String(node.category).slice(0, 80) } : {}),
      ...(node.icon ? { icon: String(node.icon).slice(0, 240) } : {}),
      defaultSize: { width, height },
      inputs,
      outputs,
      ...(parameters ? { parameters } : {}),
      ...(host ? { host } : {}),
      ...(migrations ? { stateMigrations: migrations } : {}),
      executor: nodeExecutor,
    }
  })
  return { format: CANVAS_NODE_MANIFEST_FORMAT, nodes }
}

export function validateCanvasTemplateManifest(value: unknown, pluginId: string, definitions?: readonly CanvasNodeDefinition[]): CanvasTemplateManifest {
  const manifest = object(value, 'canvas.templates.json')
  if (manifest.format !== CANVAS_TEMPLATE_MANIFEST_FORMAT) throw new Error(`模板清单 format 必须是 ${CANVAS_TEMPLATE_MANIFEST_FORMAT}`)
  if (!Array.isArray(manifest.templates) || !manifest.templates.length || manifest.templates.length > 64) throw new Error('模板清单需要包含 1–64 个模板')
  const templateIds = new Set<string>()
  return {
    format: CANVAS_TEMPLATE_MANIFEST_FORMAT,
    templates: manifest.templates.map((raw, index) => {
      const template = object(raw, `templates[${index}]`)
      const id = identifier(template.id, `templates[${index}].id`)
      if (templateIds.has(id)) throw new Error(`模板 ID 重复：${id}`)
      templateIds.add(id)
      const title = String(template.title || '').trim()
      if (!title || title.length > 120) throw new Error(`${id}.title 长度必须为 1–120`)
      if (!Array.isArray(template.nodes) || !template.nodes.length || template.nodes.length > 256) throw new Error(`${id}.nodes 需要包含 1–256 个节点`)
      const nodeIds = new Set<string>()
      const nodes = template.nodes.map((nodeRaw, nodeIndex) => {
        const node = object(nodeRaw, `${id}.nodes[${nodeIndex}]`)
        const nodeId = identifier(node.id, `${id}.nodes[${nodeIndex}].id`)
        if (nodeIds.has(nodeId)) throw new Error(`${id} 节点 ID 重复：${nodeId}`)
        nodeIds.add(nodeId)
        const nodeType = String(node.nodeType || '').trim()
        if (!nodeType.startsWith('builtin.') && !nodeType.startsWith(`${pluginId}.`)) throw new Error(`${id} 只能引用 builtin.* 或 ${pluginId}.* 节点：${nodeType}`)
        return { id: nodeId, nodeType, x: Number(node.x) || 0, y: Number(node.y) || 0, ...(node.parameters && typeof node.parameters === 'object' && !Array.isArray(node.parameters) ? { parameters: node.parameters as Record<string, unknown> } : {}), ...(node.pluginState && typeof node.pluginState === 'object' && !Array.isArray(node.pluginState) ? { pluginState: node.pluginState as Record<string, unknown> } : {}) }
      })
      if (definitions) for (const node of nodes) if (!definitions.some((definition) => definition.type === node.nodeType)) throw new Error(`${id} 引用了未声明节点类型：${node.nodeType}`)
      const connections = Array.isArray(template.connections) ? template.connections.slice(0, 512).map((connectionRaw, connectionIndex) => {
        const connection = object(connectionRaw, `${id}.connections[${connectionIndex}]`)
        const from = String(connection.from || '')
        const to = String(connection.to || '')
        if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) throw new Error(`${id} 存在无效模板连线：${from} → ${to}`)
        const fromPort = connection.fromPort ? String(connection.fromPort) : ''
        const toPort = connection.toPort ? String(connection.toPort) : ''
        if (definitions) {
          const sourceInstance = nodes.find((node) => node.id === from)!
          const targetInstance = nodes.find((node) => node.id === to)!
          const sourceDefinition = definitions.find((node) => node.type === sourceInstance.nodeType)
          const targetDefinition = definitions.find((node) => node.type === targetInstance.nodeType)
          if (!sourceDefinition) throw new Error(`${id} 引用了未声明节点类型：${sourceInstance.nodeType}`)
          if (!targetDefinition) throw new Error(`${id} 引用了未声明节点类型：${targetInstance.nodeType}`)
          const sources = fromPort ? sourceDefinition.outputs.filter((port) => port.id === fromPort) : sourceDefinition.outputs
          const targets = toPort ? targetDefinition.inputs.filter((port) => port.id === toPort) : targetDefinition.inputs
          if (fromPort && !sources.length) throw new Error(`${id} 的输出端口不存在：${sourceInstance.nodeType}.${fromPort}`)
          if (toPort && !targets.length) throw new Error(`${id} 的输入端口不存在：${targetInstance.nodeType}.${toPort}`)
          const compatible = sources.flatMap((source) => targets.map((target) => ({ source, target, result: canvasPortCompatibility(source, target) }))).filter((item) => item.result.ok)
          if (!compatible.length) throw new Error(`${id} 的模板连线端口不兼容：${sourceInstance.nodeType} → ${targetInstance.nodeType}`)
          if ((!fromPort || !toPort) && compatible.length !== 1) throw new Error(`${id} 的模板连线存在多个兼容端口，必须明确声明 fromPort 和 toPort`)
        }
        return { from, to, ...(fromPort ? { fromPort } : {}), ...(toPort ? { toPort } : {}) }
      }) : []
      return { id, title, ...(template.description ? { description: String(template.description).slice(0, 500) } : {}), ...(template.category ? { category: String(template.category).slice(0, 80) } : {}), nodes, connections }
    }),
  }
}
