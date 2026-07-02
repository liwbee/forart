import type { ActionEntry, ActionTag } from "../../action-library/types";
import type { ApiProvider } from "../../settings/apiProviders";
import type { ActionFissionRow, ActionFissionState } from "./actionFissionTypes";
import type { ActionFissionRowData } from "./useActionFissionLibraryData";

export interface ActionFissionRowsPayload {
  rowId: string;
  actions: ActionEntry[];
  tags: ActionTag[];
}

export interface ActionFissionBulkActions {
  runningRows: number;
  isRunning: boolean;
  totalRows: number;
  completedRows: number;
  canRunAll: boolean;
  runnableRowsData: ActionFissionRowsPayload[];
  canSwitchAll: boolean;
  switchableRowsData: ActionFissionRowsPayload[];
  downloadableRowsData: Array<{ rowId: string }>;
}

export function resolveActionFissionBulkActions({
  state,
  rowData,
  selectedProvider,
  selectedModel,
  isRowActive,
}: {
  state: ActionFissionState;
  rowData: ActionFissionRowData[];
  selectedProvider: ApiProvider | null;
  selectedModel: string;
  isRowActive: (row: ActionFissionRow) => boolean;
}): ActionFissionBulkActions {
  const rowIsRunning = (row: ActionFissionRow) => Boolean(row.libtvQueued || row.libtvRunning || isRowActive(row));
  const runningRows = state.rows.filter(rowIsRunning).length;
  const runnableRows = rowData.filter(({ row, candidates }) => row.actionProjectId && !rowIsRunning(row) && (row.selectedActionPrompt || candidates.length));
  const runnableRowsData = runnableRows.map(({ row, actions, tags }) => ({ rowId: row.id, actions, tags }));
  const switchableRows = rowData.filter(({ row }) => row.actionProjectId && !rowIsRunning(row));
  const switchableRowsData = switchableRows.map(({ row, actions, tags }) => ({ rowId: row.id, actions, tags }));
  const downloadableRowsData = state.rows.filter((row) => row.resultUrl).map((row) => ({ rowId: row.id }));
  const isRunning = runningRows > 0;
  const totalRows = Math.max(runningRows, runnableRowsData.length);
  const hasGenerator = state.apiType === "libtv-api"
    ? Boolean(state.libtvWorkspaceId && state.libtvModelName)
    : Boolean(selectedProvider && selectedModel);

  return {
    runningRows,
    isRunning,
    totalRows,
    completedRows: totalRows > 0 ? Math.max(0, totalRows - runningRows) : 0,
    canRunAll: Boolean(hasGenerator && runnableRowsData.length),
    runnableRowsData,
    canSwitchAll: Boolean(switchableRowsData.length),
    switchableRowsData,
    downloadableRowsData,
  };
}
