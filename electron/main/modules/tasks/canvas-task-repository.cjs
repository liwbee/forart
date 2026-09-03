const fs = require('node:fs');
const path = require('node:path');
const {
  ACTIVE_STATUSES, TERMINAL_STATUSES, TASK_CATEGORIES, normalizeCategory, normalizeOperation, normalizeStatus, safeString, targetKey,
} = require('./canvas-task-types.cjs');

const SCHEMA_VERSION = 4;
const DATABASE_RELATIVE_PATH = path.join('CanvasAssests', 'tasks', 'generation-tasks.sqlite');
const MAX_INPUT_TEXT = 32 * 1024;
const MAX_RESULT_TEXT = 512 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;

function byteLength(value) { return Buffer.byteLength(String(value || ''), 'utf8'); }
function rejectUnsafe(value, seen = new Set()) {
  if (typeof value === 'string') {
    if (/^data:[^,]*;base64,/i.test(value.trim()) || value.length > MAX_RESULT_TEXT) throw new Error('Task payload contains an oversized or base64 value.');
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => rejectUnsafe(item, seen));
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (['apikey', 'authorization', 'accesskey', 'secretkey', 'base64', 'buffer', 'binary', 'imagedata', 'rawdata', 'headers', 'cookie'].includes(normalized)) continue;
    output[key] = rejectUnsafe(nested, seen);
  }
  return output;
}

function normalizeResult(result) {
  if (result === undefined || result === null) return null;
  const sanitized = rejectUnsafe(result);
  const serialized = JSON.stringify(sanitized);
  if (byteLength(serialized) > MAX_JSON_BYTES) throw new Error('Task result is too large to persist.');
  return sanitized;
}

function normalizeTask(input = {}) {
  const now = Date.now();
  if (input.category !== TASK_CATEGORIES.IMAGE) throw new Error('Canvas task history only accepts image tasks.');
  const category = normalizeCategory(input.category);
  const operation = normalizeOperation(input.operation);
  const status = normalizeStatus(input.status);
  const task = {
    id: safeString(input.id),
    category,
    operation,
    canvasId: safeString(input.canvasId),
    nodeId: safeString(input.nodeId || input.target?.nodeId),
    rowId: safeString(input.rowId || input.target?.rowId),
    providerId: safeString(input.providerId),
    providerName: safeString(input.providerName),
    model: safeString(input.model),
    resolution: safeString(input.resolution),
    aspectRatio: safeString(input.aspectRatio),
    quality: safeString(input.quality),
    executorKind: safeString(input.executorKind) || 'api',
    status,
    version: Math.max(1, Number(input.version || 1)),
    createdAt: Number(input.createdAt || now),
    startedAt: Number(input.startedAt || now),
    updatedAt: Number(input.updatedAt || now),
    completedAt: Number(input.completedAt || 0) || undefined,
    durationMs: Number(input.durationMs || 0) || undefined,
    errorCode: safeString(input.errorCode),
    errorMessage: safeString(input.errorMessage || input.error),
    inputFingerprint: safeString(input.inputFingerprint),
    applicationStatus: safeString(input.applicationStatus) || undefined,
    resultKind: safeString(input.resultKind) || 'image',
    input: input.input ? rejectUnsafe(input.input) : undefined,
    result: normalizeResult(input.result),
  };
  if (!task.id || !task.canvasId || !task.nodeId) throw new Error('Canvas task requires id, canvasId, and nodeId.');
  if (task.input) {
    const serialized = JSON.stringify(task.input);
    if (byteLength(serialized) > MAX_INPUT_TEXT) throw new Error('Task input is too large to persist.');
  }
  return task;
}

function createCanvasTaskRepository({ rootDir, databasePath, Database } = {}) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const resolvedPath = path.resolve(databasePath || path.join(resolvedRoot, DATABASE_RELATIVE_PATH));
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const SqliteDatabase = Database || require('better-sqlite3');
  const db = new SqliteDatabase(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  const hasLegacyTasks = Boolean(db.prepare(`SELECT 1 present FROM sqlite_master WHERE type='table' AND name='generation_tasks'`).get()?.present);
  const hasCanvasTasks = Boolean(db.prepare(`SELECT 1 present FROM sqlite_master WHERE type='table' AND name='canvas_tasks'`).get()?.present);
  let migrationBackupPath = '';
  if (hasLegacyTasks && !hasCanvasTasks) {
    migrationBackupPath = `${resolvedPath}.pre-canvas-tasks-${Date.now()}.bak`;
    db.exec(`VACUUM INTO '${migrationBackupPath.replaceAll("'", "''")}'`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS canvas_tasks (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, operation TEXT NOT NULL, canvas_id TEXT NOT NULL, node_id TEXT NOT NULL, row_id TEXT,
      provider_id TEXT, provider_name TEXT, model TEXT, executor_kind TEXT NOT NULL DEFAULT 'api', status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      resolution TEXT, aspect_ratio TEXT, quality TEXT,
      created_at INTEGER NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
      duration_ms INTEGER, error_code TEXT, error_message TEXT, result_kind TEXT NOT NULL, input_fingerprint TEXT,
      application_status TEXT, input_json TEXT, result_json TEXT
    );
    CREATE TABLE IF NOT EXISTS canvas_task_heads (
      scope_key TEXT PRIMARY KEY, canvas_id TEXT NOT NULL, category TEXT NOT NULL, operation TEXT NOT NULL, node_id TEXT NOT NULL, row_id TEXT, latest_task_id TEXT NOT NULL REFERENCES canvas_tasks(id) ON DELETE CASCADE, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canvas_task_assets (
      task_id TEXT NOT NULL REFERENCES canvas_tasks(id) ON DELETE CASCADE, asset_url TEXT NOT NULL, asset_role TEXT NOT NULL, media_type TEXT NOT NULL, canvas_id TEXT NOT NULL, node_id TEXT NOT NULL, PRIMARY KEY(task_id, asset_url, asset_role)
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_tasks_category_updated ON canvas_tasks(category, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_canvas_tasks_canvas_target ON canvas_tasks(canvas_id, node_id, operation, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_canvas_tasks_status ON canvas_tasks(status, updated_at DESC);
  `);
  const canvasTaskColumns = new Set(db.prepare(`PRAGMA table_info(canvas_tasks)`).all().map((column) => column.name));
  if (!canvasTaskColumns.has('executor_kind')) db.exec(`ALTER TABLE canvas_tasks ADD COLUMN executor_kind TEXT NOT NULL DEFAULT 'api'`);
  if (!canvasTaskColumns.has('resolution')) db.exec(`ALTER TABLE canvas_tasks ADD COLUMN resolution TEXT`);
  if (!canvasTaskColumns.has('aspect_ratio')) db.exec(`ALTER TABLE canvas_tasks ADD COLUMN aspect_ratio TEXT`);
  if (!canvasTaskColumns.has('quality')) db.exec(`ALTER TABLE canvas_tasks ADD COLUMN quality TEXT`);
  // Older canvas-task rows were mirrored without display metadata. Recover
  // these three non-Prompt fields from the generation-task summary when the
  // legacy task database is still available.
  const generationTasksExist = Boolean(db.prepare(`SELECT 1 present FROM sqlite_master WHERE type='table' AND name='generation_tasks'`).get()?.present);
  if (generationTasksExist) {
    const metadataRows = db.prepare(`SELECT legacy.id, legacy.summary_json FROM generation_tasks legacy INNER JOIN canvas_tasks current ON current.id = legacy.id WHERE current.resolution IS NULL OR current.aspect_ratio IS NULL OR current.quality IS NULL`).all();
    const updateMetadata = db.prepare(`UPDATE canvas_tasks SET resolution = COALESCE(?, resolution), aspect_ratio = COALESCE(?, aspect_ratio), quality = COALESCE(?, quality) WHERE id = ?`);
    db.transaction(() => {
      for (const metadataRow of metadataRows) {
        let summary = {};
        try { summary = JSON.parse(String(metadataRow.summary_json || '{}')); } catch {}
        updateMetadata.run(summary.resolution || null, summary.aspectRatio || null, summary.quality || null, metadataRow.id);
      }
    })();
  }
  const legacyAgentCount = Number(db.prepare(`SELECT COUNT(*) count FROM canvas_tasks WHERE category <> 'image'`).get()?.count || 0);
  if (legacyAgentCount) {
    migrationBackupPath = `${resolvedPath}.pre-image-only-tasks-${Date.now()}.bak`;
    db.exec(`VACUUM INTO '${migrationBackupPath.replaceAll("'", "''")}'`);
    db.transaction(() => {
      db.prepare(`DELETE FROM canvas_task_heads WHERE latest_task_id IN (SELECT id FROM canvas_tasks WHERE category <> 'image')`).run();
      db.prepare(`DELETE FROM canvas_tasks WHERE category <> 'image'`).run();
    })();
  }
  const migration = db.prepare(`INSERT OR IGNORE INTO task_schema_migrations(version, name, applied_at) VALUES(?, ?, ?)`);
  migration.run(SCHEMA_VERSION, 'image-task-history-only', Date.now());
  const upsert = db.prepare(`INSERT INTO canvas_tasks (id, category, operation, canvas_id, node_id, row_id, provider_id, provider_name, model, executor_kind, resolution, aspect_ratio, quality, status, version, created_at, started_at, updated_at, completed_at, duration_ms, error_code, error_message, result_kind, input_fingerprint, application_status, input_json, result_json)
    VALUES (@id,@category,@operation,@canvasId,@nodeId,@rowId,@providerId,@providerName,@model,@executorKind,@resolution,@aspectRatio,@quality,@status,@version,@createdAt,@startedAt,@updatedAt,@completedAt,@durationMs,@errorCode,@errorMessage,@resultKind,@inputFingerprint,@applicationStatus,@inputJson,@resultJson)
    ON CONFLICT(id) DO UPDATE SET resolution=excluded.resolution, aspect_ratio=excluded.aspect_ratio, quality=excluded.quality, status=excluded.status, version=canvas_tasks.version+1, updated_at=excluded.updated_at, completed_at=excluded.completed_at, duration_ms=excluded.duration_ms, error_code=excluded.error_code, error_message=excluded.error_message, application_status=excluded.application_status, input_json=excluded.input_json, result_json=excluded.result_json`);
  const head = db.prepare(`INSERT INTO canvas_task_heads(scope_key, canvas_id, category, operation, node_id, row_id, latest_task_id, updated_at) VALUES(@scopeKey,@canvasId,@category,@operation,@nodeId,@rowId,@taskId,@updatedAt) ON CONFLICT(scope_key) DO UPDATE SET latest_task_id=excluded.latest_task_id, updated_at=excluded.updated_at`);
  const rowToTask = (row) => row ? ({ id: row.id, category: row.category, operation: row.operation, canvasId: row.canvas_id, nodeId: row.node_id, rowId: row.row_id || undefined, providerId: row.provider_id || undefined, providerName: row.provider_name || undefined, model: row.model || undefined, executorKind: row.executor_kind, resolution: row.resolution || undefined, aspectRatio: row.aspect_ratio || undefined, quality: row.quality || undefined, status: row.status, version: Number(row.version), createdAt: Number(row.created_at), startedAt: Number(row.started_at), updatedAt: Number(row.updated_at), completedAt: row.completed_at ? Number(row.completed_at) : undefined, durationMs: row.duration_ms ? Number(row.duration_ms) : undefined, errorCode: row.error_code || undefined, errorMessage: row.error_message || undefined, resultKind: row.result_kind, inputFingerprint: row.input_fingerprint || undefined, applicationStatus: row.application_status || undefined, input: row.input_json ? JSON.parse(row.input_json) : undefined, result: row.result_json ? JSON.parse(row.result_json) : undefined }) : null;
  const selectBase = `SELECT * FROM canvas_tasks`;
  function save(input, { setAsLatest = false } = {}) {
    const task = normalizeTask(input);
    const inputJson = task.input ? JSON.stringify(task.input) : null;
    const resultJson = task.result ? JSON.stringify(task.result) : null;
    if (inputJson && byteLength(inputJson) > MAX_INPUT_TEXT) throw new Error('Task input is too large to persist.');
    if (resultJson && byteLength(resultJson) > MAX_JSON_BYTES) throw new Error('Task result is too large to persist.');
    upsert.run({ ...task, rowId: task.rowId || null, providerId: task.providerId || null, providerName: task.providerName || null, model: task.model || null, completedAt: task.completedAt || null, durationMs: task.durationMs || null, errorCode: task.errorCode || null, errorMessage: task.errorMessage || null, inputFingerprint: task.inputFingerprint || null, applicationStatus: task.applicationStatus || null, inputJson, resultJson });
    if (setAsLatest) head.run({ scopeKey: targetKey(task), canvasId: task.canvasId, category: task.category, operation: task.operation, nodeId: task.nodeId, rowId: task.rowId || null, taskId: task.id, updatedAt: task.updatedAt });
    return task;
  }
  function get(id) { return rowToTask(db.prepare(`${selectBase} WHERE id = ? AND category = 'image'`).get(safeString(id))); }
  function listPage({ category, status = 'all', limit = 30, offset = 0 } = {}) {
    const where = ["category = 'image'"]; const params = [];
    if (category && category !== TASK_CATEGORIES.IMAGE) return { tasks: [], total: 0, counts: { all: 0, active: 0, succeeded: 0, exceptional: 0 } };
    const categoryPredicate = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const statusPredicates = {
      active: "status IN ('queued','running')",
      succeeded: "status = 'succeeded'",
      exceptional: "status IN ('failed','canceled','interrupted','superseded')",
    };
    const appendPredicate = (predicate, clause) => clause ? `${predicate}${predicate ? ' AND ' : ' WHERE '}${clause}` : predicate;
    const predicate = appendPredicate(categoryPredicate, statusPredicates[status] || '');
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 30)); const safeOffset = Math.max(0, Number(offset) || 0);
    const tasks = db.prepare(`${selectBase}${predicate} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, safeOffset).map(rowToTask);
    const counts = {}; for (const key of ['all', 'active', 'succeeded', 'exceptional']) { const countPredicate = appendPredicate(categoryPredicate, statusPredicates[key] || ''); counts[key] = Number(db.prepare(`SELECT COUNT(*) count FROM canvas_tasks${countPredicate}`).get(...params).count || 0); }
    return { tasks, total: counts[status] ?? counts.all, counts };
  }
  function listForCanvas(canvasId) { return db.prepare(`${selectBase} WHERE category = 'image' AND canvas_id = ? ORDER BY updated_at DESC`).all(safeString(canvasId)).map(rowToTask); }
  function listActive() { return db.prepare(`${selectBase} WHERE category = 'image' AND status IN ('queued','running')`).all().map(rowToTask); }
  function migrateLegacyImageTasks() {
    const legacyExists = Boolean(db.prepare(`SELECT 1 present FROM sqlite_master WHERE type='table' AND name='generation_tasks'`).get()?.present);
    if (!legacyExists) return { migratedCount: 0 };
    const rows = db.prepare(`SELECT task.id, task.canvas_id, task.target_kind, task.node_id, task.row_id, task.executor_kind, task.status, task.version, task.summary_json, task.created_at, task.updated_at, task.completed_at, result.result_json FROM generation_tasks task LEFT JOIN generation_task_results result ON result.task_id=task.id WHERE NOT EXISTS (SELECT 1 FROM canvas_tasks current WHERE current.id=task.id)`).all();
    let migratedCount = 0;
    const migrate = db.transaction(() => {
      for (const row of rows) {
        let summary = {}; let result = null;
        try { summary = JSON.parse(String(row.summary_json || '{}')); } catch {}
        try { result = row.result_json ? JSON.parse(String(row.result_json)) : null; } catch {}
        const stripDataUrls = (value) => {
          if (typeof value === 'string') return /^data:/i.test(value.trim()) ? undefined : value;
          if (Array.isArray(value)) return value.map(stripDataUrls).filter((item) => item !== undefined);
          if (!value || typeof value !== 'object') return value;
          return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) => {
            const clean = stripDataUrls(nested); return clean === undefined ? [] : [[key, clean]];
          }));
        };
        save({
          id: row.id, category: 'image', operation: row.target_kind === 'actionFissionRow' ? 'action_fission_generate' : 'image_generate',
          canvasId: row.canvas_id, nodeId: row.node_id, rowId: row.row_id || '', providerId: summary.providerId,
          providerName: summary.providerName, model: summary.model || summary.modelName, resolution: summary.resolution, aspectRatio: summary.aspectRatio, quality: summary.quality, executorKind: row.executor_kind, status: row.status === 'preparing' || row.status === 'submitting' || row.status === 'result_processing' ? 'running' : row.status,
          version: row.version, createdAt: row.created_at, startedAt: summary.startedAt || row.created_at, updatedAt: row.updated_at,
          completedAt: row.completed_at || undefined, durationMs: summary.durationMs, resultKind: 'image', result: stripDataUrls(result),
        }, { setAsLatest: true });
        migratedCount += 1;
      }
    });
    migrate();
    const missingCount = Number(db.prepare(`SELECT COUNT(*) count FROM generation_tasks legacy WHERE NOT EXISTS (SELECT 1 FROM canvas_tasks current WHERE current.id=legacy.id)`).get()?.count || 0);
    if (missingCount) throw new Error(`Canvas task migration left ${missingCount} legacy task(s) unmigrated.`);
    const integrity = safeString(db.pragma('integrity_check', { simple: true }));
    if (integrity.toLowerCase() !== 'ok') throw new Error(`Canvas task database integrity check failed: ${integrity}`);
    return { migratedCount };
  }
  function mirrorImageTask(dto = {}) {
    if (!dto?.id || !dto?.target?.canvasId || !dto?.target?.nodeId) return null;
    return save({
      id: dto.id, category: 'image', operation: dto.target.kind === 'actionFissionRow' ? 'action_fission_generate' : 'image_generate',
      canvasId: dto.target.canvasId, nodeId: dto.target.nodeId, rowId: dto.target.rowId || '', providerId: dto.providerId,
      providerName: dto.providerName, model: dto.model, executorKind: dto.executorKind, status: dto.status === 'preparing' || dto.status === 'submitting' || dto.status === 'result_processing' ? 'running' : dto.status,
      resolution: dto.resolution, aspectRatio: dto.aspectRatio, quality: dto.quality,
      version: dto.version, createdAt: dto.startedAt, startedAt: dto.startedAt, updatedAt: dto.updatedAt, completedAt: dto.completedAt,
      durationMs: dto.durationMs, errorCode: dto.errorCode, errorMessage: dto.errorMessage, resultKind: 'image',
      result: dto.result,
    }, { setAsLatest: true });
  }
  function cleanup({ now = Date.now(), retentionMs = {} } = {}) {
    const uniformRetentionMs = Number(retentionMs);
    const retention = Number.isFinite(uniformRetentionMs)
      ? { succeeded: uniformRetentionMs, failed: uniformRetentionMs, canceled: uniformRetentionMs, interrupted: uniformRetentionMs }
      : { succeeded: 7 * 86400000, failed: 14 * 86400000, canceled: 7 * 86400000, interrupted: 7 * 86400000, ...(retentionMs?.image || retentionMs || {}) };
    const terminalPredicate = `status IN ('succeeded','failed','canceled','interrupted','superseded') AND updated_at <= CASE status
      WHEN 'succeeded' THEN ? WHEN 'failed' THEN ? WHEN 'canceled' THEN ? ELSE ? END`;
    const orderedCutoffs = [now - retention.succeeded, now - retention.failed, now - retention.canceled, now - retention.interrupted];
    const deleted = db.transaction(() => {
      db.prepare(`DELETE FROM canvas_task_heads WHERE latest_task_id IN (SELECT id FROM canvas_tasks WHERE category = 'image' AND ${terminalPredicate})`).run(...orderedCutoffs);
      return db.prepare(`DELETE FROM canvas_tasks WHERE category = 'image' AND ${terminalPredicate} RETURNING id`).all(...orderedCutoffs).map((row) => row.id);
    })();
    db.pragma('wal_checkpoint(PASSIVE)'); return { deletedTaskIds: deleted, deletedCount: deleted.length };
  }
  function close() { db.close(); }
  return { cleanup, close, get, listActive, listForCanvas, listPage, migrateLegacyImageTasks, migrationBackupPath, mirrorImageTask, save, schemaVersion: SCHEMA_VERSION };
}

module.exports = { MAX_INPUT_TEXT, MAX_JSON_BYTES, MAX_RESULT_TEXT, SCHEMA_VERSION, createCanvasTaskRepository, normalizeTask, rejectUnsafe };
