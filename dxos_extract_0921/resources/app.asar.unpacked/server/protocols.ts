// ══════════════════════════════════════════════════════════════════════

import { callRunningHubChat, describeRunningHubImage, editRunningHubImages, fetchRunningHubModels, generateRunningHubImages, generateRunningHubVideos } from './runninghub.ts'
import { editModelScopeImages, generateModelScopeImages } from './modelscope.ts'
import { editAgnesImages, generateAgnesImages, generateAgnesVideos } from './agnes.ts'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { dataPath } from './dataPaths.ts'
import { generateJimengImage, generateJimengVideo, tempMediaFile } from './cliTools.ts'
import { editCodexImage, generateCodexImage, runAgentCliChat } from './agentCliTools.ts'
import { defaultProtocolClock, defaultProtocolTransport, type ProtocolClock, type ProtocolTransport } from './protocol-engine/transport.ts'
// 协议引擎（数据优先）—— 移植自旧 Python protocol_engine + protocols/*.json
// 每个协议用一份数据描述：鉴权 + 能力(端点/请求体/解析) + 模型列表端点。
// 新增协议 = 往 PROTOCOLS 里加一项，无需改调用逻辑。
// ══════════════════════════════════════════════════════════════════════

export type AuthType = 'bearer' | 'google_api_key' | 'api_key_header' | 'none'
export type BodyKind = 'openai_chat' | 'anthropic_messages' | 'gemini_content'
export type ParseKind = 'openai_chat' | 'anthropic_text' | 'gemini_text'
export type ModelsKind = 'openai' | 'anthropic' | 'gemini'

export interface Capability {
  endpoint: string
  method?: string
  body: BodyKind
  parse: ParseKind
}

export interface ProtocolDef {
  id: string
  label: string
  summary: string
  kind?: 'provider-protocol-package' | 'model-protocol-package'
  scope?: 'provider' | 'model' | 'hybrid'
  runtimeProtocol?: string
  categories?: string[]
  auth: { type: AuthType; header?: string; prefix?: string }
  /** 额外固定请求头（如 anthropic 的版本号） */
  headers?: Record<string, string>
  /** 部分平台会把标准响应包在 { code, data } 里。 */
  unwrapData?: boolean
  /** 拉取模型列表的端点与解析方式 */
  models: { endpoint: string; kind: ModelsKind }
  /**
   * 是否强制走流式并在服务端累积（openai 兼容用）。
   * 原因：部分中转站/推理模型（如 gpt-5.5）非流式会返回空 content，
   * 流式则正常。累积后仍以完整文本一次性返回给前端。
   */
  stream?: boolean
  capabilities: Record<string, Capability>
  /** UI 动态参数草稿：用于画布参数栏按能力渲染额外控件。 */
  paramSchema?: Record<string, unknown[]>
  operations?: Record<string, unknown>
  modelProfiles?: Record<string, unknown>
  uiSchemas?: Record<string, unknown[]>
  docs?: { title: string; url: string }[]
}

const ASPECT_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const VIDEO_SCHEMA = [
  { key: 'duration', label: '视频时长', description: '输出视频的目标时长（秒），实际范围由模型协议校验。', type: 'number', default: 5, min: 1, max: 60, step: 1, bind: 'body.duration' },
  { key: 'aspect_ratio', label: '画面比例', description: '输出画面的宽高比。', type: 'select', default: '16:9', options: ASPECT_OPTIONS.map((value) => ({ label: value, value })), bind: 'body.aspect_ratio' },
  { key: 'resolution', label: '输出清晰度', description: '输出分辨率档位，模型不支持时由协议适配器给出明确提示。', type: 'select', default: '720p', options: ['480p', '720p', '1080p', '4k'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.resolution' },
  { key: 'generate_audio', label: '同时生成声音', description: '让支持音视频联合生成的模型同时生成环境声、对白或音乐。', type: 'toggle', default: false, bind: 'body.generate_audio' },
  { key: 'enhance_prompt', label: '自动优化提示词', description: '由平台扩写和优化视频提示词。', type: 'toggle', default: false, bind: 'body.enhance_prompt' },
  { key: 'camera_fixed', label: '固定镜头', description: '减少镜头位移，适合固定机位或产品展示。', type: 'toggle', default: false, bind: 'body.camerafixed' },
  { key: 'watermark', label: '添加水印', type: 'toggle', default: false, bind: 'body.watermark' },
  { key: 'seed', label: '随机种子', description: '相同模型和参数下用于提高结果可复现性；0 表示随机。', type: 'number', default: 0, min: 0, bind: 'body.seed' },
]
const JIMENG_VIDEO_RATIOS = ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9']
const JIMENG_BASE_VIDEO_LIMITS = {
  duration: { min: 4, max: 15, step: 1, integer: true, default: 5 },
  aspect_ratio: { options: JIMENG_VIDEO_RATIOS, default: '16:9' },
  resolution: { options: ['720p'], default: '720p' },
  references: { images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } },
  features: { generate_audio: false, enhance_prompt: false, camera_fixed: false, watermark: false },
}
const JIMENG_SEEDANCE2_LIMITS = {
  ...JIMENG_BASE_VIDEO_LIMITS,
  byCapability: {
    'video.text_to_video': { references: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } } },
    'video.image_to_video': { references: { images: { min: 1, max: 1 }, videos: { max: 0 }, audios: { max: 0 } } },
    'video.first_last_frame': { references: { images: { min: 2, max: 2 }, videos: { max: 0 }, audios: { max: 0 } } },
    'video.multi_reference': { resolution: { options: ['720p', '1080p'], default: '720p' }, references: { images: { min: 2, max: 20 }, videos: { max: 0 }, audios: { max: 0 } } },
    'video.video_to_video': { references: { images: { max: 9 }, videos: { min: 1, max: 3 }, audios: { max: 3 } } },
    'video.audio_reference': { references: { images: { min: 1, max: 9 }, videos: { max: 0 }, audios: { min: 1, max: 3 } } },
  },
}
const APIMART_VEO_LIMITS = {
  duration: { min: 4, max: 8, step: 1, integer: true, default: 5 },
  size: { options: ['16:9', '9:16'], default: '16:9' },
  aspect_ratio: { options: ['16:9', '9:16'], default: '16:9' },
  resolution: { options: ['720p', '1080p', '4k'], default: '720p' },
  references: { images: { max: 3 }, videos: { max: 0 }, audios: { max: 0 } },
  features: { enhance_prompt: false, camera_fixed: false, watermark: false },
}
const APIMART_SEEDANCE_LIMITS = {
  duration: { min: 4, max: 15, step: 1, integer: true, default: 5 },
  size: { options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], default: '16:9' },
  aspect_ratio: { options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], default: '16:9' },
  resolution: { options: ['480p', '720p', '1080p', '4k'], default: '480p' },
  references: { images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } },
}
const IMAGE_SCHEMA = [
  { key: 'aspect_ratio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '4:3', '3:4', '16:9', '9:16'].map((value) => ({ label: value, value })), bind: 'body.aspect_ratio' },
  { key: 'size', label: '尺寸', type: 'select', default: '1024x1024', options: ['1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792'].map((value) => ({ label: value, value })), bind: 'body.size' },
  { key: 'seed', label: '种子', type: 'number', default: 0, min: 0, bind: 'body.seed' },
]
const MODELSCOPE_IMAGE_SCHEMA = [
  { key: 'size', label: '尺寸', type: 'select', default: '1024x1024', options: ['1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792'].map((value) => ({ label: value, value })), bind: 'body.size' },
]
const VOLCENGINE_IMAGE_SCHEMA = [
  { key: 'size', label: '尺寸', description: 'Seedream 5.0 建议从 2K 起步。', type: 'select', default: '2048x2048', options: ['2048x2048', '2048x3072', '3072x2048', '4096x4096'].map((value) => ({ label: value, value })), bind: 'body.size' },
]
const VOLCENGINE_VIDEO_SCHEMA = [
  { key: 'duration', label: '视频时长', type: 'number', default: 5, min: 1, max: 60, step: 1, bind: 'body.duration' },
  { key: 'aspect_ratio', label: '画面比例', type: 'select', default: '16:9', options: ASPECT_OPTIONS.map((value) => ({ label: value, value })), bind: 'body.ratio' },
  { key: 'resolution', label: '输出清晰度', type: 'select', default: '720p', options: ['480p', '720p', '1080p'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.resolution' },
  { key: 'generate_audio', label: '同时生成声音', type: 'toggle', default: false, bind: 'body.generate_audio' },
  { key: 'camera_fixed', label: '固定镜头', type: 'toggle', default: false, bind: 'body.camerafixed' },
  { key: 'watermark', label: '添加水印', type: 'toggle', default: false, bind: 'body.watermark' },
  { key: 'seed', label: '随机种子', type: 'number', default: 0, min: 0, bind: 'body.seed' },
]
const AGNES_IMAGE_SCHEMA = [
  { key: 'size', label: '尺寸', type: 'select', default: '1024x1024', options: ['1024x1024', '1024x1536', '1536x1024'].map((value) => ({ label: value, value })), bind: 'body.size' },
]
const MUSIC_SCHEMA = [
  { key: 'title', label: '标题', type: 'text', default: '', bind: 'body.title' },
  { key: 'lyrics', label: '歌词', type: 'textarea', default: '', bind: 'body.lyrics' },
  { key: 'style', label: '风格', type: 'text', default: '', bind: 'body.style' },
  { key: 'instrumental', label: '纯音乐', type: 'toggle', default: false, bind: 'body.instrumental' },
]

export const PROTOCOLS: Record<string, ProtocolDef> = {
  openai: {
    id: 'openai',
    label: 'OpenAI 兼容',
    kind: 'provider-protocol-package',
    summary: 'OpenAI 风格协议包：Chat Completions、流式返回、视觉输入、工具调用、结构化输出、Responses、Images、Video、Audio、Embeddings、Files 与 Batches。',
    categories: ['llm', 'vision', 'tools', 'responses', 'image', 'video', 'audio', 'embedding', 'files', 'batches', 'moderation'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    stream: true,
    capabilities: {
      llm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      vlm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'llm.chat': {
        label: 'Chat Completions',
        method: 'POST',
        path: '/v1/chat/completions',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: '{{messages}}',
          temperature: '{{params.temperature}}',
          top_p: '{{params.top_p}}',
          max_tokens: '{{params.max_tokens}}',
          response_format: '{{params.response_format}}',
        },
        response: {
          text: '$.choices[0].message.content',
          finishReason: '$.choices[0].finish_reason',
          usage: '$.usage',
        },
        uiSchema: 'openai-chat',
      },
      'llm.chat.stream': {
        label: 'Chat Completions Stream',
        method: 'POST',
        path: '/v1/chat/completions',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: '{{messages}}',
          stream: true,
          temperature: '{{params.temperature}}',
          top_p: '{{params.top_p}}',
          max_tokens: '{{params.max_tokens}}',
        },
        stream: {
          protocol: 'sse',
          eventPrefix: 'data:',
          done: '[DONE]',
          deltaText: '$.choices[0].delta.content',
          deltaToolCalls: '$.choices[0].delta.tool_calls',
        },
        uiSchema: 'openai-chat-stream',
      },
      'llm.chat.vision': {
        label: 'Chat Vision',
        method: 'POST',
        path: '/v1/chat/completions',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '{{prompt}}' },
                { type: 'image_url', image_url: { url: '{{inputs.imageUrl}}' } },
              ],
            },
          ],
          temperature: '{{params.temperature}}',
          max_tokens: '{{params.max_tokens}}',
        },
        response: {
          text: '$.choices[0].message.content',
          usage: '$.usage',
        },
        uiSchema: 'openai-vision',
      },
      'llm.tools': {
        label: 'Chat Tool Calling',
        method: 'POST',
        path: '/v1/chat/completions',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: '{{messages}}',
          tools: '{{tools}}',
          tool_choice: '{{params.tool_choice}}',
          stream: '{{params.stream}}',
        },
        response: {
          text: '$.choices[0].message.content',
          toolCalls: '$.choices[0].message.tool_calls',
          usage: '$.usage',
        },
        uiSchema: 'openai-tools',
      },
      'llm.structured_output': {
        label: 'Structured Output',
        method: 'POST',
        path: '/v1/chat/completions',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: '{{messages}}',
          response_format: {
            type: 'json_schema',
            json_schema: '{{params.json_schema}}',
          },
        },
        response: {
          jsonText: '$.choices[0].message.content',
          usage: '$.usage',
        },
        uiSchema: 'openai-structured-output',
      },
      'llm.responses': {
        label: 'Responses',
        method: 'POST',
        path: '/v1/responses',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          input: '{{input}}',
          instructions: '{{params.instructions}}',
          temperature: '{{params.temperature}}',
          top_p: '{{params.top_p}}',
          max_output_tokens: '{{params.max_output_tokens}}',
          text: '{{params.text}}',
          tools: '{{tools}}',
        },
        response: {
          text: '$.output_text',
          output: '$.output',
          usage: '$.usage',
        },
        uiSchema: 'openai-responses',
      },
      'llm.responses.stream': {
        label: 'Responses Stream',
        method: 'POST',
        path: '/v1/responses',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          input: '{{input}}',
          stream: true,
          instructions: '{{params.instructions}}',
          max_output_tokens: '{{params.max_output_tokens}}',
          tools: '{{tools}}',
        },
        stream: {
          protocol: 'sse',
          deltaTextEvents: ['response.output_text.delta'],
          doneEvents: ['response.completed'],
          errorEvents: ['response.failed', 'error'],
        },
        uiSchema: 'openai-responses-stream',
      },
      'image.generate': {
        label: 'Images Generations',
        method: 'POST',
        path: '/v1/images/generations',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          size: '{{params.size}}',
          quality: '{{params.quality}}',
          n: '{{params.n}}',
          response_format: '{{params.response_format}}',
        },
        response: {
          images: '$.data[*].url || $.data[*].b64_json',
          usage: '$.usage',
        },
        uiSchema: 'openai-image-generate',
      },
      'image.edit': {
        label: 'Images Edits',
        method: 'POST',
        path: '/v1/images/edits',
        requestMode: 'multipart',
        bodyTemplate: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          image: '{{inputs.images}}',
          size: '{{params.size}}',
          quality: '{{params.quality}}',
          n: '{{params.n}}',
        },
        response: {
          images: '$.data[*].url || $.data[*].b64_json',
          usage: '$.usage',
        },
        uiSchema: 'openai-image-edit',
      },
      'video.generate': {
        label: 'Video Generations',
        method: 'POST',
        path: '/v1/videos/generations',
        fallbackPaths: ['/v2/videos/generations'],
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          duration: '{{params.duration}}',
          aspect_ratio: '{{params.aspect_ratio}}',
          resolution: '{{params.resolution}}',
          size: '{{params.size}}',
        },
        response: {
          taskId: '$.id || $.task_id || $.data.id || $.data.task_id',
          videos: '$..video_url || $..url',
        },
        uiSchema: 'openai-video-generate',
      },
      'video.image_to_video': {
        label: 'Image To Video',
        method: 'POST',
        path: '/v1/videos/generations',
        fallbackPaths: ['/v2/videos/generations'],
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          images: '{{inputs.images}}',
          duration: '{{params.duration}}',
          aspect_ratio: '{{params.aspect_ratio}}',
          resolution: '{{params.resolution}}',
        },
        response: {
          taskId: '$.id || $.task_id || $.data.id || $.data.task_id',
          videos: '$..video_url || $..url',
        },
        uiSchema: 'openai-video-generate',
      },
      'audio.tts': {
        label: 'Audio Speech',
        method: 'POST',
        path: '/v1/audio/speech',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          input: '{{input}}',
          voice: '{{params.voice}}',
          response_format: '{{params.response_format}}',
          speed: '{{params.speed}}',
        },
        response: {
          audio: 'binary',
          contentType: 'audio/*',
        },
        uiSchema: 'openai-audio-speech',
      },
      'audio.transcribe': {
        label: 'Audio Transcriptions',
        method: 'POST',
        path: '/v1/audio/transcriptions',
        requestMode: 'multipart',
        bodyTemplate: {
          model: '{{model}}',
          file: '{{inputs.audio}}',
          language: '{{params.language}}',
          prompt: '{{params.prompt}}',
          response_format: '{{params.response_format}}',
          temperature: '{{params.temperature}}',
        },
        response: {
          text: '$.text',
          segments: '$.segments',
        },
        uiSchema: 'openai-audio-transcribe',
      },
      'audio.translate': {
        label: 'Audio Translations',
        method: 'POST',
        path: '/v1/audio/translations',
        requestMode: 'multipart',
        bodyTemplate: {
          model: '{{model}}',
          file: '{{inputs.audio}}',
          prompt: '{{params.prompt}}',
          response_format: '{{params.response_format}}',
          temperature: '{{params.temperature}}',
        },
        response: {
          text: '$.text',
        },
        uiSchema: 'openai-audio-transcribe',
      },
      'embeddings.create': {
        label: 'Embeddings',
        method: 'POST',
        path: '/v1/embeddings',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          input: '{{input}}',
          encoding_format: '{{params.encoding_format}}',
          dimensions: '{{params.dimensions}}',
        },
        response: {
          embeddings: '$.data[*].embedding',
          usage: '$.usage',
        },
        uiSchema: 'openai-embeddings',
      },
      'moderation.create': {
        label: 'Moderations',
        method: 'POST',
        path: '/v1/moderations',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          input: '{{input}}',
        },
        response: {
          results: '$.results',
        },
      },
      'files.upload': {
        label: 'Files Upload',
        method: 'POST',
        path: '/v1/files',
        requestMode: 'multipart',
        bodyTemplate: {
          file: '{{inputs.file}}',
          purpose: '{{params.purpose}}',
        },
        response: {
          id: '$.id',
          filename: '$.filename',
          purpose: '$.purpose',
        },
        uiSchema: 'openai-files',
      },
      'files.list': {
        label: 'Files List',
        method: 'GET',
        path: '/v1/files',
        requestMode: 'query',
        response: {
          files: '$.data',
        },
      },
      'files.retrieve': {
        label: 'Files Retrieve',
        method: 'GET',
        path: '/v1/files/{file_id}',
        requestMode: 'path',
        response: {
          file: '$',
        },
      },
      'files.delete': {
        label: 'Files Delete',
        method: 'DELETE',
        path: '/v1/files/{file_id}',
        requestMode: 'path',
        response: {
          deleted: '$.deleted',
        },
      },
      'batches.create': {
        label: 'Batches Create',
        method: 'POST',
        path: '/v1/batches',
        requestMode: 'json',
        bodyTemplate: {
          input_file_id: '{{params.input_file_id}}',
          endpoint: '{{params.endpoint}}',
          completion_window: '{{params.completion_window}}',
          metadata: '{{params.metadata}}',
        },
        response: {
          batch: '$',
        },
        uiSchema: 'openai-batches',
      },
      'batches.retrieve': {
        label: 'Batches Retrieve',
        method: 'GET',
        path: '/v1/batches/{batch_id}',
        requestMode: 'path',
        response: {
          batch: '$',
        },
      },
      'batches.cancel': {
        label: 'Batches Cancel',
        method: 'POST',
        path: '/v1/batches/{batch_id}/cancel',
        requestMode: 'path',
        response: {
          batch: '$',
        },
      },
    },
    modelProfiles: {
      'gpt-4o': {
        label: 'GPT-4o',
        capabilities: ['llm.chat', 'llm.chat.stream', 'llm.chat.vision', 'llm.tools', 'llm.structured_output'],
        uiSchemas: ['openai-chat', 'openai-vision', 'openai-tools'],
      },
      'gpt-4o-mini': {
        label: 'GPT-4o mini',
        capabilities: ['llm.chat', 'llm.chat.stream', 'llm.chat.vision', 'llm.tools', 'llm.structured_output'],
        uiSchemas: ['openai-chat', 'openai-vision', 'openai-tools'],
      },
      'gpt-5': {
        label: 'GPT-5 / Responses 优先',
        capabilities: ['llm.responses', 'llm.responses.stream', 'llm.tools', 'llm.structured_output'],
        uiSchemas: ['openai-responses', 'openai-tools'],
        operationPreference: ['llm.responses', 'llm.responses.stream'],
      },
      'o-series': {
        label: '推理模型',
        match: ['o1', 'o3', 'o4'],
        capabilities: ['llm.responses', 'llm.responses.stream', 'llm.tools'],
        uiSchemas: ['openai-responses', 'openai-reasoning'],
      },
      'gpt-image': {
        label: 'GPT Image',
        match: ['gpt-image'],
        capabilities: ['image.generate', 'image.edit'],
        uiSchemas: ['openai-image-generate', 'openai-image-edit'],
        operationPreference: ['image.generate', 'image.edit'],
      },
      'dall-e-3': {
        label: 'DALL·E 3',
        capabilities: ['image.generate'],
        uiSchemas: ['openai-image-generate'],
        operationPreference: ['image.generate'],
      },
      'dall-e-2': {
        label: 'DALL·E 2',
        capabilities: ['image.generate', 'image.edit'],
        uiSchemas: ['openai-image-generate', 'openai-image-edit'],
        operationPreference: ['image.generate', 'image.edit'],
      },
      sora: {
        label: 'Sora / OpenAI 视频',
        match: ['sora'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video'],
        uiSchemas: ['openai-video-generate'],
        operationPreference: ['video.generate', 'video.image_to_video'],
      },
      embedding: {
        label: 'Embedding 模型',
        match: ['text-embedding', 'embedding'],
        capabilities: ['embeddings.create', 'rag.embeddings'],
        uiSchemas: ['openai-embeddings'],
        operationPreference: ['embeddings.create'],
      },
      tts: {
        label: 'TTS 语音合成',
        match: ['tts', 'gpt-4o-mini-tts'],
        capabilities: ['audio.tts'],
        uiSchemas: ['openai-audio-speech'],
        operationPreference: ['audio.tts'],
      },
      whisper: {
        label: 'Whisper / 语音识别',
        match: ['whisper', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'],
        capabilities: ['audio.transcribe', 'audio.translate'],
        uiSchemas: ['openai-audio-transcribe'],
        operationPreference: ['audio.transcribe'],
      },
      moderation: {
        label: 'Moderation',
        match: ['omni-moderation', 'text-moderation', 'moderation'],
        capabilities: ['moderation.create'],
        operationPreference: ['moderation.create'],
      },
    },
    uiSchemas: {
      'openai-chat': [
        { key: 'temperature', label: '温度', type: 'slider', default: 0.7, min: 0, max: 2, step: 0.1, bind: 'body.temperature' },
        { key: 'top_p', label: 'Top P', type: 'slider', default: 1, min: 0, max: 1, step: 0.05, bind: 'body.top_p' },
        { key: 'max_tokens', label: '最大输出', type: 'number', default: 1024, min: 1, max: 128000, bind: 'body.max_tokens' },
        { key: 'response_format', label: '输出格式', type: 'select', default: 'text', options: [{ label: '文本', value: 'text' }, { label: 'JSON Object', value: 'json_object' }], bind: 'body.response_format.type' },
      ],
      'openai-chat-stream': [
        { key: 'stream', label: '流式返回', type: 'toggle', default: true, readonly: true, bind: 'body.stream' },
        { key: 'temperature', label: '温度', type: 'slider', default: 0.7, min: 0, max: 2, step: 0.1, bind: 'body.temperature' },
        { key: 'max_tokens', label: '最大输出', type: 'number', default: 1024, min: 1, max: 128000, bind: 'body.max_tokens' },
      ],
      'openai-vision': [
        { key: 'image_detail', label: '图片细节', type: 'select', default: 'auto', options: [{ label: '自动', value: 'auto' }, { label: '低', value: 'low' }, { label: '高', value: 'high' }], bind: 'body.messages[].content[].image_url.detail' },
        { key: 'max_tokens', label: '最大输出', type: 'number', default: 1024, min: 1, max: 128000, bind: 'body.max_tokens' },
      ],
      'openai-tools': [
        { key: 'tool_choice', label: '工具选择', type: 'select', default: 'auto', options: [{ label: '自动', value: 'auto' }, { label: '必须调用', value: 'required' }, { label: '不调用', value: 'none' }], bind: 'body.tool_choice' },
        { key: 'parallel_tool_calls', label: '并行工具', type: 'toggle', default: true, bind: 'body.parallel_tool_calls' },
      ],
      'openai-structured-output': [
        { key: 'schema_name', label: 'Schema 名称', type: 'text', default: 'response_schema', bind: 'body.response_format.json_schema.name' },
        { key: 'strict', label: '严格模式', type: 'toggle', default: true, bind: 'body.response_format.json_schema.strict' },
        { key: 'json_schema', label: 'JSON Schema', type: 'json', default: {}, bind: 'body.response_format.json_schema.schema' },
      ],
      'openai-responses': [
        { key: 'instructions', label: '系统指令', type: 'textarea', default: '', bind: 'body.instructions' },
        { key: 'temperature', label: '温度', type: 'slider', default: 0.7, min: 0, max: 2, step: 0.1, bind: 'body.temperature' },
        { key: 'top_p', label: 'Top P', type: 'slider', default: 1, min: 0, max: 1, step: 0.05, bind: 'body.top_p' },
        { key: 'max_output_tokens', label: '最大输出', type: 'number', default: 2048, min: 1, max: 128000, bind: 'body.max_output_tokens' },
        { key: 'text_format', label: '文本格式', type: 'select', default: 'text', options: [{ label: '文本', value: 'text' }, { label: 'JSON Schema', value: 'json_schema' }], bind: 'body.text.format.type' },
      ],
      'openai-responses-stream': [
        { key: 'stream', label: '流式返回', type: 'toggle', default: true, readonly: true, bind: 'body.stream' },
        { key: 'max_output_tokens', label: '最大输出', type: 'number', default: 2048, min: 1, max: 128000, bind: 'body.max_output_tokens' },
      ],
      'openai-reasoning': [
        { key: 'reasoning_effort', label: '推理强度', type: 'select', default: 'medium', options: [{ label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }], bind: 'body.reasoning.effort' },
      ],
      'openai-image-generate': [
        { key: 'size', label: '尺寸', type: 'select', default: '1024x1024', options: ['auto', '1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792'].map((value) => ({ label: value === 'auto' ? '自动' : value, value })), bind: 'body.size' },
        { key: 'quality', label: '质量', type: 'select', default: 'auto', options: [{ label: '自动', value: 'auto' }, { label: '标准', value: 'standard' }, { label: '高清', value: 'hd' }, { label: '高质量', value: 'high' }], bind: 'body.quality' },
        { key: 'n', label: '数量', type: 'number', default: 1, min: 1, max: 4, bind: 'body.n' },
        { key: 'response_format', label: '返回格式', type: 'select', default: 'url', options: [{ label: 'URL', value: 'url' }, { label: 'Base64', value: 'b64_json' }], bind: 'body.response_format' },
      ],
      'openai-image-edit': [
        { key: 'size', label: '尺寸', type: 'select', default: '1024x1024', options: ['auto', '1024x1024', '1024x1536', '1536x1024'].map((value) => ({ label: value === 'auto' ? '自动' : value, value })), bind: 'form.size' },
        { key: 'quality', label: '质量', type: 'select', default: 'auto', options: [{ label: '自动', value: 'auto' }, { label: '标准', value: 'standard' }, { label: '高质量', value: 'high' }], bind: 'form.quality' },
        { key: 'n', label: '数量', type: 'number', default: 1, min: 1, max: 4, bind: 'form.n' },
      ],
      'openai-video-generate': [
        { key: 'duration', label: '时长', type: 'select', default: 5, options: [4, 5, 8, 10, 15].map((value) => ({ label: `${value}s`, value })), bind: 'body.duration' },
        { key: 'aspect_ratio', label: '比例', type: 'select', default: '16:9', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].map((value) => ({ label: value, value })), bind: 'body.aspect_ratio' },
        { key: 'resolution', label: '清晰度', type: 'select', default: '720p', options: ['480p', '720p', '1080p', '4k'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.resolution' },
        { key: 'enhance_prompt', label: '增强提示词', type: 'toggle', default: false, bind: 'body.enhance_prompt' },
      ],
      'openai-audio-speech': [
        { key: 'voice', label: '声音', type: 'select', default: 'alloy', options: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].map((value) => ({ label: value, value })), bind: 'body.voice' },
        { key: 'response_format', label: '格式', type: 'select', default: 'mp3', options: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.response_format' },
        { key: 'speed', label: '语速', type: 'slider', default: 1, min: 0.25, max: 4, step: 0.05, bind: 'body.speed' },
      ],
      'openai-audio-transcribe': [
        { key: 'language', label: '语言', type: 'text', default: '', bind: 'form.language' },
        { key: 'prompt', label: '提示词', type: 'textarea', default: '', bind: 'form.prompt' },
        { key: 'response_format', label: '返回格式', type: 'select', default: 'json', options: ['json', 'text', 'srt', 'verbose_json', 'vtt'].map((value) => ({ label: value, value })), bind: 'form.response_format' },
        { key: 'temperature', label: '温度', type: 'slider', default: 0, min: 0, max: 1, step: 0.1, bind: 'form.temperature' },
      ],
      'openai-embeddings': [
        { key: 'encoding_format', label: '编码', type: 'select', default: 'float', options: [{ label: 'Float', value: 'float' }, { label: 'Base64', value: 'base64' }], bind: 'body.encoding_format' },
        { key: 'dimensions', label: '维度', type: 'number', default: 0, min: 0, max: 4096, bind: 'body.dimensions' },
      ],
      'openai-files': [
        { key: 'purpose', label: '用途', type: 'select', default: 'batch', options: ['batch', 'fine-tune', 'assistants', 'vision'].map((value) => ({ label: value, value })), bind: 'form.purpose' },
      ],
      'openai-batches': [
        { key: 'endpoint', label: '端点', type: 'select', default: '/v1/chat/completions', options: ['/v1/chat/completions', '/v1/responses', '/v1/embeddings'].map((value) => ({ label: value, value })), bind: 'body.endpoint' },
        { key: 'completion_window', label: '完成窗口', type: 'select', default: '24h', options: [{ label: '24h', value: '24h' }], bind: 'body.completion_window' },
        { key: 'input_file_id', label: '输入文件', type: 'text', default: '', bind: 'body.input_file_id' },
        { key: 'metadata', label: '元数据', type: 'json', default: {}, bind: 'body.metadata' },
      ],
    },
    paramSchema: {
      llm: [
        { key: 'temperature', label: '温度', type: 'slider', default: 0.7, min: 0, max: 2, step: 0.1 },
        { key: 'max_tokens', label: '最大输出', type: 'number', default: 1024, min: 1, max: 128000 },
      ],
      image: [
        {
          key: 'quality',
          label: '质量',
          type: 'select',
          default: 'auto',
          options: [
            { label: '自动', value: 'auto' },
            { label: '标准', value: 'standard' },
            { label: '高质量', value: 'high' },
          ],
          showWhen: { models: ['gpt-image-1'] },
        },
      ],
    },
    docs: [
      { title: 'Chat Completions', url: 'https://gpt-best.apifox.cn/api-139393491' },
      { title: 'Chat Completions Stream', url: 'https://gpt-best.apifox.cn/api-287782769' },
      { title: 'Responses', url: 'https://gpt-best.apifox.cn/api-321434971' },
      { title: 'Responses Stream', url: 'https://gpt-best.apifox.cn/api-321434972' },
      { title: 'Images Generations', url: 'https://gpt-best.apifox.cn/api-302915860' },
      { title: 'Images Edits', url: 'https://gpt-best.apifox.cn/api-302915861' },
      { title: 'Video Generations', url: 'https://gpt-best.apifox.cn/doc-7324259' },
      { title: 'Audio Speech', url: 'https://gpt-best.apifox.cn/doc-6113929' },
      { title: 'Audio Transcriptions', url: 'https://gpt-best.apifox.cn/doc-6113929' },
      { title: 'Embeddings', url: 'https://gpt-best.apifox.cn/doc-6113929' },
      { title: 'Files', url: 'https://gpt-best.apifox.cn/doc-6113929' },
      { title: 'Batches', url: 'https://gpt-best.apifox.cn/doc-6113929' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    summary: 'Anthropic /v1/messages 协议。',
    auth: { type: 'api_key_header', header: 'x-api-key' },
    headers: { 'anthropic-version': '2023-06-01' },
    models: { endpoint: '/v1/models', kind: 'anthropic' },
    capabilities: {
      llm: { endpoint: '/v1/messages', body: 'anthropic_messages', parse: 'anthropic_text' },
      vlm: { endpoint: '/v1/messages', body: 'anthropic_messages', parse: 'anthropic_text' },
    },
    paramSchema: {
      llm: [
        { key: 'max_tokens', label: '最大输出', type: 'number', default: 1024, min: 1, max: 200000 },
      ],
    },
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    summary: 'Google Gemini generateContent 协议，覆盖文本、视觉理解和 Gemini 图像生成。',
    auth: { type: 'google_api_key', header: 'x-goog-api-key' },
    models: { endpoint: '/v1beta/models', kind: 'gemini' },
    capabilities: {
      llm: { endpoint: '/v1beta/models/{model}:generateContent', body: 'gemini_content', parse: 'gemini_text' },
      vlm: { endpoint: '/v1beta/models/{model}:generateContent', body: 'gemini_content', parse: 'gemini_text' },
    },
    operations: {
      'llm.chat': {
        label: 'Generate Content',
        method: 'POST',
        path: '/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        bodyTemplate: {
          contents: '{{messages}}',
          generationConfig: '{{params.generationConfig}}',
        },
        response: { text: '$.candidates[0].content.parts[0].text', usage: '$.usageMetadata' },
      },
      'llm.chat.vision': {
        label: 'Generate Content Vision',
        method: 'POST',
        path: '/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        bodyTemplate: {
          contents: '{{messagesWithImages}}',
          generationConfig: '{{params.generationConfig}}',
        },
        response: { text: '$.candidates[0].content.parts[0].text', usage: '$.usageMetadata' },
      },
      'image.generate': {
        label: 'Gemini Image Generation',
        method: 'POST',
        path: '/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        bodyTemplate: {
          contents: [{ role: 'user', parts: [{ text: '{{prompt}}' }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: '{{params.aspectRatio}}',
              imageSize: '{{params.imageSize}}',
            },
          },
        },
        response: { images: '$.candidates[*].content.parts[*].inlineData.data' },
        uiSchema: 'gemini-image-generate',
      },
      'image.edit': {
        label: 'Gemini Image Edit',
        method: 'POST',
        path: '/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        uiSchema: 'gemini-image-generate',
      },
    },
    modelProfiles: {
      'gemini-image': {
        label: 'Gemini Image',
        match: ['gemini-2.0-flash-preview-image', 'gemini-2.5-flash-image', 'imagen'],
        capabilities: ['image.generate', 'image.edit'],
        uiSchemas: ['gemini-image-generate'],
        operationPreference: ['image.generate', 'image.edit'],
      },
    },
    uiSchemas: {
      'gemini-image-generate': [
        { key: 'aspectRatio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21'].map((value) => ({ label: value, value })), bind: 'body.generationConfig.imageConfig.aspectRatio' },
        { key: 'imageSize', label: '清晰度', type: 'select', default: '1K', options: ['1K', '2K', '4K'].map((value) => ({ label: value, value })), bind: 'body.generationConfig.imageConfig.imageSize' },
      ],
    },
    paramSchema: {
      llm: [
        { key: 'temperature', label: '温度', type: 'slider', default: 0.7, min: 0, max: 2, step: 0.1 },
      ],
      image: [
        { key: 'aspectRatio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21'].map((value) => ({ label: value, value })) },
        { key: 'imageSize', label: '清晰度', type: 'select', default: '1K', options: ['1K', '2K', '4K'].map((value) => ({ label: value, value })) },
      ],
    },
  },
  'gemini-generations': {
    id: 'gemini-generations',
    label: 'Gemini Generations',
    kind: 'model-protocol-package',
    scope: 'model',
    runtimeProtocol: 'openai',
    summary: '中转站 Gemini 图片协议：文生图和参考图编辑统一使用 JSON 格式的 /v1/images/generations；不同于 Gemini 官方 generateContent。',
    categories: ['image'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      image: { endpoint: '/v1/images/generations', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'image.generate': {
        label: 'Gemini Generations 文生图', method: 'POST', path: '/v1/images/generations', requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', n: '{{params.n}}', size: '{{params.size}}', aspect_ratio: '{{params.aspect_ratio}}' },
        response: { images: '$.data[*].url || $.data[*].b64_json' }, uiSchema: 'gemini-generations-image',
      },
      'image.edit': {
        label: 'Gemini Generations 参考图编辑', method: 'POST', path: '/v1/images/generations', requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', image: '{{inputs.imageUrls}}', n: '{{params.n}}', size: '{{params.size}}', aspect_ratio: '{{params.aspect_ratio}}' },
        response: { images: '$.data[*].url || $.data[*].b64_json' }, uiSchema: 'gemini-generations-image',
      },
    },
    modelProfiles: {
      gemini: {
        label: 'Gemini Generations Image', match: ['gemini', 'nano-banana'],
        capabilities: ['image.generate', 'image.edit'],
        uiSchemas: ['gemini-generations-image'],
        operationPreference: ['image.generate', 'image.edit'],
      },
    },
    uiSchemas: {
      'gemini-generations-image': [
        { key: 'aspect_ratio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '4:3', '3:4', '16:9', '9:16'].map((value) => ({ label: value, value })), bind: 'body.aspect_ratio' },
        { key: 'size', label: '尺寸', type: 'select', default: '1024x1024', options: ['1024x1024', '1024x1536', '1536x1024'].map((value) => ({ label: value, value })), bind: 'body.size' },
        { key: 'n', label: '数量', type: 'number', default: 1, min: 1, max: 4, bind: 'body.n' },
      ],
    },
    paramSchema: {
      image: [
        { key: 'aspect_ratio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '4:3', '3:4', '16:9', '9:16'].map((value) => ({ label: value, value })) },
        { key: 'size', label: '尺寸', type: 'select', default: '1024x1024', options: ['1024x1024', '1024x1536', '1536x1024'].map((value) => ({ label: value, value })) },
        { key: 'n', label: '数量', type: 'number', default: 1, min: 1, max: 4 },
      ],
    },
    docs: [{ title: 'GPT-Best Generations 通用', url: 'https://gpt-best.apifox.cn/api-302915860' }],
  },
  apimart: {
    id: 'apimart',
    label: '异步模型协议',
    summary: '统一收纳 APIMart、APIB 等异步聚合平台的 OpenAI 对话、Gemini、Claude、图片、视频与音乐模型格式。',
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    unwrapData: true,
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      llm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      vlm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'llm.chat': {
        label: 'APIMart OpenAI Chat',
        method: 'POST',
        path: '/v1/chat/completions',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: '{{messages}}',
          temperature: '{{params.temperature}}',
          top_p: '{{params.top_p}}',
          max_tokens: '{{params.max_tokens}}',
        },
        response: { text: '$.choices[0].message.content', usage: '$.usage' },
        uiSchema: 'openai-chat',
      },
      'llm.chat.vision': {
        label: 'APIMart OpenAI Vision',
        method: 'POST',
        path: '/v1/chat/completions',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: '{{messages}}',
          temperature: '{{params.temperature}}',
          max_tokens: '{{params.max_tokens}}',
        },
        response: { text: '$.choices[0].message.content', usage: '$.usage' },
        uiSchema: 'openai-vision',
      },
      'image.generate': {
        label: 'APIMart Gemini Image',
        method: 'POST',
        path: '/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        bodyTemplate: {
          contents: [{ role: 'user', parts: [{ text: '{{prompt}}' }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: '{{params.aspectRatio}}',
              imageSize: '{{params.imageSize}}',
            },
          },
        },
        response: { images: '$.candidates[*].content.parts[*].inlineData.data' },
        uiSchema: 'apimart-image-generate',
      },
      'image.edit': {
        label: 'APIMart Gemini Image Edit',
        method: 'POST',
        path: 'https://api.apimart.ai/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        uiSchema: 'apimart-image-generate',
      },
      'video.generate': {
        label: 'APIMart Video Generations',
        method: 'POST',
        path: '/v1/videos/generations',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          duration: '{{params.duration}}',
          size: '{{params.size}}',
          resolution: '{{params.resolution}}',
          generate_audio: '{{params.generate_audio}}',
        },
        response: {
          taskId: '$.id || $.task_id || $.data.id || $.data.task_id',
          videos: '$..video_url || $..url',
        },
        uiSchema: 'apimart-video-generate',
      },
      'video.image_to_video': {
        label: 'APIMart Image To Video',
        method: 'POST',
        path: '/v1/videos/generations',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          image_urls: '{{inputs.imageUrls}}',
          duration: '{{params.duration}}',
          size: '{{params.size}}',
          resolution: '{{params.resolution}}',
          generate_audio: '{{params.generate_audio}}',
        },
        response: {
          taskId: '$.id || $.task_id || $.data.id || $.data.task_id',
          videos: '$..video_url || $..url',
        },
        uiSchema: 'apimart-video-generate',
      },
      'audio.tts': {
        label: 'APIMart Audio Speech',
        method: 'POST',
        path: '/v1/audio/speech',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          input: '{{input}}',
          voice: '{{params.voice}}',
          response_format: '{{params.response_format}}',
          speed: '{{params.speed}}',
        },
        response: { audio: 'binary', contentType: 'audio/*' },
        uiSchema: 'openai-audio-speech',
      },
      'audio.transcribe': {
        label: 'APIMart Audio Transcriptions',
        method: 'POST',
        path: '/v1/audio/transcriptions',
        requestMode: 'multipart',
        bodyTemplate: {
          model: '{{model}}',
          file: '{{inputs.audio}}',
          language: '{{params.language}}',
          prompt: '{{params.prompt}}',
          response_format: '{{params.response_format}}',
          temperature: '{{params.temperature}}',
        },
        response: { text: '$.text', segments: '$.segments' },
        uiSchema: 'openai-audio-transcribe',
      },
      'audio.translate': {
        label: 'APIMart Audio Translations',
        method: 'POST',
        path: '/v1/audio/translations',
        requestMode: 'multipart',
        bodyTemplate: {
          model: '{{model}}',
          file: '{{inputs.audio}}',
          prompt: '{{params.prompt}}',
          response_format: '{{params.response_format}}',
          temperature: '{{params.temperature}}',
        },
        response: { text: '$.text' },
        uiSchema: 'openai-audio-transcribe',
      },
      'embeddings.create': {
        label: 'APIMart Embeddings',
        method: 'POST',
        path: '/v1/embeddings',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          input: '{{input}}',
          encoding_format: '{{params.encoding_format}}',
          dimensions: '{{params.dimensions}}',
        },
        response: { embeddings: '$.data[*].embedding', usage: '$.usage' },
        uiSchema: 'openai-embeddings',
      },
      'moderation.create': {
        label: 'APIMart Moderations',
        method: 'POST',
        path: '/v1/moderations',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          input: '{{input}}',
        },
        response: { results: '$.results' },
      },
      'files.upload': {
        label: 'APIMart Files Upload',
        method: 'POST',
        path: '/v1/files',
        requestMode: 'multipart',
        bodyTemplate: {
          file: '{{inputs.file}}',
          purpose: '{{params.purpose}}',
        },
        response: { id: '$.id', filename: '$.filename', purpose: '$.purpose' },
        uiSchema: 'openai-files',
      },
      'batches.create': {
        label: 'APIMart Batches Create',
        method: 'POST',
        path: '/v1/batches',
        requestMode: 'json',
        bodyTemplate: {
          input_file_id: '{{params.input_file_id}}',
          endpoint: '{{params.endpoint}}',
          completion_window: '{{params.completion_window}}',
          metadata: '{{params.metadata}}',
        },
        response: { batch: '$' },
        uiSchema: 'openai-batches',
      },
    },
    modelProfiles: {
      'gpt-4o': {
        label: 'GPT-4o via APIMart',
        capabilities: ['llm.chat', 'llm.chat.vision', 'llm.tools', 'llm.structured_output'],
        uiSchemas: ['openai-chat', 'openai-vision', 'openai-tools'],
      },
      'gpt-5': {
        label: 'GPT-5 via APIMart',
        capabilities: ['llm.chat', 'llm.tools', 'llm.structured_output'],
        uiSchemas: ['openai-chat', 'openai-tools'],
      },
      'gemini-image': {
        label: 'Gemini Image via APIMart',
        match: ['gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image', 'imagen'],
        capabilities: ['image.generate'],
        uiSchemas: ['apimart-image-generate'],
        operationPreference: ['image.generate'],
      },
      'veo3.1-lite': {
        label: 'VEO 3.1 Lite via APIMart',
        capabilities: ['video.generate', 'video.text_to_video'],
        uiSchemas: ['apimart-video-generate'],
        operationPreference: ['video.generate'],
        limits: { ...APIMART_VEO_LIMITS, references: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } } },
      },
      veo: {
        label: 'VEO Video via APIMart',
        match: ['veo'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame'],
        uiSchemas: ['apimart-video-generate'],
        operationPreference: ['video.generate', 'video.image_to_video'],
        limits: APIMART_VEO_LIMITS,
      },
      seedance: {
        label: 'Seedance Video via APIMart',
        match: ['doubao-seedance', 'seedance'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'],
        uiSchemas: ['apimart-video-generate'],
        operationPreference: ['video.generate', 'video.image_to_video'],
        limits: APIMART_SEEDANCE_LIMITS,
      },
      embedding: {
        label: 'Embedding via APIMart',
        match: ['text-embedding', 'embedding'],
        capabilities: ['embeddings.create'],
        uiSchemas: ['openai-embeddings'],
        operationPreference: ['embeddings.create'],
      },
      tts: {
        label: 'TTS via APIMart',
        match: ['tts', 'speech'],
        capabilities: ['audio.tts'],
        uiSchemas: ['openai-audio-speech'],
        operationPreference: ['audio.tts'],
      },
      whisper: {
        label: 'Whisper via APIMart',
        match: ['whisper', 'transcribe'],
        capabilities: ['audio.transcribe', 'audio.translate'],
        uiSchemas: ['openai-audio-transcribe'],
        operationPreference: ['audio.transcribe'],
      },
      moderation: {
        label: 'Moderation via APIMart',
        match: ['moderation'],
        capabilities: ['moderation.create'],
        operationPreference: ['moderation.create'],
      },
    },
    uiSchemas: {
      'apimart-image-generate': [
        { key: 'aspectRatio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21'].map((value) => ({ label: value, value })), bind: 'body.generationConfig.imageConfig.aspectRatio' },
        { key: 'imageSize', label: '清晰度', type: 'select', default: '1K', options: ['1K', '2K', '4K'].map((value) => ({ label: value, value })), bind: 'body.generationConfig.imageConfig.imageSize' },
      ],
      'apimart-video-generate': [
        { key: 'duration', label: '时长', type: 'select', default: 5, options: [4, 5, 8, 10, 15].map((value) => ({ label: `${value}s`, value })), bind: 'body.duration' },
        { key: 'size', label: '比例', type: 'select', default: '16:9', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].map((value) => ({ label: value, value })), bind: 'body.size' },
        { key: 'resolution', label: '清晰度', type: 'select', default: '480p', options: ['480p', '720p', '1080p', '4k'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.resolution' },
        { key: 'generate_audio', label: '生成音频', type: 'toggle', default: false, bind: 'body.generate_audio' },
      ],
      'openai-audio-speech': [
        { key: 'voice', label: '声音', type: 'select', default: 'alloy', options: ['alloy', 'echo', 'nova', 'shimmer'].map((value) => ({ label: value, value })), bind: 'body.voice' },
        { key: 'response_format', label: '格式', type: 'select', default: 'mp3', options: ['mp3', 'wav', 'flac', 'opus'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.response_format' },
        { key: 'speed', label: '速度', type: 'slider', default: 1, min: 0.25, max: 4, step: 0.05, bind: 'body.speed' },
      ],
      'openai-audio-transcribe': [
        { key: 'language', label: '语言', type: 'text', default: '', bind: 'body.language' },
        { key: 'response_format', label: '格式', type: 'select', default: 'json', options: ['json', 'text', 'srt', 'verbose_json', 'vtt'].map((value) => ({ label: value, value })), bind: 'body.response_format' },
        { key: 'temperature', label: '温度', type: 'slider', default: 0, min: 0, max: 1, step: 0.1, bind: 'body.temperature' },
      ],
      'openai-embeddings': [
        { key: 'encoding_format', label: '编码', type: 'select', default: 'float', options: [{ label: 'Float', value: 'float' }, { label: 'Base64', value: 'base64' }], bind: 'body.encoding_format' },
        { key: 'dimensions', label: '维度', type: 'number', default: 0, min: 0, max: 4096, bind: 'body.dimensions' },
      ],
      'openai-files': [
        { key: 'purpose', label: '用途', type: 'select', default: 'batch', options: ['batch', 'fine-tune', 'assistants', 'vision'].map((value) => ({ label: value, value })), bind: 'body.purpose' },
      ],
      'openai-batches': [
        { key: 'endpoint', label: '端点', type: 'select', default: '/v1/chat/completions', options: ['/v1/chat/completions', '/v1/responses', '/v1/embeddings'].map((value) => ({ label: value, value })), bind: 'body.endpoint' },
        { key: 'completion_window', label: '完成窗口', type: 'select', default: '24h', options: [{ label: '24h', value: '24h' }], bind: 'body.completion_window' },
      ],
    },
    paramSchema: {
      image: [
        { key: 'aspectRatio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21'].map((value) => ({ label: value, value })) },
        { key: 'imageSize', label: '清晰度', type: 'select', default: '1K', options: ['1K', '2K', '4K'].map((value) => ({ label: value, value })) },
      ],
      video: [
        { key: 'duration', label: '时长', type: 'select', default: 5, options: [5, 8, 10].map((value) => ({ label: `${value}s`, value })) },
        { key: 'generate_audio', label: '生成音频', type: 'toggle', default: false },
      ],
      audio: [
        { key: 'voice', label: '声音', type: 'select', default: 'alloy', options: ['alloy', 'echo', 'nova', 'shimmer'].map((value) => ({ label: value, value })) },
        { key: 'response_format', label: '格式', type: 'select', default: 'mp3', options: ['mp3', 'wav', 'flac'].map((value) => ({ label: value.toUpperCase(), value })) },
      ],
      embedding: [
        { key: 'encoding_format', label: '编码', type: 'select', default: 'float', options: [{ label: 'Float', value: 'float' }, { label: 'Base64', value: 'base64' }] },
        { key: 'dimensions', label: '维度', type: 'number', default: 0, min: 0, max: 4096 },
      ],
      files: [
        { key: 'purpose', label: '用途', type: 'select', default: 'batch', options: ['batch', 'fine-tune', 'assistants', 'vision'].map((value) => ({ label: value, value })) },
      ],
      batches: [
        { key: 'endpoint', label: '端点', type: 'select', default: '/v1/chat/completions', options: ['/v1/chat/completions', '/v1/responses', '/v1/embeddings'].map((value) => ({ label: value, value })) },
        { key: 'completion_window', label: '完成窗口', type: 'select', default: '24h', options: [{ label: '24h', value: '24h' }] },
      ],
    },
  },
  'apimart-gemini': {
    id: 'apimart-gemini',
    label: 'Gemini 原生格式（异步平台）',
    summary: '异步聚合平台上的 Gemini generateContent 原生格式，适合需要 Gemini 请求体的文本、视觉和图像模型。',
    kind: 'model-protocol-package',
    scope: 'model',
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    unwrapData: true,
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      llm: { endpoint: 'https://api.apimart.ai/v1beta/models/{model}:generateContent', body: 'gemini_content', parse: 'gemini_text' },
      vlm: { endpoint: 'https://api.apimart.ai/v1beta/models/{model}:generateContent', body: 'gemini_content', parse: 'gemini_text' },
    },
    operations: {
      'llm.chat': {
        label: 'APIMart Gemini Generate Content',
        method: 'POST',
        path: 'https://api.apimart.ai/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        bodyTemplate: { contents: '{{messages}}', generationConfig: '{{params.generationConfig}}' },
        response: { text: '$.candidates[0].content.parts[0].text', usage: '$.usageMetadata' },
      },
      'llm.chat.vision': {
        label: 'APIMart Gemini Vision',
        method: 'POST',
        path: 'https://api.apimart.ai/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        bodyTemplate: { contents: '{{messagesWithImages}}', generationConfig: '{{params.generationConfig}}' },
        response: { text: '$.candidates[0].content.parts[0].text', usage: '$.usageMetadata' },
      },
      'image.generate': {
        label: 'APIMart Gemini Image',
        method: 'POST',
        path: 'https://api.apimart.ai/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        bodyTemplate: {
          contents: [{ role: 'user', parts: [{ text: '{{prompt}}' }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '{{params.aspectRatio}}', imageSize: '{{params.imageSize}}' },
          },
        },
        response: { images: '$.candidates[*].content.parts[*].inlineData.data' },
        uiSchema: 'apimart-image-generate',
      },
    },
    modelProfiles: {
      gemini: { label: 'Gemini via APIMart', match: ['gemini'], capabilities: ['llm.chat', 'llm.chat.vision'], uiSchemas: [] },
      imagen: { label: 'Gemini / Imagen Image via APIMart', match: ['imagen', 'gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image'], capabilities: ['image.generate', 'image.edit'], uiSchemas: ['apimart-image-generate'], operationPreference: ['image.generate', 'image.edit'] },
    },
    uiSchemas: {
      'apimart-image-generate': [
        { key: 'aspectRatio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21'].map((value) => ({ label: value, value })), bind: 'body.generationConfig.imageConfig.aspectRatio' },
        { key: 'imageSize', label: '清晰度', type: 'select', default: '1K', options: ['1K', '2K', '4K'].map((value) => ({ label: value, value })), bind: 'body.generationConfig.imageConfig.imageSize' },
      ],
    },
  },
  'apimart-claude': {
    id: 'apimart-claude',
    label: 'Claude Messages（异步平台）',
    summary: '异步聚合平台上的 Claude /v1/messages 格式，适合需要 Anthropic Messages 请求体的 Claude 模型。',
    kind: 'model-protocol-package',
    scope: 'model',
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    headers: { 'anthropic-version': '2023-06-01' },
    unwrapData: true,
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      llm: { endpoint: 'https://api.apimart.ai/v1/messages', body: 'anthropic_messages', parse: 'anthropic_text' },
      vlm: { endpoint: 'https://api.apimart.ai/v1/messages', body: 'anthropic_messages', parse: 'anthropic_text' },
    },
    operations: {
      'llm.chat': {
        label: 'APIMart Claude Messages',
        method: 'POST',
        path: 'https://api.apimart.ai/v1/messages',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: '{{messages}}',
          system: '{{params.system}}',
          max_tokens: '{{params.max_tokens}}',
        },
        response: { text: '$.content[0].text', usage: '$.usage' },
      },
      'llm.chat.vision': {
        label: 'APIMart Claude Vision',
        method: 'POST',
        path: 'https://api.apimart.ai/v1/messages',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          messages: '{{messagesWithImages}}',
          max_tokens: '{{params.max_tokens}}',
        },
        response: { text: '$.content[0].text', usage: '$.usage' },
      },
    },
    modelProfiles: {
      claude: { label: 'Claude via APIMart', match: ['claude'], capabilities: ['llm.chat', 'llm.chat.vision'], uiSchemas: [] },
    },
    paramSchema: {
      llm: [
        { key: 'max_tokens', label: '最大输出', type: 'number', default: 1024, min: 1, max: 200000 },
      ],
    },
  },
  'apimart-media': {
    id: 'apimart-media',
    label: '媒体异步任务',
    summary: '图片、视频、音乐等提交任务后查询结果的异步生成协议，适合 VEO、Seedance、Kling、Suno 等模型。',
    kind: 'model-protocol-package',
    scope: 'model',
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    unwrapData: true,
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      image: { endpoint: '/v1/images/generations', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/v1/videos/generations', body: 'openai_chat', parse: 'openai_chat' },
      audio: { endpoint: '/v1/audio/speech', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'image.generate': {
        label: 'APIMart Gemini Image',
        method: 'POST',
        path: '/v1beta/models/{model}:generateContent',
        requestMode: 'json',
        bodyTemplate: {
          contents: [{ role: 'user', parts: [{ text: '{{prompt}}' }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: '{{params.aspectRatio}}',
              imageSize: '{{params.imageSize}}',
            },
          },
        },
        response: { images: '$.candidates[*].content.parts[*].inlineData.data' },
        uiSchema: 'apimart-image-generate',
      },
      'video.generate': {
        label: 'APIMart Video Generations',
        method: 'POST',
        path: '/v1/videos/generations',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          duration: '{{params.duration}}',
          size: '{{params.size}}',
          resolution: '{{params.resolution}}',
          generate_audio: '{{params.generate_audio}}',
        },
        response: {
          taskId: '$.id || $.task_id || $.data.id || $.data.task_id',
          videos: '$..video_url || $..url',
        },
        uiSchema: 'apimart-video-generate',
      },
      'video.image_to_video': {
        label: 'APIMart Image To Video',
        method: 'POST',
        path: '/v1/videos/generations',
        requestMode: 'json',
        bodyTemplate: {
          model: '{{model}}',
          prompt: '{{prompt}}',
          image_urls: '{{inputs.imageUrls}}',
          duration: '{{params.duration}}',
          size: '{{params.size}}',
          resolution: '{{params.resolution}}',
          generate_audio: '{{params.generate_audio}}',
        },
        response: {
          taskId: '$.id || $.task_id || $.data.id || $.data.task_id',
          videos: '$..video_url || $..url',
        },
        uiSchema: 'apimart-video-generate',
      },
      'audio.music': {
        label: 'APIMart Music Generation',
        method: 'POST',
        path: '/v1/music/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', title: '{{params.title}}', lyrics: '{{params.lyrics}}', style: '{{params.style}}', instrumental: '{{params.instrumental}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', audios: '$..audio_url || $..url' },
        uiSchema: 'apimart-music-generate',
      },
      'tasks.get': {
        label: 'APIMart Task Query',
        method: 'GET',
        path: '/v1/tasks/{task_id}',
        requestMode: 'path',
        response: { task: '$', media: '$..url' },
      },
      'tasks.cancel': {
        label: 'APIMart Task Cancel',
        method: 'POST',
        path: '/v1/tasks/{task_id}/cancel',
        requestMode: 'path',
        response: { task: '$', status: '$.status || $.data.status' },
      },
      'uploads.image': {
        label: 'APIMart Image Upload',
        method: 'POST',
        path: '/v1/uploads/images',
        requestMode: 'multipart',
        bodyTemplate: { file: '{{inputs.file}}' },
        response: { url: '$.url || $.data.url || $.data.file_url || $.data.asset_url' },
        uiSchema: 'apimart-upload',
      },
      'uploads.video': {
        label: 'APIMart Video Upload',
        method: 'POST',
        path: '/v1/uploads/videos',
        requestMode: 'multipart',
        bodyTemplate: { file: '{{inputs.file}}' },
        response: { url: '$.url || $.data.url || $.data.file_url || $.data.asset_url' },
        uiSchema: 'apimart-upload',
      },
      'uploads.audio': {
        label: 'APIMart Audio Upload',
        method: 'POST',
        path: '/v1/uploads/audios',
        requestMode: 'multipart',
        bodyTemplate: { file: '{{inputs.file}}' },
        response: { url: '$.url || $.data.url || $.data.file_url || $.data.asset_url' },
        uiSchema: 'apimart-upload',
      },
      'uploads.file': {
        label: 'APIMart File Upload',
        method: 'POST',
        path: '/v1/uploads/files',
        requestMode: 'multipart',
        bodyTemplate: { file: '{{inputs.file}}' },
        response: { url: '$.url || $.data.url || $.data.file_url || $.data.asset_url' },
        uiSchema: 'apimart-upload',
      },
      'webhook.receive': {
        label: 'APIMart Webhook Callback',
        method: 'POST',
        path: '{{callback_url}}',
        requestMode: 'json',
        bodyTemplate: { task_id: '{{task_id}}', status: '{{status}}', result: '{{result}}', error: '{{error}}' },
        response: { taskId: '$.task_id || $.id', status: '$.status', result: '$.result || $.data' },
        uiSchema: 'apimart-webhook',
      },
    },
    modelProfiles: {
      'veo3.1-lite': { label: 'VEO 3.1 Lite via APIMart', capabilities: ['video.generate', 'video.text_to_video'], uiSchemas: ['apimart-video-generate'], operationPreference: ['video.generate'], limits: { ...APIMART_VEO_LIMITS, references: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } } } },
      veo: { label: 'VEO via APIMart', match: ['veo'], capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame'], uiSchemas: ['apimart-video-generate'], operationPreference: ['video.generate', 'video.image_to_video'], limits: APIMART_VEO_LIMITS },
      seedance: { label: 'Seedance via APIMart', match: ['doubao-seedance', 'seedance'], capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'], uiSchemas: ['apimart-video-generate'], operationPreference: ['video.generate', 'video.image_to_video'], limits: APIMART_SEEDANCE_LIMITS },
      kling: { label: 'Kling via APIMart', match: ['kling', '可灵'], capabilities: ['video.generate', 'video.image_to_video'], uiSchemas: ['apimart-video-generate'], operationPreference: ['video.generate', 'video.image_to_video'] },
      suno: { label: 'Suno via APIMart', match: ['suno'], capabilities: ['audio.music'], uiSchemas: ['apimart-music-generate'], operationPreference: ['audio.music'] },
    },
    uiSchemas: {
      'apimart-image-generate': [
        { key: 'aspectRatio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21'].map((value) => ({ label: value, value })), bind: 'body.generationConfig.imageConfig.aspectRatio' },
        { key: 'imageSize', label: '清晰度', type: 'select', default: '1K', options: ['1K', '2K', '4K'].map((value) => ({ label: value, value })), bind: 'body.generationConfig.imageConfig.imageSize' },
      ],
      'apimart-video-generate': [
        { key: 'duration', label: '时长', type: 'select', default: 5, options: [4, 5, 8, 10, 15].map((value) => ({ label: `${value}s`, value })), bind: 'body.duration' },
        { key: 'size', label: '比例', type: 'select', default: '16:9', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].map((value) => ({ label: value, value })), bind: 'body.size' },
        { key: 'resolution', label: '清晰度', type: 'select', default: '480p', options: ['480p', '720p', '1080p', '4k'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.resolution' },
        { key: 'generate_audio', label: '生成音频', type: 'toggle', default: false, bind: 'body.generate_audio' },
      ],
      'apimart-music-generate': MUSIC_SCHEMA,
      'apimart-upload': [
        { key: 'purpose', label: '用途', type: 'select', default: 'reference', options: ['reference', 'input', 'mask', 'asset'].map((value) => ({ label: value, value })), bind: 'body.purpose' },
      ],
      'apimart-webhook': [
        { key: 'callback_url', label: '回调地址', type: 'text', default: '', bind: 'body.callback_url' },
        { key: 'secret', label: '签名密钥', type: 'text', default: '', bind: 'headers.x-webhook-secret' },
      ],
    },
  },
  'agtoken-video': {
    id: 'agtoken-video',
    label: 'AG 模型协议',
    summary: 'AGToken 视频模型协议；按模型自动选择 AG 统一接口、Seedance 火山兼容接口或 Wan DashScope 兼容接口。',
    kind: 'model-protocol-package',
    scope: 'model',
    categories: ['video', 'task', 'seedance', 'wan'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      video: { endpoint: '/v1/video/generations', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'video.generate': {
        label: 'AG 视频生成', method: 'POST', path: '/v1/video/generations', requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', images: '{{inputs.images}}', metadata: '{{params.metadata}}' },
        response: { taskId: '$.task_id', videos: '$.data.result_url' }, uiSchema: 'agtoken-video',
      },
      'video.multimodal': {
        label: 'AG Seedance 多模态视频', method: 'POST', path: '/api/v3/contents/generations/tasks', requestMode: 'json',
        response: { taskId: '$.id', videos: '$.content.video_url' }, uiSchema: 'agtoken-video',
      },
      'tasks.get': { label: 'AG 视频任务查询', method: 'GET', path: '/v1/video/generations/{task_id}', requestMode: 'path' },
    },
    modelProfiles: {
      'seedance-2.0': {
        label: 'AG Seedance 2.0', match: ['doubao-seedance-2-0', 'doubao-seedance-2.0'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'],
        uiSchemas: ['agtoken-video'], limits: APIMART_SEEDANCE_LIMITS,
      },
      'seedance-2.5': {
        label: 'AG Seedance 2.5', match: ['doubao-seedance-2-5', 'doubao-seedance-2.5'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'],
        uiSchemas: ['agtoken-video'],
        limits: {
          duration: { min: 4, max: 30, step: 1, integer: true, default: 5 },
          resolution: { options: ['480p', '720p'], default: '720p' },
          aspect_ratio: { options: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], default: 'adaptive' },
          references: { images: { max: 30 }, videos: { max: 10 }, audios: { max: 10 }, total: { max: 50 } },
        },
      },
      'wan-3.0': {
        label: 'AG Wan 3.0', match: ['wan3.0-video'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'],
        uiSchemas: ['agtoken-video'],
        limits: {
          duration: { min: -1, max: 30, step: 1, integer: true, default: 5 },
          resolution: { options: ['480p', '720p', '1080p'], default: '1080p' },
          aspect_ratio: { options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'], default: 'adaptive' },
          references: { images: { max: 30 }, videos: { max: 10 }, audios: { max: 10 }, total: { max: 50 } },
        },
      },
    },
    uiSchemas: {
      'agtoken-video': [
        { key: 'duration', label: '时长', type: 'number', default: 5, min: -1, max: 30, step: 1, bind: 'body.duration' },
        { key: 'aspect_ratio', label: '比例', type: 'select', default: 'adaptive', options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].map((value) => ({ label: value, value })), bind: 'body.ratio' },
        { key: 'resolution', label: '清晰度', type: 'select', default: '720p', options: ['480p', '720p', '1080p', '4k'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.resolution' },
        { key: 'generate_audio', label: '生成音频', type: 'toggle', default: true, bind: 'body.generate_audio' },
        { key: 'watermark', label: '水印', type: 'toggle', default: false, bind: 'body.watermark' },
      ],
    },
    paramSchema: { video: VIDEO_SCHEMA },
    docs: [{ title: 'AGToken 视频 API', url: 'https://agtoken.vip/docs' }],
  },
  'zkki-model': {
    id: 'zkki-model', label: 'ZKKI 模型协议',
    summary: 'ZKKI 图片与异步视频模型协议；图片走 Seedream JSON 接口，视频按 input/parameters 创建、轮询并鉴权下载成品。',
    kind: 'model-protocol-package', scope: 'model', categories: ['image', 'video', 'task', 'seedream', 'seedance'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      image: { endpoint: '/v1/images/generations', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/v1/videos', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'image.generate': { label: 'ZKKI 图片生成', method: 'POST', path: '/v1/images/generations', requestMode: 'json', uiSchema: 'zkki-image' },
      'image.edit': { label: 'ZKKI 参考图生成', method: 'POST', path: '/v1/images/generations', requestMode: 'json', uiSchema: 'zkki-image' },
      'video.generate': { label: 'ZKKI 视频生成', method: 'POST', path: '/v1/videos', requestMode: 'json', uiSchema: 'zkki-video' },
      'tasks.get': { label: 'ZKKI 视频任务查询', method: 'GET', path: '/v1/videos/{task_id}', requestMode: 'path' },
      'video.download': { label: 'ZKKI 视频成品下载', method: 'GET', path: '/v1/videos/{task_id}/content', requestMode: 'path' },
    },
    modelProfiles: {
      seedream: { label: 'ZKKI Seedream', match: ['seedream'], capabilities: ['image.generate', 'image.edit'], uiSchemas: ['zkki-image'] },
      'seedance-2.0-mini-hc': { label: 'ZKKI Seedance 2.0 Mini HC', match: ['dreamina-seedance-2-0-mini-hc'], capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'], uiSchemas: ['zkki-video'], limits: { duration: { min: 4, max: 30, step: 1, integer: true, default: 5 }, resolution: { options: ['480p', '720p'], default: '720p' }, aspect_ratio: { options: ['1:1', '16:9', '9:16'], default: '16:9' }, references: { images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } } } },
      'seedance-2.0': { label: 'ZKKI Seedance 2.0', match: ['dreamina-seedance-2-0'], capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'], uiSchemas: ['zkki-video'], limits: { duration: { min: 4, max: 30, step: 1, integer: true, default: 5 }, resolution: { options: ['480p', '720p', '1080p', '4k'], default: '720p' }, aspect_ratio: { options: ['1:1', '16:9', '9:16'], default: '16:9' }, references: { images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } } } },
      'seedance-2.5': { label: 'ZKKI Seedance 2.5', match: ['dreamina-seedance-2-5', 'seedance-2.5-global-standard-multi'], capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'], uiSchemas: ['zkki-video'], limits: { duration: { min: 4, max: 30, step: 1, integer: true, default: 5 }, resolution: { options: ['480p', '720p', '1080p', '2k', '4k', 'native1080p'], default: '720p' }, aspect_ratio: { options: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], default: '16:9' }, references: { images: { max: 30 }, videos: { max: 10 }, audios: { max: 10 } } } },
      'global-multi': { label: 'ZKKI Global 多模态', match: ['global-standard-multi'], capabilities: ['video.generate', 'video.image_to_video', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'], uiSchemas: ['zkki-video'] },
      'text-to-video': { label: 'ZKKI 纯文生视频', match: ['global-standard-t2v'], capabilities: ['video.generate', 'video.text_to_video'], uiSchemas: ['zkki-video'], limits: { duration: { min: 4, max: 30, step: 1, integer: true, default: 5 }, references: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } } } },
      'minimax-h3': { label: 'ZKKI MiniMax H3', match: ['minimax-h3-d'], capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.multi_reference'], uiSchemas: ['zkki-video'], limits: { duration: { min: 4, max: 15, step: 1, integer: true, default: 5 }, resolution: { options: ['2K', '768P'], default: '768P' }, aspect_ratio: { options: ['adaptive', '16:9', '9:16', '1:1'], default: 'adaptive' }, references: { images: { max: 9 }, videos: { max: 0 }, audios: { max: 0 } }, features: { generate_audio: false, watermark: false } } },
      omni: { label: 'ZKKI Omni', match: ['omni', 'omni-fast'], capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.multi_reference'], uiSchemas: ['zkki-video'] },
      'gpt-image-2': { label: 'ZKKI GPT Image 2', match: ['gpt-image-2'], capabilities: ['image.generate', 'image.edit'], uiSchemas: ['zkki-image'] },
    },
    uiSchemas: {
      'zkki-image': [
        { key: 'size', label: '清晰度', type: 'select', default: '2K', options: ['auto', '1K', '1.5K', '2K'].map((value) => ({ label: value, value })), bind: 'body.size' },
        { key: 'aspect_ratio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((value) => ({ label: value, value })), bind: 'body.aspect_ratio' },
        { key: 'quality', label: '质量档位', type: 'select', default: 'gt_236w', options: [{ label: '高质量', value: 'gt_236w' }, { label: '标准', value: 'le_236w' }], bind: 'body.quality' },
      ],
      'zkki-video': [
        { key: 'duration', label: '时长', type: 'number', default: 5, min: 4, max: 30, step: 1, bind: 'body.parameters.duration' },
        { key: 'aspect_ratio', label: '比例', type: 'select', default: '16:9', options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].map((value) => ({ label: value, value })), bind: 'body.parameters.ratio' },
        { key: 'resolution', label: '清晰度', type: 'select', default: '720p', options: ['480p', '720p', '1080p', '2k', '4k', 'native1080p', 'native4k'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.parameters.resolution' },
        { key: 'generate_audio', label: '生成音频', type: 'toggle', default: true, bind: 'body.parameters.generate_audio' },
        { key: 'watermark', label: '水印', type: 'toggle', default: false, bind: 'body.parameters.watermark' },
      ],
    },
    paramSchema: { image: IMAGE_SCHEMA, video: VIDEO_SCHEMA },
    docs: [{ title: 'ZKKI API', url: 'https://api.zkki.net' }],
  },
  midjourney: {
    id: 'midjourney',
    label: 'Midjourney 异步任务',
    summary: 'Midjourney 异步任务协议，支持文生图、图生图、Blend、放大、变体、重绘、平移、缩放和任务查询。',
    kind: 'model-protocol-package',
    scope: 'model',
    categories: ['image', 'task', 'upscale', 'variation'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    unwrapData: true,
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      image: { endpoint: '/v1/midjourney/generations', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'image.generate': {
        label: 'Midjourney Imagine',
        method: 'POST',
        path: '/v1/midjourney/generations',
        requestMode: 'json',
        bodyTemplate: { prompt: '{{prompt}}', size: '{{params.size}}', version: '{{params.version}}', speed: '{{params.speed}}', image_urls: '{{inputs.imageUrls}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-generate',
      },
      'image.blend': {
        label: 'Midjourney Blend',
        method: 'POST',
        path: '/v1/midjourney/generations/blend',
        requestMode: 'json',
        bodyTemplate: { image_urls: '{{inputs.imageUrls}}', size: '{{params.size}}', speed: '{{params.speed}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-generate',
      },
      'image.edit': {
        label: 'Midjourney Edit',
        method: 'POST',
        path: '/v1/midjourney/generations/edits',
        requestMode: 'json',
        bodyTemplate: { prompt: '{{prompt}}', image_urls: '{{inputs.imageUrls}}', size: '{{params.size}}', version: '{{params.version}}', speed: '{{params.speed}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-generate',
      },
      'image.upscale': {
        label: 'Midjourney Upscale',
        method: 'POST',
        path: '/v1/midjourney/generations/upscale',
        requestMode: 'json',
        bodyTemplate: { task_id: '{{params.task_id}}', index: '{{params.index}}', speed: '{{params.speed}}', custom_id: '{{params.custom_id}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-action',
      },
      'image.variation': {
        label: 'Midjourney Variation',
        method: 'POST',
        path: '/v1/midjourney/generations/variation',
        requestMode: 'json',
        bodyTemplate: { task_id: '{{params.task_id}}', index: '{{params.index}}', speed: '{{params.speed}}', custom_id: '{{params.custom_id}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-action',
      },
      'image.reroll': {
        label: 'Midjourney Reroll',
        method: 'POST',
        path: '/v1/midjourney/generations/reroll',
        requestMode: 'json',
        bodyTemplate: { task_id: '{{params.task_id}}', speed: '{{params.speed}}', custom_id: '{{params.custom_id}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-action',
      },
      'image.zoom': {
        label: 'Midjourney Zoom',
        method: 'POST',
        path: '/v1/midjourney/generations/zoom',
        requestMode: 'json',
        bodyTemplate: { task_id: '{{params.task_id}}', zoom_ratio: '{{params.zoom_ratio}}', speed: '{{params.speed}}', custom_id: '{{params.custom_id}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-action',
      },
      'image.pan': {
        label: 'Midjourney Pan',
        method: 'POST',
        path: '/v1/midjourney/generations/pan',
        requestMode: 'json',
        bodyTemplate: { task_id: '{{params.task_id}}', direction: '{{params.direction}}', speed: '{{params.speed}}', custom_id: '{{params.custom_id}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-action',
      },
      'image.inpaint': {
        label: 'Midjourney Inpaint',
        method: 'POST',
        path: '/v1/midjourney/generations/inpaint',
        requestMode: 'json',
        bodyTemplate: { task_id: '{{params.task_id}}', prompt: '{{prompt}}', mask_image: '{{inputs.maskImage}}', speed: '{{params.speed}}', custom_id: '{{params.custom_id}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..image_urls || $..url' },
        uiSchema: 'midjourney-action',
      },
      'tasks.get': {
        label: 'Midjourney Task Query',
        method: 'GET',
        path: '/v1/midjourney/{task_id}',
        requestMode: 'path',
        response: { task: '$', status: '$.status || $.data.status', images: '$..image_url || $..image_urls || $..url' },
      },
    },
    modelProfiles: {
      midjourney: {
        label: 'Midjourney',
        match: ['midjourney', 'mj'],
        capabilities: ['image.generate', 'image.edit', 'image.blend', 'image.upscale', 'image.variation', 'image.reroll', 'image.zoom', 'image.pan', 'image.inpaint'],
        uiSchemas: ['midjourney-generate', 'midjourney-action'],
        operationPreference: ['image.generate'],
      },
    },
    uiSchemas: {
      'midjourney-generate': [
        { key: 'size', label: '比例', type: 'select', default: '1:1', options: ['1:1', '4:3', '3:4', '16:9', '9:16'].map((value) => ({ label: value, value })), bind: 'body.size' },
        { key: 'version', label: '版本', type: 'text', default: '6.1', bind: 'body.version' },
        { key: 'speed', label: '速度', type: 'select', default: 'relax', options: ['relax', 'fast', 'turbo'].map((value) => ({ label: value, value })), bind: 'body.speed' },
      ],
      'midjourney-action': [
        { key: 'task_id', label: '任务 ID', type: 'text', default: '', bind: 'body.task_id' },
        { key: 'index', label: '序号', type: 'number', default: 1, min: 1, max: 4, bind: 'body.index' },
        { key: 'speed', label: '速度', type: 'select', default: 'relax', options: ['relax', 'fast', 'turbo'].map((value) => ({ label: value, value })), bind: 'body.speed' },
        { key: 'direction', label: '方向', type: 'select', default: '', options: ['', 'left', 'right', 'up', 'down'].map((value) => ({ label: value || '无', value })), bind: 'body.direction' },
        { key: 'zoom_ratio', label: '缩放', type: 'slider', default: 2, min: 1, max: 2, step: 0.1, bind: 'body.zoom_ratio' },
      ],
    },
    paramSchema: { image: IMAGE_SCHEMA },
    docs: [{ title: 'APIMart Midjourney', url: 'https://docs.apimart.ai/cn' }],
  },
  'v2-unified': {
    id: 'v2-unified',
    label: '统一任务协议',
    kind: 'provider-protocol-package',
    summary: '文档中的统一任务风格协议包，面向图片、视频、音乐等异步生成任务。',
    categories: ['image', 'video', 'audio', 'music', 'task'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      image: { endpoint: '/v2/images/generations', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/v2/videos/generations', body: 'openai_chat', parse: 'openai_chat' },
      audio: { endpoint: '/v2/music/generations', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'image.generate': {
        label: 'Unified Image Generation',
        method: 'POST',
        path: '/v2/images/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', size: '{{params.size}}', aspect_ratio: '{{params.aspect_ratio}}', seed: '{{params.seed}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..url' },
        uiSchema: 'unified-image',
      },
      'video.generate': {
        label: 'Unified Video Generation',
        method: 'POST',
        path: '/v2/videos/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}', seed: '{{params.seed}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' },
        uiSchema: 'unified-video',
      },
      'video.image_to_video': {
        label: 'Unified Image To Video',
        method: 'POST',
        path: '/v2/videos/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', images: '{{inputs.images}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' },
        uiSchema: 'unified-video',
      },
      'audio.music': {
        label: 'Unified Music Generation',
        method: 'POST',
        path: '/v2/music/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', title: '{{params.title}}', lyrics: '{{params.lyrics}}', style: '{{params.style}}', instrumental: '{{params.instrumental}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', audios: '$..audio_url || $..url' },
        uiSchema: 'unified-music',
      },
    },
    uiSchemas: { 'unified-image': IMAGE_SCHEMA, 'unified-video': VIDEO_SCHEMA, 'unified-music': MUSIC_SCHEMA },
    paramSchema: { image: IMAGE_SCHEMA, video: VIDEO_SCHEMA, audio: MUSIC_SCHEMA },
    docs: [{ title: 'Unified Generations', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  grok: {
    id: 'grok',
    label: 'Grok 图像/视频',
    kind: 'provider-protocol-package',
    summary: 'Grok 专用图像与视频生成协议声明。',
    categories: ['image', 'video'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      image: { endpoint: '/v1/images/generations', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/v2/videos/generations', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'image.generate': {
        label: 'Grok Image',
        method: 'POST',
        path: '/v1/images/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', size: '{{params.size}}', aspect_ratio: '{{params.aspect_ratio}}' },
        response: { images: '$.data[*].url || $.data[*].b64_json || $..image_url || $..url' },
        uiSchema: 'grok-image',
      },
      'video.generate': {
        label: 'Grok Video',
        method: 'POST',
        path: '/v2/videos/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' },
        uiSchema: 'grok-video',
      },
    },
    modelProfiles: {
      grok: { label: 'Grok Media', match: ['grok'], capabilities: ['image.generate', 'video.generate'], uiSchemas: ['grok-image', 'grok-video'] },
    },
    uiSchemas: { 'grok-image': IMAGE_SCHEMA, 'grok-video': VIDEO_SCHEMA },
    paramSchema: { image: IMAGE_SCHEMA, video: VIDEO_SCHEMA },
    docs: [{ title: 'Grok', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  grok2api: {
    id: 'grok2api',
    label: 'Grok2API 全模态',
    kind: 'provider-protocol-package',
    summary: 'Grok2API 网关协议：兼容 OpenAI 对话，并支持 Grok Web / Build / Console 的 JSON 图片编辑、/v1 异步视频和语音接口。',
    categories: ['llm', 'vision', 'tools', 'responses', 'image', 'video', 'audio'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    stream: true,
    capabilities: {
      llm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      vlm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      image: { endpoint: '/v1/images/generations', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/v1/videos/generations', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'llm.chat': { label: 'Grok2API Chat Completions', method: 'POST', path: '/v1/chat/completions', requestMode: 'json', uiSchema: 'grok2api-chat' },
      'llm.chat.vision': { label: 'Grok2API Vision', method: 'POST', path: '/v1/chat/completions', requestMode: 'json', uiSchema: 'grok2api-chat' },
      'llm.tools': { label: 'Grok2API Tools', method: 'POST', path: '/v1/chat/completions', requestMode: 'json', uiSchema: 'grok2api-chat' },
      'llm.responses': { label: 'Grok2API Responses', method: 'POST', path: '/v1/responses', requestMode: 'json', uiSchema: 'grok2api-responses' },
      'image.generate': {
        label: 'Grok2API Image Generations', method: 'POST', path: '/v1/images/generations', requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', n: '{{params.n}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}', quality: '{{params.quality}}', response_format: '{{params.response_format}}' },
        response: { images: '$.data[*].url || $.data[*].b64_json' }, uiSchema: 'grok2api-image',
      },
      'image.edit': {
        label: 'Grok2API Image Edits', method: 'POST', path: '/v1/images/edits', requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', image: '{{params.image}}', images: '{{params.images}}', n: '{{params.n}}', quality: '{{params.quality}}', response_format: '{{params.response_format}}' },
        response: { images: '$.data[*].url || $.data[*].b64_json' }, uiSchema: 'grok2api-image',
      },
      'video.generate': {
        label: 'Grok2API Video Generations', method: 'POST', path: '/v1/videos/generations', requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}', image: '{{params.image}}', reference_images: '{{params.reference_images}}', reference_audios: '{{params.reference_audios}}' },
        response: { taskId: '$.request_id', videos: '$.video.url' }, uiSchema: 'grok2api-video',
      },
      'video.image_to_video': {
        label: 'Grok2API Image To Video', method: 'POST', path: '/v1/videos/generations', requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}', image: '{{params.image}}', reference_images: '{{params.reference_images}}' },
        response: { taskId: '$.request_id', videos: '$.video.url' }, uiSchema: 'grok2api-video',
      },
      'video.edit': {
        label: 'Grok2API Video Edits', method: 'POST', path: '/v1/videos/edits', requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', video: '{{params.video}}' },
        response: { taskId: '$.request_id' }, uiSchema: 'grok2api-video',
      },
      'audio.tts': { label: 'Grok2API OpenAI Speech', method: 'POST', path: '/v1/audio/speech', requestMode: 'json', response: { audio: 'binary', contentType: 'audio/*' }, uiSchema: 'grok2api-audio' },
      'audio.transcribe': { label: 'Grok2API Transcriptions', method: 'POST', path: '/v1/audio/transcriptions', requestMode: 'multipart', response: { text: '$.text' }, uiSchema: 'grok2api-transcribe' },
    },
    modelProfiles: {
      'grok-imagine-image': { label: 'Grok Image', match: ['grok-imagine-image'], capabilities: ['image.generate', 'image.edit'], uiSchemas: ['grok2api-image'] },
      'grok-imagine-video': {
        label: 'Grok Video', match: ['grok-imagine-video'], capabilities: ['video.generate', 'video.image_to_video', 'video.edit'], uiSchemas: ['grok2api-video'],
        limits: {
          duration: { min: 1, max: 15, step: 1, integer: true, default: 8 },
          aspect_ratio: { options: ['1:1', '2:3', '3:2', '16:9', '9:16'], default: '16:9' },
          resolution: { options: ['480p', '720p', '1080p'], default: '720p' },
          references: { images: { max: 8 }, videos: { max: 1 }, audios: { max: 3 } },
        },
      },
      'grok-voice': { label: 'Grok Voice', match: ['grok-voice'], capabilities: ['audio.tts'], uiSchemas: ['grok2api-audio'] },
      'grok-stt': { label: 'Grok STT', match: ['grok-stt'], capabilities: ['audio.transcribe'], uiSchemas: ['grok2api-transcribe'] },
      grok: { label: 'Grok Chat', match: ['grok-'], capabilities: ['llm.chat', 'llm.chat.vision', 'llm.tools', 'llm.responses'], uiSchemas: ['grok2api-chat', 'grok2api-responses'] },
    },
    uiSchemas: {
      'grok2api-chat': [
        { key: 'temperature', label: '温度', type: 'slider', default: 0.7, min: 0, max: 2, step: 0.1, bind: 'body.temperature' },
        { key: 'max_tokens', label: '最大输出', type: 'number', default: 2048, min: 1, max: 128000, bind: 'body.max_completion_tokens' },
      ],
      'grok2api-responses': [
        { key: 'instructions', label: '系统指令', type: 'textarea', default: '', bind: 'body.instructions' },
        { key: 'max_output_tokens', label: '最大输出', type: 'number', default: 2048, min: 1, max: 128000, bind: 'body.max_output_tokens' },
      ],
      'grok2api-image': [
        { key: 'aspect_ratio', label: '比例', type: 'select', default: '1:1', options: ['1:1', '2:3', '3:2', '16:9', '9:16'].map((value) => ({ label: value, value })), bind: 'body.aspect_ratio' },
        { key: 'resolution', label: '清晰度', type: 'select', default: '1k', options: ['1k', '2k'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.resolution' },
        { key: 'n', label: '数量', type: 'number', default: 1, min: 1, max: 4, bind: 'body.n' },
        { key: 'response_format', label: '返回格式', type: 'select', default: 'url', options: [{ label: 'URL', value: 'url' }, { label: 'Base64', value: 'b64_json' }], bind: 'body.response_format' },
      ],
      'grok2api-video': VIDEO_SCHEMA,
      'grok2api-audio': [
        { key: 'voice', label: '声音', type: 'text', default: 'eve', bind: 'body.voice' },
        { key: 'response_format', label: '格式', type: 'select', default: 'mp3', options: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'].map((value) => ({ label: value.toUpperCase(), value })), bind: 'body.response_format' },
        { key: 'speed', label: '语速', type: 'slider', default: 1, min: 0.25, max: 4, step: 0.05, bind: 'body.speed' },
      ],
      'grok2api-transcribe': [
        { key: 'language', label: '语言', type: 'text', default: '', bind: 'form.language' },
        { key: 'response_format', label: '返回格式', type: 'select', default: 'json', options: ['json', 'verbose_json', 'text'].map((value) => ({ label: value, value })), bind: 'form.response_format' },
      ],
    },
    paramSchema: { image: IMAGE_SCHEMA, video: VIDEO_SCHEMA },
  },
  kling: {
    id: 'kling',
    label: 'Kling 可灵',
    kind: 'provider-protocol-package',
    summary: 'Kling / 可灵文生视频、图生视频协议声明。',
    categories: ['video'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: { video: { endpoint: '/v2/videos/generations', body: 'openai_chat', parse: 'openai_chat' } },
    operations: {
      'video.generate': {
        label: 'Kling Text To Video',
        method: 'POST',
        path: '/v2/videos/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' },
        uiSchema: 'kling-video',
      },
      'video.image_to_video': {
        label: 'Kling Image To Video',
        method: 'POST',
        path: '/v2/videos/generations',
        requestMode: 'json',
        bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', image: '{{inputs.image}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}' },
        response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' },
        uiSchema: 'kling-video',
      },
    },
    modelProfiles: { kling: { label: 'Kling Video', match: ['kling', '可灵'], capabilities: ['video.generate', 'video.image_to_video'], uiSchemas: ['kling-video'] } },
    uiSchemas: { 'kling-video': VIDEO_SCHEMA },
    paramSchema: { video: VIDEO_SCHEMA },
    docs: [{ title: 'Kling', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  pixverse: {
    id: 'pixverse',
    label: 'PixVerse',
    kind: 'provider-protocol-package',
    summary: 'PixVerse 文生视频与图生视频协议声明。',
    categories: ['video'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: { video: { endpoint: '/v2/videos/generations', body: 'openai_chat', parse: 'openai_chat' } },
    operations: {
      'video.generate': { label: 'PixVerse Text To Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'pixverse-video' },
      'video.image_to_video': { label: 'PixVerse Image To Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', image: '{{inputs.image}}', duration: '{{params.duration}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'pixverse-video' },
    },
    modelProfiles: { pixverse: { label: 'PixVerse Video', match: ['pixverse'], capabilities: ['video.generate', 'video.image_to_video'], uiSchemas: ['pixverse-video'] } },
    uiSchemas: { 'pixverse-video': VIDEO_SCHEMA },
    paramSchema: { video: VIDEO_SCHEMA },
    docs: [{ title: 'PixVerse', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  pika: {
    id: 'pika',
    label: 'Pika',
    kind: 'provider-protocol-package',
    summary: 'Pika 视频生成协议声明。',
    categories: ['video'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: { video: { endpoint: '/v2/videos/generations', body: 'openai_chat', parse: 'openai_chat' } },
    operations: {
      'video.generate': { label: 'Pika Text To Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'pika-video' },
      'video.image_to_video': { label: 'Pika Image To Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', image: '{{inputs.image}}', duration: '{{params.duration}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'pika-video' },
    },
    modelProfiles: { pika: { label: 'Pika Video', match: ['pika'], capabilities: ['video.generate', 'video.image_to_video'], uiSchemas: ['pika-video'] } },
    uiSchemas: { 'pika-video': VIDEO_SCHEMA },
    paramSchema: { video: VIDEO_SCHEMA },
    docs: [{ title: 'Pika', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  vidu: {
    id: 'vidu',
    label: 'Vidu',
    kind: 'provider-protocol-package',
    summary: 'Vidu 视频生成协议声明。',
    categories: ['video'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: { video: { endpoint: '/v2/videos/generations', body: 'openai_chat', parse: 'openai_chat' } },
    operations: {
      'video.generate': { label: 'Vidu Text To Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'vidu-video' },
      'video.image_to_video': { label: 'Vidu Image To Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', image: '{{inputs.image}}', duration: '{{params.duration}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'vidu-video' },
    },
    modelProfiles: { vidu: { label: 'Vidu Video', match: ['vidu'], capabilities: ['video.generate', 'video.image_to_video'], uiSchemas: ['vidu-video'] } },
    uiSchemas: { 'vidu-video': VIDEO_SCHEMA },
    paramSchema: { video: VIDEO_SCHEMA },
    docs: [{ title: 'Vidu', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  wanxiang: {
    id: 'wanxiang',
    label: '通义万相 / Wan',
    kind: 'provider-protocol-package',
    summary: '通义万相 / Wan 图像与视频生成协议声明。',
    categories: ['image', 'video'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      image: { endpoint: '/v2/images/generations', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/v2/videos/generations', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'image.generate': { label: 'Wan Image', method: 'POST', path: '/v2/images/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', size: '{{params.size}}', aspect_ratio: '{{params.aspect_ratio}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', images: '$..image_url || $..url' }, uiSchema: 'wanxiang-image' },
      'video.generate': { label: 'Wan Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'wanxiang-video' },
      'video.image_to_video': { label: 'Wan Image To Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', image: '{{inputs.image}}', duration: '{{params.duration}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'wanxiang-video' },
    },
    modelProfiles: { wan: { label: 'Wan / 万相', match: ['wan', 'wanx', '通义万相'], capabilities: ['image.generate', 'video.generate', 'video.image_to_video'], uiSchemas: ['wanxiang-image', 'wanxiang-video'] } },
    uiSchemas: { 'wanxiang-image': IMAGE_SCHEMA, 'wanxiang-video': VIDEO_SCHEMA },
    paramSchema: { image: IMAGE_SCHEMA, video: VIDEO_SCHEMA },
    docs: [{ title: 'Wanxiang', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax / Hailuo',
    kind: 'provider-protocol-package',
    summary: 'MiniMax / 海螺视频与音频生成协议声明。',
    categories: ['video', 'audio'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: {
      video: { endpoint: '/v2/videos/generations', body: 'openai_chat', parse: 'openai_chat' },
      audio: { endpoint: '/v1/audio/speech', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'video.generate': { label: 'MiniMax Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', duration: '{{params.duration}}', aspect_ratio: '{{params.aspect_ratio}}', resolution: '{{params.resolution}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'minimax-video' },
      'video.image_to_video': { label: 'MiniMax Image To Video', method: 'POST', path: '/v2/videos/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', image: '{{inputs.image}}', duration: '{{params.duration}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', videos: '$..video_url || $..url' }, uiSchema: 'minimax-video' },
      'audio.tts': { label: 'MiniMax Speech', method: 'POST', path: '/v1/audio/speech', requestMode: 'json', bodyTemplate: { model: '{{model}}', input: '{{input}}', voice: '{{params.voice}}' }, response: { audio: 'binary' }, uiSchema: 'minimax-audio' },
    },
    modelProfiles: { minimax: { label: 'MiniMax / Hailuo', match: ['minimax', 'hailuo', '海螺'], capabilities: ['video.generate', 'video.image_to_video', 'audio.tts'], uiSchemas: ['minimax-video', 'minimax-audio'] } },
    uiSchemas: {
      'minimax-video': VIDEO_SCHEMA,
      'minimax-audio': [
        { key: 'voice', label: '声音', type: 'text', default: '', bind: 'body.voice' },
        { key: 'speed', label: '语速', type: 'slider', default: 1, min: 0.5, max: 2, step: 0.05, bind: 'body.speed' },
      ],
    },
    paramSchema: { video: VIDEO_SCHEMA, audio: MUSIC_SCHEMA },
    docs: [{ title: 'MiniMax', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  suno: {
    id: 'suno',
    label: 'Suno 音乐',
    kind: 'provider-protocol-package',
    summary: 'Suno 音乐生成协议声明。',
    categories: ['audio', 'music'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    capabilities: { audio: { endpoint: '/v2/music/generations', body: 'openai_chat', parse: 'openai_chat' } },
    operations: {
      'audio.music': { label: 'Suno Music', method: 'POST', path: '/v2/music/generations', requestMode: 'json', bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}', title: '{{params.title}}', lyrics: '{{params.lyrics}}', style: '{{params.style}}', instrumental: '{{params.instrumental}}' }, response: { taskId: '$.id || $.task_id || $.data.id || $.data.task_id', audios: '$..audio_url || $..url' }, uiSchema: 'suno-music' },
    },
    modelProfiles: { suno: { label: 'Suno Music', match: ['suno'], capabilities: ['audio.music'], uiSchemas: ['suno-music'] } },
    uiSchemas: { 'suno-music': MUSIC_SCHEMA },
    paramSchema: { audio: MUSIC_SCHEMA },
    docs: [{ title: 'Suno', url: 'https://gpt-best.apifox.cn/doc-6113929' }],
  },
  agnes: {
    id: 'agnes',
    label: 'Agnes AI 原生协议',
    kind: 'provider-protocol-package',
    summary: 'Agnes OpenAI 兼容对话、JSON 图片生成/编辑和原生异步视频协议。',
    categories: ['llm', 'image', 'video', 'free'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    stream: true,
    capabilities: {
      llm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      vlm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      image: { endpoint: '/v1/images/generations', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/v1/videos', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'llm.chat': { label: 'Agnes Chat', method: 'POST', path: '/v1/chat/completions', requestMode: 'json' },
      'image.generate': { label: 'Agnes Image', method: 'POST', path: '/v1/images/generations', requestMode: 'json', uiSchema: 'agnes-image' },
      'image.edit': { label: 'Agnes Image Edit', method: 'POST', path: '/v1/images/generations', requestMode: 'json', uiSchema: 'agnes-image' },
      'video.generate': { label: 'Agnes Video', method: 'POST', path: '/v1/videos', requestMode: 'json', uiSchema: 'agnes-video' },
      'video.image_to_video': { label: 'Agnes Image to Video', method: 'POST', path: '/v1/videos', requestMode: 'json', uiSchema: 'agnes-video' },
    },
    modelProfiles: {
      image: { label: 'Agnes Image', match: ['agnes-image-'], capabilities: ['image.generate', 'image.edit'], uiSchemas: ['agnes-image'] },
      'agnes-video-2.5-flash': {
        label: 'Agnes Video 2.5 Flash',
        match: ['agnes-video-2.5-flash', 'agnes-video-v2.5-flash'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference'],
        uiSchemas: ['agnes-video'],
        limits: {
          duration: { min: 4, max: 12, step: 1, integer: true, default: 5 },
          aspect_ratio: { options: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], default: '16:9' },
          resolution: { options: ['720p'], default: '720p' },
          references: { images: { max: 4 }, videos: { max: 0 }, audios: { max: 0 } },
          features: { generate_audio: false, enhance_prompt: false, camera_fixed: false, watermark: false },
        },
      },
      video: {
        label: 'Agnes Video',
        match: ['agnes-video-'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference'],
        uiSchemas: ['agnes-video'],
        limits: {
          duration: { min: 1, max: 18, step: 1, integer: true, default: 5 },
          aspect_ratio: { options: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', '9:21'], default: '16:9' },
          resolution: { options: ['480p', '720p', '1080p'], default: '720p' },
          references: { images: { max: 4 }, videos: { max: 0 }, audios: { max: 0 } },
          features: { generate_audio: false, enhance_prompt: false, camera_fixed: false, watermark: false },
        },
      },
    },
    uiSchemas: { 'agnes-image': AGNES_IMAGE_SCHEMA, 'agnes-video': VIDEO_SCHEMA },
    paramSchema: { image: AGNES_IMAGE_SCHEMA, video: VIDEO_SCHEMA },
    docs: [{ title: 'Agnes AI', url: 'https://platform.agnes-ai.com/settings/apiKeys' }],
  },
  modelscope: {
    id: 'modelscope',
    label: 'ModelScope 原生协议',
    kind: 'provider-protocol-package',
    summary: 'ModelScope OpenAI 兼容对话 + 异步图片任务协议，支持图片生成、图片编辑与模型专属 LoRA。',
    categories: ['llm', 'vision', 'image', 'lora'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/v1/models', kind: 'openai' },
    stream: true,
    capabilities: {
      llm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      vlm: { endpoint: '/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      image: { endpoint: '/v1/images/generations', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'llm.chat': { label: 'ModelScope Chat', method: 'POST', path: '/v1/chat/completions', requestMode: 'json' },
      'image.generate': { label: 'ModelScope 异步生图', method: 'POST', path: '/v1/images/generations', requestMode: 'json', uiSchema: 'modelscope-image' },
      'image.edit': { label: 'ModelScope 参考图生成', method: 'POST', path: '/v1/images/generations', requestMode: 'json', uiSchema: 'modelscope-image' },
    },
    modelProfiles: {
      image: { label: 'ModelScope Image', match: ['z-image', 'qwen-image', 'flux.2-klein'], capabilities: ['image.generate', 'image.edit'], uiSchemas: ['modelscope-image'] },
    },
    uiSchemas: { 'modelscope-image': MODELSCOPE_IMAGE_SCHEMA },
    paramSchema: { image: MODELSCOPE_IMAGE_SCHEMA },
    docs: [{ title: 'ModelScope', url: 'https://modelscope.cn/docs/model-service/API-Inference/intro' }],
  },
  volcengine: {
    id: 'volcengine',
    label: '火山引擎方舟',
    kind: 'provider-protocol-package',
    summary: '火山引擎方舟原生协议：OpenAI 兼容对话、Seedream 图片生成/编辑，以及 Seedance 异步视频任务。',
    categories: ['llm', 'vision', 'image', 'video', 'task', 'seedream', 'seedance'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/api/v3/models', kind: 'openai' },
    stream: true,
    capabilities: {
      llm: { endpoint: '/api/v3/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      vlm: { endpoint: '/api/v3/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      image: { endpoint: '/api/v3/images/generations', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/api/v3/contents/generations/tasks', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'llm.chat': { label: '方舟兼容对话', method: 'POST', path: '/api/v3/chat/completions', requestMode: 'json' },
      'image.generate': { label: 'Seedream 文生图', method: 'POST', path: '/api/v3/images/generations', requestMode: 'json', uiSchema: 'volcengine-image' },
      'image.edit': { label: 'Seedream 参考图生成', method: 'POST', path: '/api/v3/images/generations', requestMode: 'json', uiSchema: 'volcengine-image' },
      'video.generate': { label: 'Seedance 视频任务', method: 'POST', path: '/api/v3/contents/generations/tasks', requestMode: 'json', uiSchema: 'volcengine-video' },
      'video.image_to_video': { label: 'Seedance 图生视频', method: 'POST', path: '/api/v3/contents/generations/tasks', requestMode: 'json', uiSchema: 'volcengine-video' },
      'video.first_last_frame': { label: 'Seedance 首尾帧', method: 'POST', path: '/api/v3/contents/generations/tasks', requestMode: 'json', uiSchema: 'volcengine-video' },
      'video.multi_reference': { label: 'Seedance 多模态参考', method: 'POST', path: '/api/v3/contents/generations/tasks', requestMode: 'json', uiSchema: 'volcengine-video' },
    },
    modelProfiles: {
      seedream: { label: '豆包 Seedream', match: ['seedream', 'doubao-seedream'], capabilities: ['image.generate', 'image.edit'], uiSchemas: ['volcengine-image'] },
      seedance: { label: '豆包 Seedance', match: ['seedance', 'doubao-seedance'], capabilities: ['video.generate', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference'], uiSchemas: ['volcengine-video'] },
    },
    uiSchemas: { 'volcengine-image': VOLCENGINE_IMAGE_SCHEMA, 'volcengine-video': VOLCENGINE_VIDEO_SCHEMA },
    paramSchema: { image: VOLCENGINE_IMAGE_SCHEMA, video: VOLCENGINE_VIDEO_SCHEMA },
    docs: [{ title: '火山方舟 API', url: 'https://www.volcengine.com/docs/82379' }],
  },
  runninghub: {
    id: 'runninghub',
    label: 'RunningHub 全能力',
    kind: 'provider-protocol-package',
    summary: 'RunningHub 原生协议包：LLM、标准图像/视频模型、AI 应用与 OpenAPI 工作流。标准模型使用账户余额 Key，AI 应用和工作流可使用 RH币 Key。',
    categories: ['llm', 'vision', 'image', 'video', 'workflow', 'ai-app'],
    auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
    models: { endpoint: '/openapi/v2/models', kind: 'openai' },
    capabilities: {
      llm: { endpoint: 'https://llm.runninghub.ai/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      vlm: { endpoint: 'https://llm.runninghub.ai/v1/chat/completions', body: 'openai_chat', parse: 'openai_chat' },
      image: { endpoint: '/openapi/v2/{model}', body: 'openai_chat', parse: 'openai_chat' },
      video: { endpoint: '/openapi/v2/{model}', body: 'openai_chat', parse: 'openai_chat' },
    },
    operations: {
      'llm.chat': { label: 'RunningHub LLM', method: 'POST', path: 'https://llm.runninghub.ai/v1/chat/completions', requestMode: 'json' },
      'image.generate': { label: 'RunningHub Image', method: 'POST', path: '/openapi/v2/{model}', requestMode: 'json' },
      'image.edit': { label: 'RunningHub Image Edit', method: 'POST', path: '/openapi/v2/{model}', requestMode: 'json' },
      'video.generate': { label: 'RunningHub Video', method: 'POST', path: '/openapi/v2/{model}', requestMode: 'json' },
      'workflow.run': { label: 'RunningHub Workflow', method: 'POST', path: '/task/openapi/create', requestMode: 'json' },
      'ai-app.run': { label: 'RunningHub AI App', method: 'POST', path: '/task/openapi/ai-app/run', requestMode: 'json' },
    },
    modelProfiles: {
      'image-edit-channel': {
        label: 'RunningHub 参考图编辑',
        match: ['gpt-image-2.0/edit', 'gpt-image-2/edit', 'nano-banana/edit', 'rhart-image-g-2/image-to-image', 'rhart-image-v1/edit'],
        capabilities: ['image.edit'],
        operationPreference: ['image.edit'],
      },
      'image-generate-channel': {
        label: 'RunningHub 文生图',
        match: ['gpt-image-2.0/text-to-image', 'gpt-image-2/text-to-image', 'nano-banana/text-to-image', 'rhart-image-g-2/text-to-image', 'rhart-image-v1/text-to-image'],
        capabilities: ['image.generate'],
        operationPreference: ['image.generate'],
      },
    },
    paramSchema: { image: IMAGE_SCHEMA, video: VIDEO_SCHEMA },
    docs: [{ title: 'RunningHub OpenAPI', url: 'https://www.runninghub.ai/openapi' }],
  },
}

export interface ProviderProtocolDef {
  id: string
  label: string
  summary: string
  kind: 'provider-protocol'
  categories: string[]
  runtimeProtocol: string
  auth: { type: AuthType; header?: string; prefix?: string }
  models: { endpoint: string; kind: ModelsKind }
  stream?: boolean
  operations?: Record<string, unknown>
  modelProfiles?: Record<string, unknown>
  uiSchemas?: Record<string, unknown[]>
  paramSchema?: Record<string, unknown[]>
  docs?: { title: string; url: string }[]
}

export const PROVIDER_PROTOCOLS: Record<string, ProviderProtocolDef> = {
  'cli:jimeng': {
    id: 'cli:jimeng',
    label: '即梦 CLI',
    summary: '本地 dreamina CLI 完整协议：登录态、积分、模型、文生图、图生图、图片放大、文生视频、图生视频、首尾帧、多帧、全能参考和排队续查。',
    kind: 'provider-protocol',
    categories: ['cli', 'image', 'video', 'multimodal', 'task'],
    runtimeProtocol: 'cli:jimeng',
    auth: { type: 'none' },
    models: { endpoint: '/api/cli/jimeng/models', kind: 'openai' },
    operations: {
      'image.generate': { label: '即梦文生图', method: 'POST', path: '/api/cli/jimeng/generate-image', requestMode: 'multipart' },
      'image.edit': { label: '即梦图生图', method: 'POST', path: '/api/cli/jimeng/generate-image', requestMode: 'multipart' },
      'image.upscale': { label: '即梦图片放大', method: 'POST', path: '/api/cli/jimeng/upscale-image', requestMode: 'multipart' },
      'video.generate': { label: '自动选择视频生成方式', description: '兼容入口，根据传入的图片、视频、音频和素材角色自动选择生成方式。', method: 'POST', path: '/api/cli/jimeng/generate-video', requestMode: 'multipart', uiSchema: 'jimeng-video' },
      'video.text_to_video': { label: '文生视频', description: '只使用提示词生成视频。', method: 'POST', path: '/api/cli/jimeng/generate-video', requestMode: 'multipart', uiSchema: 'jimeng-video' },
      'video.image_to_video': { label: '单图生视频', description: '使用一张起始图片生成视频。', method: 'POST', path: '/api/cli/jimeng/generate-video', requestMode: 'multipart', uiSchema: 'jimeng-video' },
      'video.first_last_frame': { label: '首尾帧生视频', description: '使用明确标记的首帧和尾帧生成过渡视频。', method: 'POST', path: '/api/cli/jimeng/generate-video', requestMode: 'multipart', uiSchema: 'jimeng-video' },
      'video.multi_reference': { label: '多图参考生视频', description: '使用多张参考图片生成连续镜头或多帧过渡。', method: 'POST', path: '/api/cli/jimeng/generate-video', requestMode: 'multipart', uiSchema: 'jimeng-video' },
      'video.video_to_video': { label: '参考视频生成', description: '使用参考视频控制动作、镜头或节奏。', method: 'POST', path: '/api/cli/jimeng/generate-video', requestMode: 'multipart', uiSchema: 'jimeng-video' },
      'video.audio_reference': { label: '参考音频生成', description: '把音频作为多模态参考素材参与视频生成。', method: 'POST', path: '/api/cli/jimeng/generate-video', requestMode: 'multipart', uiSchema: 'jimeng-video' },
      'video.multimodal': { label: '全能参考生成', description: '同时理解图片、视频和音频参考素材。', method: 'POST', path: '/api/cli/jimeng/generate-video', requestMode: 'multipart', uiSchema: 'jimeng-video' },
      'task.query': { label: '续查生成任务', method: 'POST', path: '/api/cli/jimeng/query-media', requestMode: 'json' },
      'task.list': { label: '任务列表', method: 'GET', path: '/api/cli/jimeng/tasks', requestMode: 'json' },
    },
    uiSchemas: { 'jimeng-video': VIDEO_SCHEMA },
    paramSchema: { video: VIDEO_SCHEMA },
    modelProfiles: {
      'seedance1.0fast': {
        label: 'Seedance 1.0 Fast',
        capabilities: ['video.generate', 'video.image_to_video', 'video.multi_reference'],
        uiSchemas: ['jimeng-video'],
        operationPreference: ['video.image_to_video'],
        limits: {
          ...JIMENG_BASE_VIDEO_LIMITS,
          duration: { min: 5, max: 10, step: 1, integer: true, default: 5 },
          references: { images: { min: 1, max: 20 }, videos: { max: 0 }, audios: { max: 0 } },
          byCapability: { 'video.multi_reference': { resolution: { options: ['720p', '1080p'], default: '720p' }, references: { images: { min: 2, max: 20 } } } },
        },
      },
      'seedance1.5pro': {
        label: 'Seedance 1.5 Pro',
        capabilities: ['video.generate', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference'],
        uiSchemas: ['jimeng-video'],
        operationPreference: ['video.image_to_video'],
        limits: {
          ...JIMENG_BASE_VIDEO_LIMITS,
          duration: { min: 5, max: 12, step: 1, integer: true, default: 5 },
          references: { images: { min: 1, max: 20 }, videos: { max: 0 }, audios: { max: 0 } },
          byCapability: {
            'video.first_last_frame': { references: { images: { min: 2, max: 2 } } },
            'video.multi_reference': { resolution: { options: ['720p', '1080p'], default: '720p' }, references: { images: { min: 2, max: 20 } } },
          },
        },
      },
      'seedance2.0': {
        label: 'Seedance 2.0',
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'],
        uiSchemas: ['jimeng-video'],
        limits: JIMENG_SEEDANCE2_LIMITS,
      },
      'seedance2.0_vip': {
        label: 'Seedance 2.0 VIP',
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'],
        uiSchemas: ['jimeng-video'],
        limits: {
          ...JIMENG_SEEDANCE2_LIMITS,
          resolution: { options: ['720p', '1080p', '4k'], default: '720p' },
        },
      },
      'seedance2.0fast': {
        label: 'Seedance 2.0 Fast', match: ['seedance2.0fast', 'seedance2.0fast_vip'],
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'],
        uiSchemas: ['jimeng-video'], limits: JIMENG_SEEDANCE2_LIMITS,
      },
      'seedance2.0mini': {
        label: 'Seedance 2.0 Mini',
        capabilities: ['video.generate', 'video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.multi_reference', 'video.video_to_video', 'video.audio_reference', 'video.multimodal'],
        uiSchemas: ['jimeng-video'], limits: JIMENG_SEEDANCE2_LIMITS,
      },
    },
    docs: [{ title: '本地 dreamina CLI', url: '/api/cli/jimeng/help' }],
  },
  'cli:codex': {
    id: 'cli:codex', label: 'GPT CLI', summary: '复用本机 OpenAI Codex 登录态进行对话，并通过 GPT Image 2 Skill 生成图片。',
    kind: 'provider-protocol', categories: ['cli', 'llm', 'image'], runtimeProtocol: 'cli:codex', auth: { type: 'none' },
    models: { endpoint: '/api/cli/codex/models', kind: 'openai' },
    operations: { 'llm.chat': { label: 'Codex 对话', method: 'POST', path: '/api/cli/codex/chat' }, 'image.generate': { label: 'GPT Image 2', method: 'POST', path: '/api/cli/codex/generate-image' } },
    modelProfiles: {
      'gpt-5.5': { label: 'GPT 5.5', capabilities: ['llm.chat', 'llm.chat.vision'] },
      'gpt-image-2': { label: 'GPT Image 2', capabilities: ['image.generate', 'image.edit'] },
    },
    docs: [{ title: 'OpenAI Codex CLI', url: '/api/cli/codex/help' }],
  },
  'cli:gemini': {
    id: 'cli:gemini', label: 'Gemini CLI', summary: '复用本机 Gemini 或 Antigravity 登录态进行对话。',
    kind: 'provider-protocol', categories: ['cli', 'llm'], runtimeProtocol: 'cli:gemini', auth: { type: 'none' },
    models: { endpoint: '/api/cli/gemini/models', kind: 'openai' },
    operations: { 'llm.chat': { label: 'Gemini CLI 对话', method: 'POST', path: '/api/cli/gemini/chat' } },
    modelProfiles: { auto: { label: '自动选择', capabilities: ['llm.chat', 'llm.chat.vision'] } },
    docs: [{ title: 'Gemini CLI', url: '/api/cli/gemini/help' }],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI 兼容同步',
    summary: '站点连接协议：Bearer Key、OpenAI 风格 /v1/models、同步 JSON/SSE 请求。模型可单独选择 OpenAI、Gemini、Kling 等执行协议。',
    kind: 'provider-protocol',
    categories: ['sync', 'openai-compatible', 'sse'],
    runtimeProtocol: 'openai',
    auth: PROTOCOLS.openai.auth,
    models: PROTOCOLS.openai.models,
    stream: true,
  },
  apimart: {
    id: 'apimart',
    label: '异步协议',
    summary: '异步聚合站点连接协议，兼容 APIMart、APIB 等同类网关；普通对话直接返回，图片、视频和音乐任务可提交后轮询结果。',
    kind: 'provider-protocol',
    categories: ['aggregator', 'multi-model'],
    runtimeProtocol: 'apimart',
    auth: PROTOCOLS.apimart?.auth || PROTOCOLS.openai.auth,
    models: PROTOCOLS.apimart?.models || PROTOCOLS.openai.models,
  },
  agtoken: {
    id: 'agtoken',
    label: 'AG 平台',
    summary: 'AGToken 视频 API 平台；使用 Bearer Key，并由 AG 模型协议自动适配统一、Seedance 和 Wan 异步任务格式。',
    kind: 'provider-protocol',
    categories: ['video', 'task', 'seedance', 'wan'],
    runtimeProtocol: 'agtoken-video',
    auth: PROTOCOLS['agtoken-video'].auth,
    models: PROTOCOLS['agtoken-video'].models,
  },
  zkki: {
    id: 'zkki',
    label: 'ZKKI 平台',
    summary: 'ZKKI 图片与视频 API 平台；使用 Bearer Key，模型由 ZKKI 模型协议统一适配。',
    kind: 'provider-protocol',
    categories: ['image', 'video', 'task', 'seedream', 'seedance'],
    runtimeProtocol: 'zkki-model',
    auth: PROTOCOLS['zkki-model'].auth,
    models: PROTOCOLS['zkki-model'].models,
  },
  grok2api: {
    id: 'grok2api',
    label: 'Grok2API',
    summary: 'Grok2API 本地或远程网关连接协议，使用 g2a_ Key，支持 Grok 对话、图片、视频和语音模型。',
    kind: 'provider-protocol',
    categories: ['grok', 'multimodal', 'openai-compatible', 'task'],
    runtimeProtocol: 'grok2api',
    auth: PROTOCOLS.grok2api.auth,
    models: PROTOCOLS.grok2api.models,
    stream: true,
  },
  agnes: {
    id: 'agnes',
    label: 'Agnes AI',
    summary: 'Agnes 原生连接协议，支持兼容对话、JSON 图片和异步视频任务。',
    kind: 'provider-protocol',
    categories: ['llm', 'image', 'video', 'free'],
    runtimeProtocol: 'agnes',
    auth: PROTOCOLS.agnes.auth,
    models: PROTOCOLS.agnes.models,
    stream: true,
  },
  modelscope: {
    id: 'modelscope',
    label: 'ModelScope',
    summary: 'ModelScope 原生连接协议，支持 OpenAI 兼容对话、异步图片任务和模型专属 LoRA。',
    kind: 'provider-protocol',
    categories: ['llm', 'image', 'lora'],
    runtimeProtocol: 'modelscope',
    auth: PROTOCOLS.modelscope.auth,
    models: PROTOCOLS.modelscope.models,
    stream: true,
  },
  volcengine: {
    id: 'volcengine',
    label: '火山引擎',
    summary: '火山方舟原生连接协议，使用方舟 API Key，支持兼容对话、Seedream 图片和 Seedance 异步视频任务。',
    kind: 'provider-protocol',
    categories: ['llm', 'image', 'video', 'task', 'seedream', 'seedance'],
    runtimeProtocol: 'volcengine',
    auth: PROTOCOLS.volcengine.auth,
    models: PROTOCOLS.volcengine.models,
    stream: true,
    operations: PROTOCOLS.volcengine.operations,
    modelProfiles: PROTOCOLS.volcengine.modelProfiles,
    uiSchemas: PROTOCOLS.volcengine.uiSchemas,
    paramSchema: PROTOCOLS.volcengine.paramSchema,
    docs: PROTOCOLS.volcengine.docs,
  },
  runninghub: {
    id: 'runninghub',
    label: 'RunningHub',
    summary: 'RunningHub 原生连接协议，包含 RH币 Key、账户余额 Key、标准模型、工作流与 AI 应用。',
    kind: 'provider-protocol',
    categories: ['multi-model', 'workflow', 'ai-app'],
    runtimeProtocol: 'runninghub',
    auth: PROTOCOLS.runninghub.auth,
    models: PROTOCOLS.runninghub.models,
  },
}

type CustomProtocolKind = 'provider' | 'model'
type CustomProtocolStore = {
  provider: Record<string, ProviderProtocolDef>
  model: Record<string, ProtocolDef>
}

export type RemoteProtocolBinding = {
  providerProtocolId: string
  siteRules?: RemoteProtocolSiteRule[]
  defaultModelProtocolId?: string
  allowedModelProtocolIds: string[]
  modelRules?: Array<{ pattern: string; modelProtocolId: string }>
}

export type RemoteProtocolSiteRule = {
  hosts?: string[]
  hostSuffixes?: string[]
  pathPrefixes?: string[]
  priority?: number
}

export type RemoteProtocolStore = CustomProtocolStore & {
  bindings: RemoteProtocolBinding[]
}

const CUSTOM_PROTOCOL_FILE = process.env.DX_CUSTOM_PROTOCOL_FILE || dataPath('custom-protocols.json')
const BUILTIN_MODEL_PROTOCOL_IDS = new Set(Object.keys(PROTOCOLS))
const BUILTIN_PROVIDER_PROTOCOL_IDS = new Set(Object.keys(PROVIDER_PROTOCOLS))
const DECLARED_VIDEO_RUNTIME_PROTOCOL_IDS = new Set(['v2-unified', 'grok', 'grok2api', 'kling', 'pixverse', 'pika', 'vidu', 'wanxiang', 'minimax', 'volcengine'])
const DECLARED_AUDIO_RUNTIME_PROTOCOL_IDS = new Set(['v2-unified', 'grok2api', 'suno', 'minimax'])
const RUNNABLE_MODEL_PROTOCOL_IDS = new Set(['openai', 'anthropic', 'gemini', 'gemini-generations', 'apimart', 'apimart-gemini', 'apimart-claude', 'apimart-media', 'agtoken-video', 'zkki-model', 'midjourney', 'agnes', 'modelscope', 'volcengine', 'runninghub', ...DECLARED_VIDEO_RUNTIME_PROTOCOL_IDS, ...DECLARED_AUDIO_RUNTIME_PROTOCOL_IDS])
const RUNNABLE_PROVIDER_PROTOCOL_IDS = new Set(['cli:jimeng', 'cli:codex', 'cli:gemini', 'openai', 'apimart', 'agtoken-video', 'zkki-model', 'grok2api', 'agnes', 'modelscope', 'volcengine', 'runninghub'])
const INTERNAL_MODEL_PROTOCOL_IDS = new Set(['apimart-gemini', 'apimart-claude', 'apimart-media'])
let customProtocolStore: CustomProtocolStore = { provider: {}, model: {} }
let remoteProtocolStore: RemoteProtocolStore = { provider: {}, model: {}, bindings: [] }
let remoteProviderIds = new Set<string>()
let remoteModelIds = new Set<string>()

function protocolObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeCustomProtocol(kind: CustomProtocolKind, value: unknown): ProviderProtocolDef | ProtocolDef {
  const raw = protocolObject(value)
  const id = String(raw.id || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9:_-]{1,63}$/.test(id)) throw new Error('协议 id 只能使用小写字母、数字、冒号、下划线和短横线，长度 2-64。')
  if (BUILTIN_MODEL_PROTOCOL_IDS.has(id) || BUILTIN_PROVIDER_PROTOCOL_IDS.has(id)) throw new Error(`内置协议「${id}」不能覆盖，请换一个自定义 id。`)
  const label = String(raw.label || '').trim()
  if (!label) throw new Error('缺少协议名称 label。')
  const runtimeProtocol = String(raw.runtimeProtocol || 'openai').trim().toLowerCase()
  if (!PROTOCOLS[runtimeProtocol] && !PROVIDER_PROTOCOLS[runtimeProtocol]) throw new Error(`运行协议「${runtimeProtocol}」不存在，请选择已有协议。`)
  const auth = protocolObject(raw.auth)
  const models = protocolObject(raw.models)
  const common = {
    ...raw,
    id,
    label,
    summary: String(raw.summary || `${label} 自定义协议`).trim(),
    runtimeProtocol,
    categories: Array.isArray(raw.categories) ? raw.categories.map(String).filter(Boolean) : [],
    auth: {
      type: ['bearer', 'google_api_key', 'api_key_header', 'none'].includes(String(auth.type || '')) ? auth.type : 'bearer',
      ...(auth.header ? { header: String(auth.header) } : {}),
      ...(auth.prefix != null ? { prefix: String(auth.prefix) } : {}),
    },
    models: {
      endpoint: String(models.endpoint || '/v1/models'),
      kind: ['openai', 'anthropic', 'gemini'].includes(String(models.kind || '')) ? models.kind : 'openai',
    },
  }
  if (kind === 'provider') {
    return { ...common, kind: 'provider-protocol', runtimeProtocol } as ProviderProtocolDef
  }
  return {
    ...common,
    kind: 'model-protocol-package',
    scope: 'model',
    capabilities: protocolObject(raw.capabilities) as ProtocolDef['capabilities'],
    operations: protocolObject(raw.operations),
    modelProfiles: protocolObject(raw.modelProfiles),
    uiSchemas: protocolObject(raw.uiSchemas) as Record<string, unknown[]>,
    paramSchema: protocolObject(raw.paramSchema) as Record<string, unknown[]>,
  } as ProtocolDef
}

function persistCustomProtocols() {
  mkdirSync(dirname(CUSTOM_PROTOCOL_FILE), { recursive: true })
  const temp = `${CUSTOM_PROTOCOL_FILE}.tmp`
  writeFileSync(temp, JSON.stringify(customProtocolStore, null, 2), 'utf-8')
  renameSync(temp, CUSTOM_PROTOCOL_FILE)
}

function installCustomProtocols() {
  for (const [id, protocol] of Object.entries(customProtocolStore.model)) PROTOCOLS[id] = protocol
  for (const [id, protocol] of Object.entries(customProtocolStore.provider)) PROVIDER_PROTOCOLS[id] = protocol
}

function removeInstalledRemoteProtocols() {
  for (const id of remoteProviderIds) if (!customProtocolStore.provider[id]) delete PROVIDER_PROTOCOLS[id]
  for (const id of remoteModelIds) if (!customProtocolStore.model[id]) delete PROTOCOLS[id]
  remoteProviderIds = new Set()
  remoteModelIds = new Set()
}

export function installRemoteProtocols(value: RemoteProtocolStore) {
  removeInstalledRemoteProtocols()
  const next: RemoteProtocolStore = { provider: {}, model: {}, bindings: Array.isArray(value.bindings) ? value.bindings : [] }
  const runtimeExists = (id: string) => !!PROTOCOLS[id] || !!PROVIDER_PROTOCOLS[id]
  const prepare = (kind: CustomProtocolKind, rawValue: unknown) => {
    const raw = protocolObject(rawValue)
    const runtimeProtocol = String(raw.runtimeProtocol || 'openai').trim().toLowerCase()
    if (runtimeExists(runtimeProtocol)) return normalizeCustomProtocol(kind, raw)
    throw new Error(`在线协议「${String(raw.id || '')}」引用了不可执行的运行时「${runtimeProtocol}」；新增执行逻辑需要升级 DX OS。`)
  }
  for (const raw of Object.values(value.model || {})) {
    const protocol = prepare('model', raw) as ProtocolDef
    if (customProtocolStore.model[protocol.id] || customProtocolStore.provider[protocol.id]) continue
    next.model[protocol.id] = protocol
    PROTOCOLS[protocol.id] = protocol
    remoteModelIds.add(protocol.id)
  }
  for (const raw of Object.values(value.provider || {})) {
    const protocol = prepare('provider', raw) as ProviderProtocolDef
    if (customProtocolStore.provider[protocol.id] || customProtocolStore.model[protocol.id]) continue
    next.provider[protocol.id] = protocol
    PROVIDER_PROTOCOLS[protocol.id] = protocol
    remoteProviderIds.add(protocol.id)
  }
  remoteProtocolStore = next
  installCustomProtocols()
  return { providerCount: remoteProviderIds.size, modelCount: remoteModelIds.size, bindingCount: next.bindings.length }
}

export function remoteProtocolBindings() {
  return remoteProtocolStore.bindings.map((binding) => ({
    ...binding,
    allowedModelProtocolIds: [...binding.allowedModelProtocolIds],
    siteRules: binding.siteRules?.map((rule) => ({
      ...rule,
      hosts: rule.hosts ? [...rule.hosts] : undefined,
      hostSuffixes: rule.hostSuffixes ? [...rule.hostSuffixes] : undefined,
      pathPrefixes: rule.pathPrefixes ? [...rule.pathPrefixes] : undefined,
    })),
    modelRules: binding.modelRules?.map((rule) => ({ ...rule })),
  }))
}

function loadCustomProtocols() {
  if (!existsSync(CUSTOM_PROTOCOL_FILE)) return
  try {
    const parsed = protocolObject(JSON.parse(readFileSync(CUSTOM_PROTOCOL_FILE, 'utf-8')))
    const provider = protocolObject(parsed.provider)
    const model = protocolObject(parsed.model)
    for (const raw of Object.values(provider)) {
      try {
        const protocol = normalizeCustomProtocol('provider', raw) as ProviderProtocolDef
        customProtocolStore.provider[protocol.id] = protocol
      } catch { /* 忽略单条损坏配置 */ }
    }
    for (const raw of Object.values(model)) {
      try {
        const protocol = normalizeCustomProtocol('model', raw) as ProtocolDef
        customProtocolStore.model[protocol.id] = protocol
      } catch { /* 忽略单条损坏配置 */ }
    }
    installCustomProtocols()
  } catch { /* 损坏文件不阻止服务启动 */ }
}

export function saveCustomProtocol(kind: CustomProtocolKind, value: unknown) {
  const protocol = normalizeCustomProtocol(kind, value)
  if (kind === 'provider') {
    customProtocolStore.provider[protocol.id] = protocol as ProviderProtocolDef
    PROVIDER_PROTOCOLS[protocol.id] = protocol as ProviderProtocolDef
  } else {
    customProtocolStore.model[protocol.id] = protocol as ProtocolDef
    PROTOCOLS[protocol.id] = protocol as ProtocolDef
  }
  persistCustomProtocols()
  return protocol
}

export function removeCustomProtocol(kind: CustomProtocolKind, idValue: string) {
  const id = String(idValue || '').trim().toLowerCase()
  const collection = kind === 'provider' ? customProtocolStore.provider : customProtocolStore.model
  if (!collection[id]) throw new Error(`自定义${kind === 'provider' ? '平台' : '模型'}协议「${id}」不存在。`)
  delete collection[id]
  if (kind === 'provider') delete PROVIDER_PROTOCOLS[id]
  else delete PROTOCOLS[id]
  persistCustomProtocols()
  return id
}

loadCustomProtocols()

const MODEL_PROTOCOL_ALIASES: Record<string, { runtimeProtocol: string; label: string; summary: string; categories: string[]; capabilities: string[] }> = {
  'openai-chat': {
    runtimeProtocol: 'openai',
    label: 'OpenAI Chat',
    summary: '模型执行协议：OpenAI Chat Completions / Responses 风格，适合 LLM、视觉、工具调用与结构化输出。',
    categories: ['llm', 'vision', 'tools', 'responses'],
    capabilities: ['llm.chat', 'llm.chat.vision', 'llm.tools', 'llm.responses', 'llm.structured_output'],
  },
  'openai-image': {
    runtimeProtocol: 'openai',
    label: 'OpenAI Image',
    summary: '模型执行协议：OpenAI Images 风格，适合文生图、图像编辑和图像变体。',
    categories: ['image'],
    capabilities: ['image.generate', 'image.edit', 'image.variation'],
  },
  'openai-audio': {
    runtimeProtocol: 'openai',
    label: 'OpenAI Audio',
    summary: '模型执行协议：OpenAI Audio 风格，适合 TTS、转写、翻译等语音能力。',
    categories: ['audio'],
    capabilities: ['audio.tts', 'audio.transcribe', 'audio.translate'],
  },
  'openai-embedding': {
    runtimeProtocol: 'openai',
    label: 'OpenAI Embedding',
    summary: '模型执行协议：OpenAI Embeddings 风格，适合向量化模型。',
    categories: ['embedding'],
    capabilities: ['embeddings.create'],
  },
  'openai-files': {
    runtimeProtocol: 'openai',
    label: 'OpenAI Files',
    summary: '模型执行协议：OpenAI Files / Batches 风格，适合文件上传、批处理任务。',
    categories: ['files', 'batches'],
    capabilities: ['files.upload', 'batches.create'],
  },
  'gemini-chat': {
    runtimeProtocol: 'gemini',
    label: 'Gemini Chat',
    summary: '模型执行协议：Gemini generateContent 风格，适合 Gemini 文本和视觉模型。',
    categories: ['llm', 'vision'],
    capabilities: ['llm.chat', 'llm.chat.vision'],
  },
  'gemini-image': {
    runtimeProtocol: 'gemini',
    label: 'Gemini Image',
    summary: '模型执行协议：Gemini / Imagen 图像生成风格，支持参考图编辑。',
    categories: ['image'],
    capabilities: ['image.generate', 'image.edit'],
  },
  'anthropic-chat': {
    runtimeProtocol: 'anthropic',
    label: 'Anthropic Chat',
    summary: '模型执行协议：Anthropic Messages 风格，适合 Claude 文本和视觉模型。',
    categories: ['llm', 'vision'],
    capabilities: ['llm.chat', 'llm.chat.vision'],
  },
}

export function modelProtocolAlias(id: string) {
  return MODEL_PROTOCOL_ALIASES[String(id || '').trim().toLowerCase()] || null
}

export function suggestModelProtocol(providerProtocol: string, modelName: string) {
  const provider = String(providerProtocol || '').trim().toLowerCase()
  const model = String(modelName || '').trim().toLowerCase()
  if (!model) return ''
  const binding = remoteProtocolStore.bindings.find((item) => item.providerProtocolId === provider)
  if (binding) {
    for (const rule of binding.modelRules || []) {
      try { if (new RegExp(rule.pattern, 'i').test(model)) return rule.modelProtocolId } catch { /* 安装时已校验；忽略损坏的单条规则 */ }
    }
    if (binding.defaultModelProtocolId) return binding.defaultModelProtocolId
  }
  if (provider === 'agtoken' || provider === 'agtoken-video') return 'agtoken-video'
  if (provider === 'zkki' || provider === 'zkki-model') return 'zkki-model'
  if (provider !== 'apimart') return ''

  if (/(^|[-_./\s])(midjourney|mj)([-_./\s]|$)|\bniji\b/.test(model)) return 'midjourney'
  if (/\bclaude\b|anthropic|\bgemini\b|\bimagen\b/.test(model)) return 'apimart'
  if (/(^|[-_./\s])(veo|kling|suno|pixverse|pika|vidu|luma|runway|seedance|seedream|hailuo|minimax|wanx?|cogvideo|music|udio)(\d|[-_./\s]|$)/.test(model)) return 'apimart'
  return ''
}

const BUILTIN_PROVIDER_SITE_RULES: Array<{ providerProtocolId: string; siteRules: RemoteProtocolSiteRule[] }> = [
  { providerProtocolId: 'apimart', siteRules: [{ hosts: ['api.apimart.ai'], hostSuffixes: ['.apimart.ai'], priority: 100 }] },
  // apib.ai exposes an OpenAI-compatible image API. Treating it as the APIMart
  // Gemini protocol sends requests to the wrong host/path and ignores its base URL.
  { providerProtocolId: 'openai', siteRules: [{ hosts: ['apib.ai'], hostSuffixes: ['.apib.ai'], priority: 100 }] },
  { providerProtocolId: 'agtoken', siteRules: [{ hosts: ['agtoken.vip'], hostSuffixes: ['.agtoken.vip'], priority: 100 }] },
  { providerProtocolId: 'zkki', siteRules: [{ hosts: ['api.zkki.net'], hostSuffixes: ['.zkki.net'], priority: 100 }] },
  { providerProtocolId: 'modelscope', siteRules: [{ hosts: ['api-inference.modelscope.cn', 'api-inference.modelscope.ai'], priority: 100 }] },
  { providerProtocolId: 'volcengine', siteRules: [{ hosts: ['ark.cn-beijing.volces.com'], hostSuffixes: ['.volces.com'], pathPrefixes: ['/api/v3'], priority: 100 }] },
  { providerProtocolId: 'agnes', siteRules: [{ hosts: ['apihub.agnes-ai.com'], hostSuffixes: ['.agnes-ai.com'], priority: 100 }] },
  { providerProtocolId: 'runninghub', siteRules: [{ hosts: ['www.runninghub.ai', 'runninghub.ai'], hostSuffixes: ['.runninghub.ai'], priority: 100 }] },
]

type SiteRuleMatch = { providerProtocolId: string; exact: number; suffix: number; path: number; priority: number; order: number }

function providerSiteRuleMatches(baseUrl: string, bindings: Array<{ providerProtocolId: string; siteRules?: RemoteProtocolSiteRule[] }>) {
  let parsed: URL
  try { parsed = new URL(String(baseUrl || '').trim()) } catch { return [] as SiteRuleMatch[] }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  const path = parsed.pathname || '/'
  const matches: SiteRuleMatch[] = []
  let order = 0
  for (const binding of bindings) for (const rule of binding.siteRules || []) {
    order += 1
    const hosts = (rule.hosts || []).map((value) => value.toLowerCase())
    const suffixes = (rule.hostSuffixes || []).map((value) => value.toLowerCase())
    const prefixes = rule.pathPrefixes || []
    const exact = hosts.includes(host) ? 1 : 0
    const suffix = suffixes.some((value) => host.endsWith(value) && host.length > value.length) ? 1 : 0
    if (!exact && !suffix) continue
    const pathMatch = !prefixes.length || prefixes.some((value) => path === value || path.startsWith(value.endsWith('/') ? value : `${value}/`))
    if (!pathMatch) continue
    matches.push({
      providerProtocolId: binding.providerProtocolId,
      exact,
      suffix,
      path: prefixes.length ? Math.max(...prefixes.filter((value) => path === value || path.startsWith(value.endsWith('/') ? value : `${value}/`)).map((value) => value.length), 0) : 0,
      priority: Number.isFinite(rule.priority) ? Number(rule.priority) : 0,
      order,
    })
  }
  return matches.sort((a, b) => b.exact - a.exact || b.suffix - a.suffix || b.path - a.path || b.priority - a.priority || a.order - b.order)
}

/**
 * 返回用户点击“验证协议”时应尝试的平台协议顺序。
 * 在线站点规则优先于内置规则；之后保留用户当前选择，最后只做 OpenAI 兼容探测。
 * 此函数只给出候选顺序，不会写入用户配置。
 */
export function providerProtocolCandidates(baseUrl: string, currentProtocol = 'openai') {
  const online = providerSiteRuleMatches(baseUrl, remoteProtocolStore.bindings)
  const builtin = providerSiteRuleMatches(baseUrl, BUILTIN_PROVIDER_SITE_RULES)
  const current = String(currentProtocol || '').trim().toLowerCase()
  return [...online, ...builtin]
    .map((match) => match.providerProtocolId)
    .concat(current, 'openai')
    .filter((id, index, values) => !!id && !!PROVIDER_PROTOCOLS[id] && values.indexOf(id) === index)
}

export function listProtocols() {
  return listProviderProtocols()
}

export function listProviderProtocols() {
  return Object.values(PROVIDER_PROTOCOLS).map((p) => ({
    id: p.id,
    label: p.label,
    summary: p.summary,
    categories: p.categories || [],
    capabilities: p.categories || [],
    runtimeProtocol: p.runtimeProtocol || p.id,
    runnable: RUNNABLE_PROVIDER_PROTOCOL_IDS.has(p.runtimeProtocol || p.id),
  }))
}

export function listModelProtocols() {
  return Object.values(PROTOCOLS).filter((p) => !INTERNAL_MODEL_PROTOCOL_IDS.has(p.id)).map((p) => ({
    id: p.id,
    label: p.label,
    summary: p.summary,
    categories: p.categories || [],
    capabilities: Object.keys(p.capabilities),
    runtimeProtocol: p.runtimeProtocol || p.id,
    runnable: BUILTIN_MODEL_PROTOCOL_IDS.has(p.id)
      ? RUNNABLE_MODEL_PROTOCOL_IDS.has(p.id)
      : RUNNABLE_MODEL_PROTOCOL_IDS.has(p.runtimeProtocol || p.id),
  }))
}

export function listProtocolDetails() {
  return listModelProtocolDetails()
}

export function listProviderProtocolDetails() {
  return Object.values(PROVIDER_PROTOCOLS).map((p) => ({
    ...p,
    scope: 'provider' as const,
    builtin: BUILTIN_PROVIDER_PROTOCOL_IDS.has(p.id),
    origin: BUILTIN_PROVIDER_PROTOCOL_IDS.has(p.id) ? 'builtin' : remoteProviderIds.has(p.id) ? 'remote' : 'custom',
  }))
}

export function listModelProtocolDetails() {
  return Object.values(PROTOCOLS).filter((p) => !INTERNAL_MODEL_PROTOCOL_IDS.has(p.id)).map((p) => ({
    ...p,
    scope: 'model' as const,
    runtimeProtocol: p.runtimeProtocol || p.id,
    builtin: BUILTIN_MODEL_PROTOCOL_IDS.has(p.id),
    origin: BUILTIN_MODEL_PROTOCOL_IDS.has(p.id) ? 'builtin' : remoteModelIds.has(p.id) ? 'remote' : 'custom',
  }))
}

export function normalizeProtocolId(id: string, fallback = 'openai'): string {
  const key = String(id || '').trim().toLowerCase()
  return PROTOCOLS[key] || MODEL_PROTOCOL_ALIASES[key] || PROVIDER_PROTOCOLS[key] ? key : fallback
}

/**
 * 站点配置必须保存平台协议 ID，而不是其底层运行时协议 ID。
 * 同时兼容早期版本保存的 agtoken-video / zkki-model 等运行时 ID。
 */
export function normalizeProviderProtocolId(id: string, fallback = 'openai'): string {
  const key = String(id || '').trim().toLowerCase()
  if (PROVIDER_PROTOCOLS[key]) return key
  const provider = Object.values(PROVIDER_PROTOCOLS).find((item) => (item.runtimeProtocol || item.id) === key)
  return provider?.id || fallback
}

export function normalizeProtocol(id: string, fallback = 'openai'): string {
  const key = String(id || '').trim().toLowerCase()
  if (PROTOCOLS[key]) return PROTOCOLS[key].runtimeProtocol || key
  if (MODEL_PROTOCOL_ALIASES[key]) return MODEL_PROTOCOL_ALIASES[key].runtimeProtocol
  if (PROVIDER_PROTOCOLS[key]) return PROVIDER_PROTOCOLS[key].runtimeProtocol
  return fallback
}

function assertRunnableProtocol(id: string, surface: string) {
  const key = String(id || '').trim().toLowerCase()
  if (key && key !== 'midjourney' && !PROTOCOLS[normalizeProtocol(key, '')]) {
    throw new Error(`${surface} 协议「${key}」还在待适配，暂时不能直接调用。`)
  }
}

// ── URL 拼接（去掉重复的 /v1 前缀）─────────────────────────────────────
export function joinUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint
  let base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('缺少 base_url')
  let ep = '/' + String(endpoint || '').replace(/^\/+/, '')
  for (const prefix of ['/api/v3', '/v1', '/v2', '/v1beta']) {
    if (base.endsWith(prefix) && ep.startsWith(prefix + '/')) {
      ep = ep.slice(prefix.length)
      break
    }
  }
  return base + ep
}

// ── 鉴权头 ────────────────────────────────────────────────────────────
export function buildAuthHeaders(def: ProtocolDef, apiKey: string): Record<string, string> {
  const key = String(apiKey || '').trim()
  if (!key || def.auth.type === 'none') return {}
  const { type, header, prefix } = def.auth
  if (type === 'api_key_header') return { [header || 'x-api-key']: key }
  if (type === 'google_api_key') return { [header || 'x-goog-api-key']: key }
  return { [header || 'Authorization']: `${prefix ?? 'Bearer '}${key}` }
}

// ── 请求体构造 ────────────────────────────────────────────────────────
export interface ChatInput {
  messages?: { role: string; content: string }[]
  prompt?: string
  system?: string
}

function messagesFrom(input: ChatInput): { role: string; content: string }[] {
  if (Array.isArray(input.messages) && input.messages.length) return input.messages
  return [{ role: 'user', content: String(input.prompt || 'ping') }]
}

function buildBody(kind: BodyKind, model: string, input: ChatInput, params: Record<string, unknown>): unknown {
  if (kind === 'openai_chat') {
    const messages = messagesFrom(input)
    const hasSystemMessage = messages.some((message) => message.role === 'system')
    return {
      model,
      messages: input.system && !hasSystemMessage
        ? [{ role: 'system', content: input.system }, ...messages]
        : messages,
      stream: false,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.max_tokens !== undefined ? { max_tokens: params.max_tokens } : {}),
    }
  }
  if (kind === 'anthropic_messages') {
    const msgs = messagesFrom(input).filter((m) => m.role !== 'system')
    const system = input.system || messagesFrom(input).find((m) => m.role === 'system')?.content
    return {
      model,
      max_tokens: (params.max_tokens as number) || 1024,
      messages: msgs.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      ...(system ? { system } : {}),
    }
  }
  // gemini_content
  const parts = messagesFrom(input).map((m) => ({ text: m.content }))
  return { contents: [{ parts }] }
}

// ── 响应解析 ──────────────────────────────────────────────────────────
function unwrapProviderPayload(def: ProtocolDef, payload: any): any {
  if (!def.unwrapData) return payload
  if (payload && typeof payload === 'object' && 'data' in payload && !('choices' in payload) && !('candidates' in payload)) {
    return payload.data
  }
  return payload
}

function parseBody(kind: ParseKind, payload: any): { text: string; usage?: unknown } {
  if (kind === 'openai_chat') {
    const c = payload?.choices?.[0]
    return { text: c?.message?.content || c?.text || '', usage: payload?.usage }
  }
  if (kind === 'anthropic_text') {
    const blocks = payload?.content || []
    const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
    return { text, usage: payload?.usage }
  }
  // gemini_text
  const cands = payload?.candidates || []
  const text = cands
    .flatMap((c: any) => c?.content?.parts || [])
    .filter((p: any) => p?.text)
    .map((p: any) => p.text)
    .join('\n')
  return { text, usage: payload?.usageMetadata }
}

// ── 模型列表解析 ──────────────────────────────────────────────────────
export function parseModels(kind: ModelsKind, payload: any): string[] {
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    payload = payload.data
  }
  if (kind === 'gemini') {
    return (payload?.models || [])
      .map((m: any) => String(m?.name || '').replace(/^models\//, ''))
      .filter(Boolean)
  }
  const items = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload?.list)
        ? payload.list
        : []
  // openai / anthropic 通常是 data[].id；一些中转站会用 name/model 或直接返回字符串数组。
  return items
    .map((m: any) => typeof m === 'string' ? m : String(m?.id || m?.name || m?.model || ''))
    .filter(Boolean)
}

// ── 统一提供者对象 ────────────────────────────────────────────────────
export interface ResolvedProvider {
  base_url: string
  api_key: string
  wallet_api_key?: string
  protocol: string
}

export function protocolIds(): string[] {
  return Object.keys(PROVIDER_PROTOCOLS)
}

export interface BuiltRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  parse: ParseKind
}

export function buildChatRequest(
  provider: ResolvedProvider,
  model: string,
  input: ChatInput,
  params: Record<string, unknown> = {},
  capability = 'llm',
): BuiltRequest {
  const proto = normalizeProtocol(provider.protocol)
  const def = PROTOCOLS[proto]
  if (!def) throw new Error(`协议 ${proto || provider.protocol} 不支持对话调用`)
  const cap = def.capabilities[capability]
  if (!cap) throw new Error(`协议 ${proto} 不支持能力 ${capability}`)
  const endpoint = cap.endpoint.replace('{model}', encodeURIComponent(model))
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  return {
    url: joinUrl(provider.base_url, endpoint),
    method: cap.method || 'POST',
    headers,
    body: buildBody(cap.body, model, input, params),
    parse: cap.parse,
  }
}

/** 真正发起一次对话调用，返回 { text, latencyMs, raw }。 */
export async function callChat(
  provider: ResolvedProvider,
  model: string,
  input: ChatInput,
  params: Record<string, unknown> = {},
  timeoutMs = 90000,
): Promise<{ text: string; usage?: unknown; latencyMs: number; raw: unknown }> {
  const proto = normalizeProtocol(provider.protocol)
  if (proto === 'cli:codex' || proto === 'cli:gemini') {
    const prompt = [input.system ? `系统要求：\n${input.system}` : '', ...messagesFrom(input).map((message) => `${message.role === 'assistant' ? '助手' : '用户'}：\n${message.content}`), '请直接回答用户，输出纯文本，不要修改项目文件。'].filter(Boolean).join('\n\n')
    return runAgentCliChat(proto === 'cli:codex' ? 'codex' : 'gemini', prompt, model, Math.max(timeoutMs, 900_000))
  }
  if (proto === 'runninghub') return callRunningHubChat(provider, model, input, params, timeoutMs)
  const def = PROTOCOLS[proto]
  const req = buildChatRequest(provider, model, input, params)
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // ── openai 兼容：强制流式 + 累积（修复非流式空 content 的中转站/推理模型）──
    if (def.stream) {
      const body = { ...(req.body as Record<string, unknown>), stream: true }
      const resp = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      const raw = await resp.text()
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${raw.slice(0, 500)}`)
      let text = ''
      let usage: unknown
      for (const line of raw.split('\n')) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const data = s.slice(5).trim()
        if (data === '[DONE]') break
        try {
          const j = JSON.parse(data)
          const delta = j?.choices?.[0]?.delta
          if (typeof delta?.content === 'string') text += delta.content
          if (j?.usage) usage = j.usage
        } catch {
          /* 跳过非 JSON 的 SSE 行 */
        }
      }
      return { text: text.trim(), usage, latencyMs: Date.now() - started, raw: { streamed: true } }
    }

    // ── 非流式（anthropic / gemini）──
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctrl.signal,
    })
    const t = await resp.text()
    let payload: unknown
    try {
      payload = JSON.parse(t)
    } catch {
      payload = t
    }
    if (!resp.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload)
      throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 500)}`)
    }
    const parsed = parseBody(req.parse, unwrapProviderPayload(def, payload))
    return { ...parsed, latencyMs: Date.now() - started, raw: payload }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 流式对话：逐块回调 onDelta(增量文本)。
 * openai 协议走真流式；anthropic/gemini 先整段拿到再一次性回调。
 */
export async function streamChat(
  provider: ResolvedProvider,
  model: string,
  input: ChatInput,
  params: Record<string, unknown>,
  onDelta: (text: string) => void,
  timeoutMs = 120000,
): Promise<{ usage?: unknown }> {
  const proto = normalizeProtocol(provider.protocol)
  const def = PROTOCOLS[proto]
  const req = buildChatRequest(provider, model, input, params)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    if (!def.stream) {
      const r = await callChat(provider, model, input, params, timeoutMs)
      if (r.text) onDelta(r.text)
      return { usage: r.usage }
    }
    const body = { ...(req.body as Record<string, unknown>), stream: true }
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => '')
      throw new Error(`HTTP ${resp.status}: ${t.slice(0, 400)}`)
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let usage: unknown
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const j = JSON.parse(data)
          const d = j?.choices?.[0]?.delta
          if (typeof d?.content === 'string' && d.content) onDelta(d.content)
          if (j?.usage) usage = j.usage
        } catch {
          /* 跳过非 JSON 行 */
        }
      }
    }
    return { usage }
  } finally {
    clearTimeout(timer)
  }
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}
export interface ToolMessage {
  role: string
  content?: string | null
  tool_calls?: unknown
  tool_call_id?: string
  name?: string
}

/**
 * 带工具（native function-calling）的一步对话。openai 兼容，强制流式并累积
 * content 与 tool_calls。返回 { content, toolCalls }。
 */
export async function chatWithTools(
  provider: ResolvedProvider,
  model: string,
  messages: ToolMessage[],
  system: string,
  tools: unknown[],
  timeoutMs = 300000,
  onDelta?: (text: string) => void,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const proto = normalizeProtocol(provider.protocol)
  const def = PROTOCOLS[proto]
  const llmCapability = def?.capabilities?.llm
  if (!def || !llmCapability) throw new Error(`协议 ${proto || provider.protocol} 不支持带工具的对话调用`)
  const url = joinUrl(provider.base_url, llmCapability.endpoint)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  const body = {
    model,
    stream: true,
    tools,
    tool_choice: 'auto',
    messages: [{ role: 'system', content: system }, ...messages],
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => '')
      throw new Error(`HTTP ${resp.status}: ${t.slice(0, 400)}`)
    }
    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let content = ''
    const toolMap = new Map<number, { id?: string; name?: string; arguments: string }>()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const j = JSON.parse(data)
          const d = j?.choices?.[0]?.delta
          if (typeof d?.content === 'string') {
            content += d.content
            if (d.content) onDelta?.(d.content)
          }
          if (Array.isArray(d?.tool_calls)) {
            for (const tc of d.tool_calls) {
              const idx = tc.index ?? 0
              const cur = toolMap.get(idx) || { arguments: '' }
              if (tc.id) cur.id = tc.id
              if (tc.function?.name) cur.name = tc.function.name
              if (tc.function?.arguments) cur.arguments += tc.function.arguments
              toolMap.set(idx, cur)
            }
          }
        } catch {
          /* skip */
        }
      }
    }
    const toolCalls: ToolCall[] = [...toolMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, c]) => ({ id: c.id || `call_${idx}`, name: c.name || '', arguments: c.arguments || '{}' }))
      .filter((c) => c.name)
    return { content, toolCalls }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('模型响应超时，请重试，或把要求写得更具体、篇幅更短。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ── 图像生成（OpenAI 兼容 /v1/images/generations）─────────────────────
// 现阶段只支持 openai 兼容协议（绝大多数中转站的图像接口都是这个形状）。
// 返回统一的 { images: {type,value}[] }：type='url' 时 value 是图片地址，
// type='b64' 时 value 是 base64（不含 data: 前缀）。
export interface GenImage {
  type: 'url' | 'b64'
  value: string
}
export interface GenImageParams {
  prompt: string
  size?: string
  quality?: string
  n?: number
  response_format?: string
  aspectRatio?: string
  imageSize?: string
  aspect_ratio?: string
  resolution?: string
  loras?: Record<string, number>
  modelscope_lora?: string
  modelscope_lora_strength?: number
}

export type MidjourneySpeed = 'relax' | 'fast' | 'turbo'

export interface MidjourneyReferenceInput {
  url?: string
  buf?: Buffer
  mime?: string
  name?: string
}

export interface MidjourneySubmitParams {
  prompt: string
  size?: string
  version?: string
  speed?: MidjourneySpeed
  mode?: 'imagine' | 'blend' | 'edit'
  reference_images?: MidjourneyReferenceInput[]
}

export type MidjourneyAction = 'upscale' | 'variation' | 'low_variation' | 'high_variation' | 'reroll' | 'zoom' | 'pan' | 'inpaint' | 'remix_subtle' | 'remix_strong'

export interface MidjourneyActionParams {
  task_id: string
  action: MidjourneyAction
  index?: number
  speed?: MidjourneySpeed
  direction?: 'left' | 'right' | 'up' | 'down' | ''
  zoom_ratio?: number
  custom_id?: string
  prompt?: string
}

export interface MidjourneyModalParams {
  task_id: string
  prompt?: string
  speed?: MidjourneySpeed
  mask_image?: MidjourneyReferenceInput
}

export type VideoReferenceKind = 'image' | 'video' | 'audio'

/** 视频生成所需的参考媒体。role 用于首帧、尾帧和参考素材等语义。 */
export interface GenVideoReference extends EditImageInput {
  kind: VideoReferenceKind
  role?: string
}

export interface GenVideoParams {
  prompt: string
  duration?: number
  size?: string
  aspect_ratio?: string
  resolution?: string
  images?: GenVideoReference[]
  videos?: GenVideoReference[]
  audios?: GenVideoReference[]
  enhance_prompt?: boolean
  enable_upsample?: boolean
  watermark?: boolean
  seed?: number
  camerafixed?: boolean
  return_last_frame?: boolean
  generate_audio?: boolean
  multimodal?: boolean
  trusted_asset?: boolean
}

export interface SpeechParams {
  input: string
  voice?: string
  response_format?: string
  speed?: number
}

export interface AudioTranscriptionParams {
  language?: string
  prompt?: string
  response_format?: string
  temperature?: number
  translate?: boolean
}

export interface MusicParams {
  prompt: string
  title?: string
  lyrics?: string
  style?: string
  instrumental?: boolean
}

/** 待编辑/参考图，供 editImages 组装 multipart。 */
export interface EditImageInput {
  buf: Buffer
  mime: string
  name: string
  /** Optional pre-published transport metadata supplied by the canvas. */
  publicUrl?: string
  remoteName?: string
}

// 从 OpenAI 图像响应里提取 url / b64_json。部分聚合站的异步查询会把
// 标准响应包在 data.data / result / output 内，因此按已知容器递归解析。
function parseImagePayload(payload: any): GenImage[] {
  const images: GenImage[] = []
  const seenObjects = new Set<object>()
  const seenImages = new Set<string>()

  const pushString = (value: unknown, typeHint?: 'url' | 'b64') => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) return
    let type = typeHint
    let normalized = text
    if (text.startsWith('data:image/')) {
      const comma = text.indexOf(',')
      if (comma < 0) return
      type = 'b64'
      normalized = text.slice(comma + 1)
    } else if (!type) {
      if (/^https?:\/\//i.test(text)) type = 'url'
      else if (text.length >= 128 && /^[A-Za-z0-9+/=_-]+$/.test(text)) type = 'b64'
    }
    if (!type || !normalized || seenImages.has(`${type}:${normalized}`)) return
    seenImages.add(`${type}:${normalized}`)
    images.push({ type, value: normalized })
  }

  const visit = (value: any, depth: number, typeHint?: 'url' | 'b64') => {
    if (depth > 7 || value == null) return
    if (typeof value === 'string') {
      pushString(value, typeHint)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1, typeHint)
      return
    }
    if (typeof value !== 'object' || seenObjects.has(value)) return
    seenObjects.add(value)

    visit(value.url, depth + 1, 'url')
    visit(value.b64_json, depth + 1, 'b64')
    visit(value.b64, depth + 1, 'b64')
    visit(value.image_base64, depth + 1, 'b64')
    if (typeof value.image === 'string') pushString(value.image)
    if (typeof value.image_url === 'string') pushString(value.image_url, 'url')
    else if (value.image_url?.url) visit(value.image_url.url, depth + 1, 'url')

    for (const key of ['data', 'images', 'image', 'result', 'output', 'response']) {
      const nested = value[key]
      if (nested !== value) visit(nested, depth + 1)
    }
  }

  visit(payload, 0)
  return images
}

function isGptBestAsyncImageProvider(provider: ResolvedProvider) {
  try {
    const host = new URL(provider.base_url).hostname.toLowerCase()
    return host === 'fhl.mom' || host.endsWith('.fhl.mom') || host === 'gpt-best.apifox.cn'
  } catch { return false }
}

function isApibOpenAiImageProvider(provider: ResolvedProvider) {
  try {
    const host = new URL(provider.base_url).hostname.toLowerCase()
    return host === 'apib.ai' || host.endsWith('.apib.ai')
  } catch { return false }
}

const APIB_IMAGE_ASPECT_RATIOS = ['16:9', '1:1', '21:9', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16'] as const

/** apib.ai 的 images/generations 把 `size` 定义为比例，而不是 OpenAI 的像素尺寸。 */
function apibImageAspectRatio(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase().replace('*', 'x')
  if (!raw || raw === 'auto' || raw === 'adaptive') return 'auto'
  if ((APIB_IMAGE_ASPECT_RATIOS as readonly string[]).includes(raw)) return raw
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(?:x|:)\s*(\d+(?:\.\d+)?)$/)
  if (!match) return raw
  const width = Number(match[1])
  const height = Number(match[2])
  if (!(width > 0) || !(height > 0)) return raw
  const requested = width / height
  return APIB_IMAGE_ASPECT_RATIOS.reduce((best, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.split(':').map(Number)
    const [bestWidth, bestHeight] = best.split(':').map(Number)
    const candidateDistance = Math.abs(Math.log(requested / (candidateWidth / candidateHeight)))
    const bestDistance = Math.abs(Math.log(requested / (bestWidth / bestHeight)))
    return candidateDistance < bestDistance ? candidate : best
  })
}

function apibImageResolution(value: unknown, explicit?: unknown): '1k' | '2k' | '4k' {
  const requested = String(explicit || '').trim().toLowerCase()
  if (requested === '1k' || requested === '2k' || requested === '4k') return requested
  const match = String(value || '').trim().toLowerCase().match(/^(\d+)\s*x\s*(\d+)$/)
  if (!match) return '1k'
  const width = Number(match[1])
  const height = Number(match[2])
  const longEdge = Math.max(width, height)
  const pixels = width * height
  return longEdge >= 3000 || pixels > 4_500_000 ? '4k' : longEdge >= 1800 || pixels > 1_800_000 ? '2k' : '1k'
}

function imageTaskErrorDetail(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value.trim() || fallback
  if (value == null) return fallback
  try {
    const serialized = JSON.stringify(value)
    return serialized && serialized !== '{}' ? serialized : fallback
  } catch {
    return fallback
  }
}

function openAiImageQuality(provider: ResolvedProvider, model: string, quality: unknown): string {
  const value = String(quality || '').trim().toLowerCase()
  if (!value || value === 'auto') return ''
  const modernQuality = isApibOpenAiImageProvider(provider) || /^gpt-image(?:-|$)/i.test(String(model || '').trim())
  if (modernQuality && (value === 'hd' || value === 'ultra')) return 'high'
  if (modernQuality && value === 'standard') return 'medium'
  return value
}

function imageTaskId(payload: any): string {
  const queue = [payload]
  const seen = new Set<object>()
  for (let depth = 0; depth < 6 && queue.length; depth += 1) {
    const level = queue.splice(0)
    for (const value of level) {
      if (!value || typeof value !== 'object' || seen.has(value)) continue
      seen.add(value)
      const found = [value.task_id, value.taskId, value.id]
        .map((item) => String(item || '').trim()).find(Boolean)
      if (found) return found
      for (const key of ['data', 'result', 'output', 'response']) {
        const nested = value[key]
        if (Array.isArray(nested)) queue.push(...nested)
        else if (nested && typeof nested === 'object') queue.push(nested)
      }
    }
  }
  return ''
}

function imageTaskStatus(payload: any): string {
  const queue = [payload]
  const seen = new Set<object>()
  while (queue.length) {
    const value = queue.shift()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    const status = String(value.status || value.task_status || value.taskStatus || '').trim().toUpperCase()
    if (status) return status
    const data = value.data
    if (Array.isArray(data)) queue.push(...data)
    else if (data && typeof data === 'object') queue.push(data)
  }
  return ''
}

async function pollGptBestImageTask(
  provider: ResolvedProvider,
  taskId: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ images: GenImage[]; raw: unknown }> {
  const deadline = Date.now() + Math.max(timeoutMs, 14 * 60_000)
  let lastPayload: any = null
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const taskPath = isGptBestAsyncImageProvider(provider)
      ? `/v1/images/tasks/${encodeURIComponent(taskId)}`
      : `/v1/tasks/${encodeURIComponent(taskId)}`
    const response = await fetch(joinUrl(provider.base_url, taskPath), {
      headers,
      signal: AbortSignal.timeout(45_000),
    })
    const text = await response.text()
    try { lastPayload = JSON.parse(text) } catch { lastPayload = text }
    if (!response.ok) throw new Error(`图片任务查询失败 HTTP ${response.status}: ${text.slice(0, 500)}`)
    const images = parseImagePayload(lastPayload)
    if (images.length) return { images, raw: lastPayload }
    const status = imageTaskStatus(lastPayload)
    if (['FAILURE', 'FAILED', 'ERROR', 'CANCELED', 'CANCELLED', 'REJECTED'].includes(status)) {
      const node = lastPayload?.data && typeof lastPayload.data === 'object' ? lastPayload.data : lastPayload
      const fallback = `图片任务失败（${taskId}）`
      throw new Error(imageTaskErrorDetail(node?.fail_reason || node?.error || node?.message, fallback))
    }
  }
  throw new Error(`GPT-Best 图片任务仍在处理中（task_id=${taskId}），请稍后重试。`)
}

async function requestZkkiImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  inputs: EditImageInput[],
  timeoutMs: number,
): Promise<{ images: GenImage[]; raw: unknown }> {
  const prompt = String(params.prompt || '').trim()
  if (!prompt) throw new Error('缺少 ZKKI 图片生成提示词')
  const references = inputs.slice(0, 9).map((input) => String(input.publicUrl || mediaDataUrl(input)))
  const requestedSize = String(params.size || '2K')
  const size = ['auto', '1K', '1.5K', '2K'].includes(requestedSize) ? requestedSize : '2K'
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: Math.max(1, Math.min(128, Number(params.n) || 1)),
    size,
    response_format: String(params.response_format || 'url'),
  }
  const aspectRatio = String(params.aspect_ratio || params.aspectRatio || '').trim()
  if (aspectRatio) body.aspect_ratio = aspectRatio
  if (params.quality && params.quality !== 'auto') body.quality = params.quality
  if (references.length) body.image = references
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await fetch(joinUrl(provider.base_url, '/v1/images/generations'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...buildAuthHeaders(PROTOCOLS['zkki-model'], provider.api_key) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await response.text()
    let payload: any
    try { payload = JSON.parse(text) } catch { payload = text }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
    const images = parseImagePayload(payload)
    if (!images.length) throw new Error('ZKKI 图片接口成功，但没有返回图片')
    return { images, raw: payload }
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('ZKKI 图片生成超时，请重试。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function requestGrok2ApiImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  inputs: EditImageInput[],
  timeoutMs: number,
): Promise<{ images: GenImage[]; raw: unknown }> {
  if (inputs.length === 0 && !String(params.prompt || '').trim()) throw new Error('缺少图片生成提示词')
  const def = PROTOCOLS.grok2api
  const endpoint = inputs.length ? '/v1/images/edits' : '/v1/images/generations'
  const fallback = apimartImageConfig(params.size)
  const body: Record<string, unknown> = {
    model,
    prompt: String(params.prompt || '').trim(),
    n: Math.max(1, Math.min(4, Number(params.n) || 1)),
    // grok2api 会先把图片归档，再用它配置的 PublicBaseURL 返回媒体地址。
    // 该地址在 Docker / 反向代理部署中经常是容器地址或 127.0.0.1，
    // 因此 DX OS 内部调用固定接收 Base64，避免“后台已生成但取不到结果”。
    response_format: 'b64_json',
  }
  const aspectRatio = String(params.aspect_ratio || params.aspectRatio || fallback.aspectRatio || '').trim()
  const resolution = String(params.resolution || params.imageSize || '').trim().toLowerCase()
  if (aspectRatio) body.aspect_ratio = aspectRatio
  if (resolution === '1k' || resolution === '2k') body.resolution = resolution
  if (params.quality && params.quality !== 'auto') body.quality = params.quality
  if (inputs.length) {
    const images = inputs.map((input) => ({ url: String(input.publicUrl || mediaDataUrl(input)) }))
    if (images.length === 1) body.image = images[0]
    else body.images = images
  }
  const ctrl = new AbortController()
  const effectiveTimeoutMs = Math.max(timeoutMs, 15 * 60_000)
  const timer = setTimeout(() => ctrl.abort(), effectiveTimeoutMs)
  try {
    const resp = await fetch(joinUrl(provider.base_url, endpoint), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...def.headers, ...buildAuthHeaders(def, provider.api_key) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await resp.text()
    let raw: any
    try { raw = JSON.parse(text) } catch { raw = text }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`)
    const images = parseImagePayload(raw).map((image) => {
      if (image.type !== 'url') return image
      try {
        const returned = new URL(image.value)
        const configured = new URL(provider.base_url)
        const marker = '/v1/media/images/'
        const markerAt = returned.pathname.indexOf(marker)
        if (markerAt < 0 || returned.origin === configured.origin) return image
        const configuredPath = configured.pathname.replace(/\/+$/, '')
        const prefix = configuredPath.endsWith('/v1') ? configuredPath.slice(0, -3) : configuredPath
        return { type: 'url' as const, value: `${configured.origin}${prefix}${returned.pathname.slice(markerAt)}${returned.search}` }
      } catch { return image }
    })
    if (!images.length) throw new Error(`Grok2API 图片接口成功，但响应中没有 data[].url 或 data[].b64_json：${text.slice(0, 500)}`)
    return { images, raw }
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error(`Grok2API 图片${inputs.length ? '编辑' : '生成'}超时`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function usesGenerationEndpointForImageEdit(model: string) {
  const value = String(model || '').trim().toLowerCase()
  return /(?:^|[-_.])(gemini(?:[-_.].*)?image|nano[-_.]?banana)(?:$|[-_.])/.test(value)
    || (/^gemini[-_.]/.test(value) && /image/.test(value))
}

const APIB_EDIT_MULTIPART_BUDGET = 620_000

async function prepareApibEditInputs(inputs: EditImageInput[]): Promise<EditImageInput[]> {
  if (!inputs.length) return inputs
  const perImageBudget = Math.max(72_000, Math.floor(APIB_EDIT_MULTIPART_BUDGET / inputs.length))
  if (inputs.reduce((sum, input) => sum + input.buf.length, 0) <= APIB_EDIT_MULTIPART_BUDGET) return inputs
  return Promise.all(inputs.map(async (input, index) => {
    if (input.buf.length <= perImageBudget) return input
    const source = sharp(input.buf, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' })
    for (const quality of [86, 74, 62, 50, 40]) {
      const data = await source.clone().jpeg({ quality, mozjpeg: true }).toBuffer()
      if (data.length <= perImageBudget) {
        return { ...input, buf: data, mime: 'image/jpeg', name: `reference-${index + 1}.jpg` }
      }
    }
    for (const edge of [2048, 1536, 1280, 1024, 768]) {
      const data = await source.clone().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 68, mozjpeg: true }).toBuffer()
      if (data.length <= perImageBudget || edge === 768) {
        return { ...input, buf: data, mime: 'image/jpeg', name: `reference-${index + 1}.jpg` }
      }
    }
    return input
  }))
}

async function editOpenAiCompatibleGenerationImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  inputs: EditImageInput[],
  timeoutMs: number,
): Promise<{ images: GenImage[]; raw: unknown }> {
  const useApibOpenAiCompatibility = isApibOpenAiImageProvider(provider)
  const outboundInputs = useApibOpenAiCompatibility ? await prepareApibEditInputs(inputs.slice(0, 9)) : inputs.slice(0, 9)
  const references = outboundInputs.map((input) => String(input.publicUrl || mediaDataUrl(input)))
  const body: Record<string, unknown> = {
    model,
    prompt: String(params.prompt || '').trim(),
    n: Math.max(1, Math.min(4, Number(params.n) || 1)),
  }
  if (useApibOpenAiCompatibility) {
    body.size = apibImageAspectRatio(params.size)
    body.resolution = apibImageResolution(params.size, params.resolution || params.imageSize)
    body.official_fallback = false
    body.image_urls = references
  } else {
    body.image = references
    if (params.size && params.size !== 'auto') body.size = params.size
  }
  const aspectRatio = String(params.aspect_ratio || params.aspectRatio || '').trim()
  if (aspectRatio) body.aspect_ratio = aspectRatio
  const quality = openAiImageQuality(provider, model, params.quality)
  if (quality) body.quality = quality
  if (params.response_format) body.response_format = params.response_format
  const useAsync = isGptBestAsyncImageProvider(provider)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...buildAuthHeaders(PROTOCOLS.openai, provider.api_key),
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await fetch(joinUrl(provider.base_url, `/v1/images/generations${useAsync ? '?async=true' : ''}`), {
      method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
    })
    const text = await response.text()
    let payload: any
    try { payload = JSON.parse(text) } catch { payload = text }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
    const images = parseImagePayload(payload)
    if (images.length) return { images, raw: payload }
    const taskId = imageTaskId(payload)
    if (taskId) return pollGptBestImageTask(provider, taskId, headers, timeoutMs)
    throw new Error(`图像接口调用成功，但响应中没有图片：${text.slice(0, 500)}`)
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('兼容图片编辑请求超时，请重试。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const MIDJOURNEY_API_ROOT = 'https://api.apimart.ai'
const MIDJOURNEY_SPEEDS: MidjourneySpeed[] = ['relax', 'fast', 'turbo']
const MIDJOURNEY_SUCCESS_STATUSES = new Set(['SUCCEEDED', 'SUCCESS', 'COMPLETED', 'DONE', 'FINISHED'])
const MIDJOURNEY_FAILED_STATUSES = new Set(['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED', 'TIMEOUT', 'REJECTED'])
const MIDJOURNEY_ACTION_PATHS: Record<MidjourneyAction, string> = {
  upscale: '/v1/midjourney/generations/upscale',
  variation: '/v1/midjourney/generations/variation',
  low_variation: '/v1/midjourney/generations/low-variation',
  high_variation: '/v1/midjourney/generations/high-variation',
  reroll: '/v1/midjourney/generations/reroll',
  zoom: '/v1/midjourney/generations/zoom',
  pan: '/v1/midjourney/generations/pan',
  inpaint: '/v1/midjourney/generations/inpaint',
  remix_subtle: '/v1/midjourney/generations/remix-subtle',
  remix_strong: '/v1/midjourney/generations/remix-strong',
}

function isMidjourneyProvider(provider: ResolvedProvider) {
  const protocol = String(provider.protocol || '').trim().toLowerCase()
  return protocol === 'midjourney' || normalizeProtocol(protocol) === 'apimart'
}

function midjourneyResponseData(raw: any) {
  if (!raw || typeof raw !== 'object') return {}
  const data = raw.data
  if (data && typeof data === 'object') return data
  if (Array.isArray(data)) return data.find((item) => item && typeof item === 'object') || raw
  return raw
}

function midjourneyTaskId(raw: any): string {
  const data = midjourneyResponseData(raw)
  for (const key of ['task_id', 'taskId', 'id']) {
    const value = String(data?.[key] || '').trim()
    if (value) return value
  }
  return ''
}

function midjourneyTaskStatus(raw: any): string {
  const data = midjourneyResponseData(raw)
  return String(data?.status || data?.task_status || data?.taskStatus || raw?.status || '').trim().toUpperCase()
}

function midjourneyErrorDetail(raw: any, fallback = 'Midjourney 请求失败'): string {
  const data = midjourneyResponseData(raw)
  const error = data?.error && typeof data.error === 'object' ? data.error : {}
  return String(
    error?.message
      || data?.message
      || data?.fail_reason
      || raw?.message
      || fallback,
  )
}

function midjourneyRemoteImages(raw: any): string[] {
  const data = midjourneyResponseData(raw)
  const values = Array.isArray(data?.image_urls) ? data.image_urls
    : Array.isArray(data?.imageUrls) ? data.imageUrls
      : []
  const urls: string[] = values.map((value: any) => String(value || '').trim()).filter(Boolean)
  if (urls.length) return [...new Set<string>(urls)]
  const resultImages = Array.isArray(data?.result?.images) ? data.result.images : []
  for (const item of resultImages) {
    const value = String(item?.url || item || '').trim()
    if (value) urls.push(value)
  }
  if (urls.length) return [...new Set<string>(urls)]
  for (const key of ['image_url', 'imageUrl', 'grid_image_url', 'gridImageUrl']) {
    const value = String(data?.[key] || '').trim()
    if (value) urls.push(value)
  }
  return [...new Set<string>(urls)]
}

function midjourneyAspectRatio(size = ''): string {
  const raw = String(size || '').trim().toLowerCase().replace('*', 'x')
  if (/^\d{1,2}:\d{1,2}$/.test(raw)) return raw
  const match = raw.match(/^(\d{2,5})x(\d{2,5})$/)
  if (!match) return '1:1'
  let width = Number(match[1])
  let height = Number(match[2])
  if (!width || !height) return '1:1'
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a))
  const d = gcd(width, height) || 1
  width = Math.round(width / d)
  height = Math.round(height / d)
  return `${width}:${height}`
}

function midjourneyVersion(model: string): string {
  const raw = String(model || '').trim()
  if (!raw) return '6.1'
  const match = raw.match(/(\d+(?:\.\d+)?)/)
  if (match) return match[1]
  if (/^(mj|midjourney)([-_\s]|$)/i.test(raw)) return '6.1'
  return raw.slice(0, 24)
}

async function midjourneyReferenceUrls(referenceImages: MidjourneyReferenceInput[] = []): Promise<string[]> {
  const urls: string[] = []
  for (const ref of referenceImages.slice(0, 4)) {
    const direct = String(ref?.url || '').trim()
    if (direct.startsWith('http://') || direct.startsWith('https://') || direct.startsWith('data:image/')) {
      urls.push(direct)
      continue
    }
    if (ref?.buf && ref?.mime) {
      urls.push(`data:${ref.mime};base64,${ref.buf.toString('base64')}`)
    }
  }
  return [...new Set(urls)]
}

async function callMidjourneyJson(
  provider: ResolvedProvider,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<any> {
  if (!isMidjourneyProvider(provider)) {
    throw new Error('Midjourney 目前仅支持 APIMart 协议站点。')
  }
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...buildAuthHeaders(PROTOCOLS.apimart, provider.api_key),
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(`${MIDJOURNEY_API_ROOT}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await resp.text()
    let raw: any
    try { raw = JSON.parse(text) } catch { raw = { message: text.slice(0, 500) } }
    if (!resp.ok) {
      throw new Error(midjourneyErrorDetail(raw, `Midjourney 接口错误（${resp.status}）`))
    }
    return raw
  } finally {
    clearTimeout(timer)
  }
}

async function midjourneyTask(provider: ResolvedProvider, taskId: string, timeoutMs: number): Promise<any> {
  if (!isMidjourneyProvider(provider)) {
    throw new Error('Midjourney 目前仅支持 APIMart 协议站点。')
  }
  const safeTaskId = String(taskId || '').trim()
  if (!safeTaskId) throw new Error('Midjourney 任务 ID 不合法。')
  const headers = {
    Accept: 'application/json',
    ...buildAuthHeaders(PROTOCOLS.apimart, provider.api_key),
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(`${MIDJOURNEY_API_ROOT}/v1/midjourney/${encodeURIComponent(safeTaskId)}`, {
      method: 'GET',
      headers,
      signal: ctrl.signal,
    })
    const text = await resp.text()
    let raw: any
    try { raw = JSON.parse(text) } catch { raw = { message: text.slice(0, 500) } }
    if (!resp.ok) {
      throw new Error(midjourneyErrorDetail(raw, `查询 Midjourney 任务失败（${resp.status}）`))
    }
    return raw
  } finally {
    clearTimeout(timer)
  }
}

export async function submitMidjourney(
  provider: ResolvedProvider,
  model: string,
  params: MidjourneySubmitParams,
  timeoutMs = 300000,
): Promise<{ taskId: string; status: string; raw: unknown }> {
  const prompt = String(params.prompt || '').trim()
  const mode = String(params.mode || 'imagine').trim().toLowerCase()
  if (mode !== 'blend' && !prompt) throw new Error('缺少 Midjourney 提示词')
  const speed = MIDJOURNEY_SPEEDS.includes(String(params.speed || 'relax').trim().toLowerCase() as MidjourneySpeed)
    ? String(params.speed || 'relax').trim().toLowerCase() as MidjourneySpeed
    : 'relax'
  const version = midjourneyVersion(params.version || model)
  const body: Record<string, unknown> = {
    size: midjourneyAspectRatio(params.size),
    speed,
    metadata: { source: 'ccs-os' },
  }
  if (prompt) body.prompt = prompt
  if (mode !== 'blend') body.version = version
  const refs = await midjourneyReferenceUrls(params.reference_images || [])
  if (refs.length) body.image_urls = refs
  if (mode === 'blend' && (refs.length < 2 || refs.length > 4)) throw new Error('Midjourney 多图融合需要 2 到 4 张图片。')
  if (mode === 'edit' && !refs.length) throw new Error('Midjourney 图片编辑需要至少一张参考图。')
  const path = mode === 'blend'
    ? '/v1/midjourney/generations/blend'
    : mode === 'edit'
      ? '/v1/midjourney/generations/edits'
      : '/v1/midjourney/generations'
  const raw = await callMidjourneyJson(provider, path, body, timeoutMs)
  const taskId = midjourneyTaskId(raw)
  if (!taskId) throw new Error(`Midjourney 未返回任务 ID：${JSON.stringify(raw).slice(0, 500)}`)
  return { taskId, status: midjourneyTaskStatus(raw) || 'queued', raw }
}

export async function getMidjourneyTask(
  provider: ResolvedProvider,
  taskId: string,
  timeoutMs = 300000,
): Promise<{ status: 'running' | 'succeeded' | 'failed'; taskId: string; images: GenImage[]; raw: unknown; message?: string; error?: string }> {
  const raw = await midjourneyTask(provider, taskId, timeoutMs)
  const status = midjourneyTaskStatus(raw)
  if (MIDJOURNEY_FAILED_STATUSES.has(status)) {
    return { status: 'failed', taskId, images: [], raw, error: midjourneyErrorDetail(raw) }
  }
  const urls = midjourneyRemoteImages(raw)
  if (MIDJOURNEY_SUCCESS_STATUSES.has(status) || urls.length) {
    return { status: 'succeeded', taskId, images: urls.map((value) => ({ type: 'url', value })), raw }
  }
  return { status: 'running', taskId, images: [], raw, message: 'Midjourney 任务仍在生成中' }
}

export async function submitMidjourneyAction(
  provider: ResolvedProvider,
  params: MidjourneyActionParams,
  timeoutMs = 300000,
): Promise<{ taskId: string; status: string; action: MidjourneyAction; raw: unknown }> {
  const action = String(params.action || '').trim().toLowerCase() as MidjourneyAction
  if (!MIDJOURNEY_ACTION_PATHS[action]) throw new Error('不支持的 Midjourney 操作。')
  const taskId = String(params.task_id || '').trim()
  if (!/^[A-Za-z0-9_.:-]{1,240}$/.test(taskId)) throw new Error('Midjourney 任务 ID 不合法。')
  const speed = MIDJOURNEY_SPEEDS.includes(String(params.speed || 'relax').trim().toLowerCase() as MidjourneySpeed)
    ? String(params.speed || 'relax').trim().toLowerCase() as MidjourneySpeed
    : 'relax'
  const body: Record<string, unknown> = { task_id: taskId, speed, metadata: { source: 'ccs-os' } }
  const customId = String(params.custom_id || '').trim()
  if (customId) body.custom_id = customId
  if (['upscale', 'variation', 'low_variation', 'high_variation', 'remix_subtle', 'remix_strong'].includes(action) && !customId) {
    const index = Number(params.index || 0)
    if (![1, 2, 3, 4].includes(index)) throw new Error('Midjourney 图片序号应为 1 到 4。')
    body.index = index
  } else if (['zoom', 'pan'].includes(action) && [1, 2, 3, 4].includes(Number(params.index || 0))) {
    body.index = Number(params.index)
  }
  if (action === 'zoom' && params.zoom_ratio !== undefined) {
    const zoomRatio = Number(params.zoom_ratio)
    if (zoomRatio <= 1 || zoomRatio > 4) throw new Error('Midjourney 缩放比例应大于 1 且不超过 4。')
    body.zoom_ratio = zoomRatio
  }
  if (action === 'pan' && !customId) {
    const direction = String(params.direction || '').trim().toLowerCase()
    if (!['left', 'right', 'up', 'down'].includes(direction)) throw new Error('Midjourney 平移方向仅支持 left、right、up 或 down。')
    body.direction = direction
  }
  if (['remix_subtle', 'remix_strong'].includes(action)) {
    const prompt = String(params.prompt || '').trim()
    if (prompt) body.prompt = prompt
  }
  const raw = await callMidjourneyJson(provider, MIDJOURNEY_ACTION_PATHS[action], body, timeoutMs)
  const newTaskId = midjourneyTaskId(raw)
  if (!newTaskId) throw new Error(`Midjourney 未返回任务 ID：${JSON.stringify(raw).slice(0, 500)}`)
  return { taskId: newTaskId, status: midjourneyTaskStatus(raw) || 'queued', action, raw }
}

export async function submitMidjourneyModal(
  provider: ResolvedProvider,
  params: MidjourneyModalParams,
  timeoutMs = 300000,
): Promise<{ taskId: string; status: string; raw: unknown }> {
  const taskId = String(params.task_id || '').trim()
  if (!/^[A-Za-z0-9_.:-]{1,240}$/.test(taskId)) throw new Error('Midjourney 任务 ID 不合法。')
  const speed = MIDJOURNEY_SPEEDS.includes(String(params.speed || 'relax').trim().toLowerCase() as MidjourneySpeed)
    ? String(params.speed || 'relax').trim().toLowerCase() as MidjourneySpeed
    : 'relax'
  const [maskUrl] = await midjourneyReferenceUrls(params.mask_image ? [params.mask_image] : [])
  if (!maskUrl) throw new Error('Midjourney 局部重绘需要一个遮罩图片。')
  const raw = await callMidjourneyJson(provider, '/v1/midjourney/generations/modal', {
    task_id: taskId,
    prompt: String(params.prompt || '').trim(),
    mask_url: maskUrl,
    speed,
    metadata: { source: 'ccs-os' },
  }, timeoutMs)
  const newTaskId = midjourneyTaskId(raw)
  if (!newTaskId) throw new Error(`Midjourney 未返回任务 ID：${JSON.stringify(raw).slice(0, 500)}`)
  return { taskId: newTaskId, status: midjourneyTaskStatus(raw) || 'submitted', raw }
}

export async function generateMidjourneyImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  timeoutMs = 600000,
  referenceImages: MidjourneyReferenceInput[] = [],
): Promise<{ images: GenImage[]; raw: unknown }> {
  const prompt = String(params.prompt || '').trim()
  if (!prompt) throw new Error('缺少 Midjourney 提示词')
  const submit = await submitMidjourney(
    provider,
    model,
    { prompt, size: params.size, version: model, speed: 'relax', mode: referenceImages.length ? 'edit' : 'imagine', reference_images: referenceImages },
    Math.min(timeoutMs, 180000),
  )
  const deadline = Date.now() + timeoutMs
  let lastRaw: unknown = submit.raw
  for (;;) {
    const task = await getMidjourneyTask(provider, submit.taskId, Math.min(timeoutMs, 180000))
    lastRaw = task.raw
    if (task.status === 'succeeded') return { images: task.images, raw: lastRaw }
    if (task.status === 'failed') {
      throw new Error((task as { error?: string }).error || 'Midjourney 任务失败')
    }
    if (Date.now() >= deadline) throw new Error('Midjourney 生成超时，请稍后再试。')
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
}

function apimartImageConfig(size = ''): { aspectRatio: string; imageSize: string } {
  const raw = String(size || '').trim().toLowerCase().replace('*', 'x')
  const match = raw.match(/^(\d{2,5})x(\d{2,5})$/)
  if (!match) {
    const ratio = raw.match(/^(\d+)\s*:\s*(\d+)$/)
    return { aspectRatio: ratio ? `${ratio[1]}:${ratio[2]}` : '1:1', imageSize: raw === '4k' ? '4K' : raw === '2k' ? '2K' : '1K' }
  }
  const width = Number(match[1])
  const height = Number(match[2])
  let a = width
  let b = height
  while (b) [a, b] = [b, a % b]
  const edge = Math.max(width, height)
  const pixels = width * height
  const imageSize = edge >= 2800 || pixels >= 7_000_000 ? '4K' : edge >= 1600 || pixels >= 2_000_000 ? '2K' : '1K'
  return { aspectRatio: `${Math.round(width / a)}:${Math.round(height / a)}`, imageSize }
}

function apimartImageConfigFromParams(params: GenImageParams): { aspectRatio: string; imageSize: string } {
  const fallback = apimartImageConfig(params.size)
  return {
    aspectRatio: String(params.aspectRatio || fallback.aspectRatio),
    imageSize: String(params.imageSize || fallback.imageSize),
  }
}

function parseApimartImagePayload(payload: any): GenImage[] {
  const root = payload?.candidates ? payload : payload?.data?.candidates ? payload.data : payload
  const images: GenImage[] = []
  for (const candidate of root?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      const inline = part?.inlineData || part?.inline_data
      if (inline?.data) images.push({ type: 'b64', value: String(inline.data) })
      else if (part?.image_url?.url) images.push({ type: 'url', value: String(part.image_url.url) })
    }
  }
  return images
}

function geminiImageParts(prompt: string, inputs: EditImageInput[] = []) {
  return [
    ...inputs.map((input) => ({
      inlineData: {
        mimeType: input.mime || 'image/png',
        data: input.buf.toString('base64'),
      },
    })),
    { text: String(prompt || '').trim() },
  ]
}

function isApimartGptImage2(model: string) {
  return /^gpt-image-2(?:$|[-._/])/i.test(String(model || '').replace(/^models\//, '').trim())
}

function apimartImageTaskId(payload: any): string {
  const roots = [payload, payload?.data, payload?.result, payload?.output]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value && typeof value === 'object')
  return roots.flatMap((value) => [value.task_id, value.taskId, value.submit_id, value.id])
    .map((value) => String(value || '').trim()).find(Boolean) || ''
}

function apimartImageTaskView(payload: any) {
  const data = Array.isArray(payload?.data) ? payload.data[0] : payload?.data
  const node = data && typeof data === 'object' ? data : payload
  const status = String(node?.status || node?.task_status || payload?.status || '').trim().toUpperCase()
  const error = String(node?.fail_reason || node?.error?.message || node?.error || node?.message || payload?.message || '').trim()
  return { status, error }
}

async function generateApimartGptImage2(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  timeoutMs: number,
  inputs: EditImageInput[],
  transport: ProtocolTransport,
): Promise<{ images: GenImage[]; raw: unknown }> {
  const def = PROTOCOLS.apimart
  const base = String(provider.base_url || '').replace(/\/+$/, '').replace(/\/v1(?:beta)?$/i, '')
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  const config = apimartImageConfigFromParams(params)
  const body: Record<string, unknown> = {
    model: String(model || '').replace(/^models\//, ''),
    prompt: String(params.prompt || '').trim(),
    n: 1,
    size: config.aspectRatio,
    resolution: config.imageSize.toLowerCase(),
    official_fallback: false,
  }
  if (inputs.length) body.image_urls = inputs.slice(0, 20).map(mediaDataUrl)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const deadline = Date.now() + timeoutMs
  let lastPayload: any = null
  const request = async (url: string, init?: RequestInit) => {
    const response = await transport.fetch(url, { ...init, signal: ctrl.signal })
    const text = await response.text()
    let payload: any
    try { payload = JSON.parse(text) } catch { payload = text }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof payload === 'string' ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`)
    return payload
  }

  try {
    lastPayload = await request(joinUrl(base, '/v1/images/generations'), { method: 'POST', headers, body: JSON.stringify(body) })
    const immediate = parseImagePayload(lastPayload)
    if (immediate.length) return { images: immediate, raw: lastPayload }
    const taskId = apimartImageTaskId(lastPayload)
    if (!taskId) throw new Error(`APIMart GPT Image 2 未返回图片或任务 ID：${JSON.stringify(lastPayload).slice(0, 500)}`)

    const initialDelay = Math.min(10_000, Math.max(25, Math.floor(timeoutMs / 10)))
    const pollInterval = Math.min(5_000, Math.max(25, Math.floor(timeoutMs / 20)))
    await new Promise((resolve) => setTimeout(resolve, initialDelay))
    while (Date.now() < deadline && !ctrl.signal.aborted) {
      lastPayload = await request(joinUrl(base, `/v1/tasks/${encodeURIComponent(taskId)}`), { headers: { Accept: 'application/json', ...buildAuthHeaders(def, provider.api_key) } })
      const images = parseImagePayload(lastPayload)
      const view = apimartImageTaskView(lastPayload)
      if (images.length && (!view.status || ['SUCCESS', 'SUCCESSFUL', 'SUCCEED', 'SUCCEEDED', 'COMPLETED', 'COMPLETE', 'DONE', 'FINISHED', 'OK', 'READY'].includes(view.status))) {
        return { images, raw: lastPayload }
      }
      if (['FAILURE', 'FAILED', 'FAIL', 'ERROR', 'ERRORED', 'CANCELED', 'CANCELLED', 'TIMEOUT', 'REJECTED', 'EXPIRED'].includes(view.status)) {
        throw new Error(`APIMart GPT Image 2 任务失败：${view.error || view.status}`)
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, Math.max(0, deadline - Date.now()))))
    }
    throw new Error(`APIMart GPT Image 2 本地等待已结束，远程任务 ${taskId} 可能仍在处理中，请勿重复提交。`)
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('APIMart GPT Image 2 本地等待已结束；远程任务可能仍在处理中，请勿重复提交。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function generateApimartImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  timeoutMs: number,
  inputs: EditImageInput[] = [],
  transport: ProtocolTransport = defaultProtocolTransport,
): Promise<{ images: GenImage[]; raw: unknown }> {
  if (isApimartGptImage2(model)) return generateApimartGptImage2(provider, model, params, timeoutMs, inputs, transport)
  const def = PROTOCOLS.apimart
  const modelName = String(model || '').replace(/^models\//, '')
  const configuredBaseUrl = String(provider.base_url || '').replace(/\/v1(?:beta)?\/?$/i, '')
  const url = joinUrl(configuredBaseUrl, `/v1beta/models/${encodeURIComponent(modelName)}:generateContent`)
  const config = apimartImageConfigFromParams(params)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  const body = {
    contents: [{ role: 'user', parts: geminiImageParts(String(params.prompt || ''), inputs) }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: config,
    },
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await transport.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    const text = await resp.text()
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
    if (!resp.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload)
      throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 500)}`)
    }
    return { images: parseApimartImagePayload(payload), raw: payload }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('APIMart 图像生成超时，请重试或换更快的模型。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function generateGeminiImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  timeoutMs: number,
  inputs: EditImageInput[] = [],
): Promise<{ images: GenImage[]; raw: unknown }> {
  const def = PROTOCOLS.gemini
  const modelName = String(model || '').replace(/^models\//, '')
  const url = joinUrl(provider.base_url, `/v1beta/models/${encodeURIComponent(modelName)}:generateContent`)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  const body = {
    contents: [{ role: 'user', parts: geminiImageParts(String(params.prompt || ''), inputs) }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: apimartImageConfigFromParams(params),
    },
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    const text = await resp.text()
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
    if (!resp.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload)
      throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 500)}`)
    }
    return { images: parseApimartImagePayload(payload), raw: payload }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('Gemini 图像生成超时，请重试或换更快的模型。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

const VOLCENGINE_IMAGE_RATIOS = [[1, 1], [16, 9], [9, 16], [4, 3], [3, 4], [3, 2], [2, 3], [21, 9], [9, 21], [5, 4], [4, 5]] as const

export function volcengineImageSize(size = '', model = ''): string {
  const raw = String(size || '').trim().toLowerCase().replace('*', 'x')
  const match = raw.match(/^(\d{2,5})x(\d{2,5})$/)
  if (!match) return raw === '4k' ? '4096x4096' : raw === '2k' || /seedream/i.test(model) ? '2048x2048' : raw || '1024x1024'
  const width = Number(match[1])
  const height = Number(match[2])
  if (!/seedream/i.test(model)) return `${width}x${height}`
  const ratio = width / Math.max(1, height)
  const [rw, rh] = [...VOLCENGINE_IMAGE_RATIOS].sort((a, b) => Math.abs(ratio - a[0] / a[1]) - Math.abs(ratio - b[0] / b[1]))[0]
  const scale = Math.max(Math.sqrt(3_686_400 / (rw * rh)), 1536 / Math.min(rw, rh))
  const cap = Math.min(1, 4096 / Math.max(rw * scale, rh * scale))
  let targetWidth = Math.max(64, Math.floor(rw * scale * cap / 16) * 16)
  let targetHeight = Math.max(64, Math.floor(rh * scale * cap / 16) * 16)
  while (targetWidth * targetHeight < 3_686_400 && Math.max(targetWidth, targetHeight) <= 4096) {
    if (targetWidth <= targetHeight) targetWidth += 16
    else targetHeight += 16
  }
  return `${targetWidth}x${targetHeight}`
}

export async function generateVolcengineImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  inputs: EditImageInput[] = [],
  timeoutMs = 300000,
): Promise<{ images: GenImage[]; raw: unknown }> {
  const prompt = String(params.prompt || '').trim()
  if (!prompt) throw new Error('缺少图片提示词')
  if (!String(model || '').trim()) throw new Error('缺少 Seedream 图片模型')
  const def = PROTOCOLS.volcengine
  const url = joinUrl(provider.base_url, '/api/v3/images/generations')
  const body: Record<string, unknown> = {
    model,
    prompt,
    size: volcengineImageSize(params.size, model),
    response_format: params.response_format || 'url',
  }
  if (inputs.length) body.image = inputs.slice(0, 9).map((input) => input.publicUrl || mediaDataUrl(input))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...buildAuthHeaders(def, provider.api_key) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await resp.text()
    let payload: any
    try { payload = JSON.parse(text) } catch { payload = text }
    if (!resp.ok) throw new Error(`火山方舟图片接口 HTTP ${resp.status}: ${text.slice(0, 500)}`)
    const images = parseImagePayload(payload)
    if (!images.length) throw new Error(`火山方舟图片接口未返回图片：${text.slice(0, 500)}`)
    return { images, raw: payload }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('火山方舟图片生成超时，请稍后重试。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export async function generateImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  timeoutMs = 300000,
  transport: ProtocolTransport = defaultProtocolTransport,
): Promise<{ images: GenImage[]; raw: unknown }> {
  const rawProto = String(provider.protocol || '').trim().toLowerCase()
  if (rawProto === 'cli:jimeng' || rawProto === 'jimeng-cli') {
    const result = await generateJimengImage(
      String(params.prompt || '').trim(),
      model || 'jimeng-5.0Pro',
      String(params.size || '1024x1024'),
    )
    return { images: result.images.map((value) => ({ type: 'url' as const, value })), raw: result.raw }
  }
  if (rawProto === 'cli:codex' || rawProto === 'codex-cli') {
    const result = await generateCodexImage(String(params.prompt || '').trim(), model || 'gpt-image-2', String(params.size || '1024x1024'))
    return { images: result.images.map((value) => ({ type: 'url' as const, value })), raw: result.raw }
  }
  if (rawProto === 'agnes') return generateAgnesImages(provider, model, params, timeoutMs, transport)
  if (rawProto === 'modelscope') return generateModelScopeImages(provider, model, params, timeoutMs)
  if (rawProto === 'volcengine') return generateVolcengineImages(provider, model, params, [], timeoutMs)
  if (rawProto === 'runninghub') return generateRunningHubImages(provider, model, params, timeoutMs)
  if (rawProto === 'grok2api') return requestGrok2ApiImages(provider, model, params, [], timeoutMs)
  if (rawProto === 'zkki' || rawProto === 'zkki-model') return requestZkkiImages(provider, model, params, [], timeoutMs)
  if (rawProto === 'midjourney') return generateMidjourneyImages(provider, model, params, timeoutMs)
  assertRunnableProtocol(rawProto, '图像生成')
  const proto = normalizeProtocol(provider.protocol)
  const useApibOpenAiCompatibility = isApibOpenAiImageProvider(provider)
  if ((proto === 'apimart' || proto === 'apimart-gemini' || proto === 'apimart-media') && !useApibOpenAiCompatibility) return generateApimartImages(provider, model, params, timeoutMs, [], transport)
  if (proto === 'gemini') return generateGeminiImages(provider, model, params, timeoutMs)
  if (proto !== 'openai' && !useApibOpenAiCompatibility) {
    throw new Error('图像生成目前只支持 OpenAI 兼容站点，请在「API 设置」里用 openai 协议添加图像模型站点。')
  }
  const def = PROTOCOLS.openai
  const useGptBestAsync = isGptBestAsyncImageProvider(provider)
  const url = joinUrl(provider.base_url, `/v1/images/generations${useGptBestAsync ? '?async=true' : ''}`)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  const body: Record<string, unknown> = { model, prompt: String(params.prompt || '').trim() }
  if (useApibOpenAiCompatibility) {
    body.size = apibImageAspectRatio(params.size)
    body.resolution = apibImageResolution(params.size, params.resolution || params.imageSize)
    body.official_fallback = false
  }
  else if (params.size && params.size !== 'auto') body.size = params.size
  const quality = openAiImageQuality(provider, model, params.quality)
  if (quality) body.quality = quality
  if (params.n) body.n = Math.max(1, Math.min(4, Number(params.n) || 1))
  if (params.response_format) body.response_format = params.response_format

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    const text = await resp.text()
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
    if (!resp.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload)
      throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 500)}`)
    }
    const images = parseImagePayload(payload)
    if (images.length) return { images, raw: payload }
    const taskId = imageTaskId(payload)
    if (taskId) return pollGptBestImageTask(provider, taskId, headers, timeoutMs)
    return { images: [], raw: payload }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('图像生成超时，请重试或换更快的模型。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export interface GenVideo {
  type: 'url'
  value: string
}

function collectVideoUrls(value: any, out: string[] = [], depth = 0, keyHint = ''): string[] {
  if (depth > 8 || value == null) return out
  if (typeof value === 'string') {
    if (/^(https?:\/\/|asset:\/\/)/i.test(value) && (keyHint || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(value))) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVideoUrls(item, out, depth + 1, keyHint)
    return out
  }
  if (typeof value !== 'object') return out
  for (const key of ['video_url', 'videoUrl', 'url', 'uri', 'download_url', 'downloadUrl', 'video', 'videos', 'outputs', 'results', 'content', 'data', 'detail', 'result']) {
    if (key in value) collectVideoUrls(value[key], out, depth + 1, /video|url|output|result|content|download/i.test(key) ? key : keyHint)
  }
  return out
}

function extractVideoTaskId(payload: any): string {
  const roots = [payload, payload?.data, payload?.result, payload?.output]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value && typeof value === 'object')
  const candidates = roots.flatMap((value) => [value.request_id, value.requestId, value.id, value.task_id, value.taskId])
  return candidates.map((v) => String(v || '').trim()).find(Boolean) || ''
}

function videoStatus(payload: any): string {
  const data = payload?.data
  const node = Array.isArray(data)
    ? data.find((value) => value && typeof value === 'object') || payload
    : data && typeof data === 'object' ? data : payload
  return String(node?.status || node?.task_status || node?.taskStatus || payload?.status || '').trim().toUpperCase()
}

function mediaDataUrl(input: EditImageInput): string {
  return `data:${input.mime || 'application/octet-stream'};base64,${input.buf.toString('base64')}`
}

export async function generateVolcengineVideos(
  provider: ResolvedProvider,
  model: string,
  params: GenVideoParams,
  input?: EditImageInput,
  timeoutMs = 600000,
): Promise<{ videos: GenVideo[]; raw: unknown }> {
  const requestedModel = String(model || '').trim()
  const prompt = String(params.prompt || '').trim()
  if (!requestedModel) throw new Error('缺少 Seedance 视频模型')
  if (!prompt) throw new Error('缺少视频提示词')
  const images = [...(params.images || []), ...(input ? [{ ...input, kind: 'image' as const }] : [])]
  const videos = params.videos || []
  const audios = params.audios || []
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  let firstFrameUsed = false
  let lastFrameUsed = false
  for (const image of images.slice(0, 9)) {
    const url = String(image.publicUrl || mediaDataUrl(image))
    const explicitRole = String(image.role || '').trim().toLowerCase()
    let role = explicitRole
    if (!['first_frame', 'last_frame', 'reference_image'].includes(role)) {
      role = params.multimodal ? 'reference_image' : firstFrameUsed ? '' : 'first_frame'
    }
    if (!role || role === 'first_frame' && firstFrameUsed || role === 'last_frame' && lastFrameUsed) continue
    if (role === 'first_frame') firstFrameUsed = true
    if (role === 'last_frame') lastFrameUsed = true
    content.push({ type: 'image_url', image_url: { url }, role })
  }
  for (const video of videos.slice(0, 3)) {
    content.push({ type: 'video_url', video_url: { url: video.publicUrl || mediaDataUrl(video) }, role: 'reference_video' })
  }
  for (const audio of audios.slice(0, 3)) {
    content.push({ type: 'audio_url', audio_url: { url: audio.publicUrl || mediaDataUrl(audio) }, role: 'reference_audio' })
  }
  const resolutionRaw = String(params.resolution || '').trim().toLowerCase()
  const resolution = ({ '480': '480p', '720': '720p', '1080': '1080p' } as Record<string, string>)[resolutionRaw] || resolutionRaw
  const body: Record<string, unknown> = {
    model: requestedModel,
    content,
    duration: Math.max(1, Math.min(60, Math.round(Number(params.duration) || 5))),
    ...(params.aspect_ratio || params.size ? { ratio: String(params.aspect_ratio || params.size) } : {}),
    ...(['480p', '720p', '1080p'].includes(resolution) ? { resolution } : {}),
    ...(params.watermark ? { watermark: true } : {}),
    ...(params.generate_audio ? { generate_audio: true } : {}),
    ...(params.camerafixed ? { camerafixed: true } : {}),
    ...(params.seed !== undefined ? { seed: params.seed } : {}),
    ...(params.return_last_frame ? { return_last_frame: true } : {}),
  }
  const def = PROTOCOLS.volcengine
  const submitUrl = joinUrl(provider.base_url, '/api/v3/contents/generations/tasks')
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...buildAuthHeaders(def, provider.api_key) }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const submit = await fetch(submitUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    const submitText = await submit.text()
    let payload: any
    try { payload = JSON.parse(submitText) } catch { payload = submitText }
    if (!submit.ok) throw new Error(`火山方舟视频接口 HTTP ${submit.status}: ${submitText.slice(0, 500)}`)
    let urls = collectVideoUrls(payload).filter((url, index, list) => list.indexOf(url) === index)
    const taskId = extractVideoTaskId(payload)
    if (!urls.length && !taskId) throw new Error(`火山方舟未返回任务 ID：${submitText.slice(0, 500)}`)
    const deadline = Date.now() + timeoutMs
    while (!urls.length && taskId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const taskUrl = joinUrl(provider.base_url, `/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`)
      const task = await fetch(taskUrl, { headers: { Accept: 'application/json', ...buildAuthHeaders(def, provider.api_key) }, signal: ctrl.signal })
      const taskText = await task.text()
      try { payload = JSON.parse(taskText) } catch { payload = taskText }
      if (!task.ok) throw new Error(`火山方舟任务查询 HTTP ${task.status}: ${taskText.slice(0, 500)}`)
      urls = collectVideoUrls(payload).filter((url, index, list) => list.indexOf(url) === index)
      const status = videoStatus(payload)
      if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED', 'TIMEOUT', 'REJECTED'].includes(status)) {
        throw new Error(`火山方舟视频任务失败：${taskText.slice(0, 500)}`)
      }
    }
    if (!urls.length) throw new Error('火山方舟视频生成超时或没有返回视频地址。')
    return { videos: urls.map((value) => ({ type: 'url', value })), raw: payload }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('火山方舟视频生成超时，请稍后重试。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function collectMediaUrls(value: any, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || value == null) return out
  if (typeof value === 'string') {
    if (/^(https?:\/\/|asset:\/\/)/i.test(value.trim())) out.push(value.trim())
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, out, depth + 1)
    return out
  }
  if (typeof value !== 'object') return out
  for (const key of ['url', 'uri', 'asset_url', 'assetUrl', 'file_url', 'fileUrl', 'download_url', 'downloadUrl', 'data', 'file', 'asset', 'result']) {
    if (key in value) collectMediaUrls(value[key], out, depth + 1)
  }
  return out
}

function extractUploadedMediaUrl(payload: any): string {
  return collectMediaUrls(payload).find((value) => /^(https?:\/\/|asset:\/\/)/i.test(value)) || ''
}

function apimartUploadPaths(kind: VideoReferenceKind): string[] {
  if (kind === 'image') return ['/v1/uploads/images']
  if (kind === 'video') return ['/v1/uploads/videos', '/v1/uploads/files', '/v1/uploads/images']
  return ['/v1/uploads/audios', '/v1/uploads/files', '/v1/uploads/images']
}

export async function uploadApimartMedia(provider: ResolvedProvider, input: GenVideoReference, timeoutMs: number, transport: ProtocolTransport = defaultProtocolTransport): Promise<string> {
  if (String(input.publicUrl || '').match(/^https?:\/\//i)) return String(input.publicUrl)
  const headers = {
    Accept: 'application/json',
    ...(buildAuthHeaders(PROTOCOLS.apimart, provider.api_key)),
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let lastError = ''
    for (const endpoint of apimartUploadPaths(input.kind)) {
      const form = new FormData()
      form.append(
        'file',
        new Blob([new Uint8Array(input.buf)], { type: input.mime || 'application/octet-stream' }),
        input.name || `input.${input.kind}`,
      )
      try {
        const resp = await transport.fetch(joinUrl(provider.base_url, endpoint), { method: 'POST', headers, body: form, signal: ctrl.signal })
        const text = await resp.text()
        let payload: any
        try { payload = JSON.parse(text) } catch { payload = text }
        if (!resp.ok) {
          lastError = `HTTP ${resp.status}: ${text.slice(0, 240)}`
          continue
        }
        const url = extractUploadedMediaUrl(payload)
        if (url) return url
        lastError = '上传响应未包含可用地址'
      } catch (error) {
        if (ctrl.signal.aborted) throw error
        lastError = String((error as Error).message || error)
      }
    }
    throw new Error(`APIMart ${input.kind === 'image' ? '图片' : input.kind === 'video' ? '视频' : '音频'}上传失败：${lastError || '未找到可用上传入口'}`)
  } finally {
    clearTimeout(timer)
  }
}

function agTokenReferenceUrl(input: GenVideoReference): string {
  const url = String(input.publicUrl || '').trim()
  if (/^https:\/\//i.test(url)) return url
  throw new Error(`AGToken 的${input.kind === 'image' ? '图片' : input.kind === 'video' ? '视频' : '音频'}素材必须是公网可直接读取的 HTTPS 文件 URL。`)
}

function agTokenTaskView(payload: any) {
  const node = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : payload?.output && typeof payload.output === 'object'
      ? payload.output
      : payload
  const taskId = String(node?.task_id || node?.id || payload?.task_id || payload?.id || '').trim()
  const status = String(node?.task_status || node?.status || payload?.status || '').trim().toUpperCase()
  const resultUrl = String(node?.result_url || node?.video_url || node?.content?.video_url || payload?.content?.video_url || '').trim()
  const error = String(node?.fail_reason || node?.error?.message || payload?.error?.message || payload?.message || '').trim()
  return { taskId, status, resultUrl, error }
}

async function generateAgTokenVideos(
  provider: ResolvedProvider,
  model: string,
  params: GenVideoParams,
  input: EditImageInput | undefined,
  timeoutMs: number,
): Promise<{ videos: GenVideo[]; raw: unknown }> {
  const requestedModel = String(model || '').trim()
  const prompt = String(params.prompt || '').trim()
  if (!requestedModel) throw new Error('缺少 AGToken 视频模型')
  if (!requestedModel.endsWith('（国内）')) throw new Error('AGToken 公开模型名必须保留“（国内）”后缀。')
  if (!prompt) throw new Error('缺少视频提示词')

  const images = [...(params.images || []), ...(input ? [{ ...input, kind: 'image' as const }] : [])]
  const videos = params.videos || []
  const audios = params.audios || []
  const imageUrls = images.map(agTokenReferenceUrl)
  const videoUrls = videos.map(agTokenReferenceUrl)
  const audioUrls = audios.map(agTokenReferenceUrl)
  const base = String(provider.base_url || '').replace(/\/+$/, '').replace(/\/v1$/i, '')
  const isWan = /^wan3\.0-video(?:-prime)?（国内）$/i.test(requestedModel)
  const isSeedance = /^doubao-seedance-2-[05]-/i.test(requestedModel)
  const durationValue = Number(params.duration)
  const duration = Number.isFinite(durationValue) ? Math.round(durationValue) : 5
  const ratio = String(params.aspect_ratio || params.size || (isWan ? 'adaptive' : '16:9'))
  const resolution = String(params.resolution || (isWan ? '1080p' : '720p'))

  let submitPath: string
  let queryPath: (taskId: string) => string
  let body: Record<string, unknown>
  const extraHeaders: Record<string, string> = {}
  if (isWan) {
    submitPath = '/api/v1/services/aigc/video-generation/video-synthesis'
    queryPath = (taskId) => `/api/v1/tasks/${encodeURIComponent(taskId)}`
    extraHeaders['X-DashScope-Async'] = 'enable'
    const media = [
      ...imageUrls.map((url, index) => ({ type: String(images[index]?.role || 'reference_image'), url })),
      ...videoUrls.map((url, index) => ({ type: String(videos[index]?.role || 'reference_video'), url })),
      ...audioUrls.map((url, index) => ({ type: String(audios[index]?.role || 'reference_audio'), url })),
    ]
    body = {
      model: requestedModel,
      input: { prompt, ...(media.length ? { media } : {}) },
      parameters: {
        resolution: resolution.toUpperCase(), ratio, duration,
        audio: params.generate_audio !== false,
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
        watermark: params.watermark === true,
      },
    }
  } else if (isSeedance) {
    submitPath = '/api/v3/contents/generations/tasks'
    queryPath = (taskId) => `/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
    imageUrls.forEach((url, index) => content.push({ type: 'image_url', image_url: { url }, role: String(images[index]?.role || 'reference_image') }))
    videoUrls.forEach((url, index) => content.push({ type: 'video_url', video_url: { url }, role: String(videos[index]?.role || 'reference_video') }))
    audioUrls.forEach((url, index) => content.push({ type: 'audio_url', audio_url: { url }, role: String(audios[index]?.role || 'reference_audio') }))
    body = {
      model: requestedModel, content, resolution: resolution.toLowerCase(), ratio, duration,
      generate_audio: params.generate_audio !== false,
      watermark: params.watermark === true,
      ...(params.seed !== undefined ? { seed: params.seed } : {}),
      ...(params.return_last_frame ? { return_last_frame: true } : {}),
      ...(requestedModel.startsWith('doubao-seedance-2-5-') && (videoUrls.length || audioUrls.length) ? { omni_reference_task_type: 'reference' } : {}),
    }
  } else {
    if (videoUrls.length || audioUrls.length) throw new Error('AG 统一接口只接受图片参考；视频或音频参考请使用 Seedance/Wan 模型。')
    submitPath = '/v1/video/generations'
    queryPath = (taskId) => `/v1/video/generations/${encodeURIComponent(taskId)}`
    body = {
      model: requestedModel, prompt, duration,
      ...(imageUrls.length === 1 ? { image: imageUrls[0] } : imageUrls.length ? { images: imageUrls } : {}),
      metadata: { resolution: resolution.toLowerCase(), ratio, generate_audio: params.generate_audio !== false, watermark: params.watermark === true },
    }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const deadline = Date.now() + timeoutMs
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...extraHeaders, ...buildAuthHeaders(PROTOCOLS['agtoken-video'], provider.api_key) }
  let lastPayload: any = null
  try {
    const submit = await fetch(joinUrl(base, submitPath), { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    const submitText = await submit.text()
    try { lastPayload = JSON.parse(submitText) } catch { lastPayload = submitText }
    if (!submit.ok) throw new Error(`HTTP ${submit.status}: ${submitText.slice(0, 500)}`)
    let view = agTokenTaskView(lastPayload)
    if (view.resultUrl) return { videos: [{ type: 'url', value: view.resultUrl }], raw: lastPayload }
    if (!view.taskId) throw new Error(`AGToken 未返回任务 ID：${submitText.slice(0, 500)}`)
    const taskId = view.taskId
    while (Date.now() < deadline && !ctrl.signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(25, Math.floor(timeoutMs / 4)))))
      const query = await fetch(joinUrl(base, queryPath(taskId)), { headers: { Accept: 'application/json', ...buildAuthHeaders(PROTOCOLS['agtoken-video'], provider.api_key) }, signal: ctrl.signal })
      const queryText = await query.text()
      try { lastPayload = JSON.parse(queryText) } catch { lastPayload = queryText }
      if (!query.ok) throw new Error(`AGToken 任务查询失败（HTTP ${query.status}）：${queryText.slice(0, 500)}`)
      view = agTokenTaskView(lastPayload)
      if (view.resultUrl) return { videos: [{ type: 'url', value: view.resultUrl }], raw: lastPayload }
      if (['FAILURE', 'FAILED', 'CANCELED', 'CANCELLED'].includes(view.status)) throw new Error(`AGToken 视频任务失败：${view.error || queryText.slice(0, 500)}`)
    }
    throw new Error(`AGToken 本地等待已结束，远程任务 ${taskId} 未被判定失败，可稍后继续查询。`)
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('AGToken 本地等待已结束；远程任务可能仍在排队，请勿重复提交。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function zkkiReferenceUrl(input: GenVideoReference): string {
  const url = String(input.publicUrl || '').trim()
  if (/^https:\/\//i.test(url)) return url
  throw new Error(`ZKKI 的${input.kind === 'image' ? '图片' : input.kind === 'video' ? '视频' : '音频'}参考素材必须是公网可读取的 HTTPS 文件 URL。`)
}

async function generateZkkiVideos(
  provider: ResolvedProvider,
  model: string,
  params: GenVideoParams,
  input: EditImageInput | undefined,
  timeoutMs: number,
): Promise<{ videos: GenVideo[]; raw: unknown }> {
  const requestedModel = String(model || '').trim()
  const prompt = String(params.prompt || '').trim()
  if (!requestedModel) throw new Error('缺少 ZKKI 视频模型')
  if (!prompt) throw new Error('缺少视频提示词')
  const images = [...(params.images || []), ...(input ? [{ ...input, kind: 'image' as const }] : [])]
  const videos = params.videos || []
  const audios = params.audios || []
  const isTextOnly = /global-standard-t2v$/i.test(requestedModel)
  if (isTextOnly && (images.length || videos.length || audios.length)) throw new Error(`${requestedModel} 是纯文生视频模型，不支持参考素材。`)
  const duration = Math.max(4, Math.min(30, Math.round(Number(params.duration) || 5)))
  const requestBody = (inlineImages = false) => {
    const media = [
      ...images.map((item) => ({ type: String(item.role || 'reference_image'), url: inlineImages ? mediaDataUrl(item) : zkkiReferenceUrl(item) })),
      ...videos.map((item) => ({ type: String(item.role || 'reference_video'), url: zkkiReferenceUrl(item) })),
      ...audios.map((item) => ({ type: String(item.role || 'reference_audio'), url: zkkiReferenceUrl(item) })),
    ]
    return {
      model: requestedModel,
      input: { prompt, ...(media.length ? { media } : {}) },
      parameters: {
        duration,
        ratio: String(params.aspect_ratio || params.size || '16:9'),
        resolution: String(params.resolution || '720p'),
        generate_audio: params.generate_audio !== false,
        watermark: params.watermark === true,
      },
    }
  }
  const base = String(provider.base_url || '').replace(/\/+$/, '').replace(/\/v1$/i, '')
  const auth = buildAuthHeaders(PROTOCOLS['zkki-model'], provider.api_key)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const deadline = Date.now() + timeoutMs
  let lastPayload: any = null
  try {
    const submitRequest = (inlineImages = false) => fetch(joinUrl(base, '/v1/videos'), {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(requestBody(inlineImages)), signal: ctrl.signal,
    })
    let submit = await submitRequest()
    let submitText = await submit.text()
    // Some upstream Seedance channels cannot fetch otherwise valid signed CDN
    // URLs. Their failed response contains no task id, so retrying the same
    // submission with inline image data cannot duplicate a billable task.
    if (!submit.ok && images.length && /fail_to_fetch_task|resource not found|image_url[^\n]*not valid/i.test(submitText)) {
      submit = await submitRequest(true)
      submitText = await submit.text()
    }
    try { lastPayload = JSON.parse(submitText) } catch { lastPayload = submitText }
    if (!submit.ok) throw new Error(`HTTP ${submit.status}: ${submitText.slice(0, 500)}`)
    const taskId = String(lastPayload?.id || lastPayload?.task_id || lastPayload?.data?.id || lastPayload?.data?.task_id || '').trim()
    if (!taskId) throw new Error(`ZKKI 未返回任务 ID：${submitText.slice(0, 500)}`)
    while (Date.now() < deadline && !ctrl.signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(25, Math.floor(timeoutMs / 4)))))
      const query = await fetch(joinUrl(base, `/v1/videos/${encodeURIComponent(taskId)}`), { headers: { Accept: 'application/json', ...auth }, signal: ctrl.signal })
      const queryText = await query.text()
      try { lastPayload = JSON.parse(queryText) } catch { lastPayload = queryText }
      if (!query.ok) throw new Error(`ZKKI 任务查询失败（HTTP ${query.status}）：${queryText.slice(0, 500)}`)
      const node = lastPayload?.data && typeof lastPayload.data === 'object' ? lastPayload.data : lastPayload
      const status = String(node?.status || lastPayload?.status || '').trim().toLowerCase()
      if (status === 'completed') {
        const content = await fetch(joinUrl(base, `/v1/videos/${encodeURIComponent(taskId)}/content`), { headers: { Accept: 'video/*', ...auth }, signal: ctrl.signal })
        if (!content.ok) throw new Error(`ZKKI 视频下载失败（HTTP ${content.status}）：${(await content.text()).slice(0, 500)}`)
        const mime = String(content.headers.get('content-type') || 'video/mp4').split(';')[0] || 'video/mp4'
        const encoded = Buffer.from(await content.arrayBuffer()).toString('base64')
        return { videos: [{ type: 'url', value: `data:${mime};base64,${encoded}` }], raw: lastPayload }
      }
      if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) {
        const message = String(node?.error?.message || node?.error || node?.message || status)
        throw new Error(`ZKKI 视频任务失败：${message}`)
      }
    }
    throw new Error(`ZKKI 本地等待已结束，远程任务 ${taskId} 可能仍在处理中，请勿重复提交。`)
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('ZKKI 本地等待已结束；远程任务可能仍在处理中，请勿重复提交。')
    if (/fetch failed/i.test(String((error as Error).message || error))) throw new Error(`ZKKI 网络请求失败：${String((error as Error).cause || (error as Error).message || error)}`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function generateVideos(
  provider: ResolvedProvider,
  model: string,
  params: GenVideoParams,
  input?: EditImageInput,
  timeoutMs = 600000,
  transport: ProtocolTransport = defaultProtocolTransport,
  clock: ProtocolClock = defaultProtocolClock,
): Promise<{ videos: GenVideo[]; raw: unknown }> {
  const rawProtocol = String(provider.protocol || '').trim().toLowerCase()
  if (rawProtocol === 'agtoken' || rawProtocol === 'agtoken-video') return generateAgTokenVideos(provider, model, params, input, timeoutMs)
  if (rawProtocol === 'zkki' || rawProtocol === 'zkki-model') return generateZkkiVideos(provider, model, params, input, timeoutMs)
  if (rawProtocol === 'cli:jimeng' || rawProtocol === 'jimeng-cli') {
    const imageRefs = [
      ...(params.images || []),
      ...(input ? [{ ...input, kind: 'image' as const }] : []),
    ]
    const videoRefs = params.videos || []
    const audioRefs = params.audios || []
    const result = await generateJimengVideo(String(params.prompt || '').trim(), model || 'seedance2.0fast', {
      imagePaths: imageRefs.map((ref) => tempMediaFile(ref.buf, ref.mime || 'image/png', '.png')),
      imageRoles: imageRefs.map((ref) => String(ref.role || 'reference_image')),
      videoPaths: videoRefs.map((ref) => tempMediaFile(ref.buf, ref.mime || 'video/mp4', '.mp4')),
      audioPaths: audioRefs.map((ref) => tempMediaFile(ref.buf, ref.mime || 'audio/mpeg', '.mp3')),
      duration: Number(params.duration) || 5,
      aspect_ratio: String(params.aspect_ratio || params.size || '16:9'),
      resolution: params.resolution,
      multimodal: params.multimodal === true || videoRefs.length > 0 || audioRefs.length > 0,
    })
    return { videos: result.videos.map((value) => ({ type: 'url' as const, value })), raw: result.raw }
  }
  const declaredRuntime = DECLARED_VIDEO_RUNTIME_PROTOCOL_IDS.has(rawProtocol)
  if (rawProtocol === 'agnes') return generateAgnesVideos(provider, model, input ? { ...params, images: [...(params.images || []), { ...input, kind: 'image' }] } : params, timeoutMs, transport, clock)
  if (rawProtocol === 'volcengine') return generateVolcengineVideos(provider, model, params, input, timeoutMs)
  if (rawProtocol === 'runninghub') return generateRunningHubVideos(provider, model, params, timeoutMs)
  assertRunnableProtocol(provider.protocol, '视频生成')
  const proto = normalizeProtocol(provider.protocol)
  if (proto !== 'openai' && proto !== 'apimart' && proto !== 'apimart-media' && !declaredRuntime) {
    throw new Error('视频测试目前支持 OpenAI 兼容和 APIMart 站点。')
  }
  const runtimeDef = PROTOCOLS[declaredRuntime ? rawProtocol : proto]
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(runtimeDef.headers || {}),
    ...buildAuthHeaders(runtimeDef, provider.api_key),
  }
  const imageRefs = [
    ...(params.images || []),
    ...(input ? [{ ...input, kind: 'image' as const }] : []),
  ]
  const videoRefs = params.videos || []
  const audioRefs = params.audios || []
  const duration = Math.max(1, Math.min(60, Number(params.duration) || 5))
  const aspect = String(params.aspect_ratio || params.size || '16:9').trim() || '16:9'
  const requestedModel = String(model || '').trim()
  if (!requestedModel) throw new Error('缺少视频模型')
  if (!String(params.prompt || '').trim()) throw new Error('缺少视频提示词')

  const declaredOperations = declaredRuntime ? PROTOCOLS[rawProtocol].operations || {} : {}
  const declaredOperation = videoRefs.length && declaredOperations['video.edit']
    ? declaredOperations['video.edit']
    : imageRefs.length
      ? declaredOperations['video.image_to_video'] || declaredOperations['video.generate']
      : declaredOperations['video.generate']

  const buildCommonBody = (): Record<string, unknown> => ({
    model: requestedModel,
    prompt: String(params.prompt || '').trim(),
    duration,
    ...(params.size ? { size: params.size } : {}),
    ...(aspect ? { aspect_ratio: aspect } : {}),
    ...(params.resolution ? { resolution: params.resolution } : {}),
    ...(params.enhance_prompt ? { enhance_prompt: true } : {}),
    ...(params.enable_upsample ? { enable_upsample: true } : {}),
    ...(params.watermark ? { watermark: true } : {}),
    ...(params.seed !== undefined ? { seed: params.seed } : {}),
    ...(params.camerafixed ? { camerafixed: true } : {}),
    ...(params.return_last_frame ? { return_last_frame: true } : {}),
    ...(params.generate_audio ? { generate_audio: true } : {}),
    ...(params.multimodal ? { multimodal: true } : {}),
    ...(params.trusted_asset ? { trusted_asset: true } : {}),
  })

  let body: Record<string, unknown>
  if (proto === 'apimart' || proto === 'apimart-media') {
    const lowerModel = requestedModel.toLowerCase()
    const isVeo31 = lowerModel.startsWith('veo3.1')
    const apimartModel = isVeo31
      ? ({ 'veo3.1': 'veo3.1-fast', 'veo3.1-pro': 'veo3.1-quality', 'veo3.1-preview': 'veo3.1-fast' }[lowerModel] || lowerModel)
      : requestedModel
    if (isVeo31 && (videoRefs.length || audioRefs.length)) {
      throw new Error('APIMart VEO 3.1 当前只支持文字和图片参考，不支持参考视频或参考音频。')
    }
    if (isVeo31 && apimartModel === 'veo3.1-lite' && imageRefs.length) {
      throw new Error('APIMart veo3.1-lite 不支持图片输入，请改用 veo3.1-fast 或 veo3.1-quality。')
    }

    const imageUrls = await Promise.all(imageRefs.slice(0, isVeo31 ? 3 : 9).map((ref) => uploadApimartMedia(provider, ref, 120000, transport)))
    const videoUrls = await Promise.all(videoRefs.slice(0, 3).map((ref) => uploadApimartMedia(provider, ref, 180000, transport)))
    const audioUrls = await Promise.all(audioRefs.slice(0, 3).map((ref) => uploadApimartMedia(provider, ref, 180000, transport)))

    if (isVeo31) {
      const veoDuration = Math.max(4, Math.min(8, duration))
      body = {
        prompt: String(params.prompt || '').trim(),
        model: apimartModel,
        duration: veoDuration,
        aspect_ratio: aspect === '9:16' ? '9:16' : '16:9',
        resolution: String(params.resolution || '').toLowerCase() === '4k'
          ? '4k'
          : String(params.resolution || '').toLowerCase().includes('1080')
            ? '1080p'
            : '720p',
        ...(params.generate_audio ? { generate_audio: true } : {}),
      }
      if (imageUrls.length && apimartModel !== 'veo3.1-lite') {
        body.image_urls = imageUrls
        if (imageUrls.length === 2) body.generation_type = 'frame'
        else if (imageUrls.length >= 3 && apimartModel !== 'veo3.1-quality') body.generation_type = 'reference'
      }
    } else {
      body = {
        prompt: String(params.prompt || '').trim(),
        model: apimartModel || 'doubao-seedance-2.0',
        duration: Math.max(4, Math.min(15, duration)),
        size: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].includes(aspect) ? aspect : '16:9',
        resolution: params.resolution || '480p',
        ...(params.generate_audio ? { generate_audio: true } : {}),
      }
      const roleImages = imageRefs.some((ref) => String(ref.role || '').trim())
      if (roleImages) {
        body.image_with_roles = imageUrls.map((url, index) => ({
          url,
          role: String(imageRefs[index]?.role || 'reference_image').trim() || 'reference_image',
        }))
      } else if (imageUrls.length) {
        body.image_urls = imageUrls
      }
      if (videoUrls.length) body.video_urls = videoUrls
      if (audioUrls.length) body.audio_urls = audioUrls
    }
  } else {
    body = buildCommonBody()
    if (imageRefs.length) {
      const imageValues = imageRefs.slice(0, 9).map((ref) => String(ref.publicUrl || mediaDataUrl(ref)))
      const template = (declaredOperation as { bodyTemplate?: Record<string, unknown> } | undefined)?.bodyTemplate || {}
      if ((!declaredRuntime || 'image' in template) && (!('reference_images' in template) || imageValues.length === 1)) {
        body.image = rawProtocol === 'grok2api' ? { url: imageValues[0] } : imageValues[0]
      }
      if ('reference_images' in template && imageValues.length > 1) body.reference_images = imageValues.map((url) => ({ url }))
      if (!declaredRuntime || 'images' in template) body.images = imageValues
      const roles = imageRefs.slice(0, 9).map((ref) => String(ref.role || '').trim())
      if (roles.some(Boolean)) body.image_roles = roles
    }
    if (videoRefs.length) {
      const videoValues = videoRefs.slice(0, 3).map((ref) => String(ref.publicUrl || mediaDataUrl(ref)))
      const template = (declaredOperation as { bodyTemplate?: Record<string, unknown> } | undefined)?.bodyTemplate || {}
      if ('video' in template) body.video = rawProtocol === 'grok2api' ? { url: videoValues[0] } : videoValues[0]
      if (!declaredRuntime || 'videos' in template) body.videos = videoValues
    }
    if (audioRefs.length) {
      const audioValues = audioRefs.slice(0, 3).map((ref) => String(ref.publicUrl || mediaDataUrl(ref)))
      const template = (declaredOperation as { bodyTemplate?: Record<string, unknown> } | undefined)?.bodyTemplate || {}
      if ('reference_audios' in template) body.reference_audios = audioValues.map((url) => ({ url }))
      if (!declaredRuntime || 'audios' in template) body.audios = audioValues
    }
    if (declaredRuntime) {
      const allowed = new Set(Object.keys((declaredOperation as { bodyTemplate?: Record<string, unknown> } | undefined)?.bodyTemplate || {}))
      for (const key of Object.keys(body)) if (!allowed.has(key)) delete body[key]
    }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const declaredPath = String((declaredOperation as { path?: string } | undefined)?.path || '').trim()
    const submitUrls = proto === 'apimart' || proto === 'apimart-media'
      ? [joinUrl(provider.base_url, '/v1/videos/generations')]
      : declaredPath
        ? [joinUrl(provider.base_url, declaredPath)]
        : [joinUrl(provider.base_url, '/v1/videos/generations'), joinUrl(provider.base_url, '/v2/videos/generations')]
    let payload: any = null
    let submitUrl = submitUrls[0]
    let lastError = ''
    for (let i = 0; i < submitUrls.length; i++) {
      submitUrl = submitUrls[i]
      const resp = await transport.fetch(submitUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
      const text = await resp.text()
      let candidate: any
      try { candidate = JSON.parse(text) } catch { candidate = text }
      if (!resp.ok) {
        lastError = `HTTP ${resp.status}: ${text.slice(0, 500)}`
        if (i < submitUrls.length - 1 && [404, 405].includes(resp.status)) continue
        throw new Error(lastError)
      }
      payload = candidate
      break
    }
    if (payload == null) throw new Error(lastError || '视频提交失败')
    let urls = collectVideoUrls(payload).filter((url, index, list) => list.indexOf(url) === index)
    const taskId = extractVideoTaskId(payload)
    if (!urls.length && !taskId) {
      throw new Error(`视频提交响应未包含任务 ID 或视频地址：${JSON.stringify(payload).slice(0, 500)}`)
    }
    if (!urls.length && taskId) {
      const base = String(provider.base_url || '').replace(/\/+$/, '').replace(/\/v1$|\/v2$/i, '')
      const taskUrls = proto === 'grok2api'
        ? [`${base}/v1/videos/${encodeURIComponent(taskId)}`]
        : proto === 'apimart' || proto === 'apimart-media'
          ? [`${base}/v1/tasks/${encodeURIComponent(taskId)}?language=zh`, `${base}/tasks/${encodeURIComponent(taskId)}?language=zh`]
        : [
            `${base}${submitUrl.includes('/v2/') ? '/v2' : '/v1'}/videos/generations/${encodeURIComponent(taskId)}`,
            `${base}/v2/tasks/${encodeURIComponent(taskId)}`,
            `${base}/v1/videos/generations/${encodeURIComponent(taskId)}`,
            `${base}/v1/tasks/${encodeURIComponent(taskId)}`,
            `${base}/tasks/${encodeURIComponent(taskId)}`,
          ]
      const deadline = clock.now() + timeoutMs
      while (clock.now() < deadline) {
        await clock.sleep(2000)
        let taskPayload: any = null
        let lastError = ''
        for (const taskUrl of taskUrls) {
          try {
            const taskResp = await transport.fetch(taskUrl, { headers: { Accept: 'application/json', ...(buildAuthHeaders(runtimeDef, provider.api_key)) }, signal: ctrl.signal })
            const taskText = await taskResp.text()
            if (!taskResp.ok) { lastError = `HTTP ${taskResp.status}: ${taskText.slice(0, 300)}`; continue }
            taskPayload = JSON.parse(taskText)
            break
          } catch (e) { lastError = String((e as Error).message || e) }
        }
        if (!taskPayload) throw new Error(`视频任务查询失败：${lastError || taskId}`)
        urls = collectVideoUrls(taskPayload).filter((url, index, list) => list.indexOf(url) === index)
        if (urls.length) break
        const status = videoStatus(taskPayload)
        if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED', 'TIMEOUT', 'REJECTED'].includes(status)) {
          throw new Error(`视频任务失败：${JSON.stringify(taskPayload).slice(0, 500)}`)
        }
      }
    }
    if (!urls.length) throw new Error('视频接口调用成功，但没有返回视频地址')
    return { videos: urls.map((value) => ({ type: 'url', value })), raw: payload }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('视频生成超时，请重试或换更快的模型。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function audioRuntimeDefinition(protocol: string, intent: 'audio.tts' | 'audio.transcribe' | 'audio.translate' | 'audio.music') {
  const raw = String(protocol || '').trim().toLowerCase()
  const normalized = normalizeProtocol(raw)
  const protocolId = DECLARED_AUDIO_RUNTIME_PROTOCOL_IDS.has(raw) || raw === 'apimart-media' ? raw : normalized
  const def = PROTOCOLS[protocolId]
  const operation = def?.operations?.[intent] as { path?: string; bodyTemplate?: Record<string, unknown> } | undefined
  if (!def || !operation?.path) throw new Error(`音频协议「${raw || protocolId}」不支持 ${intent}`)
  return { def, operation, protocolId }
}

export async function generateSpeech(
  provider: ResolvedProvider,
  model: string,
  params: SpeechParams,
  timeoutMs = 300000,
): Promise<{ data: Buffer; mime: string; raw?: unknown }> {
  const input = String(params.input || '').trim()
  if (!input) throw new Error('缺少要合成的文本')
  const { def, operation } = audioRuntimeDefinition(provider.protocol, 'audio.tts')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(joinUrl(provider.base_url, String(operation.path)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...def.headers, ...buildAuthHeaders(def, provider.api_key) },
      body: JSON.stringify({
        model,
        input,
        voice: String(params.voice || 'alloy'),
        response_format: String(params.response_format || 'mp3'),
        speed: Math.max(0.25, Math.min(4, Number(params.speed) || 1)),
      }),
      signal: ctrl.signal,
    })
    if (!resp.ok) throw new Error(`语音合成失败（HTTP ${resp.status}）：${(await resp.text()).slice(0, 500)}`)
    return { data: Buffer.from(await resp.arrayBuffer()), mime: (resp.headers.get('content-type') || 'audio/mpeg').split(';')[0] }
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('语音合成超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function transcribeAudio(
  provider: ResolvedProvider,
  model: string,
  input: EditImageInput,
  params: AudioTranscriptionParams = {},
  timeoutMs = 300000,
): Promise<{ text: string; raw: unknown }> {
  const intent = params.translate ? 'audio.translate' : 'audio.transcribe'
  const { def, operation } = audioRuntimeDefinition(provider.protocol, intent)
  const form = new FormData()
  form.append('model', model)
  form.append('file', new Blob([new Uint8Array(input.buf)], { type: input.mime || 'audio/mpeg' }), input.name || 'audio.mp3')
  if (!params.translate && params.language) form.append('language', params.language)
  if (params.prompt) form.append('prompt', params.prompt)
  form.append('response_format', params.response_format || 'json')
  if (params.temperature !== undefined) form.append('temperature', String(params.temperature))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(joinUrl(provider.base_url, String(operation.path)), {
      method: 'POST',
      headers: { Accept: 'application/json', ...def.headers, ...buildAuthHeaders(def, provider.api_key) },
      body: form,
      signal: ctrl.signal,
    })
    const rawText = await resp.text()
    let raw: any
    try { raw = JSON.parse(rawText) } catch { raw = rawText }
    if (!resp.ok) throw new Error(`音频${params.translate ? '翻译' : '转写'}失败（HTTP ${resp.status}）：${rawText.slice(0, 500)}`)
    const text = typeof raw === 'string' ? raw : String(raw?.text || raw?.data?.text || '').trim()
    if (!text) throw new Error('音频接口成功，但没有返回文本')
    return { text, raw }
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('音频处理超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function collectAudioUrls(value: any, out: string[] = [], depth = 0, keyHint = ''): string[] {
  if (depth > 6 || value == null) return out
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && (/audio|music|url|output|result|content|download/i.test(keyHint) || /\.(mp3|wav|m4a|aac|flac|ogg)(\?|#|$)/i.test(value))) out.push(value)
    return out
  }
  if (Array.isArray(value)) { value.forEach((item) => collectAudioUrls(item, out, depth + 1, keyHint)); return out }
  if (typeof value !== 'object') return out
  for (const [key, item] of Object.entries(value)) collectAudioUrls(item, out, depth + 1, /audio|music|url|output|result|content|download/i.test(key) ? key : keyHint)
  return out
}

export async function generateMusic(
  provider: ResolvedProvider,
  model: string,
  params: MusicParams,
  timeoutMs = 900000,
): Promise<{ audios: Array<{ type: 'url'; value: string }>; raw: unknown }> {
  const prompt = String(params.prompt || '').trim()
  if (!prompt) throw new Error('缺少音乐生成提示词')
  const { def, operation, protocolId } = audioRuntimeDefinition(provider.protocol, 'audio.music')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(joinUrl(provider.base_url, String(operation.path)), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...def.headers, ...buildAuthHeaders(def, provider.api_key) },
      body: JSON.stringify({ model, prompt, title: params.title || '', lyrics: params.lyrics || '', style: params.style || '', instrumental: params.instrumental === true }),
      signal: ctrl.signal,
    })
    const text = await resp.text()
    let payload: any
    try { payload = JSON.parse(text) } catch { payload = text }
    if (!resp.ok) throw new Error(`音乐生成失败（HTTP ${resp.status}）：${text.slice(0, 500)}`)
    let urls = collectAudioUrls(payload).filter((url, index, list) => list.indexOf(url) === index)
    const taskId = extractVideoTaskId(payload)
    if (!urls.length && taskId) {
      const base = String(provider.base_url || '').replace(/\/+$/, '').replace(/\/v1$|\/v2$/i, '')
      const taskUrls = protocolId === 'apimart-media'
        ? [`${base}/v1/tasks/${encodeURIComponent(taskId)}?language=zh`, `${base}/tasks/${encodeURIComponent(taskId)}?language=zh`]
        : [`${base}/v2/music/generations/${encodeURIComponent(taskId)}`, `${base}/v2/tasks/${encodeURIComponent(taskId)}`, `${base}/v1/tasks/${encodeURIComponent(taskId)}`, `${base}/tasks/${encodeURIComponent(taskId)}`]
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        let taskPayload: any = null
        for (const url of taskUrls) {
          const taskResp = await fetch(url, { headers: { Accept: 'application/json', ...buildAuthHeaders(def, provider.api_key) }, signal: ctrl.signal })
          if (!taskResp.ok) continue
          taskPayload = await taskResp.json()
          break
        }
        if (!taskPayload) throw new Error(`音乐任务查询失败：${taskId}`)
        urls = collectAudioUrls(taskPayload).filter((url, index, list) => list.indexOf(url) === index)
        if (urls.length) break
        if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED', 'TIMEOUT', 'REJECTED'].includes(videoStatus(taskPayload))) throw new Error(`音乐任务失败：${JSON.stringify(taskPayload).slice(0, 500)}`)
      }
    }
    if (!urls.length) throw new Error('音乐接口成功，但没有返回音频地址')
    return { audios: urls.map((value) => ({ type: 'url', value })), raw: payload }
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('音乐生成超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// ── 图像编辑（OpenAI 兼容 /v1/images/edits，multipart/form-data）─────────
// 单图用字段名 image；多图用 image[]（gpt-image 系列）。不手动设 Content-Type，
// 交给 fetch 依据 FormData 生成 multipart boundary。
export async function editImages(
  provider: ResolvedProvider,
  model: string,
  params: GenImageParams,
  inputs: EditImageInput[],
  timeoutMs = 300000,
  transport: ProtocolTransport = defaultProtocolTransport,
): Promise<{ images: GenImage[]; raw: unknown }> {
  const rawProto = String(provider.protocol || '').trim().toLowerCase()
  if (rawProto === 'cli:jimeng' || rawProto === 'jimeng-cli') {
    if (!inputs.length) throw new Error('图像编辑需要至少一张参考图')
    const imagePaths = inputs.map((input) => tempMediaFile(input.buf, input.mime || 'image/png', '.png'))
    const result = await generateJimengImage(
      String(params.prompt || '').trim(),
      model || 'jimeng-5.0Pro',
      String(params.size || '1024x1024'),
      imagePaths,
    )
    return { images: result.images.map((value) => ({ type: 'url' as const, value })), raw: result.raw }
  }
  if (rawProto === 'cli:codex' || rawProto === 'codex-cli') {
    const imagePaths = inputs.map((input) => tempMediaFile(input.buf, input.mime || 'image/png', '.png'))
    const result = await editCodexImage(String(params.prompt || '').trim(), imagePaths, model || 'gpt-image-2', String(params.size || '1024x1024'))
    return { images: result.images.map((value) => ({ type: 'url' as const, value })), raw: result.raw }
  }
  if (rawProto === 'agnes') return editAgnesImages(provider, model, params, inputs, timeoutMs, transport)
  if (rawProto === 'modelscope') return editModelScopeImages(provider, model, params, inputs, timeoutMs)
  if (rawProto === 'volcengine') return generateVolcengineImages(provider, model, params, inputs, timeoutMs)
  if (rawProto === 'runninghub') return editRunningHubImages(provider, model, params, inputs, timeoutMs)
  if (rawProto === 'grok2api') {
    if (!inputs.length) throw new Error('图像编辑需要至少一张参考图')
    return requestGrok2ApiImages(provider, model, params, inputs, timeoutMs)
  }
  if (rawProto === 'zkki' || rawProto === 'zkki-model') {
    if (!inputs.length) throw new Error('图像编辑需要至少一张参考图')
    return requestZkkiImages(provider, model, params, inputs, timeoutMs)
  }
  if (rawProto === 'midjourney') return generateMidjourneyImages(provider, model, params, timeoutMs, inputs)
  assertRunnableProtocol(rawProto, '图像编辑')
  const proto = normalizeProtocol(provider.protocol)
  if (!inputs.length) throw new Error('图像编辑需要至少一张参考图')
  const useApibOpenAiCompatibility = isApibOpenAiImageProvider(provider)
  if ((proto === 'apimart' || proto === 'apimart-gemini' || proto === 'apimart-media') && !useApibOpenAiCompatibility) {
    return generateApimartImages(provider, model, params, timeoutMs, inputs, transport)
  }
  if (proto === 'gemini') return generateGeminiImages(provider, model, params, timeoutMs, inputs)
  if (proto !== 'openai' && !useApibOpenAiCompatibility) {
    throw new Error(`当前模型协议「${rawProto || proto}」暂不支持参考图生成，请选择已声明图像编辑能力的模型。`)
  }
  if (useApibOpenAiCompatibility || rawProto === 'gemini-generations' || (rawProto === 'openai-image' && usesGenerationEndpointForImageEdit(model))) {
    return editOpenAiCompatibleGenerationImages(provider, model, params, inputs, timeoutMs)
  }
  const def = PROTOCOLS.openai
  const useGptBestAsync = isGptBestAsyncImageProvider(provider)
  const url = joinUrl(provider.base_url, `/v1/images/edits${useGptBestAsync ? '?async=true' : ''}`)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', String(params.prompt || '').trim())
  if (useApibOpenAiCompatibility) form.append('size', apibImageAspectRatio(params.size))
  else if (params.size && params.size !== 'auto') form.append('size', params.size)
  const quality = openAiImageQuality(provider, model, params.quality)
  if (quality) form.append('quality', quality)
  if (params.n) form.append('n', String(Math.max(1, Math.min(4, Number(params.n) || 1))))
  const outboundInputs = useApibOpenAiCompatibility ? await prepareApibEditInputs(inputs) : inputs
  const field = outboundInputs.length > 1 ? 'image[]' : 'image'
  for (const img of outboundInputs) {
    form.append(field, new Blob([new Uint8Array(img.buf)], { type: img.mime || 'image/png' }), img.name || 'image.png')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: form, signal: ctrl.signal })
    const text = await resp.text()
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
    if (!resp.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload)
      throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 500)}`)
    }
    const images = parseImagePayload(payload)
    if (images.length) return { images, raw: payload }
    const taskId = imageTaskId(payload)
    if (taskId) return pollGptBestImageTask(provider, taskId, headers, timeoutMs)
    return { images: [], raw: payload }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('图像编辑超时，请重试或换更快的模型。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ── 图片理解（OpenAI 兼容多模态 chat）─────────────────────────────────
// 把 dataUrl（data:image/...;base64,xxx）连同提示词发给视觉模型，返回文本描述。
export async function describeImage(
  provider: ResolvedProvider,
  model: string,
  dataUrl: string | string[],
  prompt: string,
  timeoutMs = 120000,
): Promise<string> {
  const dataUrls = (Array.isArray(dataUrl) ? dataUrl : [dataUrl]).filter(Boolean)
  if (!dataUrls.length) throw new Error('没有可供模型读取的图片。')
  const proto = normalizeProtocol(provider.protocol)
  if (proto === 'runninghub') return describeRunningHubImage(provider, model, dataUrls, prompt, timeoutMs)
  if (proto === 'apimart' || proto === 'gemini') {
    const def = PROTOCOLS[proto]
    const modelName = String(model || '').replace(/^models\//, '')
    const endpoint = proto === 'apimart'
      ? `https://api.apimart.ai/v1beta/models/${encodeURIComponent(modelName)}:generateContent`
      : joinUrl(provider.base_url, `/v1beta/models/${encodeURIComponent(modelName)}:generateContent`)
    const header: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(def.headers || {}),
      ...buildAuthHeaders(def, provider.api_key),
    }
    const inlineImages = dataUrls.map((url) => {
      const marker = ';base64,'
      const splitAt = url.indexOf(marker)
      const mime = url.startsWith('data:') ? url.slice(5, url.indexOf(';')) || 'image/png' : 'image/png'
      const encoded = splitAt >= 0 ? url.slice(splitAt + marker.length) : ''
      return encoded ? { inlineData: { mimeType: mime, data: encoded } } : null
    }).filter(Boolean)
    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          ...inlineImages,
        ],
      }],
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const resp = await fetch(endpoint, { method: 'POST', headers: header, body: JSON.stringify(body), signal: ctrl.signal })
      const text = await resp.text()
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 400)}`)
      let payload: any
      try {
        payload = JSON.parse(text)
      } catch {
        throw new Error('返回不是有效 JSON')
      }
      return parseBody('gemini_text', unwrapProviderPayload(def, payload)).text
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error('图片理解超时，请重试或换视觉模型。')
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
  const def = PROTOCOLS[proto]
  const vision = def?.capabilities.vlm
  if (!vision) throw new Error(`当前协议 ${proto} 不支持图片理解。`)
  const url = joinUrl(provider.base_url, vision.endpoint.replace('{model}', encodeURIComponent(model)))
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  const decodedImages = dataUrls.map((value) => {
    const match = value.match(/^data:([^;,]+);base64,(.+)$/s)
    return match ? { mime: match[1], data: match[2] } : null
  }).filter((item): item is { mime: string; data: string } => !!item)
  const body = vision.body === 'anthropic_messages'
    ? {
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: [
          ...decodedImages.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } })),
          { type: 'text', text: prompt },
        ] }],
      }
    : {
        model,
        stream: false,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          ...dataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ] }],
      }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    const text = await resp.text()
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 400)}`)
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error('返回不是有效 JSON')
    }
    return parseBody(vision.parse, unwrapProviderPayload(def, payload)).text
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('图片理解超时，请重试或换视觉模型。')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 拉取一个站点可用的模型列表。 */
export async function fetchModels(provider: ResolvedProvider, timeoutMs = 20000): Promise<string[]> {
  const proto = normalizeProtocol(provider.protocol)
  if (proto === 'runninghub') return (await fetchRunningHubModels(provider, timeoutMs)).map((item) => item.model)
  const def = PROTOCOLS[proto]
  const url = joinUrl(provider.base_url, def.models.endpoint)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(def.headers || {}),
    ...buildAuthHeaders(def, provider.api_key),
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { headers, signal: ctrl.signal })
    const text = await resp.text()
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 400)}`)
    const payload = JSON.parse(text)
    return parseModels(def.models.kind, payload)
  } finally {
    clearTimeout(timer)
  }
}
