import { Ban, Check, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { actionLibraryKeys, listActions, listActionTags } from "../../../action-library/api";
import type { ActionEntry, ActionProject, ActionTag } from "../../../action-library/types";
import { resolveLibraryImageUrl } from "../../../../lib/libraryImageActions";
import { createLibraryTagFilterWithSameColorInclude, countLibraryTags, normalizeLibraryTagColor, useLibraryTagSettingsStore } from "../../../library-tags";
import { filterActionsForRow } from "../../action-fission/actionFissionActions";
import type { ActionFissionRow } from "../../action-fission/actionFissionTypes";

interface ActionFissionSelectorDialogProps {
  row: ActionFissionRow;
  projects: ActionProject[];
  onClose: () => void;
  onApply: (projectId: string, includeTagIds: string[], excludeTagIds: string[]) => void;
}

type TagMode = "any" | "include" | "exclude";

function modeForTag(tagId: string, includeTagIds: string[], excludeTagIds: string[]): TagMode {
  if (includeTagIds.includes(tagId)) return "include";
  if (excludeTagIds.includes(tagId)) return "exclude";
  return "any";
}

function modeLabel(mode: TagMode) {
  if (mode === "include") return "包含";
  if (mode === "exclude") return "排除";
  return "不限";
}

function filterPreviewActions(projectId: string, includeTagIds: string[], excludeTagIds: string[], actions: ActionEntry[], tags: ActionTag[]) {
  return filterActionsForRow({
    id: "preview",
    actionProjectId: projectId,
    includeActionTagIds: includeTagIds,
    excludeActionTagIds: excludeTagIds,
  }, actions, tags);
}

export function ActionFissionSelectorDialog({ row, projects, onClose, onApply }: ActionFissionSelectorDialogProps) {
  const { t } = useTranslation();
  const fallbackProjectId = row.actionProjectId || projects[0]?.id || "";
  const [projectId, setProjectId] = useState(fallbackProjectId);
  const [includeTagIds, setIncludeTagIds] = useState(row.actionProjectId === fallbackProjectId ? row.includeActionTagIds : []);
  const [excludeTagIds, setExcludeTagIds] = useState(row.actionProjectId === fallbackProjectId ? row.excludeActionTagIds : []);
  const sameColorSingleFilter = useLibraryTagSettingsStore((state) => state.sameColorSingleFilter);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const [tagsQuery, actionsQuery] = useQueries({
    queries: [
      {
        queryKey: actionLibraryKeys.tags(projectId),
        queryFn: () => listActionTags(projectId),
        enabled: Boolean(projectId),
      },
      {
        queryKey: actionLibraryKeys.actions(projectId),
        queryFn: () => listActions({ projectId }),
        enabled: Boolean(projectId),
      },
    ],
  });
  const tags = tagsQuery.data?.tags || [];
  const actions = actionsQuery.data?.actions || [];
  const candidates = useMemo(
    () => filterPreviewActions(projectId, includeTagIds, excludeTagIds, actions, tags),
    [actions, excludeTagIds, includeTagIds, projectId, tags],
  );
  const tagCounts = useMemo(() => countLibraryTags(candidates, tags), [candidates, tags]);
  const selectedProject = projects.find((project) => project.id === projectId) || null;

  useEffect(() => {
    if (!sameColorSingleFilter) return;
    const nextFilter = createLibraryTagFilterWithSameColorInclude(includeTagIds, excludeTagIds, tags, true);
    if (nextFilter.includeTagIds.length !== includeTagIds.length || nextFilter.excludeTagIds.length !== excludeTagIds.length) {
      setIncludeTagIds(nextFilter.includeTagIds);
      setExcludeTagIds(nextFilter.excludeTagIds);
    }
  }, [excludeTagIds, includeTagIds, sameColorSingleFilter, tags]);

  function chooseProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    setIncludeTagIds([]);
    setExcludeTagIds([]);
  }

  function toggleIncludeTag(tagId: string) {
    const currentMode = modeForTag(tagId, includeTagIds, excludeTagIds);
    const cleanedIncludeTagIds = includeTagIds.filter((id) => id !== tagId);
    const nextIncludeTagIds = currentMode === "include" ? cleanedIncludeTagIds : [...cleanedIncludeTagIds, tagId];
    const nextFilter = createLibraryTagFilterWithSameColorInclude(
      nextIncludeTagIds,
      excludeTagIds.filter((id) => id !== tagId),
      tags,
      sameColorSingleFilter,
    );
    setIncludeTagIds(nextFilter.includeTagIds);
    setExcludeTagIds(nextFilter.excludeTagIds);
  }

  function toggleExcludeTag(tagId: string) {
    const currentMode = modeForTag(tagId, includeTagIds, excludeTagIds);
    setExcludeTagIds((current) => {
      const cleaned = current.filter((id) => id !== tagId);
      return currentMode === "exclude" ? cleaned : [...cleaned, tagId];
    });
    setIncludeTagIds((current) => {
      return current.filter((id) => id !== tagId);
    });
  }

  function applySelection() {
    if (!projectId) return;
    onApply(projectId, includeTagIds, excludeTagIds);
  }

  const dialog = (
    <div className="ic-action-fission-dialog-backdrop nodrag nopan nowheel" onPointerDown={onClose}>
      <div
        className="ic-action-fission-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="动作分类选择"
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="ic-action-fission-dialog__header">
          <div>
            <h3>动作分类选择</h3>
            <p>{selectedProject?.name || t("common:labels.selectProjectFirst")}</p>
          </div>
          <button type="button" className="ic-action-fission-dialog__icon-button" aria-label="关闭" title="关闭" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="ic-action-fission-dialog__body">
          <section className="ic-action-fission-dialog__projects" aria-label="选择项目">
            <div className="ic-action-fission-dialog__section-head">
              <span>动作项目</span>
              <small>{projects.length}</small>
            </div>
            <div className="ic-action-fission-dialog__project-list scrollbar-thin-stable">
              {projects.length ? projects.map((project) => {
                const selected = project.id === projectId;
                return (
                  <button key={project.id} type="button" className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => chooseProject(project.id)}>
                    <span>{project.name}</span>
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                );
              }) : <span className="ic-action-fission-dialog__empty">{t("common:empty.noProjects")}</span>}
            </div>
          </section>

          <section className="ic-action-fission-dialog__tags" aria-label="选择标签">
            <div className="ic-action-fission-dialog__section-head">
              <span>标签分类</span>
              <small>{tags.length}</small>
            </div>
            <div className="ic-action-fission-dialog__tag-grid scrollbar-thin-stable">
              {projectId && tags.length ? tags.map((tag) => {
                const mode = modeForTag(tag.id, includeTagIds, excludeTagIds);
                const count = tagCounts[tag.id] || 0;
                const disabled = count <= 0 && mode === "any";
                return (
                  <div
                    key={tag.id}
                    className={`ic-action-fission-dialog__tag is-${mode}${disabled ? " is-empty" : ""}`}
                  >
                    <span className={`ic-action-fission-dialog__tag-color library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
                    <button
                      type="button"
                      className="ic-action-fission-dialog__tag-main"
                      aria-pressed={mode === "include"}
                      aria-disabled={disabled || undefined}
                      disabled={disabled}
                      onClick={() => toggleIncludeTag(tag.id)}
                    >
                      <span className="ic-action-fission-dialog__tag-name">{tag.name}</span>
                      <span className="ic-action-fission-dialog__tag-meta">
                        <span>{modeLabel(mode)}</span>
                      </span>
                    </button>
                    <span className="ic-action-fission-dialog__tag-count">{count}</span>
                    <button
                      type="button"
                      className="ic-action-fission-dialog__tag-exclude"
                      aria-pressed={mode === "exclude"}
                      aria-disabled={disabled || undefined}
                      aria-label={`排除 ${tag.name}`}
                      title={`排除 ${tag.name}`}
                      disabled={disabled}
                      onClick={() => toggleExcludeTag(tag.id)}
                    >
                      <Ban size={12} aria-hidden="true" />
                    </button>
                  </div>
                );
              }) : <span className="ic-action-fission-dialog__empty">{projectId ? "暂无标签" : "先选择项目"}</span>}
            </div>
          </section>

          <section className="ic-action-fission-dialog__preview" aria-label="候选动作">
            <div className="ic-action-fission-dialog__section-head">
              <span>候选动作</span>
              <small>{candidates.length}</small>
            </div>
            <div className="ic-action-fission-dialog__preview-grid scrollbar-stable">
              {candidates.length ? candidates.map((action) => {
                const imageUrl = resolveLibraryImageUrl(action.asset_url || "");
                return (
                  <div key={action.id} className="ic-action-fission-dialog__preview-card" title={action.name}>
                    {imageUrl ? <img src={imageUrl} alt={action.name} draggable={false} /> : null}
                    <span>{action.name}</span>
                  </div>
                );
              }) : <span className="ic-action-fission-dialog__empty">{projectId ? t("infiniteCanvas:actionFissionNoCandidates") : "先选择项目"}</span>}
            </div>
          </section>
        </div>

        <div className="ic-action-fission-dialog__footer">
          <button
            type="button"
            className="ic-action-fission-dialog__secondary"
            disabled={!includeTagIds.length && !excludeTagIds.length}
            onClick={() => {
              setIncludeTagIds([]);
              setExcludeTagIds([]);
            }}
          >
            清空筛选
          </button>
          <div>
            <button type="button" className="ic-action-fission-dialog__secondary" onClick={onClose}>取消</button>
            <button type="button" className="ic-action-fission-dialog__primary" disabled={!projectId} onClick={applySelection}>应用并切换动作</button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
