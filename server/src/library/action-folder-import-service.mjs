import crypto from "node:crypto";
import { validateFileNamePart } from "./library-runtime.mjs";

const PROMPT_LIMIT = 4000;

function rowIdFor(kind, value) {
  return crypto.createHash("sha1").update(`${kind}:${value}`).digest("hex").slice(0, 24);
}

function actionNameExists(db, projectId, name) {
  return Boolean(db.prepare("SELECT id FROM action_entries WHERE project_id = ? AND name = ?").get(projectId, name));
}

function projectExists(db, projectId) {
  return Boolean(db.prepare("SELECT id FROM action_projects WHERE id = ?").get(projectId));
}

export function createActionFolderImportService(runtime, actionService) {
  const db = runtime.db;

  async function importActionEntries(projectId, payload = {}) {
    if (!projectExists(db, projectId)) return null;
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
        if (name && actionNameExists(db, projectId, name)) throw new Error("Action name must be unique");
        const tagNames = Array.isArray(entry.tags) && entry.tags.length
          ? actionService.existingProjectTagNames(projectId, entry.tags)
          : [];
        const imageData = String(entry.data || "");
        if (!imageData) throw new Error("Invalid image data");
        const action = await actionService.createActionFromFile(projectId, {
          ...(name ? { name } : {}),
          prompt: String(entry.prompt || "").slice(0, PROMPT_LIMIT),
          filename: entry.filename || "image",
          mime_type: entry.mime_type || "image/png",
          buffer: Buffer.from(imageData, "base64"),
        });
        if (tagNames.length) actionService.updateAction(action.id, { tags: tagNames });
        const importedAction = tagNames.length ? actionService.loadActionEntry(action.id) || action : action;
        imported.push(importedAction);
        rows.push({ ...rowBase, action_id: action.id, final_status: rowBase.warnings.length ? "warning" : "imported" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedRow = { ...rowBase, final_status: "failed", errors: [{ code: "import_failed", message }] };
        failed.push(failedRow);
        rows.push(failedRow);
      }
    }

    return {
      imported_count: imported.length,
      failed_count: failed.length,
      imported,
      not_selected: [],
      failed,
      rows,
    };
  }

  return { importActionEntries };
}
