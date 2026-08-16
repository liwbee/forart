export const zhCN = {
  actions: {
    confirm: "确认",
    viewImage: "查看原图",
    add: "添加",
    back: "返回",
    cancel: "取消",
    create: "创建",
    delete: "删除",
    rename: "重命名",
    search: "搜索",
    save: "保存",
    close: "关闭",
    toggleSidebar: "切换侧边栏",
    uploadImage: "上传图片",
    downloadOriginalImage: "下载原图",
    copyNode: "复制节点",
    copyImage: "复制图片",
    copyError: "复制完整报错信息",
    paste: "粘贴"
  },
  confirm: {
    delete: "确认删除?"
  },
  bulk: {
    addTags: "批量添加标签",
    clearSelection: "清空选择",
    confirmDelete: "确定？",
    deleteConfirmBody: "此操作无法撤销。",
    deleteConfirmTitle: "删除 {{count}} 张已选卡片？",
    deleteSelected: "删除",
    deleteSelectedCount: "删除 {{count}} 张",
    manage: "管理",
    matchingCount: "匹配 {{count}} 张",
    operationCompleted: "已处理 {{count}} 张卡片",
    operationFailed: "批量操作失败：{{message}}",
    removeTags: "批量移除标签",
    selectCard: "选择卡片",
    selectMatching: "选择匹配项",
    selectedCount: "已选 {{count}} 张",
    selectionMode: "批量选择",
    unselectCard: "取消选择卡片"
  },
  states: {
    adding: "添加中...",
    creating: "创建中...",
    loading: "加载中...",
    loadingProjects: "正在加载项目...",
    storageUnavailable: "资源库存储目录暂不可用，请检查服务器数据目录配置。",
    saving: "保存中...",
    uploading: "上传中...",
    copyingImage: "正在复制图片...",
    imageCopied: "图片已复制",
    downloadingImage: "正在下载图片...",
    imageDownloadStarted: "已开始下载图片"
  },
  errors: {
    fileReadFailed: "读取文件失败",
    imageReadFailed: "读取图片失败",
    imageReadFailedWithStatus: "读取图片失败（HTTP {{status}}）",
    canvasUnavailable: "无法创建图片处理画布",
    clipboardImagePrepareFailed: "无法准备要复制的图片",
    imageActionFailed: "图片操作失败：{{message}}",
    nameAlreadyExists: "名称已存在",
    invalidFileNameCharacters: "名称不能包含这些字符：< > : \" / \\ | ? *"
  },
  empty: {
    noImage: "暂无图片",
    noProjects: "还没有项目。",
    noTagsYet: "还没有标签。"
  },
  remoteData: {
    title: {
      unauthenticated: "尚未登录服务器",
      forbidden: "当前账号没有访问权限",
      timeout: "服务器响应超时",
      unavailable: "无法连接服务器",
      server: "服务器暂时异常",
      request: "请求未能完成",
      unknown: "加载数据时发生错误"
    },
    description: {
      unauthenticated: "登录服务器后即可继续加载这些内容。",
      forbidden: "请切换到有权限的账号，或联系管理员调整权限。",
      timeout: "网络较慢或服务器正忙，请稍后重试。",
      unavailable: "请检查服务器是否已启动、地址是否正确以及当前网络连接。",
      server: "服务器已收到请求但未能正常处理，请稍后重试。",
      request: "请检查当前操作或服务器配置后再试。",
      unknown: "数据没有被清空，你可以重试或检查服务器设置。"
    },
    actions: {
      login: "登录服务器",
      switchAccount: "切换账号",
      retry: "重试",
      retrying: "正在重试",
      settings: "检查设置"
    }
  },
  workspaceError: {
    title: "页面暂时无法显示",
    description: "当前页面发生了意外错误。其他页面和设置仍可继续使用，你可以重试或检查配置。",
    retry: "重新打开页面",
    settings: "打开设置"
  },
  labels: {
    tagColor: "标签颜色",
    collapseTags: "收起标签",
    excludeTag: "排除 {{name}}",
    excludedTag: "不含 {{name}}",
    expandTags: "展开标签",
    sameColorSingleFilter: "同色单选筛选",
    ascending: "升序",
    createdAt: "时间",
    descending: "降序",
    libraryViewOptions: "资源库视图选项",
    sort: "排序",
    sortDirection: "排序方向",
    sortField: "排序字段",
    all: "全部",
    untagged: "未标记",
    cardSize: "卡片尺寸",
    editTag: "编辑标签",
    emptyTagEditor: "创建标签后可在这里编辑。",
    name: "名称",
    manageTags: "管理标签",
    newProject: "新建项目",
    newTag: "新标签",
    notSelected: "未选择",
    projectName: "项目名称",
    selectProjectFirst: "请先选择项目",
    tagList: "标签列表",
    tagNamePlaceholder: "输入标签名称",
    tags: "标签"
  }
} as const;

export const enUS = {
  actions: {
    confirm: "Confirm",
    viewImage: "View original image",
    add: "Add",
    back: "Back",
    cancel: "Cancel",
    create: "Create",
    delete: "Delete",
    rename: "Rename",
    search: "Search",
    save: "Save",
    close: "Close",
    toggleSidebar: "Toggle sidebar",
    uploadImage: "Upload image",
    downloadOriginalImage: "Download original image",
    copyNode: "Copy node",
    copyImage: "Copy image",
    copyError: "Copy full error message",
    paste: "Paste"
  },
  confirm: {
    delete: "Confirm delete?"
  },
  bulk: {
    addTags: "Add tags",
    clearSelection: "Clear selection",
    confirmDelete: "Confirm?",
    deleteConfirmBody: "This cannot be undone.",
    deleteConfirmTitle: "Delete {{count}} selected cards?",
    deleteSelected: "Delete",
    deleteSelectedCount: "Delete {{count}}",
    manage: "Manage",
    matchingCount: "{{count}} matching",
    operationCompleted: "Processed {{count}} cards",
    operationFailed: "Bulk operation failed: {{message}}",
    removeTags: "Remove tags",
    selectCard: "Select card",
    selectMatching: "Select matching",
    selectedCount: "{{count}} selected",
    selectionMode: "Bulk select",
    unselectCard: "Unselect card"
  },
  states: {
    adding: "Adding...",
    creating: "Creating...",
    loading: "Loading...",
    loadingProjects: "Loading projects...",
    storageUnavailable: "Asset library storage is unavailable. Check the server data directory configuration.",
    saving: "Saving...",
    uploading: "Uploading...",
    copyingImage: "Copying image...",
    imageCopied: "Image copied",
    downloadingImage: "Downloading image...",
    imageDownloadStarted: "Image download started"
  },
  errors: {
    fileReadFailed: "Failed to read the file",
    imageReadFailed: "Failed to read the image",
    imageReadFailedWithStatus: "Failed to read the image (HTTP {{status}})",
    canvasUnavailable: "The image processing canvas is unavailable",
    clipboardImagePrepareFailed: "Failed to prepare the image for the clipboard",
    imageActionFailed: "Image action failed: {{message}}",
    nameAlreadyExists: "Name already exists",
    invalidFileNameCharacters: "Name cannot contain these characters: < > : \" / \\ | ? *"
  },
  empty: {
    noImage: "No image",
    noProjects: "No projects yet.",
    noTagsYet: "No tags yet."
  },
  remoteData: {
    title: {
      unauthenticated: "Not logged in to the server",
      forbidden: "This account does not have access",
      timeout: "The server timed out",
      unavailable: "Unable to reach the server",
      server: "The server is temporarily unavailable",
      request: "The request could not be completed",
      unknown: "Something went wrong while loading data"
    },
    description: {
      unauthenticated: "Log in to the server to continue loading this content.",
      forbidden: "Switch to an account with access or ask an administrator to update your permissions.",
      timeout: "The network may be slow or the server may be busy. Try again in a moment.",
      unavailable: "Check that the server is running, the address is correct, and the network is connected.",
      server: "The server received the request but could not process it. Try again shortly.",
      request: "Check the current action or server configuration and try again.",
      unknown: "Your existing data is preserved. Retry or check the server settings."
    },
    actions: {
      login: "Log in",
      switchAccount: "Switch account",
      retry: "Retry",
      retrying: "Retrying",
      settings: "Check settings"
    }
  },
  workspaceError: {
    title: "This page could not be displayed",
    description: "An unexpected error occurred on this page. Other pages and settings remain available; retry or check the configuration.",
    retry: "Reopen page",
    settings: "Open settings"
  },
  labels: {
    collapseTags: "Collapse tags",
    excludeTag: "Exclude {{name}}",
    excludedTag: "Without {{name}}",
    expandTags: "Expand tags",
    sameColorSingleFilter: "Single selection per color",
    ascending: "Asc",
    createdAt: "Time",
    descending: "Desc",
    libraryViewOptions: "Library view options",
    sort: "Sort",
    sortDirection: "Sort direction",
    sortField: "Sort field",
    all: "All",
    untagged: "Untagged",
    cardSize: "Card size",
    editTag: "Edit tag",
    emptyTagEditor: "Create a tag, then edit it here.",
    name: "Name",
    manageTags: "Manage tags",
    newProject: "New project",
    newTag: "New tag",
    notSelected: "Not selected",
    projectName: "Project name",
    selectProjectFirst: "Select a project first",
    tagColor: "Tag color",
    tagList: "Tag list",
    tagNamePlaceholder: "Enter a tag name",
    tags: "Tags"
  }
} as const;
