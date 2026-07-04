export const zhCN = {
  actions: {
    add: "添加",
    back: "返回",
    cancel: "取消",
    create: "创建",
    delete: "删除",
    rename: "重命名",
    search: "搜索",
    save: "保存",
    close: "关闭",
    uploadImage: "上传图片",
    downloadOriginalImage: "下载原图",
    copyImage: "复制图片"
  },
  confirm: {
    delete: "确认删除?"
  },
  states: {
    adding: "添加中...",
    creating: "创建中...",
    loading: "加载中...",
    loadingProjects: "正在加载项目...",
    saving: "保存中...",
    uploading: "上传中...",
    copyingImage: "正在复制图片...",
    imageCopied: "图片已复制",
    downloadingImage: "正在下载图片...",
    imageDownloadStarted: "已开始下载图片"
  },
  errors: {
    imageActionFailed: "图片操作失败：{{message}}",
    nameAlreadyExists: "名称已存在",
    invalidFileNameCharacters: "名称不能包含这些字符：< > : \" / \\ | ? *"
  },
  empty: {
    noImage: "暂无图片",
    noProjects: "还没有项目。",
    noTagsYet: "还没有标签。"
  },
  labels: {
    all: "全部",
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
    add: "Add",
    back: "Back",
    cancel: "Cancel",
    create: "Create",
    delete: "Delete",
    rename: "Rename",
    search: "Search",
    save: "Save",
    close: "Close",
    uploadImage: "Upload image",
    downloadOriginalImage: "Download original image",
    copyImage: "Copy image"
  },
  confirm: {
    delete: "Confirm delete?"
  },
  states: {
    adding: "Adding...",
    creating: "Creating...",
    loading: "Loading...",
    loadingProjects: "Loading projects...",
    saving: "Saving...",
    uploading: "Uploading...",
    copyingImage: "Copying image...",
    imageCopied: "Image copied",
    downloadingImage: "Downloading image...",
    imageDownloadStarted: "Image download started"
  },
  errors: {
    imageActionFailed: "Image action failed: {{message}}",
    nameAlreadyExists: "Name already exists",
    invalidFileNameCharacters: "Name cannot contain these characters: < > : \" / \\ | ? *"
  },
  empty: {
    noImage: "No image",
    noProjects: "No projects yet.",
    noTagsYet: "No tags yet."
  },
  labels: {
    all: "All",
    editTag: "Edit tag",
    emptyTagEditor: "Create a tag, then edit it here.",
    name: "Name",
    manageTags: "Manage tags",
    newProject: "New project",
    newTag: "New tag",
    notSelected: "Not selected",
    projectName: "Project name",
    selectProjectFirst: "Select a project first",
    tagList: "Tag list",
    tagNamePlaceholder: "Enter a tag name",
    tags: "Tags"
  }
} as const;
