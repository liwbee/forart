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

function compactText(value, maxLength = 900) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
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

function stringifyDiagnostic(value, maxLength = 12000) {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... [truncated ${text.length - maxLength} chars]`;
}

function createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore, resolveWorkspaceName }) {
  const activeControllers = new Map();
  const queueTails = new Map();

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

  function isActionFissionTask(task) {
    return task?.target?.type === 'actionFissionRow' && task.target.nodeId && task.target.rowId;
  }

  function writeActionFissionAnchor(task, patch = {}) {
    if (!isActionFissionTask(task)) return;
    canvasStore?.setActionFissionRowLibtvAnchor(task.canvasId, task.target.nodeId, task.target.rowId, {
      taskId: task.id,
      projectUuid: patch.projectUuid || task.projectUuid,
      remoteNodeId: patch.remoteNodeId || task.remoteNodeId,
    });
  }

  function writeActionFissionTerminal(task, status, result, error) {
    if (!isActionFissionTask(task)) return;
    canvasStore?.completeActionFissionRow({
      backend: 'libtv',
      canvasId: task.canvasId,
      nodeId: task.target.nodeId,
      rowId: task.target.rowId,
      taskId: task.id,
      status,
      result,
      error,
    });
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

  async function ensureReadyProject(payload = {}) {
    const workspaceId = firstString(payload.workspaceId);
    if (!workspaceId) throw new Error('LibTV workspace is required.');
    const ensuredProject = await libtv.ensureDailyProject({ workspaceId, title: payload.projectName });
    let projectUuid = firstString(ensuredProject.project?.uuid);
    let projectName = firstString(ensuredProject.project?.name);
    if (!projectUuid) throw new Error('LibTV daily canvas could not be created or resolved.');
    if (libtv.waitForProjectReady) {
      const ready = await libtv.waitForProjectReady({
        workspaceId,
        projectUuid,
        projectName,
      });
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

  async function saveResult(resultUrl, taskId = '') {
    if (taskId) {
      const current = taskStore?.getTask(taskId);
      if (!current || current.status === 'interrupted') throw new Error('Interrupted');
      taskStore.updateTask(taskId, { status: 'running', message: '', messageCode: 'generation.resultProcessing', messageParams: null });
    }
    const saved = await assetStore.saveAsset({
      url: resultUrl,
      kind: 'output',
      defaultName: 'libtv-generated-image.png',
    });
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
      ? await resolveWorkspaceName()
      : '';
    const workspaceName = firstString(configuredWorkspaceName, payload.workspaceName, 'LibtvImage');
    taskStore.updateTask(task.id, { status: 'preparing', message: '', messageCode: 'libtv.workspacePreparing', messageParams: null });
    const ensuredWorkspace = await libtv.ensureNamedWorkspace({ name: workspaceName });
    const workspaceId = firstString(ensuredWorkspace.workspace?.id);
    if (!workspaceId) throw new Error(`LibTV workspace ${workspaceName} could not be created or resolved.`);
    taskStore.updateTask(task.id, { workspaceId, workspaceName });

    const project = await ensureReadyProject({ workspaceId, projectName: payload.projectName });
    taskStore.updateTask(task.id, {
      projectUuid: project.projectUuid,
      projectName: project.projectName,
      message: '',
      messageCode: job.referenceImages.length ? 'libtv.referencesUploading' : 'libtv.nodeCreating',
      messageParams: null,
    });
    writeActionFissionAnchor(task, { projectUuid: project.projectUuid });

    const createdAt = Date.now();
    const runId = createRunId(createdAt);
    const baseX = Number.isFinite(Number(job.x)) ? Math.round(Number(job.x)) : 0;
    const baseY = Number.isFinite(Number(job.y)) ? Math.round(Number(job.y)) : 0;
    const remoteReferenceNodeIds = [];
    const remoteReferenceNodeTitles = [];
    let remoteNodeId = '';

    try {
      for (let index = 0; index < job.referenceImages.length; index += 1) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        taskStore.updateTask(task.id, {
          status: 'uploading',
          message: '',
          messageCode: 'libtv.referenceUploading',
          messageParams: { current: index + 1, total: job.referenceImages.length },
        });
        const filePath = await prepareReferenceFile(job.referenceImages[index], index);
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
      writeActionFissionAnchor(task, { projectUuid: project.projectUuid, remoteNodeId });
      for (const referenceNodeId of remoteReferenceNodeIds) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await libtv.connectLeft(project.projectUuid, remoteNodeId, referenceNodeId);
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      taskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'libtv.generating', messageParams: null });
      let run;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let startBusy = false;
        try {
          run = await libtv.runNode(project.projectUuid, remoteNodeId, { signal });
        } catch (error) {
          if (!isTaskStartBusyError(error) || attempt === 2) throw error;
          startBusy = true;
          run = null;
        }
        const queried = await libtv.queryNode(project.projectUuid, remoteNodeId);
        if (extractImageUrl(run?.payload, run?.stdout) || extractImageUrl(queried.payload, queried.stdout)) {
          if (!extractImageUrl(run?.payload, run?.stdout)) run = queried;
          break;
        }
        if (remoteNodeHasStarted(queried.payload)) {
          let recovered = queried;
          for (let poll = 0; poll < 120 && !signal.aborted; poll += 1) {
            await waitFor(4000, signal);
            recovered = await libtv.queryNode(project.projectUuid, remoteNodeId);
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
        const queried = await libtv.queryNode(project.projectUuid, remoteNodeId);
        resultUrl = extractImageUrl(queried.payload, queried.stdout);
      }
      if (!resultUrl) throw new Error('LibTV generation completed, but no image URL was found.');
      const saved = await saveResult(resultUrl, task.id);
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
      if (!remoteNodeId && remoteReferenceNodeIds.length) {
        await cleanupRemoteNodes(project.projectUuid, remoteReferenceNodeIds);
      }
      throw error;
    }
  }

  function startImageTask(payload = {}) {
    if (!taskStore) throw new Error('LibTV task store is unavailable.');
    const task = taskStore.createTask({
      ...payload,
      status: payload.queueKey ? 'queued' : 'preparing',
      message: '',
      messageCode: payload.queueKey ? 'libtv.queueWaiting' : 'libtv.generationPreparing',
      messageParams: null,
    });
    writeActionFissionAnchor(task);

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
        writeActionFissionTerminal(completed, 'succeeded', result);
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
        writeActionFissionTerminal(completed, completed.status, undefined, completed.error);
      } finally {
        activeControllers.delete(task.id);
      }
    };

    if (task.queueKey) {
      const previous = queueTails.get(task.queueKey) || Promise.resolve();
      const queuedRun = previous.catch(() => undefined).then(execute);
      const tail = queuedRun.finally(() => {
        if (queueTails.get(task.queueKey) === tail) queueTails.delete(task.queueKey);
      });
      queueTails.set(task.queueKey, tail);
    } else {
      void execute();
    }
    return task;
  }

  function getImageTask(taskId) {
    return taskStore?.getTask(taskId) || null;
  }

  function recoverImageTask(payload = {}) {
    const taskId = firstString(payload.taskId, payload.id);
    if (!taskId) throw new Error('LibTV recovery task id is required.');
    const existing = taskStore?.getTask(taskId);
    if (existing) return existing;
    const projectUuid = firstString(payload.projectUuid);
    const remoteNodeId = firstString(payload.remoteNodeId);
    if (!projectUuid || !remoteNodeId) {
      canvasStore?.completeActionFissionRow({
        backend: 'libtv',
        canvasId: payload.canvasId,
        nodeId: payload.nodeId,
        rowId: payload.rowId,
        taskId,
        status: 'interrupted',
      });
      return null;
    }
    const task = taskStore.createTask({
      ...payload,
      id: taskId,
      target: payload.target || { type: 'actionFissionRow', nodeId: payload.nodeId, rowId: payload.rowId },
      projectUuid,
      remoteNodeId,
      status: 'running',
      message: '',
      messageCode: 'libtv.recovering',
      messageParams: null,
    });
    writeActionFissionAnchor(task, { projectUuid, remoteNodeId });
    const controller = new AbortController();
    activeControllers.set(task.id, controller);
    void (async () => {
      try {
        let resultUrl = '';
        for (let attempt = 0; attempt < 120 && !controller.signal.aborted; attempt += 1) {
          const queried = await libtv.queryNode(projectUuid, remoteNodeId);
          resultUrl = extractImageUrl(queried.payload, queried.stdout);
          if (resultUrl) break;
          taskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'libtv.generating', messageParams: null });
          await waitFor(4000, controller.signal);
        }
        if (!resultUrl) throw new Error('Recovered LibTV task did not produce an image result.');
        const result = await saveResult(resultUrl, task.id);
        const current = taskStore.getTask(task.id);
        if (!current || current.status === 'interrupted') return;
        const completed = taskStore.updateTask(task.id, { status: 'succeeded', message: '', messageCode: '', messageParams: null, error: '', result });
        writeActionFissionTerminal(completed, 'succeeded', result);
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
        writeActionFissionTerminal(completed, completed.status, undefined, completed.error);
      } finally {
        activeControllers.delete(task.id);
      }
    })();
    return task;
  }

  function recoverCanvasTasks() {
    const tasks = [];
    for (const anchor of canvasStore?.listLibtvTaskAnchors?.() || []) {
      const task = recoverImageTask(anchor);
      if (task) tasks.push(task);
    }
    return { ok: true, tasks };
  }

  function startImageTasks(payloads = []) {
    return (Array.isArray(payloads) ? payloads : []).map((payload) => startImageTask(payload));
  }

  function stopImageTask(taskId) {
    activeControllers.get(taskId)?.abort();
    activeControllers.delete(taskId);
    const stopped = taskStore?.stopTask(taskId) || null;
    if (stopped) writeActionFissionTerminal(stopped, 'interrupted');
    return stopped;
  }

  function reconcileCanvasPayload(canvasId, payload = {}) {
    if (!Array.isArray(payload.nodes)) return payload;
    return {
      ...payload,
      nodes: payload.nodes.map((node) => {
        const data = node?.data && typeof node.data === 'object' ? { ...node.data } : {};
        if (!data.actionFission || !Array.isArray(data.actionFission.rows)) return node;
        const rows = data.actionFission.rows.map((sourceRow) => {
          const row = sourceRow && typeof sourceRow === 'object' ? { ...sourceRow } : {};
          delete row.libtvTask;
          const task = row.libtvTaskId ? taskStore?.getTask(row.libtvTaskId) : null;
          if (!task) return row;
          if (['queued', 'preparing', 'uploading', 'running'].includes(task.status)) {
            row.libtvTaskId = task.id;
            if (task.projectUuid) row.libtvProjectUuid = task.projectUuid;
            if (task.remoteNodeId) row.libtvRemoteNodeId = task.remoteNodeId;
            return row;
          }
          delete row.libtvTaskId;
          delete row.libtvProjectUuid;
          delete row.libtvRemoteNodeId;
          row.libtvQueued = false;
          row.libtvRunning = false;
          if (task.status === 'succeeded' && task.result?.localUrl) {
            row.resultUrl = task.result.localUrl;
            row.resultFileName = task.result.fileName || row.selectedActionName || 'Generated image';
            row.resultDownloadState = 'pending';
            delete row.resultDownloadedAt;
            row.error = '';
          } else if (task.status === 'failed') {
            row.error = task.error || 'LibTV generation failed.';
          } else {
            row.error = '';
          }
          return row;
        });
        return { ...node, data: { ...data, actionFission: { ...data.actionFission, rows } } };
      }),
    };
  }

  async function resolveResultUrl(projectUuid, remoteNode, run, fallbackIndex) {
    const runUrls = collectImageUrls(run.payload, run.stdout);
    if (runUrls[fallbackIndex]) return runUrls[fallbackIndex];
    const queried = await libtv.queryNode(projectUuid, remoteNode.remoteNodeId);
    const queriedUrl = extractImageUrl(queried.payload, queried.stdout);
    if (queriedUrl) return queriedUrl;
    if (runUrls.length === 1) return runUrls[0];
    return '';
  }

  async function printBatchFailureReport(context, error) {
    const lines = [];
    lines.push('');
    lines.push('================ LIBTV BATCH FAILURE REPORT ================');
    lines.push(`time: ${new Date().toISOString()}`);
    lines.push(`stage: ${context.stage || ''}`);
    lines.push(`message: ${error instanceof Error ? error.message : String(error)}`);
    lines.push(`projectUuid: ${context.projectUuid || ''}`);
    lines.push(`projectName: ${context.projectName || ''}`);
    lines.push(`exitCode: ${error?.exitCode ?? ''}`);
    if (error?.args) lines.push(`command: libtv ${error.args.join(' ')}`);
    lines.push('');
    lines.push('[jobs]');
    context.jobs.forEach((job, index) => {
      const remoteJob = context.remoteJobs[index];
      lines.push(`#${index + 1}`);
      lines.push(`  localId: ${job.id || ''}`);
      lines.push(`  model: ${job.modelName || ''}`);
      lines.push(`  count: ${job.count || 1}`);
      lines.push(`  aspectRatio: ${job.aspectRatio || ''}`);
      lines.push(`  quality: ${job.quality || ''}`);
      lines.push(`  resolution: ${job.resolution || ''}`);
      lines.push(`  title: ${job.nodeTitle || ''}`);
      lines.push(`  remoteNodeId: ${remoteJob?.remoteNodeId || ''}`);
      lines.push(`  remoteNodeTitle: ${remoteJob?.remoteNodeTitle || ''}`);
      lines.push(`  remoteReferenceNodeIds: ${(remoteJob?.remoteReferenceNodeIds || []).join(', ')}`);
      lines.push(`  referenceImages: ${(job.referenceImages || []).join(', ')}`);
      lines.push(`  prompt: ${compactText(job.prompt)}`);
    });
    if (error?.stdout) {
      lines.push('');
      lines.push('[libtv stdout]');
      lines.push(stringifyDiagnostic(error.stdout));
    }
    if (error?.stderr) {
      lines.push('');
      lines.push('[libtv stderr]');
      lines.push(stringifyDiagnostic(error.stderr));
    }
    if (context.projectUuid && context.remoteJobs.length) {
      lines.push('');
      lines.push('[remote node query after failure]');
      for (const remoteJob of context.remoteJobs) {
        lines.push(`--- ${remoteJob.remoteNodeTitle} (${remoteJob.remoteNodeId}) ---`);
        try {
          const queried = await libtv.queryNode(context.projectUuid, remoteJob.remoteNodeId);
          lines.push(stringifyDiagnostic(queried.payload || queried.stdout));
          if (queried.stderr) lines.push(`[stderr] ${stringifyDiagnostic(queried.stderr, 3000)}`);
        } catch (queryError) {
          lines.push(`query failed: ${queryError instanceof Error ? queryError.message : String(queryError)}`);
          if (queryError?.stdout) lines.push(`[stdout] ${stringifyDiagnostic(queryError.stdout, 3000)}`);
          if (queryError?.stderr) lines.push(`[stderr] ${stringifyDiagnostic(queryError.stderr, 3000)}`);
        }
      }
    }
    lines.push('============== END LIBTV BATCH FAILURE REPORT ==============');
    lines.push('');
    console.error(lines.join('\n'));
  }

  async function generateBatch(payload = {}) {
    const context = {
      stage: 'start',
      projectUuid: '',
      projectName: '',
      jobs: [],
      remoteJobs: [],
    };
    try {
      const { projectUuid, projectName } = await resolveProject(payload);
      context.projectUuid = projectUuid;
      context.projectName = projectName;
      const jobs = normalizeJobs(payload);
      context.jobs = jobs;
      const createdAt = Date.now();
      const runId = createRunId(createdAt);
      const remoteJobs = [];
      const results = [];

      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        let remoteJob = null;
        try {
          context.stage = `create remote job ${index + 1}/${jobs.length}`;
          remoteJob = await createRemoteJob(projectUuid, job, runId, index);
          remoteJobs.push(remoteJob);
          context.remoteJobs = remoteJobs;
        } catch (error) {
          await printBatchFailureReport(context, error);
          results.push({
            ok: false,
            id: job.id,
            error: error instanceof Error ? error.message : String(error),
            createdAt,
          });
          continue;
        }

        try {
          context.stage = `run node ${index + 1}/${jobs.length}`;
          const run = await libtv.runNode(projectUuid, remoteJob.remoteNodeId);
          context.stage = `resolve result ${index + 1}/${jobs.length}`;
          const resultUrl = await resolveResultUrl(projectUuid, remoteJob, run, 0);
          if (!resultUrl) throw new Error(`LibTV node run completed, but no image URL was found for ${remoteJob.remoteNodeTitle}.`);
          const saved = await saveResult(resultUrl);
          results.push({
            ok: true,
            ...saved,
            id: remoteJob.id,
            remoteNodeId: remoteJob.remoteNodeId,
            remoteNodeTitle: remoteJob.remoteNodeTitle,
            remoteReferenceNodeIds: remoteJob.remoteReferenceNodeIds,
            remoteReferenceNodeTitles: remoteJob.remoteReferenceNodeTitles,
            createdAt,
            raw: run.payload,
          });
        } catch (error) {
          await printBatchFailureReport(context, error);
          results.push({
            ok: false,
            id: remoteJob.id,
            error: error instanceof Error ? error.message : String(error),
            remoteNodeId: remoteJob.remoteNodeId,
            remoteNodeTitle: remoteJob.remoteNodeTitle,
            remoteReferenceNodeIds: remoteJob.remoteReferenceNodeIds,
            remoteReferenceNodeTitles: remoteJob.remoteReferenceNodeTitles,
            createdAt,
          });
        }
      }

      return {
        ok: true,
        projectUuid,
        projectName,
        results,
        createdAt,
      };
    } catch (error) {
      await printBatchFailureReport(context, error);
      throw error;
    }
  }

  async function generateImage(payload = {}) {
    const batch = await generateBatch({ ...payload, jobs: [payload] });
    const result = batch.results[0];
    if (!result) throw new Error('LibTV generation did not return a result.');
    if (!result.ok) throw new Error(result.error || 'LibTV generation failed.');

    return {
      ok: true,
      ...result,
      projectUuid: batch.projectUuid,
      projectName: batch.projectName,
    };
  }

  return {
    ensureReadyProject,
    generateBatch,
    generateImage,
    getImageTask,
    reconcileCanvasPayload,
    recoverCanvasTasks,
    recoverImageTask,
    startImageTask,
    startImageTasks,
    stopImageTask,
  };
}

module.exports = { createLibtvGenerationRunner, extractImageUrl, extractNodeId };
