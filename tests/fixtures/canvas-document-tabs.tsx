import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "../../renderer/src/i18n";
import "../../renderer/src/styles/global.css";
import { Tabs } from "../../renderer/src/components/ui/tabs";
import { CanvasDocumentTabs } from "../../renderer/src/features/infinite-canvas/CanvasDocumentTabs";
import type { CanvasDocumentTab, CanvasProjectRecord } from "../../renderer/src/features/infinite-canvas/canvasWorkspaceTypes";

const projects: CanvasProjectRecord[] = [
  { id: "project-1", title: "项目一", sortOrder: 1, createdAt: 1, updatedAt: 1 },
  { id: "project-2", title: "项目二", sortOrder: 2, createdAt: 1, updatedAt: 1 },
];

function Fixture() {
  const [createdProjectId, setCreatedProjectId] = useState("");
  const [tabs, setTabs] = useState<CanvasDocumentTab[]>([
    { id: "canvas-1", title: "画布一", updatedAt: 1, projectId: "project-1" },
    { id: "canvas-2", title: "画布二", updatedAt: 1, projectId: "project-1" },
    { id: "canvas-3", title: "画布三", updatedAt: 1, projectId: "project-2" },
  ]);

  return (
    <main className="p-3">
      <Tabs value="canvas-1">
        <CanvasDocumentTabs
          tabs={tabs}
          activeValue="canvas-1"
          onClose={() => undefined}
          onCreateCanvas={setCreatedProjectId}
          onRename={() => undefined}
          onReorder={setTabs}
          menuActions={{
            localProjects: projects,
            projects,
            sharedCanvasesEnabled: true,
            sharedProjects: projects,
            onCopyToLocal: () => undefined,
            onDelete: () => undefined,
            onDuplicate: () => undefined,
            onExport: () => undefined,
            onMove: () => undefined,
            onUpload: () => undefined,
          }}
        />
      </Tabs>
      <output data-testid="created-project">{createdProjectId}</output>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Fixture />);
