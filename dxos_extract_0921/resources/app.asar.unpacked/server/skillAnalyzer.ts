import { callChat, chatWithTools } from './protocols.ts'
import { resolveChatTarget, type SkillDef, type SkillV2Meta } from './skills.ts'
import { FILE_TOOLS } from './agentTools.ts'
import { allProviders, getAutoFallback } from './store.ts'

/**
 * 第三方 Skill 的 Agent 解析（计划 7.2）：
 * 上传 → 解析文本（不执行）→ LLM 分析出结构化工作流/输入/工具白名单/权限声明
 * → 用户在导入预览里审核 → 启用后可在助手/APP 用 / 调出。
 */

const VALID_TOOLS = new Set(FILE_TOOLS.map((t) => t.name))
/** 基础 skill：procedure 执行时可调用的原子能力 */
const BASE_SKILLS = ['writing', 'rewrite', 'analysis', 'code', 'chat', 'generate_image', 'upscale_image', 'midjourney', 'generate_video', 'text_to_speech', 'transcribe_audio', 'generate_music', 'edit_image', 'describe_image']

const ANALYZE_TOOL = {
  type: 'function',
  function: {
    name: 'submit_skill_analysis',
    description: '提交对第三方 Skill 文档的结构化解析结果',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '小写字母开头的英文 id，如 weekly_report' },
        name: { type: 'string', description: '简短中文名称' },
        description: { type: 'string', description: '一句话说明该 Skill 做什么（120 字内）' },
        triggers: { type: 'array', items: { type: 'string' }, description: '2-4 条触发条件：用户什么样的请求应该用它' },
        inputs: { type: 'array', items: { type: 'string' }, description: '执行前需要用户提供的输入（人话，如“商品名称与卖点”）' },
        steps: {
          type: 'array',
          description: '3-8 个分步工作流。每步映射到平台基础能力：文档里“调用 API 生图”→ uses=generate_image；“写文案”→ uses=writing；纯思考/拼模板的步骤 uses 留空',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '步骤短标题' },
              detail: { type: 'string', description: '这一步做什么、用哪个资源模板、注意什么（100 字内）' },
              uses: { type: 'string', description: `这一步用的基础能力，从这些里选：${BASE_SKILLS.join(', ')}；不需要工具留空` },
            },
            required: ['title', 'detail'],
          },
        },
        allowedTools: { type: 'array', items: { type: 'string' }, description: `执行需要的基础能力白名单（steps 里 uses 的并集），可选：${BASE_SKILLS.join(', ')}` },
        resources: {
          type: 'array',
          description: '从文档提炼的可复用资源：提示词模板、风格参数、检查清单原文等。原样摘录（可精简），执行时会注入给模型',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '资源名，如“白底主图提示词模板”' },
              content: { type: 'string', description: '资源内容原文（2000 字内）' },
            },
            required: ['name', 'content'],
          },
        },
        readsFiles: { type: 'boolean', description: '是否需要读取项目文件' },
        writesFiles: { type: 'boolean', description: '是否会创建/修改文件（生图会保存文件，算 true）' },
        network: { type: 'boolean', description: '除基础能力自带的模型调用外，是否还需要额外联网（爬网页、调外部服务）。仅调 LLM/生图 API 的填 false，因为平台基础能力已覆盖' },
        sensitive: { type: 'array', items: { type: 'string' }, description: '文档中出现的敏感动作（发送消息、删除数据、账号操作等）；没有则空' },
        output: { type: 'string', description: '产出说明：生成什么、放到哪（80 字内）' },
        checks: { type: 'array', items: { type: 'string' }, description: '2-5 条完成前自查项（优先用文档自带的质检标准）' },
        systemPrompt: { type: 'string', description: '为该 Skill 提炼的执行 system prompt：角色 + 领域最佳实践摘要 + 输出规则，600 字内，中文' },
      },
      required: ['id', 'name', 'description', 'triggers', 'steps', 'allowedTools', 'readsFiles', 'writesFiles', 'network', 'output', 'checks', 'systemPrompt'],
    },
  },
}

const SYSTEM = `你是 DX OS 的 Skill 解析器。用户上传了第三方 Skill 文档，你要把它翻译成平台可执行的 Skill 定义。
核心原则：第三方 Skill 的价值在工作流知识（步骤、提示词模板、质检标准），执行能力一律替换成平台基础能力：
- 文档里的普通生图脚本/图像 API 调用 → uses=generate_image（平台会用用户配置的模型站点生图）；已有图片超分放大 → uses=upscale_image；明确要求 Midjourney 或其 U/V、Blend、Zoom、Pan、Inpaint、Remix 操作 → uses=midjourney
- 文档里的文生视频、图生视频、首尾帧或参考视频生成 → uses=generate_video
- 改图/局部重绘 → uses=edit_image；看图分析 → uses=describe_image
- 写文案/长文 → uses=writing；改写润色 → uses=rewrite；分析判断 → uses=analysis
- 文档里的 Python/Shell 脚本本身不纳入，只提取它体现的流程与参数含义
- 提示词模板、参数对照表、质检清单 → 摘录进 resources（这是最有价值的部分，尽量完整）
- systemPrompt 要浓缩文档的领域知识（如构图规范、风格要求），能独立指导模型
全部用中文输出（id 除外）。用 submit_skill_analysis 提交。`

export type AnalyzedSkill = {
  skill: Partial<SkillDef> & { v2: SkillV2Meta }
  warnings: string[]
}

const ARGS_TOOL = {
  type: 'function',
  function: {
    name: 'submit_run_args',
    description: '提交命令行参数数组',
    parameters: {
      type: 'object',
      properties: {
        args: { type: 'array', items: { type: 'string' }, description: '按顺序的命令行参数，如 ["--prompt","一只猫","--n","2"]。值不要带引号包裹。' },
        note: { type: 'string', description: '给用户的一句执行说明（用了哪些默认值、有什么限制）' },
        blocked: { type: 'string', description: '如果指令无法映射到该脚本的参数（缺关键信息/功能不符），说明原因；能执行则留空' },
      },
      required: ['args'],
    },
  },
}

/** Agent 运行 Skill 包：把自然语言指令翻译成入口脚本的命令行参数。 */
export async function planPackRunArgs(input: { instruction: string; helpText: string; docs: string }): Promise<{ args: string[]; note: string; blocked: string }> {
  const { provider, model } = resolveChatTarget({})
  const r = await chatWithTools(
    provider, model,
    [{
      role: 'user',
      content: [
        `用户想运行一个第三方 Skill 的 Python 入口，请把用户指令翻译成该脚本的命令行参数。`,
        `脚本 --help 输出：\n${input.helpText.slice(0, 6000)}`,
        input.docs ? `包内 SKILL.md 摘要：\n${input.docs.slice(0, 6000)}` : '',
        `用户指令：${input.instruction}`,
        `注意：沙箱无网络、无环境变量文件；如果脚本必须联网才有意义，仍然生成参数（让脚本自己报错），但在 note 里说明。必填参数缺少且无法从指令推断时用 blocked 说明。`,
      ].filter(Boolean).join('\n\n'),
    }],
    '你是命令行参数规划器。只依据 --help 与文档，不发明不存在的参数。用 submit_run_args 提交。',
    [ARGS_TOOL], 120_000,
  )
  const call = r.toolCalls.find((c) => c.name === 'submit_run_args')
  if (!call) throw new Error('Agent 未能生成运行参数，请手动填写')
  let parsed: { args?: unknown; note?: unknown; blocked?: unknown } = {}
  try { parsed = JSON.parse(call.arguments || '{}') as typeof parsed } catch { throw new Error('参数结果解析失败') }
  const args = Array.isArray(parsed.args) ? parsed.args.map(String).filter((a) => a.length <= 500).slice(0, 32) : []
  return { args, note: String(parsed.note || ''), blocked: String(parsed.blocked || '') }
}

/** 不执行包内代码；让当前 LLM 直接按原始 Agent Skill 与 references 生成一次测试结果。 */
export async function runPackAiTest(input: { instruction: string; context: string; sourceName: string }) {
  const instruction = input.instruction.trim()
  if (!instruction) throw new Error('请描述要测试的任务')
  const system = [
    `你正在测试导入的 Agent Skill：${input.sourceName}。`,
    '严格遵循下方 SKILL.md 与资源文件完成用户任务，直接给出最终产物。',
    '先在内部判断任务属于哪一种模式，并读取该模式对应的 reference。reference 中的最终格式、字段名、顺序、标签和时间记法都是硬约束。',
    '如果 Skill 规定了固定输出结构，必须逐字保留字段名并按规定顺序输出；禁止退化成普通说明、摘要或通用提示词。',
    '这是纯 AI 测试：不能执行包内脚本、访问网络或声称已经生成/保存真实媒体文件；需要媒体工具时，只输出对应提示词、规划或可检查的文本结果。',
    '',
    input.context.slice(0, 64_000),
  ].join('\n')
  const providers = allProviders().filter((provider) => provider.source !== 'cli' && provider.enabled && provider.api_key && provider.base_url)
  const modelTargets = providers.map((provider) => ({
    provider,
    models: provider.models.filter((model) => (model.caps || []).includes('llm')),
  })).filter((target) => target.models.length)
  const targets = [
    ...modelTargets.map((target) => ({ provider: target.provider, model: target.models[0] })),
    ...modelTargets.flatMap((target) => target.models.slice(1).map((model) => ({ provider: target.provider, model }))),
  ].slice(0, getAutoFallback() ? 8 : 1)
  if (!targets.length) throw new Error('还没有可用的 LLM 模型站点')

  const failures: string[] = []
  for (const target of targets) {
    try {
      const provider = {
        base_url: target.provider.base_url,
        api_key: target.provider.api_key,
        protocol: target.model.protocol || target.provider.protocol,
      }
      const result = await callChat(provider, target.model.model, { prompt: instruction, system }, { temperature: 0.1 }, 180_000)
      return {
        text: result.text,
        model: target.model.model,
        provider: target.provider.name,
        latencyMs: result.latencyMs,
        fallbacks: failures,
      }
    } catch (error) {
      const message = String((error as Error).message || error)
      failures.push(`${target.provider.name}/${target.model.model}：${message.slice(0, 180)}`)
      // 参数/内容错误通常会在所有站点重复，不做无意义降级；站点、鉴权、限流和服务错误可切换目标。
      if (/HTTP 4\d\d\b/.test(message) && !/HTTP (401|403|404|408|409|429)\b/.test(message)) break
    }
  }
  throw new Error(`所有可用 LLM 目标均未完成测试。${failures.join('；')}`)
}

export async function analyzeSkillDocument(markdown: string, sourceName: string): Promise<AnalyzedSkill> {
  const text = markdown.slice(0, 64_000)
  const { provider, model } = resolveChatTarget({})
  const r = await chatWithTools(
    provider, model,
    [{ role: 'user', content: `第三方 Skill 文档（来源：${sourceName}）：\n\n${text}` }],
    SYSTEM, [ANALYZE_TOOL], 180_000,
  )
  const call = r.toolCalls.find((c) => c.name === 'submit_skill_analysis')
  if (!call) throw new Error('解析失败：模型未返回结构化结果，请重试或改用手动导入')
  let args: Record<string, unknown>
  try { args = JSON.parse(call.arguments || '{}') as Record<string, unknown> } catch { throw new Error('解析失败：结构化结果无法解析') }

  const warnings: string[] = []
  const strArr = (v: unknown, max: number) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, max) : [])
  const baseSkillSet = new Set(BASE_SKILLS)
  const rawTools = strArr(args.allowedTools, 12)
  const allowedTools = rawTools.filter((t) => baseSkillSet.has(t) || VALID_TOOLS.has(t))
  for (const t of rawTools) if (!baseSkillSet.has(t) && !VALID_TOOLS.has(t)) warnings.push(`忽略了不存在的能力：${t}`)
  const sensitive = strArr(args.sensitive, 8)
  if (args.network === true) warnings.push('该 Skill 声明需要平台能力之外的联网（如爬网页）：暂不放行，相关步骤只输出文本')
  if (sensitive.length) warnings.push(`包含敏感动作声明：${sensitive.join('、')}（执行时不会自动放行）`)

  const steps = (Array.isArray(args.steps) ? args.steps : [])
    .map((s) => {
      const rec = s as Record<string, unknown>
      const uses = String(rec?.uses || '').trim()
      return {
        title: String(rec?.title || '').slice(0, 60),
        detail: String(rec?.detail || '').slice(0, 300),
        ...(uses && baseSkillSet.has(uses) ? { uses } : {}),
      }
    })
    .filter((s) => s.title)
    .slice(0, 10)
  if (!steps.length) throw new Error('解析失败：没有识别出工作流步骤')
  // 步骤里用到但白名单漏掉的基础能力自动补齐
  for (const s of steps) if (s.uses && !allowedTools.includes(s.uses)) allowedTools.push(s.uses)

  const resources = (Array.isArray(args.resources) ? args.resources : [])
    .map((r) => {
      const rec = r as Record<string, unknown>
      return { name: String(rec?.name || '').slice(0, 60), content: String(rec?.content || '').slice(0, 4000) }
    })
    .filter((r) => r.name && r.content)
    .slice(0, 8)

  const v2: SkillV2Meta = {
    triggers: strArr(args.triggers, 6),
    inputs: strArr(args.inputs, 8),
    steps,
    allowedTools,
    permissions: {
      readsFiles: args.readsFiles === true,
      writesFiles: args.writesFiles === true,
      network: args.network === true,
      sensitive,
    },
    output: String(args.output || '').slice(0, 300),
    checks: strArr(args.checks, 8),
    ...(resources.length ? { resources } : {}),
    sourceName,
    analyzedAt: Date.now(),
    version: 1,
  }
  const workflowText = steps.map((s, i) => `${i + 1}. ${s.title}${s.uses ? `【用 ${s.uses}】` : ''}：${s.detail}`).join('\n')
  const systemPrompt = [
    String(args.systemPrompt || '').slice(0, 3000),
    '',
    '工作流（按序执行）：',
    workflowText,
    v2.checks.length ? `\n完成前自查：\n${v2.checks.map((c) => `- ${c}`).join('\n')}` : '',
  ].join('\n')

  return {
    skill: {
      id: String(args.id || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || undefined,
      name: String(args.name || '').slice(0, 60),
      description: String(args.description || '').slice(0, 180),
      kind: 'procedure',
      systemPrompt,
      v2,
    },
    warnings,
  }
}
