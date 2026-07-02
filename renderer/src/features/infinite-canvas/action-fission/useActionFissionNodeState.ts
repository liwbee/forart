import { useCallback } from "react";
import type { CanvasNode } from "../types";
import {
  addActionFissionRow,
  changeActionFissionRowProject,
  changeActionFissionRowTags,
  normalizeActionFissionState,
  patchActionFissionRow,
  removeActionFissionRow,
  updateActionFissionStateValue,
} from "./actionFissionState";
import type { ActionEntry } from "../../action-library/types";
import { actionPatchFromEntry } from "./actionFissionActions";
import type { ActionFissionRow, ActionFissionState } from "./actionFissionTypes";

interface UseActionFissionNodeStateArgs {
  node: CanvasNode;
  onPatchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  onBeforeRemoveRow?: (nodeId: string, rowId: string) => void | Promise<void>;
}

export function useActionFissionNodeState({ node, onPatchNode, onBeforeRemoveRow }: UseActionFissionNodeStateArgs) {
  const state = normalizeActionFissionState(node.actionFission);

  const patchActionFission = useCallback((updater: (current: ActionFissionState) => ActionFissionState) => {
    onPatchNode(node.id, {
      actionFission: updateActionFissionStateValue(node.actionFission, updater),
    });
  }, [node.actionFission, node.id, onPatchNode]);

  const patchRow = useCallback((rowId: string, patch: Partial<ActionFissionRow>) => {
    patchActionFission((current) => patchActionFissionRow(current, rowId, patch));
  }, [patchActionFission]);

  const selectRowAction = useCallback((rowId: string, action: ActionEntry) => {
    patchActionFission((current) => patchActionFissionRow(current, rowId, actionPatchFromEntry(action)));
  }, [patchActionFission]);

  const setRowProject = useCallback((rowId: string, projectId: string) => {
    patchActionFission((current) => changeActionFissionRowProject(current, rowId, projectId));
  }, [patchActionFission]);

  const setRowTags = useCallback((rowId: string, tagIds: string[]) => {
    patchActionFission((current) => changeActionFissionRowTags(current, rowId, tagIds));
  }, [patchActionFission]);

  const addRow = useCallback(() => {
    patchActionFission(addActionFissionRow);
  }, [patchActionFission]);

  const removeRow = useCallback(async (rowId: string) => {
    await onBeforeRemoveRow?.(node.id, rowId);
    patchActionFission((current) => removeActionFissionRow(current, rowId));
  }, [node.id, onBeforeRemoveRow, patchActionFission]);

  const setModel = useCallback((model: string, providerId: string, sizePatch: Pick<ActionFissionState, "resolution" | "aspectRatio"> = {}) => {
    patchActionFission((current) => ({ ...current, ...sizePatch, apiType: "third-party-api", model, providerId, error: "" }));
  }, [patchActionFission]);

  const setApiType = useCallback((apiType: NonNullable<ActionFissionState["apiType"]>) => {
    patchActionFission((current) => ({ ...current, apiType, error: "" }));
  }, [patchActionFission]);

  const setLibtvWorkspace = useCallback((workspaceId: string, workspaceName: string) => {
    patchActionFission((current) => ({
      ...current,
      libtvWorkspaceId: workspaceId,
      libtvWorkspaceName: workspaceName,
      libtvProjectUuid: "",
      libtvProjectName: "",
      libtvGroupNodeId: "",
      libtvGroupTitle: "",
      error: "",
    }));
  }, [patchActionFission]);

  const setLibtvModel = useCallback((modelName: string) => {
    patchActionFission((current) => ({ ...current, libtvModelName: modelName, error: "" }));
  }, [patchActionFission]);

  const setResolution = useCallback((resolution: ActionFissionState["resolution"]) => {
    patchActionFission((current) => ({ ...current, resolution }));
  }, [patchActionFission]);

  const setAspectRatio = useCallback((aspectRatio: ActionFissionState["aspectRatio"]) => {
    patchActionFission((current) => ({ ...current, aspectRatio }));
  }, [patchActionFission]);

  return {
    state,
    patchRow,
    selectRowAction,
    setRowProject,
    setRowTags,
    addRow,
    removeRow,
    setApiType,
    setLibtvWorkspace,
    setLibtvModel,
    setModel,
    setResolution,
    setAspectRatio,
  };
}
