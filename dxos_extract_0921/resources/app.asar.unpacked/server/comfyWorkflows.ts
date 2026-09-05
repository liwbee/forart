import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT, dataPath } from './dataPaths.ts'
import sharp from 'sharp'
import { loadComfyConfig } from './comfyui.ts'

const DATA_DIR = DATA_ROOT
const STORE_PATH = dataPath('comfy-workflows.json')
const COVER_DIR = dataPath('comfy-workflow-covers')
const AUTO_INSTANCE_ID = 'auto'

export type ComfyFieldType = 'image' | 'video' | 'audio' | 'file' | 'text' | 'textarea' | 'number' | 'slider' | 'select' | 'boolean' | 'seed'

export interface ComfyWorkflowField {
  id: string
  label: string
  description?: string
  type: ComfyFieldType
  nodeId: string
  input: string
  default?: unknown
  required?: boolean
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string; value: string | number }>
}

export interface ComfyWorkflowOutput {
  id: string
  label: string
  nodeId: string
  type: 'image' | 'video' | 'audio' | 'file' | 'text'
}

export interface ComfyWorkflowPreset {
  id: string
  ownerId: string
  name: string
  description: string
  coverUrl: string
  instanceId: string
  workflow: Record<string, ApiNode>
  fields: ComfyWorkflowField[]
  outputs: ComfyWorkflowOutput[]
  createdAt: number
  updatedAt: number
}

interface ApiNode {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}

export interface ComfyRunResult {
  name: string
  type: string
  subfolder?: string
  outputType?: string
  nodeId: string
  url?: string
  text?: string
  label?: string
}

export interface ComfyWorkflowRun {
  id: string
  ownerId: string
  presetId: string
  instanceId: string
  status: 'queued' | 'uploading' | 'running' | 'completed' | 'failed'
  progress: number
  promptId: string
  error: string
  results: ComfyRunResult[]
  createdAt: number
  updatedAt: number
}

const runs = new Map<string, ComfyWorkflowRun>()

export function comfyWorkflowRunStats() {
  let active = 0
  for (const run of runs.values()) if (run.status === 'queued' || run.status === 'uploading' || run.status === 'running') active += 1
  return { runs: runs.size, active, completed: runs.size - active }
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function readStore(): ComfyWorkflowPreset[] {
  ensureDataDir()
  if (!existsSync(STORE_PATH)) return []
  try {
    const value = JSON.parse(readFileSync(STORE_PATH, 'utf8'))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeStore(items: ComfyWorkflowPreset[]) {
  ensureDataDir()
  writeFileSync(STORE_PATH, JSON.stringify(items, null, 2), 'utf8')
}

function coverId(url: string) {
  return String(url || '').match(/^\/api\/comfyui\/workflow-covers\/([a-f0-9-]+\.webp)$/i)?.[1] || ''
}

function removeCover(url: string) {
  const id = coverId(url)
  if (!id) return
  const path = join(COVER_DIR, id)
  if (existsSync(path)) unlinkSync(path)
}

function apiWorkflow(value: unknown): Record<string, ApiNode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工作流必须是 JSON 对象')
  const source = value as Record<string, unknown>
  if (Array.isArray(source.nodes) && !Object.values(source).some((item) => item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).class_type === 'string')) {
    throw new Error('这不是 ComfyUI API 工作流，请在 ComfyUI 中选择“导出（API）”')
  }
  const prompt = source.prompt && typeof source.prompt === 'object' && !Array.isArray(source.prompt)
    ? source.prompt as Record<string, unknown>
    : source
  const entries = Object.entries(prompt)
  if (!entries.length) throw new Error('工作流中没有节点')
  const normalized: Record<string, ApiNode> = {}
  for (const [nodeId, raw] of entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`节点 ${nodeId} 格式无效`)
    const node = raw as Record<string, unknown>
    if (typeof node.class_type !== 'string' || !node.class_type) {
      throw new Error('这不是 ComfyUI API 工作流，请在 ComfyUI 中选择“导出（API）”')
    }
    normalized[nodeId] = {
      class_type: node.class_type,
      inputs: node.inputs && typeof node.inputs === 'object' && !Array.isArray(node.inputs)
        ? structuredClone(node.inputs as Record<string, unknown>)
        : {},
      ...(node._meta && typeof node._meta === 'object' ? { _meta: structuredClone(node._meta as { title?: string }) } : {}),
    }
  }
  return normalized
}

function safeFields(value: unknown, workflow: Record<string, ApiNode>): ComfyWorkflowField[] {
  if (!Array.isArray(value)) return []
  return value.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Partial<ComfyWorkflowField> : {}
    const nodeId = String(item.nodeId || '')
    const input = String(item.input || '')
    if (!workflow[nodeId] || !(input in workflow[nodeId].inputs)) throw new Error(`映射字段 ${index + 1} 指向不存在的节点输入`)
    const allowed: ComfyFieldType[] = ['image', 'video', 'audio', 'file', 'text', 'textarea', 'number', 'slider', 'select', 'boolean', 'seed']
    const type = allowed.includes(item.type as ComfyFieldType) ? item.type as ComfyFieldType : 'text'
    return {
      id: String(item.id || randomUUID()),
      label: String(item.label || input),
      type,
      nodeId,
      input,
      ...(item.description ? { description: String(item.description) } : {}),
      ...('default' in item ? { default: item.default } : {}),
      required: item.required !== false,
      ...(Number.isFinite(Number(item.min)) ? { min: Number(item.min) } : {}),
      ...(Number.isFinite(Number(item.max)) ? { max: Number(item.max) } : {}),
      ...(Number.isFinite(Number(item.step)) ? { step: Number(item.step) } : {}),
      ...(Array.isArray(item.options) ? { options: item.options.map((option) => ({ label: String(option.label), value: option.value })) } : {}),
    }
  })
}

function safeOutputs(value: unknown, workflow: Record<string, ApiNode>): ComfyWorkflowOutput[] {
  if (!Array.isArray(value)) return []
  return value.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Partial<ComfyWorkflowOutput> : {}
    const nodeId = String(item.nodeId || '')
    if (!workflow[nodeId]) throw new Error(`输出 ${index + 1} 指向不存在的节点`)
    const allowed = ['image', 'video', 'audio', 'file', 'text'] as const
    return {
      id: String(item.id || randomUUID()),
      label: String(item.label || workflow[nodeId]._meta?.title || `输出 ${index + 1}`),
      nodeId,
      type: allowed.includes(item.type as typeof allowed[number]) ? item.type as typeof allowed[number] : 'image',
    }
  })
}

export function inspectComfyWorkflow(value: unknown) {
  const workflow = apiWorkflow(value)
  return {
    workflow,
    nodes: Object.entries(workflow).map(([id, node]) => ({
      id,
      classType: node.class_type,
      title: String(node._meta?.title || node.class_type),
      inputs: Object.entries(node.inputs).map(([name, value]) => ({ name, value, connected: Array.isArray(value) && value.length === 2 })),
    })),
  }
}

export function listComfyWorkflows(ownerId: string) {
  return readStore().filter((item) => item.ownerId === ownerId).map((item) => ({ ...item, workflow: undefined }))
}

export function getComfyWorkflow(ownerId: string, id: string) {
  const item = readStore().find((preset) => preset.id === id && preset.ownerId === ownerId)
  if (!item) throw new Error('API 工作流不存在')
  return item
}

export function saveComfyWorkflow(ownerId: string, input: Partial<ComfyWorkflowPreset>) {
  const items = readStore()
  const existing = input.id ? items.find((item) => item.id === input.id && item.ownerId === ownerId) : undefined
  const workflow = apiWorkflow(input.workflow || existing?.workflow)
  const now = Date.now()
  const preset: ComfyWorkflowPreset = {
    id: existing?.id || randomUUID(),
    ownerId,
    name: String(input.name || existing?.name || '未命名工作流').trim() || '未命名工作流',
    description: String(input.description || existing?.description || '').trim(),
    coverUrl: 'coverUrl' in input ? String(input.coverUrl || '') : String(existing?.coverUrl || ''),
    instanceId: String(input.instanceId || existing?.instanceId || '').trim(),
    workflow,
    fields: safeFields(input.fields ?? existing?.fields, workflow),
    outputs: safeOutputs(input.outputs ?? existing?.outputs, workflow),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  if (!preset.instanceId) throw new Error('请选择默认 ComfyUI 实例')
  if (preset.instanceId !== AUTO_INSTANCE_ID && !loadComfyConfig().instances.some((item) => item.id === preset.instanceId)) throw new Error('所选 ComfyUI 实例不存在')
  if (preset.coverUrl && !coverId(preset.coverUrl)) throw new Error('封面地址无效')
  if (existing) items.splice(items.indexOf(existing), 1, preset)
  else items.push(preset)
  writeStore(items)
  if (existing?.coverUrl && existing.coverUrl !== preset.coverUrl) removeCover(existing.coverUrl)
  return preset
}

export async function saveComfyWorkflowCover(ownerId: string, id: string, file: { buffer: Buffer; mime?: string }) {
  if (!String(file.mime || '').startsWith('image/')) throw new Error('封面必须是图片文件')
  if (!file.buffer.length || file.buffer.length > 10 * 1024 * 1024) throw new Error('封面图片不能超过 10MB')
  const items = readStore()
  const preset = items.find((item) => item.id === id && item.ownerId === ownerId)
  if (!preset) throw new Error('API 工作流不存在')
  if (!existsSync(COVER_DIR)) mkdirSync(COVER_DIR, { recursive: true })
  const filename = `${randomUUID()}.webp`
  await sharp(file.buffer).rotate().resize(1200, 675, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 84 }).toFile(join(COVER_DIR, filename))
  const previous = preset.coverUrl
  preset.coverUrl = `/api/comfyui/workflow-covers/${filename}`
  preset.updatedAt = Date.now()
  writeStore(items)
  if (previous !== preset.coverUrl) removeCover(previous)
  return preset
}

export function getComfyWorkflowCover(ownerId: string, filename: string) {
  if (!/^[a-f0-9-]+\.webp$/i.test(filename)) throw new Error('封面不存在')
  const url = `/api/comfyui/workflow-covers/${filename}`
  if (!readStore().some((item) => item.ownerId === ownerId && item.coverUrl === url)) throw new Error('封面不存在')
  const path = join(COVER_DIR, filename)
  if (!existsSync(path)) throw new Error('封面不存在')
  return path
}

export function deleteComfyWorkflow(ownerId: string, id: string) {
  const items = readStore()
  const deleted = items.find((item) => item.id === id && item.ownerId === ownerId)
  const next = items.filter((item) => !(item.id === id && item.ownerId === ownerId))
  if (next.length === items.length) throw new Error('API 工作流不存在')
  writeStore(next)
  if (deleted) removeCover(deleted.coverUrl)
}

function instanceBase(instanceId: string) {
  const instance = loadComfyConfig().instances.find((item) => item.id === instanceId)
  if (!instance) throw new Error('ComfyUI 实例不存在')
  return `http://127.0.0.1:${instance.port}`
}

async function resolveRunInstance(instanceId: string) {
  if (instanceId !== AUTO_INSTANCE_ID) return { instanceId, base: instanceBase(instanceId) }
  const instances = loadComfyConfig().instances.filter((item) => item.enabled)
  const health = await Promise.all(instances.map(async (instance, index) => {
    const base = `http://127.0.0.1:${instance.port}`
    const [response, queueResponse] = await Promise.all([
      fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(2500) }).catch(() => null),
      fetch(`${base}/queue`, { signal: AbortSignal.timeout(2500) }).catch(() => null),
    ])
    if (!response?.ok) return null
    const queue = queueResponse?.ok
      ? await queueResponse.json().catch(() => ({})) as { queue_running?: unknown[]; queue_pending?: unknown[] }
      : {}
    const load = (Array.isArray(queue.queue_running) ? queue.queue_running.length : 0)
      + (Array.isArray(queue.queue_pending) ? queue.queue_pending.length : 0)
    return { instanceId: instance.id, base, load, index }
  }))
  const available = health
    .filter((item): item is { instanceId: string; base: string; load: number; index: number } => !!item)
    .sort((left, right) => left.load - right.load || left.index - right.index)[0]
  if (!available) throw new Error('没有可用的 ComfyUI 运行实例')
  return available
}

function uploadValue(upload: { name: string; subfolder?: string }) {
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name
}

async function uploadInput(base: string, file: { buffer: Buffer; name: string; mime?: string }) {
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(file.buffer)], { type: file.mime || 'application/octet-stream' }), file.name)
  const response = await fetch(`${base}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`上传输入图片失败：HTTP ${response.status}`)
  return response.json() as Promise<{ name: string; subfolder?: string }>
}

function setRun(run: ComfyWorkflowRun, patch: Partial<ComfyWorkflowRun>) {
  Object.assign(run, patch, { updatedAt: Date.now() })
}

async function executeRun(
  run: ComfyWorkflowRun,
  preset: ComfyWorkflowPreset,
  values: Record<string, unknown>,
  files: Map<string, { buffer: Buffer; name: string; mime?: string }>,
) {
  try {
    const resolved = await resolveRunInstance(preset.instanceId)
    const base = resolved.base
    setRun(run, { instanceId: resolved.instanceId })
    const health = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
    if (!health?.ok) throw new Error('ComfyUI 实例尚未运行')
    const prompt = structuredClone(preset.workflow)
    setRun(run, { status: 'uploading', progress: 5 })
    for (const field of preset.fields) {
      const node = prompt[field.nodeId]
      if (!node) throw new Error(`映射节点已不存在：${field.nodeId}`)
      if (['image', 'video', 'audio', 'file'].includes(field.type)) {
        const file = files.get(field.id)
        if (!file) {
          if (field.required) throw new Error(`请上传${field.label}`)
          continue
        }
        node.inputs[field.input] = uploadValue(await uploadInput(base, file))
        continue
      }
      let value = field.id in values ? values[field.id] : field.default
      if (field.type === 'seed' && (value === '' || value === -1 || value === 'random')) {
        value = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
      }
      if (value === undefined && field.required) throw new Error(`请填写${field.label}`)
      if (value !== undefined) node.inputs[field.input] = value
    }
    setRun(run, { status: 'running', progress: 15 })
    const queued = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: `dxos-${run.id}` }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!queued.ok) throw new Error(`提交工作流失败：${await queued.text() || `HTTP ${queued.status}`}`)
    const queuedBody = await queued.json() as { prompt_id?: string; error?: string }
    if (!queuedBody.prompt_id) throw new Error(queuedBody.error || 'ComfyUI 没有返回 prompt_id')
    setRun(run, { promptId: queuedBody.prompt_id, progress: 20 })
    const deadline = Date.now() + 30 * 60_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const response = await fetch(`${base}/history/${queuedBody.prompt_id}`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
      if (!response?.ok) continue
      const history = await response.json() as Record<string, { outputs?: Record<string, Record<string, unknown>>; status?: { status_str?: string; messages?: unknown[] } }>
      const item = history[queuedBody.prompt_id]
      if (!item) {
        setRun(run, { progress: Math.min(90, run.progress + 1) })
        continue
      }
      if (item.status?.status_str === 'error') throw new Error('ComfyUI 执行失败，请查看实例日志')
      const wanted = new Set(preset.outputs.map((output) => output.nodeId))
      const outputMappings = new Map(preset.outputs.map((output) => [output.nodeId, output]))
      const results: ComfyRunResult[] = []
      const seenOutputFiles = new Set<string>()
      for (const [nodeId, output] of Object.entries(item.outputs || {})) {
        if (wanted.size && !wanted.has(nodeId)) continue
        const mapping = outputMappings.get(nodeId)
        for (const key of ['images', 'gifs', 'videos', 'audio']) {
          const values = Array.isArray(output[key]) ? output[key] as Array<Record<string, unknown>> : []
          for (const file of values) {
            const name = String(file.filename || file.name || '')
            if (!name) continue
            const subfolder = String(file.subfolder || '')
            const outputType = String(file.type || 'output')
            const fileKey = `${outputType}:${subfolder}:${name}`
            if (seenOutputFiles.has(fileKey)) continue
            seenOutputFiles.add(fileKey)
            const query = new URLSearchParams({ filename: name, subfolder, type: outputType })
            results.push({
              name,
              type: mapping?.type && mapping.type !== 'text' ? mapping.type : key === 'images' ? 'image' : key === 'audio' ? 'audio' : 'video',
              subfolder,
              outputType,
              nodeId,
              label: mapping?.label,
              url: `/api/comfyui/workflow-runs/${run.id}/files/${results.length}?${query}`,
            })
          }
        }
        if (mapping?.type === 'text') {
          const textValues: string[] = []
          const collectText = (value: unknown) => {
            if (typeof value === 'string' && value.trim()) textValues.push(value.trim())
            else if (Array.isArray(value)) value.forEach(collectText)
          }
          for (const [key, value] of Object.entries(output)) {
            if (['images', 'gifs', 'videos', 'audio'].includes(key)) continue
            if (/^(text|texts|string|strings|value|values|result|results|output)$/i.test(key)) collectText(value)
          }
          for (const [index, text] of [...new Set(textValues)].entries()) results.push({
            name: mapping.label || `文字输出 ${index + 1}`,
            type: 'text',
            nodeId,
            label: mapping.label,
            text,
          })
        }
      }
      setRun(run, { status: 'completed', progress: 100, results })
      return
    }
    throw new Error('工作流运行超时')
  } catch (cause) {
    setRun(run, { status: 'failed', error: String((cause as Error).message || cause) })
  }
}

export function startComfyWorkflowRun(
  ownerId: string,
  presetId: string,
  values: Record<string, unknown>,
  files: Array<{ fieldId: string; buffer: Buffer; name: string; mime?: string }>,
) {
  const preset = getComfyWorkflow(ownerId, presetId)
  const now = Date.now()
  const run: ComfyWorkflowRun = {
    id: randomUUID(), ownerId, presetId, instanceId: '', status: 'queued', progress: 0, promptId: '', error: '', results: [], createdAt: now, updatedAt: now,
  }
  runs.set(run.id, run)
  void executeRun(run, preset, values, new Map(files.map((file) => [file.fieldId, file])))
  return run
}

export function getComfyWorkflowRun(ownerId: string, id: string) {
  const run = runs.get(id)
  if (!run || run.ownerId !== ownerId) throw new Error('运行记录不存在')
  return run
}

export async function proxyComfyRunFile(ownerId: string, runId: string, index: number) {
  const run = getComfyWorkflowRun(ownerId, runId)
  const result = run.results[index]
  if (!result) throw new Error('结果文件不存在')
  const preset = getComfyWorkflow(ownerId, run.presetId)
  if (!result.url) throw new Error('该结果不是文件')
  const query = new URLSearchParams({ filename: result.name, subfolder: result.subfolder || '', type: result.outputType || 'output' })
  const base = instanceBase(run.instanceId || preset.instanceId)
  const response = await fetch(`${base}/view?${query}`, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`读取 ComfyUI 结果失败：HTTP ${response.status}`)
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'application/octet-stream' }
}
