import { create } from "zustand";
import { ModelGender } from "./types";

interface ModelLibraryState {
  activeProjectId: string;
  activeTagId: string;
  activeGender: Exclude<ModelGender, "unknown"> | "";
  openModelId: string;
  setActiveProjectId: (projectId: string) => void;
  setActiveTagId: (tagId: string) => void;
  toggleGender: (gender: Exclude<ModelGender, "unknown">) => void;
  openEditor: (modelId: string) => void;
  closeEditor: () => void;
}

export const useModelLibraryStore = create<ModelLibraryState>((set, get) => ({
  activeProjectId: "",
  activeTagId: "",
  activeGender: "",
  openModelId: "",
  setActiveProjectId: (projectId) =>
    set({
      activeProjectId: projectId,
      activeTagId: "",
      activeGender: "",
      openModelId: "",
    }),
  setActiveTagId: (tagId) => set({ activeTagId: tagId, openModelId: "" }),
  toggleGender: (gender) =>
    set({
      activeGender: get().activeGender === gender ? "" : gender,
      openModelId: "",
    }),
  openEditor: (modelId) => set({ openModelId: modelId }),
  closeEditor: () => set({ openModelId: "" }),
}));
