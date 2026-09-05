// ══════════════════════════════════════════════════════════════════════
// SKILL 系统 —— 内置技能定义 + 后端执行。
// 文字类技能 = 特定 system prompt 的一次 LLM 调用；
// 启停状态存 DX_DATA_DIR/skills.json（缺省全部启用）。
// ══════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import {
  callChat,
  chatWithTools,
  generateImages,
  generateVideos,
  editImages,
  describeImage,
  submitMidjourney,
  getMidjourneyTask,
  submitMidjourneyAction,
  submitMidjourneyModal,
  generateSpeech,
  transcribeAudio,
  generateMusic,
  type ResolvedProvider,
  type GenImage,
  type GenVideoReference,
  type EditImageInput,
  type ToolMessage,
} from './protocols.ts'
import { revealProvider, firstUsableProvider, allProviders, type Provider } from './store.ts'
import { resolveProtocolModelProfile, validateProtocolParameters } from './protocolManifest.ts'
import { resolveModelFromProviders } from './modelResolver.ts'
import type { CapabilityIntent } from './capabilityTypes.ts'
import { generateJimengImage, generateJimengVideo, upscaleJimengImage, queryJimengMedia, tempMediaFile, JimengPendingError } from './cliTools.ts'

type SkillRunOptions = { providerId?: string; model?: string; imageProviderId?: string; imageModel?: string; audioProviderId?: string; audioModel?: string; rootId?: string | null }
import { ensureFolder, createNode, saveBlob, readBlob, getNode, resolvePath, findByPath } from './fs.ts'
import { artworkTargets, putArtwork, scan as libScan } from './library.ts'

const DATA_DIR = DATA_ROOT
const FILE = dataPath('skills.json')

export interface SkillDef {
  id: string
  name: string
  description: string
  kind: 'text' | 'image' | 'image_upscale' | 'midjourney' | 'image_edit' | 'image_batch' | 'image_describe' | 'video' | 'audio_tts' | 'audio_transcribe' | 'audio_music' | 'procedure'
  systemPrompt?: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  builtin?: boolean
  /** 能力层：平台原子能力 / 提示词预设 / 多步骤工作流。 */
  layer?: 'capability' | 'preset' | 'workflow'
  /** 来源只影响管理与 UI，不影响执行。 */
  origin?: 'system' | 'official' | 'user' | 'imported'
  /** internal 保留兼容调用但不提供给顶层 Agent；slash 仅允许显式调用。 */
  exposure?: 'internal' | 'agent' | 'slash'
  /** false 时不在 Skill App 展示。 */
  visibleInApp?: boolean
  /** 标准 Agent Skill 的原始文本快照；v2 只是可重建的执行缓存。 */
  source?: SkillSourceSnapshot
  /** false 时只允许 /skill 或 Skill App 显式调用，不暴露给 Agent 自动路由。 */
  allowImplicitInvocation?: boolean
  /** V2（Agent 解析的第三方 Skill）：结构化工作流与授权声明 */
  v2?: SkillV2Meta
}

export interface SkillSourceSnapshot {
  format: 'agentskills/v1'
  sourcePath: string
  instructions: string
  files: Array<{ path: string; content: string }>
  metadata: { name?: string; description?: string; displayName?: string; packId?: string; packName?: string; displayOverride?: boolean }
}

/**
 * Re-importing a Skill pack refreshes its executable source snapshot. A
 * translated/renamed display is user-owned metadata, so carry that marker
 * onto the fresh snapshot instead of dropping it during route registration.
 */
export function mergeSkillSourceForUpdate(
  existing: SkillSourceSnapshot | undefined,
  incoming: SkillSourceSnapshot | undefined,
  preserveDisplay: boolean,
) {
  const source = incoming ?? existing
  if (!source || !preserveDisplay) return source
  return { ...source, metadata: { ...source.metadata, displayOverride: true } }
}

export interface SkillV2Meta {
  /** 触发条件：什么时候该用这个 Skill（给路由与用户看） */
  triggers: string[]
  /** 所需输入（人话描述） */
  inputs: string[]
  /** 分步工作流：Agent 执行时按此推进；uses 指向基础 skill 或文件工具 */
  steps: Array<{ title: string; detail: string; uses?: string }>
  /** 工具白名单（fs_* / 基础 skill id；空 = 纯文本无工具） */
  allowedTools: string[]
  /** 权限声明：读文件/写文件/联网/敏感操作 */
  permissions: { readsFiles: boolean; writesFiles: boolean; network: boolean; sensitive: string[] }
  /** 输出说明：产出什么、放到哪 */
  output: string
  /** 最终自查清单 */
  checks: string[]
  /** 从包里提炼的可复用资源（提示词模板、参数表等纯文本） */
  resources?: Array<{ name: string; content: string }>
  /** 解析来源与版本 */
  sourceName?: string
  analyzedAt?: number
  version: number
}

// 生成图片支持的像素尺寸（16:9=1792x1024，9:16=1024x1792，3:2=1536x1024）
const IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792', '1536x1024', '1024x1536', '1280x720', '720x1280']
const VIDEO_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', '4k']

const INSTRUCTION_SCHEMA = (desc: string): SkillDef['inputSchema'] => ({
  type: 'object',
  properties: { instruction: { type: 'string', description: desc } },
  required: ['instruction'],
})

// 定义与 system prompt 迁移自旧版 ccs/skills/*/（文字类）+ skill.json 的 agent 说明。
const SKILLS: SkillDef[] = [
  {
    id: 'chat',
    name: '对话回复',
    description: '普通对话、问答、解释概念；不适合长文写作（用 writing）和代码（用 code）。',
    kind: 'text',
    systemPrompt: '你是一个直接、自然、可靠的中文对话助手。回答用户问题；不需要生成图片；不输出无关解释。',
    inputSchema: INSTRUCTION_SCHEMA('用户的问题或对话内容'),
  },
  {
    id: 'writing',
    name: '写作生成',
    description: '生成诗歌、文案、故事、脚本、邮件、标题等原创文本，输出可直接交付的成品。',
    kind: 'text',
    systemPrompt: '你是中文写作助手。按用户要求创作可直接交付的文本，如诗歌、文案、故事、标题、邮件。只输出成品，除非用户要求解释。',
    inputSchema: INSTRUCTION_SCHEMA('写作要求，包含体裁、主题、长度、语气等'),
  },
  {
    id: 'rewrite',
    name: '文本改写',
    description: '润色、改写、扩写、缩写、翻译或调整语气，保持原意。',
    kind: 'text',
    systemPrompt: '你是文本改写助手。根据用户要求润色、改写、扩写、缩写、翻译或调整语气。尽量保留原意，只输出改写结果。',
    inputSchema: INSTRUCTION_SCHEMA('改写要求 + 原文'),
  },
  {
    id: 'code',
    name: '代码助手',
    description: '写代码、解释代码、分析报错、给出技术修复方案。',
    kind: 'text',
    systemPrompt: '你是代码与技术助手。可以写代码、解释代码、分析报错、给出修复方案。需要代码时使用清晰代码块。',
    inputSchema: INSTRUCTION_SCHEMA('编程需求、代码片段或报错信息'),
  },
  {
    id: 'analysis',
    name: '文本分析',
    description: '总结、归纳、对比、提取要点、诊断问题，输出结构化结论。',
    kind: 'text',
    systemPrompt: '你是分析总结助手。擅长总结、归纳、对比、提取要点、诊断问题。输出结构清晰，优先给结论。',
    inputSchema: INSTRUCTION_SCHEMA('分析要求 + 待分析的文本材料'),
  },
  {
    id: 'generate_image',
    name: '生成图片',
    description: '从文本提示词生成图片（OpenAI 兼容图像 API）；生成结果会保存到「生成图片」文件夹。',
    kind: 'image',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '文生图提示词，越具体越好（画面主体、风格、构图、光线、色调等）' },
        path: {
          type: 'string',
          description:
            '【推荐】保存路径，相对当前项目根，可含子文件夹并指定文件名，如「角色/苏离.png」。给出后图片直接存到该位置并用该文件名（无需再另建索引文件）。留空则存到「生成图片」文件夹并自动命名。',
        },
        size: { type: 'string', enum: IMAGE_SIZES, description: '像素尺寸，默认 1024x1024（16:9=1792x1024，9:16=1024x1792）' },
        n: { type: 'number', description: '生成数量 1-4，默认 1' },
      },
      required: ['prompt'],
    },
  },
  {
    id: 'midjourney',
    name: 'Midjourney 创作',
    description: '仅在用户明确指定 Midjourney，或要求 Blend、U/V、重抽、扩图、平移、局部重绘等 Midjourney 专属操作时使用；普通生图继续使用 generate_image。',
    kind: 'midjourney',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['imagine', 'blend', 'edit', 'upscale', 'variation', 'low_variation', 'high_variation', 'reroll', 'zoom', 'pan', 'inpaint', 'remix_subtle', 'remix_strong', 'status'],
          description: '操作类型。首次创作使用 imagine；多图融合用 blend；基于参考图创作用 edit；对已有任务继续操作时使用其余类型。',
        },
        prompt: { type: 'string', description: 'Imagine/Edit/Inpaint/Remix 的提示词；Blend、任务查询和多数后续操作可留空。' },
        image: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图片路径、FS 节点 id、/api/fs/raw/<id> 或 http(s) 地址。Blend 必须 2-4 张；Edit 至少 1 张。',
        },
        mask_image: { type: 'string', description: 'Inpaint 局部重绘使用的遮罩图片引用。' },
        task_id: { type: 'string', description: '已有 Midjourney 任务 ID；后续操作和 status 必填。' },
        index: { type: 'number', description: '图片序号 1-4；Upscale、Variation、Remix 等操作使用。' },
        custom_id: { type: 'string', description: '接口返回的按钮 custom_id；有值时优先于 index/direction。' },
        size: { type: 'string', enum: ['1:1', '4:3', '3:4', '16:9', '9:16'], description: '画面比例，默认 1:1。' },
        version: { type: 'string', description: 'Midjourney 版本，默认根据所选模型推断，如 6.1 或 niji。' },
        speed: { type: 'string', enum: ['relax', 'fast', 'turbo'], description: '生成速度，默认 relax。' },
        direction: { type: 'string', enum: ['left', 'right', 'up', 'down'], description: 'Pan 平移方向。' },
        zoom_ratio: { type: 'number', description: 'Zoom 缩放比例，大于 1 且不超过 4。' },
        wait: { type: 'boolean', description: '是否等待任务完成并保存图片，默认 true；false 时只提交并返回 task_id。' },
        path: { type: 'string', description: '完成后图片的保存路径；留空保存到「生成图片」文件夹。' },
      },
      required: ['operation'],
    },
  },
  {
    id: 'upscale_image',
    name: '放大图片',
    description: '使用支持 image.upscale 的模型放大已有图片；当前支持即梦 CLI 的 2K、4K、8K 图片放大。不要用生成图片或 Midjourney U 操作替代普通图片超分。',
    kind: 'image_upscale',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['upscale', 'status'], description: '默认 upscale；即梦任务排队后用 status 和 submit_id 续查。' },
        image: { type: 'string', description: '要放大的图片路径、FS 节点 id、/api/fs/raw/<id> 或 http(s) 地址。' },
        resolution: { type: 'string', enum: ['2k', '4k', '8k'], description: '目标分辨率，默认 2k。' },
        submit_id: { type: 'string', description: 'status 查询所需的即梦任务 ID。' },
        path: { type: 'string', description: '保存路径；留空保存到「生成图片」文件夹。' },
      },
    },
  },
  {
    id: 'generate_video',
    name: '生成视频',
    description:
      '统一的视频生成能力：文生视频、图生视频、首尾帧、参考视频、参考音频。Agent 根据提供的素材和角色选择合适的调用方式，结果保存到「生成视频」文件夹。',
    kind: 'video',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['generate', 'status'], description: '默认 generate；即梦任务排队后用 status 和 submit_id 续查。' },
        submit_id: { type: 'string', description: 'status 查询所需的即梦任务 ID。' },
        prompt: { type: 'string', description: '视频提示词：主体动作、镜头运动、场景、风格、节奏和声音要求' },
        mode: {
          type: 'string',
          enum: ['auto', 'text_to_video', 'image_to_video', 'first_last_frame', 'multi_reference', 'video_to_video', 'audio_reference', 'multimodal'],
          description: '生成方式，默认 auto 根据素材自动判断；只有需要强制指定时才填写',
        },
        image: {
          type: 'string',
          description: '单张图片参考的路径、FS 节点 id、/api/fs/raw/<id> 或 http(s) 地址，适合图生视频',
        },
        images: {
          type: 'array',
          items: { type: 'object', properties: { ref: { type: 'string' }, role: { type: 'string', enum: ['first_frame', 'last_frame', 'reference_image'] } }, required: ['ref'] },
          description: '多张图片参考；元素可写成 {ref, role}，role 支持 first_frame、last_frame、reference_image',
        },
        first_frame: { type: 'string', description: '首帧图片引用；等价于 images 中 role=first_frame' },
        last_frame: { type: 'string', description: '尾帧图片引用；等价于 images 中 role=last_frame' },
        video: {
          type: 'string',
          description: '参考视频的路径、FS 节点 id、/api/fs/raw/<id> 或 http(s) 地址',
        },
        videos: {
          type: 'array',
          items: { type: 'object', properties: { ref: { type: 'string' }, role: { type: 'string', enum: ['reference_video'] } }, required: ['ref'] },
          description: '参考视频列表；元素可写成 {ref, role}',
        },
        audio: {
          type: 'string',
          description: '参考音频的路径、FS 节点 id、/api/fs/raw/<id> 或 http(s) 地址',
        },
        audios: {
          type: 'array',
          items: { type: 'object', properties: { ref: { type: 'string' }, role: { type: 'string', enum: ['reference_audio'] } }, required: ['ref'] },
          description: '参考音频列表；元素可写成 {ref, role}',
        },
        duration: { type: 'number', description: '视频时长（秒），默认 5；不同模型会自动适配支持的范围' },
        aspect_ratio: { type: 'string', enum: VIDEO_ASPECTS, description: '画面比例，默认 16:9' },
        resolution: { type: 'string', enum: VIDEO_RESOLUTIONS, description: '分辨率档位，默认由站点决定' },
        generate_audio: { type: 'boolean', description: '是否让视频模型同时生成声音' },
        enhance_prompt: { type: 'boolean', description: '是否让站点增强提示词' },
        enable_upsample: { type: 'boolean', description: '是否启用视频超分（模型支持时生效）' },
        watermark: { type: 'boolean', description: '是否添加平台水印' },
        camera_fixed: { type: 'boolean', description: '是否固定镜头、减少镜头位移' },
        multimodal: { type: 'boolean', description: '多模态参考模式；用于同时理解多张图或视频' },
        return_last_frame: { type: 'boolean', description: '是否要求返回最后一帧（站点支持时生效）' },
        seed: { type: 'number', description: '随机种子（站点支持时生效）' },
        path: { type: 'string', description: '保存路径，相对当前项目根，可含子文件夹和文件名；留空保存到「生成视频」' },
      },
    },
  },
  {
    id: 'edit_image',
    name: '编辑图片',
    description:
      '按指令编辑/修改已有图片（图生图，需站点支持图像编辑）：换背景、改文案、调风格、局部替换、多图合成等。结果保存到「生成图片」文件夹。',
    kind: 'image_edit',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'array',
          items: { type: 'string' },
          description: '待编辑/参考图，支持相对项目根的路径（如「角色/苏离.png」）、文件系统节点 id、/api/fs/raw/<id> 链接或 http(s) 图片地址；可传多张一起参考',
        },
        prompt: { type: 'string', description: '编辑指令：明确要改什么、保持什么' },
        path: {
          type: 'string',
          description: '保存路径，相对当前项目根，可含子文件夹并指定文件名，如「角色/苏离_改.png」。留空则存到「生成图片」文件夹并自动命名。',
        },
        size: { type: 'string', enum: IMAGE_SIZES, description: '输出像素尺寸，默认 1024x1024' },
        n: { type: 'number', description: '生成数量 1-4，默认 1' },
      },
      required: ['image', 'prompt'],
    },
  },
  {
    id: 'text_to_speech',
    name: '文字转语音',
    description: '把文本合成为语音并保存到「生成音频」；适用于旁白、配音和语音播报，不用于生成歌曲。',
    kind: 'audio_tts',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要朗读的文字。' },
        voice: { type: 'string', description: '声音名称，默认 alloy；具体声音由模型支持范围决定。' },
        speed: { type: 'number', description: '语速，默认 1，通常支持 0.25-4。' },
        format: { type: 'string', enum: ['mp3', 'wav', 'opus', 'aac', 'flac'], description: '输出格式，默认 mp3。' },
        path: { type: 'string', description: '保存路径；留空保存到「生成音频」。' },
      },
      required: ['text'],
    },
  },
  {
    id: 'transcribe_audio',
    name: '音频转文字',
    description: '转写语音、会议或采访录音，也可以把语音翻译成英文文本；需要提供已有音频文件。',
    kind: 'audio_transcribe',
    inputSchema: {
      type: 'object',
      properties: {
        audio: { type: 'string', description: '音频路径、FS 节点 id、/api/fs/raw/<id> 或 http(s) 地址。' },
        operation: { type: 'string', enum: ['transcribe', 'translate'], description: 'transcribe 原语言转写；translate 翻译成英文。' },
        language: { type: 'string', description: '输入语言代码，如 zh、en；自动识别时留空。' },
        prompt: { type: 'string', description: '可选上下文、专有名词或转写提示。' },
      },
      required: ['audio'],
    },
  },
  {
    id: 'generate_music',
    name: '生成音乐',
    description: '使用音乐模型生成歌曲、配乐或纯音乐并保存到「生成音频」；普通语音旁白请使用 text_to_speech。',
    kind: 'audio_music',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '音乐主题、情绪、编曲、速度和声音要求。' },
        title: { type: 'string', description: '可选歌曲标题。' },
        lyrics: { type: 'string', description: '可选歌词。' },
        style: { type: 'string', description: '可选曲风，如 cinematic、pop、lofi。' },
        instrumental: { type: 'boolean', description: '是否生成纯音乐。' },
        path: { type: 'string', description: '保存路径；留空保存到「生成音频」。' },
      },
      required: ['prompt'],
    },
  },
  {
    id: 'batch_image_group_process',
    name: '批量图片分组处理',
    description:
      '把多张图片按数量或组合规则分组，对每组统一执行图片编辑：批量精修、逐张换文案/翻译、每 N 张合成场景图、两两组合出图等。结果保存到「生成图片」文件夹。',
    kind: 'image_batch',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'array',
          items: { type: 'string' },
          description: '待处理的多张图片，支持 FS 节点 id、/api/fs/raw/<id> 链接或 http(s) 地址',
        },
        prompt: { type: 'string', description: '对每一组图片统一执行的编辑提示词' },
        groupMode: {
          type: 'string',
          enum: ['sequential', 'all_each', 'all_in_one', 'combinations'],
          description: '分组方式：sequential 顺序按 groupSize 分组、all_each 每张单跑、all_in_one 全部一组、combinations 按组合生成',
        },
        groupSize: { type: 'number', description: '每组图片数量（sequential/combinations 用），默认 1' },
        remainderPolicy: {
          type: 'string',
          enum: ['run', 'skip', 'error'],
          description: 'sequential 最后不足一组的剩余图片如何处理：run 照跑、skip 跳过、error 报错，默认 run',
        },
        concurrency: { type: 'number', description: '并发执行组数，建议 1-4，默认 2' },
        retryCount: { type: 'number', description: '单组失败自动重试次数，默认 1' },
        maxGroups: { type: 'number', description: '最多执行多少组；combinations 默认保护为 200 组' },
        maxReferenceImages: { type: 'number', description: '单组最多传给编辑模型的参考图数量，默认 4' },
        failurePolicy: {
          type: 'string',
          enum: ['continue', 'stop'],
          description: '单组失败后 continue 继续 / stop 停止后续组，默认 continue',
        },
        size: { type: 'string', enum: IMAGE_SIZES, description: '输出像素尺寸，默认 1024x1024' },
        n: { type: 'number', description: '每组生成数量 1-4，默认 1' },
      },
      required: ['image', 'prompt'],
    },
  },
  {
    id: 'describe_image',
    name: '识别图片',
    description: '看图并用文字描述/反推：读一张图片，回答它画了什么、反推提示词、校验是否符合要求（需站点有视觉模型）。',
    kind: 'image_describe',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: '要识别的图片：相对项目根的路径（如「角色/苏离.png」）、FS 节点 id、/api/fs/raw 链接或 http(s) 地址' },
        prompt: { type: 'string', description: '想问什么，如「描述画面内容」「反推英文提示词」「是否是银发少女」，留空则默认描述画面' },
      },
      required: ['image'],
    },
  },
]

// ── 持久化：data/skills.json = { enabled: 覆盖项, custom: 自定义技能 }───
// （兼容旧格式：纯 Record<string, boolean> 视为 enabled 覆盖）
interface SkillStore {
  enabled: Record<string, boolean>
  custom: SkillDef[]
}
function loadStore(): SkillStore {
  try {
    if (!existsSync(FILE)) return { enabled: {}, custom: [] }
    const raw = JSON.parse(readFileSync(FILE, 'utf-8')) as Record<string, unknown>
    if (raw && (raw.enabled || raw.custom)) {
      return {
        enabled: (raw.enabled as Record<string, boolean>) || {},
        custom: Array.isArray(raw.custom) ? (raw.custom as SkillDef[]) : [],
      }
    }
    return { enabled: (raw as Record<string, boolean>) || {}, custom: [] }
  } catch {
    return { enabled: {}, custom: [] }
  }
}
function persistStore(store: SkillStore) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf-8')
}

const OFFICIAL_PRESET_IDS = new Set(['writing', 'rewrite', 'code', 'analysis'])

function classifySkill(skill: SkillDef, builtin: boolean): SkillDef {
  if (skill.id === 'chat') {
    return { ...skill, builtin, layer: 'preset', origin: 'official', exposure: 'internal', visibleInApp: true }
  }
  if (builtin && OFFICIAL_PRESET_IDS.has(skill.id)) {
    return { ...skill, builtin, layer: 'preset', origin: 'official', exposure: 'agent', visibleInApp: true }
  }
  if (builtin) {
    return { ...skill, builtin, layer: 'capability', origin: 'system', exposure: 'agent', visibleInApp: true }
  }
  const imported = !!skill.source?.metadata.packId || !!skill.source
  return {
    ...skill,
    builtin,
    layer: skill.layer || (skill.kind === 'procedure' || imported ? 'workflow' : 'preset'),
    origin: skill.origin || (imported ? 'imported' : 'user'),
    // 功能 Skill 不进入 Agent 自动工具集，只允许用户通过 /技能ID 显式调用。
    exposure: 'slash',
    allowImplicitInvocation: false,
    visibleInApp: skill.visibleInApp !== false,
  }
}

function allDefs(store: SkillStore): SkillDef[] {
  return [...SKILLS.map((s) => classifySkill(s, true)), ...store.custom.map((s) => classifySkill(s, false))]
}

export function listSkills(): (SkillDef & { enabled: boolean })[] {
  const store = loadStore()
  return allDefs(store).map((s) => ({ ...s, enabled: store.enabled[s.id] !== false }))
}

export function setSkillEnabled(id: string, enabled: boolean): (SkillDef & { enabled: boolean }) | null {
  const store = loadStore()
  const def = allDefs(store).find((s) => s.id === id)
  if (!def) return null
  store.enabled[id] = enabled
  persistStore(store)
  return { ...def, enabled }
}

/** 新建/更新自定义技能（文字类；内置技能不可覆盖）。 */
export function saveCustomSkill(obj: Partial<SkillDef>): SkillDef & { enabled: boolean } {
  const id = String(obj.id || '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error('id 必须以小写字母开头，只能含小写字母、数字、下划线')
  if (SKILLS.some((s) => s.id === id)) throw new Error(`「${id}」是内置技能，不能覆盖`)
  const requestedName = String(obj.name || '').trim()
  if (!requestedName) throw new Error('缺少名称')
  const systemPrompt = String(obj.systemPrompt || '').trim()
  if (!systemPrompt) throw new Error('缺少 system prompt（技能的角色设定与规则）')
  const store = loadStore()
  const existing = store.custom.find((s) => s.id === id)
  const preserveDisplay = existing?.source?.metadata.displayOverride === true
    && existing.source.metadata.packId === obj.source?.metadata.packId
    && obj.source?.metadata.displayOverride !== true
  const name = preserveDisplay ? existing.name : requestedName
  const description = preserveDisplay
    ? existing.description
    : String(obj.description || '').trim() || name
  const v2 = obj.v2 ?? existing?.v2
  const source = mergeSkillSourceForUpdate(existing?.source, obj.source, preserveDisplay)
  const allowImplicitInvocation = obj.allowImplicitInvocation ?? existing?.allowImplicitInvocation
  // 带结构化工作流的第三方 Skill 存为 procedure：运行时由 Agent 小循环驱动基础 skill
  const kind: SkillDef['kind'] = obj.kind === 'procedure' || (v2 && v2.steps?.length) ? 'procedure' : 'text'
  const def: SkillDef = {
    id,
    name,
    description,
    kind,
    layer: obj.layer || existing?.layer || (kind === 'procedure' || !!source ? 'workflow' : 'preset'),
    origin: obj.origin || existing?.origin || (source ? 'imported' : 'user'),
    exposure: 'slash',
    visibleInApp: obj.visibleInApp ?? existing?.visibleInApp ?? true,
    systemPrompt,
    inputSchema: INSTRUCTION_SCHEMA(String(obj.description || name)),
    ...(source ? { source } : {}),
    allowImplicitInvocation: false,
    ...(v2 ? { v2 } : {}),
  }
  const idx = store.custom.findIndex((s) => s.id === id)
  if (idx >= 0) store.custom[idx] = def
  else store.custom.push(def)
  persistStore(store)
  return { ...def, builtin: false, enabled: store.enabled[id] !== false }
}

/** 修改 Skill 的显示名称/简介，不改变 ID、执行说明或工具调用名。 */
export function updateCustomSkillDisplay(id: string, name: string, description?: string) {
  const store = loadStore()
  const skill = store.custom.find((item) => item.id === id)
  if (!skill) throw new Error('功能 Skill 不存在')
  const nextName = String(name || '').trim()
  if (!nextName) throw new Error('名称不能为空')
  skill.name = nextName.slice(0, 80)
  if (typeof description === 'string' && description.trim()) skill.description = description.trim().slice(0, 500)
  if (skill.source) skill.source.metadata = { ...skill.source.metadata, displayOverride: true }
  persistStore(store)
  return { ...skill, builtin: false, enabled: store.enabled[id] !== false }
}

/** 删除自定义技能（内置技能只能停用，不能删除）。 */
export function deleteCustomSkill(id: string): boolean {
  if (SKILLS.some((s) => s.id === id)) throw new Error('内置技能不能删除，只能停用')
  const store = loadStore()
  const before = store.custom.length
  store.custom = store.custom.filter((s) => s.id !== id)
  delete store.enabled[id]
  persistStore(store)
  return store.custom.length < before
}

/** 移除某个完整 Skill 包自动注册的路由 Skill。 */
export function deleteCustomSkillsForPack(packId: string): number {
  const store = loadStore()
  const removed = store.custom.filter((skill) => skill.source?.metadata.packId === packId)
  if (!removed.length) return 0
  const removedIds = new Set(removed.map((skill) => skill.id))
  store.custom = store.custom.filter((skill) => !removedIds.has(skill.id))
  for (const id of removedIds) delete store.enabled[id]
  persistStore(store)
  return removed.length
}

/** 聚合启用的技能，转成 agent 可用的 function 定义（name = skill__<id>）。 */
export function agentSkillTools() {
  return listSkills()
    .filter((s) => s.enabled && s.exposure === 'agent' && s.allowImplicitInvocation !== false)
    .map((s) => ({
      type: 'function' as const,
      function: {
        name: `skill__${s.id}`,
        description: `[技能:${s.name}] ${s.description}`,
        parameters: s.inputSchema,
      },
    }))
}

// ── provider / 模型选型（与 /api/chat 相同规则）───────────────────────
export function resolveChatTarget(opts: { providerId?: string; model?: string } = {}): {
  provider: ResolvedProvider
  model: string
  providerName: string
  } {
  const preferred = opts.providerId ? revealProvider(String(opts.providerId)) : firstUsableProvider('llm')
  const candidates = [preferred, ...allProviders().filter((provider) => provider.id !== preferred?.id)]
  const hit = candidates.flatMap((provider) => {
    if (!provider || !provider.enabled || (!provider.api_key && provider.source !== 'cli')) return []
    const entry = (opts.model && provider.models.find((model) => model.model === opts.model && model.caps.includes('llm'))) || provider.models.find((model) => model.caps.includes('llm'))
    return entry ? [{ provider, entry }] : []
  })[0]
  if (!hit) {
    throw new Error('还没有可用的模型站点。请先在「API 设置」里添加并启用一个站点，填好 Base URL、Key 和至少一个模型。')
  }
  return {
    provider: { base_url: hit.provider.base_url, api_key: hit.provider.api_key, protocol: hit.entry.protocol || hit.provider.protocol },
    model: hit.entry.model,
    providerName: hit.provider.name,
  }
}

/** 识图必须选择真正声明 llm.chat.vision 的模型，不能沿用普通聊天首选项。 */
export function resolveVisionTarget(opts: { providerId?: string; model?: string } = {}): {
  provider: ResolvedProvider
  model: string
  providerName: string
} {
  const providers = allProviders()
  const preferredModels = opts.providerId
    ? (providers.find((provider) => provider.id === opts.providerId)?.models || []).map((entry) => ({
        providerId: opts.providerId,
        model: entry.model,
        weight: entry.model === opts.model ? 2000 : 500,
      }))
    : opts.model ? [{ model: opts.model, weight: 2000 }] : []
  const route = resolveModelFromProviders(providers, {
    taskIntent: 'agent.analyze_image_and_write',
    requiresAll: ['llm.chat.vision'],
    fallbackPolicy: 'best_available',
    preferredModels,
  })
  if (!route.satisfied.includes('llm.chat.vision')) {
    throw new Error('没有可用的视觉模型。请在「API 设置」中启用支持看图的模型。')
  }
  return { provider: route.provider, model: route.model, providerName: route.providerName }
}

// ── 图像 provider / 模型选型（优先带 image 能力的模型）───────────────────
function resolveImageTarget(opts: { providerId?: string; model?: string } = {}): {
  provider: ResolvedProvider
  model: string
  providerName: string
} {
  // 选一个「启用 + 有 key + 有 base_url + 含 image 能力模型」的站点。
  const pickFrom = (p: Provider | null): { p: Provider; model: string; protocol: string } | null => {
    const isCli = p?.source === 'cli' || String(p?.protocol || '').startsWith('cli:')
    if (!p || !p.enabled || (!isCli && (!p.api_key || !p.base_url))) return null
    const entry =
      (opts.model && p.models?.find((m) => m.model === opts.model)) ||
      p.models?.find((m) => (m.caps || []).includes('image'))
    return entry?.model ? { p, model: entry.model, protocol: entry.protocol || p.protocol } : null
  }
  // 手动站点/模型只作为首选；不可用时继续按 API 设置优先级回退。
  const preferred = opts.providerId ? revealProvider(String(opts.providerId)) : firstUsableProvider('image')
  const candidates = [preferred, ...allProviders().filter((p) => p.id !== preferred?.id)]
  let hit: { p: Provider; model: string; protocol: string } | null = null
  for (const p of candidates) {
    hit = pickFrom(p)
    if (hit) break
  }
  if (!hit) {
    throw new Error('没有可用的图像模型。请在「API 设置」里添加 OpenAI 兼容站点，并把一个图像模型的能力标为「图像」。')
  }
  return {
    provider: { base_url: hit.p.base_url, api_key: hit.p.api_key, protocol: hit.protocol },
    model: hit.model,
    providerName: hit.p.name,
  }
}

function isJimengCliProvider(provider: { protocol?: string; source?: string; cli_tool?: string }) {
  return provider.protocol === 'cli:jimeng' || provider.source === 'cli' && provider.cli_tool === 'jimeng'
}

function resolveImageUpscaleTarget(opts: { providerId?: string; model?: string } = {}): {
  provider: Provider
  model: string
  providerName: string
} {
  const preferred = opts.providerId ? revealProvider(String(opts.providerId)) : firstUsableProvider('image')
  const candidates = opts.providerId
    ? [preferred]
    : [preferred, ...allProviders().filter((provider) => provider.id !== preferred?.id)]
  for (const provider of candidates) {
    if (!provider || !provider.enabled) continue
    const models = opts.model
      ? [...provider.models.filter((entry) => entry.model === opts.model), ...provider.models.filter((entry) => entry.model !== opts.model)]
      : provider.models
    const entry = models.find((candidate) => {
      try {
        return resolveProtocolModelProfile(candidate.protocol || provider.protocol, candidate.model).capabilities.includes('image.upscale')
      } catch {
        return isJimengCliProvider(provider)
      }
    })
    if (entry) return { provider, model: entry.model, providerName: provider.name }
  }
  throw new Error('没有可用的图片放大模型。请在「API 设置」中启用支持 image.upscale 的模型（当前支持即梦 CLI）。')
}

function resolveMidjourneyTarget(opts: { providerId?: string; model?: string } = {}): {
  provider: ResolvedProvider
  model: string
  providerName: string
} {
  const pickFrom = (provider: Provider | null): { provider: Provider; model: string } | null => {
    if (!provider || !provider.enabled || !provider.api_key || !provider.base_url) return null
    const entries = opts.model
      ? [...(provider.models || []).filter((entry) => entry.model === opts.model), ...(provider.models || []).filter((entry) => entry.model !== opts.model)]
      : provider.models || []
    const entry = entries.find((candidate) => {
      try {
        const profile = resolveProtocolModelProfile(candidate.protocol || provider.protocol, candidate.model)
        return profile.protocolId === 'midjourney' || profile.capabilities.includes('image.blend') || profile.capabilities.includes('image.pan')
      } catch {
        return /(^|[-_./\s])(midjourney|mj)([-_./\s]|$)|\bniji\b/i.test(candidate.model)
      }
    })
    return entry?.model ? { provider, model: entry.model } : null
  }
  const preferred = opts.providerId ? revealProvider(String(opts.providerId)) : firstUsableProvider('image')
  const candidates = [preferred, ...allProviders().filter((provider) => provider.id !== preferred?.id)]
  const hit = candidates.map(pickFrom).find((candidate): candidate is { provider: Provider; model: string } => !!candidate)
  if (!hit) {
    throw new Error('没有可用的 Midjourney 模型。请在「API 设置」中添加并启用 Midjourney / APIMart 模型协议。')
  }
  return {
    provider: { base_url: hit.provider.base_url, api_key: hit.provider.api_key, protocol: 'midjourney' },
    model: hit.model,
    providerName: hit.provider.name,
  }
}

function imageOptions(opts: SkillRunOptions) {
  return { providerId: opts.imageProviderId || opts.providerId, model: opts.imageModel || opts.model }
}

// ── 视频 provider / 模型选型（优先带 video 能力的模型）───────────────
function resolveVideoTarget(opts: { providerId?: string; model?: string } = {}, requiredIntent: CapabilityIntent = 'video.generate'): {
  provider: ResolvedProvider
  model: string
  providerName: string
} {
  const pickFrom = (p: Provider | null): { p: Provider; model: string; protocol: string } | null => {
    const isCli = p?.source === 'cli' || String(p?.protocol || '').startsWith('cli:')
    const hasCredential = isCli ? true : p?.protocol === 'runninghub' ? !!p.wallet_api_key : !!p?.api_key
    if (!p || !p.enabled || !hasCredential || (!isCli && !p.base_url)) return null
    const videoModels = (p.models || []).filter((m) => (m.caps || []).includes('video'))
    const supportsIntent = (entry: Provider['models'][number]) => {
      try {
        return resolveProtocolModelProfile(entry.protocol || p.protocol, entry.model).capabilities.includes(requiredIntent)
      } catch {
        return false
      }
    }
    const entry =
      (opts.model && videoModels.find((m) => m.model === opts.model)) ||
      videoModels.find(supportsIntent) ||
      videoModels[0]
    return entry?.model ? { p, model: entry.model, protocol: entry.protocol || p.protocol } : null
  }
  const preferred = opts.providerId ? null : firstUsableProvider('video')
  const providerHasExactCapability = (p: Provider | null) => !!p?.models?.some((entry) => {
    if (!(entry.caps || []).includes('video')) return false
    try {
      return resolveProtocolModelProfile(entry.protocol || p.protocol, entry.model).capabilities.includes(requiredIntent)
    } catch {
      return false
    }
  })
  const candidates = opts.providerId
    ? [revealProvider(String(opts.providerId))]
    : [preferred, ...allProviders().filter((p) => p.id !== preferred?.id)]
      .sort((a, b) => Number(providerHasExactCapability(b)) - Number(providerHasExactCapability(a)))
  let hit: { p: Provider; model: string; protocol: string } | null = null
  for (const p of candidates) {
    hit = pickFrom(p)
    if (hit) break
  }
  if (!hit) {
    throw new Error('没有可用的视频模型。请在「API 设置」里添加站点，并把至少一个模型的能力标为「视频」。')
  }
  return {
    provider: { base_url: hit.p.base_url, api_key: hit.p.api_key, wallet_api_key: hit.p.wallet_api_key, protocol: hit.protocol },
    model: opts.model || hit.model,
    providerName: hit.p.name,
  }
}

function resolveAudioTarget(opts: { providerId?: string; model?: string } = {}, requiredIntent: CapabilityIntent = 'audio.tts'): {
  provider: ResolvedProvider
  model: string
  providerName: string
} {
  const pickFrom = (provider: Provider | null) => {
    if (!provider || !provider.enabled || !provider.api_key || !provider.base_url) return null
    const audioModels = provider.models.filter((entry) => entry.caps.includes('audio'))
    const supports = (entry: Provider['models'][number]) => {
      try { return resolveProtocolModelProfile(entry.protocol || provider.protocol, entry.model).capabilities.includes(requiredIntent) } catch { return false }
    }
    const requested = opts.model ? audioModels.find((entry) => entry.model === opts.model) : undefined
    const entry = requested && supports(requested) ? requested : audioModels.find(supports)
    return entry ? { provider, entry } : null
  }
  const preferred = opts.providerId ? revealProvider(String(opts.providerId)) : firstUsableProvider('audio')
  const candidates = opts.providerId ? [preferred] : [preferred, ...allProviders().filter((provider) => provider.id !== preferred?.id)]
  const hit = candidates.map(pickFrom).find((item): item is NonNullable<ReturnType<typeof pickFrom>> => !!item)
  if (!hit) throw new Error(`没有支持 ${requiredIntent} 的音频模型。请在「API 设置」中添加音频模型并设置正确协议。`)
  return {
    provider: { base_url: hit.provider.base_url, api_key: hit.provider.api_key, protocol: hit.entry.protocol || hit.provider.protocol },
    model: hit.entry.model,
    providerName: hit.provider.name,
  }
}

function audioOptions(opts: SkillRunOptions) {
  return { providerId: opts.audioProviderId, model: opts.audioModel }
}

// ── generate_image：文生图 → 存入虚拟文件系统「生成图片」文件夹 ─────────
export interface SkillImage {
  nodeId: string
  name: string
  url: string
}

// 把图像接口返回的 url/b64 落地到虚拟文件系统。
// target.path 给出时：按相对 rootId 的路径建目录并用该文件名保存；否则存「生成图片」+自动命名。
async function saveImagesToFs(
  images: GenImage[],
  target?: { rootId?: string | null; path?: string },
): Promise<SkillImage[]> {
  let parentId: string | null
  let baseName = ''
  let baseExt = ''
  if (target?.path) {
    const { parentId: pid, leaf } = resolvePath(target.rootId ?? null, target.path, true)
    parentId = pid
    const dot = leaf.lastIndexOf('.')
    baseName = dot > 0 ? leaf.slice(0, dot) : leaf
    baseExt = dot > 0 ? leaf.slice(dot + 1) : ''
  } else {
    parentId = ensureFolder('生成图片', target?.rootId ?? null)
  }
  const many = images.length > 1
  const ts = Date.now()
  const saved: SkillImage[] = []
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    let buf: Buffer
    let mime = 'image/png'
    if (img.type === 'b64') {
      buf = Buffer.from(img.value, 'base64')
    } else {
      const resp = await fetch(img.value)
      if (!resp.ok) throw new Error(`下载生成图失败：HTTP ${resp.status}`)
      mime = (resp.headers.get('content-type') || '').split(';')[0].trim() || 'image/png'
      buf = Buffer.from(await resp.arrayBuffer())
    }
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
    let filename: string
    if (baseName) {
      const useExt = baseExt || ext
      filename = many ? `${baseName}-${i + 1}.${useExt}` : `${baseName}.${useExt}`
    } else {
      filename = `img_${ts}_${i + 1}.${ext}`
    }
    const node = createNode({ name: filename, type: 'file', parentId, mime, size: buf.length })
    saveBlob(node.id, buf)
    saved.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}` })
  }
  return saved
}

export interface SkillVideo {
  nodeId: string
  name: string
  url: string
}

export interface SkillAudio {
  nodeId: string
  name: string
  url: string
}

async function saveAudiosToFs(
  audios: Array<{ data?: Buffer; url?: string; mime?: string }>,
  target?: { rootId?: string | null; path?: string },
): Promise<SkillAudio[]> {
  let parentId: string | null
  let baseName = ''
  let baseExt = ''
  if (target?.path) {
    const resolved = resolvePath(target.rootId ?? null, target.path, true)
    parentId = resolved.parentId
    const dot = resolved.leaf.lastIndexOf('.')
    baseName = dot > 0 ? resolved.leaf.slice(0, dot) : resolved.leaf
    baseExt = dot > 0 ? resolved.leaf.slice(dot + 1) : ''
  } else parentId = ensureFolder('生成音频', target?.rootId ?? null)
  const saved: SkillAudio[] = []
  for (let i = 0; i < audios.length; i++) {
    const item = audios[i]
    let data = item.data
    let mime = item.mime || 'audio/mpeg'
    if (!data && item.url) {
      const response = await fetch(item.url)
      if (!response.ok) throw new Error(`下载生成音频失败：HTTP ${response.status}`)
      data = Buffer.from(await response.arrayBuffer())
      mime = (response.headers.get('content-type') || mime).split(';')[0]
    }
    if (!data) continue
    const ext = mediaExt(mime, item.url || '')
    const name = baseName ? `${baseName}${audios.length > 1 ? `-${i + 1}` : ''}.${baseExt || ext}` : `audio_${Date.now()}_${i + 1}.${ext}`
    const node = createNode({ name, type: 'file', parentId, mime, size: data.length })
    saveBlob(node.id, data)
    saved.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}` })
  }
  return saved
}

function mediaExt(mime: string, value = ''): string {
  const byMime: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
  }
  const normalized = String(mime || '').split(';')[0].trim().toLowerCase()
  if (byMime[normalized]) return byMime[normalized]
  const match = String(value || '').split(/[?#]/, 1)[0].match(/\.([a-z0-9]{2,5})$/i)
  return match?.[1]?.toLowerCase() || 'mp4'
}

async function saveVideosToFs(
  videos: Array<{ type: 'url'; value: string }>,
  target?: { rootId?: string | null; path?: string },
): Promise<SkillVideo[]> {
  let parentId: string | null
  let baseName = ''
  let baseExt = ''
  if (target?.path) {
    const { parentId: pid, leaf } = resolvePath(target.rootId ?? null, target.path, true)
    parentId = pid
    const dot = leaf.lastIndexOf('.')
    baseName = dot > 0 ? leaf.slice(0, dot) : leaf
    baseExt = dot > 0 ? leaf.slice(dot + 1) : ''
  } else {
    parentId = ensureFolder('生成视频', target?.rootId ?? null)
  }
  const many = videos.length > 1
  const ts = Date.now()
  const saved: SkillVideo[] = []
  for (let i = 0; i < videos.length; i++) {
    const value = String(videos[i]?.value || '').trim()
    if (!value) continue
    let buf: Buffer
    let mime = 'video/mp4'
    if (value.startsWith('data:') && value.includes(';base64,')) {
      const [header, encoded] = value.split(';base64,', 2)
      mime = header.slice(5) || mime
      buf = Buffer.from(encoded, 'base64')
    } else {
      if (!/^https?:\/\//i.test(value)) {
        throw new Error(`视频接口返回了无法下载的地址：${value.slice(0, 120)}`)
      }
      const resp = await fetch(value)
      if (!resp.ok) throw new Error(`下载生成视频失败：HTTP ${resp.status}`)
      mime = (resp.headers.get('content-type') || '').split(';')[0].trim() || mime
      buf = Buffer.from(await resp.arrayBuffer())
    }
    const ext = mediaExt(mime, value)
    const filename = baseName
      ? `${baseName}${many ? `-${i + 1}` : ''}.${baseExt || ext}`
      : `video_${ts}_${i + 1}.${ext}`
    const node = createNode({ name: filename, type: 'file', parentId, mime, size: buf.length })
    saveBlob(node.id, buf)
    saved.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}` })
  }
  return saved
}

// 把一个图片引用解析成字节。支持：相对项目根的路径、FS 节点 id、/api/fs/raw 链接、http 地址。
async function resolveImageBytes(ref: unknown, rootId?: string | null): Promise<EditImageInput> {
  const s = String(ref ?? '').trim()
  if (!s) throw new Error('空图片引用')
  const m = s.match(/\/api\/fs\/raw\/([0-9a-f-]{36})/i)
  let nodeId = m ? m[1] : /^[0-9a-f-]{36}$/i.test(s) ? s : ''
  // 既不是 id / raw 链接 / http，就当作相对项目根的路径去找
  if (!nodeId && !/^https?:\/\//i.test(s) && rootId !== undefined) {
    const node = findByPath(rootId ?? null, s)
    if (node) nodeId = node.id
  }
  if (nodeId) {
    const node = getNode(nodeId)
    const buf = readBlob(nodeId)
    if (!node || !buf) throw new Error(`找不到图片：${s}`)
    return { buf, mime: node.mime || 'image/png', name: node.name || 'image.png' }
  }
  if (/^https?:\/\//i.test(s)) {
    const resp = await fetch(s)
    if (!resp.ok) throw new Error(`下载参考图失败：HTTP ${resp.status}`)
    const mime = (resp.headers.get('content-type') || '').split(';')[0].trim() || 'image/png'
    return { buf: Buffer.from(await resp.arrayBuffer()), mime, name: `ref.${mime.includes('jpeg') ? 'jpg' : 'png'}` }
  }
  throw new Error(`无法识别的图片引用：${s.slice(0, 80)}`)
}

async function saveJimengImageUrls(urls: string[], rootId: string | null | undefined, path = '') {
  return saveImagesToFs(urls.map((value) => ({ type: 'url' as const, value })), { rootId: rootId ?? null, ...(path ? { path } : {}) })
}

async function saveJimengVideoUrls(urls: string[], rootId: string | null | undefined, path = '') {
  return saveVideosToFs(urls.map((value) => ({ type: 'url' as const, value })), { rootId: rootId ?? null, ...(path ? { path } : {}) })
}

async function runUpscaleImage(
  args: Record<string, unknown>,
  opts: SkillRunOptions,
): Promise<{ text: string; meta: object; images?: SkillImage[] }> {
  const operation = String(args.operation || 'upscale').trim().toLowerCase()
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  const { provider, model, providerName } = resolveImageUpscaleTarget(imageOptions(opts))
  if (!isJimengCliProvider(provider)) throw new Error('当前图片放大执行器仅支持即梦 CLI。')

  if (operation === 'status') {
    const submitId = String(args.submit_id || '').trim()
    if (!submitId) throw new Error('status 操作需要 submit_id')
    const queried = await queryJimengMedia(submitId, 'image')
    if (queried.status === 'failed') throw new Error(`即梦图片放大失败：${queried.error || '未知错误'}`)
    if (queried.status !== 'succeeded') {
      return { text: queried.message || `即梦图片放大仍在排队（submit_id: ${submitId}）。`, meta: { model, provider: providerName, submitId, status: queried.status, operation } }
    }
    const saved = await saveJimengImageUrls(queried.urls, opts.rootId, path)
    return { text: `即梦图片放大已完成（submit_id: ${submitId}），已保存 ${saved.length} 张图片。`, meta: { model, provider: providerName, submitId, status: 'succeeded', operation }, images: saved }
  }
  if (operation !== 'upscale') throw new Error('不支持的图片放大 operation')
  const image = await resolveImageBytes(args.image, opts.rootId)
  const resolution = ['2k', '4k', '8k'].includes(String(args.resolution || '').toLowerCase()) ? String(args.resolution).toLowerCase() : '2k'
  const temp = tempMediaFile(image.buf, image.mime, '.png')
  try {
    const result = await upscaleJimengImage(temp, resolution, { pollSeconds: 120, deferPending: true })
    const saved = await saveJimengImageUrls(result.images, opts.rootId, path)
    return { text: `图片已放大到 ${resolution.toUpperCase()}，并保存 ${saved.length} 张结果。`, meta: { model, provider: providerName, submitId: result.submit_id, status: 'succeeded', resolution, operation }, images: saved }
  } catch (error) {
    if (error instanceof JimengPendingError) {
      return { text: `即梦图片放大仍在排队（submit_id: ${error.submit_id}），稍后可用 status 续查。`, meta: { model, provider: providerName, submitId: error.submit_id, status: 'pending', resolution, operation } }
    }
    throw error
  }
}

const MIDJOURNEY_OPERATIONS = new Set([
  'imagine', 'blend', 'edit', 'upscale', 'variation', 'low_variation', 'high_variation',
  'reroll', 'zoom', 'pan', 'inpaint', 'remix_subtle', 'remix_strong', 'status',
])

async function runMidjourney(
  args: Record<string, unknown>,
  opts: SkillRunOptions,
): Promise<{ text: string; meta: object; images?: SkillImage[] }> {
  const operation = String(args.operation || '').trim().toLowerCase()
  if (!MIDJOURNEY_OPERATIONS.has(operation)) throw new Error('缺少或不支持 Midjourney operation')
  const { provider, model, providerName } = resolveMidjourneyTarget(imageOptions(opts))
  const taskIdInput = String(args.task_id || '').trim()
  const prompt = String(args.prompt || args.instruction || '').trim()
  const speed = String(args.speed || 'relax').trim().toLowerCase() as 'relax' | 'fast' | 'turbo'
  const shouldWait = args.wait !== false
  const path = typeof args.path === 'string' ? args.path.trim() : ''

  const finishTask = async (taskId: string, queryOnly = false) => {
    const deadline = Date.now() + 600_000
    for (;;) {
      const task = await getMidjourneyTask(provider, taskId, 180_000)
      if (task.status === 'failed') throw new Error(task.error || 'Midjourney 任务失败')
      if (task.status === 'succeeded') {
        const saved = task.images.length
          ? await saveImagesToFs(task.images, { rootId: opts.rootId ?? null, ...(path ? { path } : {}) })
          : []
        const where = path ? `已按路径「${path}」保存` : '保存在「生成图片」文件夹'
        return {
          text: saved.length
            ? `Midjourney 任务已完成（task_id: ${taskId}），${where}：\n${saved.map((image) => `- ${image.name}`).join('\n')}`
            : `Midjourney 任务已完成（task_id: ${taskId}），但没有返回图片。`,
          meta: { model, provider: providerName, taskId, status: task.status, operation },
          ...(saved.length ? { images: saved } : {}),
        }
      }
      if (queryOnly) {
        return { text: `Midjourney 任务仍在运行（task_id: ${taskId}）。`, meta: { model, provider: providerName, taskId, status: task.status, operation } }
      }
      if (Date.now() >= deadline) throw new Error(`Midjourney 任务等待超时（task_id: ${taskId}），可稍后使用 status 查询。`)
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }

  if (operation === 'status') {
    if (!taskIdInput) throw new Error('status 操作需要 task_id')
    return finishTask(taskIdInput, true)
  }

  let taskId = ''
  let submittedStatus = 'queued'
  if (['imagine', 'blend', 'edit'].includes(operation)) {
    if (operation !== 'blend' && !prompt) throw new Error(`${operation} 操作需要 prompt`)
    const refs = Array.isArray(args.image) ? args.image : args.image ? [args.image] : []
    const referenceImages = await Promise.all(refs.map((ref) => resolveImageBytes(ref, opts.rootId)))
    const submitted = await submitMidjourney(provider, model, {
      prompt,
      size: String(args.size || '1:1'),
      version: String(args.version || model),
      speed,
      mode: operation as 'imagine' | 'blend' | 'edit',
      reference_images: referenceImages,
    }, 180_000)
    taskId = submitted.taskId
    submittedStatus = submitted.status
  } else if (operation === 'inpaint') {
    if (!taskIdInput) throw new Error('inpaint 操作需要 task_id')
    if (!args.mask_image) throw new Error('inpaint 操作需要 mask_image')
    const mask = await resolveImageBytes(args.mask_image, opts.rootId)
    const submitted = await submitMidjourneyModal(provider, {
      task_id: taskIdInput,
      prompt,
      speed,
      mask_image: mask,
    }, 180_000)
    taskId = submitted.taskId
    submittedStatus = submitted.status
  } else {
    if (!taskIdInput) throw new Error(`${operation} 操作需要 task_id`)
    const submitted = await submitMidjourneyAction(provider, {
      task_id: taskIdInput,
      action: operation as 'upscale' | 'variation' | 'low_variation' | 'high_variation' | 'reroll' | 'zoom' | 'pan' | 'remix_subtle' | 'remix_strong',
      index: args.index === undefined ? undefined : Number(args.index),
      speed,
      direction: String(args.direction || '') as 'left' | 'right' | 'up' | 'down' | '',
      zoom_ratio: args.zoom_ratio === undefined ? undefined : Number(args.zoom_ratio),
      custom_id: String(args.custom_id || ''),
      prompt,
    }, 180_000)
    taskId = submitted.taskId
    submittedStatus = submitted.status
  }

  if (!shouldWait) {
    return {
      text: `Midjourney 任务已提交（task_id: ${taskId}，状态：${submittedStatus}）。`,
      meta: { model, provider: providerName, taskId, status: submittedStatus, operation },
    }
  }
  return finishTask(taskId)
}

function extensionMime(name: string, fallback: string): string {
  const ext = String(name || '').toLowerCase().split(/[?#]/, 1)[0].match(/\.([a-z0-9]{2,5})$/)?.[1] || ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  }
  return map[ext] || fallback
}

function isMediaMime(mime: string, kind: 'image' | 'video' | 'audio'): boolean {
  return mime.startsWith(`${kind}/`) || mime === 'application/octet-stream' || mime === ''
}

function parseDataMedia(ref: string, kind: 'image' | 'video' | 'audio'): EditImageInput | null {
  if (!ref.startsWith('data:')) return null
  const match = ref.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i)
  if (!match) throw new Error('媒体 data URL 格式无效')
  const mime = match[1] || `${kind}/*`
  if (!isMediaMime(mime, kind)) throw new Error(`引用的媒体不是${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}`)
  const buf = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]))
  return { buf, mime, name: `reference.${mediaExt(mime)}` }
}

/** 统一解析图片、视频、音频引用，支持 FS 节点、项目相对路径、data URL 和 http(s)。 */
async function resolveMediaBytes(
  ref: unknown,
  rootId: string | null | undefined,
  kind: 'image' | 'video' | 'audio',
): Promise<EditImageInput> {
  const s = String(ref ?? '').trim()
  if (!s) throw new Error(`空${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}引用`)
  const data = parseDataMedia(s, kind)
  if (data) return data
  const m = s.match(/\/api\/fs\/raw\/([0-9a-f-]{36})/i)
  let nodeId = m ? m[1] : /^[0-9a-f-]{36}$/i.test(s) ? s : ''
  if (!nodeId && !/^https?:\/\//i.test(s) && rootId !== undefined) {
    const node = findByPath(rootId ?? null, s)
    if (node) nodeId = node.id
  }
  if (nodeId) {
    const node = getNode(nodeId)
    const buf = readBlob(nodeId)
    if (!node || node.type !== 'file' || !buf) throw new Error(`找不到媒体：${s}`)
    const mime = node.mime || extensionMime(node.name, 'application/octet-stream')
    if (!isMediaMime(mime, kind)) throw new Error(`「${node.name}」不是${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}`)
    return { buf, mime, name: node.name || `reference.${mediaExt(mime)}` }
  }
  if (/^https?:\/\//i.test(s)) {
    const resp = await fetch(s)
    if (!resp.ok) throw new Error(`下载参考${kind === 'image' ? '图' : kind === 'video' ? '视频' : '音频'}失败：HTTP ${resp.status}`)
    const mime = (resp.headers.get('content-type') || '').split(';')[0].trim() || extensionMime(s, 'application/octet-stream')
    if (!isMediaMime(mime, kind)) throw new Error(`远程引用不是${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}`)
    const name = decodeURIComponent(new URL(s).pathname.split('/').pop() || `reference.${mediaExt(mime, s)}`)
    return { buf: Buffer.from(await resp.arrayBuffer()), mime, name }
  }
  throw new Error(`无法识别的${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}引用：${s.slice(0, 100)}`)
}

async function runGenerateImage(
  args: Record<string, unknown>,
  opts: { providerId?: string; model?: string; rootId?: string | null },
): Promise<{ text: string; meta: object; images: SkillImage[] }> {
  const prompt = String(args?.prompt ?? args?.instruction ?? '').trim()
  if (!prompt) throw new Error('缺少 prompt（要画什么）')
  const path = typeof args?.path === 'string' ? args.path.trim() : ''
  const size = typeof args?.size === 'string' && IMAGE_SIZES.includes(args.size) ? String(args.size) : '1024x1024'
  const n = Math.max(1, Math.min(4, Number(args?.n) || 1))

  const { provider, model, providerName } = resolveImageTarget(imageOptions(opts))
  const images = isJimengCliProvider(provider)
    ? (await generateJimengImage(prompt, model, size)).images.map((value) => ({ type: 'url' as const, value }))
    : (await generateImages(provider, model, { prompt, size, n })).images
  if (!images.length) throw new Error('图像接口调用成功，但未返回任何图片')

  const saved = await saveImagesToFs(images, { rootId: opts.rootId ?? null, ...(path ? { path } : {}) })
  const where = path ? `已按路径「${path}」保存` : '保存在「生成图片」文件夹'
  const text = `已生成 ${saved.length} 张图片，${where}：\n` + saved.map((s) => `- ${s.name}: ${s.url}`).join('\n')
  return { text, meta: { model, provider: providerName, size, count: saved.length }, images: saved }
}

interface VideoRefDraft {
  ref: string
  role?: string
}

function normalizeVideoRefs(raw: unknown, defaultRole = ''): VideoRefDraft[] {
  const items = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  return items
    .map((item): VideoRefDraft | null => {
      if (typeof item === 'string') {
        const ref = item.trim()
        return ref ? { ref, ...(defaultRole ? { role: defaultRole } : {}) } : null
      }
      if (!item || typeof item !== 'object') return null
      const value = item as Record<string, unknown>
      const ref = String(value.ref ?? value.url ?? value.path ?? value.id ?? '').trim()
      if (!ref) return null
      const role = String(value.role ?? defaultRole ?? '').trim()
      return { ref, ...(role ? { role } : {}) }
    })
    .filter((item): item is VideoRefDraft => !!item)
}

async function runGenerateVideo(
  args: Record<string, unknown>,
  opts: { providerId?: string; model?: string; rootId?: string | null },
): Promise<{ text: string; meta: object; videos?: SkillVideo[] }> {
  const operation = String(args?.operation || 'generate').trim().toLowerCase()
  const path = typeof args?.path === 'string' ? args.path.trim() : ''
  if (operation === 'status') {
    const submitId = String(args?.submit_id || '').trim()
    if (!submitId) throw new Error('status 操作需要 submit_id')
    const { provider, model, providerName } = resolveVideoTarget(opts)
    if (!isJimengCliProvider(provider)) throw new Error('当前视频任务续查仅支持即梦 CLI。')
    const queried = await queryJimengMedia(submitId, 'video')
    if (queried.status === 'failed') throw new Error(`即梦视频任务失败：${queried.error || '未知错误'}`)
    if (queried.status !== 'succeeded') {
      return { text: queried.message || `即梦视频仍在排队（submit_id: ${submitId}）。`, meta: { model, provider: providerName, submitId, status: queried.status, operation } }
    }
    const saved = await saveJimengVideoUrls(queried.urls, opts.rootId, path)
    return { text: `即梦视频任务已完成（submit_id: ${submitId}），已保存 ${saved.length} 个视频。`, meta: { model, provider: providerName, submitId, status: 'succeeded', operation }, videos: saved }
  }
  if (operation !== 'generate') throw new Error('不支持的视频 operation')
  const prompt = String(args?.prompt ?? args?.instruction ?? '').trim()
  if (!prompt) throw new Error('缺少 prompt（要生成什么视频）')

  const imageDrafts = [
    ...normalizeVideoRefs(args?.images),
    ...normalizeVideoRefs(args?.image),
    ...normalizeVideoRefs(args?.first_frame, 'first_frame'),
    ...normalizeVideoRefs(args?.last_frame, 'last_frame'),
  ]
  const videoDrafts = [
    ...normalizeVideoRefs(args?.videos, 'reference_video'),
    ...normalizeVideoRefs(args?.video, 'reference_video'),
    ...normalizeVideoRefs(args?.reference_video, 'reference_video'),
  ]
  const audioDrafts = [
    ...normalizeVideoRefs(args?.audios, 'reference_audio'),
    ...normalizeVideoRefs(args?.audio, 'reference_audio'),
    ...normalizeVideoRefs(args?.reference_audio, 'reference_audio'),
  ]

  const requestedMode = String(args?.mode || 'auto').trim()
  const hasFirstFrame = imageDrafts.some((item) => item.role === 'first_frame')
  const hasLastFrame = imageDrafts.some((item) => item.role === 'last_frame')
  const inferredIntent: CapabilityIntent = requestedMode !== 'auto'
    ? `video.${requestedMode}`
    : args?.multimodal === true
      ? 'video.multimodal'
      : videoDrafts.length
        ? 'video.video_to_video'
        : audioDrafts.length
          ? 'video.audio_reference'
          : hasFirstFrame && hasLastFrame
            ? 'video.first_last_frame'
            : imageDrafts.length > 1
              ? 'video.multi_reference'
              : imageDrafts.length === 1
                ? 'video.image_to_video'
                : 'video.text_to_video'

  const resolveRefs = async (drafts: VideoRefDraft[], kind: 'image' | 'video' | 'audio'): Promise<GenVideoReference[]> =>
    Promise.all(
      drafts.slice(0, kind === 'image' ? 9 : 3).map(async (draft) => ({
        ...(await resolveMediaBytes(draft.ref, opts.rootId ?? null, kind)),
        kind,
        ...(draft.role ? { role: draft.role } : {}),
      })),
    )

  const [images, videos, audios] = await Promise.all([
    resolveRefs(imageDrafts, 'image'),
    resolveRefs(videoDrafts, 'video'),
    resolveRefs(audioDrafts, 'audio'),
  ])
  const duration = Math.max(1, Math.min(60, Number(args?.duration) || 5))
  const aspectRatio = typeof args?.aspect_ratio === 'string'
    ? args.aspect_ratio
    : typeof args?.aspectRatio === 'string'
      ? args.aspectRatio
      : typeof args?.size === 'string'
        ? args.size
        : '16:9'
  const resolution = typeof args?.resolution === 'string' ? args.resolution : undefined
  const seed = args?.seed === undefined || args?.seed === null ? undefined : Number(args.seed)

  const { provider, model, providerName } = resolveVideoTarget(opts, inferredIntent)
  validateProtocolParameters(provider.protocol, model, inferredIntent, {
    duration,
    aspect_ratio: aspectRatio,
    ...(resolution ? { resolution } : {}),
    generate_audio: args?.generate_audio === true,
    enhance_prompt: args?.enhance_prompt === true,
    camera_fixed: args?.camera_fixed === true || args?.camerafixed === true,
    watermark: args?.watermark === true,
  }, { images: images.length, videos: videos.length, audios: audios.length })
  let generated: Array<{ type: 'url'; value: string }>
  if (isJimengCliProvider(provider)) {
    const imagePaths = images.map((input) => tempMediaFile(input.buf, input.mime, '.png'))
    const videoPaths = videos.map((input) => tempMediaFile(input.buf, input.mime, '.mp4'))
    const audioPaths = audios.map((input) => tempMediaFile(input.buf, input.mime, '.mp3'))
    try {
      const result = await generateJimengVideo(prompt, model, {
        imagePaths,
        imageRoles: images.map((input) => input.role || 'reference_image'),
        videoPaths,
        audioPaths,
        duration,
        aspect_ratio: aspectRatio,
        resolution,
        multimodal: inferredIntent === 'video.multimodal' || inferredIntent === 'video.video_to_video' || inferredIntent === 'video.audio_reference',
        pollSeconds: 120,
        deferPending: true,
      })
      generated = result.videos.map((value) => ({ type: 'url' as const, value }))
    } catch (error) {
      if (error instanceof JimengPendingError) {
        return {
          text: `即梦视频仍在排队（submit_id: ${error.submit_id}），稍后可用 status 续查。`,
          meta: { capability: inferredIntent, model, provider: providerName, submitId: error.submit_id, status: 'pending', operation },
        }
      }
      throw error
    }
  } else {
    generated = (await generateVideos(provider, model, {
      prompt,
      duration,
      size: typeof args?.size === 'string' ? args.size : undefined,
      aspect_ratio: aspectRatio,
      resolution,
      images,
      videos,
      audios,
      enhance_prompt: args?.enhance_prompt === true,
      enable_upsample: args?.enable_upsample === true,
      watermark: args?.watermark === true,
      seed: Number.isFinite(seed) ? seed : undefined,
      camerafixed: args?.camera_fixed === true || args?.camerafixed === true,
      return_last_frame: args?.return_last_frame === true,
      generate_audio: args?.generate_audio === true,
      multimodal: args?.multimodal === true,
      trusted_asset: args?.trusted_asset === true,
    }, undefined, 900000)).videos
  }
  if (!generated.length) throw new Error('视频接口调用成功，但未返回任何视频')

  const saved = await saveVideosToFs(generated, { rootId: opts.rootId ?? null, ...(path ? { path } : {}) })
  const where = path ? `已按路径「${path}」保存` : '保存在「生成视频」文件夹'
  const refs = [
    images.length ? `${images.length} 张图片` : '',
    videos.length ? `${videos.length} 个参考视频` : '',
    audios.length ? `${audios.length} 个参考音频` : '',
  ].filter(Boolean).join('、')
  const text = `已生成 ${saved.length} 个视频，${where}${refs ? `（使用${refs}）` : ''}：\n` + saved.map((item) => `- ${item.name}: ${item.url}`).join('\n')
  return {
    text,
    meta: { capability: inferredIntent, model, provider: providerName, duration, aspectRatio, resolution: resolution || '', count: saved.length, imageRefs: images.length, videoRefs: videos.length, audioRefs: audios.length },
    videos: saved,
  }
}

async function executeImageEdit(provider: ResolvedProvider, model: string, prompt: string, size: string, n: number, inputs: EditImageInput[]) {
  if (isJimengCliProvider(provider)) {
    const paths = inputs.map((input) => tempMediaFile(input.buf, input.mime, '.png'))
    const result = await generateJimengImage(prompt, model, size, paths)
    return result.images.map((value) => ({ type: 'url' as const, value }))
  }
  return (await editImages(provider, model, { prompt, size, n }, inputs)).images
}

async function runTextToSpeech(args: Record<string, unknown>, opts: SkillRunOptions) {
  const text = String(args.text || args.instruction || '').trim()
  if (!text) throw new Error('缺少要合成的文字')
  const { provider, model, providerName } = resolveAudioTarget(audioOptions(opts), 'audio.tts')
  const format = String(args.format || 'mp3').toLowerCase()
  const generated = await generateSpeech(provider, model, {
    input: text,
    voice: String(args.voice || 'alloy'),
    speed: Number(args.speed) || 1,
    response_format: format,
  })
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  const audios = await saveAudiosToFs([{ data: generated.data, mime: generated.mime }], { rootId: opts.rootId ?? null, ...(path ? { path } : {}) })
  return { text: `语音合成完成，已保存 ${audios.length} 个音频文件。`, meta: { model, provider: providerName, format, count: audios.length }, audios }
}

async function runTranscribeAudio(args: Record<string, unknown>, opts: SkillRunOptions) {
  const operation = String(args.operation || 'transcribe').toLowerCase()
  if (!['transcribe', 'translate'].includes(operation)) throw new Error('不支持的音频文字操作')
  const input = await resolveMediaBytes(args.audio, opts.rootId, 'audio')
  const intent = operation === 'translate' ? 'audio.translate' : 'audio.transcribe'
  const { provider, model, providerName } = resolveAudioTarget(audioOptions(opts), intent)
  const result = await transcribeAudio(provider, model, input, {
    translate: operation === 'translate',
    language: String(args.language || ''),
    prompt: String(args.prompt || ''),
  })
  return { text: result.text, meta: { model, provider: providerName, operation } }
}

async function runGenerateMusic(args: Record<string, unknown>, opts: SkillRunOptions) {
  const prompt = String(args.prompt || args.instruction || '').trim()
  if (!prompt) throw new Error('缺少音乐生成提示词')
  const { provider, model, providerName } = resolveAudioTarget(audioOptions(opts), 'audio.music')
  const result = await generateMusic(provider, model, {
    prompt,
    title: String(args.title || ''),
    lyrics: String(args.lyrics || ''),
    style: String(args.style || ''),
    instrumental: args.instrumental === true,
  })
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  const audios = await saveAudiosToFs(result.audios.map((audio) => ({ url: audio.value })), { rootId: opts.rootId ?? null, ...(path ? { path } : {}) })
  return { text: `音乐生成完成，已保存 ${audios.length} 个音频文件。`, meta: { model, provider: providerName, count: audios.length }, audios }
}

async function runEditImage(
  args: Record<string, unknown>,
  opts: { providerId?: string; model?: string; rootId?: string | null },
): Promise<{ text: string; meta: object; images: SkillImage[] }> {
  const prompt = String(args?.prompt ?? args?.instruction ?? '').trim()
  if (!prompt) throw new Error('缺少 prompt（要怎么改）')
  const raw = args?.image ?? args?.images
  const refs = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x ?? '').trim()).filter(Boolean)
  if (!refs.length) throw new Error('缺少参考图（image）')
  const path = typeof args?.path === 'string' ? args.path.trim() : ''
  const size = typeof args?.size === 'string' && IMAGE_SIZES.includes(args.size) ? String(args.size) : '1024x1024'
  const n = Math.max(1, Math.min(4, Number(args?.n) || 1))

  const inputs = await Promise.all(refs.slice(0, 8).map((r) => resolveImageBytes(r, opts.rootId ?? null)))
  const { provider, model, providerName } = resolveImageTarget(imageOptions(opts))
  const images = await executeImageEdit(provider, model, prompt, size, n, inputs)
  if (!images.length) throw new Error('图像编辑成功，但未返回任何图片')

  const saved = await saveImagesToFs(images, { rootId: opts.rootId ?? null, ...(path ? { path } : {}) })
  const where = path ? `已按路径「${path}」保存` : '保存在「生成图片」文件夹'
  const text =
    `已编辑生成 ${saved.length} 张图片（参考图 ${inputs.length} 张），${where}：\n` + saved.map((s) => `- ${s.name}: ${s.url}`).join('\n')
  return { text, meta: { model, provider: providerName, size, count: saved.length, refs: inputs.length }, images: saved }
}

// ── batch_image_group_process：多图分组 → 每组编辑 ──────────────────────
type GroupMode = 'sequential' | 'all_each' | 'all_in_one' | 'combinations'
type RemainderPolicy = 'run' | 'skip' | 'error'

interface BatchGroupResult {
  index: number
  status: 'succeeded' | 'failed' | 'skipped'
  sourceRefs: string[]
  images?: SkillImage[]
  error?: string
}

// C(items, k) 组合（保序）。
function combinations(items: string[], k: number): string[][] {
  const out: string[][] = []
  const pick = (start: number, cur: string[]) => {
    if (cur.length === k) {
      out.push(cur.slice())
      return
    }
    for (let i = start; i < items.length; i++) {
      cur.push(items[i])
      pick(i + 1, cur)
      cur.pop()
    }
  }
  if (k >= 1 && k <= items.length) pick(0, [])
  return out
}

// 把图片引用按分组规则切成若干组。
function buildGroups(refs: string[], mode: GroupMode, groupSize: number, remainder: RemainderPolicy): string[][] {
  const gs = Math.max(1, groupSize)
  if (mode === 'all_in_one') return refs.length ? [refs.slice()] : []
  if (mode === 'all_each') return refs.map((r) => [r])
  if (mode === 'combinations') return combinations(refs, gs)
  // sequential
  const groups: string[][] = []
  for (let i = 0; i < refs.length; i += gs) {
    const chunk = refs.slice(i, i + gs)
    if (chunk.length < gs) {
      if (remainder === 'skip') continue
      if (remainder === 'error') throw new Error(`最后剩余 ${chunk.length} 张不足一组（groupSize=${gs}），remainderPolicy=error`)
    }
    groups.push(chunk)
  }
  return groups
}

// 简单并发池：最多 limit 个 worker 并行消费 items。
async function runPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) break
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

async function runBatchImage(
  args: Record<string, unknown>,
  opts: { providerId?: string; model?: string; rootId?: string | null },
): Promise<{ text: string; meta: object; images: SkillImage[] }> {
  const prompt = String(args?.prompt ?? args?.instruction ?? '').trim()
  if (!prompt) throw new Error('缺少 prompt（对每组图片执行的编辑提示词）')
  const raw = args?.image ?? args?.images
  const refs = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x ?? '').trim()).filter(Boolean)
  if (!refs.length) throw new Error('缺少待处理图片（image）')

  const mode = (['sequential', 'all_each', 'all_in_one', 'combinations'] as GroupMode[]).includes(args?.groupMode as GroupMode)
    ? (args.groupMode as GroupMode)
    : 'sequential'
  const groupSize = Math.max(1, Number(args?.groupSize) || 1)
  const remainder = (['run', 'skip', 'error'] as RemainderPolicy[]).includes(args?.remainderPolicy as RemainderPolicy)
    ? (args.remainderPolicy as RemainderPolicy)
    : 'run'
  const concurrency = Math.max(1, Math.min(4, Number(args?.concurrency) || 2))
  const rcRaw = Number(args?.retryCount)
  const retryCount = Number.isFinite(rcRaw) ? Math.max(0, Math.min(5, rcRaw)) : 1
  const maxRef = Math.max(1, Math.min(8, Number(args?.maxReferenceImages) || 4))
  const failurePolicy = args?.failurePolicy === 'stop' ? 'stop' : 'continue'
  const size = typeof args?.size === 'string' && IMAGE_SIZES.includes(args.size) ? String(args.size) : '1024x1024'
  const n = Math.max(1, Math.min(4, Number(args?.n) || 1))

  let groups = buildGroups(refs, mode, groupSize, remainder)
  if (!groups.length) throw new Error('按当前分组规则没有可执行的组')
  const cap = Number(args?.maxGroups) > 0 ? Number(args.maxGroups) : mode === 'combinations' ? 200 : 0
  let truncated = 0
  if (cap && groups.length > cap) {
    truncated = groups.length - cap
    groups = groups.slice(0, cap)
  }

  // 唯一参考图只解析一次（组合模式下同图会被多组复用，避免重复下载）。
  const byteMap = new Map<string, EditImageInput>()
  await Promise.all([...new Set(refs)].map(async (r) => byteMap.set(r, await resolveImageBytes(r, opts.rootId ?? null))))

  const { provider, model, providerName } = resolveImageTarget(imageOptions(opts))
  let stopped = false

  const results = await runPool(groups, concurrency, async (groupRefs, i): Promise<BatchGroupResult> => {
    if (stopped) return { index: i, status: 'skipped', sourceRefs: groupRefs, error: '已因前序失败停止' }
    const inputs = groupRefs.slice(0, maxRef).map((r) => byteMap.get(r)!).filter(Boolean)
    let lastErr = ''
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const images = await executeImageEdit(provider, model, prompt, size, n, inputs)
        if (!images.length) throw new Error('未返回图片')
        const saved = await saveImagesToFs(images, { rootId: opts.rootId ?? null })
        return { index: i, status: 'succeeded', sourceRefs: groupRefs, images: saved }
      } catch (e) {
        lastErr = String((e as Error).message || e)
      }
    }
    if (failurePolicy === 'stop') stopped = true
    return { index: i, status: 'failed', sourceRefs: groupRefs, error: lastErr }
  })

  const allImages = results.flatMap((r) => r.images || [])
  const okCount = results.filter((r) => r.status === 'succeeded').length
  const failed = results.filter((r) => r.status === 'failed')
  const skipped = results.filter((r) => r.status === 'skipped').length

  let text = `批量处理完成：共 ${groups.length} 组，成功 ${okCount}，失败 ${failed.length}${skipped ? `，跳过 ${skipped}` : ''}。产出 ${allImages.length} 张图片，保存在「生成图片」文件夹。`
  if (truncated) text += `\n（分组数超出上限，已截断 ${truncated} 组）`
  if (failed.length) {
    text += '\n失败组：\n' + failed.map((r) => `- 组 ${r.index + 1}: ${r.error}`).join('\n')
  }

  return {
    text,
    meta: {
      model,
      provider: providerName,
      mode,
      groups: groups.length,
      ok: okCount,
      fail: failed.length,
      skipped,
      truncated,
      count: allImages.length,
    },
    images: allImages,
  }
}

// ── describe_image：看图 → 文字（走 OpenAI 兼容视觉模型）──────────────
async function runDescribeImage(
  args: Record<string, unknown>,
  opts: { providerId?: string; model?: string; rootId?: string | null },
): Promise<{ text: string; meta: object }> {
  const ref = args?.image ?? (Array.isArray(args?.images) ? (args.images as unknown[])[0] : undefined)
  if (ref === undefined || ref === null || String(ref).trim() === '') throw new Error('缺少要识别的图片（image）')
  const prompt = String(args?.prompt ?? args?.instruction ?? '').trim() || '请用中文详细描述这张图片的画面内容。'
  const input = await resolveImageBytes(ref, opts.rootId ?? null)
  const dataUrl = `data:${input.mime || 'image/png'};base64,${input.buf.toString('base64')}`
  const { provider, model, providerName } = resolveVisionTarget(opts)
  const text = await describeImage(provider, model, dataUrl, prompt)
  if (!text) throw new Error('视觉模型未返回内容（该模型可能不支持看图）')
  return { text, meta: { model, provider: providerName } }
}

// ── AI 生成歌手/专辑图（无版权：原创插画，非真人写实照）──────────────
async function genImageToBuffer(img: GenImage): Promise<Buffer | null> {
  try {
    if (img.type === 'b64') return Buffer.from(img.value, 'base64')
    const resp = await fetch(img.value)
    if (!resp.ok) return null
    return Buffer.from(await resp.arrayBuffer())
  } catch {
    return null
  }
}

/** 给曲库里还没有图的歌手/专辑用图像模型生成原创插画，写入艺术图缓存。 */
export async function generateMusicArtwork(): Promise<{ artists: number; albums: number; failed: number }> {
  const { artists, albums } = await artworkTargets()
  const { provider, model } = resolveImageTarget({})
  let artistsDone = 0
  let albumsDone = 0
  let failed = 0
  for (const name of artists) {
    try {
      const prompt =
        `为音乐人「${name}」设计一张方形头像插画：现代、有音乐氛围的原创艺术风格，` +
        `抽象或象征性地表达其音乐气质。不要写实的真实人物照片、不要模仿任何真实人物的长相、不要文字或水印。`
      const { images } = await generateImages(provider, model, { prompt, size: '1024x1024', n: 1 })
      const buf = images[0] ? await genImageToBuffer(images[0]) : null
      if (buf) {
        putArtwork('artist', name, buf)
        artistsDone++
      } else failed++
    } catch {
      failed++
    }
  }
  for (const { artist, album, key } of albums) {
    try {
      const prompt =
        `为专辑「${album}」（音乐人：${artist}）设计一张原创专辑封面插画：方形、有意境、契合专辑名的氛围与情绪，` +
        `艺术化视觉表达。不要真实人物照片、不要文字或 logo、不要模仿现有专辑封面。`
      const { images } = await generateImages(provider, model, { prompt, size: '1024x1024', n: 1 })
      const buf = images[0] ? await genImageToBuffer(images[0]) : null
      if (buf) {
        putArtwork('album', key, buf)
        albumsDone++
      } else failed++
    } catch {
      failed++
    }
  }
  await libScan()
  return { artists: artistsDone, albums: albumsDone, failed }
}

/** 只给还没有图的歌手生成原创头像插画（不处理专辑）。 */
export async function generateArtistsArtwork(): Promise<{ artists: number; failed: number }> {
  const { artists } = await artworkTargets()
  const { provider, model } = resolveImageTarget({})
  let artistsDone = 0
  let failed = 0
  for (const name of artists) {
    try {
      const prompt = `为音乐人「${name}」设计一张方形头像插画：现代、有音乐氛围的风格`
      const { images } = await generateImages(provider, model, { prompt, size: '1024x1024', n: 1 })
      const buf = images[0] ? await genImageToBuffer(images[0]) : null
      if (buf) {
        putArtwork('artist', name, buf)
        artistsDone++
      } else failed++
    } catch {
      failed++
    }
  }
  await libScan()
  return { artists: artistsDone, failed }
}

// ── 执行入口 ──────────────────────────────────────────────────────────
export async function runSkill(
  id: string,
  args: Record<string, unknown>,
  opts: SkillRunOptions = {},
): Promise<{ text: string; meta: object; images?: SkillImage[]; videos?: SkillVideo[]; audios?: SkillAudio[] }> {
  const store = loadStore()
  const def = allDefs(store).find((s) => s.id === id)
  if (!def) throw new Error(`未知技能：${id}`)
  if (store.enabled[id] === false) throw new Error(`技能「${def.name}」已停用`)

  if (def.kind === 'image') return runGenerateImage(args, opts)
  if (def.kind === 'image_upscale') return runUpscaleImage(args, opts)
  if (def.kind === 'midjourney') return runMidjourney(args, opts)
  if (def.kind === 'image_edit') return runEditImage(args, opts)
  if (def.kind === 'image_batch') return runBatchImage(args, opts)
  if (def.kind === 'image_describe') return runDescribeImage(args, opts)
  if (def.kind === 'video') return runGenerateVideo(args, opts)
  if (def.kind === 'audio_tts') return runTextToSpeech(args, opts)
  if (def.kind === 'audio_transcribe') return runTranscribeAudio(args, opts)
  if (def.kind === 'audio_music') return runGenerateMusic(args, opts)
  if (def.kind === 'procedure') return runProcedureSkill(def, args, opts)

  const instruction = String(args?.instruction ?? '').trim()
  if (!instruction) throw new Error('缺少 instruction')

  const { provider, model, providerName } = resolveChatTarget(opts)
  const r = await callChat(provider, model, { prompt: instruction, system: def.systemPrompt }, {}, 180000)
  if (!r.text) throw new Error('LLM 未返回文本')
  return { text: r.text, meta: { model, provider: providerName, latencyMs: r.latencyMs } }
}

// ── procedure Skill 执行器：Agent 小循环驱动基础 skill ────────────────
// 第三方 Skill 解析后的形态：工作流步骤 + 资源模板。执行时模型按步骤推进，
// 能力全部来自我们自己的基础 skill（生图/写作/…，走用户配置的 API 站点）。

export const PROCEDURE_BASE_SKILL_IDS = ['writing', 'rewrite', 'analysis', 'code', 'chat', 'generate_image', 'upscale_image', 'midjourney', 'generate_video', 'text_to_speech', 'transcribe_audio', 'generate_music', 'edit_image', 'describe_image'] as const
const PROC_BASE_SKILLS = new Set<string>(PROCEDURE_BASE_SKILL_IDS)
const PROC_MAX_ROUNDS = 12
const PROC_MAX_CALLS = 16

/** 上游 429/5xx 是暂时的：指数退避重试，其他错误直接抛。 */
async function withTransientRetry<T>(run: () => Promise<T>, tries = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < tries; attempt++) {
    try { return await run() } catch (e) {
      lastError = e
      const msg = String((e as Error).message || e)
      if (!/HTTP (429|502|503|504)/.test(msg)) throw e
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)))
    }
  }
  throw lastError
}

function procedureTools(allowed: string[], hasSourceFiles = false) {
  // 白名单里声明的基础 skill + finish；未声明时开放全部基础 skill
  const wanted = allowed.filter((t) => PROC_BASE_SKILLS.has(t))
  const pick = new Set(wanted.length ? wanted : [...PROC_BASE_SKILLS])
  const defs = SKILLS.filter((s) => pick.has(s.id)).map((s) => ({
    type: 'function' as const,
    function: { name: s.id, description: `[基础能力] ${s.description}`, parameters: s.inputSchema },
  }))
  return [
    ...defs,
    ...(hasSourceFiles ? [{
      type: 'function' as const,
      function: {
        name: 'read_skill_resource',
        description: '按相对路径读取当前 Skill 自带的 reference、模板或文本元数据',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '资源相对路径，必须从可用资源路径中选择' } },
          required: ['path'],
        },
      },
    }] : []),
    {
      type: 'function' as const,
      function: {
        name: 'finish',
        description: '全部步骤完成后调用，汇总结果',
        parameters: { type: 'object', properties: { summary: { type: 'string', description: '给用户的结果说明' } }, required: ['summary'] },
      },
    },
  ]
}

async function runProcedureSkill(
  def: SkillDef,
  args: Record<string, unknown>,
  opts: SkillRunOptions,
): Promise<{ text: string; meta: object; images?: SkillImage[]; videos?: SkillVideo[]; audios?: SkillAudio[] }> {
  const instruction = String(args?.instruction ?? '').trim()
  if (!instruction) throw new Error('缺少 instruction')
  const v2 = def.v2
  const { provider, model, providerName } = resolveChatTarget(opts)
  const started = Date.now()

  const resources = (v2?.resources || []).slice(0, 6)
    .map((r) => `【资源：${r.name}】\n${r.content.slice(0, 3000)}`).join('\n\n')
  const sourcePaths = (def.source?.files || []).map((file) => file.path)
  const system = [
    def.systemPrompt || `你是技能「${def.name}」的执行器。`,
    '',
    '执行规则：',
    '- 按工作流逐步执行，每一步用提供的基础能力工具完成实际工作，不要只输出计划。',
    '- 工具返回的产物（文本/图片/视频）就是交付物；媒体工具会把文件存到用户指定目录。',
    '- 资源模板是原作者的最佳实践，拼提示词时优先套用。',
    sourcePaths.length ? '- SKILL.md 引用外部资料时，先用 read_skill_resource 读取对应原文，不要凭空补全。' : '',
    '- 全部完成后调用 finish 汇总。',
  ].filter(Boolean).join('\n')

  const messages: ToolMessage[] = [{
    role: 'user',
    content: [
      resources ? `可用资源模板：\n\n${resources}` : '',
      sourcePaths.length ? `Skill 原始资源路径：\n${sourcePaths.map((path) => `- ${path}`).join('\n')}` : '',
      `用户请求：${instruction}`,
    ].filter(Boolean).join('\n\n'),
  }]

  const tools = procedureTools(v2?.allowedTools || [], sourcePaths.length > 0)
  const collectedImages: SkillImage[] = []
  const collectedVideos: SkillVideo[] = []
  const collectedAudios: SkillAudio[] = []
  const stepLog: string[] = []
  let calls = 0

  for (let round = 0; round < PROC_MAX_ROUNDS; round++) {
    const r = await withTransientRetry(() => chatWithTools(provider, model, messages, system, tools, 240_000))
    if (!r.toolCalls.length) {
      // 没有动作：把文字当结果收尾（防呆）
      if (r.content.trim()) {
        return {
          text: [r.content.trim(), stepLog.length ? `\n— 执行记录 —\n${stepLog.join('\n')}` : ''].join('\n'),
          meta: { model, provider: providerName, latencyMs: Date.now() - started, steps: stepLog.length },
          ...(collectedImages.length ? { images: collectedImages } : {}),
          ...(collectedVideos.length ? { videos: collectedVideos } : {}),
          ...(collectedAudios.length ? { audios: collectedAudios } : {}),
        }
      }
      messages.push({ role: 'user', content: '请调用工具继续执行工作流，全部完成后调用 finish。' })
      continue
    }
    messages.push({ role: 'assistant', content: r.content || '', tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) })
    for (const call of r.toolCalls) {
      if (call.name === 'finish') {
        let summary = ''
        try { summary = String((JSON.parse(call.arguments || '{}') as { summary?: string }).summary || '') } catch { /* ignore */ }
        return {
          text: [summary || '技能执行完成', stepLog.length ? `\n— 执行记录 —\n${stepLog.join('\n')}` : ''].join('\n'),
          meta: { model, provider: providerName, latencyMs: Date.now() - started, steps: stepLog.length },
          ...(collectedImages.length ? { images: collectedImages } : {}),
          ...(collectedVideos.length ? { videos: collectedVideos } : {}),
          ...(collectedAudios.length ? { audios: collectedAudios } : {}),
        }
      }
      if (++calls > PROC_MAX_CALLS) throw new Error(`技能「${def.name}」执行超出调用上限（${PROC_MAX_CALLS} 次）`)
      let observation: string
      try {
        let callArgs: Record<string, unknown> = {}
        try { callArgs = JSON.parse(call.arguments || '{}') as Record<string, unknown> } catch { /* ignore */ }
        if (call.name === 'read_skill_resource') {
          const path = String(callArgs.path || '').replace(/\\/g, '/')
          const file = def.source?.files.find((item) => item.path === path)
          if (!file) throw new Error(`Skill 资源不存在：${path}`)
          stepLog.push(`✓ 读取 Skill 资源 ${path}`)
          observation = file.content.slice(0, 16_000)
          messages.push({ role: 'tool', tool_call_id: call.id, content: observation })
          continue
        }
        // 递归调基础 skill（procedure 不会嵌套 procedure：PROC_BASE_SKILLS 只含内置原子技能）
        const result = await withTransientRetry(() => runSkill(call.name, callArgs, opts))
        if (result.images?.length) collectedImages.push(...result.images)
        if (result.videos?.length) collectedVideos.push(...result.videos)
        if (result.audios?.length) collectedAudios.push(...result.audios)
        stepLog.push(`✓ ${call.name}${result.images?.length ? `（产出 ${result.images.length} 张图）` : ''}${result.videos?.length ? `（产出 ${result.videos.length} 个视频）` : ''}${result.audios?.length ? `（产出 ${result.audios.length} 个音频）` : ''}`)
        observation = [
          result.text,
          result.images?.length ? `已保存图片：${result.images.map((im) => im.name).join('、')}` : '',
          result.videos?.length ? `已保存视频：${result.videos.map((video) => video.name).join('、')}` : '',
          result.audios?.length ? `已保存音频：${result.audios.map((audio) => audio.name).join('、')}` : '',
        ].filter(Boolean).join('\n').slice(0, 6000)
      } catch (e) {
        const msg = String((e as Error).message || e)
        stepLog.push(`✗ ${call.name}：${msg.slice(0, 80)}`)
        observation = `执行失败：${msg}`
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: observation })
    }
  }
  throw new Error(`技能「${def.name}」超过最大执行轮数仍未完成`)
}
