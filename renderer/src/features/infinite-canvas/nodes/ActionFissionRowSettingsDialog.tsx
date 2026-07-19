import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FolderClosed, Images, Plus, Shuffle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppScrollArea } from "../../../components/AppScrollArea";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../../../components/ui/empty";
import { Skeleton } from "../../../components/ui/skeleton";
import { Switch } from "../../../components/ui/switch";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { actionLibraryKeys, listActionProjects, listActions, listActionTags } from "../../action-library/api";
import type { ActionEntry, ActionProject } from "../../action-library/types";
import {
  applySameColorSingleIncludeFilter,
  countLibraryTags,
  LibraryTagChoiceButton,
  toggleLibraryTagFilterInclude,
  useLibraryTagSettingsStore,
} from "../../library-tags";
import { createActionFissionCategoryGroup } from "../action-fission/actionFissionState";
import {
  MAX_ACTION_FISSION_CATEGORY_GROUPS,
  type ActionFissionCategoryGroup,
  type ActionFissionRow,
} from "../action-fission/actionFissionTypes";

interface ActionFissionRowSettingsDialogProps {
  open: boolean;
  row: ActionFissionRow | null;
  onOpenChange: (open: boolean) => void;
  onApply: (
    groups: ActionFissionCategoryGroup[],
    selection?: { groupId: string; action: ActionEntry | null },
  ) => void;
}

function ListSkeleton() {
  return (
    <div className="rf-action-fission-dialog-skeleton">
      {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
    </div>
  );
}

function cloneGroups(groups: readonly ActionFissionCategoryGroup[]) {
  return groups.map((group) => ({
    ...group,
    includeActionTagIds: [...group.includeActionTagIds],
    excludeActionTagIds: [...group.excludeActionTagIds],
  }));
}

export function ActionFissionRowSettingsDialog({
  open,
  row,
  onOpenChange,
  onApply,
}: ActionFissionRowSettingsDialogProps) {
  const { t } = useTranslation();
  const [draftGroups, setDraftGroups] = useState<ActionFissionCategoryGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [editingGroupId, setEditingGroupId] = useState("");
  const sameColorSingleFilter = useLibraryTagSettingsStore((state) => state.sameColorSingleFilter);
  const setSameColorSingleFilter = useLibraryTagSettingsStore((state) => state.setSameColorSingleFilter);
  const activeGroup = draftGroups.find((group) => group.id === activeGroupId) || draftGroups[0];
  const draftProjectId = activeGroup?.actionProjectId || "";
  const draftIncludeTagIds = activeGroup?.includeActionTagIds || [];
  const draftExcludeTagIds = activeGroup?.excludeActionTagIds || [];
  const draftActionId = row && activeGroup && row.selectedCategoryGroupId === activeGroup.id
    ? row.selectedActionId || ""
    : "";
  const draftTagFilter = useMemo(() => ({
    includeTagIds: draftIncludeTagIds,
    excludeTagIds: draftExcludeTagIds,
    untaggedOnly: false,
  }), [draftExcludeTagIds, draftIncludeTagIds]);
  const projectsQuery = useQuery({
    queryKey: actionLibraryKeys.projects,
    queryFn: listActionProjects,
    enabled: open,
  });
  const tagsQuery = useQuery({
    queryKey: actionLibraryKeys.tags(draftProjectId),
    queryFn: () => listActionTags(draftProjectId),
    enabled: open && Boolean(draftProjectId),
  });
  const actionsQuery = useQuery({
    queryKey: actionLibraryKeys.actions(draftProjectId, draftTagFilter),
    queryFn: () => listActions({ projectId: draftProjectId, tagFilter: draftTagFilter }),
    enabled: open && Boolean(draftProjectId),
  });
  const projects: ActionProject[] = projectsQuery.data?.projects || [];
  const draftTags = tagsQuery.data?.tags || [];
  const draftActions = actionsQuery.data?.actions || [];
  const draftTagCounts = useMemo(
    () => countLibraryTags(draftActions, draftTags),
    [draftActions, draftTags],
  );
  const includeTagSet = new Set(draftIncludeTagIds);
  const excludeTagSet = new Set(draftExcludeTagIds);

  useEffect(() => {
    if (!open || !row) return;
    const nextGroups = cloneGroups(row.categoryGroups);
    setDraftGroups(nextGroups);
    setActiveGroupId(nextGroups.find((group) => group.id === row.selectedCategoryGroupId)?.id || nextGroups[0].id);
    setEditingGroupId("");
  }, [open, row?.id]);

  const commitGroups = (
    nextGroups: ActionFissionCategoryGroup[],
    selection?: { groupId: string; action: ActionEntry | null },
  ) => {
    setDraftGroups(nextGroups);
    onApply(nextGroups, selection);
  };

  const patchActiveGroup = (
    patch: Partial<ActionFissionCategoryGroup>,
    selection?: { groupId: string; action: ActionEntry | null },
  ) => {
    if (!activeGroup) return;
    commitGroups(draftGroups.map((group) => group.id === activeGroup.id ? { ...group, ...patch } : group), selection);
  };

  const commitGroupName = (groupId: string, value: string) => {
    const name = value.trim();
    commitGroups(draftGroups.map((group) => group.id === groupId ? { ...group, name: name || undefined } : group));
    setEditingGroupId("");
  };

  const focusGroupNameEditor = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="rf-action-fission-settings-dialog nodrag nowheel"
        onWheel={(event) => event.stopPropagation()}
      >
        <DialogHeader className="rf-action-fission-dialog-header">
          <DialogTitle>{t("infiniteCanvas:actionFissionRowSettings")}</DialogTitle>
          <DialogDescription>{t("infiniteCanvas:actionFissionSettingsDescription")}</DialogDescription>
          <DialogClose asChild>
            <Button className="rf-action-fission-dialog-close" type="button" variant="ghost" size="icon-sm" aria-label={t("common:actions.close")} title={t("common:actions.close")}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>

        <section className="rf-action-fission-group-bar" aria-label={t("infiniteCanvas:actionFissionCategoryGroups")}>
          <AppScrollArea
            className="rf-action-fission-group-scroll"
            scrollbars="horizontal"
            scrollBarClassName="h-1 border-t-0 p-0"
          >
            <div className="rf-action-fission-group-list">
              {draftGroups.map((group, index) => {
                const selected = group.id === activeGroup?.id;
                const displayName = group.name || t("infiniteCanvas:actionFissionCategoryGroup", { index: index + 1 });
                return (
                  <div
                    key={group.id}
                    className="rf-action-fission-group-item"
                    data-selected={selected || undefined}
                  >
                    {editingGroupId === group.id ? (
                      <div
                        ref={focusGroupNameEditor}
                        className="rf-action-fission-group-editor"
                        contentEditable
                        suppressContentEditableWarning
                        role="textbox"
                        spellCheck={false}
                        aria-label={t("infiniteCanvas:actionFissionRenameCategoryGroup")}
                        onBlur={(event) => commitGroupName(group.id, event.currentTarget.textContent || "")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingGroupId("");
                          }
                        }}
                      >
                        {displayName}
                      </div>
                    ) : (
                      <Button
                        className="rf-action-fission-group-choice"
                        type="button"
                        variant={selected ? "default" : "outline"}
                        size="sm"
                        aria-pressed={selected}
                        title={displayName}
                        onClick={() => setActiveGroupId(group.id)}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          setActiveGroupId(group.id);
                          setEditingGroupId(group.id);
                        }}
                      >
                        <span>{displayName}</span>
                      </Button>
                    )}
                    {draftGroups.length > 1 ? (
                      <Button
                        className="rf-action-fission-group-delete"
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("infiniteCanvas:actionFissionDeleteCategoryGroup")}
                        title={t("infiniteCanvas:actionFissionDeleteCategoryGroup")}
                        onClick={() => {
                          const nextGroups = draftGroups.filter((item) => item.id !== group.id);
                          if (activeGroupId === group.id) setActiveGroupId(nextGroups[Math.min(index, nextGroups.length - 1)].id);
                          commitGroups(nextGroups);
                        }}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
              <Button
                className="rf-action-fission-group-add"
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={draftGroups.length >= MAX_ACTION_FISSION_CATEGORY_GROUPS}
                aria-label={t("infiniteCanvas:actionFissionAddCategoryGroup")}
                title={t("infiniteCanvas:actionFissionAddCategoryGroup")}
                onClick={() => {
                  const group = createActionFissionCategoryGroup();
                  const nextGroups = [...draftGroups, group];
                  setActiveGroupId(group.id);
                  commitGroups(nextGroups);
                }}
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
          </AppScrollArea>
        </section>

        <div className="rf-action-fission-settings-columns">
          <section className="rf-action-fission-settings-column">
            <header className="rf-action-fission-settings-column-header">
              <h3>{t("infiniteCanvas:actionFissionProjects")}</h3>
              <Badge variant="secondary">{projects.length}</Badge>
            </header>
            <AppScrollArea className="rf-action-fission-settings-scroll">
              <div className="rf-action-fission-project-list">
                {projects.map((project) => {
                  const selected = draftProjectId === project.id;
                  return (
                    <Button
                      key={project.id}
                      type="button"
                      variant={selected ? "default" : "ghost"}
                      className="rf-action-fission-project-choice"
                      aria-pressed={selected}
                      onClick={() => patchActiveGroup({
                        actionProjectId: project.id,
                        includeActionTagIds: [],
                        excludeActionTagIds: [],
                      })}
                    >
                      <span title={project.name}>{project.name}</span>
                      {selected ? <Check aria-hidden="true" /> : null}
                    </Button>
                  );
                })}
                {!projects.length ? (
                  <Empty className="rf-action-fission-dialog-empty">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><FolderClosed aria-hidden="true" /></EmptyMedia>
                      <EmptyTitle>{t("infiniteCanvas:actionFissionNoProjects")}</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                ) : null}
              </div>
            </AppScrollArea>
          </section>

          <section className="rf-action-fission-settings-column">
            <header className="rf-action-fission-settings-column-header">
              <h3>{t("infiniteCanvas:actionFissionTags")}</h3>
              <label className="rf-action-fission-tag-single-setting">
                <span>{t("common:labels.sameColorSingleFilter")}</span>
                <Switch
                  checked={sameColorSingleFilter}
                  onCheckedChange={(enabled) => {
                    setSameColorSingleFilter(enabled);
                    if (!enabled || !activeGroup) return;
                    const nextFilter = applySameColorSingleIncludeFilter(draftTagFilter, draftTags, true);
                    patchActiveGroup({
                      includeActionTagIds: nextFilter.includeTagIds,
                      excludeActionTagIds: nextFilter.excludeTagIds,
                    });
                  }}
                  aria-label={t("common:labels.sameColorSingleFilter")}
                />
              </label>
              <Badge variant="secondary">{draftTags.length}</Badge>
            </header>
            <AppScrollArea className="rf-action-fission-settings-scroll">
              {tagsQuery.isLoading ? <ListSkeleton /> : (
                <div className="rf-action-fission-settings-list">
                  <Button
                    type="button"
                    variant="outline"
                    className="rf-action-fission-any-tag justify-start"
                    data-selected={!draftIncludeTagIds.length && !draftExcludeTagIds.length}
                    aria-pressed={!draftIncludeTagIds.length && !draftExcludeTagIds.length}
                    onClick={() => patchActiveGroup({ includeActionTagIds: [], excludeActionTagIds: [] })}
                  >
                    {t("infiniteCanvas:actionFissionFilterAny")}
                  </Button>
                  {draftTags.map((tag) => (
                    <LibraryTagChoiceButton
                      key={tag.id}
                      name={tag.name}
                      color={tag.color}
                      count={draftTagCounts[tag.id] || 0}
                      included={includeTagSet.has(tag.id)}
                      excluded={excludeTagSet.has(tag.id)}
                      onToggleInclude={() => {
                        const nextFilter = toggleLibraryTagFilterInclude(
                          draftTagFilter,
                          tag.id,
                          draftTags,
                          sameColorSingleFilter,
                        );
                        patchActiveGroup({
                          includeActionTagIds: nextFilter.includeTagIds,
                          excludeActionTagIds: nextFilter.excludeTagIds,
                        });
                      }}
                      onToggleExclude={() => {
                        const nextIncludeTagIds = draftIncludeTagIds.filter((tagId) => tagId !== tag.id);
                        const nextExcludeTagIds = excludeTagSet.has(tag.id)
                          ? draftExcludeTagIds.filter((tagId) => tagId !== tag.id)
                          : [...draftExcludeTagIds, tag.id];
                        patchActiveGroup({
                          includeActionTagIds: nextIncludeTagIds,
                          excludeActionTagIds: nextExcludeTagIds,
                        });
                      }}
                    />
                  ))}
                  {!draftProjectId || (!draftTags.length && !tagsQuery.isLoading) ? (
                    <Empty className="rf-action-fission-dialog-empty">
                      <EmptyHeader>
                        <EmptyTitle>{t("infiniteCanvas:actionFissionNoTags")}</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  ) : null}
                </div>
              )}
            </AppScrollArea>
          </section>

          <section className="rf-action-fission-settings-column rf-action-fission-settings-column--actions">
            <header className="rf-action-fission-settings-column-header">
              <h3>{t("infiniteCanvas:actionFissionCandidates")}</h3>
              <Badge variant="secondary">{draftActions.length}</Badge>
            </header>
            <AppScrollArea className="rf-action-fission-settings-scroll">
              {actionsQuery.isLoading ? (
                <div className="rf-action-fission-action-grid">
                  {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="rf-action-fission-action-skeleton" />)}
                </div>
              ) : (
                <div className="rf-action-fission-action-grid">
                  <Button
                    type="button"
                    variant="outline"
                    className="rf-action-fission-action-choice rf-action-fission-action-choice--auto"
                    data-selected={!draftActionId}
                    aria-pressed={!draftActionId}
                    onClick={() => {
                      if (!activeGroup) return;
                      commitGroups(draftGroups, { groupId: activeGroup.id, action: null });
                    }}
                  >
                    <Shuffle aria-hidden="true" />
                    <span className="rf-action-fission-action-choice-label">{t("infiniteCanvas:actionFissionAutoAction")}</span>
                    {!draftActionId ? <span className="rf-action-fission-action-check"><Check aria-hidden="true" /></span> : null}
                  </Button>
                  {draftActions.map((action) => {
                    const selected = draftActionId === action.id;
                    const previewUrl = action.thumbnail_url || action.asset_url || "";
                    return (
                      <Button
                        key={action.id}
                        type="button"
                        variant="outline"
                        className="rf-action-fission-action-choice"
                        data-selected={selected}
                        aria-pressed={selected}
                        onClick={() => {
                          if (!activeGroup) return;
                          commitGroups(draftGroups, { groupId: activeGroup.id, action });
                        }}
                      >
                        <span className="rf-action-fission-action-choice-image">
                          {previewUrl
                            ? <img src={resolveLibraryImageUrl(previewUrl)} alt={action.name} draggable={false} />
                            : <Images aria-hidden="true" />}
                        </span>
                        <span className="rf-action-fission-action-choice-label" title={action.name}>{action.name}</span>
                        {selected ? <span className="rf-action-fission-action-check"><Check aria-hidden="true" /></span> : null}
                      </Button>
                    );
                  })}
                  {draftProjectId && !draftActions.length ? (
                    <Empty className="rf-action-fission-dialog-empty rf-action-fission-dialog-empty--actions">
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><Images aria-hidden="true" /></EmptyMedia>
                        <EmptyTitle>{t("infiniteCanvas:actionFissionNoCandidates")}</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  ) : null}
                </div>
              )}
            </AppScrollArea>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
