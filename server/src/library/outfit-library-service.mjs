import { createUnifiedLibraryService } from "./unified-library-service.mjs";

export function createOutfitLibraryService(runtime, options = {}) {
  return createUnifiedLibraryService(runtime, { ...options, kind: "outfit" });
}
