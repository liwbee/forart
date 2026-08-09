import { create } from "zustand";
import type { NativeCanvasNodeData, NativeCanvasNodeKind } from "../nativeCanvas";

interface ApiGenerationPreference {
  providerId?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
  customSize?: string;
  quality?: string;
  count?: number;
}

interface LibtvGenerationPreference {
  modelKey?: string;
  modelName?: string;
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  count?: number;
}

interface GenerationPreferenceState {
  activeBackend: "api" | "libtv" | null;
  api: ApiGenerationPreference;
  libtv: LibtvGenerationPreference;
  rememberApi: (preference: ApiGenerationPreference) => void;
  rememberLibtv: (preference: LibtvGenerationPreference) => void;
}

export const useGenerationPreferenceStore = create<GenerationPreferenceState>((set) => ({
  activeBackend: null,
  api: {},
  libtv: {},
  rememberApi: (preference) => set((state) => ({
    activeBackend: "api",
    api: { ...state.api, ...preference },
  })),
  rememberLibtv: (preference) => set((state) => ({
    activeBackend: "libtv",
    libtv: { ...state.libtv, ...preference },
  })),
}));

export function rememberedGenerationNodeData(kind: NativeCanvasNodeKind): Partial<NativeCanvasNodeData> {
  if (kind !== "imageGenerator" && kind !== "actionFission") return {};
  const state = useGenerationPreferenceStore.getState();
  if (state.activeBackend === "api") {
    return {
      imageGenerationBackend: "api",
      imageProviderId: state.api.providerId,
      imageModel: state.api.model,
      imageResolution: state.api.resolution,
      imageAspectRatio: state.api.aspectRatio,
      imageCustomSize: state.api.customSize,
      imageQuality: state.api.quality,
      imageCount: kind === "actionFission" ? 1 : state.api.count,
    };
  }
  if (state.activeBackend === "libtv") {
    return {
      imageGenerationBackend: "libtv",
      libtvImageGeneration: {
        modelKey: state.libtv.modelKey,
        modelName: state.libtv.modelName,
        resolution: state.libtv.resolution,
        aspectRatio: state.libtv.aspectRatio,
        quality: state.libtv.quality,
        count: kind === "actionFission" ? 1 : state.libtv.count,
      },
    };
  }
  return {};
}
