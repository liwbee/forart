import type { CanvasNodePortDefinition, CanvasPortValueType } from './canvasPlugin.ts'

function arrayBase(type: CanvasPortValueType) {
  return type.endsWith('[]') ? type.slice(0, -2) : type
}

function isArrayType(type: CanvasPortValueType) { return type.endsWith('[]') }

export interface CanvasPortCompatibility {
  ok: boolean
  coercion: 'none' | 'wrap' | 'flatten' | 'artifact' | 'file' | null
  reason?: string
}

/** Pure compatibility check shared by the editor, installer and execution runtime. */
export function canvasPortCompatibility(source: CanvasNodePortDefinition, target: CanvasNodePortDefinition): CanvasPortCompatibility {
  if (source.type === target.type) return { ok: true, coercion: 'none' }
  if (target.type === 'artifact') return { ok: source.type !== 'event', coercion: source.type === 'event' ? null : 'artifact', reason: source.type === 'event' ? '事件端口不能作为数据制品连接' : undefined }
  if (target.type === 'file' && (source.type.startsWith('media.') || source.type === 'file')) return { ok: !isArrayType(source.type), coercion: 'file' }
  if (target.type === 'file[]' && (source.type.startsWith('media.') || source.type === 'file' || source.type === 'file[]')) return { ok: true, coercion: isArrayType(source.type) ? 'file' : 'wrap' }
  if (target.type === 'json' && source.type === 'table') return { ok: true, coercion: 'none' }
  const sourceBase = arrayBase(source.type)
  const targetBase = arrayBase(target.type)
  if (sourceBase === targetBase) {
    if (!isArrayType(source.type) && isArrayType(target.type)) return { ok: true, coercion: 'wrap' }
    if (isArrayType(source.type) && !isArrayType(target.type)) {
      return target.multiple ? { ok: true, coercion: 'flatten' } : { ok: false, coercion: null, reason: '多值输出不能连接到单值输入' }
    }
  }
  return { ok: false, coercion: null, reason: `${source.type} 不能连接到 ${target.type}` }
}

export function canConnectCanvasPorts(source: CanvasNodePortDefinition, target: CanvasNodePortDefinition) {
  return canvasPortCompatibility(source, target).ok
}
