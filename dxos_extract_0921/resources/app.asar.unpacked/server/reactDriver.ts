import { chatWithTools, type ResolvedProvider, type ToolMessage } from './protocols.ts'
import { firstUsableProvider } from './store.ts'
import { resolveAgentRoute } from './capabilityRouter.ts'
import { callByName as callMcpByName } from './mcp.ts'
import { runSkill } from './skills.ts'
import { runTool, ToolError, type ToolResult } from './agentTools.ts'
import {
  appendDynamicStep, appendTaskEvent, addMemory, beginOperation, completeStep, consumeBudget,
  failStep, failTaskFenced, findOperation, finishOperation, getTask, listMemories, postTaskMessage, savePlan, sealStaleReactSteps, startStep,
  taskIsRunning, threadVisibility, waitForUser, DEFAULT_BUDGET, type TaskView, type TaskBudget,
} from './taskStore.ts'

/**
 * M4 ReAct Driver：react 模式任务的服务端执行循环。
 * 特点（对照计划 4.3 的控制边界）：
 * - 模型只能在授权工具集内选择动作；权限由 Registry 暴露前+执行前双检
 * - 每次模型/工具调用消耗预算（consumeBudget），超限任务失败而不是伪装完成
 * - 每个工具动作都是持久步骤（appendDynamicStep）+ operationId 幂等
 * - 完成不由模型文字决定：模型声明 finish 后仍要过 verifyTask 门禁
 * - 需要用户决策时用 ask_user 进入 waiting_user，而不是瞎猜
 */

const FINISH_TOOL = {
  type: 'function',
  function: {
    name: 'finish_task',
    description: '所有目标都已完成、交付物已写入项目后调用，结束任务。',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: '给用户的完成总结（都做了什么、产出了哪些文件）' } },
      required: ['summary'],
    },
  },
}
const ASK_TOOL = {
  type: 'function',
  function: {
    name: 'ask_user',
    description: '缺少关键信息且无法合理假设时，向用户提一个问题并暂停任务。整个任务最多问 2 次，能用合理默认值时不要问。',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: '要问用户的问题（合并成一条，最多 2 个点）' } },
      required: ['question'],
    },
  },
}
const MEMORY_TOOL = {
  type: 'function',
  function: {
    name: 'save_memory',
    description: '把本次任务确认的稳定事实/决定存入项目记忆（例如“主角叫苏然”“文档统一用中文”）。只存跨任务有用的长期事实，不存执行细节。',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string', description: '一句话事实或决定' } },
      required: ['content'],
    },
  },
}

const SYSTEM = `你是 DX OS 的项目 Agent，在一个项目文件夹内完成用户交办的任务。
规则：
- 用提供的文件工具实际完成工作，路径都相对项目根目录。
- 先规划后动手；文件放在合理的子目录结构里。
- 用户要求创建文件夹时，先用 fs_mkdir 创建文件夹，再把文件创建到该文件夹内（如 剧本/短剧剧本.md）。
- 缺少次要信息时使用合理默认值并继续；只有关键决策才用 ask_user（整个任务最多 2 次）。
- 全部完成后调用 finish_task 并总结产出。不要在没有实际写入文件前调用 finish_task。
- 回复和文件内容都使用中文（除非用户要求其它语言）。
- writing、rewrite、code、analysis 是官方文本预设，仅用于明确的内容成品或转换；不要用它们做任务规划、复述工具结果或普通判断。
- 自动工具集中只包含系统 Skill；用户导入或创建的功能 Skill 只能由用户通过 /技能ID 手动调用，不要猜测或自动选择功能 Skill。
- 图片、视频和音频请求必须使用对应系统能力，不要用文本预设假装已经生成媒体。
- 查看、描述、分析、识别、反推或检查项目内已有图片必须调用准确名称 skill__describe_image，把项目相对路径传给 image；它已启用，不得声称不可用，不要用 fs_read 读取图片，也不要要求用户重复上传。
- 普通生图用 skill__generate_image；修改已有图片用 skill__edit_image；批量同类处理或组合出图用 skill__batch_image_group_process；普通图片超分用 skill__upscale_image。
- 文生视频、图生视频、首尾帧及音视频参考生成用 skill__generate_video；旁白用 skill__text_to_speech；录音转写/翻译用 skill__transcribe_audio；歌曲或配乐用 skill__generate_music。
- 只有用户明确指定 Midjourney 或要求其专属操作时才用 skill__midjourney。`

const PROFILE_CONFIG = {
  assistant: { budget: { maxModelCalls: 10, maxToolCalls: 24 }, plan: false, skills: true, memory: false },
  thinking: { budget: DEFAULT_BUDGET, plan: true, skills: true, memory: true },
} satisfies Record<'assistant' | 'thinking', { budget: TaskBudget; plan: boolean; skills: boolean; memory: boolean }>

/** 快速模式中可一次成稿的单文档任务。此类任务不需要“创建后再逐段润色”的 ReAct 循环。 */
export function isSingleDocumentCreation(instruction: string) {
  const wantsCreate = /(创建|新建|生成|创作|落地|撰写|写一(?:篇|份|个)|保存为)/.test(instruction)
  const isDocument = /(Markdown|\.md\b|文稿|文章|小说|剧本|故事|报告|方案|说明书|文档)/i.test(instruction)
  const isMultiArtifact = /(多个|若干|一组|批量|每个文件|分别保存|拆分(?:为|成)|分章节保存|目录结构)/.test(instruction)
  const isEditing = /(修改|改写|重写|润色|校对|追加|更新|整理现有|已有文件)/.test(instruction)
  return wantsCreate && isDocument && !isMultiArtifact && !isEditing
}

export function requestedDocumentLength(instruction: string) {
  const match = instruction.match(/(?:约|大约|篇幅(?:为|适中，?)?)?\s*(\d{3,6})\s*[—–~-]\s*(\d{3,6})\s*字/)
  if (!match) return null
  const min = Number(match[1]); const max = Number(match[2])
  return min > 0 && max >= min ? { min, max } : null
}

function fastDocumentLengthError(task: TaskView, callName: string, args: Record<string, unknown>) {
  if (callName !== 'fs_create' && callName !== 'fs_write') return ''
  const range = requestedDocumentLength(task.instruction)
  if (!range) return ''
  const length = String(args.content ?? '').replace(/\s/g, '').length
  if (length >= range.min && length <= range.max) return ''
  return `正文当前约 ${length} 字，不符合用户要求的 ${range.min}—${range.max} 字。请重新生成一份范围内的完整正文并一次性写入；不要拆成局部编辑。`
}

function systemForTask(task: TaskView, fastDocument: boolean) {
  if (!fastDocument) return SYSTEM
  return `${SYSTEM}\n\n当前为 AI 助理快速单文档任务：
- 在调用文件工具前，在本次模型响应内部完成构思、写作、字数与要求检查。
- 一次性生成可直接交付的完整正文，只允许创建目录并用 fs_create 或 fs_write 写入一次。
- 写入成功即视为完成，不要再读取、追加、局部替换、润色或二次改写。严格遵守用户要求的篇幅范围。`
}

export type ReactOutcome =
  | { kind: 'finished'; summary: string }
  | { kind: 'waiting_user' }
  | { kind: 'stopped' }          // 任务被暂停/取消/租约丢失
  | { kind: 'failed'; code: string; message: string }

type ProviderPick = { provider: ResolvedProvider; model: string }

export function pickLlm(preferences: { providerId?: string | null; llmModel?: string | null } = {}): ProviderPick | null {
  try {
    const route = resolveAgentRoute({ preferredProviderId: preferences.providerId || undefined, preferredModel: preferences.llmModel || undefined }).model
    if (!route.missing.includes('llm.tools')) return { provider: route.provider, model: route.model }
  } catch { /* fall back to legacy coarse routing */ }
  const stored = firstUsableProvider('llm')
  if (!stored) return null
  const model = stored.models?.find((m) => (m.caps || []).includes('llm'))?.model || stored.models?.[0]?.model
  if (!model) return null
  return { provider: { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }, model }
}

/** 恢复上下文（计划 5.4）：目标+计划+项目记忆+已完成步骤摘要，不重放全部聊天。 */
function buildContext(task: TaskView): ToolMessage[] {
  const messages: ToolMessage[] = []
  const plan = task.plan
  const done = task.steps.filter((s) => s.status === 'completed')
  const memories = listMemories(task.project_id).slice(0, 20)
  const parts = [
    `任务目标：${task.instruction}`,
    plan && plan.goal !== task.instruction ? `当前计划：${plan.goal}` : '',
    plan?.assumptions && plan.assumptions !== '[]' ? `已确认假设：${plan.assumptions}` : '',
    plan?.acceptance && plan.acceptance !== '[]' ? `验收条件：${plan.acceptance}` : '',
    memories.length ? `项目记忆（跨对话共享的既定事实，遵守它们）：\n${memories.map((m) => `- ${m.content}`).join('\n')}` : '',
  ].filter(Boolean)
  // waiting_user 后带上用户最新回答
  const answered = task.events.filter((e) => e.type === 'task.answered').at(-1)
  if (answered) parts.push(`用户最新补充或回答：${answered.message}`)
  messages.push({ role: 'user', content: parts.join('\n') })
  if (done.length) {
    const recent = done.slice(-12).map((s) => {
      let out = ''
      try { out = String((JSON.parse(s.output_json || '{}') as { message?: string }).message || '') } catch { /* ignore */ }
      return `- ${s.title}${out ? `：${out}` : ''}`
    })
    messages.push({ role: 'assistant', content: `我已经完成了以下步骤：\n${recent.join('\n')}${done.length > 12 ? `\n（更早的 ${done.length - 12} 步略）` : ''}` })
    messages.push({ role: 'user', content: '请继续完成剩余工作。已完成的不要重做。' })
  }
  return messages
}

/** Planner：首轮为任务生成计划（假设+验收条件），写入 task_plans。 */
async function planIfNeeded(task: TaskView, llm: ProviderPick): Promise<void> {
  const continuedSequence = task.events.filter((e) => e.type === 'task.continued').at(-1)?.sequence || 0
  const planned = task.events.some((e) => e.type === 'task.planned' && e.sequence > continuedSequence)
  if (planned) return
  if (!consumeBudget(task.id, 'model')) throw new ToolError('internal', '模型调用预算耗尽')
  const planTool = {
    type: 'function',
    function: {
      name: 'submit_plan',
      description: '提交任务执行计划',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '一句话目标' },
          assumptions: { type: 'array', items: { type: 'string' }, description: '未询问用户、直接采用的假设（可为空）' },
          acceptance: { type: 'array', items: { type: 'string' }, description: '3-6 条可检查的验收条件' },
        },
        required: ['goal', 'acceptance'],
      },
    },
  }
  const latestRequirement = task.events.filter((e) => e.type === 'task.answered').at(-1)?.message
  const planningGoal = latestRequirement ? `${task.instruction}\n\n用户本轮追加要求：${latestRequirement}` : task.instruction
  const r = await chatWithTools(
    llm.provider, llm.model,
    [{ role: 'user', content: `为以下任务制定执行计划（不要开始执行）：\n${planningGoal}` }],
    '你是任务规划器。用 submit_plan 提交简洁的计划。假设写明默认值；验收条件必须可检查（文件存在、内容包含某要素等）。',
    [planTool], 120_000,
  )
  const call = r.toolCalls.find((c) => c.name === 'submit_plan')
  let plan = { goal: planningGoal, assumptions: [] as string[], acceptance: [] as string[] }
  if (call) {
    try {
      const args = JSON.parse(call.arguments || '{}') as { goal?: string; assumptions?: string[]; acceptance?: string[] }
      plan = {
        goal: String(args.goal || task.instruction),
        assumptions: Array.isArray(args.assumptions) ? args.assumptions.map(String).slice(0, 10) : [],
        acceptance: Array.isArray(args.acceptance) ? args.acceptance.map(String).slice(0, 10) : [],
      }
    } catch { /* 解析失败用默认计划 */ }
  }
  savePlan(task.id, plan)
}

export async function runReactTask(taskId: string, workerId: string, rootNodeId: string, userId: string): Promise<ReactOutcome> {
  sealStaleReactSteps(taskId)
  let task = getTask(taskId)!
  const llm = pickLlm({ providerId: task.preferred_provider_id, llmModel: task.preferred_llm_model })
  if (!llm) return { kind: 'failed', code: 'no_llm_provider', message: '没有可用的模型站点：请在「API 设置」中启用一个带 LLM 模型的站点后恢复任务' }
  // 旧任务中的 expert 与缺省值均按新的思考模式执行。
  const profile = task.execution_profile === 'assistant' ? PROFILE_CONFIG.assistant : PROFILE_CONFIG.thinking
  const fastDocument = task.execution_profile === 'assistant' && isSingleDocumentCreation(task.instruction)
  const budget = fastDocument ? { maxModelCalls: 3, maxToolCalls: 4 } : profile.budget
  try {
    if (!taskIsRunning(taskId, workerId)) return { kind: 'stopped' }
    if (profile.plan) await planIfNeeded(task, llm)
  } catch (e) {
    return { kind: 'failed', code: 'planner_failed', message: `规划失败：${String((e as Error).message || e)}` }
  }

  task = getTask(taskId)!
  const askCount = task.events.filter((e) => e.type === 'task.waiting_user').length
  // 工具声明来自 Capability Router；执行层暂时保留旧 file/skill 兼容分支。
  let routeTools: ReturnType<typeof resolveAgentRoute>['tools'] = []
  try { routeTools = resolveAgentRoute().tools } catch { /* 能力路由不可用时降级为空工具集 */ }
  if (!profile.skills) routeTools = routeTools.filter((tool) => !tool.function.name.startsWith('skill__'))
  if (fastDocument) {
    const allowed = new Set(['fs_mkdir', 'fs_create', 'fs_write'])
    routeTools = routeTools.filter((tool) => allowed.has(tool.function.name))
  }
  const tools = [...routeTools, FINISH_TOOL, ...(profile.memory ? [MEMORY_TOOL] : []), ...(askCount < 2 ? [ASK_TOOL] : [])]
  const messages = buildContext(task)
  const system = systemForTask(task, fastDocument)

  for (;;) {
    if (!taskIsRunning(taskId, workerId)) return { kind: 'stopped' }
    if (!consumeBudget(taskId, 'model', budget)) {
      return { kind: 'failed', code: 'budget_exhausted', message: `模型调用达到上限（${budget.maxModelCalls} 次），任务未完成` }
    }
    let round: { content: string; toolCalls: { id: string; name: string; arguments: string }[] }
    try {
      round = await chatWithTools(llm.provider, llm.model, messages, system, tools, 240_000)
    } catch (e) {
      return { kind: 'failed', code: 'model_error', message: `模型调用失败：${String((e as Error).message || e)}` }
    }
    if (!round.toolCalls.length) {
      // 模型只说话不动手：提醒一次，第二次按失败处理
      messages.push({ role: 'assistant', content: round.content || '' })
      messages.push({ role: 'user', content: '请调用工具继续执行，全部完成后调用 finish_task。' })
      appendTaskEvent(taskId, 'react.note', (round.content || '（空回复）').slice(0, 300))
      const currentEvents = getTask(taskId)!.events
      const continuedSequence = currentEvents.filter((e) => e.type === 'task.continued').at(-1)?.sequence || 0
      const notes = currentEvents.filter((e) => e.type === 'react.note' && e.sequence > continuedSequence).length
      if (notes >= 3) return { kind: 'failed', code: 'model_stalled', message: '模型连续多轮未执行任何动作' }
      continue
    }

    messages.push({
      role: 'assistant', content: round.content || '',
      tool_calls: round.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    })

    for (const call of round.toolCalls) {
      if (!taskIsRunning(taskId, workerId)) return { kind: 'stopped' }
      const args = safeParse(call.arguments)

      if (call.name === 'finish_task') {
        const summary = String(args.summary || '任务完成')
        return { kind: 'finished', summary }
      }
      if (call.name === 'ask_user') {
        const question = String(args.question || '需要你的补充说明')
        if (waitForUser(taskId, workerId, question)) {
          postTaskMessage(taskId, 'assistant', `❓ ${question}`)
          return { kind: 'waiting_user' }
        }
        return { kind: 'stopped' }
      }
      if (call.name === 'save_memory') {
        const content = String(args.content || '').trim()
        let note = '记忆内容为空，未保存'
        if (content) {
          try {
            const current = getTask(taskId)!
            // 计划 11：私人对话的任务不能自动写入共享项目记忆
            const thread = threadVisibility(current.thread_id)
            if (thread === 'private') {
              note = '本任务来自私人对话，未写入共享项目记忆（可在项目「记忆」标签手动添加）'
            } else {
              const memory = addMemory({ projectId: current.project_id, content, sourceType: 'task', sourceId: taskId })
              appendTaskEvent(taskId, 'memory.saved', content.slice(0, 200), { memoryId: memory.id })
              note = `已存入项目记忆：${content}`
            }
          } catch (e) { note = `记忆保存失败：${String((e as Error).message || e)}` }
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: note })
        continue
      }

      // 文件/Skill/MCP 工具：持久步骤 + 幂等 + 预算
      const lengthError = fastDocument ? fastDocumentLengthError(task, call.name, args) : ''
      if (lengthError) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: lengthError })
        continue
      }
      if (!consumeBudget(taskId, 'tool', budget)) {
        return { kind: 'failed', code: 'budget_exhausted', message: `工具调用达到上限（${budget.maxToolCalls} 次），任务未完成` }
      }
      const stepLabel = call.name.startsWith('skill__')
        ? `技能 ${call.name.slice(7)}`
        : `${call.name} ${String(args.path || args.from || '')}`.trim()
      let step: { id: string; ordinal: number; operation_id: string }
      try {
        step = appendDynamicStep(taskId, stepLabel, call.name, args)
      } catch {
        // UNIQUE 冲突 = 另一个 Worker 已接管本任务
        return { kind: 'stopped' }
      }
      if (!startStep(taskId, step.id, workerId)) return { kind: 'stopped' }
      appendTaskEvent(taskId, 'step.started', stepLabel)
      let observation: string
      try {
        const previous = findOperation(step.operation_id)
        let result: ToolResult
        if (previous?.status === 'completed' && previous.result_json) {
          result = JSON.parse(previous.result_json) as ToolResult
        } else if (call.name.startsWith('skill__')) {
          beginOperation(step.operation_id, taskId, call.name)
          const skill = await runSkill(call.name.slice(7), args, {
            rootId: rootNodeId,
            providerId: task.preferred_provider_id || undefined,
            model: task.preferred_llm_model || undefined,
            imageProviderId: task.preferred_image_provider_id || undefined,
            imageModel: task.preferred_image_model || undefined,
          })
          const firstMedia = skill.images?.[0] || skill.videos?.[0] || skill.audios?.[0]
          result = {
            message: `技能 ${call.name.slice(7)} 完成`,
            content: skill.text.slice(0, 8000),
            ...(firstMedia ? { deliverable: true, nodeId: firstMedia.nodeId, name: firstMedia.name } : {}),
          }
          finishOperation(step.operation_id, result)
        } else if (call.name.startsWith('mcp__')) {
          beginOperation(step.operation_id, taskId, call.name)
          result = { message: `MCP 工具 ${call.name} 完成`, content: (await callMcpByName(call.name, args)).slice(0, 8000) }
          finishOperation(step.operation_id, result)
        } else {
          beginOperation(step.operation_id, taskId, call.name)
          result = runTool(call.name, { rootNodeId, userId }, args)
          finishOperation(step.operation_id, result)
        }
        const task2 = getTask(taskId)!
        const deliverable = result.deliverable && result.nodeId
          ? { projectId: task2.project_id, nodeId: result.nodeId, name: result.name || call.name }
          : undefined
        if (!completeStep(taskId, step.id, workerId, result, deliverable)) return { kind: 'stopped' }
        observation = formatObservation(result)
        if (fastDocument && result.deliverable && (call.name === 'fs_create' || call.name === 'fs_write')) {
          const path = String(args.path || result.name || '文档')
          return { kind: 'finished', summary: `已完成文稿并保存至 \`${path}\`` }
        }
      } catch (e) {
        const code = e instanceof ToolError ? e.code : 'internal'
        const message = String((e as Error).message || e)
        failStep(taskId, step.id, workerId, message)
        // 工具失败不终止任务：把错误交给模型修正参数（计划 M4 验证点）
        observation = `工具执行失败（${code}）：${message}`
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: observation.slice(0, 6000) })
    }
  }
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s || '{}') as Record<string, unknown> } catch { return {} }
}

function formatObservation(result: ToolResult): string {
  const parts = [result.message]
  if (result.content !== undefined) parts.push(result.content.slice(0, 4000))
  if (result.entries) parts.push(result.entries.map((e) => `${e.type === 'folder' ? '文件夹' : '文件'} ${e.name}`).join('\n') || '(空)')
  return parts.filter(Boolean).join('\n')
}

/** react 任务失败：围栏在 workerId 上，租约被接管后旧 Worker 不能改状态。 */
export function markReactFailure(taskId: string, workerId: string, code: string, message: string) {
  const changed = failTaskFenced(taskId, workerId, code, message)
  if (!changed) return
  if (code !== 'no_llm_provider') postTaskMessage(taskId, 'system', `任务失败：${message}`)
}
