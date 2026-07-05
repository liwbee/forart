import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderOpen, RefreshCw, XCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { importActionEntries } from "./actionFolderImportApi";
import type { ActionFolderImportIssue, ActionFolderImportPreview, ActionFolderImportResult, ActionFolderImportResultRow, ActionFolderImportRow, ActionFolderImportUploadEntry } from "./actionFolderImportTypes";

type ImportStage = "preview" | "result";
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const PROMPT_LIMIT = 4000;

type ImportFileRow = ActionFolderImportRow & {
  imageFile?: File;
  textFile?: File;
};

function issueText(row: Pick<ActionFolderImportRow, "errors" | "warnings">) {
  return [...(row.errors || []), ...(row.warnings || [])].map((issue) => issue.message).join(" / ");
}

function statusClass(row: Pick<ActionFolderImportRow, "errors" | "warnings">) {
  if (row.errors?.length) return "is-error";
  if (row.warnings?.length) return "is-warning";
  return "is-ready";
}

function rowIsValid(row: ActionFolderImportRow) {
  return !row.errors?.length;
}

function fileRelativePath(file: File) {
  return String((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name || "");
}

function fileStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function fileExt(fileName: string) {
  const match = /\.[^.]+$/.exec(fileName);
  return match ? match[0].toLowerCase() : "";
}

function rowIdFor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `row_${Math.abs(hash).toString(36)}_${value.length.toString(36)}`;
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function validateActionName(name: string, existingNames: Set<string>): ActionFolderImportIssue[] {
  const errors: ActionFolderImportIssue[] = [];
  if (!name) errors.push({ code: "invalid_name", message: "Action name is required" });
  if (name.length > 80) errors.push({ code: "invalid_name", message: "Action name must be 80 characters or fewer" });
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) errors.push({ code: "invalid_name", message: "Action name contains invalid filename characters" });
  if (name === "." || name === ".." || /[ .]$/.test(name)) errors.push({ code: "invalid_name", message: "Action name cannot end with a space or period" });
  if (existingNames.has(name)) errors.push({ code: "duplicate_name", message: "Action name already exists in this project" });
  return errors;
}

function readFileAsTextWithFallback(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read text"));
    reader.onload = () => {
      const buffer = reader.result instanceof ArrayBuffer ? reader.result : new ArrayBuffer(0);
      try {
        resolve(new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, ""));
      } catch {
        try {
          resolve(new TextDecoder("gb18030").decode(buffer).replace(/^\uFEFF/, ""));
        } catch {
          resolve(new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, ""));
        }
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read image"));
    reader.onload = () => {
      const text = String(reader.result || "");
      resolve(text.includes(",") ? text.split(",")[1] || "" : text);
    };
    reader.readAsDataURL(file);
  });
}

function finalStatusLabel(status: string, t: ReturnType<typeof useTranslation>["t"]) {
  if (status === "imported") return t("actionLibrary:bulkImportStatusImported");
  if (status === "warning") return t("actionLibrary:bulkImportStatusWarning");
  if (status === "failed") return t("actionLibrary:bulkImportStatusFailed");
  return t("actionLibrary:bulkImportStatusNotSelected");
}

function revokeRowObjectUrls(rows: Array<Pick<ActionFolderImportRow, "thumbnail_url">>) {
  for (const row of rows) {
    if (row.thumbnail_url?.startsWith("blob:")) URL.revokeObjectURL(row.thumbnail_url);
  }
}

interface ActionFolderImportDialogProps {
  projectId: string;
  projectName: string;
  existingActionNames: string[];
  isOpen: boolean;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

export function ActionFolderImportDialog({ projectId, projectName, existingActionNames, isOpen, onClose, onImported }: ActionFolderImportDialogProps) {
  const { t } = useTranslation();
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [preview, setPreview] = useState<ActionFolderImportPreview | null>(null);
  const [result, setResult] = useState<ActionFolderImportResult | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<ImportStage>("preview");
  const [fileRows, setFileRows] = useState<ImportFileRow[]>([]);
  const [scanError, setScanError] = useState("");
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0 });

  useEffect(() => {
    if (!isOpen) {
      revokeRowObjectUrls(fileRows);
      setSourcePath("");
      setPreview(null);
      setResult(null);
      setSelectedRows(new Set());
      setStage("preview");
      setFileRows([]);
      setScanError("");
      setImportProgress({ completed: 0, total: 0 });
    }
  }, [fileRows, isOpen]);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error(t("actionLibrary:bulkImportNoPreview"));
      const selected = fileRows.filter((row) => selectedRows.has(row.id));
      const imported: ActionFolderImportResult["imported"] = [];
      const failed: ActionFolderImportResult["failed"] = [];
      const resultRows: ActionFolderImportResult["rows"] = [];
      setImportProgress({ completed: 0, total: selected.length });

      for (const [index, row] of selected.entries()) {
        try {
          if (!row.imageFile || !row.textFile) throw new Error(`Selected row is not importable: ${row.filename}`);
          const promptRaw = await readFileAsTextWithFallback(row.textFile);
          const prompt = promptRaw.length > PROMPT_LIMIT ? promptRaw.slice(0, PROMPT_LIMIT) : promptRaw;
          const entry: ActionFolderImportUploadEntry = {
            id: row.id,
            stem: row.stem,
            name: row.proposed_name,
            filename: row.imageFile.name,
            relative_path: row.relative_path,
            mime_type: row.imageFile.type || `image/${fileExt(row.imageFile.name).replace(".", "") || "png"}`,
            data: await fileToBase64(row.imageFile),
            prompt,
            warnings: row.warnings,
          };
          const rowResult = await importActionEntries(projectId, [entry]);
          imported.push(...rowResult.imported);
          failed.push(...rowResult.failed);
          resultRows.push(...rowResult.rows);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failedRow: ActionFolderImportResultRow = {
            ...row,
            final_status: "failed",
            errors: [...(row.errors || []), { code: "import_failed", message }],
          };
          failed.push(failedRow);
          resultRows.push(failedRow);
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
      const previewRows = preview?.rows || [];
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
      setResult({
        ...nextResult,
        rows: resultRows,
        failed: resultRows.filter((row) => row.final_status === "failed"),
        not_selected: resultRows.filter((row) => row.final_status === "not_selected"),
      });
      setStage("result");
      await onImported();
    },
  });

  const rows = preview?.rows || [];
  const selectedRowList = rows.filter((row) => selectedRows.has(row.id));
  const selectedInvalidCount = selectedRowList.filter((row) => !rowIsValid(row)).length;
  const selectedWarningCount = selectedRowList.filter((row) => row.warnings?.length).length;
  const canImport = Boolean(preview && selectedRows.size && !selectedInvalidCount && !importMutation.isPending);
  const errorMessage = scanError || importMutation.error;
  const errorText = errorMessage instanceof Error ? errorMessage.message : errorMessage ? String(errorMessage) : "";

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

  async function buildPreviewFromFiles(files: File[], previousSelection: Set<string> | null = null) {
    setScanError("");
    const imageByStem = new Map<string, File[]>();
    const textByStem = new Map<string, File>();
    const existingNames = new Set(existingActionNames.map(normalizeName));
    const folderLabel = fileRelativePath(files[0] || new File([], "")).split(/[\\/]/)[0] || t("actionLibrary:bulkImportNoFolder");

    for (const file of files) {
      const relative = fileRelativePath(file);
      const parts = relative.split(/[\\/]/).filter(Boolean);
      if (parts.length > 2) continue;
      const ext = fileExt(file.name);
      const stem = fileStem(file.name);
      if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        const list = imageByStem.get(stem) || [];
        list.push(file);
        imageByStem.set(stem, list);
      } else if (ext === ".txt") {
        textByStem.set(stem, file);
      }
    }

    const stems = Array.from(new Set([...imageByStem.keys(), ...textByStem.keys()])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    const duplicateInBatch = new Set<string>();
    const seenNames = new Set<string>();
    const rows: ImportFileRow[] = [];

    for (const stem of stems) {
      const images = imageByStem.get(stem) || [];
      const textFile = textByStem.get(stem);
      const imageFile = images.length === 1 ? images[0] : undefined;
      const proposedName = normalizeName(stem);
      if (seenNames.has(proposedName)) duplicateInBatch.add(proposedName);
      seenNames.add(proposedName);
      const errors: ActionFolderImportIssue[] = [];
      const warnings: ActionFolderImportIssue[] = [];
      if (!images.length) errors.push({ code: "missing_image", message: "Missing matching image file" });
      if (images.length > 1) errors.push({ code: "ambiguous_image", message: "Multiple image files share the same filename stem" });
      if (!textFile) errors.push({ code: "missing_text", message: "Missing matching .txt file" });
      errors.push(...validateActionName(proposedName, existingNames));
      if (textFile) {
        try {
          const promptText = await readFileAsTextWithFallback(textFile);
          if (promptText.length > PROMPT_LIMIT) warnings.push({ code: "prompt_truncated", message: `Prompt is ${promptText.length} characters and will be truncated to ${PROMPT_LIMIT}` });
        } catch (error) {
          errors.push({ code: "unreadable_text", message: error instanceof Error ? error.message : String(error) });
        }
      }
      const id = rowIdFor(fileRelativePath(imageFile || textFile || new File([], stem)) || stem);
      rows.push({
        id,
        stem,
        filename: imageFile?.name || textFile?.name || stem,
        relative_path: fileRelativePath(imageFile || textFile || new File([], stem)) || stem,
        image_path: null,
        text_path: null,
        proposed_name: proposedName,
        thumbnail_url: imageFile ? URL.createObjectURL(imageFile) : "",
        selectable: true,
        selected: errors.length === 0,
        status: errors.length ? errors[0].code === "missing_image" ? "missing_image" : errors[0].code === "missing_text" ? "missing_text" : errors[0].code === "duplicate_name" ? "duplicate_name" : "invalid_name" : warnings.length ? "warning" : "ready",
        errors,
        warnings,
        imageFile,
        textFile,
      });
    }

    for (const row of rows) {
      if (duplicateInBatch.has(row.proposed_name)) {
        row.errors.push({ code: "duplicate_name", message: "Duplicate action name in selected folder" });
        row.status = "duplicate_name";
        row.selected = false;
      }
    }

    const nextPreview: ActionFolderImportPreview = {
      preview_id: `browser_${Date.now()}`,
      source_path: folderLabel,
      project_id: projectId,
      total_images: Array.from(imageByStem.values()).reduce((total, images) => total + images.length, 0),
      total_text_files: textByStem.size,
      ready_count: rows.filter(rowIsValid).length,
      selected_count: rows.filter((row) => row.selected).length,
      blocking_error_count: rows.filter((row) => row.errors.length).length,
      warning_count: rows.filter((row) => row.warnings.length).length,
      rows,
    };
    revokeRowObjectUrls(fileRows);
    setFileRows(rows);
    setPreview(nextPreview);
    setSourcePath(folderLabel);
    setStage("preview");
    setResult(null);
    setImportProgress({ completed: 0, total: 0 });
    setSelectedRows(new Set(rows.filter((row) => rowIsValid(row) && (previousSelection ? previousSelection.has(row.id) : row.selected)).map((row) => row.id)));
  }

  async function handleFolderInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    try {
      await buildPreviewFromFiles(files, preview ? selectedRows : null);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    }
  }

  function chooseFolder() {
    folderInputRef.current?.click();
  }

  function rescan() {
    folderInputRef.current?.click();
  }

  function toggleRow(row: ActionFolderImportRow) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  function selectValidRows() {
    setSelectedRows(new Set(rows.filter(rowIsValid).map((row) => row.id)));
  }

  function clearSelection() {
    setSelectedRows(new Set());
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

        <input ref={folderInputRef} type="file" multiple hidden onChange={handleFolderInputChange} {...{ webkitdirectory: "", directory: "" }} />

        <div className="action-folder-import__toolbar">
          <button className="model-lib-button" type="button" onClick={chooseFolder} disabled={importMutation.isPending}>
            <FolderOpen size={16} aria-hidden="true" />
            <span>{sourcePath ? t("actionLibrary:bulkImportChangeFolder") : t("actionLibrary:bulkImportChooseFolder")}</span>
          </button>
          <button className="model-lib-button" type="button" onClick={rescan} disabled={!sourcePath || importMutation.isPending}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>{t("actionLibrary:bulkImportRescan")}</span>
          </button>
          <div className="action-folder-import__path" title={preview?.source_path || sourcePath}>
            {preview?.source_path || sourcePath || t("actionLibrary:bulkImportNoFolder")}
          </div>
        </div>

        {errorText ? <div className="model-lib-error">{t("actionLibrary:requestFailed", { message: errorText })}</div> : null}

        {stage === "preview" ? (
          <>
            <div className="action-folder-import__summary">
              <span>{t("actionLibrary:bulkImportImages", { count: preview?.total_images || 0 })}</span>
              <span>{t("actionLibrary:bulkImportTexts", { count: preview?.total_text_files || 0 })}</span>
              <span>{t("actionLibrary:bulkImportSelected", { count: selectedRows.size })}</span>
              <span className={preview?.blocking_error_count ? "is-error" : ""}>{t("actionLibrary:bulkImportErrors", { count: preview?.blocking_error_count || 0 })}</span>
              <span className={selectedWarningCount ? "is-warning" : ""}>{t("actionLibrary:bulkImportWarnings", { count: selectedWarningCount })}</span>
            </div>

            <div className="action-folder-import__actions">
              <button className="model-lib-button" type="button" disabled={!rows.length} onClick={selectValidRows}>
                {t("actionLibrary:bulkImportSelectValid")}
              </button>
              <button className="model-lib-button" type="button" disabled={!rows.length} onClick={clearSelection}>
                {t("actionLibrary:bulkImportClearSelection")}
              </button>
            </div>

            <div className="action-folder-import__rows" role="list" aria-label={t("actionLibrary:bulkImportRows")}>
              {rows.map((row) => {
                const checked = selectedRows.has(row.id);
                const message = issueText(row);
                return (
                  <div key={row.id} className={`action-folder-import-row ${statusClass(row)}${checked ? " is-selected" : ""}`} role="listitem">
                    <label className="action-folder-import-row__check">
                      <input type="checkbox" checked={checked} onChange={() => toggleRow(row)} aria-label={t("actionLibrary:bulkImportToggleRow", { name: row.proposed_name || row.filename })} />
                    </label>
                    <div className="action-folder-import-row__thumb">
                      {row.thumbnail_url ? <img src={row.thumbnail_url} alt={row.proposed_name || row.filename} loading="lazy" /> : <span>{t("common:empty.noImage")}</span>}
                    </div>
                    <div className="action-folder-import-row__main">
                      <div className="action-folder-import-row__name" title={row.proposed_name || row.filename}>{row.proposed_name || row.filename}</div>
                      <div className="action-folder-import-row__meta" title={row.relative_path}>{row.relative_path}</div>
                      {message ? (
                        <div className="action-folder-import-row__message">
                          {row.errors?.length ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                          <span>{message}</span>
                        </div>
                      ) : null}
                    </div>
                    <span className="action-folder-import-row__status">{row.errors?.length ? t("actionLibrary:bulkImportStatusInvalid") : row.warnings?.length ? t("actionLibrary:bulkImportStatusWarning") : t("actionLibrary:bulkImportStatusReady")}</span>
                  </div>
                );
              })}
              {!preview ? <div className="action-folder-import__empty">{t("actionLibrary:bulkImportPickFolderFirst")}</div> : null}
            </div>

            <footer className="action-folder-import__footer">
              <span>{selectedInvalidCount ? t("actionLibrary:bulkImportSelectedInvalid", { count: selectedInvalidCount }) : t("actionLibrary:bulkImportReadyHint")}</span>
              <div>
                <button className="button secondary" type="button" onClick={onClose} disabled={importMutation.isPending}>{t("common:actions.cancel")}</button>
                <button className="button primary" type="button" disabled={!canImport} onClick={() => importMutation.mutate()}>
                  {importMutation.isPending
                    ? `${t("actionLibrary:bulkImportImporting")} ${importProgress.completed}/${importProgress.total}`
                    : t("actionLibrary:bulkImportStart")}
                </button>
              </div>
            </footer>
          </>
        ) : (
          <>
            <div className="action-folder-import__summary">
              <span>{t("actionLibrary:bulkImportResultImported", { count: resultTotals.imported })}</span>
              <span className={resultTotals.warning ? "is-warning" : ""}>{t("actionLibrary:bulkImportWarnings", { count: resultTotals.warning })}</span>
              <span className={resultTotals.failed ? "is-error" : ""}>{t("actionLibrary:bulkImportResultFailed", { count: resultTotals.failed })}</span>
              <span>{t("actionLibrary:bulkImportStatusNotSelected")} {resultTotals.notSelected}</span>
            </div>
            <div className="action-folder-import__rows" role="list" aria-label={t("actionLibrary:bulkImportResultRows")}>
              {(result?.rows || []).map((row) => (
                <div key={row.id} className={`action-folder-import-row ${row.final_status === "failed" ? "is-error" : row.final_status === "warning" ? "is-warning" : row.final_status === "not_selected" ? "is-muted" : "is-ready"}`} role="listitem">
                  <div className="action-folder-import-row__thumb">
                    {row.thumbnail_url ? <img src={row.thumbnail_url} alt={row.proposed_name || row.filename} loading="lazy" /> : <span>{t("common:empty.noImage")}</span>}
                  </div>
                  <div className="action-folder-import-row__main">
                    <div className="action-folder-import-row__name" title={row.proposed_name || row.filename}>{row.proposed_name || row.filename}</div>
                    <div className="action-folder-import-row__meta" title={row.relative_path}>{row.relative_path}</div>
                    {issueText(row) ? <div className="action-folder-import-row__message"><span>{issueText(row)}</span></div> : null}
                  </div>
                  <span className="action-folder-import-row__status">{finalStatusLabel(row.final_status, t)}</span>
                </div>
              ))}
            </div>
            <footer className="action-folder-import__footer">
              <span>{t("actionLibrary:bulkImportResultDone")}</span>
              <div>
                <button className="button primary" type="button" onClick={onClose}>{t("common:actions.close")}</button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
