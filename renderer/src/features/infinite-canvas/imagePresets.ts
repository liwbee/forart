/**
 * 调色预设（用户自己保存的"一套参数"）。
 *
 * 存储位置是主进程的 `<rootDir>/image-presets.json`（见 preset-store.cjs），
 * 走 image-presets:load / image-presets:save 两个 IPC，save 是整份覆盖。
 * 这里只做归一化和增删改排序，落盘交给主进程。
 */
import { create } from "zustand";

import { normalizeImageAdjustments, type NativeCanvasImageAdjustments } from "./imageAdjustments";

export interface ImagePresetRecord {
  id: string;
  name: string;
  adjustments: NativeCanvasImageAdjustments;
  createdAt: number;
  updatedAt: number;
}

export interface ImagePresetFile {
  version: number;
  order: string[];
  items: Record<string, ImagePresetRecord>;
}

export const EMPTY_IMAGE_PRESET_FILE: ImagePresetFile = { version: 1, order: [], items: {} };

function safeString(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeImagePresetFile(value: unknown): ImagePresetFile {
  const source = value && typeof value === "object" ? value as Partial<ImagePresetFile> : {};
  const sourceItems = source.items && typeof source.items === "object" ? source.items : {};
  const items: Record<string, ImagePresetRecord> = {};
  for (const [key, raw] of Object.entries(sourceItems)) {
    const record = raw && typeof raw === "object" ? raw as Partial<ImagePresetRecord> : {};
    const id = safeString(record.id) || safeString(key);
    if (!id) continue;
    const createdAt = Number(record.createdAt);
    const updatedAt = Number(record.updatedAt);
    items[id] = {
      id,
      name: safeString(record.name),
      adjustments: normalizeImageAdjustments(record.adjustments),
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
  }
  const order: string[] = [];
  for (const value of Array.isArray(source.order) ? source.order : []) {
    const id = safeString(value);
    if (items[id] && !order.includes(id)) order.push(id);
  }
  for (const id of Object.keys(items)) if (!order.includes(id)) order.push(id);
  return { version: 1, order, items };
}

export function imagePresetList(file: ImagePresetFile): ImagePresetRecord[] {
  return file.order.map((id) => file.items[id]).filter(Boolean);
}

/** "预设 N" 里最简单的一个没被占用的 N。 */
export function nextImagePresetIndex(presets: readonly ImagePresetRecord[], baseName: (index: number) => string) {
  const used = new Set(presets.map((preset) => preset.name.trim().toLocaleLowerCase()));
  let index = 1;
  while (index < 1000) {
    if (!used.has(baseName(index).trim().toLocaleLowerCase())) return index;
    index += 1;
  }
  return presets.length + 1;
}

function newPresetId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `preset_${crypto.randomUUID()}`;
  return `preset_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

interface ImagePresetState {
  presets: ImagePresetRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  savePresets: (presets: ImagePresetRecord[]) => Promise<void>;
  createPreset: (name: string, adjustments: NativeCanvasImageAdjustments) => Promise<ImagePresetRecord>;
  renamePreset: (id: string, name: string) => Promise<void>;
  removePreset: (id: string) => Promise<void>;
}

function toFile(presets: ImagePresetRecord[]): ImagePresetFile {
  const items: Record<string, ImagePresetRecord> = {};
  for (const preset of presets) items[preset.id] = preset;
  return { version: 1, order: presets.map((preset) => preset.id), items };
}

export const useImagePresetStore = create<ImagePresetState>((set, get) => ({
  presets: [],
  loaded: false,

  load: async () => {
    const api = window.forartImagePresets;
    if (!api) {
      set({ presets: [], loaded: true });
      return;
    }
    try {
      const file = normalizeImagePresetFile(await api.load());
      set({ presets: imagePresetList(file), loaded: true });
    } catch {
      set({ presets: [], loaded: true });
    }
  },

  savePresets: async (presets) => {
    // 先更新本地，界面立刻响应；落盘失败就回滚。
    const previous = get().presets;
    set({ presets });
    const api = window.forartImagePresets;
    if (!api) return;
    try {
      const saved = normalizeImagePresetFile(await api.save(toFile(presets)));
      set({ presets: imagePresetList(saved) });
    } catch (error) {
      set({ presets: previous });
      throw error;
    }
  },

  createPreset: async (name, adjustments) => {
    const now = Date.now();
    const preset: ImagePresetRecord = {
      id: newPresetId(),
      name: safeString(name),
      adjustments: normalizeImageAdjustments(adjustments),
      createdAt: now,
      updatedAt: now,
    };
    await get().savePresets([...get().presets, preset]);
    return preset;
  },

  renamePreset: async (id, name) => {
    const preset = get().presets.find((item) => item.id === id);
    if (!preset) return;
    const trimmed = safeString(name);
    if (!trimmed || trimmed === preset.name) return;
    await get().savePresets(get().presets.map((item) => (
      item.id === id ? { ...item, name: trimmed, updatedAt: Date.now() } : item
    )));
  },

  removePreset: async (id) => {
    if (!get().presets.some((item) => item.id === id)) return;
    await get().savePresets(get().presets.filter((item) => item.id !== id));
  },
}));
