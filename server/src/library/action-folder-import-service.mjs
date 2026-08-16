import crypto from "node:crypto";
import { validateFileNamePart } from "./library-runtime.mjs";

const PROMPT_LIMIT = 4000;

function rowIdFor(kind, value) {
  return crypto.createHash("sha1").update(`${kind}:${value}`).digest("hex").slice(0, 24);
}

export function createActionFolderImportService(runtime, actionService) {
  async function importActionEntries(projectId, payload = {}) {
    if (!await actionService.projectExists(projectId)) return null;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) throw new Error("No rows selected for import");

    const imported = [];
    const failed = [];
    const rows = [];

    for (const entry of entries) {
      const rowBase = {
        id: String(entry.id || rowIdFor("action-import-entry", `${entry.name || ""}:${entry.filename || ""}`)),
        stem: String(entry.stem || entry.name || ""),
        filename: String(entry.filename || entry.name || "image"),
        relative_path: String(entry.relative_path || entry.filename || entry.name || ""),
        image_path: null,
        text_path: null,
        proposed_name: String(entry.name || ""),
        thumbnail_url: String(entry.thumbnail_url || ""),
        selectable: true,
        selected: true,
        status: "ready",
        errors: [],
        warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
      };

      try {
        const name = entry.name ? validateFileNamePart(entry.name, "action name") : "";
        const tagNames = entry.tags?.length ? await actionService.existingProjectTagNames(projectId, entry.tags) : [];
        const imageData = String(entry.data || "");
        if (!imageData) throw new Error("Invalid image data");
        const action = await actionService.createActionFromFile(projectId, {
          ...(name ? { name } : {}),
          prompt: String(entry.prompt || "").slice(0, PROMPT_LIMIT),
          filename: entry.filename || "image",
          mime_type: entry.mime_type || "image/png",
          buffer: Buffer.from(imageData, "base64"),
          tags: tagNames,
        });
        imported.push(action);
        rows.push({ ...rowBase, action_id: action.id, final_status: rowBase.warnings.length ? "warning" : "imported" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedRow = { ...rowBase, final_status: "failed", errors: [{ code: "import_failed", message }] };
        failed.push(failedRow);
        rows.push(failedRow);
      }
    }

    return { imported_count: imported.length, failed_count: failed.length, imported, not_selected: [], failed, rows };
  }

  return { importActionEntries };
}
