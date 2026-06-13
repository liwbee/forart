import { useCallback, useEffect, useRef, useState } from "react";
import type { LibtvGeneratePayload } from "../../../app/appConfig";
import { LibtvRemotePatchQueue } from "../libtvSyncQueue";
import type { CanvasNode } from "../types";
import { getErrorMessage, hasLibtvUpdateNode, updateLibtvNode } from "./libtvBridge";

export type LibtvSyncTone = "busy" | "ready" | "dirty" | "error";

export interface LibtvSyncIndicator {
  tone: LibtvSyncTone;
  text: string;
}

interface LibtvNodeSyncOptions {
  isEnabled: boolean;
  nodes: CanvasNode[];
  onPatchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  getBusyText: () => string;
  getIdleText: () => string;
  getDirtyText: () => string;
  getBridgeUnavailableText: () => string;
  getMissingBindingText: () => string;
}

export function useLibtvNodeSync({
  isEnabled,
  nodes,
  onPatchNode,
  getBusyText,
  getIdleText,
  getDirtyText,
  getBridgeUnavailableText,
  getMissingBindingText,
}: LibtvNodeSyncOptions) {
  const nodesRef = useRef(nodes);
  const [status, setStatus] = useState<LibtvSyncIndicator | null>(null);
  const syncNodePatchRef = useRef<(nodeId: string, patch: Partial<CanvasNode>) => Promise<void>>(async () => undefined);
  const getDirtyTextRef = useRef(getDirtyText);
  const statusRef = useRef<LibtvSyncIndicator | null>(null);
  const queueRef = useRef<LibtvRemotePatchQueue<Partial<CanvasNode>> | null>(null);

  const updateStatus = useCallback((nextStatus: LibtvSyncIndicator | null) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  if (!queueRef.current) {
    queueRef.current = new LibtvRemotePatchQueue<Partial<CanvasNode>>({
      onFlush: (nodeId, patch) => syncNodePatchRef.current(nodeId, patch),
      onPendingChange: (pendingCount) => {
        if (pendingCount > 0 && statusRef.current?.tone !== "error") updateStatus({ tone: "dirty", text: getDirtyTextRef.current() });
      },
    });
  }

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    getDirtyTextRef.current = getDirtyText;
  }, [getDirtyText]);

  const clearNodePending = useCallback((nodeId: string) => queueRef.current?.clearNode(nodeId), []);

  const clearAllPending = useCallback(() => queueRef.current?.clearAll(), []);

  const hasPending = useCallback((nodeId?: string) => (
    Boolean(queueRef.current?.hasPending(nodeId))
  ), []);

  const getPendingNodeIds = useCallback(() => queueRef.current?.getPendingNodeIds() || [], []);

  useEffect(() => () => {
    clearAllPending();
  }, [clearAllPending]);

  const syncNodePatch = useCallback(async (nodeId: string, patch: Partial<CanvasNode>) => {
    if (!isEnabled) return;
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node) return;
    if (!hasLibtvUpdateNode()) {
      updateStatus({ tone: "error", text: getBridgeUnavailableText() });
      return;
    }
    if (!node.libtvProjectId || !node.libtvNodeId) {
      onPatchNode(nodeId, { generationError: getMissingBindingText() });
      updateStatus({ tone: "error", text: getMissingBindingText() });
      return;
    }

    const nextNode = { ...node, ...patch };
    const payload: LibtvGeneratePayload = {
      projectId: node.libtvProjectId,
      nodeId: node.libtvNodeId,
    };

    if (node.type === "libtvPrompt") {
      if (patch.text !== undefined) payload.content = String(nextNode.text || "");
      if (Object.keys(payload).length <= 2) return;
    } else if (node.type === "libtvImage") {
      if (patch.text !== undefined) payload.prompt = String(nextNode.text || "");
      if (patch.libtvModelName !== undefined || patch.libtvModel !== undefined) payload.model = String(nextNode.libtvModelName || nextNode.libtvModel || "");
      if (patch.libtvResolution !== undefined) payload.resolution = patch.libtvResolution;
      if (patch.libtvAspectRatio !== undefined) payload.aspectRatio = patch.libtvAspectRatio;
      if (Object.keys(payload).length <= 2) return;
    } else if (node.type === "libtvUpload") {
      if (Object.keys(payload).length <= 2) return;
    } else {
      return;
    }

    try {
      updateStatus({ tone: "busy", text: getBusyText() });
      await updateLibtvNode(payload, getBridgeUnavailableText());
      onPatchNode(nodeId, { generationError: "" });
      updateStatus({ tone: "ready", text: getIdleText() });
    } catch (error) {
      const message = getErrorMessage(error);
      onPatchNode(nodeId, { generationError: message });
      updateStatus({ tone: "error", text: message });
      throw error;
    }
  }, [getBridgeUnavailableText, getBusyText, getIdleText, getMissingBindingText, isEnabled, onPatchNode, updateStatus]);

  syncNodePatchRef.current = syncNodePatch;

  const flushNode = useCallback((nodeId: string) => queueRef.current?.flushNode(nodeId), []);

  const flushNodes = useCallback((nodeIds: Iterable<string>) => queueRef.current?.flushNodes(nodeIds), []);

  const flushAll = useCallback(() => queueRef.current?.flushAll(), []);

  const queueNodePatch = useCallback((nodeId: string, patch: Partial<CanvasNode>, options: { debounceMs?: number | null; flush?: boolean } = {}) => {
    queueRef.current?.queue(nodeId, patch, options);
  }, []);

  const statusForCanvas = isEnabled
    ? status || { tone: "ready" as const, text: getIdleText() }
    : null;

  return {
    status: statusForCanvas,
    queueNodePatch,
    flushNode,
    flushNodes,
    flushAll,
    clearNodePending,
    clearAllPending,
    hasPending,
    getPendingNodeIds,
    syncNodePatch,
    setStatus: updateStatus,
  };
}
