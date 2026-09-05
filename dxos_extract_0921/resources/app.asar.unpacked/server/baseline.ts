import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const snapshotPath = join(root, 'server', 'baselines', 'agent-platform-v1.json')
const source = (path: string) => readFileSync(join(root, path), 'utf8')
const assistant = source('src/shell/Assistant.vue')
const folderAgent = source('src/stores/agentTasks.ts')
const serverIndex = source('server/index.ts')
const dingtalk = source('server/dingtalkAgent.ts')
const shortDrama = source('server/shortDrama.ts')
const skills = source('server/skills.ts')
const numberFrom = (text: string, pattern: RegExp) => Number(text.match(pattern)?.[1] || 0)

const observed = {
  schemaVersion: 1,
  flows: {
    globalAssistant: {
      entry: 'src/shell/Assistant.vue',
      execution: 'browser',
      maxToolRounds: numberFrom(assistant, /for \(let step = 0; step < (\d+); step\+\+\)/),
      modelEndpoint: assistant.includes('/api/agent/step-stream') ? '/api/agent/step-stream' : 'missing',
      toolLoading: assistant.includes('webMode.value ? await loadMcpTools()') ? 'base-plus-opt-in-web-mcp' : 'unknown',
      permission: assistant.includes('perms.guard(') ? 'browser-guard' : 'missing',
      persistence: 'ephemeral-chat',
    },
    folderAgentV1: {
      entry: 'src/stores/agentTasks.ts',
      execution: 'browser',
      maxToolRounds: numberFrom(folderAgent, /const MAX_STEPS = (\d+)/),
      modelEndpoint: folderAgent.includes("'/agent/step'") ? '/api/agent/step' : 'missing',
      toolLoading: folderAgent.includes('/skills/agent-tools') ? 'native-plus-enabled-skills' : 'native-only',
      permission: folderAgent.includes('taskGuard(') ? 'browser-guard' : 'missing',
      persistence: folderAgent.match(/const STORE_KEY = '([^']+)'/)?.[1] || 'missing',
      refreshBehavior: folderAgent.includes('页面刷新，任务已中断') ? 'running-becomes-interrupted-history' : 'unknown',
    },
    mcpTestAgent: {
      entry: 'server/index.ts#/api/mcp/test-agent',
      execution: 'express',
      maxToolRounds: numberFrom(serverIndex.slice(serverIndex.indexOf("app.post('/api/mcp/test-agent'")), /for \(let step = 0; step < (\d+); step\+\+\)/),
      toolLoading: serverIndex.includes('mcpAgentToolsForServer(serverId)') ? 'selected-server-only' : 'unknown',
      permission: 'app-open-guard',
      persistence: 'none',
    },
    dingtalkAgent: {
      entry: 'server/dingtalkAgent.ts',
      execution: 'dingtalk-stream-process',
      modelCallsPerMessage: 1,
      contextMessages: numberFrom(dingtalk, /ctx\.slice\(-([0-9]+)\)/),
      permission: dingtalk.includes('不要执行敏感外部操作') ? 'prompt-only-sensitive-confirmation' : 'missing',
      persistence: 'in-memory-session-context',
    },
    shortDrama: {
      entry: 'server/shortDrama.ts',
      execution: 'direct-domain-api',
      stages: ['script', 'design', 'storyboard', 'generate', 'timeline'],
      persistence: shortDrama.includes('short-drama-projects.json') ? 'json-plus-project-files' : 'unknown',
      permission: 'route-auth-and-app-guard',
    },
    skillsV1: {
      entry: 'server/skills.ts',
      execution: 'express-direct-runner',
      callablePrefix: skills.includes('skill__${s.id}') ? 'skill__' : 'missing',
      persistence: skills.includes("skills.json") ? 'server/data/skills.json' : 'unknown',
      permission: 'browser-task-guard',
    },
  },
}

if (process.argv.includes('--update')) {
  writeFileSync(snapshotPath, JSON.stringify(observed, null, 2) + '\n')
  console.log(`baseline-updated ${snapshotPath}`)
  process.exit(0)
}
if (!existsSync(snapshotPath)) throw new Error(`基线快照不存在：${snapshotPath}，请先运行 npm run baseline:update`)
const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'))
if (JSON.stringify(expected) !== JSON.stringify(observed)) {
  console.error('agent-platform-baseline-mismatch')
  console.error(JSON.stringify({ expected, observed }, null, 2))
  process.exit(1)
}
console.log('agent-platform-baseline-ok')
