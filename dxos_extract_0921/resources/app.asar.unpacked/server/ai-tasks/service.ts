import { randomUUID } from 'node:crypto'
import type { CapabilityIntent } from '../capabilityTypes.ts'
import { compileProtocolPlan, type StandardProtocolTask } from '../protocol-engine/compiler.ts'
import { protocolExecutionEnabled } from '../protocol-engine/flags.ts'
import { getProtocolV2, protocolV2Hash } from '../protocol-engine/repository.ts'
import type { ProtocolClock, ProtocolTransport } from '../protocol-engine/transport.ts'
import { executeProtocolPlan, resumeProtocolPlan, startProtocolPlan, type ProtocolExecutionEvent, type ProtocolExecutionResult, type ProtocolWorkflowCheckpoint } from '../protocol-engine/workflow.ts'
import { appendAiProtocolTaskEvent, createAiProtocolTask, getAiProtocolTask, updateAiProtocolTask } from './store.ts'
import { materializeAiProtocolOutputs } from './artifacts.ts'
import type { ProtocolArtifactDownloader } from '../protocol-engine/artifactDownload.ts'

export type SubmitAiProtocolTask = {
  id?: string
  ownerId?: string
  canvasId?: string
  mode: 'dry-run' | 'execute'
  providerProtocolId: string
  providerProtocolVersion?: number
  providerSiteId?: string
  modelProtocolId: string
  modelProtocolVersion?: number
  baseUrl: string
  credential?: string
  task: StandardProtocolTask
  transport?: ProtocolTransport
  clock?: ProtocolClock
  artifactDownloader?: ProtocolArtifactDownloader
  deferAsync?: boolean
}

const running = new Map<string, AbortController>()

async function executionResultForStorage(taskId: string, result: ProtocolExecutionResult, downloader?: ProtocolArtifactDownloader) {
  const artifacts = await materializeAiProtocolOutputs(taskId, result.outputs, downloader)
  return {
    taskId: result.taskId,
    outputs: artifacts.map((artifact) => ({
      kind: artifact.kind, mime: artifact.mime, artifactId: artifact.id,
      bytes: artifact.bytes, sha256: artifact.sha256, sourceUrl: artifact.sourceUrl,
    })),
  }
}

function pinned(input: SubmitAiProtocolTask) {
  const provider = getProtocolV2('provider', input.providerProtocolId, input.providerProtocolVersion)
  const model = getProtocolV2('model', input.modelProtocolId, input.modelProtocolVersion)
  if (!provider) throw new Error(`v2 平台协议「${input.providerProtocolId}」不存在。`)
  if (!model) throw new Error(`v2 模型协议「${input.modelProtocolId}」不存在。`)
  return { provider, model }
}

export async function submitAiProtocolTask(input: SubmitAiProtocolTask) {
  const fixed = pinned(input)
  const redactedPlan = compileProtocolPlan({
    providerProtocol: fixed.provider.protocol,
    modelProtocol: fixed.model.protocol,
    baseUrl: input.baseUrl,
    task: input.task,
    redactSecrets: true,
  })
  const profileId = String(redactedPlan.protocol.profile || '')
  if (input.mode === 'execute' && !protocolExecutionEnabled({
    providerProtocolId: fixed.provider.protocol.id,
    modelProtocolId: fixed.model.protocol.id,
    profileId,
    intent: input.task.intent,
  })) throw new Error(`声明式真实执行尚未为 ${fixed.provider.protocol.id}/${fixed.model.protocol.id}/${profileId || '(no-profile)'}/${input.task.intent} 启用。`)

  const id = input.id || randomUUID()
  const now = Date.now()
  createAiProtocolTask({
    id,
    owner_id: input.ownerId || null,
    canvas_id: input.canvasId || null,
    provider_site_id: input.providerSiteId || null,
    base_url: input.baseUrl,
    status: input.mode === 'dry-run' ? 'dry_run' : 'queued',
    mode: input.mode,
    request_json: JSON.stringify(input.task),
    plan_json: JSON.stringify(redactedPlan),
    plan_hash: protocolV2Hash(redactedPlan),
    provider_protocol_id: fixed.provider.protocol.id,
    provider_protocol_version: fixed.provider.version,
    provider_protocol_hash: fixed.provider.hash,
    model_protocol_id: fixed.model.protocol.id,
    model_protocol_version: fixed.model.version,
    model_protocol_hash: fixed.model.hash,
    profile_id: profileId,
    intent: input.task.intent,
    created_at: now,
    updated_at: now,
  })
  appendAiProtocolTaskEvent(id, 'planned', { planHash: protocolV2Hash(redactedPlan), dryRun: input.mode === 'dry-run' }, now)
  if (input.mode === 'dry-run') {
    updateAiProtocolTask(id, { status: 'completed', result_json: JSON.stringify({ plan: redactedPlan }), updated_at: now, completed_at: now })
    appendAiProtocolTaskEvent(id, 'completed', { dryRun: true }, now)
    return getAiProtocolTask(id)!
  }

  const livePlan = compileProtocolPlan({
    providerProtocol: fixed.provider.protocol,
    modelProtocol: fixed.model.protocol,
    baseUrl: input.baseUrl,
    credential: input.credential,
    task: input.task,
    redactSecrets: false,
  })
  const controller = new AbortController()
  running.set(id, controller)
  updateAiProtocolTask(id, { status: 'running', updated_at: Date.now(), started_at: Date.now() })
  appendAiProtocolTaskEvent(id, 'running', {})
  const onEvent = (event: ProtocolExecutionEvent) => {
    appendAiProtocolTaskEvent(id, event.type, event)
    if (event.type === 'submitted' && event.taskId) updateAiProtocolTask(id, { remote_task_id: event.taskId, updated_at: Date.now() })
  }
  try {
    if (input.deferAsync && livePlan.steps.some((step) => step.id === 'poll')) {
      const advance = await startProtocolPlan({ plan: livePlan, transport: input.transport, signal: controller.signal, onEvent })
      if (advance.status === 'pending') {
        updateAiProtocolTask(id, {
          status: 'pending',
          remote_task_id: advance.taskId || null,
          workflow_state_json: JSON.stringify(advance.checkpoint),
          next_poll_at: advance.checkpoint.nextPollAt,
          poll_attempt: advance.checkpoint.attempt,
          updated_at: Date.now(),
        })
        return getAiProtocolTask(id)!
      }
      const stored = await executionResultForStorage(id, advance.result, input.artifactDownloader)
      updateAiProtocolTask(id, { status: 'completed', result_json: JSON.stringify(stored), updated_at: Date.now(), completed_at: Date.now() })
      return getAiProtocolTask(id)!
    }
    const result = await executeProtocolPlan({ plan: livePlan, transport: input.transport, clock: input.clock, signal: controller.signal, onEvent })
    const stored = await executionResultForStorage(id, result, input.artifactDownloader)
    updateAiProtocolTask(id, { status: 'completed', result_json: JSON.stringify(stored), updated_at: Date.now(), completed_at: Date.now() })
    return getAiProtocolTask(id)!
  } catch (error) {
    const cancelled = controller.signal.aborted
    updateAiProtocolTask(id, {
      status: cancelled ? 'cancelled' : 'failed',
      error_message: String((error as Error).message || error),
      updated_at: Date.now(),
      completed_at: Date.now(),
    })
    throw error
  } finally {
    running.delete(id)
  }
}

export async function resumeAiProtocolTask(input: {
  id: string
  credential?: string
  transport?: ProtocolTransport
  artifactDownloader?: ProtocolArtifactDownloader
  now?: number
}) {
  const task = getAiProtocolTask(input.id)
  if (!task) throw new Error(`协议任务「${input.id}」不存在。`)
  if (task.status !== 'pending') return task
  if (running.has(task.id)) return task
  if (!task.workflow_state_json) throw new Error('协议任务缺少可恢复 workflow checkpoint。')
  if (!task.base_url) throw new Error('协议任务缺少固定的平台 Base URL。')
  const checkpoint = JSON.parse(task.workflow_state_json) as ProtocolWorkflowCheckpoint
  if (checkpoint.phase !== 'poll' || !checkpoint.captures || !Number.isFinite(checkpoint.nextPollAt)) throw new Error('协议任务 workflow checkpoint 已损坏。')
  const provider = getProtocolV2('provider', task.provider_protocol_id, task.provider_protocol_version)
  const model = getProtocolV2('model', task.model_protocol_id, task.model_protocol_version)
  if (!provider || provider.hash !== task.provider_protocol_hash || !model || model.hash !== task.model_protocol_hash) throw new Error('协议任务固定版本已缺失或哈希不一致。')
  const standardTask = JSON.parse(task.request_json) as StandardProtocolTask
  const livePlan = compileProtocolPlan({ providerProtocol: provider.protocol, modelProtocol: model.protocol, baseUrl: task.base_url, credential: input.credential, task: standardTask, redactSecrets: false })
  const controller = new AbortController()
  running.set(task.id, controller)
  const onEvent = (event: ProtocolExecutionEvent) => {
    appendAiProtocolTaskEvent(task.id, event.type, event)
    if (event.type === 'progress') updateAiProtocolTask(task.id, { updated_at: Date.now() })
  }
  try {
    const advance = await resumeProtocolPlan({ plan: livePlan, checkpoint, transport: input.transport, signal: controller.signal, now: input.now, onEvent })
    if (advance.status === 'pending') {
      updateAiProtocolTask(task.id, {
        workflow_state_json: JSON.stringify(advance.checkpoint),
        next_poll_at: advance.checkpoint.nextPollAt,
        poll_attempt: advance.checkpoint.attempt,
        updated_at: Date.now(),
      })
      return getAiProtocolTask(task.id)!
    }
    const stored = await executionResultForStorage(task.id, advance.result, input.artifactDownloader)
    updateAiProtocolTask(task.id, {
      status: 'completed', result_json: JSON.stringify(stored), workflow_state_json: null, next_poll_at: null,
      updated_at: Date.now(), completed_at: Date.now(),
    })
    return getAiProtocolTask(task.id)!
  } catch (error) {
    const cancelled = controller.signal.aborted
    appendAiProtocolTaskEvent(task.id, cancelled ? 'cancelled' : 'failed', { message: String((error as Error).message || error) })
    updateAiProtocolTask(task.id, {
      status: cancelled ? 'cancelled' : 'failed', error_message: String((error as Error).message || error),
      updated_at: Date.now(), completed_at: Date.now(),
    })
    throw error
  } finally {
    running.delete(task.id)
  }
}

export function cancelAiProtocolTask(id: string) {
  const task = getAiProtocolTask(id)
  if (!task) throw new Error(`协议任务「${id}」不存在。`)
  const controller = running.get(id)
  if (controller) controller.abort()
  const now = Date.now()
  updateAiProtocolTask(id, { status: 'cancelled', workflow_state_json: null, next_poll_at: null, updated_at: now, completed_at: now })
  appendAiProtocolTaskEvent(id, 'cancelled', {}, now)
  return getAiProtocolTask(id)!
}

export function recordAiProtocolCanvasResults(id: string, canvasResults: unknown[]) {
  const task = getAiProtocolTask(id)
  if (!task || task.status !== 'completed') throw new Error(`协议任务「${id}」尚未完成。`)
  const result = task.result_json ? JSON.parse(task.result_json) as Record<string, unknown> : {}
  updateAiProtocolTask(id, { result_json: JSON.stringify({ ...result, canvasResults }), updated_at: Date.now() })
  appendAiProtocolTaskEvent(id, 'delivered', { count: canvasResults.length })
  return getAiProtocolTask(id)!
}

export { getAiProtocolTask }
export type { StandardProtocolTask, CapabilityIntent }
