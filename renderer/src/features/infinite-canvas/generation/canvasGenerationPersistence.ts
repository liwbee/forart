import { useCallback, useRef, type MutableRefObject } from "react";
import type { CanvasConnection, CanvasGroup, CanvasNode, CanvasProject, CanvasProjectRecord, Viewport } from "../types";

interface UseCanvasGenerationPersistenceOptions {
  activeCanvasTitle: string;
  activeProject: CanvasProjectRecord | null;
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

  const saveCanvasProjectPatch = useCallback(async (canvasId: string, nodeId: string, resolvePatch: (node: CanvasNode, project: CanvasProject) => Partial<CanvasNode>) => {
    if (!canvasId || !window.easyTool?.loadCanvasProject || !window.easyTool.saveCanvasProject) return;
    const project = await window.easyTool.loadCanvasProject(canvasId) as CanvasProject | null;
    if (!project || !Array.isArray(project.nodes)) return;
    let changed = false;
    const nextNodes = project.nodes.map((projectNode) => {
      if (projectNode.id !== nodeId) return projectNode;
      changed = true;
      return { ...projectNode, ...resolvePatch(projectNode, project) };
    });
    if (!changed) return;
    await window.easyTool.saveCanvasProject(canvasId, {
      title: project.title,
      icon: project.icon,
      canvasType: project.canvasType,
      source: project.source,
      libtvProjectId: project.libtvProjectId,
      libtvProjectName: project.libtvProjectName,
      nodes: nextNodes,
      connections: project.connections,
      groups: project.groups,
      viewport: project.viewport,
    });
  }, []);

  const saveActiveCanvasNodes = useCallback((canvasId: string, nextNodes: CanvasNode[]) => {
    if (!canvasId || !window.easyTool?.saveCanvasProject) return;
    const snapshot = activeCanvasSnapshotRef.current;
    void window.easyTool.saveCanvasProject(canvasId, {
      title: snapshot.activeCanvasTitle,
      icon: snapshot.activeProject?.icon,
      canvasType: snapshot.activeProject?.canvasType,
      source: snapshot.activeProject?.source,
      libtvProjectId: snapshot.activeProject?.libtvProjectId,
      libtvProjectName: snapshot.activeProject?.libtvProjectName,
      nodes: nextNodes,
      connections: snapshot.connections,
      groups: snapshot.groups,
      viewport: snapshot.viewport,
    });
  }, []);

  const patchGenerationNode = useCallback(async (canvasId: string, nodeId: string, resolvePatch: (node: CanvasNode, project?: CanvasProject) => Partial<CanvasNode>) => {
    if (activeCanvasIdRef.current === canvasId) {
      let nextNodesForSave: CanvasNode[] | null = null;
      setNodes((current) => current.map((currentNode) => (
        currentNode.id === nodeId ? { ...currentNode, ...resolvePatch(currentNode) } : currentNode
      )).map((nextNode, _index, nextNodes) => {
        nextNodesForSave = nextNodes;
        return nextNode;
      }));
      if (nextNodesForSave) saveActiveCanvasNodes(canvasId, nextNodesForSave);
      return;
    }
    await saveCanvasProjectPatch(canvasId, nodeId, resolvePatch);
  }, [activeCanvasIdRef, saveActiveCanvasNodes, saveCanvasProjectPatch, setNodes]);

  const persistActiveGenerationNode = useCallback((canvasId: string, nodeId: string, patch: Partial<CanvasNode>) => {
    let nextNodesForSave: CanvasNode[] | null = null;
    setNodes((current) => current.map((currentNode) => (
      currentNode.id === nodeId ? { ...currentNode, ...patch } : currentNode
    )).map((nextNode, _index, nextNodes) => {
      nextNodesForSave = nextNodes;
      return nextNode;
    }));
    if (nextNodesForSave) saveActiveCanvasNodes(canvasId, nextNodesForSave);
  }, [saveActiveCanvasNodes, setNodes]);

  return {
    patchGenerationNode,
    persistActiveGenerationNode,
    saveActiveCanvasNodes,
  };
}
