import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FolderClosed, Images, Shuffle, X } from "lucide-react";
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
  LibraryTagChoiceButton,
  toggleLibraryTagFilterInclude,
  useLibraryTagSettingsStore,
} from "../../library-tags";
import type { ActionFissionRow } from "../action-fission/actionFissionTypes";

interface ActionFissionRowSettingsDialogProps {
  open: boolean;
  row: ActionFissionRow | null;
  onOpenChange: (open: boolean) => void;
  onApply: (
    projectId: string,
    includeTagIds: string[],
    excludeTagIds: string[],
    selectedAction: ActionEntry | null,
  ) => void;
}

function ListSkeleton() {
  return (
    <div className="rf-action-fission-dialog-skeleton">
      {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
    </div>
  );
}

export function ActionFissionRowSettingsDialog({
  open,
  row,
  onOpenChange,
  onApply,
}: ActionFissionRowSettingsDialogProps) {
  const { t } = useTranslation();
  const [draftProjectId, setDraftProjectId] = useState("");
  const [draftIncludeTagIds, setDraftIncludeTagIds] = useState<string[]>([]);
  const [draftExcludeTagIds, setDraftExcludeTagIds] = useState<string[]>([]);
  const [draftActionId, setDraftActionId] = useState("");
  const sameColorSingleFilter = useLibraryTagSettingsStore((state) => state.sameColorSingleFilter);
  const setSameColorSingleFilter = useLibraryTagSettingsStore((state) => state.setSameColorSingleFilter);
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
  const includeTagSet = new Set(draftIncludeTagIds);
  const excludeTagSet = new Set(draftExcludeTagIds);

  useEffect(() => {
    if (!open || !row) return;
    setDraftProjectId(row.actionProjectId);
    setDraftIncludeTagIds(row.includeActionTagIds);
    setDraftExcludeTagIds(row.excludeActionTagIds);
    setDraftActionId(row.selectedActionId || "");
  }, [open, row?.id]);

  const clearActionSelection = () => setDraftActionId("");
  const saveConfig = (
    projectId: string,
    includeTagIds: string[],
    excludeTagIds: string[],
    actionId = "",
  ) => {
    onApply(
      projectId,
      includeTagIds,
      excludeTagIds,
      draftActions.find((action) => action.id === actionId) || null,
    );
  };

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
                      onClick={() => {
                        setDraftProjectId(project.id);
                        setDraftIncludeTagIds([]);
                        setDraftExcludeTagIds([]);
                        clearActionSelection();
                        saveConfig(project.id, [], []);
                      }}
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
                    if (!enabled) return;
                    const nextFilter = applySameColorSingleIncludeFilter(draftTagFilter, draftTags, true);
                    setDraftIncludeTagIds(nextFilter.includeTagIds);
                    setDraftExcludeTagIds(nextFilter.excludeTagIds);
                    clearActionSelection();
                    saveConfig(draftProjectId, nextFilter.includeTagIds, nextFilter.excludeTagIds);
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
                    onClick={() => {
                      setDraftIncludeTagIds([]);
                      setDraftExcludeTagIds([]);
                      clearActionSelection();
                      saveConfig(draftProjectId, [], []);
                    }}
                  >
                    {t("infiniteCanvas:actionFissionFilterAny")}
                  </Button>
                  {draftTags.map((tag) => (
                    <LibraryTagChoiceButton
                      key={tag.id}
                      name={tag.name}
                      color={tag.color}
                      count={tag.usage_count}
                      included={includeTagSet.has(tag.id)}
                      excluded={excludeTagSet.has(tag.id)}
                      onToggleInclude={() => {
                        const nextFilter = toggleLibraryTagFilterInclude(
                          draftTagFilter,
                          tag.id,
                          draftTags,
                          sameColorSingleFilter,
                        );
                        setDraftIncludeTagIds(nextFilter.includeTagIds);
                        setDraftExcludeTagIds(nextFilter.excludeTagIds);
                        clearActionSelection();
                        saveConfig(draftProjectId, nextFilter.includeTagIds, nextFilter.excludeTagIds);
                      }}
                      onToggleExclude={() => {
                        const nextIncludeTagIds = draftIncludeTagIds.filter((tagId) => tagId !== tag.id);
                        const nextExcludeTagIds = excludeTagSet.has(tag.id)
                          ? draftExcludeTagIds.filter((tagId) => tagId !== tag.id)
                          : [...draftExcludeTagIds, tag.id];
                        setDraftIncludeTagIds(nextIncludeTagIds);
                        setDraftExcludeTagIds(nextExcludeTagIds);
                        clearActionSelection();
                        saveConfig(draftProjectId, nextIncludeTagIds, nextExcludeTagIds);
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
                  {Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} className="rf-action-fission-action-skeleton" />
                  ))}
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
                      clearActionSelection();
                      saveConfig(draftProjectId, draftIncludeTagIds, draftExcludeTagIds);
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
                          setDraftActionId(action.id);
                          saveConfig(draftProjectId, draftIncludeTagIds, draftExcludeTagIds, action.id);
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
