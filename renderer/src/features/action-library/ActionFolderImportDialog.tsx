import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, RefreshCw, Tags, XCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { importActionEntries } from "./actionFolderImportApi";
import type { ActionTag } from "./types";
import type { ActionFolderImportPreview, ActionFolderImportResult, ActionFolderImportResultRow, ActionFolderImportRow, ActionFolderImportUploadEntry } from "./actionFolderImportTypes";

type ImportStage = "idle" | "discovering" | "building" | "ready" | "importing" | "complete";
const VIRTUAL_ROW_HEIGHT = 132;
const VIRTUAL_OVERSCAN = 6;

type ImportFileRow = ActionFolderImportRow;

type LiveImportStatus = ActionFolderImportResultRow["final_status"] | "pending" | "importing";

type LiveImportRow = Omit<ActionFolderImportResultRow, "final_status"> & {
  final_status: LiveImportStatus;
};

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
  const [bulkTagMenuState, setBulkTagMenuState] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const [scanProgress, setScanProgress] = useState({ processedFiles: 0, totalFiles: 0, builtRows: 0, totalRows: 0 });
  const [rowViewport, setRowViewport] = useState({ scrollTop: 0, height: 420 });

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
      setBulkTagMenuState({ open: false, x: 0, y: 0 });
      setScanProgress({ processedFiles: 0, totalFiles: 0, builtRows: 0, totalRows: 0 });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!bulkTagMenuState.open) return undefined;
    function closeMenu() {
      setBulkTagMenuState({ open: false, x: 0, y: 0 });
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [bulkTagMenuState.open]);

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
      setScanProgress({
        processedFiles: payload.processedFiles || 0,
        totalFiles: payload.totalFiles || 0,
        builtRows: payload.builtRows || payload.rows?.length || 0,
        totalRows: payload.totalRows || 0,
      });
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
      setScanProgress((current) => ({
        ...current,
        builtRows: payload.preview.rows.length,
        totalRows: payload.preview.rows.length,
      }));
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
      const selected = fileRows.filter((row) => selectedRows.has(row.id));
      const imported: ActionFolderImportResult["imported"] = [];
      const failed: ActionFolderImportResult["failed"] = [];
      const resultRows: ActionFolderImportResult["rows"] = [];
      setImportProgress({ completed: 0, total: selected.length });
      setStage("importing");
      setRowImportStates(new Map(fileRows.map((row) => [
        row.id,
        {
          ...row,
          selected: selectedRows.has(row.id),
          final_status: selectedRows.has(row.id) ? "pending" : "not_selected",
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
          if (!window.forartActionImport?.readEntry) throw new Error("Action import bridge is unavailable.");
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

  const rows = preview?.rows || [];
  const displayRows = fileRows.length ? fileRows : rows;
  const selectedRowList = displayRows.filter((row) => selectedRows.has(row.id));
  const selectedInvalidCount = selectedRowList.filter((row) => !rowIsValid(row)).length;
  const selectedWarningCount = selectedRowList.filter((row) => row.warnings?.length).length;
  const scanActive = stage === "discovering" || stage === "building";
  const canImport = Boolean(stage === "ready" && preview && selectedRows.size && !selectedInvalidCount && !importMutation.isPending);
  const importStarted = stage === "importing" || stage === "complete";
  const errorMessage = scanError || importMutation.error;
  const errorText = errorMessage instanceof Error ? errorMessage.message : errorMessage ? String(errorMessage) : "";
  const virtualRows = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(rowViewport.scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const visibleCount = Math.ceil(rowViewport.height / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    return displayRows.slice(startIndex, startIndex + visibleCount).map((row, offset) => ({
      row,
      index: startIndex + offset,
    }));
  }, [displayRows, rowViewport]);
  const virtualHeight = displayRows.length * VIRTUAL_ROW_HEIGHT;

  useEffect(() => {
    if (!isOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const element = rowsViewportRef.current;
      if (element) setRowViewport({ scrollTop: element.scrollTop, height: element.clientHeight || 420 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayRows.length, isOpen]);

  const resultTotals = useMemo(() => {
    const resultRows = result?.rows || [];
    return {
      imported: resultRows.filter((row) => row.final_status === "imported" || row.final_status === "warning").length,
      warning: resultRows.filter((row) => row.final_status === "warning").length,
      failed: resultRows.filter((row) => row.final_status === "failed").length,
      notSelected: resultRows.filter((row) => row.final_status === "not_selected").length,
    };
  }, [result?.rows]);

  if (!isOpen) return null;

  async function cancelActiveScan() {
    const scanId = activeScanIdRef.current;
    if (!scanId) return;
    activeScanIdRef.current = "";
    previousSelectionRef.current = null;
    await window.forartActionImport?.cancelScan?.({ scanId });
    setStage("idle");
  }

  async function scanFolder(nextSourcePath = sourcePath, previousSelection: Set<string> | null = null) {
    setScanError("");
    if (!window.forartActionImport?.startScan) throw new Error("Action import bridge is unavailable.");
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
    setImportProgress({ completed: 0, total: 0 });
    setRowImportStates(new Map());
    setBulkTagMenuState({ open: false, x: 0, y: 0 });
    setScanProgress({ processedFiles: 0, totalFiles: 0, builtRows: 0, totalRows: 0 });
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
      setScanError("Action import bridge is unavailable.");
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

  function selectValidRows() {
    setSelectedRows(new Set(displayRows.filter(rowIsValid).map((row) => row.id)));
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

  function applyTagToSelectedRows(tagName: string) {
    if (importStarted || !selectedRows.size) return;
    setRowTagSelections((current) => {
      const next = new Map(current);
      for (const rowId of selectedRows) {
        const tagsForRow = new Set(next.get(rowId) || []);
        if (tagsForRow.has(tagName)) tagsForRow.delete(tagName);
        else tagsForRow.add(tagName);
        next.set(rowId, tagsForRow);
      }
      return next;
    });
  }

  function clearSelectedRowTags() {
    if (importStarted || !selectedRows.size) return;
    setRowTagSelections((current) => {
      const next = new Map(current);
      for (const rowId of selectedRows) next.set(rowId, new Set());
      return next;
    });
  }

  function openBulkTagMenu(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (bulkTagMenuState.open) {
      setBulkTagMenuState({ open: false, x: 0, y: 0 });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 184;
    const menuMaxHeight = 280;
    const pad = 8;
    setBulkTagMenuState({
      open: true,
      x: Math.max(pad, Math.min(rect.left, window.innerWidth - menuWidth - pad)),
      y: Math.max(pad, Math.min(rect.bottom + 8, window.innerHeight - menuMaxHeight - pad)),
    });
  }

  return (
    <div className="dialog-backdrop action-folder-import-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="action-folder-import" role="dialog" aria-modal="true" aria-labelledby="action-folder-import-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="action-folder-import__head">
          <div>
            <h2 id="action-folder-import-title">{t("actionLibrary:bulkImportTitle")}</h2>
            <p>{t("actionLibrary:bulkImportDescription", { project: projectName || t("common:labels.projectName") })}</p>
          </div>
          <button className="action-folder-import__icon-button" type="button" aria-label={t("common:actions.close")} onClick={onClose}>
            <XCircle size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="action-folder-import__toolbar">
          <button className="action-folder-import__icon-button" type="button" onClick={chooseFolder} disabled={scanActive || importStarted} aria-label={sourcePath ? t("actionLibrary:bulkImportChangeFolder") : t("actionLibrary:bulkImportChooseFolder")} title={sourcePath ? t("actionLibrary:bulkImportChangeFolder") : t("actionLibrary:bulkImportChooseFolder")}>
            <FolderOpen size={18} aria-hidden="true" />
          </button>
          <button className={`action-folder-import__icon-button${scanActive ? " is-spinning" : ""}`} type="button" onClick={rescan} disabled={!sourcePath || scanActive || importStarted} aria-label={t("actionLibrary:bulkImportRescan")} title={t("actionLibrary:bulkImportRescan")}>
            <RefreshCw size={18} aria-hidden="true" />
          </button>
          <div className="action-folder-import__path" title={preview?.source_path || sourcePath}>
            {preview?.source_path || sourcePath || t("actionLibrary:bulkImportNoFolder")}
          </div>
        </div>

        {errorText ? <div className="model-lib-error">{t("actionLibrary:requestFailed", { message: errorText })}</div> : null}

        <>
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
                  <span>{t("actionLibrary:bulkImportSelected", { count: selectedRows.size })}</span>
                  <span className={preview?.blocking_error_count ? "is-error" : ""}>{t("actionLibrary:bulkImportErrors", { count: preview?.blocking_error_count || 0 })}</span>
                  <span className={selectedWarningCount ? "is-warning" : ""}>{t("actionLibrary:bulkImportWarnings", { count: selectedWarningCount })}</span>
                </>
              )}
            </div>

            <div className="action-folder-import__actions">
              <button
                className={`model-lib-button action-folder-import__tag-trigger${bulkTagMenuState.open ? " active" : ""}`}
                type="button"
                disabled={!selectedRows.size || scanActive || importStarted}
                aria-haspopup="menu"
                aria-expanded={bulkTagMenuState.open}
                onClick={openBulkTagMenu}
              >
                <Tags size={16} aria-hidden="true" />
                <span>{t("actionLibrary:bulkImportApplyTags")}</span>
              </button>
              <div className="action-folder-import__selection-actions">
                <button className="model-lib-button" type="button" disabled={!displayRows.length || scanActive || importStarted} onClick={selectValidRows}>
                  {t("actionLibrary:bulkImportSelectValid")}
                </button>
                <button className="model-lib-button" type="button" disabled={!displayRows.length || scanActive || importStarted} onClick={clearSelection}>
                  {t("actionLibrary:bulkImportClearSelection")}
                </button>
              </div>
            </div>
            {bulkTagMenuState.open
              ? createPortal(
                  <div
                    className="outfit-tag-menu outfit-tag-menu--submenu action-folder-import__tag-menu"
                    role="menu"
                    aria-label={t("actionLibrary:chooseTags")}
                    style={{ left: bulkTagMenuState.x, top: bulkTagMenuState.y }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    {tags.length ? (
                      <>
                        {tags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            role="menuitemcheckbox"
                            onClick={() => applyTagToSelectedRows(tag.name)}
                          >
                            {tag.name}
                          </button>
                        ))}
                        <button type="button" role="menuitem" onClick={clearSelectedRowTags}>
                          {t("actionLibrary:bulkImportClearTags")}
                        </button>
                      </>
                    ) : (
                      <div className="outfit-tag-menu__empty">{t("actionLibrary:noTags")}</div>
                    )}
                  </div>,
                  document.body,
                )
              : null}

            <div
              ref={rowsViewportRef}
              className="action-folder-import__rows scrollbar-thin-stable"
              role="list"
              aria-label={t("actionLibrary:bulkImportRows")}
              onScroll={(event) => {
                const target = event.currentTarget;
                setRowViewport({ scrollTop: target.scrollTop, height: target.clientHeight });
              }}
            >
              <div className="action-folder-import__virtual" style={{ height: virtualHeight || undefined }}>
              {virtualRows.map(({ row, index }) => {
                const checked = selectedRows.has(row.id);
                const liveRow = rowImportStates.get(row.id);
                const displayRow = liveRow || row;
                const liveStatus = liveRow?.final_status || "";
                const message = issueText(displayRow);
                const selectedTagNames = rowTagSelections.get(row.id) || new Set<string>();
                return (
                  <div key={row.id} className={`action-folder-import-row ${liveStatus ? liveStatusClass(liveStatus) : statusClass(row)}${checked ? " is-selected" : ""}`} role="listitem" style={{ transform: `translateY(${index * VIRTUAL_ROW_HEIGHT}px)` }}>
                    {importStarted ? (
                      <div className="action-folder-import-row__check action-folder-import-row__result-icon" aria-hidden="true">
                        {liveStatus === "importing" ? <Loader2 size={18} /> : liveStatus === "failed" ? <XCircle size={18} /> : liveStatus === "not_selected" ? <span /> : <CheckCircle2 size={18} />}
                      </div>
                    ) : (
                      <label className="action-folder-import-row__check">
                        <input type="checkbox" checked={checked} onChange={() => toggleRow(row)} aria-label={t("actionLibrary:bulkImportToggleRow", { name: row.proposed_name || row.filename })} />
                      </label>
                    )}
                    <div className="action-folder-import-row__thumb">
                      {displayRow.thumbnail_url ? <img src={displayRow.thumbnail_url} alt={displayRow.proposed_name || displayRow.filename} loading="lazy" decoding="async" /> : <span>{t("common:empty.noImage")}</span>}
                    </div>
                    <div className="action-folder-import-row__main">
                      <div className="action-folder-import-row__name" title={displayRow.proposed_name || displayRow.filename}>{displayRow.proposed_name || displayRow.filename}</div>
                      <div className="action-folder-import-row__meta" title={displayRow.relative_path}>{displayRow.relative_path}</div>
                      {message ? (
                        <div className="action-folder-import-row__message">
                          {displayRow.errors?.length ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                          <span>{message}</span>
                        </div>
                      ) : null}
                      <div className="action-folder-import-row__tags" aria-label={t("actionLibrary:bulkImportRowTags", { name: displayRow.proposed_name || displayRow.filename })}>
                        {tags.map((tag) => {
                          const active = selectedTagNames.has(tag.name);
                          return (
                            <button
                              key={tag.id}
                              className={active ? "selected" : ""}
                              type="button"
                              disabled={importStarted}
                              aria-pressed={active}
                              onClick={() => toggleRowTag(row.id, tag.name)}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                        {!tags.length ? <span>{t("actionLibrary:noTags")}</span> : null}
                      </div>
                    </div>
                    <span className="action-folder-import-row__status">{liveStatus ? finalStatusLabel(liveStatus, t) : row.errors?.length ? t("actionLibrary:bulkImportStatusInvalid") : row.warnings?.length ? t("actionLibrary:bulkImportStatusWarning") : t("actionLibrary:bulkImportStatusReady")}</span>
                  </div>
                );
              })}
              </div>
              {!preview ? <div className="action-folder-import__empty">{t("actionLibrary:bulkImportPickFolderFirst")}</div> : null}
              {preview && !displayRows.length ? <div className="action-folder-import__empty">{t("actionLibrary:bulkImportPickFolderFirst")}</div> : null}
            </div>

            <footer className="action-folder-import__footer">
              <span>
                {stage === "complete"
                  ? t("actionLibrary:bulkImportResultDone")
                  : selectedInvalidCount
                    ? t("actionLibrary:bulkImportSelectedInvalid", { count: selectedInvalidCount })
                    : t("actionLibrary:bulkImportReadyHint")}
              </span>
              <div>
                {stage === "complete" ? (
                  <button className="button primary" type="button" onClick={onClose}>{t("common:actions.close")}</button>
                ) : (
                  <>
                    <button className="button secondary" type="button" onClick={onClose} disabled={importMutation.isPending}>{t("common:actions.cancel")}</button>
                    <button className="button primary" type="button" disabled={!canImport} onClick={() => importMutation.mutate()}>
                      {importMutation.isPending
                        ? `${t("actionLibrary:bulkImportImporting")} ${importProgress.completed}/${importProgress.total}`
                        : t("actionLibrary:bulkImportStart")}
                    </button>
                  </>
                )}
              </div>
            </footer>
          </>
      </section>
    </div>
  );
}
