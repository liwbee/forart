const path = require('path');

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  visit(value);
  Object.values(value).forEach((item) => walk(item, visit));
}

function walkOutput(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkOutput(item, visit));
    return;
  }
  visit(value);
  Object.entries(value).forEach(([key, item]) => {
    if (/^(params|imageList|imageListOrder|mixedListOrder|referenceImages?|inputs?)$/i.test(key)) return;
    walkOutput(item, visit);
  });
}

function extractNodeId(payload, stdout = '') {
  const candidates = [];
  walk(payload, (item) => {
    candidates.push(
      item.nodeKey,
      item.newNodeKey,
      item.nodeId,
      item.id,
      item.uuid,
      item.nodeUuid,
      item.data?.nodeKey,
      item.data?.newNodeKey,
      item.data?.nodeId,
      item.data?.id,
    );
  });
  const jsonCandidate = candidates.map((item) => String(item || '').trim()).find(Boolean);
  if (jsonCandidate) return jsonCandidate;
  const text = String(stdout || '');
  const match = text.match(/(?:nodeKey|newNodeKey|nodeId|node_id|id|uuid)["'\s:=]+([a-zA-Z0-9_-]{6,})/i);
  return match?.[1] || '';
}

function extractImageUrl(payload, stdout = '') {
  const fromJson = collectImageUrls(payload)[0];
  if (fromJson) return fromJson;
  const text = String(stdout || '');
  try {
    const parsed = JSON.parse(text);
    return collectImageUrls(parsed)[0] || '';
  } catch {
    // Older CLI output may include non-JSON diagnostics around the result URL.
  }
  return (text.match(/https?:\/\/[^\s"'<>]+/ig) || []).find((url) => !/\/upload-images\//i.test(url)) || '';
}

async function pollRecoveredImageResult({ queryNode, waitForNext, signal }) {
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const queried = await queryNode();
    const resultUrl = extractImageUrl(queried?.payload, queried?.stdout);
    if (resultUrl) return resultUrl;
    await waitForNext();
  }
}

function collectImageUrls(payload, stdout = '') {
  const urls = [];
  const seen = new Set();
  const addUrl = (value) => {
    if (Array.isArray(value)) {
      value.forEach(addUrl);
      return;
    }
    const text = String(value || '').trim();
    if (!(/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) || /\/upload-images\//i.test(text) || seen.has(text)) return;
    seen.add(text);
    urls.push(text);
  };
  walkOutput(payload, (item) => {
    addUrl(item.url);
    addUrl(item.imageUrl);
    addUrl(item.resultUrl);
    addUrl(item.downloadUrl);
    addUrl(item.outputUrl);
    addUrl(item.src);
    addUrl(item.data?.url);
    addUrl(item.data?.imageUrl);
    addUrl(item.data?.resultUrl);
  });
  String(stdout || '').match(/https?:\/\/[^\s"'<>]+/ig)?.forEach(addUrl);
  return urls;
}

function ensurePrompt(payload) {
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) throw new Error('Prompt is required.');
  return prompt;
}

function normalizeReferenceImages(referenceImages) {
  return Array.isArray(referenceImages)
    ? referenceImages.map((url) => String(url || '').trim()).filter(Boolean)
    : [];
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function createRunId(createdAt) {
  const date = new Date(createdAt);
  const stamp = [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    '-',
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join('');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${suffix}`;
}

function safeRemoteTitle(title, fallback = 'Forart') {
  const text = String(title || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, 80);
}

function isTaskStartBusyError(error) {
  const diagnostic = [error?.message, error?.stdout, error?.stderr]
    .map((value) => String(value || ''))
    .join('\n');
  return diagnostic.includes('1200000171') || diagnostic.includes('2020058');
}

function remoteNodeHasStarted(payload) {
  let started = false;
  walk(payload, (item) => {
    if (firstString(item.taskId, item.task_id, item.taskInfo?.taskId, item.taskInfo?.task_id)) started = true;
  });
  return started;
}

function createLibtvGenerationRunner({
  libtv,
  assetStore,
  canvasStore,
  taskStore,
  resultCommitter,
  resolveWorkspaceName,
  resolveActionFissionConcurrency,
}) {
  if (!resultCommitter?.commit) throw new Error('Generation result committer is required.');
  const activeControllers = new Map();
  const anchoredTaskIds = new Set();
  const queuePools = new Map();
  const queuedTaskPoolKeys = new Map();

  function configuredActionFissionConcurrency() {
    const requested = Number(typeof resolveActionFissionConcurrency === 'function'
      ? resolveActionFissionConcurrency()
      : 1);
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(requested) ? requested : 1;
  }

  function drainQueuePool(queueKey) {
    const pool = queuePools.get(queueKey);
    if (!pool) return;
    while (pool.pending.length && (pool.limit === 0 || pool.activeCount < pool.limit)) {
      const item = pool.pending.shift();
      queuedTaskPoolKeys.delete(item.taskId);
      pool.activeCount += 1;
      void Promise.resolve()
        .then(item.execute)
        .catch(() => undefined)
        .finally(() => {
          pool.activeCount = Math.max(0, pool.activeCount - 1);
          if (!pool.activeCount && !pool.pending.length) {
            queuePools.delete(queueKey);
            return;
          }
          drainQueuePool(queueKey);
        });
    }
  }

  function enqueueTask(task, execute, limit) {
    const queueKey = task.queueKey;
    let pool = queuePools.get(queueKey);
    if (!pool) {
      pool = { activeCount: 0, limit, pending: [] };
      queuePools.set(queueKey, pool);
    }
    pool.pending.push({ taskId: task.id, execute });
    queuedTaskPoolKeys.set(task.id, queueKey);
    drainQueuePool(queueKey);
  }

  function waitFor(delayMs, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(resolve, delayMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }

  function waitForOperation(operation, signal) {
    if (!signal) return Promise.resolve(operation);
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        callback(value);
      };
      const abort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(operation).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
  }

  async function queryNodeWithRetry(projectUuid, remoteNodeId, signal, attempts = 3) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        return await libtv.queryNode(projectUuid, remoteNodeId, { signal });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        lastError = error;
        if (attempt < attempts - 1) await waitFor(500 * (attempt + 1), signal);
      }
    }
    throw lastError;
  }

  function isActionFissionTask(task) {
    return task?.target?.type === 'actionFissionRow' && task.target.nodeId && task.target.rowId;
  }

  function writeTaskAnchor(task, patch = {}) {
    if (!task?.canvasId || !task.target?.nodeId) return false;
    if (anchoredTaskIds.has(task.id)) return true;
    const payload = {
      taskId: task.id,
      projectUuid: patch.projectUuid || task.projectUuid,
      remoteNodeId: patch.remoteNodeId || task.remoteNodeId,
    };
    if (isActionFissionTask(task)) {
      const result = canvasStore?.setActionFissionRowTaskAnchor(task.canvasId, task.target.nodeId, task.target.rowId, payload);
      if (result?.ok !== false) anchoredTaskIds.add(task.id);
      return result?.ok !== false;
    } else {
      const result = canvasStore?.setGenerationTaskAnchor(task.canvasId, task.target.nodeId, payload);
      if (result?.ok !== false) anchoredTaskIds.add(task.id);
      return result?.ok !== false;
    }
  }

  function writeTaskTerminal(task, status, result, error) {
    if (!task?.canvasId || !task.target?.nodeId) return;
    resultCommitter.commit(task, { status, result, error, backend: 'libtv' });
  }
  async function prepareReferenceFile(url, index) {
    const localPath = assetStore.resolveAssetUrl(url);
    if (localPath) return localPath;
    const saved = await assetStore.saveAsset({
      url,
      kind: 'input',
      defaultName: `libtv-reference-${index + 1}.png`,
    });
    return saved.filePath;
  }

  async function resolveProject(payload = {}) {
    let projectUuid = firstString(payload.projectUuid);
    let projectName = firstString(payload.projectName);
    const workspaceId = firstString(payload.workspaceId);
    if (!projectUuid) {
      if (!workspaceId) throw new Error('LibTV workspace is required.');
      const ensuredProject = await ensureReadyProject({ workspaceId });
      projectUuid = firstString(ensuredProject.projectUuid);
      projectName = firstString(ensuredProject.projectName, projectName);
      if (!projectUuid) throw new Error('LibTV daily canvas could not be created or resolved.');
    }
    return { projectUuid, projectName };
  }

  async function ensureReadyProject(payload = {}, signal) {
    const workspaceId = firstString(payload.workspaceId);
    if (!workspaceId) throw new Error('LibTV workspace is required.');
    const ensuredProject = await waitForOperation(
      libtv.ensureDailyProject({ workspaceId, title: payload.projectName }),
      signal,
    );
    throwIfAborted(signal);
    let projectUuid = firstString(ensuredProject.project?.uuid);
    let projectName = firstString(ensuredProject.project?.name);
    if (!projectUuid) throw new Error('LibTV daily canvas could not be created or resolved.');
    if (libtv.waitForProjectReady) {
      const ready = await waitForOperation(libtv.waitForProjectReady({
        workspaceId,
        projectUuid,
        projectName,
        signal,
      }), signal);
      throwIfAborted(signal);
      projectUuid = firstString(ready.project?.uuid, projectUuid);
      projectName = firstString(ready.project?.name, projectName);
    }
    return {
      ok: true,
      created: Boolean(ensuredProject.created),
      projectUuid,
      projectName,
      project: { ...ensuredProject.project, uuid: projectUuid, name: projectName },
    };
  }

  function normalizeJobs(payload = {}) {
    const sourceJobs = Array.isArray(payload.jobs) && payload.jobs.length ? payload.jobs : [payload];
    return sourceJobs.map((job, index) => {
      const prompt = ensurePrompt(job);
      const modelName = firstString(job.modelName, job.modelKey, payload.modelName, payload.modelKey);
      if (!modelName) throw new Error('LibTV image model is required.');
      return {
        ...job,
        id: firstString(job.id, job.localTargetId, `job-${index + 1}`),
        prompt,
        modelName,
        count: Math.max(1, Math.round(Number(job.count || payload.count || 1))),
        aspectRatio: firstString(job.aspectRatio, payload.aspectRatio, '1:1'),
        quality: firstString(job.quality, payload.quality),
        resolution: firstString(job.resolution, payload.resolution),
        nodeTitle: firstString(job.nodeTitle, payload.nodeTitle, 'LibTV Image Generator'),
        x: Number.isFinite(Number(job.x)) ? Math.round(Number(job.x)) : Number.isFinite(Number(payload.x)) ? Math.round(Number(payload.x)) : 0,
        y: Number.isFinite(Number(job.y)) ? Math.round(Number(job.y)) : Number.isFinite(Number(payload.y)) ? Math.round(Number(payload.y)) : 0,
        referenceImages: normalizeReferenceImages(job.referenceImages || payload.referenceImages),
      };
    });
  }

  async function createRemoteJob(projectUuid, job, runId, index) {
    const baseX = Number.isFinite(Number(job.x)) ? Math.round(Number(job.x)) : index * 420;
    const baseY = Number.isFinite(Number(job.y)) ? Math.round(Number(job.y)) : 0;
    const titleBase = safeRemoteTitle(job.nodeTitle, 'LibTV Image Generator');
    const remoteNodeTitle = `${titleBase} - ${runId} - ${String(index + 1).padStart(2, '0')}`;
    const remoteReferenceNodeIds = [];
    const remoteReferenceNodeTitles = [];

    for (let refIndex = 0; refIndex < job.referenceImages.length; refIndex += 1) {
      const filePath = await prepareReferenceFile(job.referenceImages[refIndex], refIndex);
      const referenceTitle = `Forart Ref - ${runId} - ${String(index + 1).padStart(2, '0')}-${String(refIndex + 1).padStart(2, '0')} - ${safeRemoteTitle(path.basename(filePath), 'image')}`;
      const uploaded = await libtv.uploadImageNode(projectUuid, filePath, {
        title: referenceTitle,
        x: baseX - 360,
        y: baseY + refIndex * 260,
      });
      const referenceNodeId = extractNodeId(uploaded.payload, uploaded.stdout);
      if (!referenceNodeId) throw new Error(`LibTV reference upload did not return a node id for ${path.basename(filePath)}.`);
      remoteReferenceNodeIds.push(referenceNodeId);
      remoteReferenceNodeTitles.push(referenceTitle);
    }

    const created = await libtv.createImageNode(projectUuid, {
      title: remoteNodeTitle,
      prompt: job.prompt,
      model: job.modelName,
      count: job.count,
      modeType: remoteReferenceNodeIds.length ? 'image2image' : '',
      ratio: job.aspectRatio,
      quality: job.quality,
      resolution: job.resolution,
      x: baseX,
      y: baseY,
    });
    const remoteNodeId = extractNodeId(created.payload, created.stdout);
    if (!remoteNodeId) throw new Error('LibTV image node creation did not return a node id.');

    for (const referenceNodeId of remoteReferenceNodeIds) {
      await libtv.connectLeft(projectUuid, remoteNodeId, referenceNodeId);
    }

    return {
      id: job.id,
      remoteNodeId,
      remoteNodeTitle,
      remoteReferenceNodeIds,
      remoteReferenceNodeTitles,
    };
  }

  async function saveResult(resultUrl, taskId = '', signal) {
    if (taskId) {
      const current = taskStore?.getTask(taskId);
      if (!current || current.status === 'interrupted') throw new Error('Interrupted');
      taskStore.updateTask(taskId, { status: 'running', message: '', messageCode: 'generation.resultProcessing', messageParams: null });
    }
    let saved;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      throwIfAborted(signal);
      try {
        saved = await assetStore.saveAsset({
          url: resultUrl,
          kind: 'output',
          defaultName: 'libtv-generated-image.png',
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await waitFor(500 * (attempt + 1), signal);
      }
    }
    if (!saved) throw lastError;
    return {
      url: resultUrl,
      localUrl: saved.url,
      fileName: saved.fileName,
      filePath: saved.filePath,
    };
  }

  async function cleanupRemoteNodes(projectUuid, nodeIds) {
    for (const nodeId of nodeIds) {
      await libtv.deleteNode(projectUuid, nodeId).catch(() => undefined);
    }
  }

  async function executeImageTask(task, payload, signal) {
    const job = normalizeJobs(payload)[0];
    const configuredWorkspaceName = typeof resolveWorkspaceName === 'function'
      ? await waitForOperation(resolveWorkspaceName(), signal)
      : '';
    const workspaceName = firstString(configuredWorkspaceName, payload.workspaceName, 'LibtvImage');
    taskStore.updateTask(task.id, { status: 'preparing', message: '', messageCode: 'libtv.workspacePreparing', messageParams: null });
    const ensuredWorkspace = await waitForOperation(libtv.ensureNamedWorkspace({ name: workspaceName }), signal);
    throwIfAborted(signal);
    const workspaceId = firstString(ensuredWorkspace.workspace?.id);
    if (!workspaceId) throw new Error(`LibTV workspace ${workspaceName} could not be created or resolved.`);
    taskStore.updateTask(task.id, { workspaceId, workspaceName });

    const project = await ensureReadyProject({ workspaceId, projectName: payload.projectName }, signal);
    throwIfAborted(signal);
    taskStore.updateTask(task.id, {
      projectUuid: project.projectUuid,
      projectName: project.projectName,
      message: '',
      messageCode: job.referenceImages.length ? 'libtv.referencesUploading' : 'libtv.nodeCreating',
      messageParams: null,
    });
    writeTaskAnchor(task, { projectUuid: project.projectUuid });

    const createdAt = Date.now();
    const runId = createRunId(createdAt);
    const baseX = Number.isFinite(Number(job.x)) ? Math.round(Number(job.x)) : 0;
    const baseY = Number.isFinite(Number(job.y)) ? Math.round(Number(job.y)) : 0;
    const remoteReferenceNodeIds = [];
    const remoteReferenceNodeTitles = [];
    let remoteNodeId = '';
    let runAttempted = false;

    try {
      for (let index = 0; index < job.referenceImages.length; index += 1) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        taskStore.updateTask(task.id, {
          status: 'uploading',
          message: '',
          messageCode: 'libtv.referenceUploading',
          messageParams: { current: index + 1, total: job.referenceImages.length },
        });
        const filePath = await waitForOperation(prepareReferenceFile(job.referenceImages[index], index), signal);
        throwIfAborted(signal);
        const referenceTitle = `Forart Ref - ${runId} - ${String(index + 1).padStart(2, '0')} - ${safeRemoteTitle(path.basename(filePath), 'image')}`;
        const uploaded = await libtv.uploadImageNode(project.projectUuid, filePath, {
          title: referenceTitle,
          x: baseX - 360,
          y: baseY + index * 260,
          signal,
        });
        const referenceNodeId = extractNodeId(uploaded.payload, uploaded.stdout);
        if (!referenceNodeId) throw new Error(`LibTV reference upload did not return a node id for ${path.basename(filePath)}.`);
        remoteReferenceNodeIds.push(referenceNodeId);
        remoteReferenceNodeTitles.push(referenceTitle);
        taskStore.updateTask(task.id, { remoteReferenceNodeIds: [...remoteReferenceNodeIds] });
      }

      taskStore.updateTask(task.id, { status: 'uploading', message: '', messageCode: 'libtv.nodeCreating', messageParams: null });
      const remoteNodeTitle = `${safeRemoteTitle(job.nodeTitle, 'Forart Image Generator')} - ${runId}`;
      const created = await libtv.createImageNode(project.projectUuid, {
        title: remoteNodeTitle,
        prompt: job.prompt,
        model: job.modelName,
        count: job.count,
        modeType: remoteReferenceNodeIds.length ? 'image2image' : '',
        ratio: job.aspectRatio,
        quality: job.quality,
        resolution: job.resolution,
        x: baseX,
        y: baseY,
        signal,
      });
      remoteNodeId = extractNodeId(created.payload, created.stdout);
      if (!remoteNodeId) throw new Error('LibTV image node creation did not return a node id.');
      taskStore.updateTask(task.id, { remoteNodeId });
      writeTaskAnchor(task, { projectUuid: project.projectUuid, remoteNodeId });
      for (const referenceNodeId of remoteReferenceNodeIds) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await libtv.connectLeft(project.projectUuid, remoteNodeId, referenceNodeId, { signal });
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      taskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'libtv.generating', messageParams: null });
      let run;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        taskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'libtv.generating', messageParams: null });
        let startBusy = false;
        try {
          runAttempted = true;
          run = await libtv.runNode(project.projectUuid, remoteNodeId, { signal });
        } catch (error) {
          if (!isTaskStartBusyError(error) || attempt === 2) throw error;
          startBusy = true;
          run = null;
        }
        if (extractImageUrl(run?.payload, run?.stdout)) break;
        const queried = await queryNodeWithRetry(project.projectUuid, remoteNodeId, signal);
        if (extractImageUrl(queried.payload, queried.stdout)) {
          run = queried;
          break;
        }
        if (remoteNodeHasStarted(queried.payload)) {
          let recovered = queried;
          for (let poll = 0; poll < 120 && !signal.aborted; poll += 1) {
            await waitFor(4000, signal);
            recovered = await queryNodeWithRetry(project.projectUuid, remoteNodeId, signal);
            if (extractImageUrl(recovered.payload, recovered.stdout)) break;
          }
          run = recovered;
          break;
        }
        if (attempt < 2) {
          taskStore.updateTask(task.id, {
            message: '',
            messageCode: startBusy ? 'libtv.startBusyRetrying' : 'libtv.startRetrying',
            messageParams: { current: attempt + 1, total: 2 },
          });
          await waitFor(2000 * (attempt + 1), signal);
        }
      }
      if (!run) throw new Error('LibTV generation did not return a run result.');
      let resultUrl = extractImageUrl(run.payload, run.stdout);
      if (!resultUrl && remoteNodeId) {
        const queried = await queryNodeWithRetry(project.projectUuid, remoteNodeId, signal);
        resultUrl = extractImageUrl(queried.payload, queried.stdout);
      }
      if (!resultUrl) throw new Error('LibTV generation completed, but no image URL was found.');
      const saved = await saveResult(resultUrl, task.id, signal);
      return {
        ok: true,
        ...saved,
        remoteNodeId,
        remoteNodeTitle,
        remoteReferenceNodeIds,
        remoteReferenceNodeTitles,
        projectUuid: project.projectUuid,
        projectName: project.projectName,
        workspaceId,
        workspaceName,
        createdAt,
      };
    } catch (error) {
      if (!remoteNodeId && error?.stdout) remoteNodeId = extractNodeId(null, error.stdout);
      if (remoteNodeId) taskStore.updateTask(task.id, { remoteNodeId });
      if (!runAttempted) {
        await cleanupRemoteNodes(project.projectUuid, [remoteNodeId, ...remoteReferenceNodeIds].filter(Boolean));
      }
      throw error;
    }
  }

  function startImageTask(payload = {}, queueConcurrency = configuredActionFissionConcurrency()) {
    if (!taskStore) throw new Error('LibTV task store is unavailable.');
    const task = taskStore.createTask({
      ...payload,
      status: payload.queueKey ? 'queued' : 'preparing',
      message: '',
      messageCode: payload.queueKey ? 'libtv.queueWaiting' : 'libtv.generationPreparing',
      messageParams: null,
    });
    if (!writeTaskAnchor(task)) {
      taskStore.stopTask(task.id);
      throw new Error('Canvas task anchor failed.');
    }

    const execute = async () => {
      const queued = taskStore.getTask(task.id);
      if (!queued || queued.status === 'interrupted') return;
      const controller = new AbortController();
      activeControllers.set(task.id, controller);
      try {
        taskStore.updateTask(task.id, { status: 'preparing', message: '', messageCode: 'libtv.generationPreparing', messageParams: null });
        const result = await executeImageTask(task, payload, controller.signal);
        const current = taskStore.getTask(task.id);
        if (!current || current.status === 'interrupted') return;
        const completed = taskStore.updateTask(task.id, { status: 'succeeded', message: '', messageCode: '', messageParams: null, error: '', result });
        writeTaskTerminal(completed, 'succeeded', result);
      } catch (error) {
        const current = taskStore.getTask(task.id);
        if (!current || current.status === 'interrupted') return;
        const interrupted = controller.signal.aborted || error?.name === 'AbortError';
        const completed = taskStore.updateTask(task.id, {
          status: interrupted ? 'interrupted' : 'failed',
          message: '',
          messageCode: '',
          messageParams: null,
          error: interrupted ? '' : error instanceof Error ? error.message : String(error),
        });
        writeTaskTerminal(completed, completed.status, undefined, completed.error);
      } finally {
        activeControllers.delete(task.id);
      }
    };

    if (task.queueKey) {
      enqueueTask(task, execute, queueConcurrency);
    } else {
      void execute();
    }
    return task;
  }

  function resumeRemoteImageTask(task) {
    if (!task || activeControllers.has(task.id)) return task;
    const projectUuid = firstString(task.projectUuid);
    const remoteNodeId = firstString(task.remoteNodeId);
    if (!projectUuid || !remoteNodeId) return null;
    const controller = new AbortController();
    activeControllers.set(task.id, controller);
    void (async () => {
      try {
        const resultUrl = await pollRecoveredImageResult({
          signal: controller.signal,
          queryNode: () => queryNodeWithRetry(projectUuid, remoteNodeId, controller.signal),
          waitForNext: () => {
            taskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'libtv.generating', messageParams: null });
            return waitFor(4000, controller.signal);
          },
        });
        const result = await saveResult(resultUrl, task.id, controller.signal);
        const current = taskStore.getTask(task.id);
        if (!current || current.status === 'interrupted') return;
        const completed = taskStore.updateTask(task.id, { status: 'succeeded', message: '', messageCode: '', messageParams: null, error: '', result });
        writeTaskTerminal(completed, 'succeeded', result);
      } catch (error) {
        const current = taskStore.getTask(task.id);
        if (!current || current.status === 'interrupted') return;
        const interrupted = controller.signal.aborted || error?.name === 'AbortError';
        const completed = taskStore.updateTask(task.id, {
          status: interrupted ? 'interrupted' : 'failed',
          message: '',
          messageCode: '',
          messageParams: null,
          error: interrupted ? '' : error instanceof Error ? error.message : String(error),
        });
        writeTaskTerminal(completed, completed.status, undefined, completed.error);
      } finally {
        activeControllers.delete(task.id);
      }
    })();
    return task;
  }

  function recoverPersistedTasks() {
    const tasks = [];
    const errors = [];
    const activeTasks = (taskStore?.listTasks?.() || []).filter((task) => (
      !['succeeded', 'failed', 'interrupted'].includes(task.status)
    ));
    const queueConcurrency = configuredActionFissionConcurrency();

    for (const task of activeTasks) {
      try {
        if (activeControllers.has(task.id) || queuedTaskPoolKeys.has(task.id)) {
          tasks.push(task);
          continue;
        }
        if (task.projectUuid && task.remoteNodeId) {
          const resumed = resumeRemoteImageTask(task);
          if (resumed) tasks.push(resumed);
          continue;
        }
        if (task.status === 'queued') {
          tasks.push(startImageTask(task, queueConcurrency));
          continue;
        }
        const interrupted = taskStore.stopTask(task.id);
        if (interrupted) {
          writeTaskTerminal(interrupted, 'interrupted');
          tasks.push(interrupted);
        }
      } catch (error) {
        errors.push({
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { ok: true, tasks, errors };
  }

  function startImageTasks(payloads = []) {
    const queueConcurrency = configuredActionFissionConcurrency();
    return (Array.isArray(payloads) ? payloads : []).map((payload) => startImageTask(payload, queueConcurrency));
  }

  function stopImageTask(taskId) {
    const queueKey = queuedTaskPoolKeys.get(taskId);
    if (queueKey) {
      const pool = queuePools.get(queueKey);
      if (pool) {
        pool.pending = pool.pending.filter((item) => item.taskId !== taskId);
        if (!pool.activeCount && !pool.pending.length) queuePools.delete(queueKey);
      }
      queuedTaskPoolKeys.delete(taskId);
    }
    activeControllers.get(taskId)?.abort();
    activeControllers.delete(taskId);
    const stopped = taskStore?.stopTask(taskId) || null;
    if (stopped) writeTaskTerminal(stopped, 'interrupted');
    return stopped;
  }

  return {
    recoverPersistedTasks,
    startImageTask,
    startImageTasks,
    stopImageTask,
  };
}

module.exports = { createLibtvGenerationRunner, extractImageUrl, extractNodeId, pollRecoveredImageResult };
