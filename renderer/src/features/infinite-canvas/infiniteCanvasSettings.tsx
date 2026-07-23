import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ForartInfiniteCanvasSettings } from "../../app/appConfig";

export const DEFAULT_INFINITE_CANVAS_SETTINGS: ForartInfiniteCanvasSettings = {
  connectionsVisible: true,
  minimapOpen: false,
  snapToGrid: false,
  referenceComparisonViewer: {
    referenceComparisonEnabled: false,
    referencePanelPercent: 50,
  },
};

export function normalizeInfiniteCanvasSettings(input: unknown): ForartInfiniteCanvasSettings {
  const source = input && typeof input === "object" ? input as Partial<ForartInfiniteCanvasSettings> : {};
  const legacySource = source as Partial<ForartInfiniteCanvasSettings> & {
    actionFissionViewer?: Partial<ForartInfiniteCanvasSettings["referenceComparisonViewer"]>;
  };
  const viewerCandidate = source.referenceComparisonViewer || legacySource.actionFissionViewer;
  const viewerSource: Partial<ForartInfiniteCanvasSettings["referenceComparisonViewer"]> = viewerCandidate && typeof viewerCandidate === "object"
    ? viewerCandidate
    : {};
  const rawPercent: unknown = viewerSource.referencePanelPercent;
  const requestedPercent = rawPercent === undefined || rawPercent === null || rawPercent === ""
    ? Number.NaN
    : Number(rawPercent);
  return {
    connectionsVisible: source.connectionsVisible !== false,
    minimapOpen: source.minimapOpen === true,
    snapToGrid: source.snapToGrid === true,
    referenceComparisonViewer: {
      referenceComparisonEnabled: viewerSource.referenceComparisonEnabled === true,
      referencePanelPercent: Number.isFinite(requestedPercent)
        ? Math.max(20, Math.min(80, Math.round(requestedPercent)))
        : 50,
    },
  };
}

interface InfiniteCanvasSettingsContextValue {
  settings: ForartInfiniteCanvasSettings;
  updateSettings: (updater: (current: ForartInfiniteCanvasSettings) => ForartInfiniteCanvasSettings) => void;
}

const InfiniteCanvasSettingsContext = createContext<InfiniteCanvasSettingsContextValue | null>(null);

export function InfiniteCanvasSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_INFINITE_CANVAS_SETTINGS);
  const settingsRef = useRef(settings);
  const hasLocalUpdateRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let canceled = false;
    void window.forartConfig?.loadInfiniteCanvasSettings?.()
      .then((loaded) => {
        if (canceled || hasLocalUpdateRef.current) return;
        const normalized = normalizeInfiniteCanvasSettings(loaded);
        settingsRef.current = normalized;
        setSettings(normalized);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, []);

  const updateSettings = useCallback((updater: (current: ForartInfiniteCanvasSettings) => ForartInfiniteCanvasSettings) => {
    const current = settingsRef.current;
    const candidate = updater(current);
    if (candidate === current) return;
    hasLocalUpdateRef.current = true;
    const next = normalizeInfiniteCanvasSettings(candidate);
    settingsRef.current = next;
    setSettings(next);

    const saveOperation = saveQueueRef.current.then(async () => {
      const result = await window.forartConfig?.saveInfiniteCanvasSettings?.(next);
      if (!result || settingsRef.current !== next) return;
      const persisted = normalizeInfiniteCanvasSettings(result.infiniteCanvas);
      settingsRef.current = persisted;
      setSettings(persisted);
    });
    saveQueueRef.current = saveOperation.catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ settings, updateSettings }), [settings, updateSettings]);
  return <InfiniteCanvasSettingsContext.Provider value={value}>{children}</InfiniteCanvasSettingsContext.Provider>;
}

export function useInfiniteCanvasSettings() {
  const context = useContext(InfiniteCanvasSettingsContext);
  if (!context) throw new Error("InfiniteCanvasSettingsProvider is missing.");
  return context;
}
