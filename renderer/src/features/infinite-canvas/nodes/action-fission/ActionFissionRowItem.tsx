import { ChevronDown, Copy, Download, Play, RefreshCw, Search, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { ErrorCopyLine } from "../../../../components/ErrorCopyLine";
import type { ActionEntry, ActionProject, ActionTag } from "../../../action-library/types";
import type { ApiProvider } from "../../../settings/apiProviders";
import { resolveLibraryImageUrl } from "../../../../lib/libraryImageActions";
import type { ActionFissionRow } from "../../action-fission/actionFissionTypes";
import { resolveActionFissionRowNotice } from "../../action-fission/actionFissionRowNotice";
import type { CanvasGenerationTask } from "../../types";
import { ActionFissionSelectorDialog } from "./ActionFissionSelectorDialog";

interface ActionFissionRowItemProps {
  nodeId: string;
  row: ActionFissionRow;
  tags: ActionTag[];
  actions: ActionEntry[];
  candidateCount: number;
  publicReferenceCount: number;
  publicReferenceLimit: number;
  selectedProvider: ApiProvider | null;
  selectedModel: string;
  projects: ActionProject[];
  openSelectId: string;
  onOpenSelectChange: (selectId: string) => void;
  onSetFilter: (rowId: string, projectId: string, includeTagIds: string[], excludeTagIds: string[]) => void;
  onRemoveRow: (rowId: string) => void | Promise<void>;
  onRefreshRow: (nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[]) => void;
  onRunRow: (nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[]) => void;
  onStopRow: (nodeId: string, rowId: string) => void;
  onPreviewResult: (row: ActionFissionRow) => void;
  onPreviewAction: (row: ActionFissionRow) => void;
  onDownloadResult: (row: ActionFissionRow) => void;
  onMediaStatus: (status: { nodeId: string; tone: "busy" | "ready" | "error"; text: string }) => void;
  isResultDownloadBusy: boolean;
  generationTask?: CanvasGenerationTask | null;
  isRowActive: boolean;
}

function rowSelectId(nodeId: string, rowId: string, name: string) {
  return `${nodeId}:${rowId}:${name}`;
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function ActionFissionRowItem({
  nodeId,
  row,
  tags,
  actions,
  candidateCount,
  publicReferenceCount,
  publicReferenceLimit,
  selectedProvider,
  selectedModel,
  projects,
  openSelectId,
  onOpenSelectChange,
  onSetFilter,
  onRemoveRow,
  onRefreshRow,
  onRunRow,
  onStopRow,
  onPreviewResult,
  onPreviewAction,
  onDownloadResult,
  onMediaStatus,
  isResultDownloadBusy,
  generationTask,
  isRowActive,
}: ActionFissionRowItemProps) {
  const { t } = useTranslation();
  const disabled = isRowActive;
  const resultAlt = row.resultFileName || row.selectedActionName || "action result";
  const promptPreview = row.selectedActionPrompt?.trim() || t("infiniteCanvas:actionFissionNoSelectedPrompt");
  const resultDisplayUrl = row.resultThumbUrl || row.resultUrl || "";
  const selectedActionImageUrl = resolveLibraryImageUrl(row.selectedActionAssetUrl || "");
  const [noticeNow, setNoticeNow] = useState(Date.now());
  const notice = resolveActionFissionRowNotice({
    row,
    selectedProvider,
    selectedModel,
    candidateCount,
    publicReferenceCount,
    publicReferenceLimit,
    activeTask: generationTask,
    isActive: isRowActive,
    now: noticeNow,
    t,
  });
  const selectorId = rowSelectId(nodeId, row.id, "selector");
  const selectorOpen = openSelectId === selectorId && !disabled;
  const selectedProject = projects.find((project) => project.id === row.actionProjectId) || null;
  const selectedTagNames = [
    ...row.includeActionTagIds
    .map((tagId) => tags.find((tag) => tag.id === tagId)?.name || "")
    .filter(Boolean),
    ...row.excludeActionTagIds
    .map((tagId) => tags.find((tag) => tag.id === tagId)?.name || "")
    .filter(Boolean)
    .map((name) => `不含 ${name}`),
  ];
  const promptButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptPositionRef = useRef("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptStyle, setPromptStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    if (!isRowActive) return;
    setNoticeNow(Date.now());
    const interval = window.setInterval(() => setNoticeNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isRowActive]);

  function updatePromptPosition() {
    const trigger = promptButtonRef.current;
    if (!trigger) return false;
    const rect = trigger.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      setPromptOpen(false);
      return false;
    }
    const width = 360;
    const viewportWidth = window.innerWidth || 0;
    const left = Math.max(10, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - 10));
    const top = rect.top - 8;
    const nextKey = `${Math.round(left)}:${Math.round(top)}`;
    if (promptPositionRef.current !== nextKey) {
      promptPositionRef.current = nextKey;
      setPromptStyle({ left, top, width, visibility: "visible" });
    }
    return true;
  }

  useLayoutEffect(() => {
    if (!promptOpen) {
      setPromptStyle({ visibility: "hidden" });
      promptPositionRef.current = "";
      return;
    }
    let frame = 0;
    updatePromptPosition();

    function trackPromptPosition() {
      if (updatePromptPosition()) frame = window.requestAnimationFrame(trackPromptPosition);
    }

    frame = window.requestAnimationFrame(trackPromptPosition);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      promptPositionRef.current = "";
      setPromptStyle({ visibility: "hidden" });
    };
  }, [promptOpen]);

  async function copySelectedPrompt() {
    const prompt = row.selectedActionPrompt?.trim();
    if (!prompt) return;
    try {
      await copyTextToClipboard(prompt);
      onMediaStatus({ nodeId: `action-fission-prompt:${nodeId}:${row.id}`, tone: "ready", text: t("infiniteCanvas:actionFissionPromptCopied") });
    } catch (error) {
      onMediaStatus({ nodeId: `action-fission-prompt:${nodeId}:${row.id}`, tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  const selectorDialog = selectorOpen ? (
    <ActionFissionSelectorDialog
      row={row}
      projects={projects}
      onClose={() => onOpenSelectChange("")}
      onApply={(projectId, includeTagIds, excludeTagIds) => {
        onSetFilter(row.id, projectId, includeTagIds, excludeTagIds);
        onOpenSelectChange("");
      }}
    />
  ) : null;
  const promptPanel = promptOpen && row.selectedActionPrompt ? createPortal(
    <div className="ic-action-fission-prompt-panel nodrag nopan nowheel" style={promptStyle} role="tooltip">
      {promptPreview}
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`ic-action-fission-row${isRowActive ? " is-running" : ""}${notice.visible && notice.tone === "error" ? " has-error" : ""}${notice.visible ? " has-message" : ""}`}>
      <button
        type="button"
        className="ic-action-fission-row__delete"
        aria-label={t("infiniteCanvas:actionFissionDeleteRow")}
        title={t("infiniteCanvas:actionFissionDeleteRow")}
        disabled={disabled}
        onClick={() => void onRemoveRow(row.id)}
      >
        <X size={13} aria-hidden="true" />
      </button>

      {row.resultUrl ? (
        <div
          role="button"
          tabIndex={0}
          className="ic-action-fission-result has-image nodrag nopan"
          aria-label={t("infiniteCanvas:viewLargeImage")}
          title={t("infiniteCanvas:viewLargeImage")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPreviewResult(row);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onPreviewResult(row);
          }}
        >
          <img
            src={resultDisplayUrl}
            alt={resultAlt}
            draggable={false}
          />
          <button
            className={`ic-image-download-button nodrag nopan${!isRowActive && row.resultDownloadState === "pending" ? " is-pending-download" : ""}`}
            type="button"
            aria-label={t("infiniteCanvas:downloadImage")}
            title={t("infiniteCanvas:downloadImage")}
            disabled={isResultDownloadBusy}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDownloadResult(row);
            }}
          >
            <Download size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="ic-action-fission-result">
          <span>{t("infiniteCanvas:actionFissionNoResult")}</span>
        </div>
      )}

      <div className="ic-action-fission-row__main">
        <div className="ic-action-fission-row__config">
          <button
            type="button"
            className="ic-action-fission-filter-button"
            aria-expanded={selectorOpen}
            disabled={disabled}
            onClick={() => onOpenSelectChange(selectorOpen ? "" : selectorId)}
          >
            <span className="ic-action-fission-filter-button__project">{selectedProject?.name || t("common:labels.selectProjectFirst")}</span>
            <span className="ic-action-fission-filter-button__tags">{selectedTagNames.length ? selectedTagNames.join(" / ") : "全部标签"}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <div className="ic-action-fission-selected-action" title={row.selectedActionName || ""}>
            {row.selectedActionName || t("infiniteCanvas:actionFissionSelectActionFirst")}
          </div>

          <div className="ic-action-fission-row__tools">
            <button
              ref={promptButtonRef}
              type="button"
              className="ic-action-fission-prompt-button"
              disabled={disabled || !row.selectedActionPrompt}
              aria-label={t("infiniteCanvas:actionFissionCopyPrompt")}
              title={t("infiniteCanvas:actionFissionCopyPrompt")}
              onPointerEnter={() => {
                if (row.selectedActionPrompt) setPromptOpen(true);
              }}
              onPointerLeave={() => setPromptOpen(false)}
              onFocus={() => {
                if (row.selectedActionPrompt) setPromptOpen(true);
              }}
              onBlur={() => setPromptOpen(false)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void copySelectedPrompt();
              }}
            >
              <Search className="ic-action-fission-prompt-button__view-icon" size={13} aria-hidden="true" />
              <Copy className="ic-action-fission-prompt-button__copy-icon" size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={disabled || !row.actionProjectId}
              onClick={() => onRefreshRow(nodeId, row.id, actions, tags)}
            >
              <RefreshCw size={12} aria-hidden="true" />
              <span>{t("infiniteCanvas:actionFissionRefreshAction")}</span>
            </button>
            <button type="button" disabled={disabled}>
              <span>手动输入</span>
            </button>
          </div>

          {selectorDialog}
          {promptPanel}
        </div>

        <div
          className={`ic-action-fission-action-preview${row.selectedActionAssetUrl ? " has-image nodrag nopan" : ""}`}
          role={row.selectedActionAssetUrl ? "button" : undefined}
          tabIndex={row.selectedActionAssetUrl ? 0 : undefined}
          aria-label={row.selectedActionAssetUrl ? t("infiniteCanvas:viewLargeImage") : undefined}
          title={row.selectedActionAssetUrl ? t("infiniteCanvas:viewLargeImage") : undefined}
          onPointerDown={(event) => {
            if (row.selectedActionAssetUrl) event.stopPropagation();
          }}
          onClick={(event) => {
            if (!row.selectedActionAssetUrl) return;
            event.preventDefault();
            event.stopPropagation();
            onPreviewAction(row);
          }}
          onKeyDown={(event) => {
            if (!row.selectedActionAssetUrl || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            onPreviewAction(row);
          }}
        >
          {selectedActionImageUrl ? (
            <img
              src={selectedActionImageUrl}
              alt={row.selectedActionName || "action preview"}
              draggable={false}
            />
          ) : <span>动作<br />预览图</span>}
        </div>
      </div>

      <div className="ic-action-fission-row__actions">
        <button
          type="button"
          className={isRowActive ? "is-stop" : ""}
          aria-label={isRowActive ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")}
          title={isRowActive ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")}
          disabled={!isRowActive && !row.actionProjectId}
          onClick={() => (isRowActive ? onStopRow(nodeId, row.id) : onRunRow(nodeId, row.id, actions, tags))}
        >
          {isRowActive ? <Square size={14} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
          <span>{isRowActive ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")}</span>
        </button>
      </div>

      {notice.visible && notice.tone === "error" ? (
        <ErrorCopyLine className="ic-action-fission-row__message is-error" text={notice.text} />
      ) : notice.visible ? (
        <div className={`ic-action-fission-row__message is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}
