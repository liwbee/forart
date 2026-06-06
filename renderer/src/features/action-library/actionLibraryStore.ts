import { create } from "zustand";

interface ActionLibraryState {
  activeProjectId: string;
  activeTagId: string;
  setActiveProjectId: (projectId: string) => void;
  setActiveTagId: (tagId: string) => void;
}

export const useActionLibraryStore = create<ActionLibraryState>((set) => ({
  activeProjectId: "",
  activeTagId: "",
  setActiveProjectId: (projectId) =>
    set({
      activeProjectId: projectId,
      activeTagId: "",
    }),
  setActiveTagId: (tagId) => set({ activeTagId: tagId }),
}));
