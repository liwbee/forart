import { runTool, ToolError } from './agentTools.ts'
import { callChat, chatWithTools, type ToolMessage } from './protocols.ts'
import { pickLlm, isSingleDocumentCreation, requestedDocumentLength } from './reactDriver.ts'
import { resolveAgentRoute } from './capabilityRouter.ts'
import { runSkill } from './skills.ts'
import { callByName as callMcpByName } from './mcp.ts'
import type { AuthUser } from './auth.ts'

type ProjectRef = { id: string; name: string; root_node_id: string }
export type AssistantPreferences = { providerId?: string; llmModel?: string; imageProviderId?: string; imageModel?: string }

export type AssistantExecutionLane = 'direct' | 'thinking-worker'

export function assistantExecutionLane(mode: string): AssistantExecutionLane {
  if (mode === 'thinking') return 'thinking-worker'
  return 'direct'
}

function explicitMarkdownPath(instruction: string) {
  const quoted = instruction.match(/[`「“"]([^`」”"]+\.md)[`」”"]/i)?.[1]
  if (!quoted) return ''
  return quoted.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function documentName(instruction: string) {
  const explicit = explicitMarkdownPath(instruction)
  if (explicit) return explicit
  if (/玄幻/.test(instruction) && /剧本/.test(instruction)) return '玄幻小说剧本.md'
  if (/剧本/.test(instruction)) return '原创剧本.md'
  if (/小说|故事/.test(instruction)) return '原创故事.md'
  if (/报告/.test(instruction)) return '项目报告.md'
  if (/方案/.test(instruction)) return '项目方案.md'
  return '项目文稿.md'
}

function visibleRootEntries(rootNodeId: string, userId: string) {
  const result = runTool('fs_list', { rootNodeId, userId }, {})
  return (result.entries || []).filter((entry) => entry.name !== '.ccs-ai')
}

function chooseDocumentPath(instruction: string, entries: Array<{ name: string; type: string }>) {
  const name = documentName(instruction)
  if (name.includes('/')) return name
  const folders = entries.filter((entry) => entry.type === 'folder').map((entry) => entry.name)
  const preferred = /剧本/.test(instruction)
    ? ['剧本', 'scripts', 'stories', 'docs', '文档']
    : /小说|故事/.test(instruction)
      ? ['故事', 'stories', 'docs', '文档']
      : ['docs', '文档']
  const folder = preferred.find((candidate) => folders.some((item) => item.toLowerCase() === candidate.toLowerCase()))
  return folder ? `${folder}/${name}` : name
}

function stripOuterFence(text: string) {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  return (match?.[1] || trimmed).trim()
}

function contentLength(text: string) {
  return text.replace(/\s/g, '').length
}

export function directDocumentRequest(instruction: string) {
  return isSingleDocumentCreation(instruction)
}

/**
 * AI 助理的单文档直达路径：一次普通文本生成 + 一次服务端写入。
 * 不创建 task，不进入 Worker，也不把数千字正文塞进 function-call 参数。
 */
export async function createDocumentDirect(project: ProjectRef, userId: string, instruction: string, preferences: AssistantPreferences = {}) {
  const llm = pickLlm(preferences)
  if (!llm) throw new Error('没有可用的模型站点：请在「API 设置」中启用一个带 LLM 模型的站点')
  const entries = visibleRootEntries(project.root_node_id, userId)
  const path = chooseDocumentPath(instruction, entries)
  const structure = entries.length
    ? entries.map((entry) => `${entry.type === 'folder' ? '目录' : '文件'}：${entry.name}`).join('\n')
    : '项目中暂无用户文件。'
  const range = requestedDocumentLength(instruction)
  const system = `你是 DX OS 的中文文稿创作助理。请直接输出最终可落盘的 Markdown 文稿正文。
规则：
- 完整满足用户要求，内容原创，可独立阅读。
- 只输出 Markdown 正文，不要使用代码围栏，不要解释文件路径或创作过程。
- 在一次回答内完成构思、写作和自检，不提供草稿，不在正文后追加修改说明。
${range ? `- 正文字数必须控制在 ${range.min}—${range.max} 字。` : ''}`
  const prompt = `用户要求：\n${instruction}\n\n项目结构（仅供判断语境，系统已选择安全保存位置）：\n${structure}\n\n请输出最终 Markdown 正文。`
  const generated = await callChat(llm.provider, llm.model, { prompt, system }, { max_tokens: 10000 }, 300_000)
  const content = stripOuterFence(generated.text)
  if (!content) throw new Error('模型没有生成文稿内容')
  if (range) {
    const length = contentLength(content)
    if (length < range.min || length > range.max) {
      throw new Error(`生成正文约 ${length} 字，不符合 ${range.min}—${range.max} 字要求，请重试`)
    }
  }
  try {
    runTool('fs_create', { rootNodeId: project.root_node_id, userId }, { path, content }, new Set(['fs_create']))
  } catch (error) {
    if (!(error instanceof ToolError) || error.code !== 'conflict') throw error
    throw new Error(`文件已存在：${path}。如需覆盖或修改，请明确说明`)
  }
  return {
    path,
    filesChanged: true,
    text: `已创建 \`${path}\`。\n\n内容概要：已按要求完成作品设定、主要人物、核心冲突和完整分幕/分场正文，并保留可继续扩展的故事线。`,
  }
}

function observation(result: ReturnType<typeof runTool>) {
  return [
    result.message,
    result.content?.slice(0, 5000),
    result.entries?.filter((entry) => entry.name !== '.ccs-ai').map((entry) => `${entry.type === 'folder' ? '目录' : '文件'} ${entry.name}`).join('\n'),
  ].filter(Boolean).join('\n') || '(空)'
}

/** AI 助理即时路径：文件、Skill、MCP 工具循环，无任务与 Worker。 */
export async function runAssistantDirect(
  project: ProjectRef,
  actor: AuthUser,
  instruction: string,
  history: Array<{ role: string; content: string }> = [],
  preferences: AssistantPreferences = {},
) {
  const userId = actor.id
  if (directDocumentRequest(instruction)) return createDocumentDirect(project, userId, instruction, preferences)
  const llm = pickLlm(preferences)
  if (!llm) throw new Error('没有可用的模型站点：请在「API 设置」中启用一个带 LLM 模型的站点')
  const tools = resolveAgentRoute({ instruction, projectId: project.id, rootNodeId: project.root_node_id, actor, preferredProviderId: preferences.providerId, preferredModel: preferences.llmModel }).tools
  const system = `你是 DX OS 项目「${project.name}」的 AI 助理，当前走即时工具模式。
- 简单问答直接回答；需要时使用项目文件工具并在当前请求内完成。
- 可以自动调用项目文件工具、系统 Skill 和已连接的 MCP。用户导入或创建的功能 Skill 不在自动工具集中，只能由用户在输入框用 /技能ID 手动调用。
- writing、rewrite、code、analysis 是官方文本预设，只在用户明确需要对应成品或转换时调用；普通问答直接回答，不调用文本预设。
- skill__generate_image、skill__upscale_image、skill__edit_image、skill__batch_image_group_process、skill__describe_image、skill__generate_video、skill__text_to_speech、skill__transcribe_audio、skill__generate_music、skill__midjourney 是会执行真实媒体操作的系统能力；不要用文本预设代替它们。
- 查看、描述、分析、识别、反推或检查项目内已有图片，必须调用准确名称 skill__describe_image，把项目相对路径直接传给 image；它已启用，不得声称工具不可用，不要用 fs_read 读取图片，也不要要求用户重复上传。
- 修改一张或少量已有图片用 skill__edit_image；多张图片执行同一种处理、分组合成或组合出图用 skill__batch_image_group_process。
- 文生视频、图生视频、首尾帧或音视频参考生成统一使用 skill__generate_video，并把项目素材相对路径传入对应参数。
- 旁白和语音播报用 skill__text_to_speech；已有录音转文字或翻译用 skill__transcribe_audio；歌曲和配乐用 skill__generate_music。
- 放大一张普通已有图片使用 skill__upscale_image；Midjourney 任务网格的 U 操作仍使用 skill__midjourney。
- 普通生图使用 skill__generate_image；只有用户明确指定 Midjourney，或要求 Blend、U/V、Reroll、Zoom、Pan、Inpaint、Remix 等 Midjourney 专属操作时才使用 skill__midjourney。
- 不创建后台任务，不做持久化计划、进度跟踪、检查点恢复或严格交付验收。
- 选择最直接的执行路径，避免重复读取和重复调用；完成后说明实际结果及保存位置。
- 不要进入或读取 .ccs-ai，这是系统元数据目录。
- 如果工作明显需要长时间反复检查、恢复与严格验收，说明建议切换思考模式。`
  const messages: ToolMessage[] = [
    ...history.filter((item) => item.role === 'user' || item.role === 'assistant')
      .slice(-8).map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })),
    { role: 'user', content: instruction },
  ]
  let operationCount = 0
  let filesChanged = false
  let continuationRequired = false
  const wantsImageDescription = /(?:描述|识别|分析|查看|看看|看一下|反推|检查).{0,24}(?:图片|图像|照片|画面|\.png\b|\.jpe?g\b|\.webp\b)|(?:图片|图像|照片|画面|\.png\b|\.jpe?g\b|\.webp\b).{0,24}(?:描述|识别|分析|查看|看看|看一下|反推|检查)/i.test(instruction)
  const hasDescribeImageTool = tools.some((tool) => tool.function.name === 'skill__describe_image')
  let imageRouteRetried = false
  for (let roundIndex = 0; roundIndex < 10; roundIndex++) {
    const round = await chatWithTools(llm.provider, llm.model, messages, system, tools, 240_000)
    if (!round.toolCalls.length) {
      if (continuationRequired) {
        return {
          path: '', filesChanged, continuationRequired: true,
          text: '本轮即时处理已达到工具调用上限，当前成果已保留，但任务尚未确认完成。',
        }
      }
      if (wantsImageDescription && hasDescribeImageTool && !imageRouteRetried) {
        imageRouteRetried = true
        messages.push({ role: 'assistant', content: round.content || '' })
        messages.push({
          role: 'user',
          content: '系统纠偏：skill__describe_image 已启用并在本轮工具列表中。不要回复“无法读取/未启用/请上传”；先用 fs_list 定位图片（若尚未定位），然后立即调用 skill__describe_image，并把项目相对路径传给 image。',
        })
        continue
      }
      return { path: '', filesChanged, continuationRequired: false, text: round.content?.trim() || '已完成。' }
    }
    messages.push({
      role: 'assistant', content: round.content || '',
      tool_calls: round.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })),
    })
    for (const call of round.toolCalls) {
      if (operationCount >= 24) {
        continuationRequired = true
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'AI 助理即时模式已达到 24 次工具调用上限，请根据已有结果直接总结；如仍未完成，建议切换思考模式。' })
        continue
      }
      try {
        const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>
        operationCount++
        if (call.name.startsWith('skill__')) {
          const result = await runSkill(call.name.slice(7), args, {
            rootId: project.root_node_id,
            providerId: preferences.providerId,
            model: preferences.llmModel,
            imageProviderId: preferences.imageProviderId,
            imageModel: preferences.imageModel,
          })
          const media = [...(result.images || []), ...(result.videos || []), ...(result.audios || [])]
          if (media.length) filesChanged = true
          messages.push({ role: 'tool', tool_call_id: call.id, content: [result.text, ...media.map(item => `已保存：${item.name}`)].filter(Boolean).join('\n').slice(0, 8000) })
        } else if (call.name.startsWith('mcp__')) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: (await callMcpByName(call.name, args)).slice(0, 8000) })
        } else {
          const result = runTool(call.name, { rootNodeId: project.root_node_id, userId }, args)
          if (!['fs_list', 'fs_read'].includes(call.name)) filesChanged = true
          messages.push({ role: 'tool', tool_call_id: call.id, content: observation(result) })
        }
      } catch (error) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: `操作失败：${String((error as Error).message || error)}` })
      }
    }
  }
  return {
    path: '', filesChanged, continuationRequired: true,
    text: '本轮即时处理已达到最高轮数，当前成果已保留，但任务尚未确认完成。',
  }
}
