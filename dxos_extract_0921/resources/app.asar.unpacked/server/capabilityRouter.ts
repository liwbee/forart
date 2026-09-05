import { resolveModelFromProviders } from './modelResolver.ts'
import { resolveReactTools } from './toolResolver.ts'
import { allProviders, type Provider } from './store.ts'
import type { AuthUser } from './auth.ts'
import type { CapabilityIntent, ResolvedModelRoute, TaskIntent } from './capabilityTypes.ts'
import type { ToolDescriptor } from './toolCatalog.ts'

type OpenAIFunctionTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export interface AgentRouteRequest {
  instruction?: string
  taskId?: string
  projectId?: string
  rootNodeId?: string
  actor?: AuthUser | null
  hasImageInput?: boolean
  providers?: Provider[]
  preferredProviderId?: string
  preferredModel?: string
}

export interface AgentRoute {
  taskIntent: TaskIntent
  requiresAll: CapabilityIntent[]
  requiresAny: CapabilityIntent[]
  model: ResolvedModelRoute
  tools: OpenAIFunctionTool[]
  toolDescriptors: ToolDescriptor[]
  systemPromptAdditions: string[]
  reasons: string[]
  warnings: string[]
}

function inferAgentRequirements(request: AgentRouteRequest) {
  const taskIntent = request.hasImageInput ? 'agent.analyze_image_and_write' : 'agent.project.write'
  const requiresAll = request.hasImageInput ? ['llm.chat.vision', 'llm.tools'] : ['llm.tools']
  return { taskIntent, requiresAll, requiresAny: [] as CapabilityIntent[] }
}

export function resolveAgentRoute(request: AgentRouteRequest = {}): AgentRoute {
  const requirements = inferAgentRequirements(request)
  const providers = request.providers || allProviders()
  const preferredModels = request.preferredProviderId
    ? providers.find((provider) => provider.id === request.preferredProviderId)?.models.map((entry) => ({ providerId: request.preferredProviderId, model: entry.model, weight: entry.model === request.preferredModel ? 2000 : 500 })) || []
    : request.preferredModel ? [{ model: request.preferredModel, weight: 2000 }] : []
  const model = resolveModelFromProviders(providers, {
    taskIntent: requirements.taskIntent,
    requiresAll: requirements.requiresAll,
    requiresAny: requirements.requiresAny,
    fallbackPolicy: 'best_available',
    preferredModels,
  })
  let tools = resolveReactTools(request.actor)
  const instruction = String(request.instruction || '')
  const wantsImageDescription = /(?:描述|识别|分析|查看|看看|看一下|反推|检查).{0,24}(?:图片|图像|照片|画面|\.png\b|\.jpe?g\b|\.webp\b)|(?:图片|图像|照片|画面|\.png\b|\.jpe?g\b|\.webp\b).{0,24}(?:描述|识别|分析|查看|看看|看一下|反推|检查)/i.test(instruction)
  if (wantsImageDescription) {
    const keep = new Set(['fs_list', 'skill__describe_image'])
    const descriptors = tools.descriptors.filter((tool) => keep.has(tool.name))
    tools = {
      descriptors,
      openaiTools: tools.openaiTools.filter((tool) => keep.has(tool.function.name)),
      executors: Object.fromEntries(Object.entries(tools.executors).filter(([name]) => keep.has(name))),
    }
  }
  const warnings = [
    ...model.warnings,
    ...(!tools.descriptors.length ? ['当前没有可执行工具，Agent 只能规划或说明，不能落地执行。'] : []),
  ]
  return {
    ...requirements,
    model,
    tools: tools.openaiTools,
    toolDescriptors: tools.descriptors,
    systemPromptAdditions: [],
    reasons: [
      ...model.reasons,
      `暴露 ${tools.descriptors.length} 个 Agent 工具（${tools.descriptors.filter((tool) => tool.source === 'file').length} 个文件工具，${tools.descriptors.filter((tool) => tool.source === 'skill').length} 个 Skill 工具，${tools.descriptors.filter((tool) => tool.source === 'mcp').length} 个 MCP 工具）`,
    ],
    warnings,
  }
}
