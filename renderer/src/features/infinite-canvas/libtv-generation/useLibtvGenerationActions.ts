import { useCallback, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import { collectPrompt, collectReferenceImages } from "../core/workflow";
import { fitImageNodeSize, readImageDimensions } from "../imageCrop";
import { saveThumbnailForExistingCanvasAsset } from "../canvasAssetThumbnails";
import type { CanvasConnection, CanvasNode } from "../types";
import { generateLibtvImage } from "./libtvGenerationApi";
import { LIBTV_ASPECT_RATIO_OPTIONS, LIBTV_QUALITY_OPTIONS, type LibtvAspectRatio, type LibtvQuality } from "./libtvGenerationTypes";

interface UseLibtvGenerationActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  libtvReady: boolean;
  libtvUnavailableMessage: string;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  t: TFunction;
}

function normalizeAspectRatio(value: unknown): LibtvAspectRatio {
  return LIBTV_ASPECT_RATIO_OPTIONS.includes(value as LibtvAspectRatio) ? value as LibtvAspectRatio : "1:1";
}

function normalizeQuality(value: unknown): LibtvQuality {
  return LIBTV_QUALITY_OPTIONS.includes(value as LibtvQuality) ? value as LibtvQuality : "2K";
}

export function useLibtvGenerationActions({
  nodes,
  connections,
  libtvReady,
  libtvUnavailableMessage,
  patchNode,
  t,
}: UseLibtvGenerationActionsOptions) {
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const runLibtvImageGenerator = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || (node.type !== "libtvImageGenerator" && node.type !== "imageGenerator") || node.libtvImageGeneration?.running) return;
    const state = node.libtvImageGeneration || {};
    if (!libtvReady) {
      patchNode(nodeId, { libtvImageGeneration: { ...state, error: libtvUnavailableMessage } });
      return;
    }
    const workspaceId = String(state.workspaceId || "").trim();
    const modelName = String(state.modelName || "").trim();
    const ownPrompt = node.type === "imageGenerator" ? node.text || "" : state.prompt || "";
    const prompt = [ownPrompt, collectPrompt(node, nodes, connections)].filter(Boolean).join("\n\n").trim();
    if (!workspaceId) {
      patchNode(nodeId, { libtvImageGeneration: { ...state, error: t("infiniteCanvas:libtvWorkspaceRequired") } });
      return;
    }
    if (!modelName) {
      patchNode(nodeId, { libtvImageGeneration: { ...state, error: t("infiniteCanvas:libtvModelRequired") } });
      return;
    }
    if (!prompt) {
      patchNode(nodeId, { libtvImageGeneration: { ...state, error: t("infiniteCanvas:promptRequired") } });
      return;
    }

    const abortController = new AbortController();
    abortControllersRef.current[nodeId]?.abort();
    abortControllersRef.current[nodeId] = abortController;
    const aspectRatio = normalizeAspectRatio(node.type === "imageGenerator" ? node.imageAspectRatio : state.aspectRatio);
    const quality = normalizeQuality(node.type === "imageGenerator" ? node.imageResolution?.toUpperCase() : state.quality);
    const startedAt = Date.now();
    patchNode(nodeId, {
      libtvImageGeneration: {
        ...state,
        aspectRatio,
        quality,
        running: true,
        startedAt,
        status: t("infiniteCanvas:libtvRunning"),
        error: "",
      },
    });

    try {
      const result = await generateLibtvImage({
        workspaceId,
        prompt,
        modelName,
        aspectRatio,
        quality,
        referenceImages: collectReferenceImages(node, nodes, connections),
        nodeTitle: node.title || "LibTV Image Generator",
        x: Math.round(node.x),
        y: Math.round(node.y),
      });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const dimensions = await readImageDimensions(result.localUrl);
      const thumb = result.localUrl
        ? await saveThumbnailForExistingCanvasAsset(result.localUrl)
        : {};
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : fitImageNodeSize(1024, 1024);
      patchNode(nodeId, {
        ...nextSize,
        url: result.localUrl || result.url,
        thumbUrl: thumb.thumbUrl,
        thumbFilePath: thumb.thumbFilePath,
        fileName: result.fileName || "libtv-generated-image.png",
        imageNaturalWidth: dimensions?.width || 1024,
        imageNaturalHeight: dimensions?.height || 1024,
        imageMode: "imageGenerator",
        imageSource: "generated",
        outputDownloadState: "pending",
        outputDownloadedAt: undefined,
        imageGenerationApiType: "libtv-api",
        imageAspectRatio: aspectRatio,
        imageResolution: quality.toLowerCase() as NonNullable<CanvasNode["imageResolution"]>,
        libtvImageGeneration: {
          ...state,
          workspaceId,
          modelName,
          aspectRatio,
          quality,
          projectUuid: result.projectUuid || state.projectUuid,
          projectName: result.projectName || state.projectName,
          running: false,
          startedAt: undefined,
          status: "",
          error: "",
          latestRun: {
            remoteNodeId: result.remoteNodeId,
            remoteNodeTitle: result.remoteNodeTitle,
            remoteReferenceNodeIds: result.remoteReferenceNodeIds,
            remoteReferenceNodeTitles: result.remoteReferenceNodeTitles,
            groupNodeId: result.groupNodeId,
            groupTitle: result.groupTitle,
            projectUuid: result.projectUuid,
            projectName: result.projectName,
            resultUrl: result.url,
            localUrl: result.localUrl,
            createdAt: result.createdAt,
          },
        },
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      patchNode(nodeId, {
        libtvImageGeneration: {
          ...state,
          aspectRatio,
          quality,
          running: false,
          startedAt: undefined,
          status: "",
          error: isAbort ? "" : error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      if (abortControllersRef.current[nodeId] === abortController) delete abortControllersRef.current[nodeId];
    }
  }, [connections, libtvReady, libtvUnavailableMessage, nodeMap, nodes, patchNode, t]);

  const stopLibtvImageGenerator = useCallback((nodeId: string) => {
    abortControllersRef.current[nodeId]?.abort();
    delete abortControllersRef.current[nodeId];
    const node = nodeMap.get(nodeId);
    if (!node?.libtvImageGeneration) return;
    patchNode(nodeId, {
      libtvImageGeneration: {
        ...node.libtvImageGeneration,
        running: false,
        startedAt: undefined,
        status: "",
        error: "",
      },
    });
  }, [nodeMap, patchNode]);

  return {
    runLibtvImageGenerator,
    stopLibtvImageGenerator,
  };
}
