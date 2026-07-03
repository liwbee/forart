import { create } from "zustand";
import { EMPTY_LIBRARY_TAG_FILTER, type LibraryTagFilter } from "../library-tags";

interface OutfitLibraryState {
  activeProjectId: string;
  activeTagFilter: LibraryTagFilter;
  setActiveProjectId: (projectId: string) => void;
  setActiveTagFilter: (tagFilter: LibraryTagFilter) => void;
}

export const useOutfitLibraryStore = create<OutfitLibraryState>((set) => ({
  activeProjectId: "",
  activeTagFilter: EMPTY_LIBRARY_TAG_FILTER,
  setActiveProjectId: (projectId) =>
    set({
      activeProjectId: projectId,
      activeTagFilter: EMPTY_LIBRARY_TAG_FILTER,
    }),
  setActiveTagFilter: (tagFilter) => set({ activeTagFilter: tagFilter }),
}));
