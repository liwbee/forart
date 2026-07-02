import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ActionEntry, ActionTag } from "../../action-library/types";
import type { ApiProvider } from "../../settings/apiProviders";
import { selectActionForRow } from "../action-fission/actionFissionActions";
import { resolveActionFissionBulkActions } from "../action-fission/actionFissionBulkActions";
import type { ActionFissionRow } from "../action-fission/actionFissionTypes";
import { useActionFissionLibraryData } from "../action-fission/useActionFissionLibraryData";
import { useActionFissionNodeState } from "../action-fission/useActionFissionNodeState";
import { useActionFissionReferencePreviews } from "../action-fission/useActionFissionReferencePreviews";
import { BASE_PUBLIC_REFERENCE_LIMIT, MAX_ACTION_FISSION_ROWS } from "../action-fission/actionFissionTypes";
import type { CanvasGenerationTarget, CanvasGenerationTask, CanvasNode } from "../types";
import { ActionFissionApiBar } from "./action-fission/ActionFissionApiBar";
import { ActionFissionFooter } from "./action-fission/ActionFissionFooter";
import { ActionFissionReferenceStrip } from "./action-fission/ActionFissionReferenceStrip";
import { ActionFissionRowItem } from "./action-fission/ActionFissionRowItem";

interface SavedCanvasAsset {
  url: string;
  fileName?: string;
  filePath?: string;
}

interface ActionFissionNodeBodyProps {
  node: CanvasNode;
  imageProviders: ApiProvider[];
  defaultImageProvider: ApiProvider | null;
  openSelectId: string;
  draggedInputConnectionId: string;
  onOpenSelectChange: (selectId: string) => void;
  onPatchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  onRemoveInput: (connectionId: string) => void;
  onReorderInput: (nodeId: string, connectionId: string, imageInsertIndex: number) => void;
  onCreateImageReference: (nodeId: string, files: FileList | File[]) => void;
  onDraggedInputConnectionIdChange: (connectionId: string) => void;
  onRefreshRow: (nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[]) => void;
  onRunRow: (nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[]) => void;
  onStopRow: (nodeId: string, rowId: string) => void;
  onBeforeRemoveRow?: (nodeId: string, rowId: string) => void | Promise<void>;
  onRunAllRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  onSwitchAllRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  onDownloadAllRows: (nodeId: string, rowsData: Array<{ rowId: string }>) => void;
  onStopAllRows: (nodeId: string) => void;
  onPreviewResult: (nodeId: string, row: ActionFissionRow) => void;
  onPreviewAction: (nodeId: string, row: ActionFissionRow) => void;
  onDownloadResult: (nodeId: string, row: ActionFissionRow) => void;
  onMediaStatus: (status: { nodeId: string; tone: "busy" | "ready" | "error"; text: string }) => void;
  downloadStatusKey: string;
  getGenerationTaskForTarget?: (target: CanvasGenerationTarget) => CanvasGenerationTask | null;
  isGenerationTargetActive?: (target: CanvasGenerationTarget) => boolean;
  saveCanvasImageAsset: (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }) => Promise<SavedCanvasAsset>;
}

function selectedProviderFor(stateProviderId: string | undefined, defaultImageProvider: ApiProvider | null, imageProviders: ApiProvider[]) {
  return imageProviders.find((provider) => provider.id === stateProviderId)
    || defaultImageProvider
    || imageProviders[0]
    || null;
}

export function ActionFissionNodeBody({
  node,
  imageProviders,
  defaultImageProvider,
  openSelectId,
  draggedInputConnectionId,
  onOpenSelectChange,
  onPatchNode,
  onRemoveInput,
  onReorderInput,
  onCreateImageReference,
  onDraggedInputConnectionIdChange,
  onRefreshRow,
  onRunRow,
  onStopRow,
  onBeforeRemoveRow,
  onRunAllRows,
  onSwitchAllRows,
  onDownloadAllRows,
  onStopAllRows,
  onPreviewResult,
  onPreviewAction,
  onDownloadResult,
  onMediaStatus,
  downloadStatusKey,
  getGenerationTaskForTarget,
  isGenerationTargetActive,
}: ActionFissionNodeBodyProps) {
  const { t } = useTranslation();
  const {
    state,
    setRowProject,
    setRowTags,
    selectRowAction,
    addRow,
    removeRow,
    setApiType,
    setLibtvWorkspace,
    setLibtvModel,
    setModel,
    setResolution,
    setAspectRatio,
  } = useActionFissionNodeState({ node, onPatchNode, onBeforeRemoveRow });
  const { projects, rowData } = useActionFissionLibraryData(state);
  const selectedProvider = selectedProviderFor(state.providerId, defaultImageProvider, imageProviders);
  const selectedModel = state.model && selectedProvider?.imageModels.includes(state.model) ? state.model : selectedProvider?.imageModels[0] || "";
  const isRowActive = (row: ActionFissionRow) => Boolean(row.libtvQueued || row.libtvRunning || isGenerationTargetActive?.({ type: "actionFissionRow", nodeId: node.id, rowId: row.id }));
  const bulkActions = resolveActionFissionBulkActions({
    state,
    rowData,
    selectedProvider: state.apiType === "libtv-api" ? ({ id: "libtv-api" } as ApiProvider) : selectedProvider,
    selectedModel: state.apiType === "libtv-api" ? state.libtvModelName || "" : selectedModel,
    isRowActive,
  });
  const publicReferenceCount = useActionFissionReferencePreviews(node.id).length;
  const autoSelectionKeyRef = useRef("");

  useEffect(() => {
    const pendingRows = rowData.filter(({ row, candidates }) => row.actionProjectId && !row.selectedActionId && candidates.length);
    if (!pendingRows.length) {
      autoSelectionKeyRef.current = "";
      return;
    }
    const key = pendingRows.map(({ row, candidates }) => `${row.id}:${row.actionProjectId}:${row.actionTagIds.join(",")}:${candidates.map((action) => action.id).join(",")}`).join("|");
    if (autoSelectionKeyRef.current === key) return;
    autoSelectionKeyRef.current = key;

    const plannedRows = state.rows.map((row) => ({ ...row }));
    for (const { row, actions, tags } of pendingRows) {
      const rowIndex = plannedRows.findIndex((item) => item.id === row.id);
      if (rowIndex < 0) continue;
      const selection = selectActionForRow({ row: plannedRows[rowIndex], rows: plannedRows, actions, tags });
      if (!selection.action) continue;
      plannedRows[rowIndex] = { ...plannedRows[rowIndex], selectedActionId: selection.action.id };
      selectRowAction(row.id, selection.action);
      return;
    }
  }, [rowData, selectRowAction, state.rows]);

  return (
    <div className="ic-node-body ic-action-fission nowheel">
      <ActionFissionApiBar
        nodeId={node.id}
        state={state}
        selectedProvider={selectedProvider}
        imageProviders={imageProviders}
        openSelectId={openSelectId}
        onOpenSelectChange={onOpenSelectChange}
        onSetApiType={setApiType}
        onSetModel={setModel}
        onSetLibtvWorkspace={setLibtvWorkspace}
      />

      <ActionFissionReferenceStrip
        nodeId={node.id}
        draggedInputConnectionId={draggedInputConnectionId}
        onRemoveInput={onRemoveInput}
        onReorderInput={onReorderInput}
        onCreateImageReference={onCreateImageReference}
        onDraggedInputConnectionIdChange={onDraggedInputConnectionIdChange}
      />

      <div className="ic-action-fission-rows nowheel" onWheel={(event) => event.stopPropagation()}>
        {rowData.map(({ row, tags, actions, candidates }) => (
          <ActionFissionRowItem
            key={row.id}
            nodeId={node.id}
            row={row}
            tags={tags}
            actions={actions}
            candidates={candidates}
            candidateCount={candidates.length}
            publicReferenceCount={publicReferenceCount}
            publicReferenceLimit={BASE_PUBLIC_REFERENCE_LIMIT}
            selectedProvider={state.apiType === "libtv-api" ? ({ id: "libtv-api" } as ApiProvider) : selectedProvider}
            selectedModel={state.apiType === "libtv-api" ? state.libtvModelName || "" : selectedModel}
            projects={projects}
            openSelectId={openSelectId}
            onOpenSelectChange={onOpenSelectChange}
            onSetProject={setRowProject}
            onSetTags={setRowTags}
            onRemoveRow={removeRow}
            onRefreshRow={onRefreshRow}
            onRunRow={onRunRow}
            onStopRow={onStopRow}
            onPreviewResult={(targetRow) => onPreviewResult(node.id, targetRow)}
            onPreviewAction={(targetRow) => onPreviewAction(node.id, targetRow)}
            onDownloadResult={(targetRow) => onDownloadResult(node.id, targetRow)}
            onMediaStatus={onMediaStatus}
            isResultDownloadBusy={downloadStatusKey === `${node.id}:${row.id}`}
            generationTask={row.generationTask || getGenerationTaskForTarget?.({ type: "actionFissionRow", nodeId: node.id, rowId: row.id }) || null}
            isRowActive={isRowActive(row)}
          />
        ))}
      </div>

      <div className="ic-action-fission-add-row">
        <button
          type="button"
          disabled={state.rows.length >= MAX_ACTION_FISSION_ROWS}
          onClick={addRow}
        >
          {state.rows.length >= MAX_ACTION_FISSION_ROWS
            ? `${t("infiniteCanvas:actionFissionRowLimit", { count: MAX_ACTION_FISSION_ROWS })} (${state.rows.length}/${MAX_ACTION_FISSION_ROWS})`
            : `${t("infiniteCanvas:actionFissionAddRow")} (${state.rows.length}/${MAX_ACTION_FISSION_ROWS})`}
        </button>
        {state.error ? <div className="ic-action-fission-node-error" role="alert">{state.error}</div> : null}
      </div>

      <ActionFissionFooter
        nodeId={node.id}
        state={state}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        openSelectId={openSelectId}
        bulkActions={bulkActions}
        onOpenSelectChange={onOpenSelectChange}
        onSetModel={setModel}
        onSetLibtvModel={setLibtvModel}
        onSetResolution={setResolution}
        onSetAspectRatio={setAspectRatio}
        onRunAllRows={onRunAllRows}
        onSwitchAllRows={onSwitchAllRows}
        onDownloadAllRows={onDownloadAllRows}
        onStopAllRows={onStopAllRows}
      />
    </div>
  );
}
