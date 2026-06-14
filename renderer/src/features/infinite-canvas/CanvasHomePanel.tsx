import { ChevronDown, Download, Layers, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LibtvImportProgress, LibtvProjectRecord } from "../../app/appConfig";
import type { CanvasProjectRecord } from "./types";

export type CanvasHomeMode = "local" | "libtv";
export type CanvasSortMode = "recent" | "name";

export type LibtvImportCardRecord = CanvasProjectRecord & {
  isLibtvImporting: true;
  libtvProjectId: string;
  libtvImportProgress: LibtvImportProgress | null;
};

export type HomeCanvasRecord = CanvasProjectRecord | LibtvImportCardRecord;

interface CanvasHomePanelProps {
  mode: CanvasHomeMode;
  projects: HomeCanvasRecord[];
  selectedProjectId: string;
  renamingProjectId: string;
  renamingTitle: string;
  confirmingDeleteProjectId: string;
  sortMode: CanvasSortMode;
  projectStatus: string;
  libtvProjectResults: LibtvProjectRecord[];
  libtvProjectFilter: string;
  libtvImporting: boolean;
  selectedLibtvProjectUuid: string;
  onModeChange: (mode: CanvasHomeMode) => void;
  onOpenLibtvHome: () => void;
  onRefreshLocal: () => void;
  onCreateCanvas: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onStartRename: (projectId: string, title: string) => void;
  onCancelRename: () => void;
  onRenamingTitleChange: (title: string) => void;
  onSubmitRename: (projectId: string) => void;
  onConfirmDelete: (projectId: string) => void;
  onCancelDelete: () => void;
  onDeleteProject: (projectId: string) => void;
  onSortModeChange: (mode: CanvasSortMode) => void;
  onRefreshLibtvProjects: () => void;
  onLibtvProjectFilterChange: (value: string) => void;
  onSelectLibtvProject: (projectUuid: string) => void;
  onImportLibtvProject: (projectUuid: string) => void;
}

function isLibtvImportCard(project: HomeCanvasRecord): project is LibtvImportCardRecord {
  return "isLibtvImporting" in project && project.isLibtvImporting;
}

function getLibtvImportProgressPercent(progress: LibtvImportProgress | null | undefined) {
  if (!progress) return 0;
  const current = Number(progress.current || 0);
  const total = Number(progress.total || 0);
  const detailRatio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  if (progress.stage === "loadingProject") return 12;
  if (progress.stage === "loadingNodeDetails") return Math.round(16 + detailRatio * 72);
  if (progress.stage === "mappingNodes") return 92;
  if (progress.stage === "creatingCanvas") return 96;
  if (progress.stage === "done") return 100;
  return 0;
}

function formatLibtvProgressValue(progress: LibtvImportProgress | null | undefined) {
  const percent = getLibtvImportProgressPercent(progress);
  const current = Number(progress?.current || 0);
  const total = Number(progress?.total || 0);
  return total > 0 ? `${percent}% - ${Math.min(current, total)} / ${total}` : `${percent}%`;
}

function LibtvLogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={Math.round(size * 0.68)} fill="currentColor" viewBox="0 0 25.206 16.616" aria-hidden="true" focusable="false">
      <path d="M16.576 16.616H0l.833-4.418H17.65z" />
      <path d="m0 16.616 2.314-12.27h4.448l-2.316 12.27zM8.27 0h16.936l-.832 4.416H7.544z" />
      <path d="m25.206 0-2.314 12.27-4.512.002L20.76 0z" />
    </svg>
  );
}

function formatProjectDate(timestamp: number) {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function CanvasHomePanel({
  mode,
  projects,
  selectedProjectId,
  renamingProjectId,
  renamingTitle,
  confirmingDeleteProjectId,
  sortMode,
  projectStatus,
  libtvProjectResults,
  libtvProjectFilter,
  libtvImporting,
  selectedLibtvProjectUuid,
  onModeChange,
  onOpenLibtvHome,
  onRefreshLocal,
  onCreateCanvas,
  onSelectProject,
  onOpenProject,
  onStartRename,
  onCancelRename,
  onRenamingTitleChange,
  onSubmitRename,
  onConfirmDelete,
  onCancelDelete,
  onDeleteProject,
  onSortModeChange,
  onRefreshLibtvProjects,
  onLibtvProjectFilterChange,
  onSelectLibtvProject,
  onImportLibtvProject,
}: CanvasHomePanelProps) {
  const { t } = useTranslation();
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || projects[0] || null;
  const filteredLibtvProjects = libtvProjectResults.filter((project) => {
    const query = libtvProjectFilter.trim().toLowerCase();
    if (!query) return true;
    return String(project.name || "").toLowerCase().includes(query);
  });

  const renderLibtvResults = () => (
    <>
      {filteredLibtvProjects.length ? (
        <div className="ic-libtv-project-results ic-libtv-project-card-grid" aria-label={t("infiniteCanvas.libtvProjectResults")}>
          {filteredLibtvProjects.map((project) => (
            <article
              key={project.uuid}
              className={`ic-project-card ic-libtv-project-card${selectedLibtvProjectUuid === project.uuid ? " active" : ""}`}
              onClick={() => onSelectLibtvProject(project.uuid)}
              onDoubleClick={() => onImportLibtvProject(project.uuid)}
            >
              <button className="ic-project-card__main" type="button" onClick={() => onSelectLibtvProject(project.uuid)}>
                <small>{project.teamId ? t("infiniteCanvas.libtvTeamProject", { teamId: project.teamId }) : t("infiniteCanvas.libtvPersonalProject")}</small>
                <strong title={project.name || t("infiniteCanvas.untitledCanvas")}>{project.name || t("infiniteCanvas.untitledCanvas")}</strong>
                <small>{project.updatedAtMs ? formatProjectDate(project.updatedAtMs) : "--"}</small>
              </button>
              <button
                type="button"
                className="ic-libtv-project-card__import"
                aria-label={t("infiniteCanvas.libtvImportCanvas")}
                title={t("infiniteCanvas.libtvImportCanvas")}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onImportLibtvProject(project.uuid);
                }}
              >
                <Download size={15} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="ic-project-empty">{libtvImporting ? t("infiniteCanvas.libtvSearchingProjects") : t("infiniteCanvas.libtvNoProjectsFound")}</div>
      )}
    </>
  );

  return (
    <div className="ic-project-home" aria-label={t("infiniteCanvas.homeAriaLabel")}>
      <div className={`ic-project-home__panel${mode === "libtv" ? " is-libtv" : ""}`}>
        <div className="ic-project-home__head">
          <div className="ic-project-home__title">
            <div>
              {mode === "libtv" ? (
                <button
                  className="ic-home-icon-button ic-home-back-button"
                  type="button"
                  title={t("infiniteCanvas.backToCanvases")}
                  aria-label={t("infiniteCanvas.backToCanvases")}
                  onClick={() => onModeChange("local")}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              ) : null}
              <strong>{mode === "libtv" ? t("infiniteCanvas.libtvCanvasHomeTitle") : t("infiniteCanvas.homeTitle")}</strong>
              <span>{mode === "libtv" ? libtvProjectResults.length : projects.length}</span>
            </div>
          </div>
          <div className="ic-project-home__actions">
            {mode === "libtv" ? (
              <>
                <button className="ic-home-icon-button" type="button" title={t("infiniteCanvas.libtvRefreshCanvases")} aria-label={t("infiniteCanvas.libtvRefreshCanvases")} disabled={libtvImporting} onClick={onRefreshLibtvProjects}>
                  <RefreshCw size={17} aria-hidden="true" />
                </button>
                <input
                  className="ic-libtv-local-search"
                  value={libtvProjectFilter}
                  maxLength={80}
                  placeholder={t("infiniteCanvas.libtvLocalSearchPlaceholder")}
                  onChange={(event) => onLibtvProjectFilterChange(event.target.value)}
                />
              </>
            ) : (
              <>
                <div className="ic-project-sort" role="group" aria-label={t("infiniteCanvas.sortCanvases")}>
                  <button type="button" className={sortMode === "recent" ? "active" : ""} onClick={() => onSortModeChange("recent")}>{t("infiniteCanvas.sortRecent")}</button>
                  <button type="button" className={sortMode === "name" ? "active" : ""} onClick={() => onSortModeChange("name")}>{t("infiniteCanvas.sortName")}</button>
                </div>
                <button className="ic-home-icon-button" type="button" title={t("infiniteCanvas.refreshCanvases")} aria-label={t("infiniteCanvas.refreshCanvases")} onClick={onRefreshLocal}>
                  <RefreshCw size={17} aria-hidden="true" />
                </button>
                <button className="ic-home-create-button" type="button" onClick={onCreateCanvas}>
                  <Plus size={17} aria-hidden="true" />
                  <span>{t("infiniteCanvas.newCanvas")}</span>
                </button>
              </>
            )}
          </div>
        </div>
        {mode === "libtv" ? renderLibtvResults() : (
          <>
            {projectStatus ? <div className="ic-project-status">{projectStatus}</div> : null}
            <div className="ic-project-card-grid">
              {projects.length ? projects.map((project) => {
                const isImportingCard = isLibtvImportCard(project);
                const isActive = project.id === selectedProjectId || (!selectedProjectId && project.id === selectedProject?.id);
                const isRenaming = !isImportingCard && project.id === renamingProjectId;
                const isConfirmingDelete = !isImportingCard && project.id === confirmingDeleteProjectId;
                const importPercent = isImportingCard ? getLibtvImportProgressPercent(project.libtvImportProgress) : 0;
                const importProgressValue = isImportingCard ? formatLibtvProgressValue(project.libtvImportProgress) : "";
                const isLibtvCanvas = isImportingCard || project.icon === "libtv";
                return (
                  <article key={project.id} className={`ic-project-card${isActive ? " active" : ""}${isConfirmingDelete ? " confirming-delete" : ""}${isImportingCard ? " is-importing" : ""}`} onClick={() => onSelectProject(project.id)} onDoubleClick={() => {
                    if (!isConfirmingDelete && !isImportingCard) onOpenProject(project.id);
                  }}>
                    {isRenaming ? (
                      <form
                        className="ic-project-rename"
                        onSubmit={(event) => {
                          event.preventDefault();
                          onSubmitRename(project.id);
                        }}
                      >
                        <input
                          value={renamingTitle}
                          autoFocus
                          maxLength={80}
                          onChange={(event) => onRenamingTitleChange(event.target.value)}
                          onBlur={() => onSubmitRename(project.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              onCancelRename();
                            }
                          }}
                        />
                      </form>
                    ) : (
                      <>
                        {!isImportingCard ? (
                          <div className="ic-project-card__actions" onDoubleClick={(event) => event.stopPropagation()}>
                            <button
                              className="ic-project-icon-button"
                              type="button"
                              title={t("infiniteCanvas.renameCanvas")}
                              aria-label={t("infiniteCanvas.renameCanvas")}
                              onClick={(event) => {
                                event.stopPropagation();
                                onStartRename(project.id, project.title || "");
                              }}
                            >
                              <Pencil size={14} aria-hidden="true" />
                            </button>
                            <button
                              className="ic-project-icon-button"
                              type="button"
                              title={t("infiniteCanvas.deleteCanvas")}
                              aria-label={t("infiniteCanvas.deleteCanvas")}
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelectProject(project.id);
                                onConfirmDelete(project.id);
                              }}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          </div>
                        ) : null}
                        <button className="ic-project-card__main" type="button" disabled={isImportingCard} onClick={() => onSelectProject(project.id)}>
                          <span className={`ic-project-card__icon${isLibtvCanvas ? " is-libtv" : ""}`}>
                            {isLibtvCanvas ? <LibtvLogoMark size={24} /> : <Layers size={18} aria-hidden="true" />}
                          </span>
                          <strong>{project.title || t("infiniteCanvas.untitledCanvas")}</strong>
                          {isImportingCard ? (
                            <div className="ic-project-card__import-progress" role="status" aria-live="polite">
                              <span>
                                <span>{t("infiniteCanvas.libtvImportingCard")}</span>
                                <strong>{importProgressValue}</strong>
                              </span>
                              <div aria-hidden="true">
                                <i style={{ width: `${importPercent}%` }} />
                              </div>
                            </div>
                          ) : (
                            <small>{formatProjectDate(project.updatedAt || project.createdAt)}</small>
                          )}
                        </button>
                        {isConfirmingDelete ? (
                          <div className="ic-project-delete-confirm" role="alert" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                            <span>{t("infiniteCanvas.deleteThisCanvas")}</span>
                            <div>
                              <button type="button" className="ic-project-delete-cancel" onClick={onCancelDelete}>
                                {t("common.actions.cancel")}
                              </button>
                              <button type="button" className="ic-project-delete-confirm__danger" onClick={() => onDeleteProject(project.id)}>
                                {t("common.actions.delete")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </article>
                );
              }) : <div className="ic-project-empty">{t("infiniteCanvas.noCanvases")}</div>}
            </div>
            <button className="ic-libtv-home-entry" type="button" onClick={onOpenLibtvHome}>
              <RefreshCw size={17} aria-hidden="true" />
              <span>{t("infiniteCanvas.openLibtvCanvases")}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
