import { create } from "zustand";

export type AppView = "models" | "outfits" | "actions" | "image-review" | "canvas" | "settings";
export type ThemeMode = "light" | "dark";

const VIEW_KEY = "forart_active_view";
const THEME_KEY = "forart_theme";
const LEGACY_THEME_KEY = "studio_theme";
const APP_VIEWS: AppView[] = ["models", "outfits", "actions", "image-review", "canvas", "settings"];

function readStoredView(): AppView {
  if (typeof window === "undefined") return "models";
  const view = window.localStorage.getItem(VIEW_KEY);
  return APP_VIEWS.includes(view as AppView) ? (view as AppView) : "models";
}

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const theme = window.localStorage.getItem(THEME_KEY) || window.localStorage.getItem(LEGACY_THEME_KEY);
  return theme === "dark" ? "dark" : "light";
}

function syncDocumentTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("theme-dark", isDark);
  document.body.classList.toggle("theme-dark", isDark);
}

interface AppState {
  activeView: AppView;
  theme: ThemeMode;
  setActiveView: (view: AppView) => void;
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: readStoredView(),
  theme: readStoredTheme(),
  setActiveView: (view) => {
    window.localStorage.setItem(VIEW_KEY, view);
    set({ activeView: view });
  },
  toggleTheme: () => {
    const next: ThemeMode = get().theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_KEY, next);
    window.localStorage.setItem(LEGACY_THEME_KEY, next);
    syncDocumentTheme(next);
    set({ theme: next });
  },
}));

syncDocumentTheme(readStoredTheme());
