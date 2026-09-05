import { listDeveloperApps, type DeveloperAppToolDeclaration } from './developerApps.ts'
import { callDirect as callMcpDirect, listServers as listMcpServers } from './mcp.ts'
import { listSkills, runSkill } from './skills.ts'
import { getWeather, type WeatherResult } from './weather.ts'
import { canUseAppPermission, type AuthUser } from './auth.ts'
import { FILE_TOOLS } from './agentTools.ts'

export type ToolSource = 'system' | 'file' | 'app' | 'mcp' | 'skill'
export type ToolRisk = 'read' | 'write' | 'delete' | 'external' | 'system'
export type ToolStatus = 'ready' | 'pending' | 'disabled' | 'unavailable'

export interface ToolDescriptor {
  name: string
  title: string
  description: string
  source: ToolSource
  sourceId: string
  appId?: string
  enabled: boolean
  executable: boolean
  status: ToolStatus
  statusText: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  permissions: string[]
  risk: ToolRisk
  sideEffects: string[]
  whenToUse: string[]
  confirmation?: { required: boolean; message?: string }
  handler: { type: string; endpoint?: string; serverId?: string; toolName?: string; skillId?: string }
}

export interface ToolCatalogSnapshot {
  descriptors: ToolDescriptor[]
  tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>
  summary: { total: number; ready: number; pending: number; sources: Record<ToolSource, number> }
}

const EMPTY_SCHEMA = { type: 'object', properties: {} }

function functionTool(tool: ToolDescriptor) {
  const hints = tool.whenToUse.length ? `\n适用场景：${tool.whenToUse.join('；')}` : ''
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: `[${tool.title}] ${tool.description}${hints}`,
      parameters: tool.inputSchema || EMPTY_SCHEMA,
    },
  }
}

function safeName(value: string) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function systemTools(): ToolDescriptor[] {
  return [
    {
      name: 'open_app',
      title: '打开应用',
      description: '打开一个 DX OS 应用窗口。',
      source: 'system',
      sourceId: 'desktop',
      enabled: true,
      executable: true,
      status: 'ready',
      statusText: '客户端可执行',
      inputSchema: { type: 'object', properties: { app: { type: 'string', description: '应用 id 或名称，如 music/settings/files/market' } }, required: ['app'] },
      permissions: [],
      risk: 'read',
      sideEffects: ['open:window'],
      whenToUse: ['用户要求打开、启动、进入或切换到某个应用时'],
      handler: { type: 'client' },
    },
    {
      name: 'music_play',
      title: '播放音乐',
      description: '按关键词播放本地音乐，匹配歌名、歌手、专辑或目录。',
      source: 'system',
      sourceId: 'music',
      appId: 'music',
      enabled: true,
      executable: true,
      status: 'ready',
      statusText: '客户端可执行',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, shuffle: { type: 'boolean' } } },
      permissions: ['music.play'],
      risk: 'read',
      sideEffects: ['play:music'],
      whenToUse: ['用户要求播放某首歌、某个歌手、某类音乐或继续听音乐时'],
      handler: { type: 'client' },
    },
    {
      name: 'music_control',
      title: '音乐控制',
      description: '控制当前音乐播放状态。',
      source: 'system',
      sourceId: 'music',
      appId: 'music',
      enabled: true,
      executable: true,
      status: 'ready',
      statusText: '客户端可执行',
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'next', 'prev', 'stop'] } }, required: ['action'] },
      permissions: ['music.play'],
      risk: 'read',
      sideEffects: ['control:music'],
      whenToUse: ['用户要求暂停、继续、下一首、上一首或停止播放时'],
      handler: { type: 'client' },
    },
  ]
}

function fileToolRisk(mutates: boolean, name: string): ToolRisk {
  if (name === 'fs_delete') return 'delete'
  return mutates ? 'write' : 'read'
}

function fileToolSideEffects(mutates: boolean, name: string) {
  if (!mutates) return []
  if (name === 'fs_delete') return ['delete:files']
  return ['write:files']
}

function fileTools(): ToolDescriptor[] {
  return FILE_TOOLS.map((tool) => {
    const risk = fileToolRisk(tool.mutates, tool.name)
    return {
      name: tool.name,
      title: tool.name,
      description: tool.description,
      source: 'file' as const,
      sourceId: 'project',
      enabled: true,
      executable: true,
      status: 'ready' as const,
      statusText: '项目文件工具可执行',
      inputSchema: tool.parameters,
      permissions: [risk === 'read' ? 'files.read' : 'files.write'],
      risk,
      sideEffects: fileToolSideEffects(tool.mutates, tool.name),
      whenToUse: ['需要读取、创建、修改、移动、复制或删除项目文件时'],
      handler: { type: 'file-tool', toolName: tool.name },
    }
  })
}

function isWeatherTool(tool: DeveloperAppToolDeclaration) {
  const text = `${tool.name} ${tool.title} ${tool.description} ${tool.permission || ''}`.toLowerCase()
  return text.includes('weather') || text.includes('天气')
}

function installedSkillStatus(skillId: string) {
  const skill = listSkills().find((item) => item.id === skillId)
  if (!skill) return { executable: false, status: 'pending' as const, statusText: `等待安装 Skill：${skillId}` }
  if (!skill.enabled) return { executable: false, status: 'disabled' as const, statusText: `Skill 已安装但未启用：${skill.name}` }
  return { executable: true, status: 'ready' as const, statusText: `已安装并启用 Skill：${skill.name}` }
}

function installedMcpStatus(serverId: string, toolName?: string) {
  const server = listMcpServers().find((item) => item.id === serverId)
  if (!server) return { executable: false, status: 'pending' as const, statusText: `等待安装 MCP：${serverId}` }
  if (!server.enabled) return { executable: false, status: 'disabled' as const, statusText: `MCP 已安装但未启用：${server.name}` }
  if (server.status !== 'connected') return { executable: false, status: 'unavailable' as const, statusText: `MCP ${server.status || '未连接'}：${server.name}` }
  if (toolName && !(server.tools || []).some((tool) => tool.name === toolName)) {
    return { executable: false, status: 'pending' as const, statusText: `MCP 已连接，等待工具：${toolName}` }
  }
  return { executable: true, status: 'ready' as const, statusText: `已连接 MCP：${server.name}` }
}

function appToolServerStatus(tool: DeveloperAppToolDeclaration) {
  const handler = tool.handler || { type: tool.handlerType }
  if (handler.type === 'skill' && handler.skillId) return installedSkillStatus(handler.skillId)
  if (handler.type === 'mcp-tool' && handler.serverId) return installedMcpStatus(handler.serverId, handler.toolName)
  if (handler.type === 'frontend-bridge' && isWeatherTool(tool)) return { executable: true, status: 'ready' as const, statusText: '已映射系统天气能力' }
  return {
    executable: false,
    status: 'pending' as const,
    statusText: handler.type === 'app-api'
      ? '已登记，等待后端执行入口授权'
      : '已登记，等待前端桥接窗口在线',
  }
}

function appTool(packId: string, appName: string, tool: DeveloperAppToolDeclaration, actor?: AuthUser | null): ToolDescriptor {
  const serverStatus = appToolServerStatus(tool)
  const allowed = !tool.permission || canUseAppPermission(actor, tool.permission)
  const statusText = serverStatus.executable
    ? allowed
      ? `已授权，${serverStatus.statusText}`
      : '当前账户没有打开此 APP 的权限'
    : serverStatus.statusText
  return {
    name: tool.name,
    title: tool.title || tool.name,
    description: tool.description || `${appName} 声明的 Agent 工具。`,
    source: 'app',
    sourceId: packId,
    appId: packId,
    enabled: serverStatus.executable && allowed,
    executable: serverStatus.executable && allowed,
    status: serverStatus.executable ? (allowed ? 'ready' : 'disabled') : serverStatus.status,
    statusText,
    inputSchema: tool.inputSchema || EMPTY_SCHEMA,
    outputSchema: tool.outputSchema,
    permissions: tool.permission ? [tool.permission] : [],
    risk: tool.risk,
    sideEffects: tool.sideEffects || [],
    whenToUse: tool.whenToUse || [],
    confirmation: tool.confirmation,
    handler: tool.handler || { type: tool.handlerType },
  }
}

function developerTools(actor?: AuthUser | null): ToolDescriptor[] {
  return listDeveloperApps().flatMap((pack) => (pack.capabilities?.tools || []).map((tool) => appTool(pack.id, pack.manifest.name, tool, actor)))
}

function mcpTools(): ToolDescriptor[] {
  return listMcpServers().flatMap((server) => (server.tools || []).map((tool) => {
    const connected = server.enabled && server.status === 'connected'
    return {
      name: `mcp__${safeName(server.id)}__${safeName(tool.name)}`,
      title: tool.name,
      description: `[MCP:${server.name}] ${tool.description || tool.name}`,
      source: 'mcp' as const,
      sourceId: server.id,
      enabled: connected,
      executable: connected,
      status: connected ? 'ready' as const : server.enabled ? 'unavailable' as const : 'disabled' as const,
      statusText: connected ? 'MCP 已连接' : server.enabled ? `MCP ${server.status || '未连接'}` : 'MCP 已停用',
      inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema as Record<string, unknown> : EMPTY_SCHEMA,
      permissions: ['mcp.call'],
      risk: 'external' as const,
      sideEffects: ['call:mcp'],
      whenToUse: [],
      handler: { type: 'mcp-tool', serverId: server.id, toolName: tool.name },
    }
  }))
}

function skillTools(): ToolDescriptor[] {
  return listSkills().filter((skill) => skill.exposure === 'agent' && skill.allowImplicitInvocation !== false).map((skill) => ({
    name: `skill__${skill.id}`,
    title: skill.name,
    description: `[技能:${skill.name}] ${skill.description}`,
    source: 'skill' as const,
    sourceId: skill.id,
    enabled: skill.enabled,
    executable: skill.enabled,
    status: skill.enabled ? 'ready' as const : 'disabled' as const,
    statusText: skill.enabled ? 'Skill 已启用' : 'Skill 已停用',
    inputSchema: skill.inputSchema || EMPTY_SCHEMA,
    permissions: skill.v2 ? [
      skill.v2.permissions.readsFiles ? 'files.read' : '',
      skill.v2.permissions.writesFiles ? 'files.write' : '',
      skill.v2.permissions.network ? 'network.fetch' : '',
      ...skill.v2.permissions.sensitive,
    ].filter(Boolean) : [],
    risk: skill.v2?.permissions.network ? 'external' as const : skill.v2?.permissions.writesFiles ? 'write' as const : 'read' as const,
    sideEffects: skill.v2?.permissions.writesFiles ? ['write:files'] : [],
    whenToUse: skill.v2?.triggers || [],
    handler: { type: 'skill', skillId: skill.id },
  }))
}

export function listToolDescriptors(actor?: AuthUser | null) {
  return [...systemTools(), ...fileTools(), ...developerTools(actor), ...mcpTools(), ...skillTools()]
}

export function toolCatalogSnapshot(options: { source?: ToolSource; sourceId?: string; appId?: string; executableOnly?: boolean; actor?: AuthUser | null } = {}): ToolCatalogSnapshot {
  let descriptors = listToolDescriptors(options.actor)
  if (options.source) descriptors = descriptors.filter((tool) => tool.source === options.source)
  if (options.sourceId) descriptors = descriptors.filter((tool) => tool.sourceId === options.sourceId)
  if (options.appId) descriptors = descriptors.filter((tool) => tool.appId === options.appId || tool.sourceId === options.appId)
  if (options.executableOnly) descriptors = descriptors.filter((tool) => tool.enabled && tool.executable)
  const tools = descriptors.filter((tool) => tool.enabled && tool.executable).map(functionTool)
  const sources: Record<ToolSource, number> = { system: 0, file: 0, app: 0, mcp: 0, skill: 0 }
  for (const tool of descriptors) sources[tool.source] += 1
  return {
    descriptors,
    tools,
    summary: {
      total: descriptors.length,
      ready: descriptors.filter((tool) => tool.status === 'ready').length,
      pending: descriptors.filter((tool) => tool.status === 'pending').length,
      sources,
    },
  }
}

function weatherSentence(wx: WeatherResult) {
  const today = wx.daily[0]
  return `${wx.city}当前${wx.current.text}，气温 ${wx.current.temp}°，体感 ${wx.current.feels}°，今日最高 ${today?.max ?? '--'}°、最低 ${today?.min ?? '--'}°。`
}

function ensurePermissions(actor: AuthUser | null | undefined, permissions: string[]) {
  for (const permission of permissions) {
    if (!canUseAppPermission(actor, permission)) throw new Error(`当前账户没有打开此 APP 的权限：${permission}`)
  }
}

export async function runCatalogTool(name: string, args: Record<string, unknown>, actor?: AuthUser | null) {
  const descriptor = listToolDescriptors(actor).find((tool) => tool.name === name)
  if (!descriptor) throw new Error(`未知工具：${name}`)
  if (descriptor.handler.type === 'client') throw new Error('此工具由桌面客户端执行，不能通过服务端直接运行。')
  if (descriptor.source === 'app') {
    ensurePermissions(actor, descriptor.permissions)
    if (!descriptor.executable) throw new Error(descriptor.statusText || '此 APP 工具暂不可执行')
    const pack = listDeveloperApps().find((item) => item.id === descriptor.sourceId)
    const tool = pack?.capabilities?.tools?.find((item) => item.name === name)
    if (!pack || !tool) throw new Error(`未知 APP 工具：${name}`)
    const handler = tool.handler || { type: tool.handlerType }
    if (handler.type === 'frontend-bridge' && isWeatherTool(tool)) {
      const weather = await getWeather(String(args.city || '成都'))
      return { text: weatherSentence(weather), weather }
    }
    if (handler.type === 'skill' && handler.skillId) {
      const instruction = String(args.instruction || args.prompt || '').trim()
      const shouldAddWeather = /天气|weather/i.test(instruction)
      let finalInstruction = instruction
      if (shouldAddWeather) {
        const weatherPermission = pack.capabilities.permissions.find((permission) => /weather|天气/i.test(permission))
        if (weatherPermission) ensurePermissions(actor, [weatherPermission])
        const weather = await getWeather(String(args.city || '成都'))
        finalInstruction = `请用一句话回答用户问题。天气数据：${weatherSentence(weather)}\n用户问题：${instruction}`
      }
      return runSkill(handler.skillId, { ...args, instruction: finalInstruction })
    }
    if (handler.type === 'mcp-tool' && handler.serverId && handler.toolName) {
      return { text: await callMcpDirect(handler.serverId, handler.toolName, args || {}) }
    }
    throw new Error('此 APP 工具已登记，但当前执行器还没有安全映射。')
  }
  throw new Error(`工具 ${name} 暂未接入统一执行入口。`)
}
