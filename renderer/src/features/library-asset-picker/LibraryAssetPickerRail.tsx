import { LibraryAssetPickerContent } from "./LibraryAssetPickerContent";
import type { LibraryAssetSelection, LibraryAssetTab } from "./types";

interface LibraryAssetPickerRailProps {
  onSelect: (selection: LibraryAssetSelection) => void;
  sources?: readonly LibraryAssetTab[];
  initialTab?: LibraryAssetTab;
  className?: string;
}

export function LibraryAssetPickerRail({
  onSelect,
  sources,
  initialTab = "outfits",
  className = "",
}: LibraryAssetPickerRailProps) {
  return (
    <aside className={`library-asset-picker library-asset-picker--rail${className ? ` ${className}` : ""}`}>
      <LibraryAssetPickerContent sources={sources} initialTab={initialTab} onSelect={onSelect} variant="rail" />
    </aside>
  );
}
