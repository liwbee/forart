import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dataPath } from './dataPaths.ts'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { InferenceSession, Tensor } from 'onnxruntime-node'
import sharp from 'sharp'

export type BackgroundRemovalModel = 'ben2-base'

interface ModelDefinition {
  id: BackgroundRemovalModel
  name: string
  filename: string
  version: string
  downloadUrl: string
  sha256: string
  size: number
  inputWidth: number
  inputHeight: number
  normalize: 'imagenet' | 'zero-one'
  sigmoid: boolean
}

const MODEL_DIR = dataPath('models', 'background-removal')
const MODEL_API_BASE = String(process.env.DX_ACCOUNT_API_URL || 'https://api.dx-os.com').replace(/\/+$/, '')
const MODEL_CATALOG_URL = String(process.env.DX_BACKGROUND_REMOVAL_MODEL_CATALOG_URL || `${MODEL_API_BASE}/v1/models/background-removal`)
const SUPPORTED_MODELS = new Set<BackgroundRemovalModel>(['ben2-base'])
let catalogCache: { expiresAt: number; models: ModelDefinition[] } | null = null

type OrtRuntime = typeof import('onnxruntime-node')

const sessions = new Map<string, Promise<InferenceSession>>()
let ortProbe: Promise<void> | null = null
let ortRuntime: Promise<OrtRuntime> | null = null

function probeOrtRuntime() {
  if (ortProbe) return ortProbe
  ortProbe = new Promise<void>((resolveProbe, rejectProbe) => {
    const child = spawn(process.execPath, [
      '--input-type=module',
      '--eval',
      "import('onnxruntime-node').then(() => process.exit(0)).catch((error) => { console.error(error?.stack || error); process.exit(1) })",
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, DX_ORT_COMPATIBILITY_PROBE: '1' },
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { if (stderr.length < 4000) stderr += String(chunk) })
    const timer = setTimeout(() => {
      child.kill()
      rejectProbe(new Error('ONNX Runtime 兼容性检测超时'))
    }, 15_000)
    timer.unref()
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectProbe(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolveProbe()
      else rejectProbe(new Error(`ONNX Runtime 与当前 Windows 或 CPU 不兼容（退出码 ${code ?? signal ?? 'unknown'}）${stderr.trim() ? `：${stderr.trim()}` : ''}`))
    })
  }).catch((error) => {
    ortProbe = null
    throw error
  })
  return ortProbe
}

async function loadOrtRuntime() {
  await probeOrtRuntime()
  if (!ortRuntime) ortRuntime = import('onnxruntime-node').catch((error) => {
    ortRuntime = null
    throw new Error(`无法加载本地抠图运行环境：${String((error as Error)?.message || error)}`)
  })
  return ortRuntime
}
interface ModelDownloadState {
  task: Promise<string>
  downloadedBytes: number
  totalBytes: number
}
const downloads = new Map<BackgroundRemovalModel, ModelDownloadState>()

async function catalog(force = false) {
  if (!force && catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.models
  const response = await fetch(MODEL_CATALOG_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`模型服务器连接失败（HTTP ${response.status}）`)
  const body = await response.json() as { models?: Array<Record<string, unknown>> }
  const models = (body.models || []).flatMap((item): ModelDefinition[] => {
    const id = String(item.id || '') as BackgroundRemovalModel
    const sha256 = String(item.sha256 || '').toLowerCase()
    const downloadUrl = String(item.downloadUrl || '')
    const version = String(item.version || '')
    if (!SUPPORTED_MODELS.has(id) || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version) ||
        !/^[a-f0-9]{64}$/.test(sha256) || !downloadUrl.startsWith('https://')) return []
    return [{
      id, name: String(item.name || id), filename: `${id}-${version}.onnx`, version,
      downloadUrl, sha256, size: Number(item.size || 0),
      inputWidth: Number(item.inputWidth || 1024), inputHeight: Number(item.inputHeight || 1024),
      normalize: item.normalize === 'imagenet' ? 'imagenet' : 'zero-one', sigmoid: item.sigmoid === true,
    }]
  })
  catalogCache = { expiresAt: Date.now() + 5 * 60_000, models }
  return models
}

async function definition(id: string, force = false) {
  const model = (await catalog(force)).find((item) => item.id === id)
  if (!model) throw new Error('不支持的抠图模型')
  return model
}

function metadataPath(model: ModelDefinition) { return resolve(MODEL_DIR, `${model.id}-${model.version}.json`) }

async function localModelPath(model: ModelDefinition) {
  const path = resolve(MODEL_DIR, model.filename)
  try {
    const [info, metadata] = await Promise.all([stat(path), readFile(metadataPath(model), 'utf8').then(JSON.parse)])
    if (info.size === model.size && metadata.version === model.version && metadata.sha256 === model.sha256) return path
  } catch { /* first use downloads the model */ }
  return ''
}

async function downloadModel(model: ModelDefinition) {
  const existing = await localModelPath(model)
  if (existing) return existing
  const active = downloads.get(model.id)
  if (active) return active.task
  const state: ModelDownloadState = {
    task: Promise.resolve(''),
    downloadedBytes: 0,
    totalBytes: model.size,
  }
  const task = (async () => {
    await mkdir(MODEL_DIR, { recursive: true })
    const path = resolve(MODEL_DIR, model.filename)
    const partial = `${path}.download`
    const response = await fetch(model.downloadUrl, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`${model.name} 下载失败（HTTP ${response.status}）`)
    const hash = createHash('sha256')
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        state.downloadedBytes += chunk.length
        callback(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(response.body as never), hashingStream, createWriteStream(partial))
      const info = await stat(partial)
      if (info.size !== model.size) throw new Error(`${model.name} 下载不完整`)
      if (hash.digest('hex') !== model.sha256) throw new Error(`${model.name} 文件校验失败`)
      await rename(partial, path)
      await writeFile(metadataPath(model), JSON.stringify({ version: model.version, sha256: model.sha256, size: model.size }))
      return path
    } catch (error) {
      await unlink(partial).catch(() => undefined)
      throw error
    }
  })().finally(() => downloads.delete(model.id))
  state.task = task
  downloads.set(model.id, state)
  return task
}

async function getSession(model: ModelDefinition, runtime: OrtRuntime) {
  const key = `${model.id}:${model.version}`
  let session = sessions.get(key)
  if (!session) {
    const path = await localModelPath(model)
    if (!path) throw new Error(`${model.name} 尚未下载，请先点击“一键下载模型”`)
    session = runtime.InferenceSession.create(path, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    })
    sessions.set(key, session)
    session.catch(() => sessions.delete(key))
  }
  return session
}

function buildInput(rgb: Uint8Array, model: ModelDefinition) {
  const pixels = model.inputWidth * model.inputHeight
  const input = new Float32Array(3 * pixels)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      let value = rgb[pixel * 3 + channel] / 255
      if (model.normalize === 'imagenet') value = (value - mean[channel]) / std[channel]
      input[channel * pixels + pixel] = value
    }
  }
  return input
}

function buildMask(output: Tensor, model: ModelDefinition) {
  const source = output.data as Float32Array
  const mask = new Uint8Array(model.inputWidth * model.inputHeight)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < mask.length; i += 1) {
    const raw = source[i]
    const value = model.sigmoid ? 1 / (1 + Math.exp(-raw)) : raw
    if (value < min) min = value
    if (value > max) max = value
    mask[i] = 0
  }
  const span = Math.max(1e-6, max - min)
  for (let i = 0; i < mask.length; i += 1) {
    const raw = source[i]
    const value = model.sigmoid ? 1 / (1 + Math.exp(-raw)) : raw
    mask[i] = Math.round(Math.max(0, Math.min(1, (value - min) / span)) * 255)
  }
  return mask
}

export async function backgroundRemovalStatus() {
  const models = await catalog()
  return Promise.all(models.map(async (model) => {
    const download = downloads.get(model.id)
    const downloaded = !!(await localModelPath(model))
    return {
      id: model.id,
      name: model.name,
      version: model.version,
      size: model.size,
      downloaded,
      downloading: !!download,
      downloadedBytes: downloaded ? model.size : download?.downloadedBytes || 0,
      totalBytes: download?.totalBytes || model.size,
      available: true,
    }
  }))
}

export async function downloadBackgroundRemovalModel(modelId: string) {
  const model = await definition(modelId, true)
  await loadOrtRuntime()
  await downloadModel(model)
  return { id: model.id, name: model.name, version: model.version, size: model.size, downloaded: true, downloading: false, downloadedBytes: model.size, totalBytes: model.size, available: true }
}

export async function removeImageBackground(image: Buffer, modelId: string) {
  const model = await definition(modelId)
  const runtime = await loadOrtRuntime()
  // Resolve dimensions from the same decoded pixel stream used below. Metadata
  // dimensions can differ after orientation and would make RGBA rows drift.
  const decoded = await sharp(image).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const width = decoded.info.width
  const height = decoded.info.height
  if (!width || !height) throw new Error('无法读取图片尺寸')
  const rgb = await sharp(decoded.data, { raw: decoded.info }).resize(model.inputWidth, model.inputHeight, { fit: 'fill' }).raw().toBuffer()
  const session = await getSession(model, runtime)
  const inputName = session.inputNames[0]
  const results = await session.run({ [inputName]: new runtime.Tensor('float32', buildInput(rgb, model), [1, 3, model.inputHeight, model.inputWidth]) })
  const output = results[session.outputNames[0]]
  if (!output) throw new Error(`${model.name} 没有返回遮罩`)
  const resizedMask = await sharp(buildMask(output, model), { raw: { width: model.inputWidth, height: model.inputHeight, channels: 1 } })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (resizedMask.info.width !== width || resizedMask.info.height !== height || resizedMask.info.channels < 1) {
    throw new Error(`${model.name} 返回了无效遮罩尺寸`)
  }
  const original = decoded.data
  const rgba = Buffer.allocUnsafe(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = original[pixel * 3]
    rgba[pixel * 4 + 1] = original[pixel * 3 + 1]
    rgba[pixel * 4 + 2] = original[pixel * 3 + 2]
    rgba[pixel * 4 + 3] = resizedMask.data[pixel * resizedMask.info.channels]
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
}
