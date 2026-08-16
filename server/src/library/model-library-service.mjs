import { createUnifiedLibraryService } from "./unified-library-service.mjs";

export function createModelLibraryService(runtime, options = {}) {
  return createUnifiedLibraryService(runtime, { ...options, kind: "model" });
}
