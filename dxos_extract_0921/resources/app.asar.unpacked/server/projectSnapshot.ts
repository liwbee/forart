import { createNode, findByPath, getNode, setContent } from './fs.ts'
import { getProject, listMemories, listTasks } from './taskStore.ts'

/**
 * M7 `.ccs-ai` 项目快照（计划 8.4）：可迁移、非敏感的项目状态副本。
 * ccs.db 仍是实时任务真相；快照在任务完成/失败时刷新，供复制项目与外部查看。
 */

function upsertFile(rootId: string, dirId: string, name: string, content: string) {
  const existing = findByPath(dirId, name)
  if (existing && existing.type === 'file') {
    if (existing.content !== content) setContent(existing.id, content)
    return existing.id
  }
  return createNode({ name, type: 'file', parentId: dirId, content }).id
}

export function writeProjectSnapshot(projectId: string) {
  const project = getProject(projectId)
  if (!project) return
  const root = getNode(project.root_node_id)
  if (!root || root.type !== 'folder' || root.trashed) return

  let dir = findByPath(root.id, '.ccs-ai')
  if (!dir) dir = createNode({ name: '.ccs-ai', type: 'folder', parentId: root.id })
  else if (dir.type !== 'folder') return

  upsertFile(root.id, dir.id, 'project.json', JSON.stringify({
    schema: 1,
    name: project.name,
    projectId: project.id,
    updatedAt: new Date().toISOString(),
    note: '此目录是 DX OS 项目的可迁移快照；实时任务状态以系统数据库为准。',
  }, null, 2))

  const memories = listMemories(projectId)
  upsertFile(root.id, dir.id, 'memory.md', [
    `# 项目记忆`,
    '',
    ...(memories.length ? memories.map((m) => `- ${m.content}（v${m.version} · ${m.source_type}）`) : ['（暂无记忆）']),
    '',
  ].join('\n'))

  const owner = project.created_by || ''
  const tasks = owner ? listTasks(owner, projectId) : []
  upsertFile(root.id, dir.id, 'tasks.md', [
    `# 任务历史`,
    '',
    ...(tasks.length
      ? tasks.map((t) => {
          const deliverables = t.deliverables.map((d) => d.name).join('、')
          return `## ${t.title}\n- 状态：${t.status}\n- 目标：${t.instruction.slice(0, 200)}\n${t.result ? `- 结果：${t.result.slice(0, 300)}\n` : ''}${deliverables ? `- 交付物：${deliverables}\n` : ''}`
        })
      : ['（暂无任务）']),
    '',
  ].join('\n'))
}
