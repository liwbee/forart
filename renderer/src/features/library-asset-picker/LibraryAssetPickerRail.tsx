import { LibraryAssetPickerContent } from "./LibraryAssetPickerContent";
import type { LibraryAssetSelection } from "./types";

interface LibraryAssetPickerRailProps {
  onSelect: (selection: LibraryAssetSelection) => void;
}

export function LibraryAssetPickerRail({ onSelect }: LibraryAssetPickerRailProps) {
  return (
    <aside className="library-asset-picker library-asset-picker--rail">
      <LibraryAssetPickerContent onSelect={onSelect} />
    </aside>
  );
}
