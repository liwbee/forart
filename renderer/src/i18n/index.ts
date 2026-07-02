import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { zhCN as appZhCN, enUS as appEnUS } from "./namespaces/app";
import { zhCN as navZhCN, enUS as navEnUS } from "./namespaces/nav";
import { zhCN as resourceLibraryZhCN, enUS as resourceLibraryEnUS } from "./namespaces/resourceLibrary";
import { zhCN as commonZhCN, enUS as commonEnUS } from "./namespaces/common";
import { zhCN as setupZhCN, enUS as setupEnUS } from "./namespaces/setup";
import { zhCN as settingsZhCN, enUS as settingsEnUS } from "./namespaces/settings";
import { zhCN as modelLibraryZhCN, enUS as modelLibraryEnUS } from "./namespaces/modelLibrary";
import { zhCN as outfitLibraryZhCN, enUS as outfitLibraryEnUS } from "./namespaces/outfitLibrary";
import { zhCN as freeCanvasZhCN, enUS as freeCanvasEnUS } from "./namespaces/freeCanvas";
import { zhCN as freeCanvasEditorZhCN, enUS as freeCanvasEditorEnUS } from "./namespaces/freeCanvasEditor";
import { zhCN as actionLibraryZhCN, enUS as actionLibraryEnUS } from "./namespaces/actionLibrary";
import { zhCN as imageReviewZhCN, enUS as imageReviewEnUS } from "./namespaces/imageReview";
import { zhCN as infiniteCanvasZhCN, enUS as infiniteCanvasEnUS } from "./namespaces/infiniteCanvas";
import { zhCN as sharedZhCN, enUS as sharedEnUS } from "./namespaces/shared";

export const LANGUAGE_KEY = "forart_language";
export const SUPPORTED_LANGUAGES = ["zh-CN", "en-US"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function readStoredLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "zh-CN";
  const stored = window.localStorage.getItem(LANGUAGE_KEY);
  if (stored === "en-US" || stored === "zh-CN") return stored;
  return navigator.language.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

const namespaces = [
  "app",
  "nav",
  "resourceLibrary",
  "common",
  "setup",
  "settings",
  "modelLibrary",
  "outfitLibrary",
  "freeCanvas",
  "freeCanvasEditor",
  "actionLibrary",
  "imageReview",
  "infiniteCanvas",
  "shared",
] as const;

const resources = {
  "zh-CN": {
    app: appZhCN,
    nav: navZhCN,
    resourceLibrary: resourceLibraryZhCN,
    common: commonZhCN,
    setup: setupZhCN,
    settings: settingsZhCN,
    modelLibrary: modelLibraryZhCN,
    outfitLibrary: outfitLibraryZhCN,
    freeCanvas: freeCanvasZhCN,
    freeCanvasEditor: freeCanvasEditorZhCN,
    actionLibrary: actionLibraryZhCN,
    imageReview: imageReviewZhCN,
    infiniteCanvas: infiniteCanvasZhCN,
    shared: sharedZhCN,
  },
  "en-US": {
    app: appEnUS,
    nav: navEnUS,
    resourceLibrary: resourceLibraryEnUS,
    common: commonEnUS,
    setup: setupEnUS,
    settings: settingsEnUS,
    modelLibrary: modelLibraryEnUS,
    outfitLibrary: outfitLibraryEnUS,
    freeCanvas: freeCanvasEnUS,
    freeCanvasEditor: freeCanvasEditorEnUS,
    actionLibrary: actionLibraryEnUS,
    imageReview: imageReviewEnUS,
    infiniteCanvas: infiniteCanvasEnUS,
    shared: sharedEnUS,
  },
} as const;

i18n.use(initReactI18next).init({
  resources,
  ns: namespaces,
  defaultNS: "common",
  fallbackNS: ["common", "shared"],
  lng: readStoredLanguage(),
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (language) => {
  if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_KEY, language);
  if (typeof document !== "undefined") document.documentElement.lang = language;
});

if (typeof document !== "undefined") document.documentElement.lang = i18n.language;

export { i18n };
