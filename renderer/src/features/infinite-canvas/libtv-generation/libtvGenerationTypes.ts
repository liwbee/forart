import type { LibtvImageModelRecord, LibtvProjectRecord, LibtvWorkspaceRecord } from "../../../app/appConfig";

export type LibtvAspectRatio = "1:1" | "2:3" | "3:2" | "4:3" | "3:4" | "16:9" | "9:16";
export type LibtvQuality = "1K" | "2K" | "4K";

export const LIBTV_ASPECT_RATIO_OPTIONS: LibtvAspectRatio[] = ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"];
export const LIBTV_QUALITY_OPTIONS: LibtvQuality[] = ["1K", "2K", "4K"];

export type { LibtvImageModelRecord, LibtvProjectRecord, LibtvWorkspaceRecord };
