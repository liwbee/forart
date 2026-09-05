import { toolCatalogSnapshot, type ToolDescriptor, type ToolSource } from './toolCatalog.ts'
import type { AuthUser } from './auth.ts'

type OpenAIFunctionTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export interface ToolResolverRequest {
  intent: 'project.agent' | string
  actor?: AuthUser | null
  requestedSources?: ToolSource[]
  executableOnly?: boolean
  includeRisk?: Array<ToolDescriptor['risk']>
}

export interface ToolResolverResult {
  descriptors: ToolDescriptor[]
  openaiTools: OpenAIFunctionTool[]
  executors: Record<string, { type: string; source: ToolSource; sourceId: string; toolName?: string }>
}

const DEFAULT_AGENT_SOURCES: ToolSource[] = ['file', 'skill', 'mcp']

function allowedRisk(tool: ToolDescriptor, includeRisk?: Array<ToolDescriptor['risk']>) {
  if (!includeRisk?.length) return true
  return includeRisk.includes(tool.risk)
}

export function resolveTools(request: ToolResolverRequest): ToolResolverResult {
  const sources = request.requestedSources?.length ? request.requestedSources : request.intent === 'project.agent' ? DEFAULT_AGENT_SOURCES : undefined
  const snapshot = toolCatalogSnapshot({ actor: request.actor, executableOnly: request.executableOnly ?? true })
  let descriptors = snapshot.descriptors
  if (sources?.length) descriptors = descriptors.filter((tool) => sources.includes(tool.source))
  descriptors = descriptors.filter((tool) => allowedRisk(tool, request.includeRisk))
  const openaiTools = descriptors.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: `[${tool.title}] ${tool.description}${tool.whenToUse.length ? `\n适用场景：${tool.whenToUse.join('；')}` : ''}`,
      parameters: tool.inputSchema,
    },
  }))
  const executors = Object.fromEntries(descriptors.map((tool) => [tool.name, {
    type: tool.handler.type,
    source: tool.source,
    sourceId: tool.sourceId,
    toolName: tool.handler.toolName,
  }]))
  return { descriptors, openaiTools, executors }
}

export function resolveReactTools(actor?: AuthUser | null) {
  return resolveTools({
    intent: 'project.agent',
    actor,
    requestedSources: DEFAULT_AGENT_SOURCES,
    executableOnly: true,
    includeRisk: ['read', 'write', 'delete', 'external'],
  })
}
