import { create } from "zustand";
import { ModelGender } from "./types";

interface ModelLibraryState {
  activeProjectId: string;
  activeTagIds: string[];
  activeGender: Exclude<ModelGender, "unknown"> | "";
  openModelId: string;
  setActiveProjectId: (projectId: string) => void;
  setActiveTagIds: (tagIds: string[]) => void;
  toggleGender: (gender: Exclude<ModelGender, "unknown">) => void;
  openEditor: (modelId: string) => void;
  closeEditor: () => void;
}

export const useModelLibraryStore = create<ModelLibraryState>((set, get) => ({
  activeProjectId: "",
  activeTagIds: [],
  activeGender: "",
  openModelId: "",
  setActiveProjectId: (projectId) =>
    set({
      activeProjectId: projectId,
      activeTagIds: [],
      activeGender: "",
      openModelId: "",
    }),
  setActiveTagIds: (tagIds) => set({ activeTagIds: tagIds, openModelId: "" }),
  toggleGender: (gender) =>
    set({
      activeGender: get().activeGender === gender ? "" : gender,
      openModelId: "",
    }),
  openEditor: (modelId) => set({ openModelId: modelId }),
  closeEditor: () => set({ openModelId: "" }),
}));
