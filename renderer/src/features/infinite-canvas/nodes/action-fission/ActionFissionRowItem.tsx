import { Check, ChevronDown, Copy, Download, Play, RefreshCw, Search, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import type { ActionEntry, ActionProject, ActionTag } from "../../../action-library/types";
import type { ApiProvider } from "../../../settings/apiProviders";
import type { ActionFissionRow } from "../../action-fission/actionFissionTypes";
import { resolveActionFissionRowNotice } from "../../action-fission/actionFissionRowNotice";
import type { CanvasGenerationTask } from "../../types";

interface ActionFissionRowItemProps {
  nodeId: string;
  row: ActionFissionRow;
  tags: ActionTag[];
  actions: ActionEntry[];
  candidates: ActionEntry[];
  candidateCount: number;
  publicReferenceCount: number;
  publicReferenceLimit: number;
  selectedProvider: ApiProvider | null;
  selectedModel: string;
  projects: ActionProject[];
  openSelectId: string;
  onOpenSelectChange: (selectId: string) => void;
  onSetProject: (rowId: string, projectId: string) => void;
  onSetTags: (rowId: string, tagIds: string[]) => void;
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

function clampPanelLeft(left: number, width: number) {
  const viewportWidth = window.innerWidth || 0;
  return Math.max(10, Math.min(left, viewportWidth - width - 10));
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
  candidates,
  candidateCount,
  publicReferenceCount,
  publicReferenceLimit,
  selectedProvider,
  selectedModel,
  projects,
  openSelectId,
  onOpenSelectChange,
  onSetProject,
  onSetTags,
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
  const selectedTagNames = row.actionTagIds
    .map((tagId) => tags.find((tag) => tag.id === tagId)?.name || "")
    .filter(Boolean);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelPositionRef = useRef("");
  const promptButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptPositionRef = useRef("");
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptStyle, setPromptStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    if (!isRowActive) return;
    setNoticeNow(Date.now());
    const interval = window.setInterval(() => setNoticeNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isRowActive]);

  function updatePanelPosition() {
    const trigger = triggerRef.current;
    if (!trigger) return false;
    const rect = trigger.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      onOpenSelectChange("");
      return false;
    }
    const width = Math.max(420, rect.width);
    const viewportHeight = window.innerHeight || 0;
    const below = viewportHeight - rect.bottom - 10;
    const maxHeight = Math.min(360, Math.max(220, below));
    const left = clampPanelLeft(rect.left, width);
    const top = rect.bottom + 8;
    const nextStyle: CSSProperties = {
      left,
      top,
      width,
      maxHeight,
      visibility: "visible",
    };
    const nextKey = `${Math.round(left)}:${Math.round(top)}:${Math.round(width)}:${Math.round(maxHeight)}`;
    if (panelPositionRef.current !== nextKey) {
      panelPositionRef.current = nextKey;
      setPanelStyle(nextStyle);
    }
    return true;
  }

  useLayoutEffect(() => {
    if (!selectorOpen) {
      setPanelStyle({ visibility: "hidden" });
      panelPositionRef.current = "";
      return;
    }
    let frame = 0;
    updatePanelPosition();

    function trackPanelPosition() {
      if (updatePanelPosition()) frame = window.requestAnimationFrame(trackPanelPosition);
    }

    frame = window.requestAnimationFrame(trackPanelPosition);

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || panelRef.current?.contains(target))) return;
      onOpenSelectChange("");
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onOpenSelectChange("");
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      panelPositionRef.current = "";
      setPanelStyle({ visibility: "hidden" });
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [selectorOpen, onOpenSelectChange]);

  function updatePromptPosition() {
    const trigger = promptButtonRef.current;
    if (!trigger) return false;
    const rect = trigger.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      setPromptOpen(false);
      return false;
    }
    const width = 360;
    const left = clampPanelLeft(rect.left + rect.width / 2 - width / 2, width);
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

  const selectorPanel = selectorOpen ? createPortal(
    <div
      ref={panelRef}
      className="ic-action-fission-selector-panel nodrag nopan nowheel"
      style={panelStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="ic-action-fission-selector-panel__section ic-action-fission-selector-panel__projects-section">
        <span className="ic-action-fission-selector-panel__label">选择项目</span>
        <div className="ic-action-fission-selector-panel__projects">
          {projects.length ? projects.map((project) => {
            const selected = project.id === row.actionProjectId;
            return (
              <button
                key={project.id}
                type="button"
                className={selected ? "selected" : ""}
                aria-pressed={selected}
                onClick={() => onSetProject(row.id, project.id)}
              >
                <span>{project.name}</span>
                {selected ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          }) : <span className="ic-action-fission-selector-panel__empty">{t("common:empty.noProjects")}</span>}
        </div>
      </div>

      <div className="ic-action-fission-selector-panel__right">
        <div className="ic-action-fission-selector-panel__section">
          <span className="ic-action-fission-selector-panel__label">选择标签</span>
          <div className="ic-action-fission-selector-panel__tags">
            {row.actionProjectId && tags.length ? tags.map((tag) => {
              const selected = row.actionTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  onClick={() => {
                    const nextTags = selected
                      ? row.actionTagIds.filter((tagId) => tagId !== tag.id)
                      : [...row.actionTagIds, tag.id];
                    onSetTags(row.id, nextTags);
                  }}
                >
                  {tag.name}
                </button>
              );
            }) : <span className="ic-action-fission-selector-panel__empty">{row.actionProjectId ? "暂无标签" : "先选择项目"}</span>}
          </div>
        </div>

        <div className="ic-action-fission-selector-panel__section ic-action-fission-selector-panel__results">
          <span className="ic-action-fission-selector-panel__label">筛选结果 · {candidateCount}</span>
          <div className="ic-action-fission-selector-panel__result-list">
            {candidates.length ? candidates.slice(0, 12).map((action) => (
              <div key={action.id} className="ic-action-fission-selector-panel__result" title={action.name}>
                {action.asset_url ? (
                  <img
                    src={action.asset_url}
                    alt={action.name}
                    draggable={false}
                  />
                ) : null}
              </div>
            )) : <span className="ic-action-fission-selector-panel__empty">{row.actionProjectId ? t("infiniteCanvas:actionFissionNoCandidates") : "先选择项目"}</span>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
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
            src={row.resultUrl}
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
            ref={triggerRef}
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

          {selectorPanel}
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
          {row.selectedActionAssetUrl ? (
            <img
              src={row.selectedActionAssetUrl}
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

      {notice.visible ? (
        <div className={`ic-action-fission-row__message is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}
