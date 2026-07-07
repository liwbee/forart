import { create } from "zustand";

const SAME_COLOR_SINGLE_FILTER_KEY = "forart_library_tag_same_color_single_filter";

function readStoredSameColorSingleFilter() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SAME_COLOR_SINGLE_FILTER_KEY) === "1";
}

interface LibraryTagSettingsState {
  sameColorSingleFilter: boolean;
  setSameColorSingleFilter: (enabled: boolean) => void;
}

export const useLibraryTagSettingsStore = create<LibraryTagSettingsState>((set) => ({
  sameColorSingleFilter: readStoredSameColorSingleFilter(),
  setSameColorSingleFilter: (enabled) => {
    window.localStorage.setItem(SAME_COLOR_SINGLE_FILTER_KEY, enabled ? "1" : "0");
    set({ sameColorSingleFilter: enabled });
  },
}));
