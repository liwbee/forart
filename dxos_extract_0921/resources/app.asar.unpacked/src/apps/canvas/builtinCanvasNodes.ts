import type { CanvasNodeDefinition } from '../../../shared/canvasPlugin'
import type { CanvasCard } from './canvasTypes'
import type { CanvasNodeRegistry } from './canvasNodeRegistry'

const textInput = { id: 'prompt', title: '文本', type: 'text' as const, required: false, multiple: true }
const mediaInputs = [
  { id: 'images', title: '图片', type: 'media.image[]' as const, multiple: true },
  { id: 'videos', title: '视频', type: 'media.video[]' as const, multiple: true },
  { id: 'audios', title: '音频', type: 'media.audio[]' as const, multiple: true },
]
const generationInputs = [textInput, ...mediaInputs, { id: 'table', title: '表格', type: 'table' as const }, { id: 'artifacts', title: '通用输入', type: 'artifact' as const, multiple: true }]

export const BUILTIN_CANVAS_NODES: CanvasNodeDefinition[] = [
  {
    type: 'builtin.image-asset', version: 1, stateVersion: 1, title: '图片', category: 'asset',
    defaultSize: { width: 500, height: 500 }, inputs: [],
    outputs: [{ id: 'image', title: '图片', type: 'media.image' }],
    executor: { type: 'builtin', id: 'canvas.asset.image' },
  },
  {
    type: 'builtin.video-asset', version: 1, stateVersion: 1, title: '视频', category: 'asset',
    defaultSize: { width: 600, height: 338 }, inputs: [],
    outputs: [{ id: 'video', title: '视频', type: 'media.video' }],
    executor: { type: 'builtin', id: 'canvas.asset.video' },
  },
  {
    type: 'builtin.audio-asset', version: 1, stateVersion: 1, title: '音频', category: 'asset',
    defaultSize: { width: 500, height: 180 }, inputs: [],
    outputs: [{ id: 'audio', title: '音频', type: 'media.audio' }],
    executor: { type: 'builtin', id: 'canvas.asset.audio' },
  },
  {
    type: 'builtin.file-asset', version: 1, stateVersion: 1, title: '文件', category: 'asset',
    defaultSize: { width: 360, height: 180 }, inputs: [],
    outputs: [{ id: 'file', title: '文件', type: 'file' }],
    executor: { type: 'builtin', id: 'canvas.asset.file' },
  },
  {
    type: 'builtin.image-generator', version: 1, stateVersion: 1, title: '图片生成', category: 'generation',
    defaultSize: { width: 300, height: 190 }, inputs: generationInputs,
    outputs: [{ id: 'images', title: '图片结果', type: 'media.image[]', multiple: true }],
    executor: { type: 'builtin', id: 'canvas.generate.image' },
  },
  {
    type: 'builtin.video-generator', version: 1, stateVersion: 1, title: '视频生成', category: 'generation',
    defaultSize: { width: 360, height: 220 }, inputs: generationInputs,
    outputs: [{ id: 'videos', title: '视频结果', type: 'media.video[]', multiple: true }],
    executor: { type: 'builtin', id: 'canvas.generate.video' },
  },
  {
    type: 'builtin.audio-generator', version: 1, stateVersion: 1, title: '音频生成', category: 'generation',
    defaultSize: { width: 360, height: 220 }, inputs: generationInputs,
    outputs: [{ id: 'audios', title: '音频结果', type: 'media.audio[]', multiple: true }],
    executor: { type: 'builtin', id: 'canvas.generate.audio' },
  },
  {
    type: 'builtin.llm', version: 1, stateVersion: 1, title: 'LLM', category: 'ai',
    defaultSize: { width: 360, height: 310 }, inputs: generationInputs,
    outputs: [{ id: 'text', title: '文本', type: 'text' }, { id: 'table', title: '表格', type: 'table' }],
    executor: { type: 'builtin', id: 'canvas.llm' },
  },
  {
    type: 'builtin.table', version: 1, stateVersion: 1, title: '多维表格', category: 'data',
    defaultSize: { width: 520, height: 320 },
    inputs: [{ id: 'rows', title: '输入', type: 'artifact', multiple: true }],
    outputs: [{ id: 'table', title: '表格', type: 'table' }, { id: 'rows', title: '行', type: 'json', multiple: true }],
    executor: { type: 'builtin', id: 'canvas.table' },
  },
  {
    type: 'builtin.group', version: 1, stateVersion: 1, title: '分组', category: 'layout',
    defaultSize: { width: 560, height: 380 }, inputs: [], outputs: [],
    executor: { type: 'builtin', id: 'canvas.group' },
  },
  {
    type: 'builtin.prompt', version: 1, stateVersion: 1, title: '提示词', category: 'text',
    defaultSize: { width: 300, height: 180 }, inputs: [{ id: 'text', title: '文本输入', type: 'text' }],
    outputs: [{ id: 'text', title: '文本', type: 'text' }],
    executor: { type: 'builtin', id: 'canvas.prompt' },
  },
  {
    type: 'builtin.sticky', version: 1, stateVersion: 1, title: '便签', category: 'text',
    defaultSize: { width: 240, height: 220 }, inputs: [],
    outputs: [{ id: 'text', title: '文本', type: 'text' }],
    executor: { type: 'builtin', id: 'canvas.sticky' },
  },
  {
    type: 'builtin.junction', version: 1, stateVersion: 1, title: '转接点', category: 'flow',
    defaultSize: { width: 68, height: 42 },
    inputs: [{ id: 'in', title: '输入', type: 'artifact', multiple: true }],
    outputs: [{ id: 'out', title: '输出', type: 'artifact', multiple: true }],
    executor: { type: 'builtin', id: 'canvas.junction' },
  },
]

export function registerBuiltinCanvasNodes(registry: CanvasNodeRegistry) {
  for (const definition of BUILTIN_CANVAS_NODES) registry.register(definition, { kind: 'builtin' })
  return registry
}

/** Maps old documents to SDK node identities without rewriting them on open. */
export function builtinNodeTypeForCard(card: CanvasCard): string {
  if (card.nodeType?.startsWith('builtin.')) return card.nodeType
  if (card.kind === 'group') return 'builtin.group'
  if (card.kind === 'prompt') return 'builtin.prompt'
  if (card.kind === 'sticky') return 'builtin.sticky'
  if (card.kind === 'junction' || card.hub?.kind === 'junction') return 'builtin.junction'
  if (card.kind === 'llm' || card.appId === 'llm.text-generate' || card.appId === 'canvas.llm') return 'builtin.llm'
  if (card.kind === 'table') return 'builtin.table'
  if (card.kind === 'generator' || card.appId?.startsWith('canvas.generate.')) {
    if (card.appId === 'canvas.generate.audio') return 'builtin.audio-generator'
    if (card.appId === 'canvas.generate.video' || ['t2v', 'i2v', 'v2v', 'ia2v'].includes(card.params.mode)) return 'builtin.video-generator'
    return 'builtin.image-generator'
  }
  const media = card.result || card.inputs[0]
  if (media?.kind === 'video') return 'builtin.video-asset'
  if (media?.kind === 'audio') return 'builtin.audio-asset'
  if (media?.kind === 'file') return 'builtin.file-asset'
  return 'builtin.image-asset'
}
