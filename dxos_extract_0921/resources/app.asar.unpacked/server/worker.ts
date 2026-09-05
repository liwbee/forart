import { randomUUID } from 'node:crypto'
import { getNode } from './fs.ts'
import { closeCcsDb } from './ccsDb.ts'
import { runTool, ToolError, LEGACY_TOOL_ALIAS, type ToolResult } from './agentTools.ts'
import { markReactFailure, runReactTask } from './reactDriver.ts'
import { writeProjectSnapshot } from './projectSnapshot.ts'
import { executeNextVideoRenderJob } from './video/videoWorker.ts'
import { startDesktopParentMonitor, startProcessDiagnostics } from './processDiagnostics.ts'
import {
  appendTaskEvent, beginOperation, claimNextTask, completeStep, failStep, findOperation,
  canWorkerRunTask, completeVerifiedTask, enterVerification, failVerification, finishOperation,
  getProject, heartbeatTask, heartbeatWorker, nextQueuedStep, postTaskMessage, registerWorker,
  requeueStep, startStep, stopWorker, taskIsRunning, updateTaskStatus, verifyTask, type FileAction,
} from './taskStore.ts'

const pollMs = Number(process.env.CCS_WORKER_POLL_MS) || 700
const leaseMs = Number(process.env.CCS_WORKER_LEASE_MS) || 8_000
const workerId = process.env.CCS_WORKER_ID || `worker-${randomUUID().slice(0, 8)}`
const exitAfterOperation = process.env.CCS_WORKER_TEST_EXIT_AFTER_OPERATION === '1'

type ClaimedTask = {
  id: string; project_id: string; title: string; mode: 'actions' | 'react'; created_by: string | null
  steps: Array<{ id: string; tool_name: string; input_json: string; operation_id: string }>
}

/** actions 模式：执行预定义步骤（M2 兼容 + 新注册表工具）。 */
function runActionStep(taskId: string, rootNodeId: string, userId: string, toolName: string, rawInput: string, operationId: string): ToolResult {
  const previous = findOperation(operationId)
  if (previous?.status === 'completed' && previous.result_json) return JSON.parse(previous.result_json) as ToolResult
  beginOperation(operationId, taskId, toolName)
  const name = LEGACY_TOOL_ALIAS[toolName] || toolName
  const action = JSON.parse(rawInput) as FileAction & Record<string, unknown>
  // 旧 file.create 在恢复窗口的语义：文件已存在且内容一致 = 幂等完成（fs_create 内置该逻辑）
  const result = runTool(name, { rootNodeId, userId }, action)
  if (exitAfterOperation) process.exit(86)
  finishOperation(operationId, result)
  return result
}

async function executeActions(task: ClaimedTask, rootNodeId: string) {
  while (taskIsRunning(task.id, workerId)) {
    heartbeatTask(task.id, workerId, leaseMs)
    const step = nextQueuedStep(task.id)
    if (!step) {
      if (!enterVerification(task.id, workerId)) return
      const verification = verifyTask(task.id)
      if (!verification.ok) {
        failVerification(task.id, workerId, verification.message)
        return
      }
      completeVerifiedTask(task.id, workerId, verification.message)
      postTaskMessage(task.id, 'assistant', `✅ ${verification.message}`)
      return
    }
    if (!startStep(task.id, step.id, workerId)) return
    if (!taskIsRunning(task.id, workerId)) {
      requeueStep(task.id, step.id)
      return
    }
    appendTaskEvent(task.id, 'step.started', step.title)
    try {
      const result = runActionStep(task.id, rootNodeId, task.created_by || '', step.tool_name, step.input_json, step.operation_id)
      if (exitAfterOperation) process.exit(86)
      const deliverable = result.nodeId && result.deliverable !== false && !['file.read', 'fs_read', 'fs_list'].includes(step.tool_name)
        ? { projectId: task.project_id, nodeId: result.nodeId, name: result.name || step.title }
        : undefined
      if (!completeStep(task.id, step.id, workerId, result, deliverable)) return
    } catch (error) {
      const message = String((error as Error).message || error)
      const code = error instanceof ToolError ? error.code : 'tool_failed'
      if (!failStep(task.id, step.id, workerId, message)) return
      updateTaskStatus(task.id, 'failed', { error_code: code, error_message: message, completed_at: Date.now(), lease_until: null })
      appendTaskEvent(task.id, 'task.failed', message)
      postTaskMessage(task.id, 'system', `任务失败：${message}`)
      return
    }
  }
}

async function executeReact(task: ClaimedTask, rootNodeId: string) {
  // 心跳由驱动内步骤推进；这里再起一个保底心跳，模型长响应时租约不过期
  const beat = setInterval(() => heartbeatTask(task.id, workerId, leaseMs), Math.max(1000, leaseMs / 3))
  try {
    const outcome = await runReactTask(task.id, workerId, rootNodeId, task.created_by || '')
    if (outcome.kind === 'stopped' || outcome.kind === 'waiting_user') return
    if (outcome.kind === 'failed') {
      markReactFailure(task.id, workerId, outcome.code, outcome.message)
      return
    }
    // finished：过完成门禁（不信模型的一面之词）
    if (!enterVerification(task.id, workerId)) return
    const verification = verifyTask(task.id)
    if (!verification.ok) {
      failVerification(task.id, workerId, `完成声明未通过验证：${verification.message}`)
      postTaskMessage(task.id, 'system', `完成声明未通过验证：${verification.message}`)
      return
    }
    completeVerifiedTask(task.id, workerId, outcome.summary)
    postTaskMessage(task.id, 'assistant', `✅ ${outcome.summary}`)
  } finally {
    clearInterval(beat)
  }
}

async function execute(task: ClaimedTask) {
  const projectMeta = getProject(task.project_id)
  const project = projectMeta ? getNode(projectMeta.root_node_id) : null
  if (!project || project.type !== 'folder' || project.trashed) {
    updateTaskStatus(task.id, 'failed', { error_code: 'project_root_missing', error_message: '项目根文件夹不存在', completed_at: Date.now() })
    appendTaskEvent(task.id, 'task.failed', '项目根文件夹不存在')
    return
  }
  if (!canWorkerRunTask(task.id)) {
    updateTaskStatus(task.id, 'paused', { error_code: 'permission_revoked', error_message: '任务创建者已失去项目执行权限', lease_until: null })
    appendTaskEvent(task.id, 'task.paused', '任务创建者已失去项目执行权限')
    return
  }
  if (task.mode === 'react') await executeReact(task, project.id)
  else await executeActions(task, project.id)
  // 任务终态后刷新 .ccs-ai 快照（非关键路径，失败不影响任务）
  try { writeProjectSnapshot(task.project_id) } catch (e) { console.warn('[ccs-worker] snapshot failed:', String((e as Error).message || e)) }
}

async function tick() {
  if (stopping || ticking) return
  ticking = true
  try {
    heartbeatWorker(workerId)
    if (preferVideo && await executeNextVideoRenderJob(workerId, leaseMs)) {
      preferVideo = false
      return
    }
    const task = claimNextTask(workerId, leaseMs) as ClaimedTask | undefined
    if (task) {
      await execute(task)
      preferVideo = true
    } else {
      await executeNextVideoRenderJob(workerId, leaseMs)
      preferVideo = false
    }
  } finally {
    ticking = false
  }
}

console.log(`[ccs-worker] ${workerId} started`)
let stopping = false
let ticking = false
let preferVideo = true
const workerMemoryDiagnostics = startProcessDiagnostics('worker', { getMetrics: () => ({ workerId, ticking, stopping }) })
const desktopParentMonitor = startDesktopParentMonitor('worker', () => { void shutdown('desktop-parent-exit') })
registerWorker(workerId, process.pid)
const timer = setInterval(() => { void tick().catch((error) => console.error('[ccs-worker]', error)) }, pollMs)
void tick().catch((error) => console.error('[ccs-worker]', error))

async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  const deadline = Date.now() + 2_000
  while (ticking && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  stopWorker(workerId)
  console.log(`[ccs-worker] ${workerId} stopped (${signal})`)
  workerMemoryDiagnostics.stop()
  desktopParentMonitor.stop()
  closeCcsDb()
  process.exit(0)
}
process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })
