// ══════════════════════════════════════════════════════════════════════
// DX OS · API 后端（Express + tsx）
// 第一块迁移：API 设置（站点凭据 + 协议 + 测试 + 拉模型）+ 给 agent 用的 /api/chat
// ══════════════════════════════════════════════════════════════════════
import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { buildFigmaPreview, FIGMA_PREVIEW_DIR } from './figmaPreview.ts'
import { backgroundRemovalStatus, downloadBackgroundRemovalModel, removeImageBackground } from './backgroundRemoval.ts'
import { probeMediaBuffer, probeUploadedAsset } from './video/mediaProbe.ts'
import {
  cancelVideoRenderJob,
  createVideoRenderJob,
  deleteVideoAsset,
  getVideoRenderJob,
  listVideoAssetRows,
  publicVideoRenderJob,
  saveVideoAsset,
  videoAssetView,
} from './video/videoStore.ts'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  listProviders,
  getProvider,
  saveProvider,
  setProviderEnabled,
  setProviderKeys,
  deleteProvider,
  revealProvider,
  allProviders,
  firstUsableProvider,
  reorderProviders,
  reorderModels,
  modelCandidates,
  getAutoFallback,
  setAutoFallback,
  type Provider,
} from './store.ts'
import { listProtocols, listProtocolDetails, listModelProtocols, listModelProtocolDetails, listProviderProtocolDetails, saveCustomProtocol, removeCustomProtocol, providerProtocolCandidates, callChat, streamChat, chatWithTools, fetchModels, generateImages, generateVideos, generateSpeech, generateMusic, editImages, describeImage, submitMidjourney, getMidjourneyTask, submitMidjourneyAction, submitMidjourneyModal, suggestModelProtocol, uploadApimartMedia, modelProtocolAlias, type ResolvedProvider, type ToolMessage, type EditImageInput, type GenVideoReference } from './protocols.ts'
import { resolveModel } from './modelResolver.ts'
import { resolveReactTools } from './toolResolver.ts'
import { resolveOperation, resolveParameterSchema, resolveProtocolModelProfile, validateProtocolParameters } from './protocolManifest.ts'
import { inferProviderProtocols } from './protocolInference.ts'
import { fetchRunningHubModels, inspectRunningHubApp, inspectRunningHubWorkflow, queryRunningHubTask, runningHubCatalog, submitRunningHubEntry, uploadRunningHubAsset } from './runninghub.ts'
import { MODELSCOPE_CHAT_MODELS, MODELSCOPE_CN_BASE_URL, MODELSCOPE_DEFAULT_LORAS, MODELSCOPE_DEFAULTS_VERSION, MODELSCOPE_GLOBAL_BASE_URL, MODELSCOPE_IMAGE_MODELS, normalizeModelScopeLoras } from './modelscope.ts'
import { AGNES_BASE_URL, AGNES_IMAGE_MODELS, AGNES_VIDEO_MODELS } from './agnes.ts'
import type { CapabilityIntent } from './capabilityTypes.ts'
import { compileProtocolPlan, type StandardProtocolAsset } from './protocol-engine/compiler.ts'
import { activateProtocolV2, getProtocolV2, listProtocolsV2, removeProtocolV2, saveProtocolV2, type ProtocolV2Kind } from './protocol-engine/repository.ts'
import { validateProtocolV2 } from './protocol-engine/validator.ts'
import { cancelAiProtocolTask, getAiProtocolTask, recordAiProtocolCanvasResults, resumeAiProtocolTask, submitAiProtocolTask } from './ai-tasks/service.ts'
import { resolveCanvasDeclarativeRoute } from './ai-tasks/canvasDeclarativeRouter.ts'
import { readAiProtocolArtifact } from './ai-tasks/artifacts.ts'
import { listDueAiProtocolTasks } from './ai-tasks/store.ts'
import { cancelLegacyAiTask, createLegacyAiTask, getLegacyAiTask, updateLegacyAiTask, type LegacyAiTaskRow } from './ai-tasks/legacyStore.ts'
import { listProtocolExecutionFlags, setProtocolExecutionFlag } from './protocol-engine/flags.ts'
import { isStandardAiTask, toLegacyCanvasGenerationRequest } from '../shared/aiTaskLegacyAdapter.ts'
import {
  listChildren,
  getNode,
  createNode,
  createCanvasProjectFolder,
  renameNode,
  setContent,
  setBinaryContent,
  moveNode,
  copyNode,
  removeNode,
  purgeNode,
  listTrash,
  restoreNode,
  claimNodeOwner,
  claimOwnerlessNodes,
  ensureDepartmentRoot,
  ensureCanvasRoot,
  ensureFolder,
  ensurePublicRoot,
  ensureSystemRoot,
  ensureUserFolder,
  findByPath,
  isInTrash,
  removeShareRoot,
  renameShareRoot,
  shareZoneOf,
  setCanvasFolderShare,
  countSubtree,
  searchNodes,
  subtree,
  collectZipEntries,
  blobPath,
  thumbnailPath,
  hasBlob,
  hasThumbnail,
  saveBlob,
  saveThumbnail,
  readBlob,
  storageReport,
  storageChildren,
  subtreeByteSize,
} from './fs.ts'
import {
  addMemory,
  answerTask,
  continueTask,
  appendTaskEvent,
  cancelTask,
  createProject,
  createTask as createProjectTask,
  createThread,
  ensureProjectMember,
  findResumableTasks,
  getProject,
  getTask,
  importLegacyTask,
  listMemories,
  listProjects,
  listTaskEvents,
  listTasks,
  removeMemory,
  deleteAssistantConversation,
  deleteTask,
  pauseTask,
  projectForRoot,
  projectHistory,
  postTaskMessage,
  refreshTaskInstruction,
  recordConversation,
  syncAssistantConversation,
  requireProjectAccess,
  recoverExpiredTasks,
  resumeTask,
  taskStats,
  taskTrace,
  threadMessages,
  workerHealth,
  type AssistantMode,
  type TaskView,
} from './taskStore.ts'
import {
  listServers as mcpListServers,
  saveServer as mcpSaveServer,
  deleteServer as mcpDeleteServer,
  resetSystemServer as mcpResetSystemServer,
  refreshServer as mcpRefreshServer,
  setServerEnabled as mcpSetEnabled,
  agentTools as mcpAgentTools,
  agentToolsForServer as mcpAgentToolsForServer,
  searchAgentTools as mcpSearchAgentTools,
  callByName as mcpCallByName,
  callDirect as mcpCallDirect,
  importServers as mcpImportServers,
  parseImport as mcpParseImport,
  initMcp,
} from './mcp.ts'
import { listSkills, setSkillEnabled, runSkill, agentSkillTools, saveCustomSkill, deleteCustomSkill, generateMusicArtwork, generateArtistsArtwork, updateCustomSkillDisplay } from './skills.ts'
import { toolSchemas as fsToolSchemas, runTool as runFsTool } from './agentTools.ts'
import { pickLlm } from './reactDriver.ts'
import { assistantExecutionLane, runAssistantDirect } from './assistantDirect.ts'
import { importSkillPackage, previewSkillPackage } from './skillImport.ts'
import { deleteSkillPack, ensureBundledSkillPacks, entryPointHelp, importOnlineSkillPack, importRegisteredSkillPack, listPackSkillDocs, listSkillPacks, parseOnlineSkillSource, readPackSkillContext, readPackSkillDoc, renameSkillPack, runSkillPack, syncSkillPackRoutes, translateSkillPackDisplay } from './skillPacks.ts'
import { analyzeSkillDocument, planPackRunArgs, runPackAiTest } from './skillAnalyzer.ts'
import { skillDocumentFromPackage } from './skillImport.ts'
import { addDramaShot, createDramaProject, editDramaShotImage, editVisualReferenceImage, generateDramaOutline, generateDramaShotImage, generateDramaStoryboards, generateDramaVisualDesign, generateVisualReferenceImage, listDramaProjects, updateDramaProject, updateDramaShot } from './shortDrama.ts'
import {
  getConfig as libGetConfig,
  setDirs as libSetDirs,
  scan as libScan,
  listTracks as libListTracks,
  streamTrack as libStreamTrack,
  setMeta as libSetMeta,
  scrapeArtwork as libScrapeArtwork,
  artworkPath as libArtworkPath,
  cacheRemoteArtwork as libCacheRemoteArtwork,
  uploadFiles as libUploadFiles,
  getLyrics as libGetLyrics,
} from './library.ts'
import { existsSync, existsSync as fsExistsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { networkInterfaces, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ccsDb } from './ccsDb.ts'
import { cloudAccountStatus, loginCloudAccount, logoutCloudAccount, uploadCloudTemporaryMedia } from './cloudAccount.ts'
import { db as authDb } from './authDb.ts'
import { DATA_ROOT } from './dataPaths.ts'
import { getLingxingMapping, getLingxingMappingFile, importLingxingMapping } from './lingxingMappings.ts'
import { checkCurrentDataIntegrity, createSystemDataSnapshot, verifySystemDataSnapshot } from './systemDataProtection.ts'
import { addWallpapers, getSystemInterfacePreferences, getWallpaperPreferences, installedAppRecords, installedApps, migrateInstalledApps, removeInstalledAppEverywhere, removeWallpaper, selectWallpaper, setAppInstalled, setSystemInterfacePreferences, wallpaperPath } from './userPreferences.ts'
import { buildZip } from './zip.ts'
import { processDeclarationUpload } from './aiImageDeclaration.ts'
import { listChannels as dtList, saveChannel as dtSave, deleteChannel as dtDelete, send as dtSend, getAgentConfig as dtAgentConfig, getAgentEnv as dtAgentEnv, saveAgentConfig as dtSaveAgentConfig, resetDingTalkData } from './dingtalk.ts'
import { getWeather, getWeatherAt } from './weather.ts'
import { onlineCalendarYears } from './calendarAlmanac.ts'
import { quarkBrowse, quarkCleanDownloads, quarkClearSearchHistory, quarkDownload, quarkLogout, quarkPaths, quarkRecordSearch, quarkSearch, quarkSearchHistory, quarkStartLogin, quarkStatus, quarkStopLogin, quarkUpload } from './quark.ts'
import {
  claimDueAutomation,
  completeAutomationRun,
  createAutomation,
  deleteAutomation,
  listAutomations,
  normalizeDefinition,
  parseAutomationFallback,
  runAutomationNow,
  updateAutomation,
  type AutomationDefinition,
} from './automations.ts'
import { clearDingTalkAgentContexts, getDingTalkAgentStatus, startDingTalkAgentStream, stopDingTalkAgentStream, testDingTalkAgentAi } from './dingtalkAgent.ts'
import { generateJimengImage, generateJimengVideo, upscaleJimengImage, queryJimengMedia, listJimengTasks, JimengPendingError, jimengPendingPayload, jimengCredit, jimengHelp, jimengLoginStart, jimengLoginStatus, jimengLogout, jimengModels, jimengStatus, tempMediaFile } from './cliTools.ts'
import { agentCliDownloadInfo, agentCliHelp, agentCliLoginStart, agentCliLoginStatus, agentCliLogout, agentCliModels, agentCliStatus, generateCodexImage, runAgentCliChat, type AgentCliTool } from './agentCliTools.ts'
import {
  comfyStatus,
  loadComfyConfig,
  repairComfyBridge,
  restartComfyInstance,
  saveComfyConfig,
  startComfyInstance,
  startEnabledComfyInstances,
  stopAllComfyInstances,
  stopComfyInstance,
  uploadComfyFiles,
} from './comfyui.ts'
import {
  deleteComfyWorkflow,
  comfyWorkflowRunStats,
  getComfyWorkflowCover,
  getComfyWorkflow,
  getComfyWorkflowRun,
  inspectComfyWorkflow,
  listComfyWorkflows,
  proxyComfyRunFile,
  saveComfyWorkflow,
  saveComfyWorkflowCover,
  startComfyWorkflowRun,
} from './comfyWorkflows.ts'
import { CanvasConflictError, canEditCanvas, canViewCanvasMedia, createCanvas, createCanvasInvite, deleteCanvasesForProjectRoot, getCanvas, getCanvasInvite, listCanvases, listTrashedCanvases, purgeCanvas, redeemCanvasInvite, restoreCanvas, revokeCanvasInvite, syncCanvas, trashCanvas, updateCanvas } from './canvas.ts'
import { broadcastCanvasPatch, setupCanvasCollaboration } from './canvasCollab.ts'
import { setupSnakeCollaboration } from './snakeCollab.ts'
import { closeDeveloperRealtimeRoom, closeDeveloperRealtimeRoomSystem, createDeveloperRealtimeRoom, developerRealtimeRoom, developerRealtimeStats, ensureDeveloperRealtimeRoom, listDeveloperRealtimeRooms, setupDeveloperRealtime, updateDeveloperRealtimeRoomState } from './developerRealtime.ts'
import { createDeveloperCollabInvite, createDeveloperCollabProject, deleteDeveloperCollabProject, developerCollabRoomAccess, getDeveloperCollabProject, listDeveloperCollabProjects, redeemDeveloperCollabInvite, revokeDeveloperCollabInvite, setDeveloperCollabMembers, updateDeveloperCollabProject } from './developerCollabProjects.ts'
import { bindDeveloperCredential, credentialStatus, developerNetworkRequest } from './developerNetwork.ts'
import { beginDeveloperOAuth, completeDeveloperOAuth, developerOAuthStatus, oauthCallbackHtml } from './developerOAuth.ts'
import { appRuntimeDiagnostics, recordAppRuntimeEvent } from './appDiagnostics.ts'
import { beginDeveloperAppRuntimeObservation, deleteDeveloperApp, developerAppFilePath, developerAppRuntimeFilePath, healthCheckDeveloperApp, importDeveloperApp, listDeveloperAppHistory, listDeveloperApps, pruneDeveloperAppHistories, pruneDeveloperAppHistory, reportDeveloperAppRuntimeHealth, rollbackDeveloperApp, simulateDeveloperAppInstall } from './developerApps.ts'
import { accessCanvasPluginData, deleteCanvasPlugin, getCanvasPluginRegistry, rebuildCanvasPluginRegistry, setCanvasPluginEnabled } from './canvasPlugins.ts'
import { appCatalog, catalogRelease, checkAppUpdates, downloadCatalogRelease, invalidateAppCatalog, releaseAvailableToAudience, type InstalledAppVersion } from './appUpdates.ts'
import { marketplaceAppDetail, marketplaceExplore } from './marketplace.ts'
import { getAppRelease, localReleaseCatalog, publishAppRelease, publicAppRelease, readAppReleasePackage, reviewAppRelease, revokeAppRelease, signingPublicInfo } from './appReleases.ts'
import { ensureBundledApps } from './bundledApps.ts'
import { applyDeclarativeProjectMigration, hasDeveloperProjectSnapshots, restoreDeveloperProjectSnapshots, saveDeveloperProjectSnapshot, saveForwardDeveloperProjectSnapshots } from './developerProjectMigrations.ts'
import { DEVELOPER_RUNTIME_RESOURCE_HEADERS } from './developerRuntime.ts'
import { DEFAULT_DEVELOPER_APP_BUILD, DEFAULT_DEVELOPER_APP_VERSION, DX_BRIDGE_VERSION, DX_OS_VERSION, isValidSemver } from '../shared/appLifecycle.ts'
import { ExpiringStore, OwnedByteStore, startMemoryLifecycleSweep } from './memoryLifecycle.ts'
import { startDesktopParentMonitor, startProcessDiagnostics } from './processDiagnostics.ts'
import { createDeveloperLabDraft, deleteDeveloperLabDraft, developerLabPreview, developerLabZip, developerSystemBridge, getDeveloperLabDraft, listDeveloperLabDrafts, readDeveloperLabFile, setDeveloperLabDraftOwner, setDeveloperLabIcon, verifyDeveloperLabPreviewToken, writeDeveloperLabFile } from './developerLab.ts'
import { autoDeveloperIcon, pngDataUrl, sanitizeDeveloperSvg } from './developerIcon.ts'
import { gomokuDeveloperLabFiles } from './developerLabExamples.ts'
import { DEVELOPER_GUIDE_VERSION, developerGuideFor } from '../shared/developerGuides.ts'
import { runCatalogTool, toolCatalogSnapshot, type ToolSource } from './toolCatalog.ts'
import {
  appPermissionSnapshot,
  appAccessSummary,
  authStatus,
  bootstrap,
  changeOwnPassword,
  createAuthDepartment,
  createAuthUser,
  deleteAuthDepartment,
  deleteAuthUser,
  getAuth,
  listAuthDepartments,
  listAuthUsers,
  localAccountEntitlement,
  login,
  loginResponse,
  logout,
  requireAppOpen,
  requireAuth,
  requireLocalSuperAdmin,
  requireSuperAdmin,
  resetAuthPassword,
  saveAppAccessRule,
  saveAppPermissionPolicy,
  updateAuthDepartment,
  updateAuthUser,
} from './auth.ts'

const app = express()
const PUBLIC_STABLE_APP_IDS = new Set(['canvas', 'comfyui', 'snake'])
// 启动时同步最新的内置 APP 包，让独立包修复无需手动重装。
try { ensureBundledSkillPacks() } catch (error) { console.warn('系统预置 Skill 安装失败：', error) }
try { syncSkillPackRoutes() } catch (error) { console.warn('Skill 包路由迁移失败：', error) }
// Stable releases no longer install fixed APP ZIPs during framework startup.
// Keep the old bootstrap only as an explicit development/migration tool.
if (process.env.DX_ENABLE_BUNDLED_APP_BOOTSTRAP === '1') {
  const remoteAppIds = new Set(
    String(process.env.DX_REMOTE_APP_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^[a-z][a-z0-9-]{1,100}$/.test(id)),
  )
  ensureBundledApps({ excludeIds: remoteAppIds })
}
try { pruneDeveloperAppHistories(1) } catch (error) { console.warn('APP 回滚版本清理失败：', error) }
app.use(express.json({ limit: '4mb' }))
app.use('/api/figma/preview', express.static(FIGMA_PREVIEW_DIR, {
  index: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob: https:; script-src 'self'; style-src 'self' 'unsafe-inline' https:; img-src * data: blob:; font-src * data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
  },
}))

const PORT = Number(process.env.PORT) || 5175
const HOST = process.env.HOST || '0.0.0.0'
const DESKTOP_CONFIG_PATH = String(process.env.DX_DESKTOP_CONFIG_PATH || '')
const PORTABLE_MODE = process.env.DX_PORTABLE === '1'
const DESKTOP_UPDATE_REQUEST_TIMEOUT_MS = 30 * 60 * 1000
const WORKSPACE_ROOT = resolve(process.cwd())
const QUICK_SETUP_CATALOG_URL = `${String(process.env.DX_ACCOUNT_API_URL || 'https://api.dx-os.com').replace(/\/+$/, '')}/v1/quick-settings/catalog`
let quickSetupCatalogCache: { value: unknown; fetchedAt: number } | null = null

function ok(res: express.Response, data: object) {
  res.json({ ok: true, ...data })
}
function fail(res: express.Response, error: string, code = 400) {
  res.status(code).json({ ok: false, error })
}

type DesktopUpdateResult = { status: string; version?: string; files?: string[]; message: string }
const pendingDesktopUpdateRequests = new Map<string, {
  resolve: (result: DesktopUpdateResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}>()

function desktopUpdateControlAvailable() {
  return typeof process.send === 'function' && process.connected === true && !!process.env.DX_DESKTOP_PID
}

function requestDesktopUpdate() {
  return new Promise<DesktopUpdateResult>((resolveRequest, rejectRequest) => {
    if (!desktopUpdateControlAvailable()) {
      rejectRequest(new Error('当前服务不是由 DX OS 桌面程序启动，无法控制桌面更新'))
      return
    }
    const requestId = randomUUID()
    const timer = setTimeout(() => {
      pendingDesktopUpdateRequests.delete(requestId)
      rejectRequest(new Error('桌面更新操作等待超时'))
    }, DESKTOP_UPDATE_REQUEST_TIMEOUT_MS)
    timer.unref?.()
    pendingDesktopUpdateRequests.set(requestId, { resolve: resolveRequest, reject: rejectRequest, timer })
    process.send?.({ type: 'dx-desktop:update-request', requestId }, (error) => {
      if (!error) return
      const pending = pendingDesktopUpdateRequests.get(requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      pendingDesktopUpdateRequests.delete(requestId)
      pending.reject(error)
    })
  })
}

process.on('message', (message: unknown) => {
  const payload = message as { type?: string; requestId?: string; result?: DesktopUpdateResult; error?: string }
  if (payload?.type !== 'dx-desktop:update-response' || typeof payload.requestId !== 'string') return
  const pending = pendingDesktopUpdateRequests.get(payload.requestId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingDesktopUpdateRequests.delete(payload.requestId)
  if (payload.error) pending.reject(new Error(payload.error))
  else if (payload.result) pending.resolve(payload.result)
  else pending.reject(new Error('桌面程序返回了无效的更新结果'))
})

// Electron 用本次启动随机标识确认当前端口确实属于当前封装实例，
// 避免开发服务或旧版本占用端口时误连到错误进程。
app.get('/api/desktop/health', (_req, res) => ok(res, {
  desktopRunId: process.env.DX_DESKTOP_RUN_ID || null,
  pid: process.pid,
  version: process.env.DX_DESKTOP_VERSION || null,
  port: PORT,
}))

function isLoopbackRequest(req: express.Request) {
  const address = req.socket.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

type DesktopConfigFile = { port?: number; lanEnabled?: boolean; dataDirectory?: string; pendingDataMigrationFrom?: string | null; updateUrl?: string }

function desktopConfigFile() {
  if (!DESKTOP_CONFIG_PATH || !existsSync(DESKTOP_CONFIG_PATH)) return {} as DesktopConfigFile
  try {
    return JSON.parse(readFileSync(DESKTOP_CONFIG_PATH, 'utf8')) as DesktopConfigFile
  } catch { return {} }
}

function configuredDesktopPort() {
  const port = Number(desktopConfigFile().port)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : PORT
}

function localIpv4Addresses() {
  const physical: string[] = []
  const fallback: string[] = []
  const virtualAdapter = /(?:^vEthernet\b|\bWSL\b|\bHyper-V\b|\bDefault Switch\b|\bDocker\b|\bVMware\b|\bVirtualBox\b|\bTailscale\b|\bZeroTier\b|^(?:docker|br-|veth|virbr|tun|tap|utun))/i
  for (const [name, entries] of Object.entries(networkInterfaces())) for (const entry of entries || []) {
    if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue
    fallback.push(entry.address)
    if (!virtualAdapter.test(name)) physical.push(entry.address)
  }
  const networkRank = (ip: string) => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
  return [...new Set(physical.length ? physical : fallback)].sort((a, b) => networkRank(a) - networkRank(b) || a.localeCompare(b))
}

function requestAccessEndpoint(req: express.Request) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const rawHost = forwardedHost || String(req.headers.host || '').trim()
  let hostname = ''
  let port = 0
  try {
    const parsed = new URL(`http://${rawHost}`)
    hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    port = Number(parsed.port)
  } catch { /* fall back to the API listener */ }
  const forwardedPort = Number(String(req.headers['x-forwarded-port'] || '').split(',')[0].trim())
  if (Number.isInteger(forwardedPort) && forwardedPort >= 1 && forwardedPort <= 65535) port = forwardedPort
  if (!Number.isInteger(port) || port < 1 || port > 65535) port = PORT
  return { hostname, port }
}

function accessUrl(hostname: string, port: number) {
  const host = hostname.includes(':') ? `[${hostname}]` : hostname
  return `http://${host}:${port}`
}

function desktopAccessUrls(req: express.Request, lanEnabled: boolean, localIps: string[]) {
  const endpoint = requestAccessEndpoint(req)
  if (!lanEnabled) return [accessUrl('127.0.0.1', endpoint.port)]
  const requestedIp = localIps.includes(endpoint.hostname) && endpoint.hostname !== '127.0.0.1'
    ? endpoint.hostname
    : ''
  const orderedIps = [...new Set([requestedIp, ...localIps].filter(Boolean))]
  return orderedIps.length ? orderedIps.map((ip) => accessUrl(ip, endpoint.port)) : [accessUrl('127.0.0.1', endpoint.port)]
}

app.get('/api/desktop/config', (req, res) => {
  const config = desktopConfigFile()
  const hostAllowsLan = !['127.0.0.1', 'localhost', '::1'].includes(HOST)
  const lanEnabled = config.lanEnabled === true || (!DESKTOP_CONFIG_PATH && hostAllowsLan)
  const localIps = localIpv4Addresses()
  const accessPort = requestAccessEndpoint(req).port
  ok(res, {
    port: PORT,
    accessPort,
    configuredPort: configuredDesktopPort(),
    dataDirectory: String(process.env.DX_DATA_DIR || ''),
    configuredDataDirectory: String(config.dataDirectory || process.env.DX_DATA_DIR || ''),
    updateUrl: String(config.updateUrl || process.env.DX_UPDATE_URL || ''),
    lanEnabled,
    localIps,
    accessUrls: desktopAccessUrls(req, lanEnabled, localIps),
    portable: PORTABLE_MODE,
    version: process.env.DX_DESKTOP_VERSION || null,
    updateControlAvailable: desktopUpdateControlAvailable(),
    configurable: !!DESKTOP_CONFIG_PATH,
    canConfigure: !!DESKTOP_CONFIG_PATH && isLoopbackRequest(req),
  })
})

app.post('/api/desktop/update/check', requireSuperAdmin, async (_req, res) => {
  try {
    ok(res, await requestDesktopUpdate())
  } catch (error) {
    fail(res, String((error as Error).message || error), desktopUpdateControlAvailable() ? 502 : 409)
  }
})

app.put('/api/desktop/config', (req, res) => {
  if (!DESKTOP_CONFIG_PATH) return fail(res, '开发版端口固定为 5175', 409)
  if (!isLoopbackRequest(req)) return fail(res, '只能在运行正式版的电脑上修改端口', 403)
  const port = Number(req.body?.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return fail(res, '端口必须是 1024 到 65535 之间的整数')
  const previous = desktopConfigFile()
  const lanEnabled = typeof req.body?.lanEnabled === 'boolean' ? req.body.lanEnabled : previous.lanEnabled === true
  let dataDirectory = String(previous.dataDirectory || process.env.DX_DATA_DIR || '').trim()
  if (!PORTABLE_MODE && typeof req.body?.dataDirectory === 'string') {
    const requested = req.body.dataDirectory.trim()
    if (!requested || !isAbsolute(requested)) return fail(res, '数据目录必须是完整的本机绝对路径')
    const resolved = resolve(requested)
    if (resolved === parse(resolved).root) return fail(res, '不能把整个磁盘根目录直接作为数据目录')
    dataDirectory = resolved
  }
  const currentDataDirectory = resolve(String(process.env.DX_DATA_DIR || dataDirectory))
  if (PORTABLE_MODE) dataDirectory = currentDataDirectory
  const dataDirectoryChanged = !PORTABLE_MODE && !!dataDirectory && resolve(dataDirectory).toLowerCase() !== currentDataDirectory.toLowerCase()
  let updateUrl = String(previous.updateUrl || process.env.DX_UPDATE_URL || '').trim().replace(/\/+$/, '')
  if (typeof req.body?.updateUrl === 'string') {
    updateUrl = req.body.updateUrl.trim().replace(/\/+$/, '')
    if (updateUrl) {
      try {
        const parsedUrl = new URL(updateUrl)
        const localHttp = parsedUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)
        if (parsedUrl.protocol !== 'https:' && !localHttp) return fail(res, '系统更新地址必须使用 HTTPS；本机测试可以使用 localhost HTTP')
      } catch { return fail(res, '系统更新地址格式不正确') }
    }
  }
  try {
    mkdirSync(dirname(DESKTOP_CONFIG_PATH), { recursive: true })
    writeFileSync(DESKTOP_CONFIG_PATH, `${JSON.stringify({
      ...previous,
      port,
      lanEnabled,
      dataDirectory,
      pendingDataMigrationFrom: dataDirectoryChanged ? currentDataDirectory : previous.pendingDataMigrationFrom || null,
      updateUrl,
    }, null, 2)}\n`, 'utf8')
    const localIps = localIpv4Addresses()
    ok(res, {
      port: PORT, configuredPort: port, lanEnabled, localIps,
      accessUrls: lanEnabled ? localIps.map((ip) => `http://${ip}:${port}`) : [`http://127.0.0.1:${port}`],
      dataDirectory: currentDataDirectory,
      configuredDataDirectory: dataDirectory,
      updateUrl,
      restartRequired: port !== PORT || lanEnabled !== (previous.lanEnabled === true) || dataDirectoryChanged,
    })
  } catch (error) {
    fail(res, `保存桌面设置失败：${String((error as Error).message || error)}`, 500)
  }
})

function isInsideWorkspace(path: string) {
  const abs = resolve(path)
  const rel = relative(WORKSPACE_ROOT, abs)
  return rel === '' || (!!rel && !rel.startsWith('..') && !resolve(rel).startsWith('..'))
}

const fsEventClients = new Set<express.Response>()
function emitFsEvent(type = 'changed') {
  const payload = `data: ${JSON.stringify({ type, ts: Date.now() })}\n\n`
  for (const client of fsEventClients) {
    try { client.write(payload) } catch { fsEventClients.delete(client) }
  }
}

// 第一阶段只提供认证能力，现有业务路由将在后续阶段逐个接入服务端授权中间件。
app.get('/api/auth/status', (_req, res) => ok(res, authStatus()))
app.get('/api/calendar/almanac', requireAuth, async (req, res) => {
  try {
    const years = String(req.query.years || '').split(',').map(Number).filter(Number.isFinite)
    ok(res, { years: await onlineCalendarYears(years) })
  } catch (error) {
    fail(res, String((error as Error).message || error), 502)
  }
})
app.post('/api/auth/bootstrap', async (req, res) => {
  try {
    const result = await bootstrap(String(req.body?.username || ''), String(req.body?.password || ''), req.ip)
    // 初始文件（seed/历史无主文件）归属第一位超管，避免对所有用户可见
    claimOwnerlessNodes(result.user.id)
    ok(res, loginResponse(req, res, result))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await login(String(req.body?.username || ''), String(req.body?.password || ''), req.ip)
    if (!result) return fail(res, '用户名或密码错误', 401)
    ok(res, loginResponse(req, res, result))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/auth/logout', (req, res) => {
  logout(req, res, req.ip)
  ok(res, {})
})
app.get('/api/auth/me', (req, res) => {
  const auth = getAuth(req)
  if (!auth) return fail(res, '请先登录', 401)
  ok(res, { user: auth.user })
})
app.get('/api/auth/access', (req, res) => {
  const auth = getAuth(req)
  if (!auth) return fail(res, '请先登录', 401)
  ok(res, { appAccess: appAccessSummary(auth.user) })
})
// DX OS 正式云账号独立于本机权限账号。Token 只保存在服务端加密库，不返回浏览器。
app.get('/api/cloud-account/status', requireLocalSuperAdmin, async (req, res) => {
  try {
    ok(res, await cloudAccountStatus(req.auth!.user.id))
  } catch (e) {
    fail(res, String((e as Error).message || e), 502)
  }
})
app.post('/api/cloud-account/login', requireLocalSuperAdmin, async (req, res) => {
  try {
    ok(res, await loginCloudAccount(
      req.auth!.user.id,
      String(req.body?.email || ''),
      String(req.body?.password || ''),
    ))
  } catch (e) {
    // 不返回 401：前端把 401 专用于“本机权限会话失效”，云账号密码错误不能退出本机账号。
    fail(res, String((e as Error).message || e), 400)
  }
})
app.post('/api/cloud-account/logout', requireLocalSuperAdmin, async (req, res) => {
  try {
    ok(res, await logoutCloudAccount(req.auth!.user.id))
  } catch (e) {
    fail(res, String((e as Error).message || e), 502)
  }
})
// 本人修改密码（首次登录强制改密也走这里）
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    await changeOwnPassword(req.auth!.user.id, String(req.body?.oldPassword || ''), String(req.body?.newPassword || ''), req.ip)
    ok(res, {})
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

// ── 自动化：服务端保管计划，登录中的桌面客户端领取并执行 ──────────────
app.get('/api/automations', requireAuth, (req, res) => {
  ok(res, { automations: listAutomations(req.auth!.user.id) })
})
app.post('/api/automations/parse', requireAuth, async (req, res) => {
  const instruction = String(req.body?.instruction || '').trim()
  if (!instruction) return fail(res, '请输入要自动执行的事情')
  let fallback: AutomationDefinition
  try { fallback = parseAutomationFallback(instruction) }
  catch (e) { return fail(res, String((e as Error).message || e)) }

  const stored = firstUsableProvider()
  if (!stored || !stored.enabled) return ok(res, { definition: fallback, parsedBy: 'rules' })
  const llmModel = stored.models?.find((model) => (model.caps || []).includes('llm'))?.model || stored.models?.[0]?.model
  if (!llmModel) return ok(res, { definition: fallback, parsedBy: 'rules' })
  const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }
  const tools = [{
    type: 'function',
    function: {
      name: 'define_automation',
      description: '把用户要求转换成一个定时自动化定义。只能使用给定的动作类型。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          schedule: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['daily', 'weekly', 'once'] },
              hour: { type: 'integer', minimum: 0, maximum: 23 },
              minute: { type: 'integer', minimum: 0, maximum: 59 },
              weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: '0 是周日，1 是周一' },
              at: { type: 'integer', description: '单次执行的 Unix 毫秒时间戳' },
              timezone: { type: 'string' },
            },
            required: ['type'],
          },
          action: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['music_play', 'music_control', 'open_app', 'agent_instruction'] },
              args: { type: 'object' },
            },
            required: ['type', 'args'],
          },
        },
        required: ['title', 'schedule', 'action'],
      },
    },
  }]
  try {
    const result = await chatWithTools(
      provider,
      llmModel,
      [{ role: 'user', content: instruction }],
      `当前时区和用户时区都是 Asia/Shanghai，当前时间是 ${new Date().toISOString()}。必须调用 define_automation。播放音乐用 music_play，打开已注册 APP 用 open_app；其他要求原样放入 agent_instruction 的 instruction 参数。`,
      tools,
    )
    const call = result.toolCalls.find((item) => item.name === 'define_automation')
    if (!call) return ok(res, { definition: fallback, parsedBy: 'rules' })
    const args = JSON.parse(call.arguments || '{}') as Partial<AutomationDefinition>
    const definition = normalizeDefinition({ ...args, instruction })
    ok(res, { definition, parsedBy: 'ai' })
  } catch {
    ok(res, { definition: fallback, parsedBy: 'rules' })
  }
})
app.post('/api/automations', requireAuth, (req, res) => {
  try { ok(res, { automation: createAutomation(req.auth!.user.id, req.body || {}) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.patch('/api/automations/:id', requireAuth, (req, res) => {
  try { ok(res, { automation: updateAutomation(req.auth!.user.id, req.params.id, req.body || {}) }) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.delete('/api/automations/:id', requireAuth, (req, res) => {
  try { deleteAutomation(req.auth!.user.id, req.params.id); ok(res, {}) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.post('/api/automations/:id/run-now', requireAuth, (req, res) => {
  try { ok(res, runAutomationNow(req.auth!.user.id, req.params.id, String(req.body?.clientId || 'manual'))) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.post('/api/automations/claim', requireAuth, (req, res) => {
  ok(res, { claimed: claimDueAutomation(req.auth!.user.id, String(req.body?.clientId || 'desktop')) })
})
app.post('/api/automation-runs/:id/complete', requireAuth, (req, res) => {
  try {
    const status = req.body?.status === 'success' ? 'success' : 'failed'
    completeAutomationRun(req.auth!.user.id, req.params.id, { status, result: String(req.body?.result || ''), error: String(req.body?.error || '') })
    ok(res, {})
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})

// 账户、部门和 APP 权限只允许超级管理员修改。Skill、MCP 与 Agent 调用
// 不经过这些路由或下方的 APP 打开中间件。
app.get('/api/accounts/snapshot', requireSuperAdmin, (req, res) => {
  ok(res, {
    users: listAuthUsers(),
    departments: listAuthDepartments(),
    accountEntitlement: localAccountEntitlement(),
    ...appPermissionSnapshot(req.auth!.user.id),
  })
})
app.post('/api/accounts/users', requireSuperAdmin, async (req, res) => {
  try {
    ok(res, { user: await createAuthUser(req.body || {}, req.auth!.user, req.ip) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.patch('/api/accounts/users/:id', requireSuperAdmin, (req, res) => {
  try {
    ok(res, { user: updateAuthUser(req.params.id, req.body || {}, req.auth!.user, req.ip) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/accounts/users/:id/reset-password', requireSuperAdmin, async (req, res) => {
  try {
    await resetAuthPassword(req.params.id, String(req.body?.password || ''), req.auth!.user, req.ip)
    ok(res, {})
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/accounts/users/:id', requireSuperAdmin, (req, res) => {
  try {
    deleteAuthUser(req.params.id, req.auth!.user, req.ip)
    ok(res, { id: req.params.id })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/accounts/departments', requireSuperAdmin, (req, res) => {
  try {
    const department = createAuthDepartment(String(req.body?.name || ''), req.auth!.user, req.ip)
    ensureDepartmentRoot(department.id, department.name)
    ok(res, { department })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.patch('/api/accounts/departments/:id', requireSuperAdmin, (req, res) => {
  try {
    const department = updateAuthDepartment(req.params.id, String(req.body?.name || ''), req.auth!.user, req.ip)
    renameShareRoot(`department:${department.id}`, `${department.name}（部门）`)
    ok(res, { department })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/accounts/departments/:id', requireSuperAdmin, (req, res) => {
  try {
    deleteAuthDepartment(req.params.id, req.auth!.user, req.ip)
    removeShareRoot(`department:${req.params.id}`)
    ok(res, { id: req.params.id })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/app-permissions', requireAuth, (req, res) => {
  if (req.auth!.user.role !== 'superadmin' && req.auth!.user.role !== 'admin') return fail(res, '需要管理员权限', 403)
  ok(res, { ...appPermissionSnapshot(req.auth!.user.id), departments: listAuthDepartments() })
})
app.put('/api/app-permissions/open/:appId', requireSuperAdmin, (req, res) => {
  try {
    ok(res, { rule: saveAppAccessRule(req.params.appId, req.body || {}, req.auth!.user, req.ip) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.put('/api/app-permissions/policies/:permissionCode', requireSuperAdmin, (req, res) => {
  try {
    ok(res, { policy: saveAppPermissionPolicy(req.params.permissionCode, req.body || {}, req.auth!.user, req.ip) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

// Preview documents run in an opaque-origin sandbox. SameSite session cookies are
// intentionally unavailable to their subresources, so a per-draft capability token
// gates the local read-only preview. Ownership still gates every authenticated API.
app.get('/api/market/developer-lab/:id/preview/:token/*', (req, res) => {
  try {
    verifyDeveloperLabPreviewToken(req.params.id, req.params.token)
    const path = (req.params as Record<string, string>)['0'] || 'index.html'
    const file = developerLabPreview(req.params.id, path)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.type(file.mime).send(file.data)
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})

// Installed apps also run with an opaque iframe origin. A random per-install token
// gives that sandbox read-only access to its own static files without session cookies.
const MAX_DEVELOPER_ARTIFACT_TOKENS = 10_000
const developerArtifactTokens = new ExpiringStore<{ nodeId: string; expiresAt: number }>(MAX_DEVELOPER_ARTIFACT_TOKENS)

app.get('/api/developer-runtime/:token/*', (req, res) => {
  try {
    const filePath = (req.params as Record<string, string>)['0'] || 'index.html'
    const target = developerAppRuntimeFilePath(String(req.params.token || ''), filePath)
    for (const [name, value] of Object.entries(DEVELOPER_RUNTIME_RESOURCE_HEADERS)) res.setHeader(name, value)
    if (extname(filePath).toLowerCase() === '.html') {
      const html = readFileSync(target, 'utf8')
      const bridge = developerSystemBridge(false)
      return res.type('html').send(html.includes('</head>') ? html.replace('</head>', `${bridge}</head>`) : `${bridge}${html}`)
    }
    res.sendFile(target)
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})

// Short-lived, opaque URLs let sandboxed APP previews display their own binary
// project artifacts without receiving the user's login cookie or a filesystem path.
app.get('/api/developer-artifacts/:token', (req, res) => {
  const token = String(req.params.token || '')
  const record = developerArtifactTokens.get(token)
  if (!record || record.expiresAt < Date.now()) {
    developerArtifactTokens.delete(token)
    return fail(res, 'Artifact 链接已过期', 404)
  }
  const node = getNode(record.nodeId)
  if (!node || node.type !== 'file') return fail(res, 'Artifact 不存在', 404)
  const data = node.content !== undefined ? Buffer.from(node.content, 'utf8') : readBlob(node.id)
  if (!data) return fail(res, 'Artifact 内容不存在', 404)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.type(node.mime || 'application/octet-stream').send(data)
})

app.get('/api/developer-oauth/callback', async (req, res) => {
  const state = String(req.query.state || '')
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error))
    const result = await completeDeveloperOAuth(state, String(req.query.code || ''))
    res.type('html').send(oauthCallbackHtml({ state: result.state, ok: true }))
  } catch (error) {
    res.status(400).type('html').send(oauthCallbackHtml({ state, ok: false, message: String((error as Error).message || error) }))
  }
})

// 风险 APP 的服务端接口通过登录会话判断。公共 MCP、Skill 与 Agent 路由保持匿名可用。
app.use('/api/providers', requireAppOpen('api-settings'))
app.use('/api/midjourney', requireAppOpen('api-settings'))
app.use('/api/runninghub', requireAppOpen('api-settings'))
app.use('/api/cli', requireAppOpen('api-settings'))
app.use('/api/dingtalk', requireAppOpen('dingtalk'))
app.use('/api/market', requireAppOpen('market'))
app.use('/api/comfyui', requireAppOpen('comfyui'))
app.use('/api/quark', requireAppOpen('quark'))
app.use('/api/ai-image-declaration', requireAppOpen('ai-image-declaration'))
app.use('/api/canvas', requireAuth)
app.use('/api/ai-tasks', requireAuth)
app.use('/api/preferences', requireAuth)
app.use('/api/video', requireAppOpen('video-editor'))

/**
 * 从请求体解析出「带真实 key 的 provider」：
 * - 若带 id，用库里存的凭据打底；请求体里新填的值优先（编辑时前端不回显 key）。
 * - 否则直接用请求体里的字段（新建未保存时的即时测试）。
 */
function resolveFromBody(body: Record<string, unknown>): ResolvedProvider | null {
  const stored: Provider | null = body.id ? revealProvider(String(body.id)) : null
  if (stored?.source === 'cli') return { base_url: stored.base_url || `cli://${stored.cli_tool || 'tool'}`, api_key: stored.api_key || '', wallet_api_key: stored.wallet_api_key || '', protocol: stored.protocol || `cli:${stored.cli_tool || 'tool'}` }
  const base_url = String(body.base_url || body.baseUrl || stored?.base_url || '').trim().replace(/\/+$/, '')
  const api_key = String(body.api_key || body.apiKey || stored?.api_key || '').trim()
  const wallet_api_key = String(body.wallet_api_key || body.walletApiKey || stored?.wallet_api_key || '').trim()
  const protocol = String(body.protocol || stored?.protocol || 'openai').trim()
  if (!base_url) return null
  return { base_url, api_key, wallet_api_key, protocol }
}

function storedFromBody(body: Record<string, unknown>): Provider | null {
  return body.id ? revealProvider(String(body.id)) : null
}

function isJimengCliRequest(body: Record<string, unknown>) {
  const stored = storedFromBody(body)
  const protocol = String(body.model_protocol || body.protocol || stored?.protocol || '').trim().toLowerCase()
  return stored?.source === 'cli' && stored.cli_tool === 'jimeng' || protocol === 'cli:jimeng' || protocol === 'jimeng-cli'
}

function resolveModelProtocol(body: Record<string, unknown>, fallback: ResolvedProvider): ResolvedProvider {
  const stored: Provider | null = body.id ? revealProvider(String(body.id)) : null
  const model = String(body.model || '').trim()
  const modelProtocol = stored?.models?.find((entry) => entry.model === model)?.protocol
  const protocol = String(body.model_protocol || modelProtocol || body.protocol || fallback.protocol || 'openai').trim()
  return { ...fallback, protocol }
}

// ── 协议列表 ──────────────────────────────────────────────────────────
app.get('/api/quick-settings/catalog', async (req, res) => {
  try {
    if (!req.query.refresh && quickSetupCatalogCache && Date.now() - quickSetupCatalogCache.fetchedAt < 120_000) return ok(res, quickSetupCatalogCache.value as object)
    const response = await fetch(QUICK_SETUP_CATALOG_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const value = await response.json() as object
    quickSetupCatalogCache = { value, fetchedAt: Date.now() }
    ok(res, value)
  } catch (e) {
    if (quickSetupCatalogCache) return ok(res, { ...(quickSetupCatalogCache.value as object), stale: true })
    fail(res, `快捷设置目录加载失败：${String((e as Error).message || e)}`, 502)
  }
})
app.get('/api/protocols', (_req, res) => ok(res, { protocols: listProtocols() }))
app.get('/api/protocols/details', (_req, res) => ok(res, { protocols: listProtocolDetails() }))
app.get('/api/protocols/providers/details', (_req, res) => ok(res, { protocols: listProviderProtocolDetails() }))
app.get('/api/protocols/models', (_req, res) => ok(res, { protocols: listModelProtocols() }))
app.get('/api/protocols/models/details', (_req, res) => ok(res, { protocols: listModelProtocolDetails() }))
app.post('/api/protocols/custom', (req, res) => {
  try {
    const kind = String(req.body?.kind || '')
    if (kind !== 'provider' && kind !== 'model') return fail(res, 'kind 必须是 provider 或 model', 400)
    const protocol = saveCustomProtocol(kind, req.body?.protocol)
    ok(res, { protocol })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.delete('/api/protocols/custom/:kind/:id', (req, res) => {
  try {
    const kind = String(req.params.kind || '')
    if (kind !== 'provider' && kind !== 'model') return fail(res, 'kind 必须是 provider 或 model', 400)
    const id = String(req.params.id || '').trim().toLowerCase()
    const usedBy = listProviders().filter((provider) => kind === 'provider'
      ? provider.protocol === id
      : provider.models.some((model) => model.protocol === id))
    if (usedBy.length) return fail(res, `协议正在被站点「${usedBy.map((provider) => provider.name).join('、')}」使用，请先更换对应协议。`, 409)
    ok(res, { id: removeCustomProtocol(kind, id) })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.get('/api/protocols/v2', (req, res) => {
  try {
    const kind = String(req.query.kind || '')
    if (kind && kind !== 'provider' && kind !== 'model') return fail(res, 'kind 必须是 provider 或 model', 400)
    ok(res, { protocols: listProtocolsV2(kind ? kind as ProtocolV2Kind : undefined) })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.post('/api/protocols/v2/validate', (req, res) => {
  try {
    const protocol = validateProtocolV2(req.body?.protocol)
    ok(res, { valid: true, protocol })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.post('/api/protocols/v2', (req, res) => {
  try {
    const kind = String(req.body?.kind || '')
    if (kind !== 'provider' && kind !== 'model') return fail(res, 'kind 必须是 provider 或 model', 400)
    ok(res, { entry: saveProtocolV2(kind, req.body?.protocol) })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.post('/api/protocols/v2/:kind/:id/activate', (req, res) => {
  try {
    const kind = String(req.params.kind || '')
    if (kind !== 'provider' && kind !== 'model') return fail(res, 'kind 必须是 provider 或 model', 400)
    const version = Number(req.body?.version)
    if (!Number.isInteger(version) || version < 1) return fail(res, 'version 必须是正整数', 400)
    ok(res, { entry: activateProtocolV2(kind, req.params.id, version) })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.delete('/api/protocols/v2/:kind/:id', (req, res) => {
  try {
    const kind = String(req.params.kind || '')
    if (kind !== 'provider' && kind !== 'model') return fail(res, 'kind 必须是 provider 或 model', 400)
    ok(res, { id: removeProtocolV2(kind, req.params.id) })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.post('/api/protocols/v2/compile', (req, res) => {
  try {
    const body = req.body || {}
    const providerVersion = body.providerVersion == null ? undefined : Number(body.providerVersion)
    const modelVersion = body.modelVersion == null ? undefined : Number(body.modelVersion)
    const providerStored = body.providerProtocolId ? getProtocolV2('provider', String(body.providerProtocolId), providerVersion) : null
    const modelStored = body.modelProtocolId ? getProtocolV2('model', String(body.modelProtocolId), modelVersion) : null
    const providerProtocol = body.providerProtocol || providerStored?.protocol
    const modelProtocol = body.modelProtocol || modelStored?.protocol
    if (!providerProtocol || !modelProtocol) return fail(res, '缺少 v2 平台协议或模型协议', 400)
    const task = body.task || {}
    const assets = (value: unknown, kind: StandardProtocolAsset['kind']) => (Array.isArray(value) ? value : []).map((item) => {
      const asset = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
      return {
        kind,
        ...(asset.url ? { url: String(asset.url) } : {}),
        ...(asset.dataUrl ? { dataUrl: String(asset.dataUrl) } : {}),
        ...(asset.name ? { name: String(asset.name) } : {}),
        ...(asset.mime ? { mime: String(asset.mime) } : {}),
        ...(asset.role ? { role: String(asset.role) } : {}),
      } satisfies StandardProtocolAsset
    })
    const input = task.inputs && typeof task.inputs === 'object' && !Array.isArray(task.inputs) ? task.inputs as Record<string, unknown> : {}
    const plan = compileProtocolPlan({
      providerProtocol,
      modelProtocol,
      baseUrl: String(body.baseUrl || ''),
      task: {
        requestId: String(task.requestId || randomUUID()),
        model: String(task.model || ''),
        intent: String(task.intent || '') as CapabilityIntent,
        prompt: String(task.prompt || ''),
        params: task.params && typeof task.params === 'object' && !Array.isArray(task.params) ? task.params as Record<string, unknown> : {},
        inputs: {
          images: assets(input.images, 'image'),
          videos: assets(input.videos, 'video'),
          audios: assets(input.audios, 'audio'),
          files: assets(input.files, 'file'),
        },
      },
      redactSecrets: true,
    })
    ok(res, {
      plan,
      pinned: {
        provider: providerStored ? { id: providerStored.protocol.id, version: providerStored.version, hash: providerStored.hash } : null,
        model: modelStored ? { id: modelStored.protocol.id, version: modelStored.version, hash: modelStored.hash } : null,
      },
    })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.post('/api/ai-tasks/protocol/dry-run', async (req, res) => {
  try {
    const body = req.body || {}
    const rawTask = body.task && typeof body.task === 'object' && !Array.isArray(body.task) ? body.task as Record<string, unknown> : {}
    const rawInputs = rawTask.inputs && typeof rawTask.inputs === 'object' && !Array.isArray(rawTask.inputs) ? rawTask.inputs as Record<string, unknown> : {}
    const assets = (value: unknown, kind: StandardProtocolAsset['kind']): StandardProtocolAsset[] => (Array.isArray(value) ? value : []).map((item) => {
      const asset = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
      return { kind, ...(asset.url ? { url: String(asset.url) } : {}), ...(asset.dataUrl ? { dataUrl: String(asset.dataUrl) } : {}), ...(asset.name ? { name: String(asset.name) } : {}), ...(asset.mime ? { mime: String(asset.mime) } : {}), ...(asset.role ? { role: String(asset.role) } : {}) }
    })
    const task = await submitAiProtocolTask({
      mode: 'dry-run',
      ownerId: String(req.auth!.user.id),
      providerProtocolId: String(body.providerProtocolId || ''),
      providerProtocolVersion: body.providerProtocolVersion == null ? undefined : Number(body.providerProtocolVersion),
      modelProtocolId: String(body.modelProtocolId || ''),
      modelProtocolVersion: body.modelProtocolVersion == null ? undefined : Number(body.modelProtocolVersion),
      baseUrl: String(body.baseUrl || ''),
      task: {
        requestId: String(rawTask.requestId || randomUUID()),
        model: String(rawTask.model || ''),
        intent: String(rawTask.intent || '') as CapabilityIntent,
        prompt: String(rawTask.prompt || ''),
        params: rawTask.params && typeof rawTask.params === 'object' && !Array.isArray(rawTask.params) ? rawTask.params as Record<string, unknown> : {},
        inputs: {
          images: assets(rawInputs.images, 'image'),
          videos: assets(rawInputs.videos, 'video'),
          audios: assets(rawInputs.audios, 'audio'),
          files: assets(rawInputs.files, 'file'),
        },
      },
    })
    ok(res, { task })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.get('/api/ai-tasks/protocol/:id', (req, res) => {
  const task = getAiProtocolTask(String(req.params.id || ''))
  const isOwner = task?.owner_id && task.owner_id === String(req.auth!.user.id)
  if (!task || (!isOwner && req.auth!.user.role !== 'superadmin')) return fail(res, '协议任务不存在', 404)
  ok(res, { task })
})
app.get('/api/protocols/v2/execution-flags', requireSuperAdmin, (_req, res) => {
  ok(res, { rules: listProtocolExecutionFlags() })
})
app.put('/api/protocols/v2/execution-flags', requireSuperAdmin, (req, res) => {
  try {
    ok(res, { rule: setProtocolExecutionFlag({
      providerProtocolId: String(req.body?.providerProtocolId || ''),
      modelProtocolId: String(req.body?.modelProtocolId || ''),
      profileId: String(req.body?.profileId || ''),
      intent: String(req.body?.intent || '') as CapabilityIntent,
      enabled: req.body?.enabled === true,
    }) })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.post('/api/protocols/route-test', (req, res) => {
  try {
    const body = req.body || {}
    const route = resolveModel({
      taskIntent: body.taskIntent ? String(body.taskIntent) : undefined,
      intent: body.intent ? String(body.intent) : undefined,
      requiresAll: Array.isArray(body.requiresAll) ? body.requiresAll.map(String).filter(Boolean) : undefined,
      requiresAny: Array.isArray(body.requiresAny) ? body.requiresAny.map(String).filter(Boolean) : undefined,
      providerId: body.providerId ? String(body.providerId) : undefined,
      model: body.model ? String(body.model) : undefined,
      preferredModel: body.preferredModel ? String(body.preferredModel) : undefined,
      fallbackPolicy: ['strict', 'compatible', 'best_available'].includes(String(body.fallbackPolicy || '')) ? body.fallbackPolicy : undefined,
    })
    const { api_key: _apiKey, ...safeProvider } = route.provider
    const tools = body.includeTools === false ? null : resolveReactTools(req.auth?.user || null)
    ok(res, {
      route: {
        ...route,
        provider: {
          ...safeProvider,
          has_key: !!route.provider.api_key,
          key_mask: route.provider.api_key ? `${route.provider.api_key.slice(0, 4)}••••${route.provider.api_key.slice(-4)}` : '',
        },
      },
      tools: tools ? {
        total: tools.descriptors.length,
        file: tools.descriptors.filter((tool) => tool.source === 'file').length,
        skill: tools.descriptors.filter((tool) => tool.source === 'skill').length,
        names: tools.descriptors.map((tool) => tool.name),
      } : null,
    })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
app.post('/api/protocols/parameter-schema', (req, res) => {
  try {
    const body = req.body || {}
    const providerId = String(body.providerId || '').trim()
    const model = String(body.model || '').trim()
    const intent = String(body.intent || '').trim()
    const stored = providerId ? getProvider(providerId) : null
    const modelProtocol = stored?.models?.find((entry) => entry.model === model)?.protocol
    const protocolId = String(body.protocol || modelProtocol || stored?.protocol || '').trim()
    if (!protocolId || !model || !intent) return fail(res, '缺少 protocol/model/intent', 400)
    const schema = resolveParameterSchema(protocolId, model, intent as CapabilityIntent)
    if (schema && (protocolId === 'modelscope' || stored?.protocol === 'modelscope') && intent.startsWith('image.')) {
      const loras = normalizeModelScopeLoras(stored?.ms_loras).filter((item) => item.enabled && item.target_model === model)
      schema.fields = [
        ...schema.fields,
        {
          key: 'modelscope_lora', label: 'LoRA', type: 'select', default: '',
          options: [{ label: '不使用 LoRA', value: '' }, ...loras.map((item) => ({ label: item.name || item.id, value: item.id, strength: item.strength }))],
        },
        { key: 'modelscope_lora_strength', label: 'LoRA 强度', type: 'slider', default: loras[0]?.strength ?? 0.8, min: 0.1, max: 1, step: 0.05 },
      ]
      schema.defaults = { ...schema.defaults, modelscope_lora: '', modelscope_lora_strength: loras[0]?.strength ?? 0.8 }
    }
    ok(res, { schema })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})

// ── 站点 CRUD ─────────────────────────────────────────────────────────
app.get('/api/providers', (_req, res) => ok(res, { providers: listProviders() }))

app.post('/api/providers/export', (req, res) => {
  const includeSecrets = req.body?.includeSecrets === true
  const providers = allProviders().map((provider) => {
    const { created_ts: _createdTs, updated_ts: _updatedTs, ...portable } = provider
    if (includeSecrets) return portable
    const { api_key: _apiKey, wallet_api_key: _walletApiKey, ...withoutSecrets } = portable
    return withoutSecrets
  })
  res.setHeader('Cache-Control', 'private, no-store')
  ok(res, {
    bundle: {
      format: 'dx-os/api-providers',
      version: 1,
      exportedAt: new Date().toISOString(),
      containsSecrets: includeSecrets && providers.some((provider) => String('api_key' in provider ? provider.api_key : '').trim() || String('wallet_api_key' in provider ? provider.wallet_api_key : '').trim()),
      autoFallback: getAutoFallback(),
      providers,
    },
  })
})

app.post('/api/providers/import', (req, res) => {
  try {
    const bundle = req.body?.bundle
    if (!bundle || bundle.format !== 'dx-os/api-providers' || Number(bundle.version) !== 1 || !Array.isArray(bundle.providers)) {
      return fail(res, '不是有效的 DX OS API 配置文件', 400)
    }
    if (!bundle.providers.length) return fail(res, '配置文件中没有 API 平台', 400)
    if (bundle.providers.length > 200) return fail(res, '单次最多导入 200 个 API 平台', 400)
    const conflict = ['update', 'skip', 'copy'].includes(String(req.body?.conflict)) ? String(req.body.conflict) : 'update'
    const knownIds = new Set(listProviders().map((provider) => provider.id))
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    const applied: Array<{ id: string; source: Record<string, unknown>; index: number }> = []
    for (const [index, value] of bundle.providers.entries()) {
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('平台记录格式错误')
        const provider = { ...(value as Record<string, unknown>) }
        const id = String(provider.id || '').trim()
        if (!id || id.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id)) throw new Error('平台 ID 不合法')
        if (!String(provider.name || '').trim()) throw new Error('平台名称不能为空')
        if (!Array.isArray(provider.models)) throw new Error('模型列表格式错误')
        const exists = knownIds.has(id)
        if (exists && conflict === 'skip') { skipped++; continue }
        if (exists && conflict === 'copy') delete provider.id
        const saved = saveProvider(provider)
        knownIds.add(saved.id)
        applied.push({ id: saved.id, source: provider, index })
        if (exists && conflict === 'update') updated++
        else created++
      } catch (error) {
        errors.push(`第 ${index + 1} 项：${String((error as Error).message || error)}`)
      }
    }
    if (applied.length) {
      const rank = (item: { source: Record<string, unknown>; index: number }, cap?: 'llm' | 'image' | 'video' | 'audio') => {
        if (cap && item.source.cap_sort && typeof item.source.cap_sort === 'object') {
          const value = Number((item.source.cap_sort as Record<string, unknown>)[cap])
          if (Number.isFinite(value) && value > 0) return value
        }
        const value = Number(item.source.sort)
        return Number.isFinite(value) && value > 0 ? value : item.index + 1
      }
      reorderProviders([...applied].sort((a, b) => rank(a) - rank(b)).map((item) => item.id))
      for (const cap of ['llm', 'image', 'video', 'audio'] as const) {
        reorderProviders([...applied].sort((a, b) => rank(a, cap) - rank(b, cap)).map((item) => item.id), cap)
      }
    }
    if (typeof bundle.autoFallback === 'boolean') setAutoFallback(bundle.autoFallback)
    ok(res, { created, updated, skipped, failed: errors.length, errors, providers: listProviders() })
  } catch (error) {
    fail(res, String((error as Error).message || error), 400)
  }
})

app.post('/api/providers/reorder', (req, res) => {
  try {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
    const cap = ['llm', 'image', 'video', 'audio'].includes(String(req.body?.cap || '')) ? String(req.body.cap) as 'llm' | 'image' | 'video' | 'audio' : undefined
    ok(res, { providers: reorderProviders(ids, cap) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/providers/models/reorder', (req, res) => {
  try {
    const cap = ['llm', 'image', 'video', 'audio'].includes(String(req.body?.cap)) ? req.body.cap as 'llm' | 'image' | 'video' | 'audio' : 'llm'
    const entries = Array.isArray(req.body?.entries) ? req.body.entries.map((x: any) => ({ providerId: String(x.providerId), model: String(x.model) })) : []
    ok(res, { providers: reorderModels(cap, entries) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/providers/auto-fallback', (_req, res) => ok(res, { autoFallback: getAutoFallback() }))
app.post('/api/providers/auto-fallback', (req, res) => ok(res, { autoFallback: setAutoFallback(req.body?.autoFallback !== false) }))

app.get('/api/providers/:id', (req, res) => {
  const p = getProvider(req.params.id)
  return p ? ok(res, { provider: p }) : fail(res, '站点不存在', 404)
})

app.post('/api/providers', (req, res) => {
  try {
    const p = saveProvider(req.body || {})
    ok(res, { provider: p })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/providers/:id/enabled', (req, res) => {
  const p = setProviderEnabled(req.params.id, req.body?.enabled !== false)
  return p ? ok(res, { provider: p }) : fail(res, '站点不存在', 404)
})

app.delete('/api/providers/:id', (req, res) => {
  const done = deleteProvider(req.params.id)
  return done ? ok(res, { id: req.params.id }) : fail(res, '站点不存在', 404)
})

// ── 内置 CLI：先接入即梦 dreamina，用于图片/视频模型快速测试 ───────────
app.get('/api/cli/jimeng/status', async (_req, res) => {
  try { ok(res, await jimengStatus()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/cli/jimeng/credit', async (_req, res) => {
  try { ok(res, await jimengCredit()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/cli/jimeng/logout', async (_req, res) => {
  try { ok(res, await jimengLogout()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/cli/jimeng/login/start', async (_req, res) => {
  try { ok(res, await jimengLoginStart()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/cli/jimeng/login/status', async (_req, res) => {
  try { ok(res, await jimengLoginStatus()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/cli/jimeng/help', async (req, res) => {
  try { ok(res, await jimengHelp(String(req.body?.command || ''))) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/cli/jimeng/models', async (_req, res) => {
  try {
    const models = await jimengModels()
    ok(res, { models: models.models, count: models.models.length, source: models.source, cached: models.cached, refreshing: models.refreshing || false, ts: models.ts })
  }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/cli/jimeng/tasks', async (_req, res) => {
  try { ok(res, await listJimengTasks()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
for (const tool of ['codex', 'gemini'] as const) {
  app.get(`/api/cli/${tool}/status`, async (_req, res) => { try { ok(res, await agentCliStatus(tool)) } catch (e) { fail(res, String((e as Error).message || e)) } })
  app.get(`/api/cli/${tool}/download-info`, async (_req, res) => { try { ok(res, await agentCliDownloadInfo(tool)) } catch (e) { fail(res, String((e as Error).message || e), 502) } })
  app.post(`/api/cli/${tool}/login/start`, async (_req, res) => { try { ok(res, await agentCliLoginStart(tool)) } catch (e) { fail(res, String((e as Error).message || e)) } })
  app.get(`/api/cli/${tool}/login/status`, async (_req, res) => { try { ok(res, await agentCliLoginStatus(tool)) } catch (e) { fail(res, String((e as Error).message || e)) } })
  app.post(`/api/cli/${tool}/logout`, async (_req, res) => { try { ok(res, await agentCliLogout(tool)) } catch (e) { fail(res, String((e as Error).message || e)) } })
  app.post(`/api/cli/${tool}/help`, async (req, res) => { try { ok(res, await agentCliHelp(tool, String(req.body?.command || ''))) } catch (e) { fail(res, String((e as Error).message || e)) } })
  app.get(`/api/cli/${tool}/models`, (_req, res) => ok(res, agentCliModels(tool)))
  app.post(`/api/cli/${tool}/chat`, async (req, res) => { try { ok(res, await runAgentCliChat(tool, String(req.body?.prompt || ''), String(req.body?.model || ''))) } catch (e) { fail(res, String((e as Error).message || e)) } })
}
app.post('/api/cli/codex/generate-image', async (req, res) => {
  try { ok(res, await generateCodexImage(String(req.body?.prompt || ''), String(req.body?.model || 'gpt-image-2'), String(req.body?.size || '1024x1024'))) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
const jimengUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })
app.post('/api/cli/jimeng/query-media', async (req, res) => {
  try {
    const kind = ['image', 'video', 'audio'].includes(String(req.body?.kind || '')) ? req.body.kind as 'image' | 'video' | 'audio' : 'image'
    ok(res, await queryJimengMedia(String(req.body?.submit_id || req.body?.submitId || ''), kind))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/cli/jimeng/generate-image', jimengUpload.array('images', 10), async (req, res) => {
  const files = (req.files || []) as Express.Multer.File[]
  const paths = files.map((file) => tempMediaFile(file.buffer, file.mimetype || 'image/png', '.png'))
  try {
    const result = await generateJimengImage(
      String(req.body?.prompt || ''),
      String(req.body?.model || 'jimeng-5.0Pro'),
      String(req.body?.size || '1024x1024'),
      paths,
      { pollSeconds: req.body?.poll_seconds === undefined ? 12 : Number(req.body.poll_seconds), deferPending: true },
    )
    ok(res, { status: 'succeeded', ...result })
  } catch (e) {
    if (e instanceof JimengPendingError) return res.status(202).json({ ok: true, ...jimengPendingPayload(e) })
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/cli/jimeng/upscale-image', jimengUpload.single('image'), async (req, res) => {
  if (!req.file) return fail(res, '请上传要放大的图片')
  const path = tempMediaFile(req.file.buffer, req.file.mimetype || 'image/png', '.png')
  try {
    const result = await upscaleJimengImage(path, String(req.body?.resolution_type || req.body?.resolution || '2k'), { pollSeconds: req.body?.poll_seconds === undefined ? 12 : Number(req.body.poll_seconds), deferPending: true })
    ok(res, { status: 'succeeded', ...result })
  } catch (e) {
    if (e instanceof JimengPendingError) return res.status(202).json({ ok: true, ...jimengPendingPayload(e) })
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/cli/jimeng/generate-video', jimengUpload.fields([
  { name: 'images', maxCount: 20 },
  { name: 'videos', maxCount: 3 },
  { name: 'audios', maxCount: 3 },
]), async (req, res) => {
  const files = (req.files || {}) as Record<string, Express.Multer.File[]>
  const makePaths = (items: Express.Multer.File[] | undefined, kind: 'image' | 'video' | 'audio') => (items || []).map((file) => tempMediaFile(file.buffer, file.mimetype || `${kind}/plain`, kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : '.mp3'))
  const parseRoles = () => {
    const raw = req.body?.image_roles ?? req.body?.imageRoles ?? []
    if (Array.isArray(raw)) return raw.map(String)
    try { const parsed = JSON.parse(String(raw || '[]')); if (Array.isArray(parsed)) return parsed.map(String) } catch { /* comma fallback */ }
    return String(raw || '').split(',').map((item) => item.trim()).filter(Boolean)
  }
  const imagePaths = makePaths(files.images, 'image')
  const videoPaths = makePaths(files.videos, 'video')
  const audioPaths = makePaths(files.audios, 'audio')
  try {
    const result = await generateJimengVideo(String(req.body?.prompt || ''), String(req.body?.model || 'seedance2.0fast'), {
      imagePaths,
      imageRoles: parseRoles(),
      videoPaths,
      audioPaths,
      duration: req.body?.duration === undefined || req.body?.duration === '' ? undefined : Number(req.body.duration),
      aspect_ratio: String(req.body?.aspect_ratio || req.body?.aspectRatio || '16:9'),
      resolution: String(req.body?.resolution || '720p'),
      multimodal: req.body?.multimodal === true || String(req.body?.multimodal || '').toLowerCase() === 'true',
      pollSeconds: req.body?.poll_seconds === undefined ? 12 : Number(req.body.poll_seconds),
      deferPending: true,
    })
    ok(res, { status: 'succeeded', ...result })
  } catch (e) {
    if (e instanceof JimengPendingError) return res.status(202).json({ ok: true, ...jimengPendingPayload(e) })
    fail(res, String((e as Error).message || e))
  }
})
// 兼容旧版排队续查路径。
app.post('/api/jimeng/query-media', async (req, res) => {
  try {
    const kind = ['image', 'video', 'audio'].includes(String(req.body?.kind || '')) ? req.body.kind as 'image' | 'video' | 'audio' : 'image'
    ok(res, await queryJimengMedia(String(req.body?.submit_id || req.body?.submitId || ''), kind))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/jimeng/status', async (_req, res) => { try { ok(res, await jimengStatus()) } catch (e) { fail(res, String((e as Error).message || e)) } })
app.get('/api/jimeng/credit', async (_req, res) => { try { ok(res, await jimengCredit()) } catch (e) { fail(res, String((e as Error).message || e)) } })
app.post('/api/jimeng/logout', async (_req, res) => { try { ok(res, await jimengLogout()) } catch (e) { fail(res, String((e as Error).message || e)) } })
app.post('/api/jimeng/login/start', async (_req, res) => { try { ok(res, await jimengLoginStart()) } catch (e) { fail(res, String((e as Error).message || e)) } })
app.get('/api/jimeng/login/status', async (_req, res) => { try { ok(res, await jimengLoginStatus()) } catch (e) { fail(res, String((e as Error).message || e)) } })
app.post('/api/jimeng/help', async (req, res) => { try { ok(res, await jimengHelp(String(req.body?.command || ''))) } catch (e) { fail(res, String((e as Error).message || e)) } })

// ── 验证协议（按当前 Base URL / Key 自动尝试已支持协议）───────────────
app.post('/api/providers/verify-protocol', async (req, res) => {
  const resolved = resolveFromBody(req.body || {})
  const base_url = String(resolved?.base_url || '').trim().replace(/\/+$/, '')
  const api_key = String(resolved?.api_key || '').trim()
  const current = String(req.body?.protocol || 'openai').trim()
  if (!base_url) return fail(res, '缺少 base_url')
  if (!api_key) return fail(res, '缺少 API Key')
  if (current === 'runninghub') {
    if (!resolved?.wallet_api_key) return fail(res, 'RunningHub 验证需要账户余额 API Key')
    const started = Date.now()
    try {
      const items = await fetchRunningHubModels(resolved, 12000)
      return ok(res, {
        protocol: 'runninghub', changed: false,
        attempts: [{ protocol: 'runninghub', ok: true, message: `找到 ${items.length} 个模型`, count: items.length, latencyMs: Date.now() - started }],
        models: items.map((item) => item.model),
        model_items: items.map((item) => ({ model: item.model, name: item.name, type: item.type, protocol: 'runninghub' })),
      })
    } catch (e) {
      return fail(res, String((e as Error).message || e), 400)
    }
  }
  const order = providerProtocolCandidates(base_url, current)
  const attempts: { protocol: string; ok: boolean; message: string; count?: number; latencyMs?: number }[] = []
  for (const protocol of order) {
    const started = Date.now()
    try {
      const models = await fetchModels({ base_url, api_key, protocol }, 12000)
      attempts.push({ protocol, ok: true, message: models.length ? `找到 ${models.length} 个模型` : '协议可用，但模型列表为空', count: models.length, latencyMs: Date.now() - started })
      const inferredByModel = new Map(
        inferProviderProtocols({ baseUrl: base_url, protocol, models }).models.map((item) => [item.model, item]),
      )
      const model_items = models.map((model) => {
        const inferred = inferredByModel.get(model)
        return {
          model,
          type: inferred?.type,
          // 在线协议包中的站点绑定优先；未命中时再使用内置模型推断。
          protocol: suggestModelProtocol(protocol, model) || inferred?.protocol || '',
        }
      })
      return ok(res, { protocol, changed: protocol !== current, attempts, models, model_items })
    } catch (e) {
      attempts.push({ protocol, ok: false, message: String((e as Error).message || e).slice(0, 220), latencyMs: Date.now() - started })
    }
  }
  return fail(res, '没有匹配到可用协议，请检查请求地址和 API Key。', 400)
})

// ── 识别协议（按 Base URL + 模型名推断默认协议和模型专属协议）────────
app.post('/api/providers/infer-protocols', (req, res) => {
  try {
    const body = req.body || {}
    const stored = storedFromBody(body)
    const bodyModels = Array.isArray(body.models) ? body.models.map(String).filter(Boolean) : []
    const storedModels = stored?.models?.map((model) => model.model).filter(Boolean) || []
    const inference = inferProviderProtocols({
      baseUrl: String(body.base_url || body.baseUrl || stored?.base_url || '').trim(),
      protocol: String(body.protocol || stored?.protocol || 'openai').trim(),
      models: bodyModels.length ? bodyModels : storedModels,
    })
    ok(res, { inference })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})

// ── 测试连通（真发一次极简对话）──────────────────────────────────────
app.post('/api/providers/test', async (req, res) => {
  const cliTool = agentCliToolFromRequest(req.body || {})
  if (cliTool) {
    const model = String(req.body?.model || (cliTool === 'codex' ? 'gpt-5.5' : 'auto')).trim()
    try { return ok(res, await runAgentCliChat(cliTool, String(req.body?.prompt || '用一个词回复：ok'), model)) }
    catch (e) { return fail(res, String((e as Error).message || e)) }
  }
  const provider = resolveFromBody(req.body || {})
  if (!provider) return fail(res, '缺少 base_url')
  if (!provider.api_key && !(provider.protocol === 'runninghub' && provider.wallet_api_key)) return fail(res, '缺少 API Key')
  const model = String(req.body?.model || '').trim()
  if (!model) return fail(res, '请先选择或填写一个模型')
  try {
    const r = await callChat(provider, model, { prompt: req.body?.prompt || '用一个词回复：ok' })
    ok(res, { text: r.text, latencyMs: r.latencyMs, usage: r.usage })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 测试图片生成（给 API 设置页验证图像模型）──────────────────────────
app.post('/api/providers/test-image', async (req, res) => {
  if (isJimengCliRequest(req.body || {})) {
    const model = String(req.body?.model || 'jimeng-5.0Pro').trim()
    const prompt = String(req.body?.prompt || '').trim() || '一张极简风格的蓝色玻璃按钮，白色背景，产品摄影质感'
    const started = Date.now()
    try {
      const r = await generateJimengImage(prompt, model, String(req.body?.size || '1024x1024'))
      return ok(res, { latencyMs: Date.now() - started, image: r.image, imageType: r.image.startsWith('data:') ? 'data' : 'url', raw: r.raw, submit_id: r.submit_id })
    } catch (e) {
      return fail(res, String((e as Error).message || e))
    }
  }
  if (agentCliToolFromRequest(req.body || {}) === 'codex') {
    const started = Date.now()
    try {
      const result = await generateCodexImage(String(req.body?.prompt || '').trim() || '一张极简风格的蓝色玻璃按钮，白色背景，产品摄影质感', String(req.body?.model || 'gpt-image-2'), String(req.body?.size || '1024x1024'))
      return ok(res, { latencyMs: Date.now() - started, image: result.images[0], imageType: 'data', raw: result.raw })
    } catch (e) { return fail(res, String((e as Error).message || e)) }
  }
  const baseProvider = resolveFromBody(req.body || {})
  if (!baseProvider) return fail(res, '缺少 base_url')
  if (!baseProvider.api_key && !(baseProvider.protocol === 'runninghub' && baseProvider.wallet_api_key)) return fail(res, '缺少 API Key')
  const provider = resolveModelProtocol(req.body || {}, baseProvider)
  const model = String(req.body?.model || '').trim()
  if (!model) return fail(res, '请先选择或填写一个图像模型')
  const prompt = String(req.body?.prompt || '').trim() || '一张极简风格的蓝色玻璃按钮，白色背景，产品摄影质感'
  const started = Date.now()
  try {
    const r = await generateImages(provider, model, { prompt, size: String(req.body?.size || '1024x1024'), n: 1 }, 300000)
    const first = r.images[0]
    if (!first) return fail(res, '图像接口调用成功，但没有返回图片')
    ok(res, {
      latencyMs: Date.now() - started,
      image: first.type === 'b64' ? `data:image/png;base64,${first.value}` : first.value,
      imageType: first.type,
    })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 拉模型列表 ────────────────────────────────────────────────────────
app.post('/api/providers/models', async (req, res) => {
  if (isJimengCliRequest(req.body || {})) {
    try {
      const models = await jimengModels()
      return ok(res, { models: models.models, count: models.models.length, source: models.source, cached: models.cached, refreshing: models.refreshing || false, ts: models.ts })
    }
    catch (e) { return fail(res, String((e as Error).message || e)) }
  }
  const cliTool = agentCliToolFromRequest(req.body || {})
  if (cliTool) return ok(res, agentCliModels(cliTool))
  const provider = resolveFromBody(req.body || {})
  if (!provider) return fail(res, '缺少 base_url')
  try {
    if (provider.protocol === 'runninghub') {
      if (!provider.wallet_api_key) return fail(res, 'RunningHub 拉取标准模型需要账户余额 API Key')
      const items = await fetchRunningHubModels(provider)
      return ok(res, {
        models: items.map((item) => item.model),
        model_items: items.map((item) => ({ model: item.model, name: item.name, protocol: 'runninghub', type: item.type })),
        count: items.length,
        source: 'runninghub',
      })
    }
    if (!provider.api_key) return fail(res, '缺少 API Key')
    const models = await fetchModels(provider)
    const inferredByModel = new Map(
      (provider.protocol === 'zkki' || provider.protocol === 'zkki-model'
        ? inferProviderProtocols({ baseUrl: provider.base_url, protocol: provider.protocol, models }).models
        : []).map((item) => [item.model, item]),
    )
    ok(res, {
      models,
      model_items: models.map((model) => {
        const inferred = inferredByModel.get(model)
        return {
          model,
          protocol: inferred?.protocol || suggestModelProtocol(provider.protocol, model),
          ...(inferred ? { type: inferred.type } : {}),
        }
      }),
      count: models.length,
    })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── RunningHub：标准模型 + AI 应用 + 工作流 ──────────────────────────
app.get('/api/runninghub/catalog', (req, res) => {
  const provider = revealProvider(String(req.query.providerId || 'runninghub'))
  ok(res, runningHubCatalog(provider))
})

app.post('/api/runninghub/keys', (req, res) => {
  try {
    const id = String(req.body?.providerId || 'runninghub').trim() || 'runninghub'
    let provider = revealProvider(id)
    if (!provider) {
      saveProvider({
        id,
        name: 'RunningHub',
        base_url: 'https://www.runninghub.ai',
        protocol: 'runninghub',
        api_key: req.body?.apiKey,
        wallet_api_key: req.body?.walletApiKey,
        models: [],
        enabled: true,
      })
      provider = revealProvider(id)
    }
    const updated = setProviderKeys(id, {
      apiKey: req.body?.apiKey === undefined ? undefined : String(req.body.apiKey),
      walletApiKey: req.body?.walletApiKey === undefined ? undefined : String(req.body.walletApiKey),
      clearApiKey: req.body?.clearApiKey === true,
      clearWalletApiKey: req.body?.clearWalletApiKey === true,
    })
    if (!updated || !provider) return fail(res, 'RunningHub 站点不存在', 404)
    ok(res, { provider: updated })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.post('/api/modelscope/keys', (req, res) => {
  try {
    const id = String(req.body?.providerId || 'modelscope').trim() || 'modelscope'
    const region = req.body?.region === 'global' ? 'global' : 'cn'
    const baseUrl = region === 'global' ? MODELSCOPE_GLOBAL_BASE_URL : MODELSCOPE_CN_BASE_URL
    const current = revealProvider(id)
    const byModel = new Map((current?.models || []).map((item) => [item.model, item]))
    for (const model of MODELSCOPE_IMAGE_MODELS) if (!byModel.has(model)) byModel.set(model, { model, caps: ['image'], protocol: '' })
    for (const model of MODELSCOPE_CHAT_MODELS) if (!byModel.has(model)) byModel.set(model, { model, caps: ['llm'], protocol: '' })
    const seededLoras = (current?.ms_defaults_version || 0) < MODELSCOPE_DEFAULTS_VERSION
      ? normalizeModelScopeLoras([...MODELSCOPE_DEFAULT_LORAS, ...(current?.ms_loras || [])])
      : normalizeModelScopeLoras(current?.ms_loras)
    saveProvider({
      id,
      name: current?.name || 'ModelScope',
      base_url: baseUrl,
      protocol: 'modelscope',
      api_key: req.body?.apiKey,
      models: [...byModel.values()],
      ms_loras: seededLoras,
      ms_defaults_version: MODELSCOPE_DEFAULTS_VERSION,
      enabled: current?.enabled !== false,
    })
    const updated = setProviderKeys(id, {
      apiKey: req.body?.apiKey === undefined ? undefined : String(req.body.apiKey),
      clearApiKey: req.body?.clearApiKey === true,
    })
    if (!updated) return fail(res, 'ModelScope 站点不存在', 404)
    ok(res, { provider: updated })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.post('/api/agnes/keys', (req, res) => {
  try {
    const id = String(req.body?.providerId || 'agnes').trim() || 'agnes'
    const current = revealProvider(id)
    const byModel = new Map((current?.models || []).map((item) => [item.model, item]))
    for (const model of AGNES_IMAGE_MODELS) if (!byModel.has(model)) byModel.set(model, { model, caps: ['image'], protocol: '' })
    for (const model of AGNES_VIDEO_MODELS) if (!byModel.has(model)) byModel.set(model, { model, caps: ['video'], protocol: '' })
    saveProvider({
      id,
      name: current?.name || 'Agnes AI',
      base_url: AGNES_BASE_URL,
      protocol: 'agnes',
      api_key: req.body?.apiKey,
      models: [...byModel.values()],
      enabled: current?.enabled !== false,
    })
    const updated = setProviderKeys(id, {
      apiKey: req.body?.apiKey === undefined ? undefined : String(req.body.apiKey),
      clearApiKey: req.body?.clearApiKey === true,
    })
    if (!updated) return fail(res, 'Agnes AI 站点不存在', 404)
    ok(res, { provider: updated })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

const runningHubAssetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

app.post('/api/runninghub/upload', runningHubAssetUpload.single('file'), async (req, res) => {
  const providerId = String(req.body?.providerId || 'runninghub').trim() || 'runninghub'
  const provider = resolveFromBody({ ...(req.body || {}), id: providerId })
  if (!provider) return fail(res, 'RunningHub 站点不存在', 404)
  if (!req.file) return fail(res, '请选择要上传的素材', 400)
  try {
    const fileName = await uploadRunningHubAsset(provider, { buf: req.file.buffer, mime: req.file.mimetype, name: req.file.originalname }, req.body?.useWallet === 'true')
    ok(res, { data: { fileName } })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.post('/api/runninghub/inspect', async (req, res) => {
  const provider = resolveFromBody({ ...(req.body || {}), id: req.body?.providerId || 'runninghub' })
  if (!provider) return fail(res, 'RunningHub 站点不存在', 404)
  const kind = req.body?.kind === 'app' ? 'app' : 'workflow'
  const id = String(req.body?.id || '').trim()
  if (!id) return fail(res, kind === 'app' ? 'appId 必填' : 'workflowId 必填', 400)
  try {
    const data = kind === 'app' ? await inspectRunningHubApp(provider, id) : await inspectRunningHubWorkflow(provider, id)
    ok(res, { data })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.post('/api/runninghub/submit', async (req, res) => {
  const provider = resolveFromBody({ ...(req.body || {}), id: req.body?.providerId || 'runninghub' })
  if (!provider) return fail(res, 'RunningHub 站点不存在', 404)
  const kind = req.body?.kind === 'app' ? 'app' : 'workflow'
  const id = String(req.body?.id || '').trim()
  if (!id) return fail(res, '缺少 RunningHub 应用/工作流 ID', 400)
  try {
    ok(res, { data: await submitRunningHubEntry(provider, kind, id, Array.isArray(req.body?.fields) ? req.body.fields : [], req.body?.useWallet === true, req.body?.workflow, String(req.body?.instanceType || '')) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.get('/api/runninghub/query', async (req, res) => {
  const provider = resolveFromBody({ id: req.query.providerId || 'runninghub' })
  const taskId = String(req.query.taskId || '').trim()
  if (!provider) return fail(res, 'RunningHub 站点不存在', 404)
  if (!taskId) return fail(res, 'taskId 必填', 400)
  try { ok(res, { data: await queryRunningHubTask(provider, taskId, req.query.useWallet === 'true') }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})

// ── Midjourney 专有协议（APIMart 任务流）──────────────────────────────
app.post('/api/midjourney/submit', async (req, res) => {
  const baseProvider = resolveFromBody(req.body || {})
  if (!baseProvider) return fail(res, '缺少 base_url')
  if (!baseProvider.api_key) return fail(res, '缺少 API Key')
  const provider = { ...resolveModelProtocol(req.body || {}, baseProvider), protocol: 'midjourney' }
  const model = String(req.body?.model || 'midjourney-6.1').trim()
  try {
    const result = await submitMidjourney(provider, model, {
      prompt: String(req.body?.prompt || '').trim(),
      size: String(req.body?.size || '1:1'),
      version: String(req.body?.version || model),
      speed: String(req.body?.speed || 'relax') as any,
      mode: String(req.body?.mode || 'imagine') as any,
      reference_images: Array.isArray(req.body?.reference_images) ? req.body.reference_images : [],
    }, 300000)
    ok(res, result)
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/midjourney/action', async (req, res) => {
  const baseProvider = resolveFromBody(req.body || {})
  if (!baseProvider) return fail(res, '缺少 base_url')
  if (!baseProvider.api_key) return fail(res, '缺少 API Key')
  const provider = { ...resolveModelProtocol(req.body || {}, baseProvider), protocol: 'midjourney' }
  try {
    ok(res, await submitMidjourneyAction(provider, {
      task_id: String(req.body?.task_id || req.body?.taskId || ''),
      action: String(req.body?.action || 'variation') as any,
      index: Number(req.body?.index || 0),
      speed: String(req.body?.speed || 'relax') as any,
      direction: String(req.body?.direction || '') as any,
      zoom_ratio: req.body?.zoom_ratio === undefined ? undefined : Number(req.body.zoom_ratio),
      custom_id: String(req.body?.custom_id || req.body?.customId || ''),
      prompt: String(req.body?.prompt || ''),
    }, 300000))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/midjourney/task', async (req, res) => {
  const baseProvider = resolveFromBody(req.body || {})
  if (!baseProvider) return fail(res, '缺少 base_url')
  if (!baseProvider.api_key) return fail(res, '缺少 API Key')
  const provider = { ...resolveModelProtocol(req.body || {}, baseProvider), protocol: 'midjourney' }
  const taskId = String(req.body?.task_id || req.body?.taskId || '').trim()
  try {
    ok(res, await getMidjourneyTask(provider, taskId, 300000))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/midjourney/modal', async (req, res) => {
  const baseProvider = resolveFromBody(req.body || {})
  if (!baseProvider) return fail(res, '缺少 base_url')
  if (!baseProvider.api_key) return fail(res, '缺少 API Key')
  const provider = { ...resolveModelProtocol(req.body || {}, baseProvider), protocol: 'midjourney' }
  try {
    ok(res, await submitMidjourneyModal(provider, {
      task_id: String(req.body?.task_id || req.body?.taskId || ''),
      prompt: String(req.body?.prompt || ''),
      speed: String(req.body?.speed || 'relax') as any,
      mask_image: { url: String(req.body?.mask_url || req.body?.maskUrl || '') },
    }, 300000))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 通用对话（给 agent 用）────────────────────────────────────────────
// body: { providerId?, model?, messages?|prompt, system?, params? }
// 不传 providerId 时自动选「第一个启用且有 key」的站点。
app.post('/api/chat', async (req, res) => {
  const body = req.body || {}
  const stored = body.providerId ? revealProvider(String(body.providerId)) : firstUsableProvider()
  if (!stored) {
    return fail(res, '还没有可用的模型站点。请先在「API 设置」里添加并启用一个站点，填好 Base URL、Key 和至少一个模型。', 400)
  }
  if (!stored.enabled) return fail(res, '该站点已禁用')
  const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }
  // 优先选带 llm 能力的模型
  const llmModel = stored.models?.find((m) => (m.caps || []).includes('llm'))?.model
  const model = String(body.model || llmModel || stored.models?.[0]?.model || '').trim()
  if (!model) return fail(res, '该站点还没有配置任何模型')
  try {
    if (!body.providerId && !body.model && getAutoFallback()) {
      const candidates = modelCandidates('llm')
      let last: unknown
      for (const candidate of candidates) try {
        const r = await callChat({ base_url: candidate.provider.base_url, api_key: candidate.provider.api_key, protocol: candidate.provider.protocol }, candidate.model.model, { messages: body.messages, prompt: body.prompt, system: body.system }, body.params || {})
        return ok(res, { text: r.text, latencyMs: r.latencyMs, usage: r.usage, model: candidate.model.model, provider: candidate.provider.name })
      } catch (e) { last = e }
      throw last || new Error('没有可用模型')
    }
    const r = await callChat(provider, model, { messages: body.messages, prompt: body.prompt, system: body.system }, body.params || {})
    ok(res, { text: r.text, latencyMs: r.latencyMs, usage: r.usage, model, provider: stored.name })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 无限画布：文档 CRUD + 版本化补丁 + 共享（可见性/成员）──────────────
app.get('/api/canvas', (req, res) => {
  try { ok(res, { canvases: listCanvases(req.auth!.user) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/canvas/trash', (req, res) => {
  try { ok(res, { canvases: listTrashedCanvases(req.auth!.user) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/canvas/project-pages', (req, res) => {
  try {
    const user = req.auth!.user
    const root = ensureCanvasRoot(user.id)
    const canvasRootId = ensureFolder('无限画布', root.id, user.id)
    const own = listChildren(canvasRootId).nodes
      .filter((node) => node.type === 'folder' && !isInTrash(node.id))
      .map((node) => ({ id: node.id, name: node.name, mine: true, updatedAt: (node.updated_ts || 0) * 1000 }))
    const pages = new Map(own.map((page) => [page.id, page]))
    for (const canvas of listCanvases(user)) {
      if (!canvas.projectId || pages.has(canvas.projectId)) continue
      const folder = getNode(canvas.projectId)
      pages.set(canvas.projectId, { id: canvas.projectId, name: folder?.name || canvas.title || '共享项目', mine: canvas.mine, updatedAt: canvas.updatedAt })
    }
    ok(res, { pages: [...pages.values()] })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/canvas/project-pages', (req, res) => {
  try {
    const folder = createCanvasProjectFolder(req.auth!.user.id, String(req.body?.name || '').trim() || '未命名项目')
    emitFsEvent('changed')
    ok(res, { page: { id: folder.id, name: folder.name, mine: true, updatedAt: (folder.updated_ts || 0) * 1000 } })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
// 成员目录：给「部分人可见」的成员选择器用（含部门名，便于区分同名）
app.get('/api/canvas/directory', (req, res) => {
  try {
    const me = req.auth!.user.id
    const depts = listAuthDepartments()
    const deptName = new Map(depts.map((d) => [d.id, d.name]))
    const users = listAuthUsers()
      .filter((u) => u.status !== 'disabled' && u.id !== me)
      .map((u) => ({ id: u.id, username: u.username, department: (u.departmentId && deptName.get(u.departmentId)) || '' }))
    ok(res, { users, departments: depts.map((d) => ({ id: d.id, name: d.name })) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
// 画布只需要消费已配置的模型目录，不应要求用户拥有“API 设置”管理权限。
// 此接口仅返回生成所需的公开元数据，并隐藏真实 base_url 与所有凭据字段。
app.get('/api/canvas/engines', (_req, res) => {
  const providers = listProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    source: provider.source,
    cli_tool: provider.cli_tool,
    models: provider.models.map((model) => {
      try { return { ...model, intents: resolveProtocolModelProfile(model.protocol || provider.protocol, model.model).capabilities } }
      catch { return { ...model, intents: [] } }
    }),
    rh_apps: provider.rh_apps || [],
    rh_workflows: provider.rh_workflows || [],
    enabled: provider.enabled,
    sort: provider.sort,
    cap_sort: provider.cap_sort,
    has_key: provider.has_key,
    has_wallet_key: provider.has_wallet_key,
    base_url: provider.base_url ? 'configured' : '',
  }))
  ok(res, { providers })
})
app.patch('/api/canvas/project-pages/:id', (req, res) => {
  try {
    const userId = req.auth!.user.id
    const root = ensureCanvasRoot(userId)
    const canvasRootId = ensureFolder('无限画布', root.id, userId)
    const folder = getNode(String(req.params.id || ''))
    if (!folder || folder.type !== 'folder' || folder.ownerId !== userId || folder.parentId !== canvasRootId || isInTrash(folder.id)) return fail(res, '项目分类不存在或没有权限', 404)
    const name = String(req.body?.name || '').trim()
    if (!name) return fail(res, '项目分类名称不能为空', 400)
    const saved = renameNode(folder.id, name)
    emitFsEvent('changed')
    ok(res, { page: { id: saved.id, name: saved.name, mine: true, updatedAt: (saved.updated_ts || 0) * 1000 } })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.delete('/api/canvas/project-pages/:id', (req, res) => {
  try {
    const user = req.auth!.user
    const root = ensureCanvasRoot(user.id)
    const canvasRootId = ensureFolder('无限画布', root.id, user.id)
    const folder = getNode(String(req.params.id || ''))
    if (!folder || folder.type !== 'folder' || folder.ownerId !== user.id || folder.parentId !== canvasRootId || isInTrash(folder.id)) return fail(res, '项目分类不存在或没有权限', 404)
    const count = listCanvases(user).filter((canvas) => canvas.projectId === folder.id && canvas.mine).length
    if (count) return fail(res, `该分类中还有 ${count} 个画布，请先移动或删除这些画布`, 409)
    removeNode(folder.id)
    emitFsEvent('changed')
    ok(res, { removed: true })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.get('/api/canvas/plugins/registry', (_req, res) => {
  try { ok(res, { registry: getCanvasPluginRegistry() }) }
  catch (e) { fail(res, String((e as Error).message || e), 500) }
})
app.post('/api/canvas/plugins/registry/rebuild', (req, res) => {
  if (!['admin', 'superadmin'].includes(req.auth!.user.role)) return fail(res, '需要管理员权限', 403)
  try { ok(res, { registry: rebuildCanvasPluginRegistry() }) }
  catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.patch('/api/canvas/plugins/:pluginId/enabled', (req, res) => {
  if (!['admin', 'superadmin'].includes(req.auth!.user.role)) return fail(res, '需要管理员权限', 403)
  try { ok(res, { registry: setCanvasPluginEnabled(String(req.params.pluginId || ''), req.body?.enabled === true) }) }
  catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.delete('/api/canvas/plugins/:pluginId', (req, res) => {
  if (!['admin', 'superadmin'].includes(req.auth!.user.role)) return fail(res, '需要管理员权限', 403)
  try {
    const result = deleteCanvasPlugin(String(req.params.pluginId || ''))
    removeInstalledAppEverywhere(result.appId)
    ok(res, { deleted: true, registry: result.registry })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/canvas/plugins/:pluginId/data', (req, res) => {
  try { ok(res, accessCanvasPluginData(String(req.params.pluginId || ''), req.auth!.user.id, req.body || {})) }
  catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/canvas/plugins/:pluginId/network/request', async (req, res) => {
  try {
    const pluginId = String(req.params.pluginId || '')
    const appId = `dev-${pluginId}`
    const pack = developerProjectPackage(appId)
    if (!pack.manifest.canvas) return fail(res, '该开发者应用没有声明画布插件能力', 400)
    if (!pack.manifest.network) return fail(res, '插件没有声明 network 白名单', 403)
    ok(res, await developerNetworkRequest(req.auth!.user.id, appId, pack.manifest.network, req.body || {}, pack.manifest.oauth || []))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/canvas/plugins/execute', async (req, res) => {
  try {
    const nodeType = String(req.body?.nodeType || '')
    const node = getCanvasPluginRegistry().nodes.find((item) => item.type === nodeType && item.owner.kind === 'plugin')
    if (!node || node.owner.kind !== 'plugin') return fail(res, '插件节点未注册、已停用或不兼容', 404)
    const inputs = req.body?.inputs && typeof req.body.inputs === 'object' && !Array.isArray(req.body.inputs) ? req.body.inputs as Record<string, unknown> : {}
    const parameters = req.body?.parameters && typeof req.body.parameters === 'object' && !Array.isArray(req.body.parameters) ? req.body.parameters as Record<string, unknown> : {}
    const args = { ...parameters, inputs, instruction: String(parameters.instruction || parameters.prompt || req.body?.prompt || '').trim() }
    let result: unknown
    if (node.executor.type === 'skill') result = await runSkill(node.executor.skillId, args)
    else if (node.executor.type === 'mcp-tool') result = { text: await mcpCallDirect(node.executor.serverId, node.executor.toolName, args) }
    else if (node.executor.type === 'agent-tool') result = await runCatalogTool(node.executor.toolName, args, req.auth!.user)
    else if (node.executor.type === 'workflow') {
      const entryPointId = String(parameters.entryPointId || parameters.entry || '')
      const workflowArgs = Array.isArray(parameters.args) ? parameters.args.map(String) : []
      result = await runSkillPack(node.executor.workflowId, entryPointId, workflowArgs)
    } else if (node.executor.type === 'app-bridge') {
      return fail(res, 'app-bridge 执行器需要插件前端运行容器，当前节点没有可用容器', 409)
    } else return fail(res, '插件不能调用宿主 builtin 执行器', 403)
    ok(res, { nodeType, pluginId: node.owner.pluginId, result })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
function syncCanvasProjectFolderShare(canvas: { id: string; projectId?: string }) {
  // 项目文件夹始终使用画布 ACL：private 时只有 owner，共享时自动继承成员。
  // 不能在取消共享时删除标记，否则 owner 会失去对协作者历史文件的访问。
  if (canvas.projectId) setCanvasFolderShare(canvas.projectId, canvas.id, true)
}

app.post('/api/canvas', (req, res) => {
  try {
    const requestedProjectId = String(req.body?.projectId || '').trim()
    const projectFolder = requestedProjectId
      ? getNode(requestedProjectId)
      : createCanvasProjectFolder(req.auth!.user.id, String(req.body?.title || '').trim() || '未命名项目')
    if (!projectFolder || projectFolder.type !== 'folder') return fail(res, '项目文件夹不存在', 404)
    if (isInTrash(projectFolder.id)) return fail(res, '项目文件夹已在废纸篓中，请先恢复', 410)
    if (projectFolder.ownerId && projectFolder.ownerId !== req.auth!.user.id) return fail(res, '只能在自己的项目文件夹里创建项目', 403)
    const canvas = createCanvas({
      viewer: req.auth!.user,
      title: req.body?.title,
      projectId: projectFolder.id,
      visibility: req.body?.visibility,
      members: req.body?.members,
    })
    syncCanvasProjectFolderShare(canvas)
    emitFsEvent('changed')
    ok(res, { canvas })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/canvas/invites/redeem', (req, res) => {
  try { ok(res, redeemCanvasInvite(String(req.body?.code || ''), req.auth!.user)) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.get('/api/canvas/:id/version', (req, res) => {
  try {
    const canvas = getCanvas(req.params.id, req.auth!.user)
    ok(res, { version: canvas.version, updatedAt: canvas.updatedAt })
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.get('/api/canvas/:id', (req, res) => {
  try {
    const canvas = getCanvas(req.params.id, req.auth!.user)
    // 读取画布不能同步扫描并解析整个 fs.json。项目文件夹共享标记已在
    // 创建画布和修改共享设置时维护；这里重复检查会造成固定的进入延迟。
    ok(res, { canvas })
  }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.patch('/api/canvas/:id', (req, res) => {
  try {
    const canvas = updateCanvas(req.params.id, req.auth!.user, {
      baseVersion: req.body?.baseVersion,
      title: req.body?.title,
      document: req.body?.document,
      visibility: req.body?.visibility,
      members: req.body?.members,
    })
    syncCanvasProjectFolderShare(canvas)
    ok(res, {
      canvas,
    })
  } catch (e) {
    if (e instanceof CanvasConflictError) return fail(res, e.message, 409)
    fail(res, String((e as Error).message || e), 404)
  }
})
app.post('/api/canvas/:id/sync', (req, res) => {
  try {
    const canvas = syncCanvas(req.params.id, req.auth!.user, {
      upserts: Array.isArray(req.body?.upserts) ? req.body.upserts : [],
      deletedIds: Array.isArray(req.body?.deletedIds) ? req.body.deletedIds : [],
      connections: Array.isArray(req.body?.connections) ? req.body.connections : undefined,
      viewport: req.body?.viewport,
      assetLibrarySources: Array.isArray(req.body?.assetLibrarySources) ? req.body.assetLibrarySources : undefined,
    })
    if (Array.isArray(req.body?.deletedIds) && req.body.deletedIds.length) emitFsEvent('changed')
    broadcastCanvasPatch(req.params.id, {
      version: canvas.version,
      upserts: Array.isArray(req.body?.upserts) ? req.body.upserts : [],
      deletedIds: Array.isArray(req.body?.deletedIds) ? req.body.deletedIds : [],
      connections: Array.isArray(req.body?.connections) ? req.body.connections : undefined,
      assetLibrarySources: Array.isArray(req.body?.assetLibrarySources) ? canvas.assetLibrarySources : undefined,
    }, String(req.body?.clientId || ''))
    ok(res, { canvas })
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.get('/api/canvas/:id/invite', (req, res) => {
  try { ok(res, { invite: getCanvasInvite(req.params.id, req.auth!.user) }) }
  catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.post('/api/canvas/:id/invite', (req, res) => {
  try { ok(res, createCanvasInvite(req.params.id, req.auth!.user, req.body?.permission === 'edit' ? 'edit' : 'read')) }
  catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.delete('/api/canvas/:id/invite', (req, res) => {
  try { revokeCanvasInvite(req.params.id, req.auth!.user); ok(res, {}) }
  catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.delete('/api/canvas/:id', (req, res) => {
  try { trashCanvas(req.params.id, req.auth!.user); ok(res, {}) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.post('/api/canvas/:id/restore', (req, res) => {
  try { restoreCanvas(req.params.id, req.auth!.user); ok(res, {}) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.delete('/api/canvas/:id/purge', (req, res) => {
  try { purgeCanvas(req.params.id, req.auth!.user); ok(res, {}) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})

// ── 无限画布：真实生成（图像/视频）→ 落盘网盘 → 回传 MediaRef ─────────────
// 只负责「调 API + 存文件 + 返回结果」，不改画布文档本身（避免与前端工作副本抢版本）。
// 前端拿到 results[] 后写进 card.result / history，再走正常的整文档保存。
function ensureCanvasOutputFolder(ownerId: string, canvasId: string, user: Parameters<typeof getCanvas>[1]): string {
  const canvas = getCanvas(canvasId, user)
  if (canvas.projectId && getNode(canvas.projectId)?.type === 'folder') {
    return ensureFolder('生成结果', canvas.projectId, ownerId)
  }
  const root = ensureCanvasRoot(ownerId)
  const appRoot = ensureFolder('无限画布', root.id, ownerId)
  return ensureFolder('生成结果', appRoot, ownerId)
}
async function fetchToBuffer(url: string, timeoutMs = 180000): Promise<Buffer> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`下载生成结果失败 HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  } finally { clearTimeout(timer) }
}
async function fetchGeneratedMedia(url: string, fallbackMime: string, timeoutMs = 180000): Promise<{ data: Buffer; mime: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: ctrl.signal })
    if (!response.ok) throw new Error(`下载生成结果失败 HTTP ${response.status}`)
    const contentType = String(response.headers.get('content-type') || '').split(';')[0]
    return { data: Buffer.from(await response.arrayBuffer()), mime: !contentType || contentType === 'application/octet-stream' ? fallbackMime : contentType }
  } finally { clearTimeout(timer) }
}
type CanvasGeneratedMediaResult = {
  nodeId: string
  name: string
  url: string
  role: 'result'
  kind: 'image' | 'video' | 'audio'
  prompt: string
  w?: number
  h?: number
}
async function generatedImageDimensions(data: Buffer, kind: CanvasGeneratedMediaResult['kind']) {
  if (kind !== 'image') return {}
  try {
    const metadata = await sharp(data, { animated: false, limitInputPixels: 268_402_689 }).metadata()
    return metadata.width && metadata.height ? { w: metadata.width, h: metadata.height } : {}
  } catch { return {} }
}
async function saveCanvasJimengResults(input: {
  ownerId: string
  canvasId: string
  user: Parameters<typeof getCanvas>[1]
  urls: string[]
  kind: 'image' | 'video' | 'audio'
  prompt: string
}) {
  const folder = ensureCanvasOutputFolder(input.ownerId, input.canvasId, input.user)
  const results: CanvasGeneratedMediaResult[] = []
  const seenHashes = new Set<string>()
  for (const [index, url] of input.urls.entries()) {
    const fallbackMime = input.kind === 'video' ? 'video/mp4' : input.kind === 'audio' ? 'audio/mpeg' : 'image/png'
    const media = await fetchGeneratedMedia(url, fallbackMime, 360000)
    const hash = createHash('sha256').update(media.data).digest('hex')
    if (seenHashes.has(hash)) continue
    seenHashes.add(hash)
    const kind: 'image' | 'video' | 'audio' = media.mime.startsWith('video/') ? 'video' : media.mime.startsWith('audio/') ? 'audio' : 'image'
    const extension = kind === 'video' ? 'mp4' : kind === 'audio' ? (media.mime.includes('wav') ? 'wav' : 'mp3') : (media.mime.includes('jpeg') ? 'jpg' : 'png')
    const node = createNode({ name: `gen-${Date.now()}-${index}.${extension}`, type: 'file', parentId: folder, mime: media.mime, size: media.data.length, ownerId: input.ownerId })
    saveBlob(node.id, media.data)
    results.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'result', kind, prompt: input.prompt, ...await generatedImageDimensions(media.data, kind) })
  }
  return results
}

async function saveCanvasProtocolArtifacts(input: {
  protocolTaskId: string
  ownerId: string
  canvasId: string
  user: Parameters<typeof getCanvas>[1]
  prompt: string
  outputs: Array<{ artifactId?: unknown }>
}) {
  const folder = ensureCanvasOutputFolder(input.ownerId, input.canvasId, input.user)
  const createdNodeIds: string[] = []
  try {
    const results: CanvasGeneratedMediaResult[] = []
    const seenHashes = new Set<string>()
    const task = getAiProtocolTask(input.protocolTaskId)
    let requestedCount = 1
    try { requestedCount = Math.max(1, Math.min(10, Number((JSON.parse(task?.request_json || '{}') as { params?: { n?: unknown } }).params?.n) || 1)) } catch { /* keep one output */ }
    for (const [index, output] of input.outputs.entries()) {
      const artifactId = String(output.artifactId || '')
      const stored = readAiProtocolArtifact(input.protocolTaskId, artifactId)
      if (!stored) throw new Error(`声明式任务产物「${artifactId || '(empty)'}」不存在。`)
      const kind: 'image' | 'video' | 'audio' = stored.artifact.kind === 'video' || stored.artifact.kind === 'audio' ? stored.artifact.kind : 'image'
      if (seenHashes.has(stored.artifact.sha256)) continue
      seenHashes.add(stored.artifact.sha256)
      const mime = stored.artifact.mime || (kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/png')
      const extension = kind === 'video' ? (mime.includes('webm') ? 'webm' : 'mp4')
        : kind === 'audio' ? (mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'mp3')
          : mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
      const node = createNode({ name: `gen-${Date.now()}-${index}.${extension}`, type: 'file', parentId: folder, mime, size: stored.data.byteLength, ownerId: input.ownerId })
      createdNodeIds.push(node.id)
      saveBlob(node.id, stored.data)
      results.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'result', kind, prompt: input.prompt, ...await generatedImageDimensions(stored.data, kind) })
      if (results.length >= requestedCount) break
    }
    return results
  } catch (error) {
    for (const nodeId of createdNodeIds) purgeNode(nodeId)
    throw error
  }
}
const canvasProtocolDeliveries = new Map<string, Promise<unknown[]>>()
function deliverCanvasProtocolTask(input: {
  protocolTaskId: string
  ownerId: string
  canvasId: string
  user: Parameters<typeof getCanvas>[1]
  prompt: string
}) {
  const existing = canvasProtocolDeliveries.get(input.protocolTaskId)
  if (existing) return existing
  const delivery = Promise.resolve().then(async () => {
    const task = getAiProtocolTask(input.protocolTaskId)
    if (!task || task.status !== 'completed') throw new Error('声明式协议任务尚未完成。')
    const payload = JSON.parse(task.result_json || '{}') as { outputs?: Array<{ artifactId?: unknown }>; canvasResults?: unknown[] }
    if (Array.isArray(payload.canvasResults)) return payload.canvasResults
    const results = await saveCanvasProtocolArtifacts({ ...input, outputs: Array.isArray(payload.outputs) ? payload.outputs : [] })
    if (!results.length) throw new Error('声明式协议执行完成，但没有可保存的产物。')
    recordAiProtocolCanvasResults(task.id, results)
    return results
  }).finally(() => canvasProtocolDeliveries.delete(input.protocolTaskId))
  canvasProtocolDeliveries.set(input.protocolTaskId, delivery)
  return delivery
}
function canvasPublicMediaProvider(service: 'apimart' | 'runninghub', requestedId = '') {
  const matches = (provider: Pick<Provider, 'protocol' | 'base_url'>) => service === 'runninghub'
    ? provider.protocol === 'runninghub'
    : provider.protocol.startsWith('apimart') || /api\.apimart\.ai|apib\.ai/i.test(provider.base_url || '')
  const explicit = requestedId ? revealProvider(requestedId) : null
  if (explicit?.enabled && matches(explicit)) return explicit
  const match = listProviders().find((provider) => provider.enabled && matches(provider))
  return match ? revealProvider(match.id) : null
}

function agentCliToolFromRequest(body: Record<string, unknown>): AgentCliTool | null {
  const stored = storedFromBody(body)
  const tool = String(body.cli_tool || stored?.cli_tool || '').trim().toLowerCase()
  const protocol = String(body.model_protocol || body.protocol || stored?.protocol || '').trim().toLowerCase()
  if (tool === 'codex' || protocol === 'cli:codex' || protocol === 'codex-cli') return 'codex'
  if (tool === 'gemini' || tool === 'gemini-cli' || protocol === 'cli:gemini' || protocol === 'gemini-cli') return 'gemini'
  return null
}

async function compressCanvasGenerationImage(input: EditImageInput, maxBytes: number): Promise<EditImageInput> {
  if (input.buf.length <= maxBytes) return input
  try {
    const metadata = await sharp(input.buf, { animated: false, limitInputPixels: 268_402_689 }).metadata()
    const sourceLongEdge = Math.max(metadata.width || 0, metadata.height || 0)
    const candidateEdges = [sourceLongEdge, 3072, 2560, 2048, 1792, 1536, 1280, 1024, 768, 512, 384]
      .filter((value, index, values) => value > 0 && value <= sourceLongEdge && values.indexOf(value) === index)
    const edges = candidateEdges.length ? candidateEdges : [3072, 2048, 1280, 768, 512, 384]
    const qualities = [88, 78, 68, 58, 48, 38, 28]
    let smallest: Buffer | null = null

    // 优先保留画质，再逐级缩小尺寸；这样大图通常会在 3072/2560px 的高质量档命中，
    // 不会为了保留原始像素尺寸而先降到很低的 JPEG 质量。
    for (const quality of qualities) {
      for (const edge of edges) {
        const result = await sharp(input.buf, { animated: false, limitInputPixels: 268_402_689 })
          .rotate()
          .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer()
        if (!smallest || result.length < smallest.length) smallest = result
        if (result.length <= maxBytes) {
          return { buf: result, mime: 'image/jpeg', name: input.name.replace(/\.[^.]+$/, '') + '.jpg' }
        }
      }
    }
    if (smallest && smallest.length <= maxBytes) return { buf: smallest, mime: 'image/jpeg', name: input.name.replace(/\.[^.]+$/, '') + '.jpg' }
    throw new Error(`压缩后仍有 ${((smallest?.length || input.buf.length) / 1024 / 1024).toFixed(2)} MB`)
  } catch (error) {
    throw new Error(`输入图片「${input.name}」压缩失败：${String((error as Error).message || error)}`)
  }
}

app.post('/api/canvas/media/extract-audio', (req, res) => {
  const user = req.auth!.user
  const canvasId = String(req.body?.canvasId || '')
  const nodeId = String(req.body?.nodeId || '')
  if (!canvasId || !canEditCanvas(canvasId, user)) return fail(res, '没有该项目的编辑权限', 403)
  if (!nodeId) return fail(res, '缺少视频文件', 400)
  try {
    const source = readableCanvasMedia(nodeId, canvasId, user)
    if (!String(source.node.mime || '').startsWith('video/')) return fail(res, '所选文件不是视频', 400)
    const data = transcodeCanvasAudio({ data: source.data, sourceName: source.node.name })
    ok(res, { media: saveCanvasDerivedAudio(canvasId, user, data, '视频音频') })
  } catch (error) { fail(res, String((error as Error).message || error)) }
})

app.post('/api/canvas/media/trim-audio', (req, res) => {
  const user = req.auth!.user
  const canvasId = String(req.body?.canvasId || '')
  const nodeId = String(req.body?.nodeId || '')
  const start = Number(req.body?.start)
  const end = Number(req.body?.end)
  if (!canvasId || !canEditCanvas(canvasId, user)) return fail(res, '没有该项目的编辑权限', 403)
  if (!nodeId) return fail(res, '缺少音频文件', 400)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 3600) return fail(res, '音频裁切区间无效', 400)
  try {
    const source = readableCanvasMedia(nodeId, canvasId, user)
    if (!String(source.node.mime || '').startsWith('audio/')) return fail(res, '所选文件不是音频', 400)
    const data = transcodeCanvasAudio({ data: source.data, sourceName: source.node.name, start, end })
    ok(res, { media: saveCanvasDerivedAudio(canvasId, user, data, '裁切音频') })
  } catch (error) { fail(res, String((error as Error).message || error)) }
})

async function uploadCanvasFreeMedia(input: { buf: Buffer; mime: string; name: string }) {
  const attempts: Array<{ service: string; url: string; expiresAt: number; build: () => FormData }> = [
    {
      service: 'litterbox', url: 'https://litterbox.catbox.moe/resources/internals/api.php', expiresAt: Date.now() + 72 * 3600_000,
      build: () => { const form = new FormData(); form.append('reqtype', 'fileupload'); form.append('time', '72h'); form.append('fileToUpload', new Blob([new Uint8Array(input.buf)], { type: input.mime }), input.name); return form },
    },
    {
      service: 'temp.sh', url: 'https://temp.sh/upload', expiresAt: Date.now() + 72 * 3600_000,
      build: () => { const form = new FormData(); form.append('file', new Blob([new Uint8Array(input.buf)], { type: input.mime }), input.name); return form },
    },
  ]
  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { method: 'POST', body: attempt.build(), signal: AbortSignal.timeout(240000) })
      const text = (await response.text()).trim().split(/\r?\n/)[0]?.trim() || ''
      if (response.ok && /^https?:\/\//i.test(text)) return { url: text, service: attempt.service, expiresAt: attempt.expiresAt }
      errors.push(`${attempt.service}: HTTP ${response.status} ${text.slice(0, 160)}`)
    } catch (error) { errors.push(`${attempt.service}: ${String((error as Error).message || error)}`) }
  }
  throw new Error(`免费图床上传失败：${errors.join('；')}`)
}

app.post('/api/canvas/public-media', async (req, res) => {
  const body = req.body || {}
  const user = req.auth!.user
  const canvasId = String(body.canvasId || '')
  if (!canvasId || !canEditCanvas(canvasId, user)) return fail(res, '没有该项目的编辑权限', 403)
  const service = String(body.service || '') as 'apimart' | 'runninghub' | 'free' | 'dxos'
  if (!['apimart', 'runninghub', 'free', 'dxos'].includes(service)) return fail(res, '不支持的公网链接方式', 400)
  const nodeIds: string[] = Array.isArray(body.nodeIds) ? [...new Set<string>((body.nodeIds as unknown[]).map((value) => String(value)))].slice(0, 20) : []
  if (!nodeIds.length) return fail(res, '没有可上传的输入素材', 400)
  try {
    const provider = service === 'free' || service === 'dxos' ? null : canvasPublicMediaProvider(service, String(body.providerId || ''))
    if (service !== 'free' && service !== 'dxos' && !provider) return fail(res, service === 'apimart' ? '请先在 API 设置配置 APIMart' : '请先在 API 设置配置 RunningHub', 400)
    if (service === 'dxos') {
      const cloud = await cloudAccountStatus(user.id)
      if (!cloud.loggedIn) return fail(res, '使用大雄图床前，请先在“系统设置 → 账户”登录 DX OS 在线账号', 409)
      if (!cloud.online) return fail(res, '暂时无法连接 DX OS 在线账号，请检查网络后重试', 503)
    }
    const items = []
    for (const nodeId of nodeIds) {
      const node = getNode(nodeId)
      const buf = readBlob(nodeId)
      const ownFile = !!node && (!node.ownerId || node.ownerId === user.id)
      if (!node || !buf || (!ownFile && !canViewCanvasMedia(nodeId, user, canvasId))) throw new Error(`素材不可读取：${nodeId}`)
      const mime = node.mime || 'application/octet-stream'
      const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image'
      if (service === 'apimart') {
        const url = await uploadApimartMedia({ base_url: provider!.base_url, api_key: provider!.api_key, protocol: provider!.protocol }, { buf, mime, name: node.name, kind }, 240000)
        items.push({ nodeId, service, url })
      } else if (service === 'runninghub') {
        const remoteName = await uploadRunningHubAsset({ base_url: provider!.base_url, api_key: provider!.api_key, wallet_api_key: provider!.wallet_api_key, protocol: provider!.protocol }, { buf, mime, name: node.name }, false)
        items.push({ nodeId, service, remoteName })
      } else if (service === 'free') {
        const uploaded = await uploadCanvasFreeMedia({ buf, mime, name: node.name })
        items.push({ nodeId, service: uploaded.service, url: uploaded.url, expiresAt: uploaded.expiresAt })
      } else {
        const uploaded = await uploadCloudTemporaryMedia(user.id, { data: buf, mime, name: node.name })
        items.push({ nodeId, service: 'dxos', url: uploaded.url, expiresAt: uploaded.expiresAt })
      }
    }
    ok(res, { items })
  } catch (error) { fail(res, String((error as Error).message || error)) }
})

const handleLegacyCanvasGeneration: express.RequestHandler = async (req, res) => {
  const body = req.body || {}
  const user = req.auth!.user
  const canvasId = String(body.canvasId || '')
  if (!canvasId || !canEditCanvas(canvasId, user)) return fail(res, '没有该项目的编辑权限', 403)
  if (body.platform === 'comfy') {
    try {
      const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params)
        ? body.params as Record<string, unknown>
        : {}
      const workflowId = String(params.comfy_workflow_id || '')
      if (!workflowId) return fail(res, '请先选择 ComfyUI 工作流', 400)
      const preset = getComfyWorkflow(user.id, workflowId)
      const prompt = String(body.prompt || '').trim()
      const inputNodeIds = Array.isArray(body.inputNodeIds) ? body.inputNodeIds.map(String) : []
      const textInputs = Array.isArray(body.inputTexts) ? body.inputTexts.map((value: unknown) => String(value || '').trim()).filter(Boolean) : prompt ? [prompt] : []
      const inputFiles: Array<{ fieldId: string; buffer: Buffer; name: string; mime?: string }> = []
      const mediaInputs: Record<'image' | 'video' | 'audio' | 'file', Array<{ buffer: Buffer; name: string; mime?: string }>> = { image: [], video: [], audio: [], file: [] }
      for (const id of inputNodeIds) {
        const node = getNode(id)
        const buffer = readBlob(id)
        const ownFile = !!node && (!node.ownerId || node.ownerId === user.id)
        if (!node || !buffer || (!ownFile && !canViewCanvasMedia(id, user, canvasId))) continue
        const mime = String(node.mime || '')
        const kind: 'image' | 'video' | 'audio' | 'file' = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file'
        mediaInputs[kind].push({ buffer, name: node.name || `input-${id}`, mime: node.mime })
      }
      const mediaCursor = { image: 0, video: 0, audio: 0, file: 0 }
      let textIndex = 0
      const values: Record<string, unknown> = {}
      for (const field of preset.fields) {
        const key = `comfy_field:${workflowId}:${field.id}`
        if (field.type === 'image' || field.type === 'video' || field.type === 'audio' || field.type === 'file') {
          const file = mediaInputs[field.type][mediaCursor[field.type]++]
          if (file) inputFiles.push({ fieldId: field.id, ...file })
          else if (field.required) return fail(res, `工作流缺少必选素材：${field.label}`, 400)
          continue
        }
        if (field.type === 'text' || field.type === 'textarea') {
          const text = textInputs[textIndex++]
          if (text) values[field.id] = text
          else if (Object.prototype.hasOwnProperty.call(params, key)) values[field.id] = params[key]
          continue
        }
        if (Object.prototype.hasOwnProperty.call(params, key)) values[field.id] = params[key]
        if (field.type === 'seed' && params[`comfy_seed_mode:${workflowId}:${field.id}`] !== 'fixed') values[field.id] = 'random'
      }
      const run = startComfyWorkflowRun(user.id, workflowId, values, inputFiles)
      const deadline = Date.now() + 30 * 60_000
      let completed = run
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        completed = getComfyWorkflowRun(user.id, run.id)
        if (completed.status === 'failed') throw new Error(completed.error || 'ComfyUI 工作流运行失败')
        if (completed.status === 'completed') break
      }
      if (completed.status !== 'completed') throw new Error('ComfyUI 工作流运行超时')
      const folder = ensureCanvasOutputFolder(user.id, canvasId, user)
      const mediaResults: Array<{ nodeId: string; name: string; url: string; role: 'result'; kind: 'image' | 'video' | 'audio' | 'file'; prompt: string }> = []
      const textResults: Array<{ artifactId: string; text: string; role: 'result'; prompt: string; name?: string }> = []
      for (const [index, result] of completed.results.entries()) {
        if (result.type === 'text') {
          if (result.text) textResults.push({ artifactId: randomUUID(), text: result.text, role: 'result', prompt, name: result.label || result.name })
          continue
        }
        const file = await proxyComfyRunFile(user.id, run.id, index)
        const kind: 'image' | 'video' | 'audio' | 'file' = result.type === 'image' || result.type === 'video' || result.type === 'audio' ? result.type : file.contentType.startsWith('image/') ? 'image' : file.contentType.startsWith('video/') ? 'video' : file.contentType.startsWith('audio/') ? 'audio' : 'file'
        const node = createNode({ name: result.name || `comfy-output-${index + 1}`, type: 'file', parentId: folder, mime: file.contentType, size: file.buffer.length, ownerId: user.id })
        saveBlob(node.id, file.buffer)
        mediaResults.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'result', kind, prompt })
      }
      return ok(res, { results: mediaResults, textResults, workflow: preset.name })
    } catch (e) {
      return fail(res, String((e as Error).message || e))
    }
  }
  const mode = String(body.mode || 't2i')
  const runningHubMode = body.params?.runninghub_mode === 'app' ? 'app' : body.params?.runninghub_mode === 'workflow' ? 'workflow' : 'api'
  const isRunningHubEntry = runningHubMode !== 'api'
  const isAudio = body.outputKind === 'audio'
  const isVideo = !isAudio && (mode === 't2v' || mode === 'i2v' || mode === 'v2v' || mode === 'ia2v')
  const needsInput = !isAudio && (mode === 'i2i' || mode === 'i2v' || mode === 'v2v' || mode === 'ia2v')
  const prompt = String(body.prompt || '').trim()
  if (!prompt && (!needsInput || isAudio) && !isRunningHubEntry) return fail(res, isAudio ? '请先填写要朗读的文字或音乐描述' : '请先填写提示词', 400)

  const cap = isAudio ? 'audio' : isVideo ? 'video' : 'image'
  const stored = body.providerId ? revealProvider(String(body.providerId)) : firstUsableProvider(cap)
  const capLabel = isAudio ? '音频' : isVideo ? '视频' : '图像'
  if (!stored) return fail(res, `还没有可用的${capLabel}模型站点，请先在「API 设置」里添加并启用。`, 400)
  if (!stored.enabled) return fail(res, '该站点已禁用', 400)
  const capModel = stored.models?.find((m) => (m.caps || []).includes(cap))?.model
  const model = String(body.model || capModel || '').trim()
  if (!model) return fail(res, `该站点没有配置${capLabel}模型`, 400)
  const modelEntry = stored.models?.find((entry) => entry.model === model)
  const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, wallet_api_key: stored.wallet_api_key, protocol: modelEntry?.protocol || stored.protocol }

  const protocolParams = body.params && typeof body.params === 'object' && !Array.isArray(body.params)
    ? body.params as Record<string, unknown>
    : {}
  const imageCompressionEnabled = protocolParams.imageCompressionEnabled === true
  const requestedCompressionMb = Number(protocolParams.imageCompressionMaxMb)
  const imageCompressionMaxMb = Number.isFinite(requestedCompressionMb) ? Math.max(.25, Math.min(20, requestedCompressionMb)) : 2
  const imageCompressionMaxBytes = Math.round(imageCompressionMaxMb * 1024 * 1024)

  // 输入素材：直接从网盘 blob 读取；按生成卡片设置在发往上游前压缩超限图片。
  const inputNodeIds: string[] = Array.isArray(body.inputNodeIds) ? body.inputNodeIds.map(String) : []
  const publicInputs = body.publicInputs && typeof body.publicInputs === 'object' && !Array.isArray(body.publicInputs)
    ? body.publicInputs as Record<string, { url?: unknown; remoteName?: unknown; service?: unknown }>
    : {}
  const inputs: EditImageInput[] = []
  const videoRefs: GenVideoReference[] = []
  for (const id of inputNodeIds) {
    const node = getNode(id)
    const buf = readBlob(id)
    const ownFile = !!node && (!node.ownerId || node.ownerId === user.id)
    if (node && buf && (ownFile || canViewCanvasMedia(id, user, canvasId))) {
      const mime = node.mime || 'application/octet-stream'
      const transport = publicInputs[id] || {}
      const publicUrl = /^https?:\/\//i.test(String(transport.url || '')) ? String(transport.url) : undefined
      const remoteName = String(transport.remoteName || '').trim() || undefined
      const originalInput: EditImageInput = { buf, mime, name: node.name || 'input', ...(publicUrl ? { publicUrl } : {}), ...(remoteName ? { remoteName } : {}) }
      let input = originalInput
      if (imageCompressionEnabled && mime.startsWith('image/') && buf.length > imageCompressionMaxBytes) {
        try { input = await compressCanvasGenerationImage(originalInput, imageCompressionMaxBytes) }
        catch (error) { return fail(res, String((error as Error).message || error), 400) }
      }
      inputs.push(input)
      if (mime.startsWith('image/')) videoRefs.push({ ...input, kind: 'image' })
      else if (mime.startsWith('video/')) videoRefs.push({ ...input, kind: 'video' })
      else if (mime.startsWith('audio/')) videoRefs.push({ ...input, kind: 'audio' })
    }
  }
  if (needsInput && !inputs.length) return fail(res, '该模式需要至少一个输入素材', 400)
  const imageInputs = inputs.filter((input) => (input.mime || '').startsWith('image/'))
  if (mode === 'i2i' && !imageInputs.length) return fail(res, '图生图需要至少一张输入图', 400)
  if (imageInputs.length && !isVideo && !isRunningHubEntry) {
    const manifest = resolveProtocolModelProfile(provider.protocol, model)
    const explicitlyClassified = !!manifest.profileId || !!modelProtocolAlias(provider.protocol)
    const hasEditCapability = manifest.capabilities.includes('image.edit')
    const hasEditOperation = resolveOperation(provider.protocol, model, 'image.edit')?.id === 'image.edit'
    if (!hasEditCapability && (explicitlyClassified || !hasEditOperation)) {
      return fail(res, `当前模型「${model}」没有声明参考图编辑能力，请更换支持图像编辑的模型。`, 400)
    }
  }
  if (mode === 'i2v' && !videoRefs.some((ref) => ref.kind === 'image')) return fail(res, '图生视频需要至少一张输入图', 400)
  if (mode === 'v2v' && !videoRefs.some((ref) => ref.kind === 'video')) return fail(res, '视频生视频需要至少一个输入视频', 400)
  if (mode === 'ia2v' && !videoRefs.some((ref) => ref.kind === 'audio')) return fail(res, '参考音频生视频需要至少一个输入音频', 400)

  const size = body.size ? String(body.size) : undefined
  const n = Math.max(1, Math.min(10, Number(body.n) || 1))
  const videoReferenceMode = protocolParams.video_reference_mode === 'first_last' ? 'first_last' : 'smart'
  const forwardedProtocolParams = { ...protocolParams }
  for (const key of ['video_reference_mode', 'enhance_prompt', 'enable_upsample', 'camera_fixed', 'camerafixed', 'watermark', 'multimodal', 'imageCompressionEnabled', 'imageCompressionMaxMb']) delete forwardedProtocolParams[key]
  const requestedQuality = ['auto', 'standard', 'hd', 'high'].includes(String(body.quality || ''))
    ? String(body.quality)
    : ''
  const imageParams: Record<string, unknown> = { ...protocolParams }
  delete imageParams.imageCompressionEnabled
  delete imageParams.imageCompressionMaxMb
  if (requestedQuality) imageParams.quality = requestedQuality

  try {
    const folder = ensureCanvasOutputFolder(user.id, canvasId, user)
    const results: CanvasGeneratedMediaResult[] = []
    if (isRunningHubEntry) {
      if (provider.protocol !== 'runninghub' && stored.protocol !== 'runninghub') return fail(res, 'AI 应用和工作流模式仅支持 RunningHub 站点', 400)
      const catalog = runningHubMode === 'app' ? stored.rh_apps || [] : stored.rh_workflows || []
      const entry = catalog.find((item: any) => String(item.id || (runningHubMode === 'app' ? item.appId : item.workflowId) || '') === model && item.enabled !== false && item.hidden !== true) as any
      const entryLabel = runningHubMode === 'app' ? 'AI 应用' : '工作流'
      if (!entry) return fail(res, `所选 RunningHub ${entryLabel}不存在或已停用`, 400)
      const fields = (Array.isArray(entry.fields) ? entry.fields : []).map((field: any) => ({ ...field }))
      const mediaInputs = {
        IMAGE: inputs.filter((input) => String(input.mime || '').startsWith('image/')),
        VIDEO: inputs.filter((input) => String(input.mime || '').startsWith('video/')),
        AUDIO: inputs.filter((input) => String(input.mime || '').startsWith('audio/')),
      }
      const uploadCache = new Map<EditImageInput, Promise<string>>()
      const upload = (input: EditImageInput) => {
        if (input.remoteName) return Promise.resolve(input.remoteName)
        let pending = uploadCache.get(input)
        if (!pending) {
          pending = uploadRunningHubAsset(provider, input, false)
          uploadCache.set(input, pending)
        }
        return pending
      }
      const mediaCursor = { IMAGE: 0, VIDEO: 0, AUDIO: 0 }
      const usedMediaIndexes = { IMAGE: new Set<number>(), VIDEO: new Set<number>(), AUDIO: new Set<number>() }
      for (const field of fields) {
        if (field.enabled === false || field.sourceFromUpstream === false) continue
        const fieldKind = String(field.fieldType || 'TEXT').toUpperCase()
        if (fieldKind === 'IMAGE' || fieldKind === 'VIDEO' || fieldKind === 'AUDIO') {
          const pool = mediaInputs[fieldKind]
          let requestedIndex = fieldKind === 'IMAGE' && Number(field.imageOrder) > 0 ? Number(field.imageOrder) - 1 : mediaCursor[fieldKind]
          while (usedMediaIndexes[fieldKind].has(requestedIndex)) requestedIndex += 1
          usedMediaIndexes[fieldKind].add(requestedIndex)
          while (usedMediaIndexes[fieldKind].has(mediaCursor[fieldKind])) mediaCursor[fieldKind] += 1
          const input = pool[requestedIndex]
          if (!input && field.required) return fail(res, `${entryLabel}缺少必选素材：${field.label || field.fieldName}`, 400)
          if (input) field.fieldValue = await upload(input)
          continue
        }
        if (/(^|_)(prompt|text|positive_prompt)(_|$)/i.test(String(field.fieldName || ''))) {
          if (prompt) field.fieldValue = prompt
          continue
        }
        const key = `runninghub_${runningHubMode}:${model}:${field.id || `${field.nodeId}::${field.fieldName}`}`
        if (Object.prototype.hasOwnProperty.call(protocolParams, key)) field.fieldValue = String(protocolParams[key] ?? '')
      }
      const submitted = await submitRunningHubEntry(provider, runningHubMode, model, fields, false, entry.workflowJson, runningHubMode === 'workflow' ? String(protocolParams.runninghub_instance_type || '') : '')
      const deadline = Date.now() + 20 * 60_000
      let outputUrls: string[] = []
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const task = await queryRunningHubTask(provider, submitted.taskId, false)
        if (task.status === 'SUCCESS') { outputUrls = task.urls || []; break }
        if (task.status === 'FAILED') throw new Error(task.failReason || `RunningHub ${entryLabel}运行失败`)
      }
      if (!outputUrls.length) throw new Error(`RunningHub ${entryLabel}完成但没有返回媒体结果`)
      let outputIndex = 0
      const seenOutputHashes = new Set<string>()
      for (const url of outputUrls) {
        const fallbackMime = isAudio ? 'audio/mpeg' : isVideo ? 'video/mp4' : 'image/png'
        const media = await fetchGeneratedMedia(url, fallbackMime)
        const hash = createHash('sha256').update(media.data).digest('hex')
        if (seenOutputHashes.has(hash)) continue
        seenOutputHashes.add(hash)
        const kind: 'image' | 'video' | 'audio' = media.mime.startsWith('audio/') ? 'audio' : media.mime.startsWith('video/') ? 'video' : 'image'
        const extension = kind === 'audio' ? media.mime.includes('wav') ? 'wav' : 'mp3' : kind === 'video' ? 'mp4' : media.mime.includes('jpeg') ? 'jpg' : 'png'
        const node = createNode({ name: `runninghub-${runningHubMode}-${Date.now()}-${outputIndex++}.${extension}`, type: 'file', parentId: folder, mime: media.mime, size: media.data.length, ownerId: user.id })
        saveBlob(node.id, media.data)
        results.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'result', kind, prompt })
      }
    } else if (isAudio) {
      const supportedAudioIntents = resolveProtocolModelProfile(provider.protocol, model).capabilities
      const requestedAudioIntent = body.audioIntent === 'audio.music' ? 'audio.music' : 'audio.tts'
      const audioIntent: 'audio.tts' | 'audio.music' = supportedAudioIntents.includes(requestedAudioIntent)
        ? requestedAudioIntent
        : supportedAudioIntents.includes('audio.music') ? 'audio.music' : 'audio.tts'
      if (!supportedAudioIntents.includes(audioIntent)) return fail(res, `当前模型不支持 ${requestedAudioIntent}`, 400)
      validateProtocolParameters(provider.protocol, model, audioIntent, protocolParams, { images: 0, videos: 0, audios: 0 })
      if (audioIntent === 'audio.music') {
        const generated = await generateMusic(provider, model, {
          prompt,
          title: String(protocolParams.title || ''),
          lyrics: String(protocolParams.lyrics || ''),
          style: String(protocolParams.style || ''),
          instrumental: protocolParams.instrumental === true,
        })
        let i = 0
        for (const audio of generated.audios) {
          const buf = await fetchToBuffer(audio.value)
          const node = createNode({ name: `audio-${Date.now()}-${i++}.mp3`, type: 'file', parentId: folder, mime: 'audio/mpeg', size: buf.length, ownerId: user.id })
          saveBlob(node.id, buf)
          results.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'result', kind: 'audio', prompt })
        }
      } else {
        const format = String(protocolParams.response_format || 'mp3').toLowerCase()
        const generated = await generateSpeech(provider, model, {
          input: prompt,
          voice: String(protocolParams.voice || 'alloy'),
          speed: Number(protocolParams.speed) || 1,
          response_format: format,
        })
        const extension = ({ 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/aac': 'aac' } as Record<string, string>)[generated.mime] || (format === 'pcm' ? 'pcm' : format)
        const node = createNode({ name: `speech-${Date.now()}.${extension}`, type: 'file', parentId: folder, mime: generated.mime, size: generated.data.length, ownerId: user.id })
        saveBlob(node.id, generated.data)
        results.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'result', kind: 'audio', prompt })
      }
      if (!results.length) return fail(res, '音频接口调用成功，但没有返回音频')
    } else if (isVideo) {
      const rawImages = videoRefs.filter((ref) => ref.kind === 'image')
      const useFirstLastFrames = mode === 'i2v' && rawImages.length >= 2 && videoReferenceMode === 'first_last'
      const refsByKind = {
        images: useFirstLastFrames
          ? rawImages.slice(0, 2).map((ref, index) => ({ ...ref, role: index === 0 ? 'first_frame' : 'last_frame' }))
          : rawImages.map((ref) => ({ ...ref, role: 'reference_image' })),
        videos: videoRefs.filter((ref) => ref.kind === 'video'),
        audios: videoRefs.filter((ref) => ref.kind === 'audio'),
      }
      const videoIntent: CapabilityIntent = mode === 'v2v'
        ? 'video.video_to_video'
        : mode === 'ia2v'
          ? 'video.audio_reference'
          : mode === 'i2v'
            ? useFirstLastFrames ? 'video.first_last_frame' : refsByKind.images.length > 1 ? 'video.multi_reference' : 'video.image_to_video'
            : 'video.text_to_video'
      validateProtocolParameters(provider.protocol, model, videoIntent, {
        ...forwardedProtocolParams,
      }, {
        images: refsByKind.images.length,
        videos: refsByKind.videos.length,
        audios: refsByKind.audios.length,
      })
      const jimengProtocol = String(provider.protocol || '').trim().toLowerCase()
      const jimengVideo = jimengProtocol === 'cli:jimeng' || jimengProtocol === 'jimeng-cli'
      const videoParams = {
        ...forwardedProtocolParams,
        prompt,
        size: String(forwardedProtocolParams.aspect_ratio || forwardedProtocolParams.size || size || '') || undefined,
        images: refsByKind.images.length ? refsByKind.images : undefined,
        videos: refsByKind.videos.length ? refsByKind.videos : undefined,
        audios: refsByKind.audios.length ? refsByKind.audios : undefined,
      }
      const r = jimengVideo
        ? await generateJimengVideo(prompt, model || 'seedance2.0fast', {
            imagePaths: refsByKind.images.map((ref) => tempMediaFile(ref.buf, ref.mime || 'image/png', '.png')),
            imageRoles: refsByKind.images.map((ref) => String(ref.role || 'reference_image')),
            videoPaths: refsByKind.videos.map((ref) => tempMediaFile(ref.buf, ref.mime || 'video/mp4', '.mp4')),
            audioPaths: refsByKind.audios.map((ref) => tempMediaFile(ref.buf, ref.mime || 'audio/mpeg', '.mp3')),
            duration: Number(forwardedProtocolParams.duration) || 5,
            aspect_ratio: String(forwardedProtocolParams.aspect_ratio || videoParams.size || '16:9'),
            resolution: forwardedProtocolParams.resolution == null ? undefined : String(forwardedProtocolParams.resolution),
            multimodal: protocolParams.multimodal === true || refsByKind.videos.length > 0 || refsByKind.audios.length > 0,
            pollSeconds: 12,
            deferPending: true,
          }).then((value) => ({ videos: value.videos.map((url) => ({ type: 'url' as const, value: url })), raw: value.raw }))
        : await generateVideos(provider, model, videoParams)
      const first = r.videos[0]
      if (!first) return fail(res, '视频接口调用成功，但没有返回视频')
      const buf = await fetchToBuffer(first.value)
      const node = createNode({ name: `gen-${Date.now()}.mp4`, type: 'file', parentId: folder, mime: 'video/mp4', size: buf.length, ownerId: user.id })
      saveBlob(node.id, buf)
      results.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'result', kind: 'video', prompt })
    } else {
      const jimengProtocol = String(provider.protocol || '').trim().toLowerCase()
      const jimengImage = jimengProtocol === 'cli:jimeng' || jimengProtocol === 'jimeng-cli'
      const gen = jimengImage
        ? await generateJimengImage(
            prompt,
            model || 'jimeng-5.0Pro',
            String(size || '1024x1024'),
            imageInputs.map((input) => tempMediaFile(input.buf, input.mime || 'image/png', '.png')),
            { pollSeconds: 12, deferPending: true },
          ).then((value) => ({ images: value.images.map((url) => ({ type: 'url' as const, value: url })), raw: value.raw }))
        : imageInputs.length
          ? await editImages(provider, model, { ...imageParams, prompt, size, n }, imageInputs)
          : await generateImages(provider, model, { ...imageParams, prompt, size, n })
      let generatedImages = gen.images
      const shouldUpscale = (jimengProtocol === 'cli:jimeng' || jimengProtocol === 'jimeng-cli') && protocolParams.jimeng_upscale_enabled === true
      if (shouldUpscale && generatedImages.length) {
        const resolutionValue = String(protocolParams.jimeng_upscale_resolution || '2k').trim().toLowerCase()
        const upscaleResolution = resolutionValue === '4k' || resolutionValue === '8k' ? resolutionValue : '2k'
        const upscaled: typeof generatedImages = []
        for (const image of generatedImages) {
          const buffer = image.type === 'b64' ? Buffer.from(image.value, 'base64') : await fetchToBuffer(image.value)
          const path = tempMediaFile(buffer, 'image/png', '.png')
          const result = await upscaleJimengImage(path, upscaleResolution, { pollSeconds: 12, deferPending: true })
          upscaled.push(...result.images.map((value) => ({ type: 'url' as const, value })))
        }
        generatedImages = upscaled
      }
      if (!generatedImages.length) return fail(res, shouldUpscale ? '即梦图片放大成功，但没有返回图片' : '图像接口调用成功，但没有返回图片')
      let i = 0
      const seenImageHashes = new Set<string>()
      for (const img of generatedImages) {
        const buf = img.type === 'b64' ? Buffer.from(img.value, 'base64') : await fetchToBuffer(img.value)
        const hash = createHash('sha256').update(buf).digest('hex')
        if (seenImageHashes.has(hash)) continue
        seenImageHashes.add(hash)
        const node = createNode({ name: `gen-${Date.now()}-${i++}.png`, type: 'file', parentId: folder, mime: 'image/png', size: buf.length, ownerId: user.id })
        saveBlob(node.id, buf)
        results.push({ nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'result', kind: 'image', prompt, ...await generatedImageDimensions(buf, 'image') })
        if (i >= n) break
      }
    }
    ok(res, { results, model, provider: stored.name })
  } catch (e) {
    if (e instanceof JimengPendingError) return res.status(202).json({ ok: true, ...jimengPendingPayload(e) })
    fail(res, String((e as Error).message || e))
  }
}

function sendStoredLegacyAiTask(res: express.Response, task: LegacyAiTaskRow) {
  if (task.response_json) {
    const response = JSON.parse(task.response_json) as Record<string, unknown>
    return res.status(task.http_status || (task.status === 'pending' ? 202 : 200)).json({ ...response, taskId: task.id })
  }
  if (task.status === 'cancelled') return ok(res, { status: 'cancelled', taskId: task.id })
  return res.status(409).json({ ok: false, error: '任务已经开始，当前没有可恢复的远程任务 ID；为避免重复扣费，系统不会再次提交。', taskId: task.id })
}

function captureLegacyAiTaskResponse(res: express.Response, taskId: string) {
  const originalJson = res.json.bind(res)
  res.json = ((value: unknown) => {
    const payload = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { data: value }
    const current = getLegacyAiTask(taskId)
    const remoteTaskId = String(payload.submit_id || payload.submitId || current?.remote_task_id || '').trim() || null
    const pending = payload.status === 'pending' || payload.jimeng_pending === true
    const failed = payload.ok === false || payload.status === 'failed'
    const status = pending ? 'pending' : failed ? 'failed' : 'completed'
    const now = Date.now()
    if (current?.status !== 'cancelled') updateLegacyAiTask(taskId, {
      status,
      remote_task_id: remoteTaskId,
      response_json: JSON.stringify(payload),
      error_message: failed ? String(payload.error || payload.message || '任务失败') : null,
      http_status: res.statusCode,
      updated_at: now,
      completed_at: status === 'pending' ? null : now,
    })
    return originalJson({ ...payload, taskId })
  }) as typeof res.json
}

// Compatibility facade: one immutable routing decision selects either the
// exact declarative canary or the proven legacy executor; never both.
app.post('/api/ai-tasks/generate', async (req, res, next) => {
  const task = req.body?.task
  if (!isStandardAiTask(task)) return fail(res, '无效的标准 AI 任务（需要 dx-ai-task/v1）', 400)
  const userId = String(req.auth!.user.id)
  if (!canEditCanvas(task.source.canvasId, req.auth!.user)) return fail(res, '没有该项目的编辑权限', 403)
  const stored = createLegacyAiTask({
    id: task.requestId,
    ownerId: userId,
    canvasId: task.source.canvasId,
    request: task,
    outputKind: task.output.kind,
    prompt: task.prompt,
  })
  if (!stored.created) {
    if (stored.task.owner_id !== userId || stored.task.canvas_id !== task.source.canvasId) return fail(res, '任务不存在', 404)
    return sendStoredLegacyAiTask(res, stored.task)
  }
  const capability = task.output.kind === 'video' ? 'video' : task.output.kind === 'audio' ? 'audio' : 'image'
  const provider = task.provider.providerId ? revealProvider(task.provider.providerId) : firstUsableProvider(capability)
  let declarative
  try { declarative = resolveCanvasDeclarativeRoute(task, provider) }
  catch (error) {
    updateLegacyAiTask(task.requestId, { status: 'failed', error_message: String((error as Error).message || error), updated_at: Date.now(), completed_at: Date.now() })
    return fail(res, String((error as Error).message || error), 400)
  }
  updateLegacyAiTask(task.requestId, { status: 'running', updated_at: Date.now() })
  captureLegacyAiTaskResponse(res, task.requestId)
  if (declarative.mode === 'declarative') {
    try {
      const protocolTask = await submitAiProtocolTask({
        id: task.requestId,
        ownerId: userId,
        canvasId: task.source.canvasId,
        providerSiteId: provider?.id,
        mode: 'execute',
        providerProtocolId: declarative.providerProtocolId,
        providerProtocolVersion: declarative.providerProtocolVersion,
        modelProtocolId: declarative.modelProtocolId,
        modelProtocolVersion: declarative.modelProtocolVersion,
        baseUrl: declarative.baseUrl,
        credential: declarative.credential,
        task: declarative.task,
        deferAsync: true,
      })
      if (protocolTask.status === 'pending') {
        return res.status(202).json({ ok: true, status: 'pending', taskId: task.requestId, submit_id: protocolTask.remote_task_id })
      }
      const results = await deliverCanvasProtocolTask({
        protocolTaskId: protocolTask.id,
        ownerId: userId,
        canvasId: task.source.canvasId,
        user: req.auth!.user,
        prompt: task.prompt,
      })
      return ok(res, { results, model: task.provider.model, provider: provider?.name || task.provider.providerId, executor: 'declarative' })
    } catch (error) {
      return fail(res, String((error as Error).message || error), 502)
    }
  }
  req.body = toLegacyCanvasGenerationRequest(task)
  return handleLegacyCanvasGeneration(req, res, next)
})
app.post('/api/canvas/generate', handleLegacyCanvasGeneration)

const handleLegacyCanvasGenerationQuery: express.RequestHandler = async (req, res) => {
  const body = req.body || {}
  const user = req.auth!.user
  const canvasId = String(body.canvasId || '')
  if (!canvasId || !canEditCanvas(canvasId, user)) return fail(res, '没有该项目的编辑权限', 403)
  const kind = ['image', 'video', 'audio'].includes(String(body.kind || '')) ? body.kind as 'image' | 'video' | 'audio' : 'image'
  try {
    const queried = await queryJimengMedia(String(body.submit_id || body.submitId || ''), kind)
    if (queried.status === 'pending') return ok(res, queried)
    if (queried.status === 'failed') return fail(res, queried.error || '即梦任务失败', 502)
    const results = await saveCanvasJimengResults({
      ownerId: user.id,
      canvasId,
      user,
      urls: queried.urls || [],
      kind,
      prompt: String(body.prompt || ''),
    })
    return ok(res, { status: 'succeeded', submit_id: queried.submit_id, results })
  } catch (error) {
    return fail(res, String((error as Error).message || error))
  }
}

app.post('/api/ai-tasks/query', (req, res, next) => {
  const body = req.body || {}
  const localTaskId = String(body.taskId || '')
  const stored = getLegacyAiTask(localTaskId)
  const protocolTask = getAiProtocolTask(localTaskId)
  if (protocolTask) {
    if (protocolTask.owner_id !== String(req.auth!.user.id) || protocolTask.canvas_id !== String(body.canvasId || '')) return fail(res, '任务不存在', 404)
    if (protocolTask.status === 'cancelled') return ok(res, { status: 'cancelled', taskId: localTaskId })
    if (protocolTask.status === 'failed') return fail(res, protocolTask.error_message || '声明式协议任务失败', 502)
    if (protocolTask.status === 'completed') {
      return deliverCanvasProtocolTask({
        protocolTaskId: protocolTask.id,
        ownerId: String(req.auth!.user.id),
        canvasId: String(body.canvasId || ''),
        user: req.auth!.user,
        prompt: stored?.prompt || String(body.prompt || ''),
      }).then((results) => {
        captureLegacyAiTaskResponse(res, localTaskId)
        return ok(res, { status: 'succeeded', taskId: localTaskId, results, executor: 'declarative' })
      }).catch((error) => fail(res, String((error as Error).message || error), 502))
    }
    if (protocolTask.status === 'pending') {
      const provider = protocolTask.provider_site_id ? revealProvider(protocolTask.provider_site_id) : null
      if (!provider?.enabled) return fail(res, '声明式任务固定的平台站点不存在或已禁用，无法继续查询。', 409)
      const providerProtocol = getProtocolV2('provider', protocolTask.provider_protocol_id, protocolTask.provider_protocol_version)
      if (!providerProtocol || providerProtocol.hash !== protocolTask.provider_protocol_hash || providerProtocol.protocol.kind !== 'provider') return fail(res, '声明式任务固定的平台协议已缺失或变更。', 409)
      const credential = providerProtocol.protocol.auth.credentialRef === 'wallet_api_key' ? provider.wallet_api_key : provider.api_key
      return resumeAiProtocolTask({ id: localTaskId, credential }).then(async (resumed) => {
        if (resumed.status === 'pending') {
          captureLegacyAiTaskResponse(res, localTaskId)
          return res.status(202).json({ ok: true, status: 'pending', taskId: localTaskId, submit_id: resumed.remote_task_id })
        }
        if (resumed.status !== 'completed') return fail(res, resumed.error_message || `声明式任务状态异常：${resumed.status}`, 502)
        const results = await deliverCanvasProtocolTask({
          protocolTaskId: resumed.id,
          ownerId: String(req.auth!.user.id),
          canvasId: String(body.canvasId || ''),
          user: req.auth!.user,
          prompt: stored?.prompt || String(body.prompt || ''),
        })
        captureLegacyAiTaskResponse(res, localTaskId)
        return ok(res, { status: 'succeeded', taskId: localTaskId, results, executor: 'declarative' })
      }).catch((error) => fail(res, String((error as Error).message || error), 502))
    }
  }
  if (stored) {
    if (stored.owner_id !== String(req.auth!.user.id) || stored.canvas_id !== String(body.canvasId || '')) return fail(res, '任务不存在', 404)
    if (stored.status !== 'pending') return sendStoredLegacyAiTask(res, stored)
    if (!stored.remote_task_id) return fail(res, '运行中的任务缺少远程任务 ID；为避免重复扣费，系统不会重新提交。', 409)
    captureLegacyAiTaskResponse(res, localTaskId)
  }
  req.body = {
    canvasId: body.canvasId,
    submit_id: stored?.remote_task_id || localTaskId,
    kind: stored?.output_kind || body.outputKind,
    prompt: stored?.prompt || body.prompt,
  }
  return handleLegacyCanvasGenerationQuery(req, res, next)
})
app.post('/api/canvas/query-generation', handleLegacyCanvasGenerationQuery)

app.get('/api/ai-tasks/:id', (req, res) => {
  const task = getLegacyAiTask(String(req.params.id || ''))
  if (!task || task.owner_id !== String(req.auth!.user.id)) return fail(res, '任务不存在', 404)
  ok(res, { task: { ...task, request_json: undefined, response_json: undefined } })
})

app.post('/api/ai-tasks/:id/cancel', (req, res) => {
  const task = getLegacyAiTask(String(req.params.id || ''))
  if (!task || task.owner_id !== String(req.auth!.user.id)) return fail(res, '任务不存在', 404)
  const protocolTask = getAiProtocolTask(task.id)
  if (protocolTask && protocolTask.owner_id === String(req.auth!.user.id)) cancelAiProtocolTask(protocolTask.id)
  const cancelled = cancelLegacyAiTask(task.id)
  ok(res, { status: 'cancelled', taskId: cancelled!.id })
})

app.post('/api/canvas/generate-text', async (req, res) => {
  const body = req.body || {}
  const user = req.auth!.user
  const canvasId = String(body.canvasId || '')
  if (!canvasId || !canEditCanvas(canvasId, user)) return fail(res, '没有该项目的编辑权限', 403)
  const prompt = String(body.prompt || '').trim()
  if (!prompt) return fail(res, '请先填写提示词', 400)
  const skillId = String(body.skillId || '').trim()
  const selectedSkill = skillId ? listSkills().find((skill) => skill.id === skillId) : undefined
  if (skillId && (!selectedSkill || selectedSkill.enabled === false)) return fail(res, '选择的 Skill 不存在或已停用', 400)
  if (selectedSkill && selectedSkill.kind !== 'text' && selectedSkill.kind !== 'procedure') return fail(res, '这个 Skill 不能在 LLM 节点中运行', 400)
  const skillSystem = String(selectedSkill?.systemPrompt || '').trim()

  const stored = body.providerId ? revealProvider(String(body.providerId)) : firstUsableProvider('llm')
  if (!stored) return fail(res, '还没有可用的 LLM 模型站点，请先在「API 设置」里添加并启用。', 400)
  if (!stored.enabled) return fail(res, '该站点已禁用', 400)
  const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }
  const llmModel = stored.models?.find((m) => (m.caps || []).includes('llm'))?.model
  const model = String(body.model || llmModel || stored.models?.[0]?.model || '').trim()
  if (!model) return fail(res, '该站点没有配置 LLM 模型', 400)
  const modelEntry = stored.models?.find((entry) => entry.model === model)
  const protocolParams = body.params && typeof body.params === 'object' && !Array.isArray(body.params)
    ? body.params as Record<string, unknown>
    : {}

  const inputNodeIds = Array.isArray(body.inputNodeIds) ? body.inputNodeIds.map(String) : []
  const imageDataUrls: string[] = []
  for (const id of inputNodeIds) {
    const node = getNode(id)
    const buf = readBlob(id)
    const ownFile = !!node && (!node.ownerId || node.ownerId === user.id)
    if (!node || !buf || !(ownFile || canViewCanvasMedia(id, user, canvasId))) continue
    const mime = node.mime || 'application/octet-stream'
    if (mime.startsWith('image/')) imageDataUrls.push(`data:${mime};base64,${buf.toString('base64')}`)
  }
  if (inputNodeIds.length && !imageDataUrls.length) return fail(res, '没有找到可读取的图片素材，请重新添加图片。', 400)
  const runtimeProtocol = modelEntry?.protocol || stored.protocol
  if (imageDataUrls.length && !resolveProtocolModelProfile(runtimeProtocol, model).capabilities.includes('llm.chat.vision')) {
    return fail(res, '当前模型不支持看图，请选择具备「看图对话」能力的模型。', 400)
  }

  try {
    const resolvedProvider: ResolvedProvider = { ...provider, protocol: runtimeProtocol }
    const response = imageDataUrls.length
      ? { text: await describeImage(resolvedProvider, model, imageDataUrls, skillSystem ? `${skillSystem}\n\n用户请求：\n${prompt}` : prompt, 180000) }
      : await callChat(resolvedProvider, model, { messages: [{ role: 'user', content: prompt }], ...(skillSystem ? { system: skillSystem } : {}) }, protocolParams, 180000)
    const text = String(response.text || '').trim()
    if (!text) return fail(res, 'LLM 接口调用成功，但没有返回文本')
    ok(res, {
      result: {
        artifactId: randomUUID(),
        role: 'result',
        text,
        prompt,
      },
      model,
      skill: selectedSkill ? { id: selectedSkill.id, name: selectedSkill.name } : undefined,
      provider: stored.name,
    })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 虚拟文件系统 ──────────────────────────────────────────────────────
app.use('/api/fs', requireAuth)
app.use('/api/photos', requireAuth)
app.get('/api/fs/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`)
  fsEventClients.add(res)
  req.on('close', () => fsEventClients.delete(res))
})
function parentParam(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return !s || s === 'root' || s === 'null' ? null : s
}
/** 当前用户对某共享区是否可见/读写。 */
function canSeeShare(user: { id: string; role: string; departmentId: string | null }, share: string) {
  if (share === 'public') return true
  if (share.startsWith('department:')) {
    return user.role === 'superadmin' || share.slice('department:'.length) === user.departmentId
  }
  if (share.startsWith('canvas:')) return canEditCanvas(share.slice('canvas:'.length), user)
  return false
}

/**
 * 桌面根是否展示某共享区。与 canSeeShare（访问权限）区分：
 * 桌面只显示本人真正所属的部门区，超管不再无脑看到所有部门文件夹（避免串桌面）。
 * 超管仍可通过磁盘面板管理任意部门区。
 */
function showShareOnDesktop(user: { role: string; departmentId: string | null }, share: string) {
  if (share === 'public') return true
  if (share.startsWith('department:')) return share.slice('department:'.length) === user.departmentId
  return false
}

/** 文件访问检查：私人文件只有本人（无主历史文件放行）；共享区按区规则。 */
function ownedNode(req: express.Request, res: express.Response, id: string) {
  const node = getNode(id)
  if (!node) { fail(res, '节点不存在', 404); return null }
  if (!canReadNode(req.auth!.user, node)) { fail(res, '没有该文件的权限', 403); return null }
  return node
}

function ownedTrashNode(req: express.Request, res: express.Response, id: string) {
  const node = getNode(id)
  if (!node) { fail(res, '节点不存在', 404); return null }
  if (node.ownerId !== req.auth!.user.id) { fail(res, '没有该文件的权限', 403); return null }
  return node
}

function canReadNode(user: { id: string; role: string; departmentId: string | null }, node: NonNullable<ReturnType<typeof getNode>>) {
  if (isInTrash(node.id)) return false
  const share = node.share || shareZoneOf(node.id)
  if (share) {
    return canSeeShare(user, share)
  }
  return !node.ownerId || node.ownerId === user.id
}

app.get('/api/fs', (req, res) => {
  try {
    ensureUserFolder('文稿', req.auth!.user.id)
    ensureCanvasRoot(req.auth!.user.id)
    ensurePublicRoot()
    const parentId = parentParam(req.query.parent)
    if (parentId && isInTrash(parentId)) return fail(res, '文件夹已在废纸篓中', 410)
    if (parentId && !ownedNode(req, res, parentId)) return
    const listing = listChildren(parentId)
    const user = req.auth!.user
    // 桌面根：本人私有文件 + 对自己可见的共享区；共享区内部：全部可见
    const insideShare = parentId ? shareZoneOf(parentId) : null
    const nodes = insideShare
      ? listing.nodes
      : listing.nodes.filter((node) =>
          node.ownerId === user.id || (!!node.share && showShareOnDesktop(user, node.share)))
    ok(res, { ...listing, nodes })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.get('/api/fs/locations', (req, res) => {
  try {
    const user = req.auth!.user
    const systemRoot = ensureSystemRoot()
    const documents = ensureUserFolder('文稿', user.id)
    const project = ensureCanvasRoot(user.id)
    const assistantCache = ensureUserFolder('助理缓存', user.id)
    const publicRoot = ensurePublicRoot()
    const visibleShares = listChildren(systemRoot.id).nodes
      .filter((node) => node.type === 'folder' && node.share && showShareOnDesktop(user, node.share))
      .map((node) => ({
        id: node.id,
        name: node.name,
        kind: node.share === 'public' ? 'public' : 'shared',
      }))
    const hasPublic = visibleShares.some((item) => item.id === publicRoot.id)
    ok(res, {
      locations: [
        { id: null, name: '桌面', kind: 'desktop' },
        { id: documents.id, name: documents.name, kind: 'documents' },
        { id: project.id, name: project.name, kind: 'project' },
        { id: assistantCache.id, name: assistantCache.name, kind: 'assistant-cache' },
        ...(hasPublic ? [] : [{ id: publicRoot.id, name: publicRoot.name, kind: 'public' }]),
        ...visibleShares,
      ],
    })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.get('/api/fs/storage', requireSuperAdmin, (_req, res) => {
  const users = Object.fromEntries(listAuthUsers().map((user) => [user.id, user.username]))
  ok(res, { storage: storageReport(users) })
})

// 磁盘面板下钻：超管浏览任意目录（跨账号/共享区）以管理删除
app.get('/api/fs/storage/children', requireSuperAdmin, (req, res) => {
  try {
    const parentId = parentParam(req.query.parent)
    const users = Object.fromEntries(listAuthUsers().map((user) => [user.id, user.username]))
    if (!parentId) return ok(res, { path: [{ id: null, name: '桌面' }], items: storageReport(users).rootItems })
    const node = getNode(parentId)
    if (!node || node.type !== 'folder') return fail(res, '目录不存在', 404)
    ok(res, storageChildren(parentId, users))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/fs/storage/delete', requireSuperAdmin, (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
    let removed = 0
    for (const id of ids) {
      const node = getNode(id)
      if (!node || node.system) continue
      deleteCanvasesForProjectRoot(id)
      removed += purgeNode(id)
    }
    emitFsEvent('changed')
    ok(res, { removed })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.get('/api/fs/node/:id', (req, res) => {
  const node = ownedNode(req, res, req.params.id)
  if (node) ok(res, { node })
})

app.get('/api/fs/count/:id', (req, res) => { if (ownedNode(req, res, req.params.id)) ok(res, { count: countSubtree(req.params.id) }) })

app.post('/api/fs', (req, res) => {
  try {
    const b = req.body || {}
    const parentId = parentParam(b.parentId)
    if (parentId && !ownedNode(req, res, parentId)) return
    const node = createNode({ name: b.name, type: b.type, parentId, content: b.content, ownerId: req.auth!.user.id })
    emitFsEvent('changed')
    ok(res, { node })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.patch('/api/fs/:id', (req, res) => {
  try {
    const b = req.body || {}
    let node = ownedNode(req, res, req.params.id)
    if (!node) return
    if (node.system && (typeof b.name === 'string' || b.parentId !== undefined)) return fail(res, '系统共享文件夹不能重命名或移动', 403)
    // M8 乐观并发：调用方带上读取时的 baseUpdatedTs，其他人已改过则拒绝静默覆盖
    if (typeof b.content === 'string' && b.baseUpdatedTs !== undefined && Number(b.baseUpdatedTs) !== node.updated_ts) {
      return fail(res, '文件已被其他人修改，请刷新查看最新内容后再保存', 409)
    }
    if (typeof b.name === 'string') node = renameNode(req.params.id, b.name)
    if (typeof b.content === 'string') node = setContent(req.params.id, b.content)
    if (b.parentId !== undefined) { const parentId = parentParam(b.parentId); if (parentId && !ownedNode(req, res, parentId)) return; node = moveNode(req.params.id, parentId) }
    emitFsEvent('changed')
    ok(res, { node })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.delete('/api/fs/:id', (req, res) => {
  try {
    const node = ownedNode(req, res, req.params.id)
    if (!node) return
    if (node.system) return fail(res, '系统共享文件夹不能删除', 403)
    // 默认软删除（移入废纸篓）；?purge=1 才彻底删除
    if (req.query.purge) deleteCanvasesForProjectRoot(req.params.id)
    const removed = req.query.purge ? purgeNode(req.params.id) : removeNode(req.params.id)
    emitFsEvent('changed')
    ok(res, { removed })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 废纸篓 ────────────────────────────────────────────────────────────
app.get('/api/fs/trash', (req, res) => ok(res, { items: listTrash().filter((item) => getNode(item.id)?.ownerId === req.auth!.user.id) }))
app.post('/api/fs/trash/:id/restore', (req, res) => {
  if (!ownedTrashNode(req, res, req.params.id)) return
  const node = restoreNode(req.params.id)
  if (node) emitFsEvent('changed')
  return node ? ok(res, { node }) : fail(res, '废纸篓里没有该项', 404)
})
app.delete('/api/fs/trash/:id', (req, res) => {
  if (!ownedTrashNode(req, res, req.params.id)) return
  deleteCanvasesForProjectRoot(req.params.id)
  const removed = purgeNode(req.params.id)
  emitFsEvent('changed')
  ok(res, { removed })
})
app.post('/api/fs/trash/empty', (req, res) => {
  const owned = listTrash().filter((item) => getNode(item.id)?.ownerId === req.auth!.user.id)
  const removed = owned.reduce((count, item) => {
    deleteCanvasesForProjectRoot(item.id)
    return count + purgeNode(item.id)
  }, 0)
  emitFsEvent('changed')
  ok(res, { removed })
})

// ── 复制节点（文件夹递归）到目标目录 ─────────────────────────────────
app.post('/api/fs/copy', (req, res) => {
  try {
    const b = req.body || {}
    if (!ownedNode(req, res, String(b.id))) return
    const parentId = parentParam(b.parentId)
    if (parentId && !ownedNode(req, res, parentId)) return
    const node = copyNode(String(b.id), parentId)
    emitFsEvent('changed')
    ok(res, { node })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 多选打包下载（zip）────────────────────────────────────────────────
app.post('/api/fs/download-zip', (req, res) => {
  try {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
    if (!ids.length) return fail(res, '没有选中项')
    if (ids.some((id) => !ownedNode(req, res, id))) return
    const entries = collectZipEntries(ids)
    if (!entries.length) return fail(res, '没有可下载的文件')
    const buf = buildZip(entries)
    const filename = String(req.body?.filename || 'download.zip')
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.send(buf)
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 搜索（子树内按名+内容）────────────────────────────────────────────
app.post('/api/fs/search', (req, res) => {
  try {
    const b = req.body || {}
    const mode = String(b.mode || 'both')
    const rootId = parentParam(b.rootId)
    if (!rootId || !ownedNode(req, res, rootId)) return
    const hits = searchNodes(rootId, String(b.query || ''), {
      name: mode !== 'content',
      content: mode !== 'name',
      limit: Number(b.limit) || 50,
    })
    ok(res, { hits })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 目录树（子树先序遍历）────────────────────────────────────────────
app.get('/api/fs/tree', (req, res) => {
  try {
    const depth = Number(req.query.depth) || 5
    const root = parentParam(req.query.root)
    if (!root || !ownedNode(req, res, root)) return
    ok(res, { rows: subtree(root, depth) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 上传文件（图片/视频/音频/文档等，二进制存 blob）──────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })
// 0.2.6 briefly streamed file-system uploads through DATA_ROOT/upload-spool.
// On some Windows storage/sync/security configurations multer completed with a
// zero-byte spool file, which was then adopted as a successful blob. Keep the
// proven 0.2.5 memory path until a bounded spill-to-disk engine can verify every
// byte before committing it. The 200 MB cap prevents unbounded single-file use.
const fsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 30 },
})

app.get('/api/preferences/wallpaper', (req, res) => {
  try { ok(res, getWallpaperPreferences(req.auth!.user.id)) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/preferences/system-interface', (_req, res) => {
  try { ok(res, getSystemInterfacePreferences()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.put('/api/preferences/system-interface', (req, res) => {
  if (!['admin', 'superadmin'].includes(req.auth!.user.role)) return fail(res, '需要管理员权限', 403)
  try {
    const patch: { simpleMode?: boolean; simpleShowSystemApps?: boolean } = {}
    if (typeof req.body?.simpleMode === 'boolean') patch.simpleMode = req.body.simpleMode
    if (typeof req.body?.simpleShowSystemApps === 'boolean') patch.simpleShowSystemApps = req.body.simpleShowSystemApps
    ok(res, setSystemInterfacePreferences(req.auth!.user.id, patch))
  }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/preferences/apps', (req, res) => {
  try { ok(res, { appIds: installedApps(req.auth!.user.id), apps: installedAppRecords(req.auth!.user.id) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/preferences/apps/migrate', (req, res) => {
  try {
    const legacy = Array.isArray(req.body?.appIds) ? req.body.appIds : []
    const installedPackages = listDeveloperApps().map((app) => app.id)
    ok(res, { appIds: migrateInstalledApps(req.auth!.user.id, legacy, installedPackages) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.put('/api/preferences/apps/:appId', (req, res) => {
  try { ok(res, { appIds: setAppInstalled(req.auth!.user.id, String(req.params.appId), req.body?.installed !== false, req.body || {}) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/preferences/wallpapers', upload.array('files', 12), (req, res) => {
  try {
    const wallpapers = addWallpapers(req.auth!.user.id, (req.files as Express.Multer.File[] | undefined) || [])
    ok(res, { wallpapers })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.put('/api/preferences/wallpaper', (req, res) => {
  try { selectWallpaper(req.auth!.user.id, String(req.body?.activeId || 'system-default')); ok(res, {}) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/preferences/wallpapers/:id', (req, res) => {
  try { removeWallpaper(req.auth!.user.id, req.params.id); ok(res, {}) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.get('/api/preferences/wallpapers/:id/file', (req, res) => {
  try {
    const file = wallpaperPath(req.auth!.user.id, req.params.id)
    res.type(file.mime).sendFile(file.path)
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})

app.post('/api/video/media/probe', upload.single('media'), async (req, res) => {
  if (!req.file) return fail(res, '请上传要探测的媒体文件')
  try {
    const probe = await probeMediaBuffer(req.file.buffer, req.file.originalname, req.file.mimetype)
    ok(res, { probe })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/video/assets', upload.single('media'), async (req, res) => {
  if (!req.file) return fail(res, '请上传视频素材')
  try {
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const probe = await probeUploadedAsset(req.file.buffer, originalName, req.file.mimetype)
    const asset = saveVideoAsset({
      projectId: String(req.body?.projectId || ''), ownerId: req.auth!.user.id,
      projectName: String(req.body?.projectName || ''), name: originalName,
      mime: req.file.mimetype, buffer: req.file.buffer, probe,
    })
    ok(res, { asset })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.get('/api/video/projects/:projectId/assets', (req, res) => {
  try {
    ok(res, { assets: listVideoAssetRows(req.params.projectId, req.auth!.user.id).map(videoAssetView) })
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})

app.delete('/api/video/assets/:id', (req, res) => {
  try { ok(res, { deleted: deleteVideoAsset(req.params.id, req.auth!.user.id) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})

app.post('/api/video/render-jobs', (req, res) => {
  try {
    const job = createVideoRenderJob({
      projectId: String(req.body?.projectId || ''), ownerId: req.auth!.user.id,
      projectName: String(req.body?.projectName || ''), timeline: req.body?.timeline,
    })
    ok(res, { job: publicVideoRenderJob(job) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.get('/api/video/render-jobs/:id', (req, res) => {
  const job = getVideoRenderJob(req.params.id, req.auth!.user.id)
  if (!job) return fail(res, '渲染任务不存在', 404)
  ok(res, { job: publicVideoRenderJob(job) })
})

app.post('/api/video/render-jobs/:id/cancel', (req, res) => {
  try { ok(res, { job: publicVideoRenderJob(cancelVideoRenderJob(req.params.id, req.auth!.user.id)) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})

app.get('/api/video/render-jobs/:id/file', (req, res) => {
  const job = getVideoRenderJob(req.params.id, req.auth!.user.id)
  if (!job?.output_path || job.status !== 'completed' || !existsSync(job.output_path)) return fail(res, '成片尚未就绪', 404)
  res.download(job.output_path, `${req.params.id}.mp4`)
})

app.get('/api/photos/background-removal/models', async (_req, res) => {
  try {
    ok(res, { models: await backgroundRemovalStatus() })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/photos/background-removal/models/:id/download', async (req, res) => {
  try {
    ok(res, { model: await downloadBackgroundRemovalModel(String(req.params.id || '')) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/photos/background-removal', upload.single('image'), async (req, res) => {
  if (!req.file) return fail(res, '请上传要抠图的图片')
  try {
    const output = await removeImageBackground(req.file.buffer, String(req.body?.model || ''))
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Length', String(output.length))
    res.send(output)
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/providers/test-video', upload.fields([
  { name: 'image', maxCount: 9 },
  { name: 'video', maxCount: 3 },
  { name: 'audio', maxCount: 3 },
]), async (req, res) => {
  if (isJimengCliRequest(req.body || {})) {
    const model = String(req.body?.model || 'seedance2.0fast').trim()
    const prompt = String(req.body?.prompt || '').trim() || '让画面中的主体自然地向镜头移动，保持画面稳定'
    const files = (req.files || {}) as Record<string, Express.Multer.File[]>
    const imagePath = files.image?.[0] ? tempMediaFile(files.image[0].buffer, files.image[0].mimetype || 'image/png', '.png') : undefined
    const started = Date.now()
    try {
      const r = await generateJimengVideo(prompt, model, {
        imagePath,
        duration: Number(req.body?.duration) || 5,
        aspect_ratio: String(req.body?.aspect_ratio || req.body?.size || '16:9'),
        resolution: String(req.body?.resolution || '720p'),
      })
      return ok(res, { videos: r.videos, latencyMs: Date.now() - started, raw: r.raw, submit_id: r.submit_id })
    } catch (e) {
      return fail(res, String((e as Error).message || e))
    }
  }
  const baseProvider = resolveFromBody(req.body || {})
  if (!baseProvider) return fail(res, '缺少 base_url')
  if (!baseProvider.api_key && !(baseProvider.protocol === 'runninghub' && baseProvider.wallet_api_key)) return fail(res, '缺少 API Key')
  const provider = resolveModelProtocol(req.body || {}, baseProvider)
  const model = String(req.body?.model || '').trim()
  if (!model) return fail(res, '请先选择或填写一个视频模型')
  const prompt = String(req.body?.prompt || '').trim() || '让画面中的主体自然地向镜头移动，保持画面稳定'
  const files = (req.files || {}) as Record<string, Express.Multer.File[]>
  const media = (kind: GenVideoReference['kind'], field: string): GenVideoReference[] =>
    (files[field] || []).map((file) => ({
      kind,
      buf: file.buffer,
      mime: file.mimetype || `${kind}/*`,
      name: file.originalname || `input.${kind}`,
    }))
  const images = media('image', 'image')
  const videos = media('video', 'video')
  const audios = media('audio', 'audio')
  const started = Date.now()
  try {
    const r = await generateVideos(provider, model, {
      prompt,
      duration: Number(req.body?.duration) || 5,
      size: String(req.body?.size || ''),
      aspect_ratio: String(req.body?.aspect_ratio || req.body?.size || '16:9'),
      resolution: String(req.body?.resolution || ''),
      images,
      videos,
      audios,
      generate_audio: String(req.body?.generate_audio || '').toLowerCase() === 'true',
    }, undefined, 900000)
    ok(res, { videos: r.videos.map((video) => video.value), latencyMs: Date.now() - started })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/providers/test-audio', async (req, res) => {
  const baseProvider = resolveFromBody(req.body || {})
  if (!baseProvider) return fail(res, '缺少 base_url')
  if (!baseProvider.api_key) return fail(res, '缺少 API Key')
  const provider = resolveModelProtocol(req.body || {}, baseProvider)
  const model = String(req.body?.model || '').trim()
  if (!model) return fail(res, '请先选择音频模型')
  const started = Date.now()
  try {
    const result = await generateSpeech(provider, model, { input: String(req.body?.prompt || '你好，这是音频模型测试。'), voice: 'alloy', response_format: 'mp3' })
    ok(res, { audio: `data:${result.mime};base64,${result.data.toString('base64')}`, latencyMs: Date.now() - started })
  } catch (error) {
    fail(res, String((error as Error).message || error))
  }
})

app.post('/api/providers/test-vision', upload.single('image'), async (req, res) => {
  const provider = resolveFromBody(req.body || {})
  if (!provider) return fail(res, '缺少 base_url')
  if (!provider.api_key && !(provider.protocol === 'runninghub' && provider.wallet_api_key)) return fail(res, '缺少 API Key')
  const model = String(req.body?.model || '').trim()
  if (!model) return fail(res, '请先选择或填写一个视觉模型')
  if (!req.file) return fail(res, '请先上传一张图片')
  const prompt = String(req.body?.prompt || '').trim() || '请用中文简要描述这张图片。'
  const dataUrl = `data:${req.file.mimetype || 'image/png'};base64,${req.file.buffer.toString('base64')}`
  const started = Date.now()
  try {
    const text = await describeImage(provider, model, dataUrl, prompt, 120000)
    ok(res, { text, latencyMs: Date.now() - started })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/ai-image-declaration/process', upload.array('files', 30), async (req, res) => {
  try {
    const files = ((req.files as Express.Multer.File[]) || []).map((file) => ({
      name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      data: file.buffer,
    }))
    const result = await processDeclarationUpload(files)
    res.setHeader('Content-Type', result.mime)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
    res.setHeader('X-Image-Count', String(result.imageCount))
    res.send(result.data)
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/fs/upload', fsUpload.array('files', 30), (req, res) => {
  const files = (req.files as Express.Multer.File[]) || []
  try {
    let parentId = parentParam((req.body || {}).parentId)
    if (parentId) {
      const parent = getNode(parentId)
      if (!parent || !canReadNode(req.auth!.user, parent)) {
        const canvasId = String((req.body || {}).canvasId || '').trim()
        if (!canvasId || !canEditCanvas(canvasId, req.auth!.user)) return fail(res, '不能向该项目文件夹上传文件', 403)
        // 协作者不能写入画布所有者的项目目录。把本轮素材存到协作者
        // 自己的持久目录，画布文档仍通过稳定 nodeId 引用它。
        const ownCanvasRoot = ensureCanvasRoot(req.auth!.user.id)
        const sharedAssetsRoot = ensureFolder('共享画布素材', ownCanvasRoot.id, req.auth!.user.id)
        parentId = ensureFolder(`画布-${canvasId}`, sharedAssetsRoot, req.auth!.user.id)
      }
    }
    if (!files.length) return fail(res, '没有文件')
    const nodes: ReturnType<typeof createNode>[] = []
    try {
      for (const f of files) {
        // multer 的 originalname 是 latin1，非 ASCII 文件名需转回 utf8
        const name = Buffer.from(f.originalname, 'latin1').toString('utf8')
        const extension = extname(name).toLowerCase()
        const inferredMime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif', '.tif': 'image/tiff', '.tiff': 'image/tiff' } as Record<string, string>)[extension]
        const mime = !f.mimetype || f.mimetype === 'application/octet-stream' ? inferredMime || f.mimetype || 'application/octet-stream' : f.mimetype
        if (!Buffer.isBuffer(f.buffer) || f.buffer.length !== f.size) {
          throw new Error(`文件上传不完整：${name}（收到 ${f.buffer?.length || 0} / ${f.size || 0} 字节）`)
        }
        if (mime.startsWith('image/') && f.buffer.length === 0) throw new Error(`图片内容为空：${name}`)
        const node = createNode({ name, type: 'file', parentId, mime, size: f.size, ownerId: req.auth!.user.id })
        nodes.push(node)
        saveBlob(node.id, f.buffer)
        const storedSize = statSync(blobPath(node.id)).size
        if (storedSize !== f.size) throw new Error(`文件保存不完整：${name}（写入 ${storedSize} / ${f.size} 字节）`)
      }
    } catch (error) {
      for (const node of nodes) purgeNode(node.id)
      throw error
    }
    emitFsEvent('changed')
    ok(res, { nodes })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 读取文件内容（图片/视频预览、下载、文本读取）─────────────────────
const fsThumbnailJobs = new Map<string, Promise<void>>()
let fsThumbnailActive = 0
const fsThumbnailWaiters: Array<() => void> = []
async function withFsThumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
  if (fsThumbnailActive >= 2) await new Promise<void>((resolve) => fsThumbnailWaiters.push(resolve))
  fsThumbnailActive += 1
  try { return await task() }
  finally {
    fsThumbnailActive -= 1
    fsThumbnailWaiters.shift()?.()
  }
}
app.get('/api/fs/thumbnail/:id', async (req, res) => {
  const node = getNode(req.params.id)
  if (!node) return fail(res, '节点不存在', 404)
  const trashPreview = isInTrash(node.id) && req.query.trash === '1' && node.ownerId === req.auth!.user.id
  if (isInTrash(node.id) && !trashPreview) return fail(res, '文件已在废纸篓中', 410)
  const canvasId = String(req.query.canvasId || '').trim() || undefined
  const allowed = trashPreview || canReadNode(req.auth!.user, node) || canViewCanvasMedia(node.id, req.auth!.user, canvasId)
  if (!allowed) return fail(res, '没有该文件的权限', 403)
  if (node.type !== 'file' || !String(node.mime || '').startsWith('image/') || !hasBlob(node.id)) return fail(res, '节点不是可预览图片', 400)
  try {
    // 图库卡片只需要很小的解码面；默认 640px 保持画布等既有调用的清晰度。
    const size = req.query.size === '256' ? 256 : 640
    const storageSize = size === 640 ? undefined : size
    const jobKey = `${node.id}:${size}`
    if (!hasThumbnail(node.id, storageSize)) {
      let job = fsThumbnailJobs.get(jobKey)
      if (!job) {
        job = withFsThumbnailSlot(async () => {
          const source = readBlob(node.id)
          if (!source) throw new Error('图片内容不存在')
          const thumbnail = await sharp(source, { animated: false, limitInputPixels: 268_402_689 })
            .rotate()
            .resize(size === 256
              ? { width: size, height: size, fit: 'cover', position: 'centre', withoutEnlargement: true }
              : { width: size, height: size, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: size === 256 ? 68 : 74, mozjpeg: true })
            .toBuffer()
          saveThumbnail(node.id, thumbnail, storageSize)
        }).finally(() => fsThumbnailJobs.delete(jobKey))
        fsThumbnailJobs.set(jobKey, job)
      }
      await job
    }
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    return res.sendFile(thumbnailPath(node.id, storageSize))
  } catch (error) {
    return fail(res, String((error as Error).message || error), 500)
  }
})

app.get('/api/fs/raw/:id', (req, res) => {
  const node = getNode(req.params.id)
  if (!node) return fail(res, '节点不存在', 404)
  const trashPreview = isInTrash(node.id) && req.query.trash === '1' && node.ownerId === req.auth!.user.id
  if (isInTrash(node.id) && !trashPreview) return fail(res, '文件已在废纸篓中', 410)
  const canvasId = String(req.query.canvasId || '').trim() || undefined
  const allowed = trashPreview || canReadNode(req.auth!.user, node) || canViewCanvasMedia(node.id, req.auth!.user, canvasId)
  if (!allowed) return fail(res, '没有该文件的权限', 403)
  if (node.type !== 'file') return fail(res, '节点不是文件', 400)
  if (req.query.download) {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(node.name)}`)
  }
  if (hasBlob(node.id)) {
    res.setHeader('Content-Type', node.mime || 'application/octet-stream')
    if (!req.query.download) res.setHeader('Cache-Control', 'private, max-age=604800, stale-while-revalidate=2592000')
    return res.sendFile(blobPath(node.id))
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(node.content ?? '')
})

app.get('/api/local/download', (req, res) => {
  const file = String(req.query.path || '').trim()
  if (!file) return fail(res, '缺少文件路径')
  const abs = resolve(file)
  if (!isInsideWorkspace(abs)) return fail(res, '只能下载当前工作区内的文件', 403)
  if (!fsExistsSync(abs)) return fail(res, '文件不存在', 404)
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(basename(abs))}`)
  res.sendFile(abs)
})

app.post('/api/local/write-text', (req, res) => {
  try {
    const file = String(req.body?.path || '').trim()
    const content = String(req.body?.content || '')
    if (!file) return fail(res, '缺少文件路径')
    const abs = resolve(file)
    if (!isInsideWorkspace(abs)) return fail(res, '只能写入当前工作区内的文件', 403)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf-8')
    ok(res, { path: abs })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/local/close-illustrator', (_req, res) => {
  try {
    if (process.platform !== 'win32') return fail(res, '当前关闭 Illustrator 只支持 Windows', 400)
    const result = spawnSync('taskkill', ['/IM', 'Illustrator.exe', '/T', '/F'], {
      encoding: 'utf-8',
      windowsHide: true,
    })
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    if (result.status && !/not found|没有找到|找不到/i.test(output)) {
      return fail(res, output || '关闭 Illustrator 失败', 500)
    }
    ok(res, { closed: true, output })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/fs/:id/claim', requireSuperAdmin, (req, res) => {
  try {
    const ownerId = String(req.body?.ownerId || req.auth!.user.id)
    const claimed = claimNodeOwner(req.params.id, ownerId)
    emitFsEvent('changed')
    ok(res, { claimed })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

// ── 项目任务 Harness（M1 / M2）──────────────────────────────────────
// 项目绑定现有虚拟文件夹；任务状态和执行历史以 ccs.db 为准。
function projectActor(req: express.Request, res: express.Response) {
  const auth = getAuth(req)
  if (!auth) { fail(res, '请先登录', 401); return null }
  req.auth = auth // M8：共享分支与 ensureShareMembership 依赖 req.auth（此前仅 /api/fs 中间件会挂载）
  return auth.user.id
}
/** M8：共享区（公共/部门）内的项目，区内可见成员自动成为项目成员。 */
function ensureShareMembership(projectId: string, rootNodeId: string, req: express.Request) {
  const share = shareZoneOf(rootNodeId)
  if (share && canSeeShare(req.auth!.user, share)) ensureProjectMember(projectId, req.auth!.user.id)
}
app.get('/api/harness/health', (req, res) => {
  const userId = projectActor(req, res)
  if (userId) ok(res, { api: true, database: true, ...workerHealth() })
})
app.get('/api/projects', (req, res) => {
  const userId = projectActor(req, res)
  if (userId) ok(res, { projects: listProjects(userId) })
})
// 助理 APP 的私人工作区：聊天附件、图片编辑输入与生成结果都落在这里。
function assistantWorkspace(userId: string) {
  const root = ensureUserFolder('助理空间', userId)
  const project = projectForRoot(root.id) || createProject({ name: '在线助理', rootNodeId: root.id, createdBy: userId })
  return { root, project }
}
app.post('/api/assistant/bootstrap', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const { root, project } = assistantWorkspace(userId)
    ok(res, { root, ...projectHistory(project.id, userId) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.put('/api/assistant/conversations/:threadId', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const { project } = assistantWorkspace(userId)
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : []
    const thread = syncAssistantConversation({
      projectId: project.id,
      createdBy: userId,
      threadId: req.params.threadId,
      title: String(req.body?.title || '新对话'),
      createdAt: Number(req.body?.createdAt) || undefined,
      messages,
    })
    ok(res, { thread })
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})

app.delete('/api/assistant/conversations/:threadId', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const { project } = assistantWorkspace(userId)
    const removed = deleteAssistantConversation(project.id, userId, req.params.threadId)
    const folder = assistantConversationFolder(userId, req.params.threadId, false)
    if (folder) purgeNode(folder.id)
    ok(res, { removed })
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})

function assistantConversationFolder(userId: string, rawThreadId: string, create = true) {
  const threadId = String(rawThreadId || '').trim()
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(threadId)) throw new Error('对话 ID 无效')
  const cacheRoot = ensureUserFolder('助理缓存', userId)
  const name = `chat-${threadId}`
  const existing = listChildren(cacheRoot.id).nodes.find((node) => node.type === 'folder' && node.name === name)
  if (existing || !create) return existing || null
  return getNode(ensureFolder(name, cacheRoot.id, userId))
}

app.post('/api/assistant/conversations/:threadId/cache', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    ok(res, { folder: assistantConversationFolder(userId, req.params.threadId) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.delete('/api/assistant/conversations/:threadId/cache', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const folder = assistantConversationFolder(userId, req.params.threadId, false)
    ok(res, { removed: folder ? purgeNode(folder.id) : 0 })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/projects', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const rootNodeId = String(req.body?.rootNodeId || '')
    const root = getNode(rootNodeId)
    if (!root || root.type !== 'folder') return fail(res, '项目必须绑定一个存在的文件夹')
    const share = root.share || shareZoneOf(root.id)
    if (share) {
      // 共享区文件夹：区内可见成员都可以建立/加入项目
      if (root.system) return fail(res, '共享区根目录不能直接作为项目，请在里面创建一个项目文件夹', 400)
      if (!canSeeShare(req.auth!.user, share)) return fail(res, '没有该共享区的权限', 403)
      const existing = projectForRoot(rootNodeId)
      if (existing) {
        ensureProjectMember(existing.id, userId)
        return ok(res, { project: existing })
      }
      return ok(res, { project: createProject({ name: String(req.body?.name || root.name), rootNodeId, createdBy: userId }) })
    }
    if (root.ownerId && root.ownerId !== userId) return fail(res, '只能把自己的文件夹建立为项目', 403)
    if (!root.ownerId) claimNodeOwner(root.id, userId)
    ok(res, { project: createProject({ name: String(req.body?.name || root.name), rootNodeId, createdBy: userId }) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/projects/by-root/:rootNodeId', (req, res) => {
  const userId = projectActor(req, res)
  if (!userId) return
  const project = projectForRoot(req.params.rootNodeId)
  if (!project) return fail(res, '该文件夹尚未建立项目', 404)
  ensureShareMembership(project.id, project.root_node_id, req)
  try { requireProjectAccess(project.id, userId); ok(res, { project }) } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.get('/api/projects/:id/history', (req, res) => {
  const userId = projectActor(req, res)
  if (!userId) return
  recoverExpiredTasks()
  try {
    const history = projectHistory(req.params.id, userId)
    if (!history.project) return fail(res, '项目不存在', 404)
    ok(res, history)
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.post('/api/projects/:id/threads', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    if (!getProject(req.params.id)) return fail(res, '项目不存在', 404)
    requireProjectAccess(req.params.id, userId, true)
    // M8：共享项目里可以创建私人对话（默认项目可见）；私人对话不会出现在其他成员的历史里
    const visibility = req.body?.visibility === 'private' ? 'private' : 'project'
    ok(res, { thread: createThread(req.params.id, String(req.body?.title || '新对话'), userId, visibility) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/projects/:id/tasks', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const instruction = String(req.body?.instruction || '').trim()
    if (!instruction) return fail(res, '任务说明不能为空')
    const task = createProjectTask({
      projectId: req.params.id,
      createdBy: userId,
      threadId: req.body?.threadId ? String(req.body.threadId) : undefined,
      title: req.body?.title ? String(req.body.title) : undefined,
      instruction,
      actions: req.body?.actions,
    })
    ok(res, { task })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/projects/:id/tasks/import-legacy', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    ok(res, { task: importLegacyTask(req.params.id, userId, req.body || {}) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
// 对话/执行分流：Agent 读用户这句话，自己判断是「直接回答」还是「要动手 → 起后台任务」。
// 前端只有一个输入框，用户不用选模式。answer=纯问答（已写入对话历史）；task=已创建后台任务。
app.post('/api/projects/:id/converse', async (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const project = getProject(req.params.id)
    if (!project) return fail(res, '项目不存在', 404)
    ensureShareMembership(project.id, project.root_node_id, req)
    requireProjectAccess(project.id, userId, true)
    const message = String(req.body?.message || '').trim()
    if (!message) return fail(res, '消息不能为空')
    const threadId = req.body?.threadId ? String(req.body.threadId) : undefined
    const requestedMode = String(req.body?.mode || 'assistant')
    // 兼容旧客户端/本地偏好中的 expert：原专家能力已合并到思考模式。
    const mode: AssistantMode = requestedMode === 'thinking' || requestedMode === 'expert' ? 'thinking' : 'assistant'
    const preferences = {
      providerId: String(req.body?.preferences?.providerId || '').trim() || undefined,
      llmModel: String(req.body?.preferences?.llmModel || '').trim() || undefined,
      imageProviderId: String(req.body?.preferences?.imageProviderId || '').trim() || undefined,
      imageModel: String(req.body?.preferences?.imageModel || '').trim() || undefined,
    }
    const llm = pickLlm(preferences)
    if (!llm) return fail(res, '没有可用的模型站点：请在「API 设置」中启用一个带 LLM 模型的站点')

    const history = threadId ? threadMessages(project.id, userId, threadId) : []
    if (assistantExecutionLane(mode) === 'direct') {
      const direct = await runAssistantDirect(project, req.auth!.user, message, history, preferences)
      const rec = recordConversation({ projectId: project.id, createdBy: userId, threadId, userText: message, assistantText: direct.text })
      return ok(res, {
        kind: 'answer', text: direct.text, threadId: rec.threadId,
        filesChanged: direct.filesChanged, continuationRequired: 'continuationRequired' in direct && direct.continuationRequired === true,
      })
    }

    const READ = new Set(['fs_list', 'fs_read'])
    const startTaskTool = {
      type: 'function',
      function: {
        name: 'start_task',
        description: '当用户的请求需要创建/修改/生成/删除文件，或需要识别/处理项目内图片、视频、音频时，调用执行 Agent。纯文本问答/解释/闲聊不要调用。',
        parameters: { type: 'object', properties: { instruction: { type: 'string', description: '交给执行 Agent 的完整、明确的任务说明' } }, required: ['instruction'] },
      },
    }
    const tools = [...fsToolSchemas(READ), startTaskTool]
    const modeHint = '当前是思考模式：需要动手时创建持久化后台任务，先规划，再跟踪进度、处理失败并严格验证交付物。'
    const system = `你是 DX OS 项目「${project.name}」的助理。${modeHint}\n用户发来一条消息，你要自己判断如何回应：\n`
      + `- 若是可以直接回答的纯文本问题、解释、闲聊（介绍项目、说明文本文件内容、给建议等）→ 直接用中文回答；需要时先用 fs_list/fs_read 查看文本内容再回答。\n`
      + `- 图片、视频、音频不能用 fs_read 解析；用户要求识别或处理项目内媒体时必须调用 start_task，由执行 Agent 调用对应 Skill，不能要求用户重复上传。\n`
      + `- 若需要动手创建/修改/生成/删除文件才能完成 → 调用 start_task 交给后台执行，不要自己假装已完成、也不要在回答里写出应当落地成文件的内容。\n`
      + `一条消息只做其一。回答简洁自然。`
    const messages: ToolMessage[] = [
      ...history
        .filter((item) => item.role === 'user' || item.role === 'assistant')
        .map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })),
      { role: 'user', content: message },
    ]

    for (let round = 0; round < 6; round++) {
      const r = await chatWithTools(llm.provider, llm.model, messages, system, tools, 120_000)
      const startCall = r.toolCalls.find((c) => c.name === 'start_task')
      if (startCall) {
        let instruction = message
        try { instruction = String((JSON.parse(startCall.arguments || '{}') as { instruction?: string }).instruction || message) } catch { /* 用原消息兜底 */ }
        const task = createProjectTask({ projectId: project.id, createdBy: userId, threadId, instruction, executionProfile: mode, preferences })
        return ok(res, { kind: 'task', task })
      }
      if (!r.toolCalls.length) {
        const text = r.content?.trim() || '（没有得到回答）'
        const rec = recordConversation({ projectId: project.id, createdBy: userId, threadId, userText: message, assistantText: text })
        return ok(res, { kind: 'answer', text, threadId: rec.threadId })
      }
      // 有读工具调用：执行后回灌观察，继续让模型判断
      messages.push({ role: 'assistant', content: r.content || '', tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) })
      for (const call of r.toolCalls) {
        let obs = ''
        if (READ.has(call.name)) {
          try {
            const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>
            const out = runFsTool(call.name, { rootNodeId: project.root_node_id, userId }, args, READ)
            obs = [out.message, out.content?.slice(0, 4000), out.entries?.map((e) => `${e.type === 'folder' ? '文件夹' : '文件'} ${e.name}`).join('\n')].filter(Boolean).join('\n') || '(空)'
          } catch (e) { obs = '读取失败：' + String((e as Error).message || e) }
        } else {
          obs = '该操作在对话模式不可用；要动手改文件请调用 start_task。'
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: obs.slice(0, 6000) })
      }
    }
    // 兜底：多轮仍未收敛，落一句提示到对话历史
    const rec = recordConversation({ projectId: project.id, createdBy: userId, threadId, userText: message, assistantText: '我需要更明确的说明才能回答或动手，请补充一下细节。' })
    ok(res, { kind: 'answer', text: '我需要更明确的说明才能回答或动手，请补充一下细节。', threadId: rec.threadId })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/tasks', (req, res) => {
  const userId = projectActor(req, res)
  if (!userId) return
  recoverExpiredTasks()
  const projectId = req.query.projectId ? String(req.query.projectId) : undefined
  ok(res, { tasks: listTasks(userId, projectId) })
})
app.get('/api/tasks/:id', (req, res) => {
  const userId = projectActor(req, res)
  if (!userId) return
  recoverExpiredTasks()
  const task = getTask(req.params.id)
  if (!task) return fail(res, '任务不存在', 404)
  try { requireProjectAccess(task.project_id, userId); ok(res, { task }) } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.get('/api/tasks/:id/events', (req, res) => {
  const userId = projectActor(req, res)
  if (!userId) return
  const task = getTask(req.params.id)
  if (!task) return fail(res, '任务不存在', 404)
  try {
    requireProjectAccess(task.project_id, userId)
    ok(res, { events: listTaskEvents(task.id, Number(req.query.after) || 0) })
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.get('/api/tasks/:id/events/stream', (req, res) => {
  const userId = projectActor(req, res)
  if (!userId) return
  const task = getTask(req.params.id)
  if (!task) return fail(res, '任务不存在', 404)
  try { requireProjectAccess(task.project_id, userId) } catch (e) { return fail(res, String((e as Error).message || e), 403) }
  let after = Math.max(Number(req.query.after) || 0, Number(req.get('last-event-id')) || 0)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  const send = () => {
    for (const event of listTaskEvents(task.id, after)) {
      after = event.sequence
      res.write(`id: ${event.sequence}\nevent: task-event\ndata: ${JSON.stringify(event)}\n\n`)
    }
  }
  send()
  const poll = setInterval(send, 500)
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000)
  req.on('close', () => { clearInterval(poll); clearInterval(heartbeat) })
})
app.post('/api/tasks/:id/pause', (req, res) => {
  try { const userId = projectActor(req, res); if (!userId) return; const task = getTask(req.params.id); if (!task) return fail(res, '任务不存在', 404); requireProjectAccess(task.project_id, userId, true); pauseTask(req.params.id); ok(res, { task: getTask(req.params.id) }) } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.post('/api/tasks/:id/cancel', (req, res) => {
  try { const userId = projectActor(req, res); if (!userId) return; const task = getTask(req.params.id); if (!task) return fail(res, '任务不存在', 404); requireProjectAccess(task.project_id, userId, true); cancelTask(req.params.id); ok(res, { task: getTask(req.params.id) }) } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.delete('/api/tasks/:id', (req, res) => {
  try { const userId = projectActor(req, res); if (!userId) return; const task = getTask(req.params.id); if (!task) return fail(res, '任务不存在', 404); requireProjectAccess(task.project_id, userId, true); deleteTask(req.params.id); ok(res, { ok: true }) } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.post('/api/tasks/:id/resume', (req, res) => {
  try { const userId = projectActor(req, res); if (!userId) return; const task = getTask(req.params.id); if (!task) return fail(res, '任务不存在', 404); requireProjectAccess(task.project_id, userId, true); resumeTask(req.params.id); ok(res, { task: getTask(req.params.id) }) } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.post('/api/tasks/:id/answer', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const answer = String(req.body?.answer || '').trim()
    if (!answer) return fail(res, '回答不能为空')
    answerTask(req.params.id, userId, answer)
    ok(res, { task: getTask(req.params.id) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/tasks/:id/continue', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const message = String(req.body?.message || '').trim()
    if (!message) return fail(res, '内容不能为空')
    ok(res, { task: continueTask(req.params.id, userId, message) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
// ── M9 观测：Trace 与统计 ────────────────────────────────────────────
app.get('/api/tasks/:id/trace', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    ok(res, { trace: taskTrace(req.params.id, userId) })
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.get('/api/harness/stats', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    const days = Math.max(0, Number(req.query.days) || 30)
    ok(res, { stats: taskStats(userId, days ? Date.now() - days * 86_400_000 : 0), days })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
// 系统数据全量快照（超管）：数据库 checkpoint 后备份数据库、项目、Skill、MCP、API、协议和密钥。
app.post('/api/harness/backup', requireSuperAdmin, (_req, res) => {
  try {
    ccsDb.pragma('wal_checkpoint(TRUNCATE)')
    authDb.pragma('wal_checkpoint(TRUNCATE)')
    const snapshot = createSystemDataSnapshot('manual-admin-backup')
    const verification = verifySystemDataSnapshot(snapshot.id)
    if (!verification.ok) throw new Error(`系统数据快照校验失败：${verification.failures.join('；')}`)
    ok(res, { snapshot, verification, dataRoot: DATA_ROOT })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/harness/storage-integrity', requireSuperAdmin, (_req, res) => {
  try {
    const files = checkCurrentDataIntegrity()
    const database = {
      ccs: String(ccsDb.pragma('quick_check', { simple: true })) === 'ok',
      auth: String(authDb.pragma('quick_check', { simple: true })) === 'ok',
    }
    ok(res, { ok: files.ok && database.ccs && database.auth, files, database })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

// ── M7 项目记忆 ──────────────────────────────────────────────────────
app.get('/api/projects/:id/memories', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    requireProjectAccess(req.params.id, userId)
    ok(res, { memories: listMemories(req.params.id, req.query.all === '1') })
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.post('/api/projects/:id/memories', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    requireProjectAccess(req.params.id, userId, true)
    ok(res, { memory: addMemory({
      projectId: req.params.id,
      content: String(req.body?.content || ''),
      sourceType: 'user',
      createdBy: userId,
      replacesId: req.body?.replacesId ? String(req.body.replacesId) : undefined,
    }) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/projects/:id/memories/:memoryId', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    requireProjectAccess(req.params.id, userId, true)
    removeMemory(req.params.id, req.params.memoryId)
    ok(res, {})
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

// 计划第 22 节：「继续」控制命令。先查当前对话，再查项目，不让模型猜进度。
app.post('/api/projects/:id/continue', (req, res) => {
  try {
    const userId = projectActor(req, res)
    if (!userId) return
    requireProjectAccess(req.params.id, userId, true)
    recoverExpiredTasks()
    const threadId = req.body?.threadId ? String(req.body.threadId) : undefined
    const inThread = threadId ? findResumableTasks(userId, { threadId }) : []
    const candidates = inThread.length ? inThread : findResumableTasks(userId, { projectId: req.params.id })
    if (!candidates.length) return ok(res, { action: 'none', message: '当前项目没有可恢复的任务' })
    if (candidates.length === 1) {
      const task = candidates[0]
      if (task.status === 'waiting_user') {
        // “继续”本身不作为答案：把未回答的问题带回给用户
        return ok(res, { action: 'question', task: getTask(task.id), question: task.waiting_question || '任务在等待你的回答' })
      }
      appendTaskEvent(task.id, 'task.resume_requested', '用户请求继续任务')
      resumeTask(task.id)
      return ok(res, { action: 'resumed', task: getTask(task.id) })
    }
    // 多个可恢复任务：返回列表让用户选择，不连续追问
    ok(res, { action: 'choose', tasks: candidates.map((t) => ({ id: t.id, title: t.title, status: t.status, updated_at: t.updated_at })) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

// ── 流式对话（SSE，给 agent 打字机效果）──────────────────────────────
// body 同 /api/chat。逐块下发 {delta}，结束 {done,model,usage}，出错 {error}。
app.post('/api/chat/stream', async (req, res) => {
  const body = req.body || {}
  const stored = body.providerId ? revealProvider(String(body.providerId)) : firstUsableProvider()
  if (!stored || !stored.enabled) {
    return fail(res, stored ? '该站点已禁用' : '还没有可用的模型站点。请先在「API 设置」里添加并启用一个站点。', 400)
  }
  const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }
  const llmModel = stored.models?.find((m) => (m.caps || []).includes('llm'))?.model
  const model = String(body.model || llmModel || stored.models?.[0]?.model || '').trim()
  if (!model) return fail(res, '该站点还没有配置任何模型')

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const send = (obj: object) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  try {
    const { usage } = await streamChat(
      provider,
      model,
      { messages: body.messages, prompt: body.prompt, system: body.system },
      body.params || {},
      (delta) => send({ delta }),
    )
    send({ done: true, model, provider: stored.name, usage })
  } catch (e) {
    send({ error: String((e as Error).message || e) })
  }
  res.end()
})

// ── Agent 一步（native function-calling，给后台任务用）───────────────
// body: { messages, system, tools, providerId? } → { content, toolCalls }
app.post('/api/agent/step', async (req, res) => {
  const body = req.body || {}
  const stored = body.providerId ? revealProvider(String(body.providerId)) : firstUsableProvider()
  if (!stored || !stored.enabled) {
    return fail(res, stored ? '该站点已禁用' : '还没有可用的模型站点，请先在「API 设置」里配置。', 400)
  }
  const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }
  const llmModel = stored.models?.find((m) => (m.caps || []).includes('llm'))?.model
  const model = String(body.model || llmModel || stored.models?.[0]?.model || '').trim()
  if (!model) return fail(res, '该站点还没有配置任何模型')
  try {
    const r = await chatWithTools(provider, model, body.messages || [], body.system || '', body.tools || [])
    ok(res, { content: r.content, toolCalls: r.toolCalls })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── Agent Tool Catalog：统一暴露系统、APP、MCP、Skill 工具声明 ───────────
app.get('/api/agent/tools', (req, res) => {
  try {
    const source = ['system', 'app', 'mcp', 'skill'].includes(String(req.query.source || '')) ? String(req.query.source) as ToolSource : undefined
    const auth = getAuth(req)
    ok(res, toolCatalogSnapshot({
      source,
      sourceId: req.query.sourceId ? String(req.query.sourceId) : undefined,
      appId: req.query.appId ? String(req.query.appId) : undefined,
      executableOnly: String(req.query.executableOnly || '') === '1',
      actor: auth?.user || null,
    }))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/agent/tools/:name/run', requireAuth, async (req, res) => {
  try { ok(res, { result: await runCatalogTool(String(req.params.name || ''), req.body?.args || {}, req.auth!.user) }) }
  catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.get('/api/apps/:id/tools', (req, res) => {
  try { ok(res, toolCatalogSnapshot({ appId: String(req.params.id || ''), actor: getAuth(req)?.user || null })) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})

const LOCAL_AGENT_IMAGE_RE = /^\/api\/fs\/raw\/([^/?#]+)(?:[?#].*)?$/

async function localAgentImageDataUrl(url: string, user: NonNullable<express.Request['auth']>['user']) {
  const match = LOCAL_AGENT_IMAGE_RE.exec(url)
  if (!match) return url
  const nodeId = decodeURIComponent(match[1])
  const node = getNode(nodeId)
  if (!node || node.type !== 'file') throw new Error('对话中的图片不存在')
  if (!canReadNode(user, node)) throw new Error(`没有图片权限：${node.name}`)
  const mime = String(node.mime || '').toLowerCase()
  if (!mime.startsWith('image/')) throw new Error(`文件不是图片：${node.name}`)
  const original = readBlob(node.id) || Buffer.from(node.content || '')
  if (!original.length) throw new Error(`无法读取图片：${node.name}`)

  let data = original
  let outputMime = mime
  try {
    const pipeline = sharp(original, { animated: false }).rotate()
    const metadata = await pipeline.metadata()
    const shouldOptimize = mime === 'image/svg+xml'
      || original.length > 768 * 1024
      || (metadata.width || 0) > 2048
      || (metadata.height || 0) > 2048
    if (shouldOptimize) {
      data = await pipeline
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 })
        .toBuffer()
      outputMime = 'image/webp'
    }
  } catch (error) {
    console.warn(`对话图片压缩失败，使用原文件：${node.name}`, error)
  }
  return `data:${outputMime};base64,${data.toString('base64')}`
}

async function resolveAgentLocalImages(messages: unknown, user: NonNullable<express.Request['auth']>['user']) {
  if (!Array.isArray(messages)) return []
  return Promise.all(messages.map(async (message) => {
    if (!message || typeof message !== 'object') return message
    const row = message as Record<string, unknown>
    if (!Array.isArray(row.content)) return message
    const content = await Promise.all(row.content.map(async (part) => {
      if (!part || typeof part !== 'object') return part
      const item = part as Record<string, unknown>
      const imageUrl = item.image_url
      if (!imageUrl || typeof imageUrl !== 'object') return part
      const image = imageUrl as Record<string, unknown>
      if (typeof image.url !== 'string' || !LOCAL_AGENT_IMAGE_RE.test(image.url)) return part
      return { ...item, image_url: { ...image, url: await localAgentImageDataUrl(image.url, user) } }
    }))
    return { ...row, content }
  }))
}

// ── Agent 一步 · 流式文本（工具调用仍在步末返回）──────────────────────
app.post('/api/agent/step-stream', requireAuth, async (req, res) => {
  const body = req.body || {}
  let route
  try {
    const preferredProviderId = String(body.providerId || '').trim()
    const preferredModel = String(body.model || '').trim()
    const preferredProvider = preferredProviderId ? revealProvider(preferredProviderId) : null
    route = resolveModel({
      requiresAll: ['llm.tools'],
      fallbackPolicy: 'best_available',
      preferredModels: preferredProviderId
        ? preferredProvider?.models.map((entry) => ({ providerId: preferredProviderId, model: entry.model, weight: entry.model === preferredModel ? 2000 : 500 })) || []
        : preferredModel ? [{ model: preferredModel, weight: 2000 }] : [],
    })
  } catch (error) {
    return fail(res, String((error as Error).message || error), 400)
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const send = (obj: object) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  try {
    const messages = await resolveAgentLocalImages(body.messages, req.auth!.user)
    const r = await chatWithTools(
      route.provider,
      route.model,
      messages,
      body.system || '',
      body.tools || [],
      300000,
      (delta) => send({ delta }),
    )
    send({ done: true, content: r.content, toolCalls: r.toolCalls })
  } catch (e) {
    send({ error: String((e as Error).message || e) })
  }
  res.end()
})

// ── MCP 管理 ──────────────────────────────────────────────────────────
app.get('/api/lingxing/mapping', requireAuth, (_req, res) => {
  try { ok(res, { mapping: getLingxingMapping() }) }
  catch (error) { fail(res, String((error as Error).message || error)) }
})

app.post('/api/lingxing/mapping', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, '请选择需要上传的映射表格')
    const mapping = await importLingxingMapping(req.file)
    ok(res, { mapping })
  } catch (error) {
    fail(res, String((error as Error).message || error))
  }
})

app.get('/api/lingxing/mapping/file', requireAuth, (_req, res) => {
  try {
    const file = getLingxingMappingFile()
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
    res.sendFile(file.path)
  } catch (error) {
    fail(res, String((error as Error).message || error), 404)
  }
})

app.get('/api/mcp/servers', (_req, res) => ok(res, { servers: mcpListServers() }))
app.post('/api/mcp/servers', async (req, res) => {
  try {
    const cfg = await mcpSaveServer(req.body || {})
    ok(res, { server: mcpListServers().find((s) => s.id === cfg.id) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.delete('/api/mcp/servers/:id', async (req, res) => {
  try {
    await mcpDeleteServer(req.params.id)
    ok(res, { id: req.params.id })
  } catch (e) { fail(res, String((e as Error).message || e), 403) }
})
app.post('/api/mcp/servers/:id/refresh', async (req, res) => {
  await mcpRefreshServer(req.params.id)
  ok(res, { server: mcpListServers().find((s) => s.id === req.params.id) })
})
// 立即启用/停用（不动其它字段），点了即生效
app.post('/api/mcp/servers/:id/enabled', async (req, res) => {
  try {
    await mcpSetEnabled(req.params.id, req.body?.enabled !== false)
    ok(res, { server: mcpListServers().find((s) => s.id === req.params.id) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.get('/api/mcp/agent-tools', (_req, res) => ok(res, { tools: mcpAgentTools() }))
app.get('/api/mcp/search-tools', (_req, res) => ok(res, { tools: mcpSearchAgentTools() }))
// 预览：只解析不保存
app.post('/api/mcp/import/preview', (req, res) => {
  try {
    ok(res, { servers: mcpParseImport(String(req.body?.text || '')) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// 一键导入：解析 + 保存 + 连接
app.post('/api/mcp/import', async (req, res) => {
  try {
    const r = await mcpImportServers(String(req.body?.text || ''))
    ok(res, { count: r.count, servers: mcpListServers().filter((s) => r.saved.some((x) => x.id === s.id)) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 本地音乐库（每个浏览器独立播放，互不干扰）─────────────────────────
app.get('/api/library/config', (_req, res) => ok(res, libGetConfig()))
app.post('/api/library/config', async (req, res) => {
  const r = libSetDirs(Array.isArray(req.body?.dirs) ? req.body.dirs : [])
  const tracks = await libScan()
  ok(res, { ...r, trackCount: tracks.length })
})
app.get('/api/library/tracks', async (_req, res) => {
  try {
    ok(res, { tracks: await libListTracks() })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/library/scan', async (_req, res) => {
  try {
    ok(res, { trackCount: (await libScan()).length })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// 上传音频文件到首个曲库目录（multipart，字段名 files）
app.post('/api/library/upload', upload.array('files', 30), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || []
    if (!files.length) return fail(res, '没有文件')
    const r = libUploadFiles(files.map((f) => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), buffer: f.buffer })))
    if (r.saved) {
      const tracks = await libScan()
      ok(res, { ...r, trackCount: tracks.length })
    } else {
      ok(res, r)
    }
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// 保存歌手/专辑分类（AI 或手动），保存后重扫使缓存生效
app.post('/api/library/meta', async (req, res) => {
  try {
    const saved = libSetMeta(Array.isArray(req.body?.items) ? req.body.items : [])
    await libScan()
    ok(res, { saved })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// 用已配置的大模型批量清洗文件名，并识别未分类歌曲的歌手和曲名。
app.post('/api/library/ai-classify-artists', async (req, res) => {
  try {
    const stored = firstUsableProvider()
    if (!stored) return fail(res, '还没有可用的模型站点。请先在「API 设置」里添加并启用一个文本模型。')
    const model = stored.models?.find((m) => (m.caps || []).includes('llm'))?.model || stored.models?.[0]?.model
    if (!model) return fail(res, '当前模型站点没有可用的文本模型。')

    const scope = req.body?.scope === 'all' ? 'all' : 'unclassified'
    const pending = (await libScan()).filter((track) => scope === 'all' || !track.artist).slice(0, 300)
    if (!pending.length) return ok(res, { processed: 0, classified: 0, unresolved: 0, remaining: 0, model, provider: stored.name })

    const accepted = new Map<string, { artist?: string; title?: string }>()
    const batchSize = 40
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      const batch = pending.slice(offset, offset + batchSize)
      const knownIds = new Set(batch.map((track) => track.id))
      const prompt = [
        '你是音乐元数据提取助手。请从以下本地音乐的原始文件名和相对文件夹路径中，整理歌手名和歌曲名。',
        '文件名、分隔符和文件夹都可能杂乱，不能机械按符号拆分；文件夹仅为弱线索。结合你的歌曲知识判断。',
        '清除码率、音质、来源、下载站和“完整版”等无关标记；Live、Cover、DJ 等真实版本信息必须保留在 title 中。',
        '若能高置信度确认歌曲且文件未体现实际演唱者，可填写该歌曲最知名原唱；否则 artist 留空。不要编造，无法确定时 artist 和 title 都留空。',
        '只输出 JSON 数组，不要 Markdown 或解释。每项格式必须为 {"id":"原样 id","artist":"歌手或空字符串","title":"清洗后的曲名或空字符串","confidence":"high"}。',
        JSON.stringify(batch.map((track) => ({ id: track.id, fileName: track.fileName, folder: track.folder || '' }))),
      ].join('\n')
      const result = await callChat(
        { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol },
        model,
        { prompt },
        { temperature: 0.1 },
      )
      const text = result.text.trim()
      const start = text.indexOf('[')
      const end = text.lastIndexOf(']')
      if (start < 0 || end < start) continue
      let items: unknown
      try {
        items = JSON.parse(text.slice(start, end + 1))
      } catch {
        continue
      }
      if (!Array.isArray(items)) continue
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const row = item as { id?: unknown; artist?: unknown; title?: unknown; confidence?: unknown }
        const id = String(row.id || '').trim()
        const artist = String(row.artist || '').trim()
        const title = String(row.title || '').trim()
        if (!knownIds.has(id) || row.confidence !== 'high') continue
        const update: { artist?: string; title?: string } = {}
        if (artist && artist.length <= 100) update.artist = artist
        if (title && title.length <= 200) update.title = title
        if (update.artist || update.title) accepted.set(id, update)
      }
    }

    const updates = [...accepted].map(([id, value]) => ({ id, ...value }))
    const saved = libSetMeta(updates)
    const classified = updates.filter((item) => item.artist).length
    const retitled = updates.filter((item) => item.title).length
    await libScan()
    ok(res, {
      processed: pending.length,
      classified,
      retitled,
      unresolved: pending.length - saved,
      remaining: Math.max(0, (await libListTracks()).filter((track) => !track.artist).length),
      model,
      provider: stored.name,
    })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// 刮削封面/歌手照片（合法音乐 API + 本地缓存），可能较慢
app.post('/api/library/scrape', async (_req, res) => {
  try {
    ok(res, await libScrapeArtwork())
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/library/cache-artwork', async (req, res) => {
  try {
    const scope = req.body?.scope === 'album' ? 'album' : req.body?.scope === 'artist' ? 'artist' : ''
    if (!scope) return fail(res, '艺术图类型无效')
    const url = await libCacheRemoteArtwork(scope, String(req.body?.key || ''), String(req.body?.url || ''))
    ok(res, { url })
  } catch (e) {
    fail(res, String((e as Error).message || e), 400)
  }
})
// AI 生成歌手/专辑图（原创插画，无版权），可能较慢
app.post('/api/library/generate-artwork', async (_req, res) => {
  try {
    ok(res, await generateMusicArtwork())
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// AI 仅生成歌手头像（不处理专辑）
app.post('/api/library/generate-artists-artwork', async (_req, res) => {
  try {
    ok(res, await generateArtistsArtwork())
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// 输出缓存的艺术图（按实际字节判 png/jpeg）
app.get('/api/library/artwork/:id', (req, res) => {
  const p = libArtworkPath(req.params.id)
  if (!fsExistsSync(p)) return res.status(404).send('not found')
  const head = readFileSync(p).subarray(0, 4)
  const isPng = head[0] === 0x89 && head[1] === 0x50
  res.setHeader('Content-Type', isPng ? 'image/png' : 'image/jpeg')
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.sendFile(p)
})
app.get('/api/library/stream/:id', async (req, res) => {
  await libListTracks() // 确保索引已建（服务重启后直接请求流也能命中）
  libStreamTrack(req, res)
})
app.get('/api/library/lyrics/:id', async (req, res) => {
  try {
    const result = await libGetLyrics(String(req.params.id), req.query.online !== 'false')
    if (!result) return res.status(404).json({ ok: false, error: '暂未找到歌词' })
    res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800')
    ok(res, result)
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

app.post('/api/mcp/call', async (req, res) => {
  try {
    const { name, args } = req.body || {}
    ok(res, { text: await mcpCallByName(String(name), args || {}) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/mcp/call-direct', async (req, res) => {
  try {
    const { serverId, tool, args } = req.body || {}
    ok(res, { text: await mcpCallDirect(String(serverId), String(tool), args || {}) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

type FigmaGenerationStep = {
  id: 'prepare' | 'figma' | 'model' | 'parse' | 'save' | 'preview'
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  startedAt?: number
  finishedAt?: number
  detail?: string
  error?: string
}
type FigmaGenerationJob = {
  id: string
  ownerId: string
  status: 'running' | 'done' | 'error'
  createdAt: number
  updatedAt: number
  currentStep: FigmaGenerationStep['id']
  steps: FigmaGenerationStep[]
  result?: unknown
  error?: string
}
const figmaGenerationJobs = new Map<string, FigmaGenerationJob>()
const figmaStepLabels: Array<[FigmaGenerationStep['id'], string]> = [
  ['prepare', '检查参数与模型'], ['figma', '读取 Figma 设计'], ['model', '调用模型生成代码'], ['parse', '解析并校验文件'], ['save', '保存到项目/Figma'], ['preview', '构建网页预览'],
]
type FigmaProjectRecord = { id: string; name: string; url: string; createdAt: number; updatedAt: number }
const FIGMA_PROJECTS_FILE = '.projects.json'

function ensureFigmaProjectRoot(ownerId: string): string {
  return ensureFolder('Figma', ensureCanvasRoot(ownerId).id, ownerId)
}

function figmaProjectsFile(ownerId: string) {
  const rootId = ensureFigmaProjectRoot(ownerId)
  return listChildren(rootId).nodes.find((node) => node.type === 'file' && node.name === FIGMA_PROJECTS_FILE) || null
}

function normalizeFigmaProjects(value: unknown): FigmaProjectRecord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: FigmaProjectRecord[] = []
  for (const raw of value.slice(0, 500)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Partial<FigmaProjectRecord>
    const id = String(item.id || '').trim().slice(0, 100)
    const name = String(item.name || '').trim().slice(0, 80)
    const url = String(item.url || '').trim().slice(0, 2000)
    if (!id || seen.has(id) || !name) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || !/(^|\.)figma\.com$/i.test(parsed.hostname)) continue
    } catch { continue }
    seen.add(id)
    const now = Date.now()
    result.push({ id, name, url, createdAt: Number(item.createdAt) || now, updatedAt: Number(item.updatedAt) || now })
  }
  return result
}

app.get('/api/figma/projects', requireAuth, (req, res) => {
  try {
    const file = figmaProjectsFile(req.auth!.user.id)
    if (!file?.content) return ok(res, { projects: [] })
    let parsed: unknown = []
    try { parsed = JSON.parse(file.content) } catch { parsed = [] }
    ok(res, { projects: normalizeFigmaProjects(parsed) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.put('/api/figma/projects', requireAuth, (req, res) => {
  try {
    const projects = normalizeFigmaProjects(req.body?.projects)
    const content = JSON.stringify(projects, null, 2)
    const file = figmaProjectsFile(req.auth!.user.id)
    if (file) setContent(file.id, content)
    else createNode({ name: FIGMA_PROJECTS_FILE, type: 'file', parentId: ensureFigmaProjectRoot(req.auth!.user.id), content, ownerId: req.auth!.user.id })
    emitFsEvent('changed')
    ok(res, { projects })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

function publicFigmaJob(job: FigmaGenerationJob) {
  return { ...job, ownerId: undefined }
}
function setFigmaStep(job: FigmaGenerationJob, id: FigmaGenerationStep['id'], status: FigmaGenerationStep['status'], detail?: string, error?: string) {
  const now = Date.now()
  const step = job.steps.find((item) => item.id === id)!
  if (status === 'running' && !step.startedAt) step.startedAt = now
  if (status === 'done' || status === 'error') step.finishedAt = now
  Object.assign(step, { status, ...(detail ? { detail } : {}), ...(error ? { error } : {}) })
  job.currentStep = id; job.updatedAt = now
}

// ── Figma → Vue：后台任务 + 可查询的分阶段诊断信息 ────────────────
app.post('/api/figma/generate-vue', requireAuth, async (req, res) => {
  const body = req.body || {}
  const fileKey = String(body.fileKey || '').trim()
  const nodeId = String(body.nodeId || '').trim()
  const requestedName = String(body.projectName || 'Figma Vue 页面').trim().slice(0, 80) || 'Figma Vue 页面'
  const instruction = String(body.instruction || '').trim().slice(0, 3000)
  if (!fileKey) return fail(res, '缺少 Figma fileKey', 400)
  const job: FigmaGenerationJob = {
    id: randomUUID(), ownerId: req.auth!.user.id, status: 'running', createdAt: Date.now(), updatedAt: Date.now(), currentStep: 'prepare',
    steps: figmaStepLabels.map(([id, label]) => ({ id, label, status: 'pending' })),
  }
  figmaGenerationJobs.set(job.id, job)
  ok(res, { job: publicFigmaJob(job) })

  // 后台异步任务：确保所有错误都被捕获，避免进程崩溃
  ;(async () => {
    try {
      setFigmaStep(job, 'prepare', 'running')
      const stored = firstUsableProvider('llm')
      if (!stored) throw new Error('请先在「API 设置」中配置并启用语言模型。')
      const model = stored.models?.find((item) => (item.caps || []).includes('llm'))?.model || stored.models?.[0]?.model
      if (!model) throw new Error('当前站点没有可用语言模型。')
      const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }
      setFigmaStep(job, 'prepare', 'done', `模型：${stored.name} / ${model}${nodeId ? ` · Frame：${nodeId}` : ' · 整个文件'}`)

      setFigmaStep(job, 'figma', 'running', nodeId ? `正在读取 Frame ${nodeId}` : '正在读取整个设计文件')
      const figmaStarted = Date.now()
    const designText = await mcpCallDirect('figma', 'get_figma_data', { fileKey, ...(nodeId ? { nodeId } : {}) })
    // 大型社区文件可能包含数十万字符。只取足够完成单页还原的上下文，避免模型请求超时。
    const fullContext = String(designText || '')
    const context = fullContext.length > 26000
      ? `${fullContext.slice(0, 23000)}\n\n[中间内容已为生成稳定性省略]\n\n${fullContext.slice(-3000)}`
      : fullContext
      setFigmaStep(job, 'figma', 'done', `读取 ${fullContext.length.toLocaleString()} 字符，耗时 ${((Date.now() - figmaStarted) / 1000).toFixed(1)} 秒`)
    const prompt = [
      '你是资深 Vue 前端工程师。根据下面的 Figma 结构化设计上下文，只生成页面实现文件。工程脚手架由系统提供。',
      '必须只返回 JSON，不要 Markdown。格式：{“summary”:”...”,”files”:[{“path”:”src/App.vue”,”content”:”...”},{“path”:”src/style.css”,”content”:”...”}]}。',
      'files 必须且只能包含 src/App.vue 和 src/style.css，不要生成 package.json、main.ts 或 index.html。',
      'App.vue 使用 Vue 3 <script setup lang=”ts”>（没有逻辑可省略 script）；不要使用未安装的第三方组件库。',
      '要求：尽量还原布局、颜色、字体、圆角和间距；使用语义化 HTML；页面自适应；不能引用不存在的本地资源；外部图片可用设计上下文中的 URL，没有则使用 CSS 占位；不要加入解释性文字。',
      instruction ? `用户补充要求：${instruction}` : '',
      `Figma 设计上下文：\n${context}`,
    ].filter(Boolean).join('\n\n')
      setFigmaStep(job, 'model', 'running', `已发送 ${context.length.toLocaleString()} 字符设计上下文，等待模型响应`)
      const modelStarted = Date.now()
    const generated = await callChat(provider, model, { messages: [{ role: 'user', content: prompt }] }, {}, 600000)
    const raw = String(generated.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      setFigmaStep(job, 'model', 'done', `收到 ${raw.length.toLocaleString()} 字符，耗时 ${((Date.now() - modelStarted) / 1000).toFixed(1)} 秒`)
      setFigmaStep(job, 'parse', 'running', '正在解析 JSON 并检查 App.vue、style.css')
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型没有返回可识别的文件数据')
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { summary?: string; files?: Array<{ path?: string; content?: string }> }
    const generatedPaths = new Set(['src/App.vue', 'src/style.css'])
    const generatedFiles = (parsed.files || []).filter((file) => generatedPaths.has(String(file.path)) && typeof file.content === 'string')
    if (generatedFiles.length !== generatedPaths.size || new Set(generatedFiles.map((file) => file.path)).size !== generatedPaths.size) throw new Error('模型返回的页面文件不完整，请重试')
      setFigmaStep(job, 'parse', 'done', `校验通过：${generatedFiles.map((file) => file.path).join('、')}`)
    const scaffoldFiles = [
      { path: 'package.json', content: JSON.stringify({ name: 'figma-vue-page', private: true, version: '0.0.0', type: 'module', scripts: { dev: 'vite', build: 'vue-tsc -b && vite build', preview: 'vite preview' }, dependencies: { vue: '^3.5.13' }, devDependencies: { '@vitejs/plugin-vue': '^5.2.1', typescript: '~5.6.3', vite: '^6.0.5', 'vue-tsc': '^2.1.10' } }, null, 2) },
      { path: 'index.html', content: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Figma Vue Page</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
` },
      { path: 'src/main.ts', content: `import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')
` },
      { path: 'vite.config.ts', content: `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({ plugins: [vue()] })
` },
      { path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, module: 'ESNext', moduleResolution: 'Bundler', strict: true, jsx: 'preserve', resolveJsonModule: true, isolatedModules: true, esModuleInterop: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], skipLibCheck: true, noEmit: true }, include: ['src/**/*.ts', 'src/**/*.vue', 'src/**/*.d.ts'] }, null, 2) },
      { path: 'src/env.d.ts', content: `/// <reference types="vite/client" />\n` },
    ]
    const files = [...scaffoldFiles, ...generatedFiles.map((file) => ({ path: String(file.path), content: String(file.content) }))]

      setFigmaStep(job, 'save', 'running', `正在创建“项目/Figma/${requestedName}”`)
    const figmaRootId = ensureFigmaProjectRoot(job.ownerId)
    const folder = createNode({ name: requestedName, type: 'folder', parentId: figmaRootId, ownerId: job.ownerId })
    const src = createNode({ name: 'src', type: 'folder', parentId: folder.id, ownerId: job.ownerId })
    const created = files.map((file) => {
      const path = String(file.path)
      const node = createNode({
        name: path.startsWith('src/') ? path.slice(4) : path,
        type: 'file',
        parentId: path.startsWith('src/') ? src.id : folder.id,
        content: String(file.content),
        ownerId: job.ownerId,
      })
      return { id: node.id, path, name: node.name }
    })
    emitFsEvent('changed')
      setFigmaStep(job, 'save', 'done', `已保存 ${created.length} 个文件`)
      setFigmaStep(job, 'preview', 'running', '正在编译 Vue 项目并生成可视化页面')
      const preview = await buildFigmaPreview(folder.id, files)
      setFigmaStep(job, 'preview', 'done', '网页预览已就绪')
      job.result = { folder: { id: folder.id, name: folder.name }, files: created, previewUrl: preview.url, summary: String(parsed.summary || ''), provider: stored.name, model }
      job.status = 'done'; job.updatedAt = Date.now()
    } catch (e) {
      const rawError = String((e as Error).message || e)
      const text = /aborted|aborterror/i.test(rawError) ? '模型请求被上游服务中止。建议使用带 node-id 的具体 Frame 链接，或更换响应更快的模型。' : rawError
      const step = job.steps.find((item) => item.status === 'running') || job.steps.find((item) => item.id === job.currentStep)!
      setFigmaStep(job, step.id, 'error', step.detail, text)
      job.status = 'error'; job.error = text; job.updatedAt = Date.now()
    }
  })().catch((fatalError) => {
    // 兜底：捕获所有未预期的顶层错误，避免进程崩溃
    console.error(`[Figma生成] 任务 ${job.id} 发生致命错误:`, fatalError)
    const step = job.steps.find((item) => item.status === 'running') || job.steps[0]
    setFigmaStep(job, step.id, 'error', step.detail, `系统错误：${String((fatalError as Error).message || fatalError)}`)
    job.status = 'error'
    job.error = `系统错误：${String((fatalError as Error).message || fatalError)}`
    job.updatedAt = Date.now()
  })
})

app.get('/api/figma/generate-vue/:jobId', requireAuth, (req, res) => {
  const job = figmaGenerationJobs.get(String(req.params.jobId))
  if (!job || job.ownerId !== req.auth!.user.id) return fail(res, '生成任务不存在或服务已重启', 404)
  ok(res, { job: publicFigmaJob(job) })
})

// MCP 管理页：用自然语言让模型自动选择并调用「当前服务器」的工具，便于快速验通。
app.post('/api/mcp/test-agent', async (req, res) => {
  const body = req.body || {}
  const serverId = String(body.serverId || '').trim()
  const prompt = String(body.prompt || '').trim()
  const english = body.locale === 'en-US'
  if (!serverId) return fail(res, english ? 'Select an MCP server' : '请选择 MCP 服务器')
  if (!prompt) return fail(res, english ? 'Enter test content' : '请输入测试内容')
  const server = mcpListServers().find((s) => s.id === serverId)
  if (!server) return fail(res, english ? 'MCP server not found' : 'MCP 服务器不存在', 404)
  if (!server.enabled) return fail(res, english ? 'This MCP server is disabled' : '该 MCP 服务器已停用')
  if (server.status !== 'connected') return fail(res, english ? `This MCP server is not connected: ${server.status}` : `该 MCP 服务器尚未连接：${server.status}`)

  const stored = body.providerId ? revealProvider(String(body.providerId)) : firstUsableProvider()
  if (!stored || !stored.enabled) {
    return fail(res, english ? stored ? 'This model provider is disabled' : 'No model provider is available. Configure one in API Settings.' : stored ? '该模型站点已禁用' : '还没有可用的模型站点，请先在「API 设置」里配置。', 400)
  }
  const provider: ResolvedProvider = { base_url: stored.base_url, api_key: stored.api_key, protocol: stored.protocol }
  const llmModel = stored.models?.find((m) => (m.caps || []).includes('llm'))?.model
  const model = String(body.model || llmModel || stored.models?.[0]?.model || '').trim()
  if (!model) return fail(res, english ? 'This provider has no configured models' : '该站点还没有配置任何模型')

  const knownBrokenLingxingTools = new Set(['mcp__lingxing__get_my_sids'])
  const allTools = mcpAgentToolsForServer(serverId)
  const tools = serverId === 'lingxing'
    ? allTools.filter((tool) => !knownBrokenLingxingTools.has(String((tool as { function?: { name?: string } }).function?.name || '')))
    : allTools
  if (!tools.length) return fail(res, english ? 'This MCP server has no tools available to AI. Refresh the connection first.' : '当前 MCP 没有可供 AI 调用的工具；请先刷新重连。')

  const lingxingOneShot = serverId === 'lingxing'
  const system = english
    ? `You are an MCP query assistant. You may only use the MCP server “${server.name}”. Choose exactly one best tool for the request; never call multiple tools in one answer and never retry with another tool after a failure. Never invent results. For Amazon store lists, prefer get_multi_platform_shop_list with platform_code [10001].`
    : `你是领星 MCP 查询助手。当前只允许使用 MCP 服务器“${server.name}”。每次查询只选择一个最合适的工具，禁止一次调用多个工具，失败后也不要立刻换工具重试。不要编造结果。查询亚马逊店铺列表时，优先调用 get_multi_platform_shop_list，并传 platform_code [10001]。`

  const messages: ToolMessage[] = [{ role: 'user', content: prompt }]
  const steps: { type: 'assistant' | 'tool'; name?: string; args?: string; text: string }[] = []
  try {
    for (let step = 0; step < 4; step++) {
      const r = await chatWithTools(provider, model, messages, system, tools, 180000)
      const calls = lingxingOneShot ? (r.toolCalls || []).slice(0, 1) : (r.toolCalls || [])
      if (!calls.length) {
        const text = r.content || (english ? 'The test finished, but the model returned no summary.' : '测试结束，但模型没有返回总结。')
        steps.push({ type: 'assistant', text })
        return ok(res, { answer: text, steps, model, provider: stored.name })
      }
      messages.push({
        role: 'assistant',
        content: r.content || '',
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
      })
      for (const c of calls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(c.arguments || '{}') } catch { args = {} }
        const obs = await mcpCallByName(c.name, args)
        steps.push({ type: 'tool', name: c.name, args: c.arguments || '{}', text: obs.slice(0, 6000) })
        messages.push({ role: 'tool', tool_call_id: c.id, content: obs.slice(0, 12000) })
      }
      if (lingxingOneShot) {
        const toolStep = steps[steps.length - 1]
        const summaryPrompt = english
          ? `User request: ${prompt}\nTool called: ${toolStep?.name || ''}\nTool output:\n${toolStep?.text || ''}\n\nSummarize the actual result clearly in English. If the output is an error, explain it briefly without suggesting an immediate retry or claiming data was returned. Do not invent values.`
          : `用户问题：${prompt}\n调用工具：${toolStep?.name || ''}\n工具返回：\n${toolStep?.text || ''}\n\n请用中文清晰整理真实结果。如果工具返回错误，只简短说明错误，不要建议立即重试，也不要声称已取得数据。严禁编造数值。`
        const summary = await callChat(provider, model, { prompt: summaryPrompt }, { max_tokens: 1800 }, 180000)
        const text = summary.text || (english ? 'The tool returned no summary.' : '工具已返回，但模型没有生成总结。')
        steps.push({ type: 'assistant', text })
        return ok(res, { answer: text, steps, model, provider: stored.name })
      }
    }
    const answer = english ? 'Tool calls completed without a final summary. Review the tool output below.' : '已完成工具调用，但还没有得到最终总结。请查看下方工具返回。'
    ok(res, { answer, steps, model, provider: stored.name })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── SKILL 技能 ────────────────────────────────────────────────────────
app.get('/api/skills', (_req, res) => ok(res, { skills: listSkills() }))
app.get('/api/skills/model-options', (_req, res) => ok(res, {
  providers: listProviders()
    .filter((provider) => provider.enabled && provider.models.length && (provider.has_key || provider.has_wallet_key || provider.source === 'cli'))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      models: provider.models.map((model) => ({ model: model.model, caps: model.caps || [], protocol: model.protocol || provider.protocol })),
    })),
}))
app.get('/api/skills/agent-tools', (_req, res) => ok(res, { tools: agentSkillTools() }))
app.patch('/api/skills/:id', (req, res) => {
  const skill = setSkillEnabled(req.params.id, req.body?.enabled !== false)
  return skill ? ok(res, { skill }) : fail(res, '技能不存在', 404)
})
app.patch('/api/skills/:id/display', (req, res) => {
  try {
    ok(res, { skill: updateCustomSkillDisplay(req.params.id, String(req.body?.name || ''), typeof req.body?.description === 'string' ? req.body.description : undefined) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/skills', (req, res) => {
  try {
    ok(res, { skill: saveCustomSkill(req.body || {}) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/skills/import', upload.single('package'), (req, res) => {
  try {
    if (!req.file?.buffer) return fail(res, '请选择 .skill.zip 文件')
    ok(res, importSkillPackage(req.file.buffer))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/skills/import-preview', upload.single('package'), (req, res) => {
  try {
    if (!req.file?.buffer) return fail(res, '请选择 ZIP 文件')
    if (!/\.zip$/i.test(req.file.originalname)) return fail(res, '请选择 ZIP 文件')
    ok(res, { candidates: previewSkillPackage(req.file.buffer) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// Agent 解析第三方 Skill：LLM 读文档产出结构化工作流草稿（不落库，等用户确认）
app.post('/api/skills/import-analyze', upload.single('package'), async (req, res) => {
  try {
    if (!req.file?.buffer) return fail(res, '请选择 ZIP 文件')
    if (!/\.zip$/i.test(Buffer.from(req.file.originalname, 'latin1').toString('utf8'))) return fail(res, '请选择 ZIP 文件')
    const sourcePath = req.body?.sourcePath ? String(req.body.sourcePath) : undefined
    const doc = skillDocumentFromPackage(req.file.buffer, sourcePath)
    const analyzed = await analyzeSkillDocument(doc.markdown, doc.sourcePath)
    const draft = {
      ...analyzed.skill,
      source: doc.source,
      ...(typeof doc.allowImplicitInvocation === 'boolean'
        ? { allowImplicitInvocation: doc.allowImplicitInvocation }
        : {}),
    }
    ok(res, { draft, warnings: analyzed.warnings, sourcePath: doc.sourcePath })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
// 用户审核通过后保存（draft 可被用户在前端修改）
app.post('/api/skills/import-confirm', (req, res) => {
  try {
    const draft = req.body?.draft
    if (!draft || typeof draft !== 'object') return fail(res, '缺少解析结果')
    ok(res, { skill: saveCustomSkill(draft as Record<string, never>) })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.get('/api/skill-packs', (_req, res) => ok(res, { packs: listSkillPacks() }))
app.post('/api/skill-packs/import', upload.single('package'), (req, res) => {
  try {
    if (!req.file?.buffer) return fail(res, '请选择 ZIP 文件')
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    if (!/\.zip$/i.test(filename)) return fail(res, '请选择 ZIP 文件')
    ok(res, importRegisteredSkillPack(req.file.buffer, filename))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/skill-packs/import-online/preview', (req, res) => {
  try {
    ok(res, { source: parseOnlineSkillSource(String(req.body?.text || '')) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/skill-packs/import-online', async (req, res) => {
  try {
    ok(res, await importOnlineSkillPack(String(req.body?.text || '')))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.patch('/api/skill-packs/:id/display', (req, res) => {
  try { ok(res, { pack: renameSkillPack(req.params.id, String(req.body?.name || '')) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/skill-packs/:id/translate', async (req, res) => {
  try { ok(res, await translateSkillPackDisplay(req.params.id)) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
// 纯 AI 测试：读取原始 SKILL.md + references，不要求或执行 Python 入口。
app.post('/api/skill-packs/:id/ai-test', async (req, res) => {
  try {
    const instruction = String(req.body?.instruction || '').trim()
    if (!instruction) return fail(res, '请描述要测试的任务')
    const context = readPackSkillContext(req.params.id, req.body?.docPath ? String(req.body.docPath) : undefined)
    ok(res, await runPackAiTest({ instruction, context: context.context, sourceName: context.sourcePath }))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/skill-packs/:id/run', async (req, res) => {
  try {
    const args = Array.isArray(req.body?.args) ? req.body.args.map(String) : []
    ok(res, await runSkillPack(req.params.id, String(req.body?.entryPointId || ''), args))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
// Agent 运行：自然语言指令 → LLM 读 --help 与 SKILL.md 生成参数 → 沙箱执行
app.post('/api/skill-packs/:id/agent-run', async (req, res) => {
  try {
    const entryPointId = String(req.body?.entryPointId || '')
    const instruction = String(req.body?.instruction || '').trim()
    if (!instruction) return fail(res, '请描述要做什么')
    const helpText = await entryPointHelp(req.params.id, entryPointId)
    const docs = listPackSkillDocs(req.params.id)
      .slice(0, 3)
      .map((d) => { try { return readPackSkillDoc(req.params.id, d.path).slice(0, 2500) } catch { return '' } })
      .filter(Boolean).join('\n\n---\n\n')
    const plan = await planPackRunArgs({ instruction, helpText, docs })
    if (plan.blocked) return ok(res, { blocked: plan.blocked, help: helpText.slice(0, 2000) })
    const run = await runSkillPack(req.params.id, entryPointId, plan.args)
    ok(res, { ...run, args: plan.args, note: plan.note })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/skill-packs/:id', (req, res) => {
  const removed = deleteSkillPack(req.params.id)
  return removed ? ok(res, { id: req.params.id }) : fail(res, 'Skill 包不存在', 404)
})
app.get('/api/short-drama/projects', (_req, res) => ok(res, { projects: listDramaProjects() }))
app.post('/api/short-drama/projects', requireAuth, (req, res) => {
  try {
    const project = createDramaProject(String(req.body?.name || ''), req.auth!.user.id)
    emitFsEvent('changed')
    ok(res, { project })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.patch('/api/short-drama/projects/:id', (req, res) => {
  try { ok(res, { project: updateDramaProject(req.params.id, req.body || {}) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/short-drama/projects/:id/outline', async (req, res) => {
  try { ok(res, { project: await generateDramaOutline(req.params.id, Number(req.body?.episodeCount) || 8) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/short-drama/projects/:id/visual-design', async (req, res) => {
  try { ok(res, { project: await generateDramaVisualDesign(req.params.id) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/short-drama/projects/:id/visual-design/:kind/:itemId/images', async (req, res) => {
  try {
    const kind = req.params.kind === 'character' || req.params.kind === 'location' ? req.params.kind : null
    if (!kind) return fail(res, '视觉设定类型无效')
    ok(res, await generateVisualReferenceImage(req.params.id, kind, req.params.itemId))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/short-drama/projects/:id/visual-design/:kind/:itemId/images/:imageId/edit', async (req, res) => {
  try {
    const kind = req.params.kind === 'character' || req.params.kind === 'location' ? req.params.kind : null
    if (!kind) return fail(res, '视觉设定类型无效')
    ok(res, await editVisualReferenceImage(req.params.id, kind, req.params.itemId, req.params.imageId, String(req.body?.instruction || '')))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/short-drama/projects/:id/storyboards', async (req, res) => {
  try { ok(res, { project: await generateDramaStoryboards(req.params.id, typeof req.body?.episodeId === 'string' ? req.body.episodeId : undefined) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/short-drama/projects/:id/shots', (req, res) => {
  try { ok(res, { shot: addDramaShot(req.params.id, req.body || {}) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.patch('/api/short-drama/projects/:id/shots/:shotId', (req, res) => {
  try { ok(res, { shot: updateDramaShot(req.params.id, req.params.shotId, req.body || {}) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/short-drama/projects/:id/shots/:shotId/images', async (req, res) => {
  try { ok(res, await generateDramaShotImage(req.params.id, req.params.shotId)) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/short-drama/projects/:id/shots/:shotId/images/:imageId/edit', async (req, res) => {
  try { ok(res, await editDramaShotImage(req.params.id, req.params.shotId, req.params.imageId, String(req.body?.instruction || ''))) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/skills/:id', (req, res) => {
  try {
    const removed = deleteCustomSkill(req.params.id)
    return removed ? ok(res, { id: req.params.id }) : fail(res, '技能不存在', 404)
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.post('/api/skills/:id/run', async (req, res) => {
  try {
    const b = req.body || {}
    const canvasId = String(b.canvasId || '').trim()
    const auth = canvasId ? getAuth(req) : null
    if (canvasId && !auth) return fail(res, '请先登录', 401)
    if (canvasId && !canEditCanvas(canvasId, auth!.user)) return fail(res, '没有该画布的编辑权限', 403)
    const rootId = canvasId
      ? ensureCanvasOutputFolder(auth!.user.id, canvasId, auth!.user)
      : parentParam(b.rootId)
    const r = await runSkill(req.params.id, b.args || {}, { providerId: b.providerId, model: b.model, imageProviderId: b.imageProviderId, imageModel: b.imageModel, audioProviderId: b.audioProviderId, audioModel: b.audioModel, rootId })
    ok(res, { text: r.text, meta: r.meta, images: r.images, videos: r.videos, audios: r.audios })
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ── 钉钉机器人（OS 原生·多机器人可视化配置）───────────────────────────
app.get('/api/dingtalk/channels', (_req, res) => ok(res, { channels: dtList() }))
app.post('/api/dingtalk/channels', (req, res) => {
  try {
    ok(res, dtSave(req.body || {}))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})
app.delete('/api/dingtalk/channels/:id', (req, res) => {
  const done = dtDelete(req.params.id)
  return done ? ok(res, { id: req.params.id }) : fail(res, '机器人不存在', 404)
})
app.post('/api/dingtalk/send', async (req, res) => {
  const b = req.body || {}
  const r = await dtSend(b.channelId, { text: b.text, title: b.title, markdown: b.markdown })
  return r.ok ? ok(res, r) : fail(res, r.error || '发送失败')
})
app.get('/api/dingtalk/agent/status', (_req, res) => ok(res, { status: getDingTalkAgentStatus() }))
app.get('/api/dingtalk/agent/config', (_req, res) => ok(res, { config: dtAgentConfig() }))
app.post('/api/dingtalk/agent/config', async (req, res) => {
  try {
    const config = dtSaveAgentConfig(req.body || {})
    const env = dtAgentEnv()
    await mcpSaveServer({
      id: 'dingtalk-mcp-96cf', name: '钉钉 MCP', transport: 'stdio', command: 'npx', args: ['-y', 'dingtalk-mcp@latest'],
      env: { DINGTALK_Client_ID: env.clientId, DINGTALK_Client_Secret: env.clientSecret, ROBOT_CODE: env.robotCode, ACTIVE_PROFILES: env.activeProfiles },
      enabled: !!(env.clientId && env.clientSecret),
    })
    ok(res, { config })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/dingtalk/agent/start', async (_req, res) => ok(res, { status: await startDingTalkAgentStream() }))
app.post('/api/dingtalk/agent/stop', (_req, res) => ok(res, { status: stopDingTalkAgentStream() }))
app.post('/api/dingtalk/agent/clear-context', (_req, res) => ok(res, { status: clearDingTalkAgentContexts() }))
app.post('/api/dingtalk/agent/test-ai', async (req, res) => {
  try { ok(res, await testDingTalkAgentAi(req.body?.prompt)) } catch (e) { fail(res, String((e as Error).message || e)) }
})

// ── 夸克网盘（以子进程驱动官方 CLI，登录走浏览器 OAuth）──────────────────
const quarkUploader = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { const dir = join(quarkPaths.workDir, 'uploads'); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); cb(null, dir) },
    // 保留原始文件名（CLI 以本地文件 basename 作为网盘文件名），仅清非法字符；同名加序号避免覆盖。
    filename: (_req, file, cb) => {
      const dir = join(quarkPaths.workDir, 'uploads')
      let name = basename(file.originalname).replace(/[<>:\"/\\|?*\x00-\x1f]/g, '_').trim() || 'file'
      const stem = name.replace(/\.[^.]+$/, '')
      const ext = name.slice(stem.length)
      let candidate = name
      let n = 1
      while (existsSync(join(dir, candidate))) candidate = `${stem} (${n++})${ext}`
      cb(null, candidate)
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
})
app.get('/api/quark/status', async (_req, res) => {
  try { ok(res, await quarkStatus()) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/quark/login', (_req, res) => {
  try { ok(res, quarkStartLogin()) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/quark/logout', async (_req, res) => {
  try { await quarkLogout(); ok(res, { ok: true }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/quark/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    const category = req.query.category != null && String(req.query.category) !== '' ? Number(req.query.category) : undefined
    const result = await quarkSearch(q, category)
    if (q && String(req.query.record || '') === '1') quarkRecordSearch(req.auth!.user.id, q)
    ok(res, result)
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/quark/search-history', (req, res) => {
  try { ok(res, { entries: quarkSearchHistory(req.auth!.user.id) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/quark/search-history/clear', (req, res) => {
  try { quarkClearSearchHistory(req.auth!.user.id); ok(res, { entries: [] }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/quark/browse', async (req, res) => {
  try {
    const pdirFid = String(req.query.pdir_fid || '0')
    ok(res, await quarkBrowse(pdirFid))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/quark/download', async (req, res) => {
  try {
    const fid = String(req.query.fid || '').trim()
    if (!fid) return fail(res, '缺少夸克文件 ID')
    const file = await quarkDownload(fid, join(quarkPaths.downloadDir, randomUUID()))
    res.download(file)
    setTimeout(() => { try { quarkCleanDownloads() } catch { /* ignore */ } }, 0)
  } catch (e) {
    const error = String((e as Error).message || e)
    if (res.headersSent) { res.destroy() } else { fail(res, error) }
  }
})
app.get('/api/quark/download/:fid', async (req, res) => {
  try {
    const outDir = join(quarkPaths.downloadDir, randomUUID())
    const file = await quarkDownload(String(req.params.fid), outDir)
    res.download(file)
    setTimeout(() => { try { quarkCleanDownloads() } catch { /* ignore */ } }, 0)
  } catch (e) {
    const error = String((e as Error).message || e)
    if (res.headersSent) { res.destroy() } else { fail(res, error) }
  }
})
app.post('/api/quark/upload', quarkUploader.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, '未收到文件')
    const parentFid = typeof req.body?.parent_fid === 'string' ? req.body.parent_fid : undefined
    const result = await quarkUpload(parentFid, req.file.path)
    ok(res, result)
  } catch (e) {
    fail(res, String((e as Error).message || e))
  } finally {
    try { if (req.file?.path) unlinkSync(req.file.path) } catch { /* ignore */ }
  }
})

// ── 应用市场：仅在用户明确选择“删除数据”时调用 ──────────────────────
app.get('/api/market/developer-apps', (_req, res) => {
  try { ok(res, { apps: listDeveloperApps() }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/market/version', (_req, res) => {
  ok(res, { systemVersion: DX_OS_VERSION, bridgeVersion: DX_BRIDGE_VERSION, supportedAppFormats: ['dx-app/v2'] })
})
app.get('/api/market/catalog', (_req, res) => {
  try {
    const signing = signingPublicInfo()
    ok(res, { generatedAt: Date.now(), signing: { algorithm: signing.algorithm, keyId: signing.keyId }, releases: localReleaseCatalog() })
  } catch (e) { fail(res, String((e as Error).message || e), 500) }
})
app.get('/api/market/explore', requireAuth, async (req, res) => {
  try { ok(res, await marketplaceExplore(req.query.force === 'true')) }
  catch (e) { fail(res, String((e as Error).message || e), 502) }
})
app.get('/api/market/apps/:id', requireAuth, async (req, res) => {
  try { ok(res, await marketplaceAppDetail(String(req.params.id || ''), req.query.force === 'true')) }
  catch (e) { fail(res, String((e as Error).message || e), 502) }
})
app.get('/api/market/releases/:appId/:version/:build/download', (req, res) => {
  try {
    const channel = req.query.channel === 'beta' || req.query.channel === 'dev' ? req.query.channel : 'stable'
    const release = getAppRelease(String(req.params.appId), String(req.params.version), Number(req.params.build), channel)
    if (!release) return fail(res, 'Release 不存在或已撤回', 404)
    const buffer = readAppReleasePackage(release)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('ETag', `"sha256-${release.sha256}"`)
    res.setHeader('Content-Disposition', `attachment; filename="${release.appId}-${release.version}+${release.build}.zip"`)
    res.send(buffer)
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/updates/check', requireAuth, async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.apps) ? req.body.apps.slice(0, 200) : []
    const apps = raw.map((item: Record<string, unknown>) => ({
      appId: String(item?.appId || ''),
      version: String(item?.version || ''),
      build: Number(item?.build || 0),
      channel: item?.channel === 'beta' || item?.channel === 'dev' ? item.channel : 'stable',
      updateMode: item?.updateMode === 'system' ? 'system' : 'market',
    })) as InstalledAppVersion[]
    ok(res, await checkAppUpdates(apps, req.body?.force === true, req.auth!.user.id))
  } catch (e) { fail(res, String((e as Error).message || e), 502) }
})
app.get('/api/market/catalog/status', requireAuth, async (_req, res) => {
  try {
    const catalog = await appCatalog()
    ok(res, { source: catalog.source, releaseCount: catalog.releases.length, checkedAt: catalog.at })
  } catch (e) { fail(res, String((e as Error).message || e), 502) }
})
app.post('/api/market/developer-apps/:id/install', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '')
    if (!/^[a-z][a-z0-9-]{1,100}$/.test(id)) return fail(res, 'APP ID 不合法', 400)
    const channel = req.body?.channel === 'beta' || req.body?.channel === 'dev' ? req.body.channel : 'stable'
    const publicStableInstall = channel === 'stable' && PUBLIC_STABLE_APP_IDS.has(id)
    if (!publicStableInstall) {
      const cloud = await cloudAccountStatus(req.auth!.user.id)
      if (!cloud.loggedIn) return fail(res, '下载应用市场 APP 前，请先连接 DX OS 在线账号', 401)
      if (!cloud.online) return fail(res, '暂时无法在线验证 DX OS 账号，请稍后重试', 503)
    }
    const installedApp = listDeveloperApps().find((item) => item.id === id)
    if (installedApp) {
      const health = healthCheckDeveloperApp(installedApp.id)
      if (!health.ok) return fail(res, `已安装 APP 健康检查失败：${health.checks.filter((check) => !check.ok).map((check) => check.detail).join('；')}`, 409)
      setAppInstalled(req.auth!.user.id, installedApp.id, true, installedApp.manifest)
      return ok(res, { app: installedApp, release: null, health, reused: true })
    }
    const version = String(req.body?.version || '')
    const build = Number(req.body?.build || 0)
    const { release, catalogSource } = await catalogRelease(id, version, build, channel)
    if (!releaseAvailableToAudience(release, req.auth!.user.id)) throw new Error('当前账户不在该 Release 的灰度范围内')
    const buffer = await downloadCatalogRelease(release, catalogSource)
    const app = importDeveloperApp(buffer, `${id}-${version}.zip`, {
      expectedAppId: id,
      expectedVersion: version,
      expectedBuild: build,
      trustedPackageId: id,
    })
    const health = healthCheckDeveloperApp(app.id)
    if (!health.ok) {
      try { deleteDeveloperApp(app.id) } catch { /* best effort */ }
      throw new Error(`APP 健康检查失败，已移除安装包：${health.checks.filter((check) => !check.ok).map((check) => check.detail).join('；')}`)
    }
    setAppInstalled(req.auth!.user.id, app.id, true, app.manifest)
    ok(res, { app, release, health })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-apps/:id/update', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '')
    const channel = req.body?.channel === 'beta' || req.body?.channel === 'dev' ? req.body.channel : 'stable'
    const current = listDeveloperApps().find((item) => item.id === id)
    if (!current) return fail(res, '开发者 APP 尚未安装', 404)
    const version = String(req.body?.version || '')
    const build = Number(req.body?.build || 0)
    const { release, catalogSource } = await catalogRelease(id, version, build, channel)
    if (!releaseAvailableToAudience(release, req.auth!.user.id)) throw new Error('当前账户不在该 Release 的灰度范围内')
    const historyBefore = new Set(listDeveloperAppHistory(id).map((item) => item.historyId))
    const buffer = await downloadCatalogRelease(release, catalogSource)
    const simulation = simulateDeveloperAppInstall(buffer)
    const migrationChain = [] as Array<{ from: number; to: number; type: 'declarative'; file: string }>
    if (simulation.dataVersion !== current.manifest.dataVersion) {
      if (simulation.dataVersion < current.manifest.dataVersion) throw new Error(`更新不能降低 dataVersion：${current.manifest.dataVersion} → ${simulation.dataVersion}`)
      let cursor = current.manifest.dataVersion
      while (cursor < simulation.dataVersion) {
        const migration = simulation.migrations.find((item) => item.from === cursor && item.to === cursor + 1)
        if (!migration) throw new Error(`缺少声明式数据迁移：${cursor} → ${cursor + 1}`)
        migrationChain.push(migration)
        cursor += 1
      }
    }
    const app = importDeveloperApp(buffer, `${id}-${version}.zip`, {
      expectedAppId: id,
      expectedVersion: version,
      expectedBuild: build,
      trustedPackageId: current.id === current.manifest.id ? current.id : undefined,
      allowDataVersionChange: migrationChain.length > 0,
    })
    const health = healthCheckDeveloperApp(app.id)
    if (!health.ok) {
      const rollbackTarget = listDeveloperAppHistory(id).find((item) => !historyBefore.has(item.historyId))
      if (!rollbackTarget) throw new Error(`新版本健康检查失败且没有可用回滚点：${health.checks.filter((check) => !check.ok).map((check) => check.detail).join('；')}`)
      rollbackDeveloperApp(id, rollbackTarget.historyId)
      pruneDeveloperAppHistory(id, 1)
      throw new Error(`新版本健康检查失败，已自动恢复 ${rollbackTarget.version} (${rollbackTarget.build})：${health.checks.filter((check) => !check.ok).map((check) => check.detail).join('；')}`)
    }
    const runtimeRollbackTarget = listDeveloperAppHistory(id).find((item) => !historyBefore.has(item.historyId))
    if (!runtimeRollbackTarget) throw new Error('新版本已安装，但没有生成运行时健康检查所需的回滚点')
    if (migrationChain.length) {
      const ownerRows = ccsDb.prepare('SELECT DISTINCT user_id AS userId FROM user_installed_apps WHERE app_id=?').all(id) as Array<{ userId: string }>
      const ownerIds = [...new Set([req.auth!.user.id, ...ownerRows.map((row) => row.userId)])]
      const roots = ownerIds.map((ownerId) => ({ ownerId, root: ensureDeveloperProjectRoot(id, ownerId) }))
      try {
        for (const item of roots) saveDeveloperProjectSnapshot(id, runtimeRollbackTarget.historyId, item.ownerId, item.root.id)
        const documents = migrationChain.map((migration) => ({ migration, document: JSON.parse(readFileSync(developerAppFilePath(id, migration.file), 'utf8')) }))
        for (const item of roots) {
          for (const { migration, document } of documents) applyDeclarativeProjectMigration(item.root.id, item.ownerId, document, migration.from, migration.to)
        }
      } catch (error) {
        if (hasDeveloperProjectSnapshots(id, runtimeRollbackTarget.historyId)) restoreDeveloperProjectSnapshots(id, runtimeRollbackTarget.historyId)
        rollbackDeveloperApp(id, runtimeRollbackTarget.historyId, { allowDataVersionChange: true })
        pruneDeveloperAppHistory(id, 1)
        throw new Error(`dataVersion 迁移失败，已恢复旧版本和项目快照：${String((error as Error).message || error)}`)
      }
    }
    beginDeveloperAppRuntimeObservation(id, runtimeRollbackTarget.historyId)
    setAppInstalled(req.auth!.user.id, app.id, true, app.manifest)
    ok(res, { app, release, health, runtimeHealth: { status: 'pending' } })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.get('/api/market/developer-apps/:id/history', requireAuth, (req, res) => {
  try { ok(res, { history: pruneDeveloperAppHistory(String(req.params.id), 1) }) }
  catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-apps/:id/health', requireAuth, (req, res) => {
  try { ok(res, { health: healthCheckDeveloperApp(String(req.params.id)) }) }
  catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-apps/:id/runtime-health', requireAuth, (req, res) => {
  try {
    const status = req.body?.status === 'error' ? 'error' : req.body?.status === 'ready' ? 'ready' : ''
    if (!status) return fail(res, '运行时健康状态必须是 ready 或 error', 400)
    const appId = String(req.params.id)
    const current = developerProjectPackage(appId)
    const detail = String(req.body?.detail || '')
    const result = reportDeveloperAppRuntimeHealth(appId, status, detail)
    recordAppRuntimeEvent({ appId, version: current.manifest.version, build: current.manifest.build, userId: req.auth!.user.id, eventType: status === 'ready' ? 'runtime.ready' : result.rolledBack ? 'runtime.crash.rollback' : 'runtime.error', detail })
    if (result.rolledBack && result.app) setAppInstalled(req.auth!.user.id, result.app.id, true, result.app.manifest)
    ok(res, result)
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.get('/api/market/developer-apps/:id/diagnostics', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id)
    const pack = developerProjectPackage(appId)
    const release = getAppRelease(appId, pack.manifest.version, pack.manifest.build, pack.manifest.releaseChannel)
    if (!['admin', 'superadmin'].includes(req.auth!.user.role) && release?.publisherUserId !== req.auth!.user.id) return fail(res, '只能查看自己发布 APP 的诊断', 403)
    ok(res, appRuntimeDiagnostics(appId, Number(req.query.days) || 30))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-apps/:id/rollback', requireAuth, (req, res) => {
  try {
    const id = String(req.params.id)
    const historyId = String(req.body?.historyId || '')
    const hasProjectSnapshot = hasDeveloperProjectSnapshots(id, historyId)
    const result = rollbackDeveloperApp(id, historyId, { allowDataVersionChange: hasProjectSnapshot })
    if (hasProjectSnapshot) saveForwardDeveloperProjectSnapshots(id, historyId, result.backupHistoryId)
    const restoredProjects = hasProjectSnapshot ? restoreDeveloperProjectSnapshots(id, historyId) : []
    pruneDeveloperAppHistory(id, 1)
    setAppInstalled(req.auth!.user.id, result.app.id, true, result.app.manifest)
    ok(res, { ...result, restoredProjects })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-lab/:id/publish', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    if (!developerProjectForDraft(req.auth!.user.id, req.params.id)) return fail(res, '只能发布当前账户项目中的 APP', 403)
    const { buffer } = developerLabZip(req.params.id)
    const simulation = simulateDeveloperAppInstall(buffer)
    const manifestAppId = simulation.appId.replace(/^dev-/, '')
    const trustedTarget = listDeveloperApps().find((item) => item.id === manifestAppId && !item.id.startsWith('dev-'))
    if (trustedTarget && req.auth!.user.role !== 'superadmin') return fail(res, '更新内置商店 APP 需要超级管理员权限', 403)
    const release = publishAppRelease({
      buffer,
      publisherUserId: req.auth!.user.id,
      trustedAppId: trustedTarget?.id,
      channel: req.body?.channel,
      releaseNotes: req.body?.releaseNotes,
      mandatory: req.body?.mandatory === true,
      rolloutPercent: req.body?.rolloutPercent,
      reviewStatus: ['admin', 'superadmin'].includes(req.auth!.user.role) || (req.body?.channel || simulation.releaseChannel) === 'dev' ? 'approved' : 'pending',
    })
    invalidateAppCatalog()
    const signing = signingPublicInfo()
    ok(res, { release: publicAppRelease(release), signing: { algorithm: signing.algorithm, keyId: signing.keyId } })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/releases/:appId/:version/:build/revoke', requireAuth, (req, res) => {
  try {
    const channel = req.body?.channel === 'beta' || req.body?.channel === 'dev' ? req.body.channel : 'stable'
    const release = getAppRelease(String(req.params.appId), String(req.params.version), Number(req.params.build), channel)
    if (!release) return fail(res, 'Release 不存在或已撤回', 404)
    if (release.publisherUserId !== req.auth!.user.id && !['admin', 'superadmin'].includes(req.auth!.user.role)) return fail(res, '只能撤回自己发布的 Release', 403)
    const revoked = revokeAppRelease(release.appId, release.version, release.build, release.channel)
    invalidateAppCatalog()
    ok(res, { release: publicAppRelease(revoked) })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/releases/:appId/:version/:build/review', requireAuth, (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.auth!.user.role)) return fail(res, '只有管理员可以审核 Release', 403)
    const channel = req.body?.channel === 'beta' || req.body?.channel === 'dev' ? req.body.channel : 'stable'
    const decision = req.body?.decision === 'rejected' ? 'rejected' : req.body?.decision === 'approved' ? 'approved' : ''
    if (!decision) return fail(res, '审核结果必须是 approved 或 rejected', 400)
    const release = reviewAppRelease(String(req.params.appId), String(req.params.version), Number(req.params.build), channel, decision, req.auth!.user.id)
    invalidateAppCatalog()
    ok(res, { release: publicAppRelease(release) })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})

// ── DX Developer：直接复用“项目文件”Agent / Worker / Skill / MCP ──
const DEVELOPER_AGENT_MARKER = '.dx-developer-task.json'
const DEVELOPER_TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.txt', '.md', '.svg'])
type DeveloperAgentMarker = { taskId: string; projectId: string; name: string; instruction: string; kind: 'software' | 'skill' | 'mcp'; createdAt: number; guideVersion?: string; draftId?: string }

function developerGuideInstruction(kind: DeveloperAgentMarker['kind'], userInstruction: string, continuationInstruction = '') {
  return [
    `使用项目 Agent 的文件工具、可用 Skill 和 MCP，在当前项目根目录完成以下 ${kind === 'software' ? 'APP' : kind.toUpperCase()} 开发任务。你可以自主决定调用哪些工具和 Skill，并应逐文件创建、读取、修改和验证。`,
    `原始用户需求：${userInstruction}`,
    continuationInstruction ? `本轮追加要求：${continuationInstruction}` : '',
    `以下是必须完整遵守的 DX OS 开发文档，规范版本 ${DEVELOPER_GUIDE_VERSION}：\n\n${developerGuideFor(kind)}`,
    '完成前必须运行并通过当前项目的 Harness/安装清单检查。不得以 Agent 自述代替真实检查结果；任何 fail 都表示任务尚未完成。',
  ].filter(Boolean).join('\n\n')
}

function readDeveloperAgentMarker(rootId: string): { node: NonNullable<ReturnType<typeof getNode>>; marker: DeveloperAgentMarker } | null {
  const node = findByPath(rootId, DEVELOPER_AGENT_MARKER)
  if (!node?.content) return null
  try { return { node, marker: JSON.parse(node.content) as DeveloperAgentMarker } } catch { return null }
}

function developerAgentFiles(rootId: string) {
  const files: Array<{ path: string; content: string; nodeId: string }> = []
  const walk = (folderId: string, prefix = '') => {
    for (const node of listChildren(folderId).nodes) {
      if (node.name.startsWith('.')) continue
      const path = prefix ? `${prefix}/${node.name}` : node.name
      if (node.type === 'folder') walk(node.id, path)
      else if (typeof node.content === 'string' && DEVELOPER_TEXT_EXTENSIONS.has(extname(node.name).toLowerCase())) files.push({ path, content: node.content, nodeId: node.id })
    }
  }
  walk(rootId)
  return files
}

function normalizeDeveloperAgentAppId(files: ReturnType<typeof developerAgentFiles>, task: TaskView) {
  const manifestFile = files.find((file) => file.path === 'dx-app.json')
  if (!manifestFile) return files
  let manifest: Record<string, unknown>
  try { manifest = JSON.parse(manifestFile.content) as Record<string, unknown> } catch { return files }
  const oldId = String(manifest.id || '').trim()
  const validId = /^[a-z][a-z0-9-]{2,42}$/.test(oldId)
  let appId = validId ? oldId : oldId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!validId && !/^[a-z]/.test(appId)) appId = `dx-app-${appId || task.id.replace(/-/g, '').slice(0, 12)}`
  appId = appId.slice(0, 43).replace(/-+$/g, '')
  if (appId.length < 3) appId = `dx-app-${task.id.replace(/-/g, '').slice(0, 12)}`
  const needsIcon = !manifest.icon
  const needsLifecycle = !isValidSemver(manifest.version) || !Number.isSafeInteger(Number(manifest.build)) || Number(manifest.build) < 1 || !isValidSemver(manifest.minSystemVersion)
  if (validId && !needsIcon && !needsLifecycle) return files
  for (const file of files) {
    let content = !validId && oldId ? file.content.split(oldId).join(appId) : file.content
    if (file.path === 'dx-app.json') {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>
        parsed.id = appId
        if (!parsed.icon) parsed.icon = autoDeveloperIcon(String(parsed.name || ''), appId)
        if (!isValidSemver(parsed.version)) parsed.version = DEFAULT_DEVELOPER_APP_VERSION
        if (!Number.isSafeInteger(Number(parsed.build)) || Number(parsed.build) < 1) parsed.build = DEFAULT_DEVELOPER_APP_BUILD
        if (parsed.releaseChannel !== 'stable' && parsed.releaseChannel !== 'beta' && parsed.releaseChannel !== 'dev') parsed.releaseChannel = 'dev'
        if (!isValidSemver(parsed.minSystemVersion)) parsed.minSystemVersion = DX_OS_VERSION
        if (!Number.isSafeInteger(Number(parsed.dataVersion)) || Number(parsed.dataVersion) < 1) parsed.dataVersion = 1
        content = JSON.stringify(parsed, null, 2)
      } catch { /* 草稿校验会返回准确的 JSON 错误 */ }
    }
    if (content !== file.content) {
      file.content = content
      setContent(file.nodeId, content)
    }
  }
  appendTaskEvent(task.id, 'developer.manifest_repaired', !validId ? `已将不合规的 APP ID 修复为 ${appId}` : needsIcon ? '已为应用补充自动生成图标' : '已补充 APP 版本与数据版本字段', { oldId, appId, iconGenerated: needsIcon, lifecycleGenerated: needsLifecycle })
  return files
}

function developerAgentDraft(rootId: string, task: TaskView, markerRecord: ReturnType<typeof readDeveloperAgentMarker>, ownerId: string) {
  if (!markerRecord) return undefined
  if (markerRecord.marker.draftId) {
    try { return getDeveloperLabDraft(markerRecord.marker.draftId) } catch { /* rebuild below */ }
  }
  if (task.status !== 'completed') return undefined
  const files = normalizeDeveloperAgentAppId(developerAgentFiles(rootId), task)
  const draft = createDeveloperLabDraft({ files: files.map(({ path, content }) => ({ path, content })), summary: task.result || '由项目 Agent 创建的 DX OS APP；是否可安装以 Harness 结果为准。', ownerId })
  markerRecord.marker.draftId = draft.id
  setContent(markerRecord.node.id, JSON.stringify(markerRecord.marker, null, 2))
  return draft
}

function publicDeveloperAgentJob(task: TaskView, rootId: string, markerRecord: NonNullable<ReturnType<typeof readDeveloperAgentMarker>>, userId: string) {
  let draft: ReturnType<typeof createDeveloperLabDraft> | undefined
  let conversionError = ''
  try { draft = developerAgentDraft(rootId, task, markerRecord, userId) } catch (error) { conversionError = String((error as Error).message || error) }
  const running = ['queued', 'planning', 'running', 'verifying'].includes(task.status)
  const blockingChecks = draft?.checks.filter((check) => check.status === 'fail') || []
  const guideOutdated = markerRecord.marker.guideVersion !== DEVELOPER_GUIDE_VERSION
  const harnessError = blockingChecks.length ? `Harness 检查未通过：${blockingChecks.map((check) => `${check.label}：${check.detail}`).join('；')}` : ''
  const guideError = guideOutdated ? `项目使用的开发规范版本 ${markerRecord.marker.guideVersion || '未记录'} 已过期；请继续开发或执行安装修复，以规范 ${DEVELOPER_GUIDE_VERSION} 重新检查。` : ''
  const failed = ['failed', 'interrupted', 'waiting_user'].includes(task.status) || !!conversionError || !running && (!!harnessError || !!guideError)
  const terminalFailed = ['failed', 'interrupted'].includes(task.status)
  const eventSteps = task.events.map((event) => {
    const recoveredFailure = event.type === 'step.failed' || event.type === 'task.failed' && !terminalFailed
    return {
      id: `event-${event.id}`,
      label: recoveredFailure ? '执行过程中出现问题' : event.message || event.type,
      status: event.type === 'task.failed' && terminalFailed ? 'error' : recoveredFailure || event.type === 'task.waiting_user' ? 'warn' : 'done',
      detail: recoveredFailure ? event.message : event.type,
      error: event.type === 'task.failed' && terminalFailed ? event.message : undefined,
      startedAt: event.created_at, finishedAt: event.created_at,
    }
  })
  const toolSteps = task.steps.map((step) => {
    let toolError = ''
    if (step.status === 'failed') {
      try { toolError = String((JSON.parse(step.output_json || '{}') as { error?: string }).error || '') } catch { /* 使用下方兜底 */ }
    }
    return {
      id: step.id, label: step.title || step.tool_name,
      status: step.status === 'completed' ? 'done' : step.status === 'failed' ? 'warn' : step.status === 'running' ? 'running' : 'pending',
      detail: step.status === 'failed' ? toolError || `${step.tool_name} 调用未成功，Agent 已继续处理` : step.tool_name,
    }
  })
  const history = projectHistory(task.project_id, userId)
  const messages = history.messages
    .filter((message) => message.thread_id === task.thread_id)
    .map((message) => ({
      id: message.id, role: message.role, taskId: message.task_id, createdAt: message.created_at,
      content: message.role === 'user' && message.content === task.instruction ? markerRecord.marker.instruction : message.content,
    }))
  const harnessStep = draft ? [{
    id: `harness-${draft.id}`,
    label: 'Harness 与安装清单检查',
    status: blockingChecks.length ? 'error' as const : 'done' as const,
    detail: blockingChecks.length ? harnessError : '所有阻断检查均已通过',
    error: blockingChecks.length ? harnessError : undefined,
    startedAt: task.updated_at, finishedAt: task.updated_at,
  }] : []
  return {
    id: task.id, name: markerRecord.marker.name, instruction: markerRecord.marker.instruction, kind: markerRecord.marker.kind,
    projectId: task.project_id, threadId: task.thread_id, messages,
    status: running ? 'running' : failed ? 'error' : task.status === 'completed' ? 'done' : 'cancelled',
    createdAt: task.created_at, updatedAt: task.updated_at, steps: [...eventSteps, ...toolSteps, ...harnessStep], draft,
    guideVersion: markerRecord.marker.guideVersion, currentGuideVersion: DEVELOPER_GUIDE_VERSION, guideOutdated,
    error: conversionError || harnessError || guideError || task.error_message || (task.status === 'waiting_user' ? task.waiting_question || 'Agent 正在等待用户回答' : undefined),
  }
}

function listDeveloperAgentJobs(userId: string) {
  const jobs = []
  for (const project of listProjects(userId)) {
    const root = getNode(project.root_node_id)
    if (!root || root.type !== 'folder') continue
    const marker = readDeveloperAgentMarker(root.id)
    if (!marker) continue
    const task = getTask(marker.marker.taskId)
    if (task?.created_by === userId) jobs.push(publicDeveloperAgentJob(task, root.id, marker, userId))
  }
  return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
}

function developerProjectForDraft(userId: string, draftId: string) {
  for (const project of listProjects(userId)) {
    const root = getNode(project.root_node_id)
    if (!root || root.type !== 'folder') continue
    const marker = readDeveloperAgentMarker(root.id)
    if (marker?.marker.draftId === draftId) return { project, root, marker }
  }
  return null
}

function requireOwnedDeveloperDraft(userId: string, draftId: string) {
  const draft = getDeveloperLabDraft(draftId)
  if (draft.ownerId === userId) return draft
  if (!draft.ownerId && developerProjectForDraft(userId, draftId)) return setDeveloperLabDraftOwner(draftId, userId)
  throw new Error('无权访问其他账户的开发项目')
}

function listOwnedDeveloperDrafts(userId: string) {
  return listDeveloperLabDrafts().flatMap((draft) => {
    if (draft.ownerId === userId) return [draft]
    if (!draft.ownerId && developerProjectForDraft(userId, draft.id)) return [setDeveloperLabDraftOwner(draft.id, userId)]
    return []
  })
}

function syncDeveloperDraftManifest(userId: string, draftId: string) {
  const linked = developerProjectForDraft(userId, draftId)
  if (!linked) return
  const node = findByPath(linked.root.id, 'dx-app.json')
  if (!node || node.type !== 'file') throw new Error('项目中的 dx-app.json 不存在')
  setContent(node.id, readDeveloperLabFile(draftId, 'dx-app.json').content)
}

app.post('/api/market/developer-lab/generate', requireAuth, (req, res) => {
  try {
    const instruction = String(req.body?.instruction || '').trim().slice(0, 5000)
    const kind = (['software', 'skill', 'mcp'].includes(String(req.body?.kind)) ? String(req.body.kind) : 'software') as DeveloperAgentMarker['kind']
    if (!instruction) return fail(res, '请输入 APP 开发需求', 400)
    const name = instruction.replace(/\s+/g, ' ').slice(0, 28) || '新建项目'
    const projectsRoot = ensureCanvasRoot(req.auth!.user.id)
    const folder = createNode({ name, type: 'folder', parentId: projectsRoot.id, ownerId: req.auth!.user.id })
    const project = createProject({ name: folder.name, rootNodeId: folder.id, createdBy: req.auth!.user.id })
    const agentInstruction = developerGuideInstruction(kind, instruction)
    const task = createProjectTask({ projectId: project.id, createdBy: req.auth!.user.id, title: name, instruction: agentInstruction, userMessage: instruction, executionProfile: 'thinking' })
    const marker: DeveloperAgentMarker = { taskId: task.id, projectId: project.id, name: folder.name, instruction, kind, createdAt: Date.now(), guideVersion: DEVELOPER_GUIDE_VERSION }
    const markerNode = createNode({ name: DEVELOPER_AGENT_MARKER, type: 'file', parentId: folder.id, ownerId: req.auth!.user.id, content: JSON.stringify(marker, null, 2) })
    ok(res, { job: publicDeveloperAgentJob(task, folder.id, { node: markerNode, marker }, req.auth!.user.id) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.get('/api/market/developer-lab/jobs', requireAuth, (req, res) => {
  try { ok(res, { jobs: listDeveloperAgentJobs(req.auth!.user.id) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/market/developer-lab/jobs/:jobId/messages', requireAuth, (req, res) => {
  try {
    const userId = req.auth!.user.id
    const task = getTask(String(req.params.jobId))
    if (!task || task.created_by !== userId) return fail(res, '开发项目不存在', 404)
    const message = String(req.body?.message || '').trim().slice(0, 5000)
    if (!message) return fail(res, '消息不能为空', 400)
    if (['queued', 'planning', 'running', 'verifying'].includes(task.status)) return fail(res, 'Agent 正在执行，请先停止或等待完成', 409)
    const project = getProject(task.project_id)
    if (!project?.root_node_id) return fail(res, '开发项目文件夹不存在', 404)
    const marker = readDeveloperAgentMarker(project.root_node_id)
    if (!marker || marker.marker.taskId !== task.id) return fail(res, '开发项目标记不存在', 404)
    refreshTaskInstruction(task.id, userId, developerGuideInstruction(marker.marker.kind, marker.marker.instruction, message))
    if (task.status === 'waiting_user') answerTask(task.id, userId, message)
    else continueTask(task.id, userId, message)
    marker.marker.guideVersion = DEVELOPER_GUIDE_VERSION
    if (marker.marker.draftId) {
      try { deleteDeveloperLabDraft(marker.marker.draftId) } catch { /* 草稿可能已被手动删除 */ }
      delete marker.marker.draftId
    }
    setContent(marker.node.id, JSON.stringify(marker.marker, null, 2))
    ok(res, { job: publicDeveloperAgentJob(getTask(task.id)!, project.root_node_id, marker, userId) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/market/developer-lab/jobs/:jobId/stop', requireAuth, (req, res) => {
  try {
    const userId = req.auth!.user.id
    const task = getTask(String(req.params.jobId))
    if (!task || task.created_by !== userId) return fail(res, '开发项目不存在', 404)
    if (!['queued', 'planning', 'running', 'verifying'].includes(task.status)) return fail(res, '当前没有正在运行的开发任务', 409)
    cancelTask(task.id)
    postTaskMessage(task.id, 'system', '已停止当前执行，项目文件和对话历史已保留。')
    const project = getProject(task.project_id)
    if (!project?.root_node_id) return fail(res, '开发项目文件夹不存在', 404)
    const marker = readDeveloperAgentMarker(project.root_node_id)
    if (!marker) return fail(res, '开发项目标记不存在', 404)
    ok(res, { job: publicDeveloperAgentJob(getTask(task.id)!, project.root_node_id, marker, userId) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/market/developer-lab/jobs/:jobId', requireAuth, (req, res) => {
  try {
    const task = getTask(String(req.params.jobId))
    if (!task || task.created_by !== req.auth!.user.id) return fail(res, '生成任务不存在', 404)
    const project = getProject(task.project_id)
    const marker = project?.root_node_id ? readDeveloperAgentMarker(project.root_node_id) : null
    if (['queued', 'planning', 'running', 'verifying', 'waiting_user', 'paused', 'interrupted', 'failed'].includes(task.status)) {
      if (!['cancelled', 'completed'].includes(task.status)) cancelTask(task.id)
    }
    deleteTask(task.id)
    if (marker?.marker.draftId) {
      try { deleteDeveloperLabDraft(marker.marker.draftId) } catch { /* 草稿可能已不存在 */ }
    }
    if (project?.root_node_id) purgeNode(project.root_node_id)
    ok(res, { deleted: true })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.post('/api/market/developer-lab/examples/gomoku', requireAuth, (req, res) => {
  try {
    const draft = createDeveloperLabDraft({ files: gomokuDeveloperLabFiles(), summary: '可运行、可保存对局并适配 DX OS 主题和语言的五子棋验收项目。', ownerId: req.auth!.user.id })
    ok(res, { draft })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

function developerLabRealtimeAppId(draftId: string) { return `developer-lab:${draftId}` }

function developerCollabDirectory(userId: string) {
  const departments = listAuthDepartments()
  const names = new Map(departments.map((department) => [department.id, department.name]))
  const users = listAuthUsers()
    .filter((user) => user.status !== 'disabled' && user.id !== userId)
    .map((user) => ({ id: user.id, username: user.username, department: user.departmentId ? names.get(user.departmentId) || '' : '' }))
  return { users, departments: departments.map((department) => ({ id: department.id, name: department.name })) }
}

function syncDeveloperCollabRoom(appId: string, projectId: string, userId: string) {
  const { project, access, allowedUserIds } = developerCollabRoomAccess(appId, projectId, userId)
  const room = ensureDeveloperRealtimeRoom(appId, project.id, project.owner_id, {
    name: project.name,
    maxMembers: 32,
    state: { projectId: project.id, version: project.version, updatedAt: project.updated_at },
    allowedUserIds,
  })
  return { room, access }
}

function runDeveloperCollabAction(appId: string, userId: string, body: Record<string, unknown>) {
  const action = String(body.action || '')
  if (action === 'collab.project.create') return { project: createDeveloperCollabProject(appId, userId, body) }
  if (action === 'collab.project.list') return { projects: listDeveloperCollabProjects(appId, userId) }
  if (action === 'collab.project.directory') return developerCollabDirectory(userId)
  if (action === 'collab.project.invite.redeem') {
    const project = redeemDeveloperCollabInvite(appId, userId, body.code)
    syncDeveloperCollabRoom(appId, project.id, userId)
    return { project }
  }
  const projectId = String(body.projectId || '')
  if (!projectId) throw new Error('缺少协同项目 ID')
  if (action === 'collab.project.get') return { project: getDeveloperCollabProject(appId, projectId, userId) }
  if (action === 'collab.project.update') {
    let project
    try { project = updateDeveloperCollabProject(appId, projectId, userId, body) }
    catch (error) {
      const conflict = error as Error & { code?: string; current?: unknown }
      if (conflict.code === 'VERSION_CONFLICT') return { conflict: true, code: conflict.code, error: conflict.message, current: conflict.current }
      throw error
    }
    syncDeveloperCollabRoom(appId, projectId, userId)
    updateDeveloperRealtimeRoomState(appId, projectId, { projectId, version: project.version, updatedAt: project.updatedAt })
    return { project }
  }
  if (action === 'collab.project.members.set') {
    const project = setDeveloperCollabMembers(appId, projectId, userId, body.members)
    syncDeveloperCollabRoom(appId, projectId, userId)
    return { project }
  }
  if (action === 'collab.project.invite.create') return createDeveloperCollabInvite(appId, projectId, userId, body.access)
  if (action === 'collab.project.invite.revoke') return revokeDeveloperCollabInvite(appId, projectId, userId)
  if (action === 'collab.project.connect') return syncDeveloperCollabRoom(appId, projectId, userId)
  if (action === 'collab.project.delete') {
    closeDeveloperRealtimeRoomSystem(appId, projectId)
    return deleteDeveloperCollabProject(appId, projectId, userId)
  }
  throw new Error(`不支持的协同项目动作：${action}`)
}

function sendDeveloperCollabResult(res: express.Response, work: () => object) {
  try { ok(res, work()) }
  catch (error) {
    const detail = error as Error
    fail(res, String(detail.message || detail), 400)
  }
}

app.post('/api/market/developer-lab/:id/collab', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    sendDeveloperCollabResult(res, () => runDeveloperCollabAction(developerLabRealtimeAppId(req.params.id), req.auth!.user.id, req.body || {}))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})

app.get('/api/market/developer-lab/:id/realtime/rooms', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    ok(res, { rooms: listDeveloperRealtimeRooms(developerLabRealtimeAppId(req.params.id), req.auth!.user.id) })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-lab/:id/realtime/rooms', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    ok(res, { room: createDeveloperRealtimeRoom(developerLabRealtimeAppId(req.params.id), req.auth!.user.id, req.body || {}) })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-lab/:id/realtime/rooms/:roomId/close', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    ok(res, closeDeveloperRealtimeRoom(developerLabRealtimeAppId(req.params.id), String(req.params.roomId), req.auth!.user.id))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})

app.get('/api/market/developer-lab/:id', requireAuth, (req, res) => {
  try { ok(res, { draft: requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id) }) } catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.delete('/api/market/developer-lab/:id', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    ok(res, { deleted: deleteDeveloperLabDraft(req.params.id) })
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.get('/api/market/developer-lab', requireAuth, (req, res) => {
  try { ok(res, { drafts: listOwnedDeveloperDrafts(req.auth!.user.id) }) } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/market/developer-lab/:id/file', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    ok(res, { file: readDeveloperLabFile(req.params.id, String(req.query.path || '')) })
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.put('/api/market/developer-lab/:id/file', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    const path = String(req.body?.path || '')
    const content = String(req.body?.content ?? '')
    const draft = writeDeveloperLabFile(req.params.id, path, content)
    const linked = developerProjectForDraft(req.auth!.user.id, req.params.id)
    if (linked) {
      const node = findByPath(linked.root.id, path)
      if (!node || node.type !== 'file') throw new Error('项目源文件不存在，无法同步保存')
      setContent(node.id, content)
    }
    ok(res, { draft })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/market/developer-lab/:id/icon/auto', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    const draft = setDeveloperLabIcon(req.params.id)
    syncDeveloperDraftManifest(req.auth!.user.id, req.params.id)
    ok(res, { draft })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/market/developer-lab/:id/icon', requireAuth, upload.single('icon'), (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    if (!req.file?.buffer) return fail(res, '请选择 SVG 或 PNG 图标')
    const filename = String(req.file.originalname || '').toLowerCase()
    const gradient = String(req.body?.gradient || 'linear-gradient(145deg,#0a84ff,#5856d6)')
    const icon = filename.endsWith('.svg') || req.file.mimetype === 'image/svg+xml'
      ? { gradient, svg: sanitizeDeveloperSvg(req.file.buffer.toString('utf8')) }
      : filename.endsWith('.png') || req.file.mimetype === 'image/png'
        ? { gradient, image: pngDataUrl(req.file.buffer) }
        : null
    if (!icon) return fail(res, '图标只支持 SVG 或 PNG', 415)
    const draft = setDeveloperLabIcon(req.params.id, icon)
    syncDeveloperDraftManifest(req.auth!.user.id, req.params.id)
    ok(res, { draft })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/market/developer-lab/:id/download', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    const { draft, buffer } = developerLabZip(req.params.id)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${draft.appId}.zip"`)
    res.send(buffer)
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})
function developerInstallDiagnostic(error: unknown) {
  const message = String((error as Error)?.message || error || '未知安装错误')
  const projectIssue = /开发者应用包错误|dx-app\.json|入口文件|权限|依赖|MCP|Skill|不安全路径|越界|压缩包|文件类型/i.test(message)
  return {
    source: projectIssue ? 'project' as const : 'platform' as const,
    repairable: projectIssue,
    message,
    agentPrompt: projectIssue
      ? `正式安装器未通过，错误如下：\n${message}\n\n请在当前项目中定位并修复这个安装问题。必须保留现有功能，读取 dx-app.json、入口和相关配置后按 DX OS 开发规范修改；不要绕过校验。完成前重新检查清单、文件大小、相对路径、权限、Skill/MCP 声明和资源引用。`
      : '',
  }
}
app.post('/api/market/developer-lab/:id/simulate-install', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    const { buffer } = developerLabZip(req.params.id)
    ok(res, { simulation: simulateDeveloperAppInstall(buffer) })
  } catch (e) { ok(res, { diagnostic: developerInstallDiagnostic(e) }) }
})
app.post('/api/market/developer-lab/:id/install', requireAuth, (req, res) => {
  try {
    requireOwnedDeveloperDraft(req.auth!.user.id, req.params.id)
    const { draft, buffer } = developerLabZip(req.params.id)
    const app = importDeveloperApp(buffer, `${draft.appId}.zip`)
    setAppInstalled(req.auth!.user.id, app.id, true, app.manifest)
    ok(res, { app })
  } catch (e) { ok(res, { diagnostic: developerInstallDiagnostic(e) }) }
})

const DEVELOPER_PROJECT_MARKER = '.dx-app-project.json'
const MAX_DEVELOPER_PROJECT_TEXT_BYTES = 2 * 1024 * 1024
const MAX_DEVELOPER_PROJECT_BINARY_BYTES = 24 * 1024 * 1024
const MAX_DEVELOPER_PROJECT_CHUNK_BYTES = 1024 * 1024
const MAX_DEVELOPER_PROJECT_QUOTA_BYTES = 256 * 1024 * 1024
const MAX_DEVELOPER_PROJECT_UPLOADS_PER_OWNER = 8
const MAX_DEVELOPER_PROJECT_UPLOAD_BUFFER_BYTES = 512 * 1024 * 1024
type DeveloperProjectUpload = { appId: string; ownerId: string; path: string; mime: string; expectedBytes: number; chunks: Buffer[]; bytes: number; expiresAt: number }
const developerProjectUploads = new OwnedByteStore<DeveloperProjectUpload>(MAX_DEVELOPER_PROJECT_UPLOADS_PER_OWNER, MAX_DEVELOPER_PROJECT_UPLOAD_BUFFER_BYTES)

function developerBase64(value: unknown, maxBytes: number) {
  const raw = String(value || '').replace(/\s+/g, '')
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) throw new Error('二进制内容不是有效 Base64')
  const data = Buffer.from(raw, 'base64')
  if (data.byteLength > maxBytes) throw new Error(`二进制内容不能超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB`)
  return data
}

function developerProjectPackage(id: string) {
  const pack = listDeveloperApps().find((item) => item.id === id)
  if (!pack) throw new Error('开发者应用不存在')
  return pack
}

function ensureDeveloperProjectRoot(appId: string, ownerId: string) {
  const pack = developerProjectPackage(appId)
  const projectsRoot = ensureCanvasRoot(ownerId)
  for (const folder of listChildren(projectsRoot.id).nodes) {
    if (folder.type !== 'folder' || folder.ownerId !== ownerId) continue
    const marker = listChildren(folder.id).nodes.find((node) => node.type === 'file' && node.name === DEVELOPER_PROJECT_MARKER)
    if (!marker?.content) continue
    try {
      if ((JSON.parse(marker.content) as { appId?: string }).appId === appId) return folder
    } catch { /* ignore invalid marker files */ }
  }
  const folder = createNode({ name: pack.manifest.name, type: 'folder', parentId: projectsRoot.id, ownerId })
  createNode({
    name: DEVELOPER_PROJECT_MARKER,
    type: 'file',
    parentId: folder.id,
    ownerId,
    content: JSON.stringify({ appId, name: pack.manifest.name, dataVersion: pack.manifest.dataVersion, createdAt: Date.now() }, null, 2),
  })
  emitFsEvent('changed')
  return folder
}

app.post('/api/market/developer-apps/:id/agent/session', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    const pack = developerProjectPackage(appId)
    const root = ensureDeveloperProjectRoot(appId, req.auth!.user.id)
    const project = projectForRoot(root.id) || createProject({ name: pack.manifest.name, rootNodeId: root.id, createdBy: req.auth!.user.id })
    ensureProjectMember(project.id, req.auth!.user.id)
    const requestedSessionId = String(req.body?.sessionId || '')
    if (requestedSessionId) {
      const thread = ccsDb.prepare('SELECT id,project_id AS projectId FROM threads WHERE id=? AND created_by=? AND visibility=?').get(requestedSessionId, req.auth!.user.id, 'private') as { id: string; projectId: string } | undefined
      if (!thread || thread.projectId !== project.id) return fail(res, 'Agent 会话不存在或不属于当前 APP', 404)
      return ok(res, { sessionId: thread.id, projectId: project.id, threadId: thread.id, rootId: root.id, appId })
    }
    const thread = createThread(project.id, String(req.body?.title || `${pack.manifest.name} 会话`).slice(0, 100), req.auth!.user.id, 'private')
    ok(res, { sessionId: thread.id, projectId: project.id, threadId: thread.id, rootId: root.id, appId })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})

app.post('/api/market/developer-apps/:id/collab', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    developerProjectPackage(appId)
    sendDeveloperCollabResult(res, () => runDeveloperCollabAction(appId, req.auth!.user.id, req.body || {}))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})

app.get('/api/market/developer-apps/:id/realtime/rooms', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    developerProjectPackage(appId)
    ok(res, { rooms: listDeveloperRealtimeRooms(appId, req.auth!.user.id) })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-apps/:id/realtime/rooms', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    developerProjectPackage(appId)
    ok(res, { room: createDeveloperRealtimeRoom(appId, req.auth!.user.id, req.body || {}) })
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.get('/api/market/developer-apps/:id/realtime/rooms/:roomId', requireAuth, (req, res) => {
  try { ok(res, { room: developerRealtimeRoom(String(req.params.id), String(req.params.roomId)) }) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.post('/api/market/developer-apps/:id/realtime/rooms/:roomId/close', requireAuth, (req, res) => {
  try { ok(res, closeDeveloperRealtimeRoom(String(req.params.id), String(req.params.roomId), req.auth!.user.id)) }
  catch (e) { fail(res, String((e as Error).message || e), 400) }
})

app.post('/api/market/developer-apps/:id/network/request', requireAuth, async (req, res) => {
  try {
    const appId = String(req.params.id || '')
    const policy = developerProjectPackage(appId).manifest.network
    if (!policy) return fail(res, 'APP 未在 dx-app.json 声明网络白名单', 403)
    ok(res, await developerNetworkRequest(req.auth!.user.id, appId, policy, req.body || {}, developerProjectPackage(appId).manifest.oauth || []))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-apps/:id/credentials/bind', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    developerProjectPackage(appId)
    ok(res, bindDeveloperCredential(req.auth!.user.id, appId, req.body || {}))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.get('/api/market/developer-apps/:id/credentials/:bindingId', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    developerProjectPackage(appId)
    ok(res, credentialStatus(req.auth!.user.id, appId, String(req.params.bindingId)))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.post('/api/market/developer-apps/:id/oauth/:oauthId/authorize', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    const config = (developerProjectPackage(appId).manifest.oauth || []).find((item) => item.id === String(req.params.oauthId))
    if (!config) return fail(res, 'APP 未声明该 OAuth 配置', 404)
    const origin = `${req.protocol}://${req.get('host')}`
    ok(res, beginDeveloperOAuth(req.auth!.user.id, appId, config, origin))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})
app.get('/api/market/developer-apps/:id/oauth/:oauthId/status', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    if (!(developerProjectPackage(appId).manifest.oauth || []).some((item) => item.id === String(req.params.oauthId))) return fail(res, 'APP 未声明该 OAuth 配置', 404)
    ok(res, developerOAuthStatus(req.auth!.user.id, appId, String(req.params.oauthId)))
  } catch (e) { fail(res, String((e as Error).message || e), 400) }
})

function developerProjectPath(value: unknown, allowEmpty = false) {
  const path = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '')
  if (!path && allowEmpty) return ''
  const parts = path.split('/')
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || /[\\:*?"<>|]/.test(part))) {
    throw new Error('项目路径不合法')
  }
  if (path.length > 500 || parts.some((part) => part.length > 80)) throw new Error('项目路径过长')
  return path
}

function ensureDeveloperProjectPath(rootId: string, path: string, ownerId: string, leafIsFolder = false) {
  const parts = path.split('/')
  const leaf = leafIsFolder ? '' : parts.pop()!
  let parentId = rootId
  for (const name of parts) {
    const existing = listChildren(parentId).nodes.find((node) => node.name === name)
    if (existing?.type === 'file') throw new Error(`路径中存在同名文件：${name}`)
    const folder = existing || createNode({ name, type: 'folder', parentId, ownerId })
    parentId = folder.id
  }
  return { parentId, leaf, folder: leafIsFolder ? getNode(parentId) : null }
}

function developerProjectEntry(node: NonNullable<ReturnType<typeof getNode>>) {
  return { id: node.id, name: node.name, type: node.type, mime: node.mime, size: node.size || (node.content ? Buffer.byteLength(node.content, 'utf8') : 0), updatedAt: node.updated_ts }
}

function ensureDeveloperProjectQuota(rootId: string, incomingBytes: number, replacing?: NonNullable<ReturnType<typeof getNode>> | null) {
  const replacingBytes = replacing?.type === 'file' ? (replacing.size || (replacing.content ? Buffer.byteLength(replacing.content, 'utf8') : 0)) : 0
  const usedBytes = subtreeByteSize(rootId)
  if (usedBytes - replacingBytes + incomingBytes > MAX_DEVELOPER_PROJECT_QUOTA_BYTES) throw new Error('APP 项目存储超过 256 MB 配额')
  return { usedBytes, quotaBytes: MAX_DEVELOPER_PROJECT_QUOTA_BYTES }
}

app.post('/api/market/developer-apps/:id/project', requireAuth, (req, res) => {
  try {
    const appId = String(req.params.id || '')
    const action = String(req.body?.action || '')
    const root = ensureDeveloperProjectRoot(appId, req.auth!.user.id)
    if (action === 'project.info') return ok(res, { root: developerProjectEntry(root), path: `项目/${root.name}`, storage: { usedBytes: subtreeByteSize(root.id), quotaBytes: MAX_DEVELOPER_PROJECT_QUOTA_BYTES } })
    const path = developerProjectPath(req.body?.path, action === 'project.list' || ['project.upload.chunk', 'project.upload.commit', 'project.upload.cancel'].includes(action))
    if (action === 'project.list') {
      const folder = path ? findByPath(root.id, path) : root
      if (!folder || folder.type !== 'folder') return fail(res, '项目目录不存在', 404)
      const entries = listChildren(folder.id).nodes
        .filter((node) => !node.name.startsWith('.'))
        .map(developerProjectEntry)
      return ok(res, { path, entries })
    }
    if (action === 'project.read') {
      const node = findByPath(root.id, path)
      if (!node || node.type !== 'file') return fail(res, '项目文件不存在', 404)
      if (node.content === undefined) {
        if (req.body?.encoding !== 'base64') return fail(res, '这是二进制文件，请使用 encoding=base64 或 project.artifactUrl', 415)
        const content = readBlob(node.id)
        if (!content) return fail(res, '项目二进制内容不存在', 404)
        return ok(res, { path, encoding: 'base64', content: content.toString('base64'), mime: node.mime || 'application/octet-stream', entry: developerProjectEntry(node) })
      }
      return ok(res, { path, encoding: 'utf8', content: node.content, mime: node.mime || 'text/plain', entry: developerProjectEntry(node) })
    }
    if (action === 'project.write') {
      const content = typeof req.body?.content === 'string' ? req.body.content : JSON.stringify(req.body?.content ?? null, null, 2)
      if (Buffer.byteLength(content, 'utf8') > MAX_DEVELOPER_PROJECT_TEXT_BYTES) return fail(res, '单个项目文本文件不能超过 2 MB', 413)
      const target = ensureDeveloperProjectPath(root.id, path, req.auth!.user.id)
      const existing = findByPath(root.id, path)
      if (existing?.type === 'folder') return fail(res, '同名目录已存在', 409)
      ensureDeveloperProjectQuota(root.id, Buffer.byteLength(content, 'utf8'), existing)
      const node = existing
        ? setContent(existing.id, content)
        : createNode({ name: target.leaf, type: 'file', parentId: target.parentId, ownerId: req.auth!.user.id, content })
      emitFsEvent('changed')
      return ok(res, { path, entry: developerProjectEntry(node) })
    }
    if (action === 'project.writeBinary') {
      const content = developerBase64(req.body?.content, MAX_DEVELOPER_PROJECT_BINARY_BYTES)
      const mime = String(req.body?.mime || 'application/octet-stream').slice(0, 160)
      const target = ensureDeveloperProjectPath(root.id, path, req.auth!.user.id)
      const existing = findByPath(root.id, path)
      if (existing?.type === 'folder') return fail(res, '同名目录已存在', 409)
      ensureDeveloperProjectQuota(root.id, content.byteLength, existing)
      const node = existing
        ? setBinaryContent(existing.id, content, mime)
        : createNode({ name: target.leaf, type: 'file', parentId: target.parentId, ownerId: req.auth!.user.id, mime, size: content.byteLength })
      if (!existing) saveBlob(node.id, content)
      emitFsEvent('changed')
      return ok(res, { path, entry: developerProjectEntry(node), mime })
    }
    if (action === 'project.upload.begin') {
      const expectedBytes = Math.round(Number(req.body?.size || 0))
      if (expectedBytes < 0 || expectedBytes > MAX_DEVELOPER_PROJECT_BINARY_BYTES) return fail(res, '分片上传大小无效或超过 24 MB', 413)
      ensureDeveloperProjectQuota(root.id, expectedBytes, findByPath(root.id, path))
      const uploadId = randomUUID()
      const expiresAt = Date.now() + 10 * 60_000
      developerProjectUploads.create(uploadId, { appId, ownerId: req.auth!.user.id, path, mime: String(req.body?.mime || 'application/octet-stream').slice(0, 160), expectedBytes, chunks: [], bytes: 0, expiresAt })
      return ok(res, { uploadId, chunkBytes: MAX_DEVELOPER_PROJECT_CHUNK_BYTES, expiresAt })
    }
    if (action === 'project.upload.chunk') {
      const uploadId = String(req.body?.uploadId || '')
      const now = Date.now()
      const upload = developerProjectUploads.get(uploadId, now)
      if (!upload || upload.appId !== appId || upload.ownerId !== req.auth!.user.id) return fail(res, '分片上传不存在或已过期', 404)
      if (Number(req.body?.index) !== upload.chunks.length) return fail(res, '分片序号不连续', 409)
      const chunk = developerBase64(req.body?.content, MAX_DEVELOPER_PROJECT_CHUNK_BYTES)
      if (upload.bytes + chunk.byteLength > MAX_DEVELOPER_PROJECT_BINARY_BYTES || (upload.expectedBytes && upload.bytes + chunk.byteLength > upload.expectedBytes)) return fail(res, '分片上传超过声明大小', 413)
      developerProjectUploads.reserveBytes(uploadId, chunk.byteLength, now)
      upload.chunks.push(chunk)
      return ok(res, { uploadId, index: upload.chunks.length - 1, receivedBytes: upload.bytes })
    }
    if (action === 'project.upload.commit') {
      const uploadId = String(req.body?.uploadId || '')
      const upload = developerProjectUploads.get(uploadId)
      if (!upload || upload.appId !== appId || upload.ownerId !== req.auth!.user.id) return fail(res, '分片上传不存在或已过期', 404)
      if (upload.expectedBytes && upload.bytes !== upload.expectedBytes) return fail(res, `分片上传尚未完成：${upload.bytes}/${upload.expectedBytes}`, 409)
      const content = Buffer.concat(upload.chunks, upload.bytes)
      const target = ensureDeveloperProjectPath(root.id, upload.path, req.auth!.user.id)
      const existing = findByPath(root.id, upload.path)
      if (existing?.type === 'folder') return fail(res, '同名目录已存在', 409)
      ensureDeveloperProjectQuota(root.id, content.byteLength, existing)
      const node = existing
        ? setBinaryContent(existing.id, content, upload.mime)
        : createNode({ name: target.leaf, type: 'file', parentId: target.parentId, ownerId: req.auth!.user.id, mime: upload.mime, size: content.byteLength })
      if (!existing) saveBlob(node.id, content)
      developerProjectUploads.delete(uploadId)
      emitFsEvent('changed')
      return ok(res, { path: upload.path, entry: developerProjectEntry(node), mime: upload.mime })
    }
    if (action === 'project.upload.cancel') {
      const uploadId = String(req.body?.uploadId || '')
      const upload = developerProjectUploads.get(uploadId)
      if (upload?.appId === appId && upload.ownerId === req.auth!.user.id) developerProjectUploads.delete(uploadId)
      return ok(res, { uploadId, cancelled: true })
    }
    if (action === 'project.artifactUrl') {
      const node = findByPath(root.id, path)
      if (!node || node.type !== 'file') return fail(res, '项目 Artifact 不存在', 404)
      const token = randomUUID().replace(/-/g, '')
      const expiresAt = Date.now() + 5 * 60_000
      developerArtifactTokens.set(token, { nodeId: node.id, expiresAt })
      return ok(res, { path, url: `/api/developer-artifacts/${token}`, expiresAt, mime: node.mime || (node.content !== undefined ? 'text/plain' : 'application/octet-stream'), entry: developerProjectEntry(node) })
    }
    if (action === 'project.mkdir') {
      const existing = findByPath(root.id, path)
      if (existing?.type === 'file') return fail(res, '同名文件已存在', 409)
      const folder = existing || ensureDeveloperProjectPath(root.id, path, req.auth!.user.id, true).folder
      emitFsEvent('changed')
      return ok(res, { path, entry: folder ? developerProjectEntry(folder) : null })
    }
    if (action === 'project.remove') {
      const node = findByPath(root.id, path)
      if (!node) return fail(res, '项目文件不存在', 404)
      removeNode(node.id)
      emitFsEvent('changed')
      return ok(res, { path, removed: true })
    }
    return fail(res, '不支持的项目存储动作', 400)
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

app.post('/api/market/developer-apps/import', requireAuth, upload.single('package'), (req, res) => {
  try {
    if (!req.file?.buffer) return fail(res, '请选择开发者应用 ZIP 文件')
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    if (!/\.zip$/i.test(filename)) return fail(res, '请选择 ZIP 文件')
    const app = importDeveloperApp(req.file.buffer, filename)
    // Canvas extensions are host-scoped plugins, not account-installed desktop
    // applications. Clear legacy APP preferences left by earlier versions.
    if (app.manifest.canvas) removeInstalledAppEverywhere(app.id)
    else setAppInstalled(req.auth!.user.id, app.id, true, app.manifest)
    ok(res, { app })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/market/developer-apps/:id', (req, res) => {
  try {
    const id = String(req.params.id || '')
    const deleted = deleteDeveloperApp(id)
    if (deleted) removeInstalledAppEverywhere(id)
    ok(res, { deleted })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/market/developer-apps/:id/files/*', (req, res) => {
  try {
    const filePath = (req.params as Record<string, string>)['0'] || 'index.html'
    res.sendFile(developerAppFilePath(String(req.params.id || ''), filePath))
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})

app.post('/api/market/reset-data', async (req, res) => {
  try {
    const packageId = String(req.body?.packageId || '')
    if (packageId.startsWith('dev-')) deleteDeveloperApp(packageId)
    else if (packageId === 'dingtalk') { resetDingTalkData(); await mcpResetSystemServer('dingtalk-mcp-96cf') }
    else if (packageId === 'ziniao') await mcpResetSystemServer('ziniao')
    else if (packageId === 'illustrator') await mcpResetSystemServer('illustrator')
    else return fail(res, '未知应用包', 400)
    ok(res, { packageId })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})

// 天气（open-meteo，免费无需 key）：桌面小组件用
app.get('/api/weather', async (req, res) => {
  try {
    const locale = String(req.query?.locale || 'zh-CN')
    const latitude = req.query?.latitude
    const longitude = req.query?.longitude
    if (latitude !== undefined || longitude !== undefined) {
      if (latitude === undefined || longitude === undefined) return fail(res, locale === 'en-US' ? 'Both latitude and longitude are required' : '经纬度必须同时提供', 400)
      return ok(res, await getWeatherAt(Number(latitude), Number(longitude), locale))
    }
    ok(res, await getWeather(String(req.query?.city || ''), locale))
  } catch (e) {
    fail(res, String((e as Error).message || e))
  }
})

// ComfyUI：DX OS 原生多实例启动管理，不依赖外部管理脚本。
app.post('/api/comfyui/workflows/inspect', (req, res) => {
  try { ok(res, inspectComfyWorkflow(req.body?.workflow ?? req.body)) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/comfyui/workflows', (req, res) => {
  try { ok(res, { workflows: listComfyWorkflows(req.auth!.user.id) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/comfyui/workflows/:id', (req, res) => {
  try { ok(res, { workflow: getComfyWorkflow(req.auth!.user.id, String(req.params.id)) }) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.post('/api/comfyui/workflows', (req, res) => {
  try { ok(res, { workflow: saveComfyWorkflow(req.auth!.user.id, req.body || {}) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.put('/api/comfyui/workflows/:id', (req, res) => {
  try { ok(res, { workflow: saveComfyWorkflow(req.auth!.user.id, { ...(req.body || {}), id: String(req.params.id) }) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/workflows/:id/cover', upload.single('cover'), async (req, res) => {
  try {
    if (!req.file) throw new Error('请选择封面图片')
    const workflow = await saveComfyWorkflowCover(req.auth!.user.id, String(req.params.id), {
      buffer: req.file.buffer,
      mime: req.file.mimetype,
    })
    ok(res, { workflow })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.delete('/api/comfyui/workflows/:id', (req, res) => {
  try { deleteComfyWorkflow(req.auth!.user.id, String(req.params.id)); ok(res, {}) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.get('/api/comfyui/workflow-covers/:filename', (req, res) => {
  try { res.type('image/webp').sendFile(getComfyWorkflowCover(req.auth!.user.id, String(req.params.filename))) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.post('/api/comfyui/workflows/:id/runs', upload.any(), (req, res) => {
  try {
    const values = JSON.parse(String(req.body?.values || '{}')) as Record<string, unknown>
    const files = ((req.files as Express.Multer.File[]) || []).map((file) => ({
      fieldId: file.fieldname,
      buffer: file.buffer,
      name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      mime: file.mimetype,
    }))
    ok(res, { run: startComfyWorkflowRun(req.auth!.user.id, String(req.params.id), values, files) })
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/comfyui/workflow-runs/:id', (req, res) => {
  try { ok(res, { run: getComfyWorkflowRun(req.auth!.user.id, String(req.params.id)) }) }
  catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.get('/api/comfyui/workflow-runs/:id/files/:index', async (req, res) => {
  try {
    const file = await proxyComfyRunFile(req.auth!.user.id, String(req.params.id), Number(req.params.index))
    res.type(file.contentType).send(file.buffer)
  } catch (e) { fail(res, String((e as Error).message || e), 404) }
})
app.get('/api/comfyui/status', async (_req, res) => {
  try { ok(res, await comfyStatus()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.get('/api/comfyui/config', (_req, res) => {
  try { ok(res, { config: loadComfyConfig() }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.put('/api/comfyui/config', (req, res) => {
  try { ok(res, { config: saveComfyConfig(req.body || {}) }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/bridge/repair', (_req, res) => {
  try { ok(res, { bridge: repairComfyBridge() }) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/instances/:id/start', async (req, res) => {
  try { ok(res, await startComfyInstance(String(req.params.id))) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/instances/:id/stop', async (req, res) => {
  try { ok(res, await stopComfyInstance(String(req.params.id))) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/instances/:id/restart', async (req, res) => {
  try { ok(res, await restartComfyInstance(String(req.params.id))) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/instances/:id/upload', upload.array('files', 30), async (req, res) => {
  try {
    const files = ((req.files as Express.Multer.File[]) || []).map((file) => ({
      buffer: file.buffer,
      name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      mime: file.mimetype,
    }))
    if (!files.length) return fail(res, '没有文件')
    ok(res, await uploadComfyFiles(String(req.params.id), files))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/instances/:id/import-nodes', async (req, res) => {
  try {
    const rawNodeIds: unknown[] = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds : []
    const nodeIds = [...new Set(rawNodeIds
      .map((value) => String(value || '').trim())
      .filter((value) => value.length > 0))]
    if (!nodeIds.length) return fail(res, '没有可导入的文件')
    if (nodeIds.length > 30) return fail(res, '一次最多导入 30 个文件')

    const files = nodeIds.map((nodeId) => {
      const node = getNode(nodeId)
      if (!node) throw new Error('文件不存在')
      if (!canReadNode(req.auth!.user, node)) throw new Error(`没有文件权限：${node.name}`)
      if (node.type !== 'file') throw new Error(`不是文件：${node.name}`)
      const mime = String(node.mime || '').toLowerCase()
      const imageName = /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(node.name)
      if (!mime.startsWith('image/') && !imageName) throw new Error(`不是图片：${node.name}`)
      if ((node.size || 0) > 200 * 1024 * 1024) throw new Error(`图片超过 200 MB：${node.name}`)
      const buffer = readBlob(node.id)
      if (!buffer) throw new Error(`图片数据不存在：${node.name}`)
      return { buffer, name: node.name, mime: node.mime || 'application/octet-stream' }
    })
    ok(res, await uploadComfyFiles(String(req.params.id), files))
  } catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/start-all', async (_req, res) => {
  try { ok(res, await startEnabledComfyInstances()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})
app.post('/api/comfyui/stop-all', async (_req, res) => {
  try { ok(res, await stopAllComfyInstances()) }
  catch (e) { fail(res, String((e as Error).message || e)) }
})

// ── 前端静态服务（生产构建产物 dist/）─────────────────────────────────
// 开发期由 Vite 代理 /api；便携版 / 生产构建则用 Express 直接托管 dist。
// 非 /api 请求回退到 index.html，保证 SPA 路由可用。
const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(join(DIST_DIR, 'index.html'))
  })
}

function readableCanvasMedia(nodeId: string, canvasId: string, user: Parameters<typeof getCanvas>[1]) {
  const node = getNode(nodeId)
  const data = readBlob(nodeId)
  const ownFile = !!node && (!node.ownerId || node.ownerId === user.id)
  if (!node || !data || (!ownFile && !canViewCanvasMedia(nodeId, user, canvasId))) throw new Error('媒体文件不存在或不可读取')
  return { node, data }
}

function transcodeCanvasAudio(input: { data: Buffer; sourceName: string; start?: number; end?: number }) {
  const folder = mkdtempSync(join(tmpdir(), 'dx-canvas-audio-'))
  const sourceExtension = extname(input.sourceName).replace(/[^.a-z0-9]/gi, '').slice(0, 8) || '.media'
  const sourcePath = join(folder, `source${sourceExtension}`)
  const outputPath = join(folder, 'output.mp3')
  try {
    writeFileSync(sourcePath, input.data)
    const args = ['-hide_banner', '-loglevel', 'error', '-y']
    if (input.start !== undefined) args.push('-ss', input.start.toFixed(3))
    args.push('-i', sourcePath)
    if (input.end !== undefined && input.start !== undefined) args.push('-t', Math.max(.05, input.end - input.start).toFixed(3))
    args.push('-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', outputPath)
    const executable = String(process.env.FFMPEG_PATH || 'ffmpeg').trim()
    const result = spawnSync(executable, args, { windowsHide: true, encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
    if (result.error) throw new Error(result.error.message.includes('ENOENT') ? '未找到 FFmpeg，请在系统中安装 FFmpeg 或配置 FFMPEG_PATH' : `无法启动 FFmpeg：${result.error.message}`)
    if (result.status !== 0 || !existsSync(outputPath)) throw new Error(`FFmpeg 音频处理失败：${String(result.stderr || `exit ${result.status}`).trim()}`)
    return readFileSync(outputPath)
  } finally { rmSync(folder, { recursive: true, force: true }) }
}

function saveCanvasDerivedAudio(canvasId: string, user: Parameters<typeof getCanvas>[1], data: Buffer, prefix: string) {
  const folder = ensureCanvasOutputFolder(user.id, canvasId, user)
  const node = createNode({ name: `${prefix}-${Date.now()}.mp3`, type: 'file', parentId: folder, mime: 'audio/mpeg', size: data.length, ownerId: user.id })
  saveBlob(node.id, data)
  emitFsEvent('changed')
  return { nodeId: node.id, name: node.name, url: `/api/fs/raw/${node.id}`, role: 'input' as const, kind: 'audio' as const }
}

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!(error instanceof multer.MulterError)) return next(error)
  const tooLarge = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
  fail(res, tooLarge ? `上传超出限制：${error.message}` : `上传失败：${error.message}`, tooLarge ? 413 : 400)
})

// ── 全局错误处理：防止未捕获的异步错误导致进程崩溃 ────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('[DX OS] 未捕获的 Promise rejection:', reason)
  console.error('Promise:', promise)
  // 不退出进程，让服务继续运行
})

process.on('uncaughtException', (error, origin) => {
  console.error('[DX OS] 未捕获的异常:', error)
  console.error('来源:', origin)
  // 对于严重错误，记录后优雅退出
  if (error.message?.includes('FATAL') || error.stack?.includes('node:internal')) {
    console.error('[DX OS] 检测到致命错误，进程将在 3 秒后退出')
    setTimeout(() => process.exit(1), 3000)
  }
  // 其他错误不退出，让服务继续运行
})

const server = app.listen(PORT, HOST, () => {
  console.log(`[DX OS api] listening on http://${HOST}:${PORT}`)
  // 共享区自愈：公共文件夹常在；每个部门都有部门文件夹
  try {
    ensurePublicRoot()
    for (const department of listAuthDepartments()) ensureDepartmentRoot(department.id, department.name)
  } catch (e) { console.warn('[DX OS api] share roots init failed:', String((e as Error).message || e)) }
  // 历史无主节点（早于 owner 机制的桌面文件）一次性认领给首位超管，
  // 否则按 owner 隔离后它们对谁都不可见、也无人能清理。幂等：只动 ownerless 节点。
  try {
    const superadmin = listAuthUsers().find((u) => u.role === 'superadmin')
    if (superadmin) {
      const claimed = claimOwnerlessNodes(superadmin.id)
      if (claimed) console.log(`[DX OS api] 认领 ${claimed} 个无主节点给超管 ${superadmin.username}`)
    }
  } catch (e) { console.warn('[DX OS api] claim ownerless nodes failed:', String((e as Error).message || e)) }
  initMcp() // 启动时连接已启用的 MCP 服务器
  startDingTalkAgentStream().catch((e) => console.warn('[DingTalk Agent] start failed:', String((e as Error).message || e)))
})
let protocolRecoveryRunning = false
async function recoverDueProtocolTasks() {
  if (protocolRecoveryRunning) return
  protocolRecoveryRunning = true
  try {
    for (const task of listDueAiProtocolTasks(Date.now(), 10)) {
      const provider = task.provider_site_id ? revealProvider(task.provider_site_id) : null
      if (!provider?.enabled) continue
      const protocol = getProtocolV2('provider', task.provider_protocol_id, task.provider_protocol_version)
      if (!protocol || protocol.hash !== task.provider_protocol_hash || protocol.protocol.kind !== 'provider') continue
      const credential = protocol.protocol.auth.credentialRef === 'wallet_api_key' ? provider.wallet_api_key : provider.api_key
      if (protocol.protocol.auth.type !== 'none' && !credential) continue
      try { await resumeAiProtocolTask({ id: task.id, credential }) }
      catch (error) { console.warn(`[protocol recovery] ${task.id} failed:`, String((error as Error).message || error)) }
    }
  } finally { protocolRecoveryRunning = false }
}
const initialProtocolRecovery = setTimeout(() => { void recoverDueProtocolTasks() }, 2_000)
const protocolRecoveryTimer = setInterval(() => { void recoverDueProtocolTasks() }, 5_000)
initialProtocolRecovery.unref?.()
protocolRecoveryTimer.unref?.()
// 会员权益不依赖设置页是否被打开：启动后主动校验，并在长时间运行时定期刷新。
// 网络不可用时 cloudAccountStatus 会保留仍在签名宽限期内的本地权益。
const CLOUD_ENTITLEMENT_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
async function refreshCloudEntitlementInBackground() {
  const superadmin = listAuthUsers().find((user) => user.role === 'superadmin')
  if (!superadmin) return
  try { await cloudAccountStatus(superadmin.id) }
  catch (error) { console.warn('[DX OS account] background entitlement refresh failed:', String((error as Error).message || error)) }
}
const initialCloudEntitlementRefresh = setTimeout(() => { void refreshCloudEntitlementInBackground() }, 10_000)
const cloudEntitlementRefreshTimer = setInterval(() => { void refreshCloudEntitlementInBackground() }, CLOUD_ENTITLEMENT_REFRESH_INTERVAL_MS)
initialCloudEntitlementRefresh.unref?.()
cloudEntitlementRefreshTimer.unref?.()
setupCanvasCollaboration(server)
setupSnakeCollaboration(server)
setupDeveloperRealtime(server)
const stopMemoryLifecycleSweep = startMemoryLifecycleSweep([
  () => developerProjectUploads.cleanup(),
  () => developerArtifactTokens.cleanup(),
])
const apiMemoryDiagnostics = startProcessDiagnostics('api', {
  getMetrics: () => {
    const uploads = developerProjectUploads.stats()
    const artifacts = developerArtifactTokens.stats()
    const figmaJobs = [...figmaGenerationJobs.values()]
    const comfy = comfyWorkflowRunStats()
    const realtime = developerRealtimeStats()
    const dingtalk = getDingTalkAgentStatus()
    return {
      uploadSessions: uploads.entries,
      uploadOwners: uploads.owners,
      uploadBytes: uploads.bytes,
      artifactTokens: artifacts.entries,
      figmaJobs: figmaJobs.length,
      figmaJobsRunning: figmaJobs.filter((job) => job.status === 'running').length,
      comfyRuns: comfy.runs,
      comfyRunsActive: comfy.active,
      realtimeRooms: realtime.rooms,
      realtimePeers: realtime.peers,
      dingtalkContexts: dingtalk.contextCount || 0,
      fsEventClients: fsEventClients.size,
    }
  },
})
const desktopParentMonitor = startDesktopParentMonitor('api', () => process.exit(0))
server.on('close', () => {
  clearTimeout(initialProtocolRecovery)
  clearInterval(protocolRecoveryTimer)
  clearTimeout(initialCloudEntitlementRefresh)
  clearInterval(cloudEntitlementRefreshTimer)
  stopMemoryLifecycleSweep()
  apiMemoryDiagnostics.stop()
  desktopParentMonitor.stop()
})
server.requestTimeout = 15 * 60 * 1000
server.headersTimeout = 16 * 60 * 1000
server.timeout = 15 * 60 * 1000
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[DX OS api] 端口 ${PORT} 被占用（可能有残留的旧进程）。请先关闭占用进程再启动，`)
    console.error(`[DX OS api] 或运行: powershell "Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`)
    process.exit(1)
  }
  throw e
})
