import { create } from "zustand";

interface OutfitLibraryState {
  activeProjectId: string;
  activeTagIds: string[];
  setActiveProjectId: (projectId: string) => void;
  setActiveTagIds: (tagIds: string[]) => void;
}

export const useOutfitLibraryStore = create<OutfitLibraryState>((set) => ({
  activeProjectId: "",
  activeTagIds: [],
  setActiveProjectId: (projectId) =>
    set({
      activeProjectId: projectId,
      activeTagIds: [],
    }),
  setActiveTagIds: (tagIds) => set({ activeTagIds: tagIds }),
}));
