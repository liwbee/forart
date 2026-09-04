import React from "react";
import ReactDOM from "react-dom/client";
import "../../renderer/src/i18n";
import "../../renderer/src/styles/global.css";
import type { CanvasTaskDto } from "../../renderer/src/app/appConfig";
import { GenerationTaskCenter } from "../../renderer/src/features/infinite-canvas/generation/GenerationTaskCenter";

const tasks: CanvasTaskDto[] = Array.from({ length: 65 }, (_, index) => ({
  id: `task-${index}`,
  category: "image",
  operation: "image_generate",
  canvasId: "canvas",
  nodeId: `node-${index}`,
  providerName: "API Mart",
  model: "gpt-image-2",
  executorKind: "api",
  status: "succeeded",
  version: 1,
  createdAt: index + 1,
  startedAt: index + 1,
  updatedAt: 10_000 - index,
  resultKind: "image",
  result: {
    images: [{
      assetUrl: `/task-original-${index}.png`,
      thumbUrl: `/task-thumb-${index}.webp`,
      fileName: `task-${index}.png`,
    }],
  },
}));

// 任务中心从画布任务仓库桥读取分页数据（与主进程 canvas-task-repository 同构）。
window.forartCanvasTasks = {
  async listPage({ limit, offset }) {
    document.documentElement.dataset.taskOffset = String(offset);
    return {
      tasks: tasks.slice(offset, offset + limit),
      total: tasks.length,
      counts: { all: tasks.length, active: 0, succeeded: tasks.length, exceptional: 0 },
    };
  },
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <main style={{ width: 390, height: 600 }}>
    <GenerationTaskCenter open onClose={() => undefined} />
  </main>,
);
