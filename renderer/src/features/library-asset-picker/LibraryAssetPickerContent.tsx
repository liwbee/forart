import { Images, PersonStanding, Users, X, type LucideIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { AppScrollArea } from "../../components/AppScrollArea";
import { LazyImage } from "../../components/LazyImage";
import { NativeTabs } from "../../components/NativeTabs";
import { AppSelect as Select } from "../../components/AppSelect";
import { Button } from "../../components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { LibraryTagFilterButton, useLibraryTagSettingsStore } from "../library-tags";
import { cacheBustedLibraryAssetUrl, useLibraryAssetPickerData } from "./useLibraryAssetPickerData";
import type { LibraryAssetItem, LibraryAssetPickerSource, LibraryAssetSelection } from "./types";

const allLibrarySources: Array<LibraryAssetPickerSource & { icon: LucideIcon }> = [
  { id: "models", labelKey: "resourceLibrary:models", icon: Users },
  { id: "outfits", labelKey: "resourceLibrary:outfits", icon: Images },
  { id: "actions", labelKey: "resourceLibrary:actions", icon: PersonStanding },
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
  onSelect: (selection: LibraryAssetSelection) => void;
}

export function LibraryAssetPickerContent({ onSelect }: LibraryAssetPickerContentProps) {
  const { t } = useTranslation();
  const sameColorSingleFilter = useLibraryTagSettingsStore((state) => state.sameColorSingleFilter);
  const picker = useLibraryAssetPickerData();
  const visibleSources = allLibrarySources.filter((source) => picker.availableTabs.includes(source.id));
  const [projectSelectOpen, setProjectSelectOpen] = useState(false);

  function selectItem(item: LibraryAssetItem) {
    if (!item.url) return;
    onSelect({
      kind: item.kind,
      entryId: item.id,
      assetId: item.assetId,
      name: item.name,
      url: item.url,
      thumbnailUrl: item.thumbnailUrl,
      updatedAt: item.updatedAt,
    });
  }

  const modelChoiceFor = picker.modelChoiceFor;

  function changeModelChoicesOpen(item: LibraryAssetItem, open: boolean) {
    if (open) {
      picker.setModelChoiceFor(item);
      picker.prefetchModelChoices(item);
      return;
    }
    if (modelChoiceFor?.id === item.id) picker.setModelChoiceFor(null);
  }

  return (
    <div className="library-asset-picker-content">
      {visibleSources.length > 1 ? (
        <NativeTabs
          items={visibleSources.map((tab) => ({ value: tab.id, label: t(tab.labelKey), icon: tab.icon }))}
          value={picker.activeTab}
          onChange={picker.setActiveTab}
          ariaLabel={t("resourceLibrary:navigation")}
          className="library-asset-picker__tabs"
        />
      ) : null}

      <div className="library-asset-picker__filters">
        <Select
          value={picker.activeProjectId}
          disabled={!picker.activeProjects.length}
          open={projectSelectOpen && Boolean(picker.activeProjects.length)}
          onOpenChange={setProjectSelectOpen}
          options={picker.activeProjects.map((project) => ({ value: project.id, label: project.name || t("infiniteCanvas:untitledCanvas") }))}
          onChange={(projectId) => {
            picker.changeProject(projectId);
            setProjectSelectOpen(false);
          }}
          ariaLabel={t("freeCanvas:project")}
          menuPlacement="bottom"
        />
        <LibraryTagFilterButton
          tags={picker.activeTags}
          tagFilter={picker.activeTagFilter}
          tagCounts={picker.activeTagCounts}
          allLabel={t("infiniteCanvas:allLibraryTags")}
          ariaLabel={t("infiniteCanvas:libraryTagFilter")}
          onChange={picker.changeTag}
          sameColorSingleFilter={sameColorSingleFilter}
          active={Boolean(picker.hasActiveTagFilter || (picker.activeTab === "models" && picker.activeModelGender))}
          menuContentBefore={picker.activeTab === "models" ? (
            <div className="library-asset-picker__filter-menu-section" aria-label={t("modelLibrary:genderCategory")}>
              <span>{t("modelLibrary:gender")}</span>
              <ToggleGroup
                className="library-asset-picker__gender-filter"
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                value={picker.activeModelGender}
                aria-label={t("modelLibrary:genderCategory")}
                onValueChange={(value) => {
                  if (value === "female" || value === "male") {
                    if (value !== picker.activeModelGender) picker.toggleModelGender(value);
                    return;
                  }
                  if (picker.activeModelGender) picker.toggleModelGender(picker.activeModelGender);
                }}
              >
                <ToggleGroupItem
                  className="gender-icon-filter female"
                  value="female"
                  aria-label={t("modelLibrary:femaleModel")}
                  title={t("modelLibrary:femaleModel")}
                >
                  <GenderSymbol gender="female" className="gender-symbol-icon" />
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="gender-icon-filter male"
                  value="male"
                  aria-label={t("modelLibrary:maleModel")}
                  title={t("modelLibrary:maleModel")}
                >
                  <GenderSymbol gender="male" className="gender-symbol-icon" />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          ) : null}
        />
      </div>

      <AppScrollArea
        className="library-asset-picker__body"
        viewportClassName="library-asset-picker__body-viewport"
        scrollBarClassName="library-asset-picker__body-scrollbar"
      >
        {picker.errorMessage ? <ErrorCopyLine className="library-asset-picker__state library-asset-picker__state--error" text={t("infiniteCanvas:libraryRequestFailed", { message: picker.errorMessage })} /> : null}
        {!picker.storageConfigured && !picker.storageSettingsLoading ? <div className="library-asset-picker__state">{t("outfitLibrary:storageUnavailable")}</div> : null}
        {picker.storageConfigured && !picker.isLoading && !picker.activeProjects.length ? <div className="library-asset-picker__state">{t("common:empty.noProjects")}</div> : null}
        {picker.isLoading ? <div className="library-asset-picker__state">{t("common:states.loading")}</div> : null}
        {picker.storageConfigured && !picker.isLoading && picker.activeProjects.length && !picker.activeItems.length ? <div className="library-asset-picker__state">{t("infiniteCanvas:noLibraryImages")}</div> : null}
        {!picker.isLoading && picker.activeItems.length ? (
          <div className="library-asset-picker__grid">
            {picker.activeItems.map((item) => {
              const src = item.url ? cacheBustedLibraryAssetUrl(item.thumbnailUrl || item.url, item.updatedAt || item.assetId || item.id) : "";
              const itemButton = (
                <button type="button" data-kind={item.kind} disabled={!src} onClick={item.needsChoices ? undefined : () => selectItem(item)}>
                  {src ? <LazyImage src={src} alt={item.name} draggable={false} /> : <span>{t("common:empty.noImage")}</span>}
                  <strong>{item.name || t("infiniteCanvas:untitledCanvas")}</strong>
                </button>
              );

              if (!item.needsChoices) {
                return <Fragment key={item.id}>{itemButton}</Fragment>;
              }

              const choicesOpen = modelChoiceFor?.id === item.id;
              return (
                <Popover key={item.id} open={choicesOpen} onOpenChange={(open) => changeModelChoicesOpen(item, open)}>
                  <PopoverTrigger asChild>{itemButton}</PopoverTrigger>
                  <PopoverContent
                    className="library-asset-picker__choices"
                    side="right"
                    sideOffset={8}
                    align="start"
                    collisionPadding={16}
                    aria-label={t("infiniteCanvas:chooseModelImage", { name: item.name })}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <div className="library-asset-picker__choices-head">
                      <strong>{item.name}</strong>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <PopoverClose asChild>
                              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:actions.close")}>
                                <X aria-hidden="true" />
                              </Button>
                            </PopoverClose>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{t("common:actions.close")}</TooltipContent>
                      </Tooltip>
                    </div>
                    <AppScrollArea className="library-asset-picker__choice-grid" viewportClassName="library-asset-picker__choice-grid-viewport">
                      {picker.modelChoicesQuery.isLoading ? <div className="library-asset-picker__state">{t("freeCanvasEditor:loadingImages")}</div> : null}
                      {!picker.modelChoicesQuery.isLoading && !(picker.modelChoicesQuery.data?.images || []).length ? <div className="library-asset-picker__state">{t("freeCanvasEditor:noModelImages")}</div> : null}
                      {(picker.modelChoicesQuery.data?.images || []).map((image) => {
                        const choiceSrc = image.asset_url ? cacheBustedLibraryAssetUrl(image.thumbnail_url || image.asset_url, image.created_at || image.asset_id || image.id) : "";
                        return (
                          <PopoverClose key={image.id} asChild>
                            <button
                              type="button"
                              disabled={!choiceSrc}
                              onClick={() => {
                                if (!choiceSrc || !image.asset_url) return;
                                onSelect({
                                  kind: "model",
                                  entryId: item.id,
                                  assetId: image.asset_id,
                                  name: image.caption || image.filename || item.name,
                                  url: image.asset_url,
                                  thumbnailUrl: image.thumbnail_url || undefined,
                                  updatedAt: image.created_at,
                                });
                              }}
                            >
                              {choiceSrc ? <LazyImage src={choiceSrc} alt={image.caption || image.filename || item.name} draggable={false} /> : <span>{t("common:empty.noImage")}</span>}
                            </button>
                          </PopoverClose>
                        );
                      })}
                    </AppScrollArea>
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        ) : null}
      </AppScrollArea>
    </div>
  );
}
