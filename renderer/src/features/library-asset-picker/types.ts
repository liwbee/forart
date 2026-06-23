export type LibraryAssetKind = "model" | "outfit" | "action";

export type LibraryAssetTab = "models" | "outfits" | "actions";

export interface LibraryAssetSelection {
  kind: LibraryAssetKind;
  entryId: string;
  assetId?: string | null;
  name: string;
  url: string;
  updatedAt?: string;
}

export interface LibraryAssetItem {
  id: string;
  name: string;
  assetId?: string | null;
  url: string;
  updatedAt?: string;
  kind: LibraryAssetKind;
  needsChoices?: boolean;
}

export interface LibraryAssetPickerSource {
  id: LibraryAssetTab;
  labelKey: string;
}
