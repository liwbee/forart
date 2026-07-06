export const zhCN = {
  loadingLabel: "Forart 正在启动",
  loadingConfig: "正在读取配置...",
  mainNavigation: "主导航",
  settingsNavigation: "设置导航",
  unsupportedRuntimeTitle: "请使用 Forart 桌面版",
  unsupportedRuntimeDescription: "Forart 现在定义为 Electron 桌面应用。直接在普通浏览器中打开前端不是受支持的产品入口。",
  unsupportedRuntimeDiagnostic: "如需调试前端渲染器，可以在开发环境使用 dev:web 并追加 ?diagnostic=1；完整功能请通过 Electron 启动。",
  unsupportedRuntimeMissing: "缺少 Electron bridge：{{bridges}}",
} as const;

export const enUS = {
  loadingLabel: "Forart is starting",
  loadingConfig: "Loading configuration...",
  mainNavigation: "Main navigation",
  settingsNavigation: "Settings navigation",
  unsupportedRuntimeTitle: "Use the Forart desktop app",
  unsupportedRuntimeDescription: "Forart is now defined as an Electron desktop application. Opening the renderer directly in a normal browser is not a supported product entry point.",
  unsupportedRuntimeDiagnostic: "You can still use dev:web with ?diagnostic=1 for renderer diagnostics in development, but full functionality requires starting the Electron app.",
  unsupportedRuntimeMissing: "Missing Electron bridges: {{bridges}}",
} as const;
