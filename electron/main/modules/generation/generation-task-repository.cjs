const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const DATABASE_RELATIVE_PATH = path.join('CanvasAssests', 'tasks', 'generation-tasks.sqlite');
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled', 'interrupted', 'superseded']);
const DEFAULT_RETENTION_MS = Object.freeze({
  succeeded: 7 * 24 * 60 * 60 * 1000,
  failed: 14 * 24 * 60 * 60 * 1000,
  canceled: 3 * 24 * 60 * 60 * 1000,
  interrupted: 7 * 24 * 60 * 60 * 1000,
  superseded: 7 * 24 * 60 * 60 * 1000,
  unsubmitted: 24 * 60 * 60 * 1000,
  orphaned: 24 * 60 * 60 * 1000,
});

function safeString(value) {
  return String(value || '').trim();
}

function normalizeTarget(task = {}) {
  const target = task.target && typeof task.target === 'object' ? task.target : {};
  const nodeId = safeString(target.nodeId || task.nodeId);
  const rowId = safeString(target.rowId || task.rowId);
  const kind = target.type === 'actionFissionRow' && rowId ? 'actionFissionRow' : 'imageGenerator';
  return { kind, nodeId, rowId: kind === 'actionFissionRow' ? rowId : '' };
}

function targetKey(canvasId, target) {
  const canvas = safeString(canvasId);
  if (!canvas || !target.nodeId) return '';
  const base = `canvas:${canvas}/node:${target.nodeId}`;
  return target.kind === 'actionFissionRow' ? `${base}/row:${target.rowId}` : base;
}

function parsePayload(serialized) {
  try {
    const value = JSON.parse(String(serialized || ''));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function recordFromRow(row) {
  const task = parsePayload(row?.payload_json);
  return task ? {
    task,
    version: Number(row.version || 0),
    executorKind: row.executor_kind,
    resultCommitState: safeString(row.result_commit_state) || 'none',
    resultCommittedAt: Number(row.result_committed_at || 0) || undefined,
  } : null;
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
  for (const key of ['runningAt', 'completedAt', 'durationMs']) {
    const value = Number(task[key] || 0);
    if (value > 0 || (key === 'durationMs' && Number.isFinite(Number(task[key])))) compact[key] = Number(task[key]);
  }
  if (task.result && typeof task.result === 'object') compact.result = { ...task.result };
  return compact;
}

function hasRemoteAnchor(task = {}) {
  return Boolean(
    safeString(task.upstreamTaskId)
    || safeString(task.projectUuid)
    || safeString(task.remoteNodeId),
  );
}

function createGenerationTaskRepository({ rootDir, databasePath, Database } = {}) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const resolvedPath = path.resolve(databasePath || path.join(resolvedRoot, DATABASE_RELATIVE_PATH));
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
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

    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      node_id TEXT NOT NULL,
      row_id TEXT,
      executor_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_generation_tasks_canvas
      ON generation_tasks(canvas_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_target
      ON generation_tasks(canvas_id, node_id, target_kind, row_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_status
      ON generation_tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_result_commit
      ON generation_tasks(result_commit_state, updated_at);
  `);

  db.prepare(`
    INSERT INTO generation_meta (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SCHEMA_VERSION));

  const upsertTaskStatement = db.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, target_kind, node_id, row_id, executor_kind,
      status, version, payload_json, result_commit_state,
      created_at, updated_at, completed_at
    ) VALUES (
      @id, @canvasId, @targetKind, @nodeId, @rowId, @executorKind,
      @status, 1, @payloadJson, @resultCommitState,
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
      payload_json = excluded.payload_json,
      result_commit_state = CASE
        WHEN generation_tasks.result_commit_state = 'none' THEN excluded.result_commit_state
        ELSE generation_tasks.result_commit_state
      END,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at
  `);
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
  const listByExecutorStatement = db.prepare(`
    SELECT payload_json, version, executor_kind
    FROM generation_tasks
    WHERE executor_kind = ?
    ORDER BY created_at ASC, id ASC
  `);
  const listRecordsStatement = db.prepare(`
    SELECT payload_json, version, executor_kind, result_commit_state, result_committed_at
    FROM generation_tasks
    ORDER BY created_at ASC, id ASC
  `);
  const getStatement = db.prepare(`
    SELECT payload_json, version, executor_kind, result_commit_state, result_committed_at
    FROM generation_tasks
    WHERE id = ?
  `);
  const resetCommittingResultStatements = db.prepare(`
    UPDATE generation_tasks
    SET result_commit_state = 'pending', updated_at = ?
    WHERE result_commit_state = 'committing'
  `);
  const listPendingResultCommitsStatement = db.prepare(`
    SELECT payload_json, version, executor_kind, result_commit_state, result_committed_at
    FROM generation_tasks
    WHERE status IN ('succeeded', 'failed', 'canceled', 'interrupted', 'superseded')
      AND result_commit_state IN ('none', 'pending')
    ORDER BY updated_at ASC, id ASC
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
  const listHeadTaskRowsStatement = db.prepare(`
    SELECT task.id, task.payload_json, task.version, task.executor_kind,
      task.result_commit_state, task.result_committed_at
    FROM generation_tasks task
    INNER JOIN generation_target_heads head ON head.latest_task_id = task.id
  `);
  const listTargetHeadsStatement = db.prepare(`
    SELECT head.target_key, head.canvas_id, head.target_kind, head.node_id,
      head.row_id, head.latest_task_id, task.status
    FROM generation_target_heads head
    INNER JOIN generation_tasks task ON task.id = head.latest_task_id
  `);
  const getTargetHeadStatement = db.prepare(`
    SELECT target_key, latest_task_id FROM generation_target_heads WHERE target_key = ?
  `);
  const deleteTargetHeadStatement = db.prepare(`DELETE FROM generation_target_heads WHERE target_key = ?`);
  const discardOrphanedTerminalStatement = db.prepare(`
    UPDATE generation_tasks
    SET result_commit_state = 'discarded', result_committed_at = ?, updated_at = ?
    WHERE id = ?
      AND status IN ('succeeded', 'failed', 'canceled', 'interrupted', 'superseded')
      AND result_commit_state IN ('none', 'pending', 'committing')
  `);
  const listCleanupCandidateRowsStatement = db.prepare(`
    SELECT task.id, task.status, task.payload_json, task.version, task.executor_kind,
      task.result_commit_state, task.result_committed_at,
      task.updated_at, task.completed_at
    FROM generation_tasks task
    LEFT JOIN generation_target_heads head ON head.latest_task_id = task.id
    WHERE head.latest_task_id IS NULL
      AND task.status IN ('succeeded', 'failed', 'canceled', 'interrupted', 'superseded')
  `);
  const updatePayloadStatement = db.prepare(`
    UPDATE generation_tasks SET payload_json = ? WHERE id = ?
  `);
  const deleteTaskStatement = db.prepare(`DELETE FROM generation_tasks WHERE id = ?`);
  const getMetaStatement = db.prepare(`SELECT value FROM generation_meta WHERE key = ?`);
  const setMetaStatement = db.prepare(`
    INSERT INTO generation_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const saveTransaction = db.transaction((task, options) => {
    const id = safeString(task?.id);
    if (!id) throw new Error('Generation task id is required.');
    const executorKind = options.executorKind === 'libtv' ? 'libtv' : 'api';
    const canvasId = safeString(task.canvasId);
    const target = normalizeTarget(task);
    const timestamp = Number(task.updatedAt || Date.now());
    const completedAt = Number(task.completedAt || 0) || null;
    upsertTaskStatement.run({
      id,
      canvasId,
      targetKind: target.kind,
      nodeId: target.nodeId,
      rowId: target.rowId || null,
      executorKind,
      status: safeString(task.status) || 'queued',
      payloadJson: JSON.stringify(task),
      resultCommitState: safeString(task.resultCommitState) || 'none',
      createdAt: Number(task.startedAt || timestamp),
      updatedAt: timestamp,
      completedAt,
    });
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
    return getStatement.get(id);
  });
  const preparePendingResultCommitsTransaction = db.transaction((timestamp) => {
    resetCommittingResultStatements.run(timestamp);
    return listPendingResultCommitsStatement.all().map(recordFromRow).filter(Boolean);
  });
  const compactHeadTasksTransaction = db.transaction(() => {
    let compactedCount = 0;
    for (const row of listHeadTaskRowsStatement.all()) {
      const record = recordFromRow(row);
      if (!record || !TERMINAL_STATUSES.has(safeString(record.task.status))) continue;
      if (!['committed', 'discarded'].includes(record.resultCommitState)) continue;
      const compacted = compactTerminalTask(record.task);
      const serialized = JSON.stringify(compacted);
      if (serialized === String(row.payload_json || '')) continue;
      updatePayloadStatement.run(serialized, row.id);
      compactedCount += 1;
    }
    return compactedCount;
  });
  const deleteTasksTransaction = db.transaction((taskIds) => {
    let deletedCount = 0;
    for (const taskId of taskIds) deletedCount += deleteTaskStatement.run(taskId).changes;
    return deletedCount;
  });
  const removeTargetHeadsTransaction = db.transaction((targetKeys, timestamp) => {
    const removedTaskIds = [];
    for (const targetKeyValue of targetKeys) {
      const head = getTargetHeadStatement.get(targetKeyValue);
      if (!head) continue;
      if (deleteTargetHeadStatement.run(targetKeyValue).changes !== 1) continue;
      discardOrphanedTerminalStatement.run(timestamp, timestamp, head.latest_task_id);
      removedTaskIds.push(String(head.latest_task_id));
    }
    return removedTaskIds;
  });

  let closed = false;

  function assertOpen() {
    if (closed) throw new Error('Generation task repository is closed.');
  }

  function saveTask(task, { executorKind, setAsLatest = false } = {}) {
    assertOpen();
    const row = saveTransaction(task, { executorKind, setAsLatest });
    return { task: parsePayload(row?.payload_json), version: Number(row?.version || 0) };
  }

  function getTask(taskId) {
    assertOpen();
    return recordFromRow(getStatement.get(safeString(taskId)));
  }

  function listTasks(executorKind) {
    assertOpen();
    const kind = executorKind === 'libtv' ? 'libtv' : 'api';
    return listByExecutorStatement.all(kind).map((row) => parsePayload(row.payload_json)).filter(Boolean);
  }

  function listTaskRecords({ canvasId, executorKind, statuses } = {}) {
    assertOpen();
    const safeCanvasId = safeString(canvasId);
    const safeExecutorKind = executorKind ? (executorKind === 'libtv' ? 'libtv' : 'api') : '';
    const statusSet = Array.isArray(statuses) && statuses.length
      ? new Set(statuses.map(safeString).filter(Boolean))
      : null;
    return listRecordsStatement.all().map(recordFromRow).filter((record) => (
      record
      && (!safeCanvasId || safeString(record.task.canvasId) === safeCanvasId)
      && (!safeExecutorKind || record.executorKind === safeExecutorKind)
      && (!statusSet || statusSet.has(safeString(record.task.status)))
    ));
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
    const orphaned = new Set(Array.isArray(orphanedTaskIds) ? orphanedTaskIds.map(String) : []);
    const deletedTaskIds = [];
    for (const row of listCleanupCandidateRowsStatement.all()) {
      const record = recordFromRow(row);
      if (!record) continue;
      if (['pending', 'committing'].includes(record.resultCommitState)) continue;
      if (row.status === 'succeeded' && !['committed', 'discarded'].includes(record.resultCommitState)) continue;
      const unsubmitted = !hasRemoteAnchor(record.task) && ['interrupted', 'superseded'].includes(row.status);
      const retentionKey = orphaned.has(String(row.id)) ? 'orphaned' : unsubmitted ? 'unsubmitted' : row.status;
      const keepFor = Math.max(0, Number(retention[retentionKey]) || 0);
      const terminalAt = Number(row.completed_at || row.updated_at || record.task.completedAt || record.task.updatedAt || 0);
      if (!terminalAt || timestamp - terminalAt < keepFor) continue;
      deletedTaskIds.push(String(row.id));
    }
    const deletedCount = deleteTasksTransaction(deletedTaskIds);
    const compactedCount = compactHeadTasksTransaction();
    setMeta('last_cleanup_at', timestamp);
    db.pragma('wal_checkpoint(PASSIVE)');
    db.pragma('incremental_vacuum(200)');
    return { compactedCount, deletedCount, deletedTaskIds };
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
    return listTargetHeadsStatement.all().map((row) => ({
      targetKey: String(row.target_key),
      canvasId: String(row.canvas_id),
      taskId: String(row.latest_task_id),
      status: String(row.status),
      target: row.target_kind === 'actionFissionRow'
        ? { type: 'actionFissionRow', nodeId: String(row.node_id), rowId: String(row.row_id || '') }
        : { type: 'imageGenerator', nodeId: String(row.node_id) },
    }));
  }

  function removeTargetHeads(targetKeys = [], now = Date.now()) {
    assertOpen();
    const keys = Array.isArray(targetKeys) ? targetKeys.map(safeString).filter(Boolean) : [];
    return removeTargetHeadsTransaction(keys, Number(now) || Date.now());
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
    getTask,
    finishResultCommit,
    cleanupTerminalHistory,
    getMeta,
    latestTaskIdForTarget,
    listTargetHeads,
    listTaskRecords,
    listTasks,
    preparePendingResultCommits,
    removeTargetHeads,
    saveTask,
    setMeta,
  };
}

module.exports = {
  DATABASE_RELATIVE_PATH,
  DEFAULT_RETENTION_MS,
  SCHEMA_VERSION,
  compactTerminalTask,
  createGenerationTaskRepository,
  targetKey,
};
