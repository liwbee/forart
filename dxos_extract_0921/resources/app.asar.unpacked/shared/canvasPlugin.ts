export const CANVAS_NODE_MANIFEST_FORMAT = 'dx-canvas-nodes/v1' as const
export const CANVAS_TEMPLATE_MANIFEST_FORMAT = 'dx-canvas-templates/v1' as const
export const CANVAS_PLUGIN_REGISTRY_FORMAT = 'dx-canvas-plugin-registry/v1' as const

export type CanvasPortValueType =
  | 'text'
  | 'text[]'
  | 'json'
  | 'table'
  | 'file'
  | 'file[]'
  | 'media.image'
  | 'media.image[]'
  | 'media.video'
  | 'media.video[]'
  | 'media.audio'
  | 'media.audio[]'
  | 'artifact'
  | 'event'

export type CanvasNodeExecutor =
  | { type: 'builtin'; id: string }
  | { type: 'skill'; skillId: string }
  | { type: 'mcp-tool'; serverId: string; toolName: string }
  | { type: 'agent-tool'; toolName: string }
  | { type: 'workflow'; workflowId: string }
  | { type: 'app-bridge'; action: string }

export type CanvasGenerationKind = 'text' | 'image' | 'video' | 'audio'
export type CanvasGenerationField = 'platform' | 'model' | 'ratio' | 'resolution' | 'quality' | 'count' | 'duration' | 'seed'
export type CanvasOutputTarget = 'inline' | 'text-node' | 'table-node'

export interface CanvasNodeHostCapabilities {
  generation?: {
    kind: CanvasGenerationKind
    parameterPanel: 'standard'
    outputPort: string
    fields?: CanvasGenerationField[]
  }
  output?: {
    targets: CanvasOutputTarget[]
    defaultTarget: CanvasOutputTarget
    defaultPort: string
  }
  storage?: {
    enabled: true
    maxBytes?: number
  }
  cancellable?: boolean
}

export interface CanvasPluginDeclaration {
  nodeManifests: string[]
  templateManifests: string[]
}

export interface CanvasNodePortDefinition {
  id: string
  title: string
  type: CanvasPortValueType
  required?: boolean
  multiple?: boolean
}

export interface CanvasNodeDefinition {
  type: string
  version: number
  stateVersion: number
  title: string
  description?: string
  category?: string
  icon?: string
  defaultSize: { width: number; height: number }
  inputs: CanvasNodePortDefinition[]
  outputs: CanvasNodePortDefinition[]
  parameters?: Record<string, unknown>
  host?: CanvasNodeHostCapabilities
  stateMigrations?: CanvasNodeStateMigration[]
  executor: CanvasNodeExecutor
}

export type CanvasNodeStateMigrationOperation =
  | { type: 'set-default'; path: string; value: unknown }
  | { type: 'rename'; from: string; to: string }
  | { type: 'delete'; path: string }

export interface CanvasNodeStateMigration {
  from: number
  to: number
  operations: CanvasNodeStateMigrationOperation[]
}

export interface CanvasNodeManifest {
  format: typeof CANVAS_NODE_MANIFEST_FORMAT
  nodes: CanvasNodeDefinition[]
}

export interface CanvasTemplateNodeInstance {
  id: string
  nodeType: string
  x: number
  y: number
  parameters?: Record<string, unknown>
  pluginState?: Record<string, unknown>
}

export interface CanvasTemplateConnectionDefinition {
  from: string
  to: string
  fromPort?: string
  toPort?: string
}

export interface CanvasTemplateDefinition {
  id: string
  title: string
  description?: string
  category?: string
  nodes: CanvasTemplateNodeInstance[]
  connections: CanvasTemplateConnectionDefinition[]
}

export interface CanvasTemplateManifest {
  format: typeof CANVAS_TEMPLATE_MANIFEST_FORMAT
  templates: CanvasTemplateDefinition[]
}

export interface CanvasRegisteredTemplate extends CanvasTemplateDefinition {
  owner: { kind: 'plugin'; pluginId: string; releaseKey: string }
}

export interface CanvasRegisteredNode extends CanvasNodeDefinition {
  owner: { kind: 'builtin' } | { kind: 'plugin'; pluginId: string; releaseKey: string }
}

export interface CanvasMissingNodeSnapshot {
  pluginId: string
  nodeType: string
  nodeVersion: number
  stateVersion: number
  title: string
  description?: string
  category?: string
  icon?: string
  defaultSize: { width: number; height: number }
  inputs: CanvasNodePortDefinition[]
  outputs: CanvasNodePortDefinition[]
}

export interface CanvasPluginRegistryEntry {
  pluginId: string
  appId: string
  name?: string
  description?: string
  releaseKey: string
  enabled: boolean
  status: 'active' | 'disabled' | 'incompatible' | 'missing'
  nodeTypes: string[]
  nodeManifests: string[]
  templateManifests: string[]
  error?: string
}

export interface CanvasPluginRegistrySnapshot {
  format: typeof CANVAS_PLUGIN_REGISTRY_FORMAT
  updatedAt: number
  plugins: CanvasPluginRegistryEntry[]
  nodes: CanvasRegisteredNode[]
  templates: CanvasRegisteredTemplate[]
}
