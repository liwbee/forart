import { Images, PersonStanding, Users, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { LibraryTagFilterButton } from "../../components/LibraryTagFilterButton";
import { Select } from "../../components/Select";
import { cacheBustedLibraryAssetUrl, useLibraryAssetPickerData } from "./useLibraryAssetPickerData";
import type { LibraryAssetItem, LibraryAssetPickerSource, LibraryAssetSelection, LibraryAssetTab } from "./types";

const allLibrarySources: Array<LibraryAssetPickerSource & { icon: LucideIcon }> = [
  { id: "models", labelKey: "resourceLibrary.models", icon: Users },
  { id: "outfits", labelKey: "resourceLibrary.outfits", icon: Images },
  { id: "actions", labelKey: "resourceLibrary.actions", icon: PersonStanding },
];

function GenderSymbol({ gender, className }: { gender: "female" | "male"; className: string }) {
  if (gender === "female") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="5" />
        <path d="M12 13v8" />
        <path d="M8 17h8" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="15" r="5" />
      <path d="M13 11l7-7" />
      <path d="M15 4h5v5" />
    </svg>
  );
}

interface LibraryAssetPickerContentProps {
  enabled?: boolean;
  sources?: readonly LibraryAssetTab[];
  initialTab?: LibraryAssetTab;
  onSelect: (selection: LibraryAssetSelection) => void;
  className?: string;
  variant?: "dialog" | "rail";
}

export function LibraryAssetPickerContent({
  enabled = true,
  sources,
  initialTab = "outfits",
  onSelect,
  className = "",
  variant = "dialog",
}: LibraryAssetPickerContentProps) {
  const { t } = useTranslation();
  const picker = useLibraryAssetPickerData({ enabled, sources, initialTab });
  const visibleSources = allLibrarySources.filter((source) => picker.availableTabs.includes(source.id));
  const contentRef = useRef<HTMLDivElement | null>(null);
  const choicesRef = useRef<HTMLDivElement | null>(null);
  const [railChoicesPosition, setRailChoicesPosition] = useState({ left: 0, top: 0 });

  function selectItem(item: LibraryAssetItem, target?: HTMLElement | null) {
    if (item.needsChoices) {
      if (variant === "rail" && target) {
        const contentRect = contentRef.current?.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (contentRect) {
          setRailChoicesPosition({
            left: targetRect.right - contentRect.left + 8,
            top: targetRect.top - contentRect.top,
          });
        }
      }
      picker.setModelChoiceFor(item);
      picker.prefetchModelChoices(item);
      return;
    }
    if (!item.url) return;
    onSelect({
      kind: item.kind,
      entryId: item.id,
      assetId: item.assetId,
      name: item.name,
      url: item.url,
      updatedAt: item.updatedAt,
    });
  }

  const modelChoiceFor = picker.modelChoiceFor;

  useEffect(() => {
    if (variant !== "rail" || !modelChoiceFor) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && choicesRef.current?.contains(target)) return;
      picker.setModelChoiceFor(null);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [modelChoiceFor, picker.setModelChoiceFor, variant]);

  return (
    <div ref={contentRef} className={`library-asset-picker-content${className ? ` ${className}` : ""}`}>
      {visibleSources.length > 1 ? (
        <div className="library-asset-picker__tabs" role="tablist" aria-label={t("resourceLibrary.navigation")}>
          {visibleSources.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" role="tab" aria-selected={picker.activeTab === tab.id} className={picker.activeTab === tab.id ? "active" : ""} onClick={() => picker.setActiveTab(tab.id)}>
                <Icon size={17} aria-hidden="true" />
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="library-asset-picker__filters">
        <Select
          value={picker.activeProjectId}
          disabled={!picker.activeProjects.length}
          options={picker.activeProjects.map((project) => ({ value: project.id, label: project.name || t("infiniteCanvas.untitledCanvas") }))}
          onChange={picker.changeProject}
          ariaLabel={t("freeCanvas.project")}
          portal
          menuPlacement="bottom"
        />
        <LibraryTagFilterButton
          tags={picker.activeTags}
          activeTagId={picker.activeTagId}
          allLabel={t("infiniteCanvas.allLibraryTags")}
          ariaLabel={t("infiniteCanvas.libraryTagFilter")}
          onChange={picker.changeTag}
          active={Boolean(picker.activeTagId || (picker.activeTab === "models" && picker.activeModelGender))}
          menuContentBefore={picker.activeTab === "models" ? (
            <div className="library-asset-picker__filter-menu-section" aria-label={t("modelLibrary.genderCategory")}>
              <span>{t("modelLibrary.gender")}</span>
              <div className="library-asset-picker__gender-filter">
                <button
                  className={`gender-icon-filter female${picker.activeModelGender === "female" ? " active" : ""}`}
                  type="button"
                  aria-label={t("modelLibrary.femaleModel")}
                  title={t("modelLibrary.femaleModel")}
                  onClick={() => picker.toggleModelGender("female")}
                >
                  <GenderSymbol gender="female" className="gender-symbol-icon" />
                </button>
                <button
                  className={`gender-icon-filter male${picker.activeModelGender === "male" ? " active" : ""}`}
                  type="button"
                  aria-label={t("modelLibrary.maleModel")}
                  title={t("modelLibrary.maleModel")}
                  onClick={() => picker.toggleModelGender("male")}
                >
                  <GenderSymbol gender="male" className="gender-symbol-icon" />
                </button>
              </div>
            </div>
          ) : null}
        />
      </div>

      <div className="library-asset-picker__body">
        {picker.errorMessage ? <div className="library-asset-picker__state library-asset-picker__state--error">{t("infiniteCanvas.libraryRequestFailed", { message: picker.errorMessage })}</div> : null}
        {!picker.storageConfigured && !picker.storageSettingsLoading ? <div className="library-asset-picker__state">{t("outfitLibrary.storageUnavailable")}</div> : null}
        {picker.storageConfigured && !picker.isLoading && !picker.activeProjects.length ? <div className="library-asset-picker__state">{t("common.empty.noProjects")}</div> : null}
        {picker.isLoading ? <div className="library-asset-picker__state">{t("common.states.loading")}</div> : null}
        {picker.storageConfigured && !picker.isLoading && picker.activeProjects.length && !picker.activeItems.length ? <div className="library-asset-picker__state">{t("infiniteCanvas.noLibraryImages")}</div> : null}
        {!picker.isLoading && picker.activeItems.length ? (
          <div className="library-asset-picker__grid">
            {picker.activeItems.map((item) => {
              const src = item.url ? cacheBustedLibraryAssetUrl(item.url, item.updatedAt || item.assetId || item.id) : "";
              return (
                <button key={item.id} type="button" data-kind={item.kind} disabled={!src} onClick={(event) => selectItem(item, event.currentTarget)}>
                  {src ? <img src={src} alt={item.name} loading="lazy" draggable={false} /> : <span>{t("common.empty.noImage")}</span>}
                  <strong>{item.name || t("infiniteCanvas.untitledCanvas")}</strong>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {modelChoiceFor ? (
        <div
          ref={choicesRef}
          className="library-asset-picker__choices"
          role="dialog"
          aria-label={t("infiniteCanvas.chooseModelImage", { name: modelChoiceFor.name })}
          style={variant === "rail" ? ({
            "--library-asset-choice-left": `${railChoicesPosition.left}px`,
            "--library-asset-choice-top": `${railChoicesPosition.top}px`,
          } as CSSProperties) : undefined}
          onPointerDown={(event) => {
            if (variant === "rail") event.stopPropagation();
          }}
        >
          <div className="library-asset-picker__choices-head">
            <strong>{modelChoiceFor.name}</strong>
            <button type="button" aria-label={t("common.actions.back")} title={t("common.actions.back")} onClick={() => picker.setModelChoiceFor(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="library-asset-picker__choice-grid">
            {picker.modelChoicesQuery.isLoading ? <div className="library-asset-picker__state">{t("freeCanvasEditor.loadingImages")}</div> : null}
            {!picker.modelChoicesQuery.isLoading && !(picker.modelChoicesQuery.data?.images || []).length ? <div className="library-asset-picker__state">{t("freeCanvasEditor.noModelImages")}</div> : null}
            {(picker.modelChoicesQuery.data?.images || []).map((image) => {
              const src = image.asset_url ? cacheBustedLibraryAssetUrl(image.asset_url, image.created_at || image.asset_id || image.id) : "";
              return (
                <button
                  key={image.id}
                  type="button"
                  disabled={!src}
                  onClick={() => {
                    if (!src || !image.asset_url) return;
                    onSelect({
                      kind: "model",
                      entryId: modelChoiceFor.id,
                      assetId: image.asset_id,
                      name: image.caption || image.filename || modelChoiceFor.name,
                      url: image.asset_url,
                      updatedAt: image.created_at,
                    });
                  }}
                >
                  {src ? <img src={src} alt={image.caption || image.filename || modelChoiceFor.name} loading="lazy" draggable={false} /> : <span>{t("common.empty.noImage")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
