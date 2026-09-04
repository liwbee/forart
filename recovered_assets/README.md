# 桥豆麻衣酱 V.3.4.9：已恢复的前端资源

这些文件从 Tauri 内嵌资源中提取，并使用 Brotli 解压。

- `index-2lNmXjSU.js`：主前端 bundle，约 7.4 MB
- `index-8tLUKGk6.css`：主样式 bundle，约 532 KB
- `visibleNodesWorker-DPTCyfUi.js`：可见节点 worker
- `thumbnailWorker-DHaBQQYW.js`：缩略图 worker
- `*.webp`、`*.png`：模型图标和界面图片

原始文件名中的 hash 是构建工具生成的内容指纹。没有发现 source map，因此变量名、模块边界和 TypeScript 类型已经被构建流程部分抹平；但业务字符串、接口路径和大部分前端逻辑仍在主 bundle 中。

原始 Rust/Tauri 后端没有以源码形式嵌入，需要继续使用 Ghidra/IDA 对 PE 的 `.text` 段进行反编译。
