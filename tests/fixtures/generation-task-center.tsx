import React from "react";
import ReactDOM from "react-dom/client";
import "../../renderer/src/i18n";
import "../../renderer/src/styles/global.css";
import type { GenerationTaskDto } from "../../renderer/src/app/appConfig";
import { GenerationTaskCenter } from "../../renderer/src/features/infinite-canvas/generation/GenerationTaskCenter";

const tasks: GenerationTaskDto[] = Array.from({ length: 65 }, (_, index) => ({
  id: `task-${index}`,
  target: { canvasId: "canvas", kind: "imageGenerator", nodeId: `node-${index}` },
  executorKind: "api",
  providerName: "API Mart",
  model: "gpt-image-2",
  resolution: "1K",
  aspectRatio: "3:4",
  status: "succeeded",
  version: 1,
  startedAt: index + 1,
  updatedAt: 10_000 - index,
  result: {
    images: [{ assetUrl: `/task-original-${index}.png`, fileName: `task-${index}.png` }],
  },
}));

window.forartGenerationTasks = {
  async get() { return null; },
  async getMany() { return []; },
  async listForCanvas() { return []; },
  async listRecent() { return []; },
  async listPage({ limit, offset }) {
    document.documentElement.dataset.taskOffset = String(offset);
    return {
      tasks: tasks.slice(offset, offset + limit),
      total: tasks.length,
      counts: { all: tasks.length, active: 0, succeeded: tasks.length, exceptional: 0 },
    };
  },
  async start() { return null; },
  async startMany() { return []; },
  async stop() { return null; },
  onChanged() { return () => undefined; },
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <main style={{ width: 390, height: 600 }}>
    <GenerationTaskCenter open onClose={() => undefined} />
  </main>,
);
