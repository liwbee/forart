import { create } from "zustand";

interface OutfitLibraryState {
  activeProjectId: string;
  activeTagId: string;
  setActiveProjectId: (projectId: string) => void;
  setActiveTagId: (tagId: string) => void;
}

export const useOutfitLibraryStore = create<OutfitLibraryState>((set) => ({
  activeProjectId: "",
  activeTagId: "",
  setActiveProjectId: (projectId) =>
    set({
      activeProjectId: projectId,
      activeTagId: "",
    }),
  setActiveTagId: (tagId) => set({ activeTagId: tagId }),
}));
