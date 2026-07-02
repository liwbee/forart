import { create } from "zustand";

interface ActionLibraryState {
  activeProjectId: string;
  activeTagIds: string[];
  setActiveProjectId: (projectId: string) => void;
  setActiveTagIds: (tagIds: string[]) => void;
}

export const useActionLibraryStore = create<ActionLibraryState>((set) => ({
  activeProjectId: "",
  activeTagIds: [],
  setActiveProjectId: (projectId) =>
    set({
      activeProjectId: projectId,
      activeTagIds: [],
    }),
  setActiveTagIds: (tagIds) => set({ activeTagIds: tagIds }),
}));
