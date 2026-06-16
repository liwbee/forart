import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { TFunction } from "i18next";
import type { LibtvModelOption } from "../../app/appConfig";
import type { ApiProvider } from "../settings/apiProviders";
import { generateChatWithProvider } from "./core/apiChatGeneration";
import { generateImageWithProvider, recoverImageGenerationTask } from "./core/apiImageGeneration";
import { collectPrompt, collectReferenceImages, collectUpstreamPrompt } from "./core/workflow";
import { IMAGE_ASPECT_RATIO_OPTIONS, IMAGE_RESOLUTION_OPTIONS } from "./constants";
import { fitImageNodeSize, readImageDimensions } from "./imageCrop";
import type { CanvasConnection, CanvasGenerationTask, CanvasGroup, CanvasNode, CanvasProject, CanvasProjectRecord, Viewport } from "./types";

interface SavedCanvasAsset {
  url: string;
  fileName?: string;
  filePath?: string;
}

interface UseCanvasGenerationActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  groups: CanvasGroup[];
  viewport: Viewport;
  apiProviders: ApiProvider[];
  defaultImageProviderId: string;
  imageProviders: ApiProvider[];
  defaultChatProvider: ApiProvider | null;
  chatProviders: ApiProvider[];
  lovartProvider: ApiProvider | null;
  activeCanvasId: string;
  activeCanvasTitle: string;
  activeProject: CanvasProjectRecord | null;
  activeCanvasIdRef: MutableRefObject<string>;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  setNodes: (updater: CanvasNode[] | ((current: CanvasNode[]) => CanvasNode[])) => void;
  saveCanvasImageAsset: (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }) => Promise<SavedCanvasAsset>;
  setLibtvStatus: (status: string) => void;
  t: TFunction;
}

function fitGenerationNodeSize(aspectRatio: string) {
  const [rawW, rawH] = aspectRatio.split(":").map(Number);
  const ratioW = rawW || 1;
  const ratioH = rawH || 1;
  return fitImageNodeSize(ratioW * 1024, ratioH * 1024);
}

function generationTaskRuntimeKey(task: CanvasGenerationTask) {
  return task.upstreamTaskId ? `${task.canvasId}:${task.nodeId}:${task.upstreamTaskId}` : task.id;
}

export function useCanvasGenerationActions({
  nodes,
  connections,
  groups,
  viewport,
  apiProviders,
  defaultImageProviderId,
  imageProviders,
  defaultChatProvider,
  chatProviders,
  lovartProvider,
  activeCanvasId,
  activeCanvasTitle,
  activeProject,
  activeCanvasIdRef,
  patchNode,
  setNodes,
  saveCanvasImageAsset,
  setLibtvStatus,
  t,
}: UseCanvasGenerationActionsOptions) {
  const [libtvModels, setLibtvModels] = useState<LibtvModelOption[]>([]);
  const [libtvModelsLoading, setLibtvModelsLoading] = useState(false);
  const generationAbortControllersRef = useRef<Record<string, AbortController>>({});
  const activeGenerationTaskKeysRef = useRef<Set<string>>(new Set());
  const activeCanvasSnapshotRef = useRef({ activeCanvasTitle, activeProject, connections, groups, viewport });
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

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

  const applyRecoveredImageResult = useCallback(async ({
    canvasId,
    nodeId,
    provider,
    model,
    resolution,
    aspectRatio,
    result,
    task,
  }: {
    canvasId: string;
    nodeId: string;
    provider: ApiProvider;
    model: string;
    resolution?: CanvasNode["imageResolution"];
    aspectRatio?: CanvasNode["imageAspectRatio"];
    result: { url: string; fileName: string; width?: number; height?: number };
    task?: CanvasGenerationTask;
  }) => {
    const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName, kind: "output" });
    const dimensions = await readImageDimensions(saved.url);
    const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : fitImageNodeSize(result.width || 1024, result.height || 1024);
    await patchGenerationNode(canvasId, nodeId, (currentNode) => ({
      url: saved.url,
      fileName: saved.fileName || result.fileName,
      imageProviderId: provider.id,
      imageModel: model,
      imageResolution: resolution,
      imageAspectRatio: aspectRatio,
      imageMode: "imageGenerator",
      imageSource: "generated",
      imageNaturalWidth: dimensions?.width || result.width || 1024,
      imageNaturalHeight: dimensions?.height || result.height || 1024,
      running: false,
      generationError: "",
      generationStatus: "",
      generationTask: {
        ...(currentNode.generationTask || task),
        id: (currentNode.generationTask || task)?.id || `${canvasId}:${nodeId}:recovered`,
        canvasId,
        nodeId,
        providerId: provider.id,
        model,
        status: "succeeded",
        startedAt: (currentNode.generationTask || task)?.startedAt || Date.now(),
        updatedAt: Date.now(),
      },
      ...nextSize,
    }));
  }, [patchGenerationNode, saveCanvasImageAsset]);

  const resumeImageGenerationTask = useCallback(async (node: CanvasNode) => {
    const task = node.generationTask;
    if (!task?.upstreamTaskId || !task.canvasId || !task.nodeId) return;
    if (!["submitting", "running"].includes(task.status)) return;
    const taskKey = generationTaskRuntimeKey(task);
    if (activeGenerationTaskKeysRef.current.has(taskKey)) return;
    const provider = apiProviders.find((item) => item.id === task.providerId && item.protocol !== "lovart" && item.protocol !== "gemini");
    if (!provider) {
      await patchGenerationNode(task.canvasId, task.nodeId, () => ({
        running: false,
        generationStatus: "",
        generationError: t("infiniteCanvas.noImageApiConfigured"),
        generationTask: { ...task, status: "interrupted", error: t("infiniteCanvas.noImageApiConfigured"), updatedAt: Date.now() },
      }));
      return;
    }
    activeGenerationTaskKeysRef.current.add(taskKey);
    await patchGenerationNode(task.canvasId, task.nodeId, (currentNode) => ({
      running: true,
      generationError: "",
      generationStatus: currentNode.generationStatus || t("infiniteCanvas.running"),
      generationTask: { ...(currentNode.generationTask || task), status: "running", updatedAt: Date.now() },
    }));
    try {
      const result = await recoverImageGenerationTask({
        provider,
        taskId: task.upstreamTaskId,
        onStatus: (message) => {
          void patchGenerationNode(task.canvasId, task.nodeId, (currentNode) => ({
            generationStatus: message,
            generationTask: currentNode.generationTask ? { ...currentNode.generationTask, status: "running", updatedAt: Date.now() } : task,
          }));
        },
      });
      await applyRecoveredImageResult({
        canvasId: task.canvasId,
        nodeId: task.nodeId,
        provider,
        model: task.model,
        resolution: task.resolution,
        aspectRatio: task.aspectRatio as CanvasNode["imageAspectRatio"],
        result,
        task,
      });
    } catch (error) {
      await patchGenerationNode(task.canvasId, task.nodeId, (currentNode) => ({
        running: false,
        generationStatus: "",
        generationError: error instanceof Error ? error.message : String(error),
        generationTask: currentNode.generationTask ? {
          ...currentNode.generationTask,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        } : task,
      }));
    } finally {
      activeGenerationTaskKeysRef.current.delete(taskKey);
    }
  }, [apiProviders, applyRecoveredImageResult, patchGenerationNode, t]);

  const resumeImageGenerationTasks = useCallback((canvasNodes: CanvasNode[]) => {
    canvasNodes.forEach((node) => {
      if (node.type === "imageGenerator" && node.generationTask?.upstreamTaskId) {
        void resumeImageGenerationTask(node);
      }
    });
  }, [resumeImageGenerationTask]);

  const refreshLibtvModels = useCallback(async () => {
    if (!window.libtv?.imageModels || libtvModelsLoading) return;
    setLibtvModelsLoading(true);
    try {
      const result = await window.libtv.imageModels();
      setLibtvModels(result.models || []);
    } catch (error) {
      setLibtvStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLibtvModelsLoading(false);
    }
  }, [libtvModelsLoading, setLibtvStatus]);

  useEffect(() => {
    if (!window.libtv?.imageModels) return;
    void refreshLibtvModels();
  }, [refreshLibtvModels]);

  const runImageComposer = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "imageGenerator" || node.running) return;
    if (!activeCanvasId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.canvasDesktopRequired") });
      return;
    }
    const provider = apiProviders.find((item) => item.id === node.imageProviderId && item.protocol !== "lovart" && item.protocol !== "gemini")
      || apiProviders.find((item) => item.id === defaultImageProviderId && item.protocol !== "lovart" && item.protocol !== "gemini")
      || imageProviders[0]
      || null;
    const model = node.imageModel && provider?.imageModels.includes(node.imageModel) ? node.imageModel : provider?.imageModels[0] || "";
    const resolution = IMAGE_RESOLUTION_OPTIONS.includes(node.imageResolution || "1k") ? node.imageResolution || "1k" : "1k";
    const aspectRatio = IMAGE_ASPECT_RATIO_OPTIONS.includes(node.imageAspectRatio || "1:1") ? node.imageAspectRatio || "1:1" : "1:1";
    if (!provider || !model) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.noImageApiConfigured") });
      return;
    }

    const prompt = [node.text || "", collectPrompt(node, nodes, connections)].filter(Boolean).join("\n\n").trim();
    const referenceImages = collectReferenceImages(node, nodes, connections);
    if (!prompt) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.promptRequired") });
      return;
    }

    const runningSize = fitGenerationNodeSize(aspectRatio);
    const taskStartedAt = Date.now();
    const taskBase: CanvasGenerationTask = {
      id: `${activeCanvasId}:${nodeId}:${taskStartedAt}`,
      canvasId: activeCanvasId,
      nodeId,
      providerId: provider.id,
      model,
      status: "submitting",
      startedAt: taskStartedAt,
      updatedAt: taskStartedAt,
      prompt,
      referenceImages,
      resolution,
      aspectRatio,
    };
    const initialTaskKey = generationTaskRuntimeKey(taskBase);
    let upstreamTaskKey = "";
    activeGenerationTaskKeysRef.current.add(initialTaskKey);
    persistActiveGenerationNode(activeCanvasId, nodeId, {
      running: true,
      x: Math.round(node.x + (node.w - runningSize.w) / 2),
      y: Math.round(node.y + (node.h - runningSize.h) / 2),
      ...runningSize,
      generationError: "",
      generationStatus: t("infiniteCanvas.running"),
      imageProviderId: provider.id,
      imageModel: model,
      imageResolution: resolution,
      imageAspectRatio: aspectRatio,
      imageMode: "imageGenerator",
      generationTask: taskBase,
    });

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;

    try {
      const setGenerationStatus = (message: string) => {
        void patchGenerationNode(activeCanvasId, nodeId, (currentNode) => ({
          generationStatus: message,
          generationTask: currentNode.generationTask ? { ...currentNode.generationTask, status: "running", updatedAt: Date.now() } : taskBase,
        }));
      };
      const result = await generateImageWithProvider({
        provider,
        model,
        prompt,
        referenceImages,
        resolution,
        aspectRatio,
        onStatus: setGenerationStatus,
        onTaskId: (upstreamTaskId) => {
          upstreamTaskKey = `${activeCanvasId}:${nodeId}:${upstreamTaskId}`;
          activeGenerationTaskKeysRef.current.delete(initialTaskKey);
          activeGenerationTaskKeysRef.current.add(upstreamTaskKey);
          void patchGenerationNode(activeCanvasId, nodeId, (currentNode) => ({
            generationTask: {
              ...(currentNode.generationTask || taskBase),
              upstreamTaskId,
              status: "running",
              updatedAt: Date.now(),
            },
          }));
        },
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      setGenerationStatus(t("infiniteCanvas.savingImage"));
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName, kind: "output" });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : fitImageNodeSize(result.width || 1024, result.height || 1024);
      await patchGenerationNode(activeCanvasId, nodeId, (currentNode) => ({
        url: saved.url,
        fileName: saved.fileName || result.fileName,
        imageProviderId: provider.id,
        imageModel: model,
        imageResolution: resolution,
        imageAspectRatio: aspectRatio,
        imageMode: "imageGenerator",
        imageSource: "generated",
        imageNaturalWidth: dimensions?.width || result.width || 1024,
        imageNaturalHeight: dimensions?.height || result.height || 1024,
        running: false,
        generationError: "",
        generationStatus: "",
        generationTask: {
          ...(currentNode.generationTask || taskBase),
          status: "succeeded",
          updatedAt: Date.now(),
        },
        ...nextSize,
      }));
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      await patchGenerationNode(activeCanvasId, nodeId, (currentNode) => ({
        running: false,
        generationError: isAbort ? "" : error instanceof Error ? error.message : String(error),
        generationStatus: "",
        generationTask: currentNode.generationTask ? {
          ...currentNode.generationTask,
          status: isAbort ? "interrupted" : "failed",
          error: isAbort ? "" : error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        } : undefined,
      }));
    } finally {
      activeGenerationTaskKeysRef.current.delete(initialTaskKey);
      if (upstreamTaskKey) activeGenerationTaskKeysRef.current.delete(upstreamTaskKey);
      if (generationAbortControllersRef.current[nodeId] === abortController) {
        delete generationAbortControllersRef.current[nodeId];
      }
    }
  }, [activeCanvasId, apiProviders, connections, defaultImageProviderId, imageProviders, nodeMap, nodes, patchGenerationNode, patchNode, persistActiveGenerationNode, saveCanvasImageAsset, t]);

  const stopImageComposer = useCallback((nodeId: string) => {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    patchNode(nodeId, {
      running: false,
      generationError: "",
      generationStatus: "",
    });
  }, [patchNode]);

  const runLovartNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "lovart" || node.running) return;
    const provider = lovartProvider;
    if (!provider || !provider.accessKey.trim() || !provider.secretKey.trim()) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.lovartNeedsKeys") });
      return;
    }
    const prompt = [node.text || "", collectPrompt(node, nodes, connections)].filter(Boolean).join("\n\n").trim();
    const referenceImages = collectReferenceImages(node, nodes, connections);
    if (!prompt) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.promptRequired") });
      return;
    }

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;
    patchNode(nodeId, {
      running: true,
      imageProviderId: provider.id,
      generationError: "",
      generationStatus: t("infiniteCanvas.lovartSubmitting"),
    });

    try {
      if (!window.lovart?.generate) throw new Error("Lovart bridge is not available.");
      const result = await window.lovart.generate({
        providerId: provider.id,
        prompt,
        referenceImages,
        projectId: node.lovartProjectId,
        threadId: node.lovartThreadId,
        model: node.lovartModel || "",
        unlimited: node.lovartMode === "unlimited",
      });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      patchNode(nodeId, { generationStatus: t("infiniteCanvas.savingImage") });
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName, kind: "output" });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
      setNodes((current) => current.map((currentNode) => {
        if (currentNode.id !== nodeId) return currentNode;
        return {
          ...currentNode,
          url: saved.url,
          fileName: saved.fileName || result.fileName,
          lovartProjectId: result.projectId || currentNode.lovartProjectId,
          lovartThreadId: result.threadId || currentNode.lovartThreadId,
          imageSource: "generated",
          imageNaturalWidth: dimensions?.width,
          imageNaturalHeight: dimensions?.height,
          running: false,
          generationError: "",
          generationStatus: "",
          ...nextSize,
        };
      }));
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      patchNode(nodeId, {
        running: false,
        generationError: isAbort ? "" : error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    } finally {
      if (generationAbortControllersRef.current[nodeId] === abortController) {
        delete generationAbortControllersRef.current[nodeId];
      }
    }
  }, [connections, lovartProvider, nodeMap, nodes, patchNode, saveCanvasImageAsset, setNodes, t]);

  const stopLovartNode = useCallback((nodeId: string) => {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    patchNode(nodeId, {
      running: false,
      generationError: "",
      generationStatus: "",
    });
  }, [patchNode]);

  const checkLovartNodeStatus = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "lovart") return;
    const provider = lovartProvider;
    if (!provider || !provider.accessKey.trim() || !provider.secretKey.trim()) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.lovartNeedsKeys") });
      return;
    }
    if (!node.lovartThreadId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.lovartNoThread") });
      return;
    }
    patchNode(nodeId, {
      generationError: "",
      generationStatus: t("infiniteCanvas.lovartCheckingStatus"),
    });
    try {
      if (!window.lovart?.status) throw new Error("Lovart bridge is not available.");
      const result = await window.lovart.status({
        providerId: provider.id,
        threadId: node.lovartThreadId,
      });
      if (result.pendingConfirmation) {
        patchNode(nodeId, {
          running: false,
          generationError: t("infiniteCanvas.lovartNeedsConfirmation"),
          generationStatus: "",
        });
        return;
      }
      if (result.imageUrl) {
        patchNode(nodeId, { generationStatus: t("infiniteCanvas.savingImage") });
        const saved = await saveCanvasImageAsset({ url: result.imageUrl, defaultName: "lovart-image.png", kind: "output" });
        const dimensions = await readImageDimensions(saved.url);
        const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
        setNodes((current) => current.map((currentNode) => {
          if (currentNode.id !== nodeId) return currentNode;
          return {
            ...currentNode,
            url: saved.url,
            fileName: saved.fileName || "lovart-image.png",
            imageSource: "generated",
            imageNaturalWidth: dimensions?.width,
            imageNaturalHeight: dimensions?.height,
            running: false,
            generationError: "",
            generationStatus: "",
            ...nextSize,
          };
        }));
        return;
      }
      patchNode(nodeId, {
        running: /pending|queued|running|processing|submitted|created/i.test(result.status || ""),
        generationError: "",
        generationStatus: t("infiniteCanvas.lovartStatusResult", { status: result.status || t("infiniteCanvas.running") }),
      });
    } catch (error) {
      patchNode(nodeId, {
        running: false,
        generationError: error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    }
  }, [lovartProvider, nodeMap, patchNode, saveCanvasImageAsset, setNodes, t]);

  const runLibtvImageNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "libtvImage" || node.running) return;
    if (!window.libtv?.runImageNode) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.libtvBridgeUnavailable") });
      return;
    }
    if (!node.libtvProjectId || !node.libtvNodeId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.libtvMissingBinding") });
      return;
    }
    patchNode(nodeId, { generationError: "", generationStatus: t("infiniteCanvas.libtvSubmitting"), running: true });
    try {
      const result = await window.libtv.runImageNode({
        projectId: node.libtvProjectId,
        nodeId: node.libtvNodeId,
      });
      if (!result.url) {
        patchNode(nodeId, { running: false, generationStatus: "", generationError: t("infiniteCanvas.libtvNoImageResult") });
        return;
      }
      patchNode(nodeId, { generationStatus: t("infiniteCanvas.savingImage") });
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName || "libtv-image.png", kind: "output" });
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
      setNodes((current) => current.map((currentNode) => {
        if (currentNode.id !== nodeId) return currentNode;
        return {
          ...currentNode,
          url: saved.url,
          fileName: saved.fileName || result.fileName || "libtv-image.png",
          libtvOriginalUrl: result.url,
          imageSource: "generated",
          imageNaturalWidth: dimensions?.width,
          imageNaturalHeight: dimensions?.height,
          running: false,
          generationError: "",
          generationStatus: "",
          ...nextSize,
        };
      }));
    } catch (error) {
      patchNode(nodeId, {
        running: false,
        generationError: error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    }
  }, [nodeMap, patchNode, saveCanvasImageAsset, setNodes, t]);

  const stopLibtvImageNode = useCallback((nodeId: string) => {
    patchNode(nodeId, {
      running: false,
      generationError: "",
      generationStatus: "",
    });
  }, [patchNode]);

  const syncLibtvImageNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "libtvImage" || !window.libtv?.syncNode) return;
    if (!node.libtvProjectId || !node.libtvNodeId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.libtvMissingBinding") });
      return;
    }
    patchNode(nodeId, { generationError: "", generationStatus: t("infiniteCanvas.libtvSyncing") });
    try {
      const result = await window.libtv.syncNode({ projectId: node.libtvProjectId, nodeId: node.libtvNodeId });
      if (!result.url) {
        patchNode(nodeId, { generationStatus: "", generationError: t("infiniteCanvas.libtvNoImageResult") });
        return;
      }
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName || "libtv-image.png", kind: "output" });
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
      setNodes((current) => current.map((currentNode) => {
        if (currentNode.id !== nodeId) return currentNode;
        return {
          ...currentNode,
          url: saved.url,
          fileName: saved.fileName || result.fileName || "libtv-image.png",
          libtvOriginalUrl: result.url,
          imageSource: "generated",
          imageNaturalWidth: dimensions?.width,
          imageNaturalHeight: dimensions?.height,
          generationError: "",
          generationStatus: "",
          ...nextSize,
        };
      }));
    } catch (error) {
      patchNode(nodeId, {
        generationError: error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    }
  }, [nodeMap, patchNode, saveCanvasImageAsset, setNodes, t]);

  const runLlmNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "llm" || node.running) return;
    const provider = apiProviders.find((item) => item.id === node.chatProviderId)
      || defaultChatProvider
      || chatProviders[0]
      || null;
    const model = node.chatModel && provider?.chatModels.includes(node.chatModel) ? node.chatModel : provider?.chatModels[0] || "";
    if (!provider || !model) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.noChatApiConfigured") });
      return;
    }
    const upstreamPrompt = collectUpstreamPrompt(node, nodes, connections).trim();
    const referenceImages = collectReferenceImages(node, nodes, connections);
    if (!upstreamPrompt && !referenceImages.length) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.llmInputRequired") });
      return;
    }
    const instruction = (node.variablePrompt || t("infiniteCanvas.llmDefaultInstruction")).trim();
    const prompt = [
      instruction,
      upstreamPrompt ? `${t("infiniteCanvas.llmInputLabel")}\n${upstreamPrompt}` : "",
      referenceImages.length ? t("infiniteCanvas.llmImageInputHint") : "",
    ].filter(Boolean).join("\n\n");

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;
    patchNode(nodeId, {
      running: true,
      chatProviderId: provider.id,
      chatModel: model,
      generationError: "",
      generationStatus: t("infiniteCanvas.llmRunning"),
    });

    try {
      const text = await generateChatWithProvider({ provider, model, prompt, referenceImages, signal: abortController.signal });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      patchNode(nodeId, {
        text,
        running: false,
        generationError: "",
        generationStatus: "",
        chatProviderId: provider.id,
        chatModel: model,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      patchNode(nodeId, {
        running: false,
        generationError: isAbort ? "" : error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    } finally {
      if (generationAbortControllersRef.current[nodeId] === abortController) {
        delete generationAbortControllersRef.current[nodeId];
      }
    }
  }, [apiProviders, chatProviders, connections, defaultChatProvider, nodeMap, nodes, patchNode, t]);

  const stopLlmNode = useCallback((nodeId: string) => {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    patchNode(nodeId, { running: false, generationError: "", generationStatus: "" });
  }, [patchNode]);

  return {
    libtvModels,
    libtvModelsLoading,
    refreshLibtvModels,
    resumeImageGenerationTasks,
    runImageComposer,
    stopImageComposer,
    runLovartNode,
    stopLovartNode,
    checkLovartNodeStatus,
    runLibtvImageNode,
    stopLibtvImageNode,
    syncLibtvImageNode,
    runLlmNode,
    stopLlmNode,
  };
}
