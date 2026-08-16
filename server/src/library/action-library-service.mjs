import { createUnifiedLibraryService } from "./unified-library-service.mjs";

export function createActionLibraryService(runtime, options = {}) {
  return createUnifiedLibraryService(runtime, { ...options, kind: "action" });
}
