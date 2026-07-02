import { useCallback, useRef, type MutableRefObject } from "react";
import { sanitizeCanvasNodesForSave } from "../canvasSerialization";
import type { CanvasConnection, CanvasDocument, CanvasDocumentRecord, CanvasGroup, CanvasNode, Viewport } from "../types";

interface UseCanvasGenerationPersistenceOptions {
  activeCanvasTitle: string;
  activeProject: CanvasDocumentRecord | null;
  connections: CanvasConnection[];
  groups: CanvasGroup[];
  viewport: Viewport;
  activeCanvasIdRef: MutableRefObject<string>;
  setNodes: (updater: CanvasNode[] | ((current: CanvasNode[]) => CanvasNode[])) => void;
}

export function useCanvasGenerationPersistence({
  activeCanvasTitle,
  activeProject,
  connections,
  groups,
  viewport,
  activeCanvasIdRef,
  setNodes,
}: UseCanvasGenerationPersistenceOptions) {
  const activeCanvasSnapshotRef = useRef({ activeCanvasTitle, activeProject, connections, groups, viewport });
  activeCanvasSnapshotRef.current = { activeCanvasTitle, activeProject, connections, groups, viewport };

  const saveCanvasDocumentPatch = useCallback(async (canvasId: string, nodeId: string, resolvePatch: (node: CanvasNode, project: CanvasDocument) => Partial<CanvasNode>) => {
    if (!canvasId || !window.easyTool?.loadCanvas || !window.easyTool.saveCanvas) return;
    const project = await window.easyTool.loadCanvas(canvasId) as CanvasDocument | null;
    if (!project || !Array.isArray(project.nodes)) return;
    let changed = false;
    const nextNodes = project.nodes.map((projectNode) => {
      if (projectNode.id !== nodeId) return projectNode;
      changed = true;
      return { ...projectNode, ...resolvePatch(projectNode, project) };
    });
    if (!changed) return;
    await window.easyTool.saveCanvas(canvasId, {
      title: project.title,
      icon: project.icon,
      canvasType: project.canvasType,
      source: project.source,
      nodes: sanitizeCanvasNodesForSave(nextNodes),
      connections: project.connections,
      groups: project.groups,
      viewport: project.viewport,
    });
  }, []);

  const saveActiveCanvasNodes = useCallback(async (canvasId: string, nextNodes: CanvasNode[]) => {
    if (!canvasId || !window.easyTool?.saveCanvas) return;
    const snapshot = activeCanvasSnapshotRef.current;
    await window.easyTool.saveCanvas(canvasId, {
      title: snapshot.activeCanvasTitle,
      icon: snapshot.activeProject?.icon,
      canvasType: snapshot.activeProject?.canvasType,
      source: snapshot.activeProject?.source,
      nodes: sanitizeCanvasNodesForSave(nextNodes),
      connections: snapshot.connections,
      groups: snapshot.groups,
      viewport: snapshot.viewport,
    });
  }, []);

  const patchGenerationNode = useCallback(async (canvasId: string, nodeId: string, resolvePatch: (node: CanvasNode, project?: CanvasDocument) => Partial<CanvasNode>) => {
    if (activeCanvasIdRef.current === canvasId) {
      let nextNodesForSave: CanvasNode[] | null = null;
      setNodes((current) => current.map((currentNode) => (
        currentNode.id === nodeId ? { ...currentNode, ...resolvePatch(currentNode) } : currentNode
      )).map((nextNode, _index, nextNodes) => {
        nextNodesForSave = nextNodes;
        return nextNode;
      }));
      if (nextNodesForSave) await saveActiveCanvasNodes(canvasId, nextNodesForSave);
      return;
    }
    await saveCanvasDocumentPatch(canvasId, nodeId, resolvePatch);
  }, [activeCanvasIdRef, saveActiveCanvasNodes, saveCanvasDocumentPatch, setNodes]);

  const persistActiveGenerationNode = useCallback(async (canvasId: string, nodeId: string, patch: Partial<CanvasNode>) => {
    let nextNodesForSave: CanvasNode[] | null = null;
    setNodes((current) => current.map((currentNode) => (
      currentNode.id === nodeId ? { ...currentNode, ...patch } : currentNode
    )).map((nextNode, _index, nextNodes) => {
      nextNodesForSave = nextNodes;
      return nextNode;
    }));
    if (nextNodesForSave) await saveActiveCanvasNodes(canvasId, nextNodesForSave);
  }, [saveActiveCanvasNodes, setNodes]);

  return {
    patchGenerationNode,
    persistActiveGenerationNode,
    saveActiveCanvasNodes,
  };
}
