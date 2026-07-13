import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, RefreshCw, Tags, X, XCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { SearchInput } from "../../components/SearchInput";
import { VirtualList } from "../../components/VirtualList";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Empty, EmptyDescription } from "../../components/ui/empty";
import { normalizeLibraryTagColor } from "../library-tags";
import { importActionEntries } from "./api";
import type { ActionTag } from "./types";
import type { ActionFolderImportPreview, ActionFolderImportResult, ActionFolderImportResultRow, ActionFolderImportRow, ActionFolderImportUploadEntry } from "./actionFolderImportTypes";

type ImportStage = "idle" | "discovering" | "building" | "ready" | "importing" | "complete";
const VIRTUAL_ROW_HEIGHT = 120;
const VIRTUAL_OVERSCAN = 6;

type ImportFileRow = ActionFolderImportRow;

type LiveImportStatus = ActionFolderImportResultRow["final_status"] | "pending" | "importing";

type LiveImportRow = Omit<ActionFolderImportResultRow, "final_status"> & {
  final_status: LiveImportStatus;
};

const EMPTY_IMPORT_ROWS: ActionFolderImportRow[] = [];

function issueText(row: Pick<ActionFolderImportRow, "errors" | "warnings">) {
  return [...(row.errors || []), ...(row.warnings || [])].map((issue) => issue.message).join(" / ");
}

function statusClass(row: Pick<ActionFolderImportRow, "errors" | "warnings">) {
  if (row.errors?.length) return "is-error";
  if (row.warnings?.length) return "is-warning";
  return "is-ready";
}

function liveStatusClass(status: LiveImportStatus | "") {
  if (status === "failed") return "is-error";
  if (status === "warning") return "is-warning";
  if (status === "not_selected") return "is-muted";
  if (status === "imported") return "is-imported";
  if (status === "importing") return "is-importing";
  return "is-ready";
}

function rowIsValid(row: ActionFolderImportRow) {
  return !row.errors?.length;
}

function rowMatchesSearch(row: ActionFolderImportRow, searchText: string) {
  if (!searchText) return true;
  const searchableName = `${row.proposed_name || ""} ${row.filename || ""} ${row.stem || ""}`.toLocaleLowerCase();
  return searchableName.includes(searchText);
}

function filteredValidRowIdSet(rows: ActionFolderImportRow[], searchText: string) {
  return new Set(rows.filter((row) => rowIsValid(row) && rowMatchesSearch(row, searchText)).map((row) => row.id));
}

function rowIdSignature(rowIds: string[]) {
  return rowIds.join("\u0001");
}

function finalStatusLabel(status: string, t: ReturnType<typeof useTranslation>["t"]) {
  if (status === "imported") return t("actionLibrary:bulkImportStatusImported");
  if (status === "warning") return t("actionLibrary:bulkImportStatusWarning");
  if (status === "failed") return t("actionLibrary:bulkImportStatusFailed");
  if (status === "importing") return t("actionLibrary:bulkImportImporting");
  if (status === "pending") return t("actionLibrary:bulkImportStatusReady");
  return t("actionLibrary:bulkImportStatusNotSelected");
}

interface ActionFolderImportDialogProps {
  projectId: string;
  projectName: string;
  existingActionNames: string[];
  tags: ActionTag[];
  isOpen: boolean;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

export function ActionFolderImportDialog({ projectId, projectName, existingActionNames, tags, isOpen, onClose, onImported }: ActionFolderImportDialogProps) {
  const { t } = useTranslation();
  const rowsViewportRef = useRef<HTMLDivElement | null>(null);
  const activeScanIdRef = useRef("");
  const previousSelectionRef = useRef<Set<string> | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [preview, setPreview] = useState<ActionFolderImportPreview | null>(null);
  const [result, setResult] = useState<ActionFolderImportResult | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<ImportStage>("idle");
  const [fileRows, setFileRows] = useState<ImportFileRow[]>([]);
  const [scanError, setScanError] = useState("");
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0 });
  const [rowImportStates, setRowImportStates] = useState<Map<string, LiveImportRow>>(new Map());
  const [rowTagSelections, setRowTagSelections] = useState<Map<string, Set<string>>>(new Map());
  const [rowSearchQuery, setRowSearchQuery] = useState("");

  useEffect(() => {
    if (!isOpen) {
      const scanId = activeScanIdRef.current;
      if (scanId) void window.forartActionImport?.cancelScan?.({ scanId });
      activeScanIdRef.current = "";
      previousSelectionRef.current = null;
      void window.forartActionImport?.clearPreview?.();
      setSourcePath("");
      setPreview(null);
      setResult(null);
      setSelectedRows(new Set());
      setStage("idle");
      setFileRows([]);
      setScanError("");
      setImportProgress({ completed: 0, total: 0 });
      setRowImportStates(new Map());
      setRowTagSelections(new Map());
      setRowSearchQuery("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !window.forartActionImport?.onScanProgress || !window.forartActionImport?.onScanComplete || !window.forartActionImport?.onScanError) return undefined;
    const removeProgress = window.forartActionImport.onScanProgress((payload) => {
      if (payload.scanId !== activeScanIdRef.current) return;
      setStage(payload.phase === "building" ? "building" : "discovering");
      setSourcePath(payload.sourcePath);
      setPreview((current) => ({
        ...(payload.summary || current),
        preview_id: current?.preview_id || payload.summary?.preview_id || "",
        rows: current?.rows || [],
      } as ActionFolderImportPreview));
      if (payload.rows?.length) {
        setFileRows((current) => {
          const seen = new Set(current.map((row) => row.id));
          const nextRows = payload.rows.filter((row) => !seen.has(row.id)) as ImportFileRow[];
          if (!nextRows.length) return current;
          setSelectedRows((selected) => {
            const next = new Set(selected);
            for (const row of nextRows) {
              const shouldSelect = rowIsValid(row) && (previousSelectionRef.current ? previousSelectionRef.current.has(row.id) : row.selected);
              if (shouldSelect) next.add(row.id);
            }
            return next;
          });
          setRowTagSelections((current) => {
            const next = new Map(current);
            for (const row of nextRows) {
              if (!next.has(row.id)) next.set(row.id, new Set());
            }
            return next;
          });
          return [...current, ...nextRows];
        });
      }
    });
    const removeComplete = window.forartActionImport.onScanComplete((payload) => {
      if (payload.scanId !== activeScanIdRef.current) return;
      activeScanIdRef.current = "";
      setPreview(payload.preview);
      setFileRows(payload.preview.rows as ImportFileRow[]);
      setRowTagSelections((current) => {
        const next = new Map<string, Set<string>>();
        for (const row of payload.preview.rows) {
          next.set(row.id, new Set(current.get(row.id) || []));
        }
        return next;
      });
      setStage("ready");
      setSelectedRows((current) => new Set(payload.preview.rows
        .filter((row) => rowIsValid(row) && (previousSelectionRef.current ? previousSelectionRef.current.has(row.id) : current.has(row.id) || row.selected))
        .map((row) => row.id)));
      previousSelectionRef.current = null;
    });
    const removeError = window.forartActionImport.onScanError((payload) => {
      if (payload.scanId !== activeScanIdRef.current) return;
      activeScanIdRef.current = "";
      previousSelectionRef.current = null;
      setStage("idle");
      setScanError(payload.message);
    });
    return () => {
      removeProgress();
      removeComplete();
      removeError();
    };
  }, [isOpen]);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error(t("actionLibrary:bulkImportNoPreview"));
      const selected = fileRows.filter((row) => selectedRowsForBulkActions.has(row.id));
      const imported: ActionFolderImportResult["imported"] = [];
      const failed: ActionFolderImportResult["failed"] = [];
      const resultRows: ActionFolderImportResult["rows"] = [];
      setImportProgress({ completed: 0, total: selected.length });
      setStage("importing");
      setRowImportStates(new Map(fileRows.map((row) => [
        row.id,
        {
          ...row,
          selected: selectedRowsForBulkActions.has(row.id),
          final_status: selectedRowsForBulkActions.has(row.id) ? "pending" : "not_selected",
        } as LiveImportRow,
      ])));

      for (const [index, row] of selected.entries()) {
        try {
          setRowImportStates((current) => {
            const next = new Map(current);
            next.set(row.id, { ...(next.get(row.id) || row), final_status: "importing" } as LiveImportRow);
            return next;
          });
          if (!preview.preview_id) throw new Error(t("actionLibrary:bulkImportNoPreview"));
          if (!window.forartActionImport?.readEntry) throw new Error(t("actionLibrary:importBridgeUnavailable"));
          const entryData = await window.forartActionImport.readEntry({ previewId: preview.preview_id, rowId: row.id });
          const entry: ActionFolderImportUploadEntry = {
            id: row.id,
            stem: row.stem,
            name: row.proposed_name,
            filename: entryData.filename,
            relative_path: row.relative_path,
            mime_type: entryData.mime_type,
            data: entryData.data,
            prompt: entryData.prompt,
            tags: Array.from(rowTagSelections.get(row.id) || []),
            warnings: row.warnings,
          };
          const rowResult = await importActionEntries(projectId, [entry]);
          imported.push(...rowResult.imported);
          failed.push(...rowResult.failed);
          resultRows.push(...rowResult.rows);
          setRowImportStates((current) => {
            const next = new Map(current);
            for (const resultRow of rowResult.rows) {
              next.set(resultRow.id, {
                ...resultRow,
                thumbnail_url: row.thumbnail_url || resultRow.thumbnail_url || "",
              } as LiveImportRow);
            }
            return next;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failedRow: ActionFolderImportResultRow = {
            ...row,
            final_status: "failed",
            errors: [...(row.errors || []), { code: "import_failed", message }],
          };
          failed.push(failedRow);
          resultRows.push(failedRow);
          setRowImportStates((current) => {
            const next = new Map(current);
            next.set(row.id, failedRow as LiveImportRow);
            return next;
          });
        } finally {
          setImportProgress({ completed: index + 1, total: selected.length });
        }
      }

      return {
        imported_count: imported.length,
        failed_count: failed.length,
        imported,
        not_selected: [],
        failed,
        rows: resultRows,
      };
    },
    onSuccess: async (nextResult) => {
      const previewRows = fileRows.length ? fileRows : preview?.rows || [];
      const previewRowsById = new Map(previewRows.map((row) => [row.id, row]));
      const returnedRowsById = new Map(nextResult.rows.map((row) => [row.id, row]));
      const resultRows = previewRows.map((row) => {
        const returnedRow = returnedRowsById.get(row.id);
        if (returnedRow) {
          return {
            ...returnedRow,
            thumbnail_url: returnedRow.thumbnail_url || row.thumbnail_url || "",
          };
        }
        return {
          ...row,
          selected: false,
          final_status: "not_selected" as const,
        };
      });
      for (const row of nextResult.rows) {
        if (!previewRowsById.has(row.id)) {
          resultRows.push({ ...row, thumbnail_url: row.thumbnail_url || "" });
        }
      }
      const finalResult = {
        ...nextResult,
        rows: resultRows,
        failed: resultRows.filter((row) => row.final_status === "failed"),
        not_selected: resultRows.filter((row) => row.final_status === "not_selected"),
      };
      setResult(finalResult);
      setRowImportStates(new Map(resultRows.map((row) => [row.id, row as LiveImportRow])));
      setStage("complete");
      await onImported();
    },
  });

  const rows = preview?.rows || EMPTY_IMPORT_ROWS;
  const displayRows = fileRows.length ? fileRows : rows;
  const rowSearchText = rowSearchQuery.trim().toLocaleLowerCase();
  const filteredDisplayRows = useMemo(() => {
    if (!rowSearchText) return displayRows;
    return displayRows.filter((row) => rowMatchesSearch(row, rowSearchText));
  }, [displayRows, rowSearchText]);
  const filteredValidRowIds = useMemo(() => filteredDisplayRows.filter(rowIsValid).map((row) => row.id), [filteredDisplayRows]);
  const filteredValidRowSignature = useMemo(() => rowIdSignature(filteredValidRowIds), [filteredValidRowIds]);
  const selectedRowsForBulkActions = selectedRows;
  const selectedRowList = displayRows.filter((row) => selectedRowsForBulkActions.has(row.id));
  const selectedInvalidCount = selectedRowList.filter((row) => !rowIsValid(row)).length;
  const selectedWarningCount = selectedRowList.filter((row) => row.warnings?.length).length;
  const scanActive = stage === "discovering" || stage === "building";
  const canImport = Boolean(stage === "ready" && preview && selectedRowsForBulkActions.size && !selectedInvalidCount && !importMutation.isPending);
  const importStarted = stage === "importing" || stage === "complete";
  const closeBlocked = stage === "importing" || importMutation.isPending;
  const errorMessage = scanError || importMutation.error;
  const errorText = errorMessage instanceof Error ? errorMessage.message : errorMessage ? String(errorMessage) : "";
  useEffect(() => {
    if (importStarted) return;
    setSelectedRows((current) => {
      if (current.size === filteredValidRowIds.length && filteredValidRowIds.every((rowId) => current.has(rowId))) return current;
      return new Set(filteredValidRowIds);
    });
  }, [filteredValidRowSignature, importStarted]);

  const resultTotals = useMemo(() => {
    const resultRows = result?.rows || [];
    return {
      imported: resultRows.filter((row) => row.final_status === "imported" || row.final_status === "warning").length,
      warning: resultRows.filter((row) => row.final_status === "warning").length,
      failed: resultRows.filter((row) => row.final_status === "failed").length,
      notSelected: resultRows.filter((row) => row.final_status === "not_selected").length,
    };
  }, [result?.rows]);

  async function scanFolder(nextSourcePath = sourcePath, previousSelection: Set<string> | null = null) {
    setScanError("");
    if (!window.forartActionImport?.startScan) throw new Error(t("actionLibrary:importBridgeUnavailable"));
    if (activeScanIdRef.current) await window.forartActionImport.cancelScan?.({ scanId: activeScanIdRef.current });
    const scanId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    activeScanIdRef.current = scanId;
    previousSelectionRef.current = previousSelection;
    setSourcePath(nextSourcePath);
    setPreview({
      preview_id: "",
      source_path: nextSourcePath,
      project_id: projectId,
      total_images: 0,
      total_text_files: 0,
      ready_count: 0,
      selected_count: 0,
      blocking_error_count: 0,
      warning_count: 0,
      rows: [],
    });
    setStage("discovering");
    setResult(null);
    setFileRows([]);
    setSelectedRows(new Set());
    setRowSearchQuery("");
    setImportProgress({ completed: 0, total: 0 });
    setRowImportStates(new Map());
    if (rowsViewportRef.current) rowsViewportRef.current.scrollTop = 0;
    const started = await window.forartActionImport.startScan({
      projectId,
      scanId,
      sourcePath: nextSourcePath,
      existingActionNames,
    });
    activeScanIdRef.current = started.scanId;
  }

  async function chooseFolder() {
    if (!window.forartActionImport?.chooseFolder) {
      setScanError(t("actionLibrary:importBridgeUnavailable"));
      return;
    }
    try {
      const result = await window.forartActionImport.chooseFolder({ title: t("actionLibrary:bulkImportChooseFolder") });
      if (result.canceled || !result.path) return;
      await scanFolder(result.path, null);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    }
  }

  async function rescan() {
    if (!sourcePath) return;
    try {
      await scanFolder(sourcePath, preview ? selectedRows : null);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    }
  }

  function toggleRow(row: ActionFolderImportRow) {
    setSelectedRows((current) => {
      if (importStarted) return current;
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  function selectFilteredValidRows() {
    setSelectedRows(new Set(filteredValidRowIds));
  }

  function clearSelection() {
    setSelectedRows(new Set());
  }

  function toggleRowTag(rowId: string, tagName: string) {
    if (importStarted) return;
    setRowTagSelections((current) => {
      const next = new Map(current);
      const tagsForRow = new Set(next.get(rowId) || []);
      if (tagsForRow.has(tagName)) tagsForRow.delete(tagName);
      else tagsForRow.add(tagName);
      next.set(rowId, tagsForRow);
      return next;
    });
  }

  function toggleTagForSelectedRows(tagName: string) {
    if (importStarted || !selectedRowsForBulkActions.size) return;
    const selected = Array.from(selectedRowsForBulkActions);
    const shouldRemove = selected.every((rowId) => rowTagSelections.get(rowId)?.has(tagName));
    setRowTagSelections((current) => {
      const next = new Map(current);
      for (const rowId of selected) {
        const tagsForRow = new Set(next.get(rowId) || []);
        if (shouldRemove) tagsForRow.delete(tagName);
        else tagsForRow.add(tagName);
        next.set(rowId, tagsForRow);
      }
      return next;
    });
  }

  function clearSelectedRowTags() {
    if (importStarted || !selectedRowsForBulkActions.size) return;
    setRowTagSelections((current) => {
      const next = new Map(current);
      for (const rowId of selectedRowsForBulkActions) next.set(rowId, new Set());
      return next;
    });
  }

  function clearRowTags(rowId: string) {
    if (importStarted) return;
    setRowTagSelections((current) => {
      const next = new Map(current);
      next.set(rowId, new Set());
      return next;
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open && !closeBlocked) onClose();
    }}>
      <DialogContent
        className="action-folder-import max-w-none overflow-hidden sm:max-w-none"
        onEscapeKeyDown={(event) => {
          if (closeBlocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (closeBlocked) event.preventDefault();
        }}
      >
        <DialogHeader className="action-folder-import__head flex-row text-left">
          <div>
            <DialogTitle>{t("actionLibrary:bulkImportTitle")}</DialogTitle>
            <DialogDescription>{t("actionLibrary:bulkImportDescription", { project: projectName || t("common:labels.projectName") })}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" type="button" disabled={closeBlocked} aria-label={t("common:actions.close")} title={t("common:actions.close")}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="action-folder-import__toolbar">
          <Button variant="outline" size="icon-lg" type="button" onClick={chooseFolder} disabled={scanActive || importStarted} aria-label={sourcePath ? t("actionLibrary:bulkImportChangeFolder") : t("actionLibrary:bulkImportChooseFolder")} title={sourcePath ? t("actionLibrary:bulkImportChangeFolder") : t("actionLibrary:bulkImportChooseFolder")}>
            <FolderOpen aria-hidden="true" />
          </Button>
          <Button className={scanActive ? "action-folder-import__icon-button is-spinning" : "action-folder-import__icon-button"} variant="outline" size="icon-lg" type="button" onClick={rescan} disabled={!sourcePath || scanActive || importStarted} aria-label={t("actionLibrary:bulkImportRescan")} title={t("actionLibrary:bulkImportRescan")}>
            <RefreshCw aria-hidden="true" />
          </Button>
          <div className="action-folder-import__path" title={preview?.source_path || sourcePath}>
            {preview?.source_path || sourcePath || t("actionLibrary:bulkImportNoFolder")}
          </div>
        </div>

        {errorText ? <ErrorCopyLine className="library-error" text={t("actionLibrary:requestFailed", { message: errorText })} /> : null}

        <div className="action-folder-import__summary">
              {result ? (
                <>
                  <span>{t("actionLibrary:bulkImportResultImported", { count: resultTotals.imported })}</span>
                  <span className={resultTotals.warning ? "is-warning" : ""}>{t("actionLibrary:bulkImportWarnings", { count: resultTotals.warning })}</span>
                  <span className={resultTotals.failed ? "is-error" : ""}>{t("actionLibrary:bulkImportResultFailed", { count: resultTotals.failed })}</span>
                  <span>{t("actionLibrary:bulkImportStatusNotSelected")} {resultTotals.notSelected}</span>
                </>
              ) : (
                <>
                  <span>{t("actionLibrary:bulkImportImages", { count: preview?.total_images || 0 })}</span>
                  <span>{t("actionLibrary:bulkImportTexts", { count: preview?.total_text_files || 0 })}</span>
                  <span>{t("actionLibrary:bulkImportSelected", { count: selectedRowsForBulkActions.size })}</span>
                  <span className={preview?.blocking_error_count ? "is-error" : ""}>{t("actionLibrary:bulkImportErrors", { count: preview?.blocking_error_count || 0 })}</span>
                  <span className={selectedWarningCount ? "is-warning" : ""}>{t("actionLibrary:bulkImportWarnings", { count: selectedWarningCount })}</span>
                </>
              )}
            </div>

            <div className="action-folder-import__actions">
              <SearchInput
                className="action-folder-import__search"
                value={rowSearchQuery}
                disabled={scanActive || importStarted}
                placeholder={t("actionLibrary:bulkImportSearchPlaceholder")}
                clearLabel={t("resourceLibrary:clearSearch")}
                onChange={(nextSearchQuery) => {
                  setRowSearchQuery(nextSearchQuery);
                  setSelectedRows(filteredValidRowIdSet(displayRows, nextSearchQuery.trim().toLocaleLowerCase()));
                  if (rowsViewportRef.current) rowsViewportRef.current.scrollTop = 0;
                }}
              />
              <div className="action-folder-import__selection-actions">
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="action-folder-import__tag-trigger"
                      type="button"
                      variant="default"
                      disabled={!selectedRowsForBulkActions.size || scanActive || importStarted}
                    >
                      <Tags data-icon="inline-start" aria-hidden="true" />
                      <span>{t("actionLibrary:bulkImportApplyTags")}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="library-tag-dropdown-menu max-h-72 min-w-44 !overflow-y-auto">
                    <DropdownMenuGroup>
                      {tags.length ? tags.map((tag) => {
                        const checked = Array.from(selectedRowsForBulkActions).every((rowId) => rowTagSelections.get(rowId)?.has(tag.name));
                        return (
                          <DropdownMenuCheckboxItem
                            key={tag.id}
                            className="library-tag-dropdown-item"
                            checked={checked}
                            indicatorSide="right"
                            onSelect={(event) => {
                              event.preventDefault();
                              toggleTagForSelectedRows(tag.name);
                            }}
                          >
                            <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
                            <span className="library-tag-dropdown-item__label">{tag.name}</span>
                          </DropdownMenuCheckboxItem>
                        );
                      }) : (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("actionLibrary:noTags")}</div>
                      )}
                      {tags.length ? (
                        <DropdownMenuItem onSelect={(event) => {
                          event.preventDefault();
                          clearSelectedRowTags();
                        }}>
                          {t("actionLibrary:bulkImportClearTags")}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="default" type="button" disabled={!filteredValidRowIds.length || scanActive || importStarted} onClick={selectFilteredValidRows}>
                  {t("actionLibrary:bulkImportSelectValid")}
                </Button>
                <Button variant="default" type="button" disabled={!displayRows.length || scanActive || importStarted} onClick={clearSelection}>
                  {t("actionLibrary:bulkImportClearSelection")}
                </Button>
              </div>
            </div>

            <VirtualList
              items={filteredDisplayRows}
              estimateSize={VIRTUAL_ROW_HEIGHT}
              overscan={VIRTUAL_OVERSCAN}
              getItemKey={(row) => row.id}
              className="action-folder-import__rows"
              viewportClassName="action-folder-import__rows-viewport"
              viewportRef={rowsViewportRef}
              spacerClassName="action-folder-import__virtual"
              itemRole="listitem"
              role="list"
              ariaLabel={t("actionLibrary:bulkImportRows")}
              itemClassName={(row) => {
                const checked = selectedRows.has(row.id);
                const liveStatus = rowImportStates.get(row.id)?.final_status || "";
                return `action-folder-import-row ${liveStatus ? liveStatusClass(liveStatus) : statusClass(row)}${checked ? " is-selected" : ""}`;
              }}
              empty={
                !preview
                  ? <Empty className="action-folder-import__empty"><EmptyDescription>{t("actionLibrary:bulkImportPickFolderFirst")}</EmptyDescription></Empty>
                  : !displayRows.length
                    ? <Empty className="action-folder-import__empty"><EmptyDescription>{t("actionLibrary:bulkImportPickFolderFirst")}</EmptyDescription></Empty>
                    : <Empty className="action-folder-import__empty"><EmptyDescription>{t("actionLibrary:bulkImportNoSearchResults")}</EmptyDescription></Empty>
              }
              renderItem={(row) => {
                const checked = selectedRows.has(row.id);
                const liveRow = rowImportStates.get(row.id);
                const displayRow = liveRow || row;
                const liveStatus = liveRow?.final_status || "";
                const message = issueText(displayRow);
                const selectedTagNames = rowTagSelections.get(row.id) || new Set<string>();
                return (
                  <>
                    {importStarted ? (
                      <div className="action-folder-import-row__check action-folder-import-row__result-icon" aria-hidden="true">
                        {liveStatus === "importing" ? <Loader2 size={18} /> : liveStatus === "failed" ? <XCircle size={18} /> : liveStatus === "not_selected" ? <span /> : <CheckCircle2 size={18} />}
                      </div>
                    ) : (
                      <div className="action-folder-import-row__check">
                        <Checkbox checked={checked} onCheckedChange={() => toggleRow(row)} aria-label={t("actionLibrary:bulkImportToggleRow", { name: row.proposed_name || row.filename })} />
                      </div>
                    )}
                    <div className="action-folder-import-row__thumb">
                      {displayRow.thumbnail_url ? <img src={displayRow.thumbnail_url} alt={displayRow.proposed_name || displayRow.filename} loading="lazy" decoding="async" /> : <span>{t("common:empty.noImage")}</span>}
                    </div>
                    <div className="action-folder-import-row__main">
                      <div className="action-folder-import-row__name" title={displayRow.proposed_name || displayRow.filename}>{displayRow.proposed_name || displayRow.filename}</div>
                      <div className="action-folder-import-row__tags" aria-label={t("actionLibrary:bulkImportRowTags", { name: displayRow.proposed_name || displayRow.filename })}>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              className="action-folder-import-row__tag-trigger"
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={importStarted}
                              aria-label={t("actionLibrary:chooseTags")}
                            >
                              <Tags aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="library-tag-dropdown-menu max-h-72 min-w-44 !overflow-y-auto">
                            <DropdownMenuGroup>
                              {tags.length ? tags.map((tag) => {
                                const checked = selectedTagNames.has(tag.name);
                                return (
                                  <DropdownMenuCheckboxItem
                                    key={tag.id}
                                    className="library-tag-dropdown-item"
                                    checked={checked}
                                    indicatorSide="right"
                                    onSelect={(event) => {
                                      event.preventDefault();
                                      toggleRowTag(row.id, tag.name);
                                    }}
                                  >
                                    <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
                                    <span className="library-tag-dropdown-item__label">{tag.name}</span>
                                  </DropdownMenuCheckboxItem>
                                );
                              }) : (
                                <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("actionLibrary:noTags")}</div>
                              )}
                              {tags.length ? (
                                <DropdownMenuItem onSelect={(event) => {
                                  event.preventDefault();
                                  clearRowTags(row.id);
                                }}>
                                  {t("actionLibrary:bulkImportClearTags")}
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="action-folder-import-row__tag-summary">
                          {selectedTagNames.size ? (
                            Array.from(selectedTagNames).map((tagName) => <span key={tagName}>{tagName}</span>)
                          ) : (
                            <span className="action-folder-import-row__tag-empty">{t("actionLibrary:noTags")}</span>
                          )}
                        </div>
                      </div>
                      <div className="action-folder-import-row__message" title={message || undefined}>
                        {message ? (
                          <>
                            {displayRow.errors?.length ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                            <span>{message}</span>
                          </>
                        ) : (
                          <span />
                        )}
                      </div>
                    </div>
                    <span className="action-folder-import-row__status">{liveStatus ? finalStatusLabel(liveStatus, t) : row.errors?.length ? t("actionLibrary:bulkImportStatusInvalid") : row.warnings?.length ? t("actionLibrary:bulkImportStatusWarning") : t("actionLibrary:bulkImportStatusReady")}</span>
                  </>
                );
              }}
            />

            <DialogFooter className="action-folder-import__footer flex-row sm:justify-between">
              <span>
                {stage === "complete"
                  ? t("actionLibrary:bulkImportResultDone")
                  : selectedInvalidCount
                    ? t("actionLibrary:bulkImportSelectedInvalid", { count: selectedInvalidCount })
                    : t("actionLibrary:bulkImportReadyHint")}
              </span>
              <div>
                {stage === "complete" ? (
                  <DialogClose asChild>
                    <Button type="button">{t("common:actions.close")}</Button>
                  </DialogClose>
                ) : (
                  <Button type="button" disabled={!canImport} onClick={() => importMutation.mutate()}>
                    {importMutation.isPending
                      ? `${t("actionLibrary:bulkImportImporting")} ${importProgress.completed}/${importProgress.total}`
                      : t("actionLibrary:bulkImportStart")}
                  </Button>
                )}
              </div>
            </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
