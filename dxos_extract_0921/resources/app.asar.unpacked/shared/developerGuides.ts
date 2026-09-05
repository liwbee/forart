export type DeveloperGuideKind = 'software' | 'skill' | 'mcp'

const COMMON = `# DX OS 开发通用规范（dx-app/v2）

## 交付与目录
- 交付无需 npm、构建或服务端脚本即可运行的静态 APP。
- ZIP/项目根目录必须包含 dx-app.json 和 index.html，所有资源使用相对路径，建议放入 assets/。
- dx-app.json.format 必须是 dx-app/v2；id 必须匹配 ^[a-z][a-z0-9-]{2,42}$，即以英文字母开头，只能包含英文小写、数字和短横线。
- dx-app.json.version 必须使用 SemVer（例如 1.2.3）；build 必须是大于 0 且随每次发布递增的整数；releaseChannel 使用 stable、beta 或 dev。
- minSystemVersion 必须声明最低 DX OS 版本；需要限制最高兼容版本时再声明 maxSystemVersion。dataVersion 用于项目数据迁移，初始为 1。
- dx-app.json.icon 必须提供符合应用功能的图标，优先使用简洁的内嵌 SVG 和协调渐变，不要使用系统默认占位图标；也支持 image 字段保存 PNG data URL。
- entry 必须指向包内真实文件；不得包含绝对路径、file://、../ 或真实密钥。

## 窗口尺寸与游戏缩放
- 普通响应式软件使用 \`category: "software"\`。iframe 会始终铺满 DX OS 内容区，页面应使用 \`width/height: 100%\`、Flex/Grid、\`ResizeObserver\` 或窗口 \`resize\` 事件适配尺寸变化。
- 固定逻辑分辨率的游戏使用 \`category: "games"\`。此时 \`defaultSize.width/height\` 同时作为游戏逻辑视口；DX OS 会在窗口变化时保持宽高比，连同 iframe 和指针坐标一起等比放大或缩小并居中显示。
- 游戏应按 \`defaultSize\` 渲染完整画面，不要在内部再次限制只能缩小，也不要叠加第二层页面缩放；Canvas/WebGL 在逻辑视口内自行处理 devicePixelRatio 即可。

## APP 图标
- 包内图标写在 dx-app.json.icon 中，随安装包一起分发，用于 DX OS 桌面、Dock、启动台和应用窗口；后台上传的商店图标用于官网应用市场与详情页，两者互不覆盖，可以同时设置。
- 推荐使用完整的内嵌 SVG。svg 必须包含 <svg> 根元素，不得包含 script、foreignObject、iframe、object、embed、image、事件处理器或外部 href/src。
- PNG 必须写成 data:image/png;base64,... data URL，不能填写 assets/icon.png 等相对路径，解码后的文件不能超过 512 KB。
- gradient 用于图标背景；透明素材可设置 imageBackground=true 保留背景。imageScale 有效范围为 0.5–1.8，imageOffsetX/imageOffsetY 有效范围为 -50–50。

推荐的 SVG 图标：

\`\`\`json
{
  "icon": {
    "gradient": "linear-gradient(145deg, #5b8cff, #7057ff)",
    "svg": "<svg viewBox='0 0 64 64'><rect x='14' y='14' width='36' height='36' rx='10' fill='white'/></svg>"
  }
}
\`\`\`

使用 PNG data URL：

\`\`\`json
{
  "icon": {
    "gradient": "transparent",
    "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "imageScale": 1,
    "imageOffsetX": 0,
    "imageOffsetY": 0,
    "imageBackground": false
  }
}
\`\`\`

## 系统上下文
- 监听宿主推送的 system.context，并在启动时主动调用 system.getContext。
- 实时同步 appearance、interfaceLocale、formatLocale、direction、displayScale 和 colorScheme；主题和语言不能由 APP 本地设置覆盖。
- CSS 必须同时提供 :root/[data-theme="light"] 与 [data-theme="dark"] 变量；所有页面背景、面板、文字、边框和控件颜色必须引用变量，不能只修改 html 的 colorScheme。
- 所有用户可见文案必须来自至少包含 zh-CN 与 en-US 的字典；收到 interfaceLocale 后立即重新渲染，未知语言回退到 en-US。

## 必须采用的上下文接入模式
\`\`\`js
const i18n = {
  'zh-CN': { title: '我的应用', save: '保存' },
  'en-US': { title: 'My App', save: 'Save' }
}
let system = { appearance: 'light', interfaceLocale: 'zh-CN', direction: 'ltr', displayScale: 1 }
function applySystemContext(context = {}) {
  system = { ...system, ...context }
  const root = document.documentElement
  root.dataset.theme = system.appearance === 'dark' ? 'dark' : 'light'
  root.lang = system.interfaceLocale || 'zh-CN'
  root.dir = system.direction || 'ltr'
  root.style.colorScheme = system.appearance === 'dark' ? 'dark' : 'light'
  root.style.setProperty('--dx-display-scale', String(system.displayScale || 1))
  renderText(i18n[system.interfaceLocale] || i18n['en-US'])
}
addEventListener('message', event => {
  const message = event.data
  if (message?.dxos === 'v1' && message.type === 'system.context') applySystemContext(message.context)
  if (message?.dxos === 'v1' && message.id === 'initial-context' && message.ok) applySystemContext(message.result)
})
parent.postMessage({ dxos: 'v1', type: 'request', id: 'initial-context', action: 'system.getContext' }, '*')
\`\`\`

\`\`\`css
:root, :root[data-theme="light"] { --bg:#f5f5f7; --surface:#fff; --text:#1d1d1f; --muted:#6e6e73; --line:rgba(0,0,0,.12); }
:root[data-theme="dark"] { --bg:#101114; --surface:#1c1d22; --text:#f5f5f7; --muted:#a1a1aa; --line:rgba(255,255,255,.14); }
body { background:var(--bg); color:var(--text); }
\`\`\`

## 项目数据与持久化
- 项目、文档、存档和用户创作内容必须通过 project.info/list/read/write/mkdir/remove 保存到宿主管理的“项目/<APP 名称>”目录。
- project.* 的 path 必须是项目根目录内的普通相对路径，例如 \'data/game.json\'；路径及任一级目录不能以点号开头，不能使用 \'../\'、绝对路径或隐藏目录（例如 \'./data\'、\'.app-data\'）。
- localStorage、sessionStorage、IndexedDB 只能保存可丢失的 UI 偏好或缓存，不能作为主数据源。
- 服务端或 MCP 生成的下载中转文件、上传暂存文件等短期产物必须放在系统临时目录（例如 Node.js 的 os.tmpdir()），不能写入安装包目录，也不要混入持久数据目录。
- APP 的安装/卸载状态由 DX OS 按登录账号在服务端持久化，APP 不得自行用浏览器存储模拟安装状态。
- APP 更新只替换经过校验的安装包；项目数据、用户设置和 MCP/网络安全配置与安装包分离，升级代码不得清空项目目录。
- stable/beta 发布必须提高 version 或 build；系统会拒绝相同 Release 和意外降级。dataVersion 变化必须同时提供受支持的数据迁移，否则更新会为保护项目数据而停止。
- DX Developer 中“正式安装”只安装到当前系统，“发布版本”才会创建应用市场 Release；发布渠道必须与 dx-app.json.releaseChannel 一致。
- Release 发布后不可覆盖；修复同一 version 必须增加 build。服务器会保存包大小和 SHA-256，并使用 Ed25519 签名；APP 不得自行伪造 packageUrl、sha256 或 signature。
- 发布 dev/beta/stable 前填写 releaseNotes；灰度比例和强制更新属于市场发布策略，不应写入浏览器本地存储。被撤回的 Release 不再提供新安装。
- 安装器会检查 index.html 引用的本地 src/href 资源；不得发布引用缺失 assets 文件的包。更新后健康检查失败会恢复旧代码。
- 历史版本回滚默认只切换 APP 代码并保留项目、设置和 MCP 配置；dataVersion 不一致且没有声明式迁移/数据快照时，系统会拒绝回滚。
- 普通开发者 APP 安装后使用 dev- 命名空间。声明 appApi 的包属于“特权 APP”：可以在 Claude、Codex 或任意本地开发环境中按本文档制作，不要求使用 DX Developer，也不要求先上架应用商店，但只能由管理员安装、更新和启用。
- 特权 APP 必须同时声明 app.<app-id>.app-api.call 权限和精确的 appApi 方法/路径白名单；未声明的宿主接口一律拒绝。普通用户不能安装特权 APP，也不能通过修改包 ID 冒用系统内置 APP。
- 按实际操作在 dx-app.json.permissions 或 permissions.json 中声明 app.<app-id>.project.read、app.<app-id>.project.write、app.<app-id>.project.delete；不要把 project.info 等桥接动作名直接当作权限名。

## 必须采用的宿主 API 调用模式
运行时会提供 \`window.dx.invoke(action, args)\`（\`window.dx.call\` 是兼容别名）。它返回 Promise，并把参数转换成带唯一 id 的 postMessage 请求。新 APP 应优先使用该接口；也可以自行实现同一协议，但必须等待带相同 id 的响应，不能只发送不处理结果。
- APP 运行在 opaque-origin 跨域 iframe 中。禁止读取 \`window.parent.dx\` 或父窗口的任何属性；只能调用当前 iframe 内注入的 \`window.dx\`，或使用 \`parent.postMessage(...)\` 协议通信。
- 沙箱不开放 allow-same-origin、allow-popups 或 allow-downloads。禁止直接使用 window.open、target=_blank、a download，localStorage/IndexedDB 读取必须捕获 SecurityError 并回退，不能阻止 APP 启动。
- 导出文件调用 file.export 并声明 app.<app-id>.file.write；普通 HTTPS 外链调用 ui.openExternal 并声明 app.<app-id>.ui.external；OAuth 使用 oauth.authorize/status。
- 不要嵌入依赖 Cookie、localStorage、IndexedDB 或 Service Worker 的完整第三方网站；嵌套 iframe 会继承外层沙箱限制并可能永久停在加载页。
- 不要直接依赖 Cookie 鉴权的 WebSocket/EventSource；实时协作使用 realtime.room.*，外部请求使用 network.request/download。
- 游戏与协作 APP 使用 realtime.room.create/list/join/leave/send/setState/getState/members/close，并声明 app.<app-id>.realtime.room；DX Developer 的模拟运行与正式安装后的 APP 使用同一协议。create 传 discoverable: true 后，同一 DX OS 服务的局域网设备可通过 list 发现房间。
- realtime.room.create 只创建房间，不会自动加入；create 与 join 是两个独立调用。APP 必须为每个运行实例生成一个符合 ^[a-zA-Z0-9_.-]{3,100}$ 的稳定 clientId，并在 join 时显式传入。局域网普通 HTTP 页面不要依赖 crypto.randomUUID()，因为非安全上下文或旧 WebView 可能不提供该函数。
- 如果 create 成功但 join 失败，房主应立即调用 realtime.room.close 清理刚创建的房间。否则零成员房间可能在 list 中保留，直到服务端完成约 30 分钟的空闲回收；房间大厅也应隐藏 members 为 0 的遗留房间。
- realtime.room.leave 只断开当前成员；realtime.room.close 仅房主可调用并会关闭整个房间。用于重连的 clientId 应在当前 APP 运行期间保持不变，但不属于项目持久数据。

\`\`\`js
const clientId = 'game-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
let roomId = null
try {
  const created = await window.dx.invoke('realtime.room.create', {
    name: '好友对局', discoverable: true, maxMembers: 4, state: { phase: 'waiting' }
  })
  roomId = created.room.id
  await window.dx.invoke('realtime.room.join', { roomId, clientId })
} catch (error) {
  // create 与 join 不是原子操作；加入失败时避免留下零成员房间。
  if (roomId) await window.dx.invoke('realtime.room.close', { roomId }).catch(() => undefined)
  throw error
}
addEventListener('message', (event) => {
  const message = event.data
  if (message?.dxos === 'v1' && message.type === 'realtime.event' && message.roomId === roomId) {
    // message.data.type: joined | message | state | members | owner | closed | error
  }
})
await window.dx.invoke('realtime.room.send', { roomId, data: { type: 'player-input', direction: 'left' } })
\`\`\`

## 持久协同项目
- 剧本、视频工程、白板、文档等需要“一个项目、多人访问”的 APP 使用 collab.project.*，并声明 app.<app-id>.collab.project。
- 每个协同项目拥有 owner、read/edit 成员、邀请口令、通用 JSON document、单调递增 version 和独立实时房间。document 最大 2 MB，只保存业务结构与媒体引用，不能保存大型 Base64。
- 当前 collab.project.* 尚未映射到“项目/<APP 名称>/<项目名称>”文件夹，也未开放成员共享二进制附件；普通 project.* 与 APP Agent 仍使用当前账户的“项目/<APP 名称>”根目录。不要把普通 project.* 文件误写成已由协同项目 ACL 共享。
- 更新必须传 baseVersion。版本冲突时结果包含 conflict: true、code: "VERSION_CONFLICT" 和最新 current，APP 应合并或提示用户重载，不能静默覆盖他人修改。

\`\`\`js
const created = await window.dx.invoke('collab.project.create', {
  name: '第一集', kind: 'video', document: { scenes: [], timeline: [] }
})
const project = created.project
await window.dx.invoke('collab.project.connect', { projectId: project.id })

const saved = await window.dx.invoke('collab.project.update', {
  projectId: project.id,
  baseVersion: project.version,
  document: { ...project.document, scenes: nextScenes }
})

const invitation = await window.dx.invoke('collab.project.invite.create', {
  projectId: project.id, access: 'edit'
})
// 另一位已登录用户：
await window.dx.invoke('collab.project.invite.redeem', { code: invitation.code })
\`\`\`

协同项目动作：collab.project.create/list/get/update/delete、members.set、directory、invite.create/revoke/redeem、connect/disconnect/send。connect 后服务端版本变化通过 realtime.event 的 state 事件通知，收到后重新 get 项目即可取得最新文档。

## 特权 APP 与 app.api
- 只有确实需要复用 DX OS 现有内部业务接口时才使用 app.api；能用 Skill、MCP、Agent、task.*、project.* 或 network.* 完成时优先使用公开 Bridge。
- 是否可以使用 app.api 由“管理员安装的特权包 + 清单声明”决定，不由是否上架应用商店决定。开发者可在外部完成代码和 ZIP，交给管理员审查后直接安装测试。
- 清单必须声明 permissions 中的 app.<app-id>.app-api.call，并在 appApi 中逐项列出 method 和 path。path 只写 /api 之后的宿主路径，例如宿主请求 /api/canvas/generate 时声明 /canvas/generate。
- APP 仍然不能在 iframe 内 fetch('/api/...')；必须通过 window.dx.invoke('app.api', ...) 让宿主执行白名单检查、账户权限检查和审计。
- app.api 默认等待 30 秒。有限耗时的前台调用可传 bridgeTimeoutMs，宿主最多接受 900000 ms；需要关闭窗口后继续或可能运行数十分钟的视频任务必须使用 task.*，不能依赖延长 Bridge 等待。
- multipart 上传应把 File/Blob 直接放入 app.api 的 parts（字段使用 blob），不要转成 Base64。系统通过结构化克隆传递 Blob，并由 fetch 流式发送；/fs/upload 单文件上限 2 GB、单次总量 8 GB、最多 30 个文件。旧版 content Base64 格式仅为兼容保留，仍限制为 24 MB。

\`\`\`json
{
  "permissions": ["app.my-tool.app-api.call"],
  "appApi": [
    { "method": "POST", "path": "/canvas/generate" },
    { "method": "GET", "path": "/canvas/tasks" }
  ]
}
\`\`\`

\`\`\`js
const result = await window.dx.invoke('app.api', {
  method: 'POST',
  path: '/canvas/generate',
  body: { prompt: '生成产品图' },
  bridgeTimeoutMs: 15 * 60_000
})
\`\`\`

\`\`\`js
async function loadDocument() {
  await window.dx.invoke('project.mkdir', { path: '存档' })
  try {
    const result = await window.dx.invoke('project.read', { path: '存档/current.json' })
    return JSON.parse(result.content)
  } catch (error) {
    return null
  }
}
async function saveDocument(value) {
  return window.dx.invoke('project.write', {
    path: '存档/current.json',
    content: JSON.stringify(value, null, 2)
  })
}
\`\`\`

项目桥动作与清单权限的对应关系：
- project.info/list/read → app.<app-id>.project.read
- project.write/mkdir → app.<app-id>.project.write
- project.remove → app.<app-id>.project.delete

## Agent 与依赖
- 如 APP 暴露 Agent 工具，提供 agent.tools.json，声明 name、title、description、whenToUse、inputSchema、permission、risk、sideEffects 和 handler。
- Skill/MCP 依赖写入 dx-app.json.dependencies；上传与安装阶段不得自动执行未知安装脚本。
- 完成前必须在源码中检查 light/dark 两套 CSS 变量、zh-CN/en-US 两套文案以及 context 消息监听；再逐文件核对清单、入口、资源引用、权限和持久化实现，通过后才调用 finish_task。`

const SOFTWARE = `# DX OS 普通软件开发规范

## 适用场景
用于游戏、可视化、计算器、编辑器、仪表盘等纯前端 APP；运行于 DX OS 隔离 iframe，不要求 Skill 或 MCP。

## 最小结构
\`\`\`
dx-app.json
index.html
assets/
\`\`\`

## 清单示例
\`\`\`json
{
  "format": "dx-app/v2",
  "id": "my-tool",
  "version": "1.0.0",
  "build": 10000,
  "releaseChannel": "stable",
  "minSystemVersion": "0.1.0",
  "dataVersion": 1,
  "name": "我的工具",
  "subtitle": "开发者应用",
  "description": "一个可以直接在 DX OS 中运行的前端工具。",
  "category": "software",
  "entry": "index.html",
  "defaultSize": { "width": 900, "height": 640 },
  "icon": {
    "gradient": "linear-gradient(145deg, #5b8cff, #7057ff)",
    "svg": "<svg viewBox='0 0 64 64'><rect x='14' y='14' width='36' height='36' rx='10' fill='white'/></svg>"
  },
  "permissions": ["app.my-tool.open"]
}
\`\`\`

只有 APP 确实需要调用 Agent、Skill 或 MCP 时才增加 agent.tools.json 或 dependencies。`

const SKILL = `# DX OS Skill 适配开发规范

## 核心逻辑
APP 声明并调用系统中已安装、启用且获授权的 Skill。不要把“调用一个 Skill”和“在包内附带 Skill 说明文档”混为一谈。

## 必要文件
- dx-app.json：在 dependencies 中声明 type=skill 的依赖。
- agent.tools.json：handler.type=skill，handler.skillId 必须对应依赖 ID。
- skills/SKILL.md：仅在 APP 包需要携带 Skill 文档时提供，写明触发条件、输入、工作流、权限、输出和自查。

## 依赖示例
\`\`\`json
{
  "dependencies": [{
    "type": "skill",
    "id": "chat",
    "name": "对话回复 Skill",
    "required": true,
    "source": "system",
    "installHint": "请先在 Skill 应用中导入并启用 chat。"
  }],
  "permissions": ["app.weather-chat.chat.run"]
}
\`\`\`

## agent.tools.json 示例
\`\`\`json
{
  "format": "dx-agent-tools/v1",
  "appId": "weather-chat",
  "tools": [{
    "name": "weather-chat-summary",
    "title": "一句话总结",
    "description": "调用系统 chat Skill 生成简短回复。",
    "whenToUse": ["用户要求总结或改写内容时"],
    "permission": "app.weather-chat.chat.run",
    "risk": "read",
    "sideEffects": ["call:skill"],
    "handler": { "type": "skill", "skillId": "chat" },
    "inputSchema": { "type": "object", "properties": { "instruction": { "type": "string" } }, "required": ["instruction"] }
  }]
}
\`\`\`

前端也可通过 postMessage 调用 skill.run，但必须传入已授权 permission 和已安装 skillId。`

const MCP = `# DX OS MCP 适配开发规范

## 核心逻辑
APP 可在包内携带标准 MCP 导入清单以及实现代码或预打包依赖。包是 MCP 定义真源；密钥、Headers、启用状态和用户覆盖值由服务端按 appId + serverId 持久化，不能写入浏览器存储。

## 必要文件
- mcp/mcp.json：标准导入清单，支持 mcpServers、servers 或 mcp.servers。
- mcp/*：MCP 源码或预打包依赖；stdio 的 cwd 只能指向包内 mcp/。
- dx-app.json：dependencies 中声明 type=mcp、source=bundled、path=mcp/mcp.json。
- agent.tools.json：handler.type=mcp-tool，serverId/toolName 与 mcp.json 完全一致。

## mcp/mcp.json 示例
\`\`\`json
{
  "format": "dx-mcp/v1",
  "mcpServers": {
    "weather-mcp": {
      "name": "天气 MCP",
      "command": "node",
      "args": ["server.js"],
      "cwd": "mcp",
      "env": { "WEATHER_API_KEY": "\${secret:WEATHER_API_KEY}", "LOG_LEVEL": "info" }
    }
  }
}
\`\`\`

HTTP MCP 必须使用 HTTPS url；Token、Key、Authorization、Cookie 必须使用 secret 占位符，不得写入包。

## 依赖与工具绑定示例
\`\`\`json
{
  "dependencies": [{
    "type": "mcp",
    "id": "weather-mcp",
    "name": "天气 MCP",
    "required": true,
    "source": "bundled",
    "path": "mcp/mcp.json",
    "installHint": "导入后填写密钥并确认连接。"
  }]
}
\`\`\`

agent.tools.json 的工具 handler 使用：
\`\`\`json
{ "type": "mcp-tool", "serverId": "weather-mcp", "toolName": "forecast" }
\`\`\`

APP 更新时保留服务端安全配置并更新包内定义；卸载默认停用并保留配置，只有用户明确删除 APP 数据时才彻底清理。`

export const DEVELOPER_GUIDE_VERSION = '2026.08.25-1'
export const DEVELOPER_GUIDE_BODIES: Record<DeveloperGuideKind, string> = {
  software: `${COMMON}\n\n${SOFTWARE}`,
  skill: `${COMMON}\n\n${SKILL}`,
  mcp: `${COMMON}\n\n${MCP}`,
}

export function developerGuideFor(kind: DeveloperGuideKind) {
  return DEVELOPER_GUIDE_BODIES[kind]
}
