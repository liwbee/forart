import { create } from "zustand";
import { EMPTY_LIBRARY_TAG_FILTER, type LibraryTagFilter } from "../library-tags";
import { ModelGender } from "./types";

interface ModelLibraryState {
  activeProjectId: string;
  activeTagFilter: LibraryTagFilter;
  activeGender: Exclude<ModelGender, "unknown"> | "";
  openModelId: string;
  setActiveProjectId: (projectId: string) => void;
  setActiveTagFilter: (tagFilter: LibraryTagFilter) => void;
  toggleGender: (gender: Exclude<ModelGender, "unknown">) => void;
  openEditor: (modelId: string) => void;
  closeEditor: () => void;
}

export const useModelLibraryStore = create<ModelLibraryState>((set, get) => ({
  activeProjectId: "",
  activeTagFilter: EMPTY_LIBRARY_TAG_FILTER,
  activeGender: "",
  openModelId: "",
  setActiveProjectId: (projectId) =>
    set({
      activeProjectId: projectId,
      activeTagFilter: EMPTY_LIBRARY_TAG_FILTER,
      activeGender: "",
      openModelId: "",
    }),
  setActiveTagFilter: (tagFilter) => set({ activeTagFilter: tagFilter, openModelId: "" }),
  toggleGender: (gender) =>
    set({
      activeGender: get().activeGender === gender ? "" : gender,
      openModelId: "",
    }),
  openEditor: (modelId) => set({ openModelId: modelId }),
  closeEditor: () => set({ openModelId: "" }),
}));
