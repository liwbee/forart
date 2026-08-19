const fs = require('node:fs');
const path = require('node:path');
const {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  normalizeTarget: normalizeDomainTarget,
  safeString,
  targetKey: domainTargetKey,
} = require('./generation-task-domain.cjs');

const SCHEMA_VERSION = 4;
const DATABASE_RELATIVE_PATH = path.join('CanvasAssests', 'tasks', 'generation-tasks.sqlite');
const SENSITIVE_PERSISTED_KEYS = new Set([
  'apikey',
  'xapikey',
  'authorization',
  'proxyauthorization',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'secret',
  'password',
  'credential',
  'credentials',
  'cookie',
  'setcookie',
]);
const TASK_SUMMARY_KEYS = new Set([
  'id',
  'canvasId',
  'target',
  'nodeId',
  'rowId',
  'kind',
  'providerId',
  'providerName',
  'model',
  'modelName',
  'resolution',
  'aspectRatio',
  'quality',
  'status',
  'startedAt',
  'runningAt',
  'remoteExecutionStartedAt',
  'updatedAt',
  'completedAt',
  'durationMs',
  'message',
  'messageCode',
  'messageParams',
  'error',
  'errorCode',
  'interruptReason',
  // Cleanup and recovery classification need these small remote anchors even
  // after the heavier active runtime has been discarded.
  'upstreamTaskId',
  'projectUuid',
  'remoteNodeId',
]);
const DEFAULT_RETENTION_MS = Object.freeze({
  succeeded: 7 * 24 * 60 * 60 * 1000,
  failed: 14 * 24 * 60 * 60 * 1000,
  canceled: 3 * 24 * 60 * 60 * 1000,
  interrupted: 7 * 24 * 60 * 60 * 1000,
  superseded: 7 * 24 * 60 * 60 * 1000,
  unsubmitted: 24 * 60 * 60 * 1000,
  orphaned: 24 * 60 * 60 * 1000,
});

function normalizeTarget(task = {}) {
  return normalizeDomainTarget(task, task.nodeId);
}

function targetKey(canvasId, target) {
  return domainTargetKey(canvasId, target);
}

function parsePayload(serialized) {
  try {
    const value = JSON.parse(String(serialized || ''));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function sanitizePersistedValue(value) {
  if (typeof value === 'string' && /^data:[^,]*;base64,/i.test(value.trim())) return undefined;
  if (Array.isArray(value)) {
    return value.map(sanitizePersistedValue).filter((nested) => nested !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (SENSITIVE_PERSISTED_KEYS.has(normalizedKey)) continue;
    const sanitizedNested = sanitizePersistedValue(nested);
    if (sanitizedNested !== undefined) sanitized[key] = sanitizedNested;
  }
  return sanitized;
}

function sanitizePersistedTask(task = {}) {
  const sanitized = sanitizePersistedValue(task);
  // Provider configuration is resolved from the encrypted configuration store
  // by id. It is execution context, never durable task history.
  delete sanitized.provider;
  return sanitized;
}

function splitPersistedTask(task = {}) {
  const summary = {};
  const runtime = {};
  for (const [key, value] of Object.entries(task)) {
    if (key === 'result' || value === undefined) continue;
    if (TASK_SUMMARY_KEYS.has(key)) summary[key] = value;
    else runtime[key] = value;
  }
  const result = task.result && typeof task.result === 'object'
    ? compactGenerationResult(task.result)
    : null;
  return {
    summary,
    runtime: Object.keys(runtime).length ? runtime : null,
    result,
  };
}

function recordFromRow(row) {
  const summary = parsePayload(row?.summary_json);
  if (!summary) return null;
  const runtime = parsePayload(row?.runtime_json);
  const normalizedResult = parsePayload(row?.result_json);
  const task = {
    ...(runtime || {}),
    ...summary,
    ...(normalizedResult ? { result: normalizedResult } : {}),
  };
  return {
    task,
    version: Number(row.version || 0),
    executorKind: row.executor_kind,
    resultCommitState: safeString(row.result_commit_state) || 'none',
    resultCommittedAt: Number(row.result_committed_at || 0) || undefined,
  };
}

function compactTerminalTask(task = {}) {
  const target = normalizeTarget(task);
  const compact = {
    id: safeString(task.id),
    canvasId: safeString(task.canvasId),
    target: target.kind === 'actionFissionRow'
      ? { type: target.kind, nodeId: target.nodeId, rowId: target.rowId }
      : { type: target.kind, nodeId: target.nodeId },
    status: safeString(task.status),
    startedAt: Number(task.startedAt || task.createdAt || 0),
    updatedAt: Number(task.updatedAt || 0),
  };
  const optionalStrings = [
    'kind',
    'providerId',
    'providerName',
    'model',
    'modelName',
    // Keep remote anchors on compact terminal tasks. Cleanup uses these to
    // distinguish an interrupted remote run from a task that never submitted.
    'upstreamTaskId',
    'projectUuid',
    'remoteNodeId',
    'resolution',
    'aspectRatio',
    'quality',
    'error',
    'errorCode',
    'interruptReason',
    'messageCode',
  ];
  for (const key of optionalStrings) {
    const value = safeString(task[key]);
    if (value) compact[key] = value;
  }
  if (task.messageParams && typeof task.messageParams === 'object') compact.messageParams = { ...task.messageParams };
  for (const key of ['runningAt', 'remoteExecutionStartedAt', 'completedAt', 'durationMs']) {
    const value = Number(task[key] || 0);
    if (value > 0 || (key === 'durationMs' && Number.isFinite(Number(task[key])))) compact[key] = Number(task[key]);
  }
  if (task.result && typeof task.result === 'object') {
    const compactResult = compactGenerationResult(task.result);
    if (compactResult) compact.result = compactResult;
  }
  return compact;
}

function compactGenerationResult(result = {}) {
  const compactImage = (image = {}) => {
    const localUrl = safeString(image.localUrl);
    const fallbackUrl = safeString(image.url);
    const url = /^data:/i.test(fallbackUrl) ? '' : fallbackUrl;
    const compact = {};
    if (url) compact.url = url;
    if (localUrl) compact.localUrl = localUrl;
    const thumbUrl = safeString(image.thumbUrl);
    if (thumbUrl && !/^data:/i.test(thumbUrl)) compact.thumbUrl = thumbUrl;
    const fileName = safeString(image.fileName);
    if (fileName) compact.fileName = fileName;
    for (const key of ['width', 'height']) {
      const value = Number(image[key]);
      if (Number.isFinite(value) && value > 0) compact[key] = value;
    }
    return compact;
  };

  const images = Array.isArray(result.results)
    ? result.results.map(compactImage).filter((image) => image.url || image.localUrl)
    : [];
  const first = compactImage(result);
  const compact = {};
  if (first.url || first.localUrl) Object.assign(compact, first);
  if (images.length) compact.results = images;
  return Object.keys(compact).length ? compact : null;
}

function createGenerationTaskRepository({ rootDir, databasePath, Database } = {}) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const resolvedPath = path.resolve(databasePath || path.join(resolvedRoot, DATABASE_RELATIVE_PATH));
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  if (!fs.existsSync(resolvedPath)) {
    // A user can intentionally reset task history by deleting the main SQLite
    // file while the app is closed. Orphaned sidecars belong to that old file.
    for (const sidecarPath of [`${resolvedPath}-wal`, `${resolvedPath}-shm`]) {
      try { fs.rmSync(sidecarPath, { force: true }); } catch {}
    }
  }
  const SqliteDatabase = Database || require('better-sqlite3');
  const db = new SqliteDatabase(resolvedPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const readSchemaVersionStatement = db.prepare(`SELECT value FROM generation_meta WHERE key = 'schema_version'`);
  const existingSchemaVersion = safeString(readSchemaVersionStatement.get()?.value);
  const hasExistingTaskSchema = Boolean(db.prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'generation_tasks'
  `).get()?.present);
  if ((existingSchemaVersion && existingSchemaVersion !== String(SCHEMA_VERSION))
    || (hasExistingTaskSchema && !existingSchemaVersion)) {
    db.close();
    throw new Error(
      `Unsupported generation task database schema (${existingSchemaVersion || 'legacy'}). `
      + `Close Forart and delete "${resolvedPath}" to rebuild the task database.`,
    );
  }

  db.exec(`
    INSERT INTO generation_meta (key, value)
    VALUES ('schema_version', '${SCHEMA_VERSION}')
    ON CONFLICT(key) DO NOTHING;

    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      node_id TEXT NOT NULL,
      row_id TEXT,
      executor_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      summary_json TEXT NOT NULL,
      result_commit_state TEXT NOT NULL DEFAULT 'none',
      result_committed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS generation_target_heads (
      target_key TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      node_id TEXT NOT NULL,
      row_id TEXT,
      latest_task_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (latest_task_id)
        REFERENCES generation_tasks(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_task_runtime (
      task_id TEXT PRIMARY KEY,
      runtime_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id)
        REFERENCES generation_tasks(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_task_results (
      task_id TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id)
        REFERENCES generation_tasks(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_task_assets (
      task_id TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      PRIMARY KEY (task_id, url, source),
      FOREIGN KEY (task_id)
        REFERENCES generation_tasks(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_generation_tasks_canvas
      ON generation_tasks(canvas_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_target
      ON generation_tasks(canvas_id, node_id, target_kind, row_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_status
      ON generation_tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_result_commit
      ON generation_tasks(result_commit_state, updated_at);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_canvas_status_updated
      ON generation_tasks(canvas_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_updated
      ON generation_tasks(updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_target_heads_canvas
      ON generation_target_heads(canvas_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_target_heads_task
      ON generation_target_heads(latest_task_id);
    CREATE INDEX IF NOT EXISTS idx_generation_task_assets_url
      ON generation_task_assets(url);
  `);
  const upsertTaskStatement = db.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, target_kind, node_id, row_id, executor_kind,
      status, version, summary_json, result_commit_state,
      created_at, updated_at, completed_at
    ) VALUES (
      @id, @canvasId, @targetKind, @nodeId, @rowId, @executorKind,
      @status, 1, @summaryJson, @resultCommitState,
      @createdAt, @updatedAt, @completedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      canvas_id = excluded.canvas_id,
      target_kind = excluded.target_kind,
      node_id = excluded.node_id,
      row_id = excluded.row_id,
      executor_kind = excluded.executor_kind,
      status = excluded.status,
      version = generation_tasks.version + 1,
      summary_json = excluded.summary_json,
      result_commit_state = CASE
        WHEN generation_tasks.result_commit_state = 'none' THEN excluded.result_commit_state
        ELSE generation_tasks.result_commit_state
      END,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at
  `);
  const upsertRuntimeStatement = db.prepare(`
    INSERT INTO generation_task_runtime (task_id, runtime_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      runtime_json = excluded.runtime_json,
      updated_at = excluded.updated_at
    WHERE generation_task_runtime.runtime_json IS NOT excluded.runtime_json
  `);
  const deleteRuntimeStatement = db.prepare(`DELETE FROM generation_task_runtime WHERE task_id = ?`);
  const upsertResultStatement = db.prepare(`
    INSERT INTO generation_task_results (task_id, result_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      result_json = excluded.result_json,
      updated_at = excluded.updated_at
    WHERE generation_task_results.result_json IS NOT excluded.result_json
  `);
  const deleteResultStatement = db.prepare(`DELETE FROM generation_task_results WHERE task_id = ?`);
  const upsertHeadStatement = db.prepare(`
    INSERT INTO generation_target_heads (
      target_key, canvas_id, target_kind, node_id, row_id, latest_task_id, updated_at
    ) VALUES (
      @targetKey, @canvasId, @targetKind, @nodeId, @rowId, @taskId, @updatedAt
    )
    ON CONFLICT(target_key) DO UPDATE SET
      latest_task_id = excluded.latest_task_id,
      updated_at = excluded.updated_at
  `);
  const listActiveRecordsStatement = db.prepare(`
    SELECT task.summary_json, task.version, task.executor_kind,
      task.result_commit_state, task.result_committed_at,
      runtime.runtime_json, result.result_json
    FROM generation_tasks task
    LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
    LEFT JOIN generation_task_results result ON result.task_id = task.id
    WHERE task.status IN ('queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing')
    ORDER BY task.created_at ASC, task.id ASC
  `);
  const listActiveRecordsForCanvasStatement = db.prepare(`
    SELECT task.summary_json, task.version, task.executor_kind,
      task.result_commit_state, task.result_committed_at,
      runtime.runtime_json, result.result_json
    FROM generation_tasks task
    LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
    LEFT JOIN generation_task_results result ON result.task_id = task.id
    WHERE task.canvas_id = ?
      AND task.status IN ('queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing')
    ORDER BY task.created_at ASC, task.id ASC
  `);
  const listActiveTaskRefsForCanvasStatement = db.prepare(`
    SELECT id, canvas_id, target_kind, node_id, row_id, executor_kind, status
    FROM generation_tasks
    WHERE canvas_id = ?
      AND status IN ('queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing')
    ORDER BY created_at ASC, id ASC
  `);
  const listLatestRecordsForCanvasStatement = db.prepare(`
    SELECT task.summary_json, task.version, task.executor_kind,
      task.result_commit_state, task.result_committed_at,
      runtime.runtime_json, result.result_json
    FROM generation_target_heads head
    INNER JOIN generation_tasks task ON task.id = head.latest_task_id
    LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
    LEFT JOIN generation_task_results result ON result.task_id = task.id
    WHERE head.canvas_id = ?
    ORDER BY head.updated_at ASC, head.target_key ASC
  `);
  const listTaskPageStatements = {
    all: db.prepare(`
      SELECT task.summary_json, task.version, task.executor_kind,
        task.result_commit_state, task.result_committed_at,
        runtime.runtime_json, result.result_json
      FROM generation_tasks task
      LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
      LEFT JOIN generation_task_results result ON result.task_id = task.id
      ORDER BY task.updated_at DESC, task.id DESC
      LIMIT ? OFFSET ?
    `),
    active: db.prepare(`
      SELECT task.summary_json, task.version, task.executor_kind,
        task.result_commit_state, task.result_committed_at,
        runtime.runtime_json, result.result_json
      FROM generation_tasks task
      LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
      LEFT JOIN generation_task_results result ON result.task_id = task.id
      WHERE task.status IN ('queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing')
      ORDER BY task.updated_at DESC, task.id DESC
      LIMIT ? OFFSET ?
    `),
    succeeded: db.prepare(`
      SELECT task.summary_json, task.version, task.executor_kind,
        task.result_commit_state, task.result_committed_at,
        runtime.runtime_json, result.result_json
      FROM generation_tasks task
      LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
      LEFT JOIN generation_task_results result ON result.task_id = task.id
      WHERE task.status = 'succeeded'
      ORDER BY task.updated_at DESC, task.id DESC
      LIMIT ? OFFSET ?
    `),
    exceptional: db.prepare(`
      SELECT task.summary_json, task.version, task.executor_kind,
        task.result_commit_state, task.result_committed_at,
        runtime.runtime_json, result.result_json
      FROM generation_tasks task
      LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
      LEFT JOIN generation_task_results result ON result.task_id = task.id
      WHERE task.status NOT IN ('queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing', 'succeeded')
      ORDER BY task.updated_at DESC, task.id DESC
      LIMIT ? OFFSET ?
    `),
  };
  const taskCountsStatement = db.prepare(`
    SELECT
      COUNT(*) AS all_count,
      SUM(CASE WHEN status IN ('queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing') THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_count,
      SUM(CASE WHEN status NOT IN ('queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing', 'succeeded') THEN 1 ELSE 0 END) AS exceptional_count
    FROM generation_tasks
  `);
  const getTaskStatusStatement = db.prepare(`SELECT status FROM generation_tasks WHERE id = ?`);
  const getStatement = db.prepare(`
    SELECT task.summary_json, task.version, task.executor_kind,
      task.result_commit_state, task.result_committed_at,
      runtime.runtime_json, result.result_json
    FROM generation_tasks task
    LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
    LEFT JOIN generation_task_results result ON result.task_id = task.id
    WHERE task.id = ?
  `);
  const resetCommittingResultStatements = db.prepare(`
    UPDATE generation_tasks
    SET result_commit_state = 'pending', updated_at = ?
    WHERE result_commit_state = 'committing'
  `);
  const listPendingResultCommitsStatement = db.prepare(`
    SELECT task.summary_json, task.version, task.executor_kind,
      task.result_commit_state, task.result_committed_at,
      runtime.runtime_json, result.result_json
    FROM generation_tasks task
    LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
    LEFT JOIN generation_task_results result ON result.task_id = task.id
    WHERE task.status IN ('succeeded', 'failed', 'canceled', 'interrupted', 'superseded')
      AND task.result_commit_state IN ('none', 'pending')
    ORDER BY task.updated_at ASC, task.id ASC
  `);
  const beginResultCommitStatement = db.prepare(`
    UPDATE generation_tasks
    SET result_commit_state = 'committing', updated_at = ?
    WHERE id = ? AND result_commit_state IN ('none', 'pending')
  `);
  const finishResultCommitStatement = db.prepare(`
    UPDATE generation_tasks
    SET result_commit_state = ?, result_committed_at = ?, updated_at = ?
    WHERE id = ? AND result_commit_state = 'committing'
  `);
  const getHeadStatement = db.prepare(`
    SELECT latest_task_id
    FROM generation_target_heads
    WHERE target_key = ?
  `);
  const listTargetHeadsStatement = db.prepare(`
    SELECT head.target_key, head.canvas_id, head.target_kind, head.node_id,
      head.row_id, head.latest_task_id, task.status
    FROM generation_target_heads head
    INNER JOIN generation_tasks task ON task.id = head.latest_task_id
  `);
  const listActiveTargetHeadsStatement = db.prepare(`
    SELECT head.target_key, head.canvas_id, head.target_kind, head.node_id,
      head.row_id, head.latest_task_id, task.status
    FROM generation_target_heads head
    INNER JOIN generation_tasks task ON task.id = head.latest_task_id
    WHERE task.status IN ('queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing')
  `);
  const listTargetHeadsForCanvasStatement = db.prepare(`
    SELECT head.target_key, head.canvas_id, head.target_kind, head.node_id,
      head.row_id, head.latest_task_id, task.status
    FROM generation_target_heads head
    INNER JOIN generation_tasks task ON task.id = head.latest_task_id
    WHERE head.canvas_id = ?
    ORDER BY head.updated_at ASC, head.target_key ASC
  `);
  const deleteTaskAssetReferencesStatement = db.prepare(`DELETE FROM generation_task_assets WHERE task_id = ?`);
  const insertTaskAssetReferenceStatement = db.prepare(`
    INSERT OR IGNORE INTO generation_task_assets (task_id, url, source, canvas_id, node_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const listTaskAssetReferencesStatement = db.prepare(`
    SELECT url, canvas_id, node_id, source
    FROM generation_task_assets
  `);
  const getMetaStatement = db.prepare(`SELECT value FROM generation_meta WHERE key = ?`);
  const setMetaStatement = db.prepare(`
    INSERT INTO generation_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  let taskCountsCache = null;
  const taskCountCategory = (status) => {
    const value = safeString(status);
    if (ACTIVE_STATUSES.has(value)) return 'active';
    if (value === 'succeeded') return 'succeeded';
    return 'exceptional';
  };
  const readTaskCounts = () => {
    if (taskCountsCache) return { ...taskCountsCache };
    const row = taskCountsStatement.get() || {};
    taskCountsCache = {
      all: Number(row.all_count || 0),
      active: Number(row.active_count || 0),
      succeeded: Number(row.succeeded_count || 0),
      exceptional: Number(row.exceptional_count || 0),
    };
    return { ...taskCountsCache };
  };
  const updateTaskCounts = (previousStatus, nextStatus) => {
    if (!taskCountsCache) return;
    const previous = safeString(previousStatus);
    const next = safeString(nextStatus);
    if (!previous) taskCountsCache.all += 1;
    if (previous && taskCountCategory(previous) !== taskCountCategory(next)) {
      taskCountsCache[taskCountCategory(previous)] = Math.max(0, taskCountsCache[taskCountCategory(previous)] - 1);
    }
    if (!previous || taskCountCategory(previous) !== taskCountCategory(next)) {
      taskCountsCache[taskCountCategory(next)] += 1;
    }
  };
  const removeTaskCounts = (statuses = []) => {
    if (!taskCountsCache) return;
    for (const status of statuses) {
      taskCountsCache.all = Math.max(0, taskCountsCache.all - 1);
      const category = taskCountCategory(status);
      taskCountsCache[category] = Math.max(0, taskCountsCache[category] - 1);
    }
  };
  const replaceTaskAssetReferences = (taskId, fragments, metadata) => {
    deleteTaskAssetReferencesStatement.run(taskId);
    const insert = (url, source) => {
      const value = safeString(url);
      if (!value || /^data:/i.test(value)) return;
      insertTaskAssetReferenceStatement.run(
        taskId,
        value,
        source,
        safeString(metadata.canvasId),
        safeString(metadata.nodeId),
      );
    };
    for (const url of Array.isArray(fragments.runtime?.referenceImages) ? fragments.runtime.referenceImages : []) {
      insert(url, 'task.referenceImages');
    }
    if (fragments.result && typeof fragments.result === 'object') {
      insert(fragments.result.localUrl, 'task.result.localUrl');
      for (const image of Array.isArray(fragments.result.results) ? fragments.result.results : []) {
        insert(image?.localUrl, 'task.result.results.localUrl');
      }
    }
  };
  const writeTaskFragments = (taskId, fragments, timestamp, metadata) => {
    let runtimeChanged = false;
    if (fragments.runtime) {
      runtimeChanged = upsertRuntimeStatement.run(taskId, JSON.stringify(fragments.runtime), timestamp).changes > 0;
    } else {
      runtimeChanged = deleteRuntimeStatement.run(taskId).changes > 0;
    }
    let resultChanged = false;
    if (fragments.result) {
      resultChanged = upsertResultStatement.run(taskId, JSON.stringify(fragments.result), timestamp).changes > 0;
    } else {
      resultChanged = deleteResultStatement.run(taskId).changes > 0;
    }
    if (runtimeChanged || resultChanged) replaceTaskAssetReferences(taskId, fragments, metadata);
  };
  const saveTransaction = db.transaction((task, options) => {
    const id = safeString(task?.id);
    if (!id) throw new Error('Generation task id is required.');
    const executorKind = options.executorKind === 'libtv' ? 'libtv' : 'api';
    const canvasId = safeString(task.canvasId);
    const target = normalizeTarget(task);
    const timestamp = Number(task.updatedAt || Date.now());
    const completedAt = Number(task.completedAt || 0) || null;
    const previousStatus = safeString(getTaskStatusStatement.get(id)?.status);
    const nextStatus = safeString(task.status) || 'queued';
    const fragments = splitPersistedTask(task);
    upsertTaskStatement.run({
      id,
      canvasId,
      targetKind: target.kind,
      nodeId: target.nodeId,
      rowId: target.rowId || null,
      executorKind,
      status: nextStatus,
      summaryJson: JSON.stringify(fragments.summary),
      resultCommitState: safeString(task.resultCommitState) || 'none',
      createdAt: Number(task.startedAt || timestamp),
      updatedAt: timestamp,
      completedAt,
    });
    writeTaskFragments(id, fragments, timestamp, { canvasId, nodeId: target.nodeId });
    const key = targetKey(canvasId, target);
    if (options.setAsLatest && key) {
      upsertHeadStatement.run({
        targetKey: key,
        canvasId,
        targetKind: target.kind,
        nodeId: target.nodeId,
        rowId: target.rowId || null,
        taskId: id,
        updatedAt: timestamp,
      });
    }
    return { row: getStatement.get(id), previousStatus, nextStatus };
  });
  const preparePendingResultCommitsTransaction = db.transaction((timestamp) => {
    resetCommittingResultStatements.run(timestamp);
    return listPendingResultCommitsStatement.all().map(recordFromRow).filter(Boolean);
  });
  const removeTargetHeadsTransaction = db.transaction((targetKeys, timestamp) => {
    const keys = [...new Set(targetKeys.map(safeString).filter(Boolean))];
    if (!keys.length) return [];
    const taskIds = [];
    const chunkSize = 400;
    for (let offset = 0; offset < keys.length; offset += chunkSize) {
      const chunk = keys.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      const heads = db.prepare(`
        SELECT latest_task_id
        FROM generation_target_heads
        WHERE target_key IN (${placeholders})
      `).all(...chunk);
      if (!heads.length) continue;
      db.prepare(`
        DELETE FROM generation_target_heads
        WHERE target_key IN (${placeholders})
      `).run(...chunk);
      taskIds.push(...heads.map((head) => String(head.latest_task_id)).filter(Boolean));
    }
    for (let offset = 0; offset < taskIds.length; offset += chunkSize) {
      const taskChunk = taskIds.slice(offset, offset + chunkSize);
      const taskPlaceholders = taskChunk.map(() => '?').join(', ');
      db.prepare(`
        UPDATE generation_tasks
        SET result_commit_state = 'discarded', result_committed_at = ?, updated_at = ?
        WHERE id IN (${taskPlaceholders})
          AND status IN ('succeeded', 'failed', 'canceled', 'interrupted', 'superseded')
          AND result_commit_state IN ('none', 'pending', 'committing')
      `).run(timestamp, timestamp, ...taskChunk);
    }
    return taskIds;
  });

  let closed = false;

  function assertOpen() {
    if (closed) throw new Error('Generation task repository is closed.');
  }

  function saveTask(task, { executorKind, setAsLatest = false } = {}) {
    assertOpen();
    const sanitizedTask = sanitizePersistedTask(task);
    const persistableTask = TERMINAL_STATUSES.has(safeString(sanitizedTask?.status))
      ? compactTerminalTask(sanitizedTask)
      : sanitizedTask;
    const saved = saveTransaction(persistableTask, { executorKind, setAsLatest });
    updateTaskCounts(saved.previousStatus, saved.nextStatus);
    return recordFromRow(saved.row);
  }

  function getTask(taskId) {
    assertOpen();
    return recordFromRow(getStatement.get(safeString(taskId)));
  }

  function getTasks(taskIds = []) {
    assertOpen();
    const ids = [...new Set((Array.isArray(taskIds) ? taskIds : []).map(safeString).filter(Boolean))];
    const recordsById = new Map();
    const chunkSize = 400;
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = db.prepare(`
        SELECT task.id, task.summary_json, task.version, task.executor_kind,
          task.result_commit_state, task.result_committed_at,
          runtime.runtime_json, result.result_json
        FROM generation_tasks task
        LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
        LEFT JOIN generation_task_results result ON result.task_id = task.id
        WHERE task.id IN (${placeholders})
      `).all(...chunk);
      for (const row of rows) {
        const record = recordFromRow(row);
        if (record) recordsById.set(String(row.id), record);
      }
    }
    return ids.map((taskId) => recordsById.get(taskId)).filter(Boolean);
  }

  function listTaskAssetReferences() {
    assertOpen();
    return listTaskAssetReferencesStatement.all().map((row) => ({
      url: safeString(row.url),
      canvasId: safeString(row.canvas_id),
      nodeId: safeString(row.node_id),
      source: safeString(row.source),
    }));
  }

  function listActiveTaskRecords({ canvasId } = {}) {
    assertOpen();
    const safeCanvasId = safeString(canvasId);
    const rows = safeCanvasId
      ? listActiveRecordsForCanvasStatement.all(safeCanvasId)
      : listActiveRecordsStatement.all();
    return rows.map(recordFromRow).filter(Boolean);
  }

  function listActiveTaskRefsForCanvas(canvasId) {
    assertOpen();
    return listActiveTaskRefsForCanvasStatement.all(safeString(canvasId)).map((row) => ({
      id: String(row.id),
      canvasId: String(row.canvas_id),
      executorKind: String(row.executor_kind),
      status: String(row.status),
      target: row.target_kind === 'actionFissionRow'
        ? { type: 'actionFissionRow', nodeId: String(row.node_id), rowId: String(row.row_id || '') }
        : { type: 'imageGenerator', nodeId: String(row.node_id) },
    }));
  }

  function listLatestTaskRecordsForCanvas(canvasId) {
    assertOpen();
    const safeCanvasId = safeString(canvasId);
    if (!safeCanvasId) return [];
    return listLatestRecordsForCanvasStatement.all(safeCanvasId).map(recordFromRow).filter(Boolean);
  }

  function listTaskPage({ filter = 'all', limit = 30, offset = 0 } = {}) {
    assertOpen();
    const safeFilter = Object.hasOwn(listTaskPageStatements, filter) ? filter : 'all';
    const safeLimit = Math.min(500, Math.max(1, Math.round(Number(limit) || 30)));
    const safeOffset = Math.max(0, Math.round(Number(offset) || 0));
    const counts = readTaskCounts();
    return {
      records: listTaskPageStatements[safeFilter].all(safeLimit, safeOffset).map(recordFromRow).filter(Boolean),
      total: counts[safeFilter],
      counts,
    };
  }

  function latestTaskIdForTarget(canvasId, target) {
    assertOpen();
    const normalized = normalizeTarget({ target });
    const key = targetKey(canvasId, normalized);
    return key ? safeString(getHeadStatement.get(key)?.latest_task_id) : '';
  }

  function beginResultCommit(taskId) {
    assertOpen();
    return beginResultCommitStatement.run(Date.now(), safeString(taskId)).changes === 1;
  }

  function finishResultCommit(taskId, outcome) {
    assertOpen();
    const timestamp = Date.now();
    const state = outcome === true || outcome === 'committed'
      ? 'committed'
      : outcome === 'discarded' ? 'discarded' : 'pending';
    return finishResultCommitStatement.run(
      state,
      state === 'committed' || state === 'discarded' ? timestamp : null,
      timestamp,
      safeString(taskId),
    ).changes === 1;
  }

  function preparePendingResultCommits() {
    assertOpen();
    return preparePendingResultCommitsTransaction(Date.now());
  }

  function getMeta(key) {
    assertOpen();
    return safeString(getMetaStatement.get(safeString(key))?.value);
  }

  function setMeta(key, value) {
    assertOpen();
    return setMetaStatement.run(safeString(key), String(value ?? '')).changes === 1;
  }

  function cleanupTerminalHistory({ now = Date.now(), retentionMs = {}, orphanedTaskIds = [] } = {}) {
    assertOpen();
    const timestamp = Number(now) || Date.now();
    const retention = { ...DEFAULT_RETENTION_MS, ...(retentionMs || {}) };
    const orphaned = [...new Set((Array.isArray(orphanedTaskIds) ? orphanedTaskIds : [])
      .map(safeString)
      .filter(Boolean))];
    const orphanedCte = orphaned.length
      ? `VALUES ${orphaned.map((_, index) => `(@orphan${index})`).join(', ')}`
      : 'SELECT NULL WHERE 0';
    const remoteAnchor = (key) => `NULLIF(TRIM(CASE
      WHEN json_valid(task.summary_json) THEN CAST(json_extract(task.summary_json, '$.${key}') AS TEXT)
      ELSE ''
    END), '')`;
    const deleteExpiredStatement = db.prepare(`
      WITH orphaned(id) AS (${orphanedCte}),
      candidates AS (
        SELECT task.id, task.status,
          COALESCE(task.completed_at, task.updated_at) AS terminal_at,
          EXISTS (SELECT 1 FROM orphaned WHERE orphaned.id = task.id) AS is_orphaned,
          task.status IN ('interrupted', 'superseded')
            AND COALESCE(
              ${remoteAnchor('upstreamTaskId')},
              ${remoteAnchor('projectUuid')},
              ${remoteAnchor('remoteNodeId')}
            ) IS NULL AS is_unsubmitted
        FROM generation_tasks task
        WHERE NOT EXISTS (
          SELECT 1 FROM generation_target_heads head WHERE head.latest_task_id = task.id
        )
          AND task.status IN ('succeeded', 'failed', 'canceled', 'interrupted', 'superseded')
          AND task.result_commit_state NOT IN ('pending', 'committing')
          AND (task.status <> 'succeeded' OR task.result_commit_state IN ('committed', 'discarded'))
      )
      DELETE FROM generation_tasks
      WHERE id IN (
        SELECT id
        FROM candidates
        WHERE terminal_at > 0
          AND terminal_at <= CASE
            WHEN is_orphaned THEN @orphanedCutoff
            WHEN is_unsubmitted THEN @unsubmittedCutoff
            WHEN status = 'succeeded' THEN @succeededCutoff
            WHEN status = 'failed' THEN @failedCutoff
            WHEN status = 'canceled' THEN @canceledCutoff
            WHEN status = 'interrupted' THEN @interruptedCutoff
            WHEN status = 'superseded' THEN @supersededCutoff
          END
      )
      RETURNING id, status
    `);
    const parameters = {
      orphanedCutoff: timestamp - Math.max(0, Number(retention.orphaned) || 0),
      unsubmittedCutoff: timestamp - Math.max(0, Number(retention.unsubmitted) || 0),
      succeededCutoff: timestamp - Math.max(0, Number(retention.succeeded) || 0),
      failedCutoff: timestamp - Math.max(0, Number(retention.failed) || 0),
      canceledCutoff: timestamp - Math.max(0, Number(retention.canceled) || 0),
      interruptedCutoff: timestamp - Math.max(0, Number(retention.interrupted) || 0),
      supersededCutoff: timestamp - Math.max(0, Number(retention.superseded) || 0),
    };
    orphaned.forEach((taskId, index) => { parameters[`orphan${index}`] = taskId; });
    const deletedRows = db.transaction(() => deleteExpiredStatement.all(parameters))();
    const deletedTaskIds = deletedRows.map((row) => String(row.id));
    removeTaskCounts(deletedRows.map((row) => row.status));
    setMeta('last_cleanup_at', timestamp);
    db.pragma('wal_checkpoint(PASSIVE)');
    db.pragma('incremental_vacuum(200)');
    return { compactedCount: 0, deletedCount: deletedTaskIds.length, deletedTaskIds };
  }

  function databaseSizeBytes() {
    assertOpen();
    return [resolvedPath, `${resolvedPath}-wal`, `${resolvedPath}-shm`].reduce((total, filePath) => {
      try {
        return total + fs.statSync(filePath).size;
      } catch {
        return total;
      }
    }, 0);
  }

  function listTargetHeads() {
    assertOpen();
    return listTargetHeadsStatement.all().map(targetHeadFromRow);
  }

  function targetHeadFromRow(row) {
    return {
      targetKey: String(row.target_key),
      canvasId: String(row.canvas_id),
      taskId: String(row.latest_task_id),
      status: String(row.status),
      target: row.target_kind === 'actionFissionRow'
        ? { type: 'actionFissionRow', nodeId: String(row.node_id), rowId: String(row.row_id || '') }
        : { type: 'imageGenerator', nodeId: String(row.node_id) },
    };
  }

  function listActiveTargetHeads() {
    assertOpen();
    return listActiveTargetHeadsStatement.all().map(targetHeadFromRow);
  }

  function listTargetHeadsForCanvas(canvasId) {
    assertOpen();
    return listTargetHeadsForCanvasStatement.all(safeString(canvasId)).map(targetHeadFromRow);
  }

  function removeTargetHeads(targetKeys = [], now = Date.now()) {
    assertOpen();
    const keys = Array.isArray(targetKeys) ? targetKeys.map(safeString).filter(Boolean) : [];
    return removeTargetHeadsTransaction(keys, Number(now) || Date.now());
  }

  function removeTargetHeadsForCanvas(canvasId, now = Date.now()) {
    assertOpen();
    const targetKeys = listTargetHeadsForCanvas(canvasId).map((head) => head.targetKey);
    return removeTargetHeads(targetKeys, now);
  }

  function close() {
    if (closed) return;
    closed = true;
    db.close();
  }

  return {
    close,
    beginResultCommit,
    databasePath: resolvedPath,
    databaseSizeBytes,
    getTasks,
    getTask,
    finishResultCommit,
    cleanupTerminalHistory,
    getMeta,
    latestTaskIdForTarget,
    listTaskAssetReferences,
    listActiveTaskRecords,
    listActiveTaskRefsForCanvas,
    listLatestTaskRecordsForCanvas,
    listTaskPage,
    listActiveTargetHeads,
    listTargetHeads,
    listTargetHeadsForCanvas,
    preparePendingResultCommits,
    removeTargetHeads,
    removeTargetHeadsForCanvas,
    saveTask,
    setMeta,
  };
}

module.exports = {
  DATABASE_RELATIVE_PATH,
  DEFAULT_RETENTION_MS,
  SCHEMA_VERSION,
  compactTerminalTask,
  compactGenerationResult,
  createGenerationTaskRepository,
  sanitizePersistedTask,
  targetKey,
};
