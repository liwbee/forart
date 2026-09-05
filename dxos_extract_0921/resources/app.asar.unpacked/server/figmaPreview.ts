import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataPath } from './dataPaths.ts'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'

export interface FigmaPreviewFile { path: string; content: string }

export const FIGMA_PREVIEW_DIR = dataPath('figma-previews')

function safeProjectId(value: string) {
  const id = String(value || '').trim()
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('预览项目 ID 无效')
  return id
}

export async function buildFigmaPreview(projectId: string, files: FigmaPreviewFile[]) {
  const id = safeProjectId(projectId)
  const projectDir = join(FIGMA_PREVIEW_DIR, id)
  const sourceDir = join(projectDir, 'source')
  const distDir = join(projectDir, 'dist')
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(sourceDir, { recursive: true })

  for (const file of files) {
    const normalized = String(file.path || '').replace(/\\/g, '/')
    if (!/^(?:src\/[a-zA-Z0-9._-]+|index\.html|package\.json|tsconfig\.json|vite\.config\.ts)$/.test(normalized)) continue
    const target = join(sourceDir, ...normalized.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, String(file.content || ''), 'utf8')
  }

  await build({
    root: sourceDir,
    base: `/api/figma/preview/${id}/dist/`,
    configFile: false,
    plugins: [vue()],
    logLevel: 'silent',
    build: { outDir: distDir, emptyOutDir: true, sourcemap: false },
  })
  return { url: `/api/figma/preview/${id}/dist/index.html`, projectId: id }
}
