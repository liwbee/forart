const fs = require('fs');
const path = require('path');

const activeControllers = new Map();

function joinApiPath(baseUrl, pathName) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${String(pathName || '').replace(/^\/+/, '')}`;
}

function imageGenerationsUrl(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/images\/generations$/i.test(normalized)) return normalized;
  for (const prefix of ['/api/v3', '/v1beta', '/v1', '/v2']) {
    if (normalized.endsWith(prefix)) return joinApiPath(normalized, 'images/generations');
  }
  return joinApiPath(normalized, 'v1/images/generations');
}

function imageUploadsUrl(baseUrl) {
  const normalized = String(baseUrl || '')
    .replace(/\/+$/, '')
    .replace(/\/images\/generations$/i, '')
    .replace(/\/images\/edits$/i, '');
  if (/\/v\d(?:beta)?$/i.test(normalized) || /\/api\/v\d$/i.test(normalized)) return joinApiPath(normalized, 'uploads/images');
  return joinApiPath(normalized, 'v1/uploads/images');
}

function taskUrlCandidates(baseUrl, taskId) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '').replace(/\/images\/generations$/i, '');
  const taskPath = `tasks/${encodeURIComponent(taskId)}`;
  const imageTaskPath = `images/tasks/${encodeURIComponent(taskId)}`;
  const candidates = [
    joinApiPath(normalized, taskPath),
    joinApiPath(normalized, imageTaskPath),
  ];
  if (!/\/v\d(?:beta)?$/i.test(normalized) && !/\/api\/v\d$/i.test(normalized)) {
    candidates.push(joinApiPath(normalized, `v1/${taskPath}`), joinApiPath(normalized, `v1/${imageTaskPath}`));
  }
  return [...new Set(candidates)];
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && Boolean(value.trim())) || '';
}

function isHttpImageUrl(value) {
  return /^https?:\/\/\S+/i.test(String(value || '').trim());
}

function valueToImage(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!isHttpImageUrl(text)) return null;
  return { url: text, fileName: 'generated-image.png' };
}

function findImageInPayload(payload) {
  const queue = [payload];
  const seen = new Set();
  while (queue.length) {
    const value = queue.shift();
    const image = valueToImage(value);
    if (image) return image;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => queue.push(item));
      continue;
    }
    const imageUrl = value.image_url;
    if (typeof imageUrl === 'string' && isHttpImageUrl(imageUrl)) return { url: imageUrl, fileName: 'generated-image.png' };
    if (imageUrl && typeof imageUrl === 'object') {
      const nestedUrl = firstString(imageUrl.url);
      if (nestedUrl && isHttpImageUrl(nestedUrl)) return { url: nestedUrl, fileName: 'generated-image.png' };
    }
    Object.values(value).forEach((childValue) => queue.push(childValue));
  }
  return null;
}

function summarizePayloadShape(payload) {
  if (!payload || typeof payload !== 'object') return `response type ${typeof payload}`;
  const topKeys = Object.keys(payload).slice(0, 10);
  const hints = [];
  const data = payload.data;
  if (Array.isArray(data)) hints.push(`data[0] keys: ${Object.keys(data[0] || {}).slice(0, 8).join(', ') || 'none'}`);
  if (data && typeof data === 'object' && !Array.isArray(data)) hints.push(`data keys: ${Object.keys(data).slice(0, 8).join(', ') || 'none'}`);
  const status = firstString(payload.status, payload.state);
  if (status) hints.push(`status: ${status}`);
  return [`top-level keys: ${topKeys.join(', ') || 'none'}`, ...hints].join('; ');
}

function readTaskId(payload) {
  const record = payload && typeof payload === 'object' ? payload : null;
  const data = Array.isArray(record?.data) ? record.data : record?.data;
  if (Array.isArray(data)) {
    const first = data.find((item) => item && typeof item === 'object');
    return firstString(first?.task_id, first?.taskId, first?.taskID, first?.task, first?.id, first?.request_id, first?.submit_id, first?.submitId);
  }
  const dataRecord = data && typeof data === 'object' ? data : null;
  return firstString(
    dataRecord?.task_id,
    dataRecord?.taskId,
    dataRecord?.taskID,
    dataRecord?.task,
    dataRecord?.id,
    dataRecord?.request_id,
    dataRecord?.submit_id,
    dataRecord?.submitId,
    record?.task_id,
    record?.taskId,
    record?.taskID,
    record?.task,
    record?.id,
    record?.request_id,
    record?.submit_id,
    record?.submitId,
  );
}

function readTaskStatus(payload) {
  const record = payload && typeof payload === 'object' ? payload : null;
  const data = record?.data && typeof record.data === 'object' ? record.data : null;
  return firstString(data?.status, data?.state, data?.task_status, data?.taskStatus, record?.status, record?.state, record?.task_status, record?.taskStatus);
}

function readTaskError(payload) {
  const record = payload && typeof payload === 'object' ? payload : null;
  const data = record?.data && typeof record.data === 'object' ? record.data : null;
  const error = data?.error && typeof data.error === 'object' ? data.error : null;
  const topError = record?.error && typeof record.error === 'object' ? record.error : null;
  return firstString(error?.message, topError?.message, data?.error, record?.error, data?.message, record?.message);
}

async function readErrorMessage(response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`.trim();
  try {
    const payload = JSON.parse(text);
    const error = payload.error && typeof payload.error === 'object' ? payload.error : null;
    return firstString(error?.message, payload.message, payload.error, text);
  } catch {
    return text;
  }
}

async function requestJson(net, url, init) {
  const response = await net.fetch(url, init);
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.json();
}

async function requestFirstJson(net, urls, init) {
  let lastError;
  for (const url of urls) {
    try {
      return await requestJson(net, url, init);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Request failed.'));
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Aborted'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function extensionFromContentType(contentType) {
  const subtype = String(contentType || '').split('/')[1] || '';
  if (!subtype) return '';
  return `.${subtype.replace('jpeg', 'jpg').replace(/[^a-z0-9.+-]/gi, '')}`;
}

function fileNameFromImageSource(source, contentType, index) {
  try {
    const parsed = new URL(source);
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    if (name && /\.[a-z0-9]+$/i.test(name)) return name;
  } catch {
    // Custom schemes keep generated filename.
  }
  return `reference-${index + 1}${extensionFromContentType(contentType) || '.png'}`;
}

async function readReferenceBlob({ net, assetStore }, source, signal) {
  const localAsset = assetStore.resolveAssetUrl(source);
  if (localAsset && fs.existsSync(localAsset)) {
    const buffer = fs.readFileSync(localAsset);
    return {
      blob: new Blob([buffer]),
      contentType: 'image/' + (path.extname(localAsset).slice(1).replace('jpg', 'jpeg') || 'png'),
      source,
    };
  }
  const response = await net.fetch(source, { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  return {
    blob: await response.blob(),
    contentType: response.headers.get('content-type'),
    source,
  };
}

async function uploadReferenceImage(context, uploadUrl, headers, source, index, signal) {
  const { blob, contentType, source: readableSource } = await readReferenceBlob(context, source, signal);
  const mimeType = blob.type || contentType || 'image/png';
  if (!/^image\//i.test(mimeType)) throw new Error(`Reference image must be an image file, received ${mimeType}.`);
  const formData = new FormData();
  formData.append('file', blob, fileNameFromImageSource(readableSource, mimeType, index));
  const payload = await requestJson(context.net, uploadUrl, {
    method: 'POST',
    headers,
    signal,
    body: formData,
  });
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
  const uploadedUrl = firstString(payload?.url, data?.url);
  if (!uploadedUrl || !isHttpImageUrl(uploadedUrl)) throw new Error(`Image upload did not return a usable URL (${summarizePayloadShape(payload)}).`);
  return uploadedUrl;
}

function blobToDataUri(blob, mimeType) {
  return blob.arrayBuffer().then((arrayBuffer) => {
    const buffer = Buffer.from(arrayBuffer);
    return `data:${mimeType || blob.type || 'image/png'};base64,${buffer.toString('base64')}`;
  });
}

async function referenceImageToDataUri(context, source, signal) {
  const { blob, contentType } = await readReferenceBlob(context, source, signal);
  const mimeType = blob.type || contentType || 'image/png';
  if (!/^image\//i.test(mimeType)) throw new Error(`Reference image must be an image file, received ${mimeType}.`);
  return blobToDataUri(blob, mimeType);
}

async function normalizeReferenceImages(context, baseUrl, uploadHeaders, referenceImages, taskId, signal) {
  const normalized = [];
  const seen = new Set();
  for (const image of referenceImages || []) {
    if (signal?.aborted) throw new Error('Aborted');
    const value = String(image || '').trim();
    if (!value || seen.has(value)) continue;
    if (!/^https?:\/\/|^forart-asset:/i.test(value)) {
      throw new Error('Reference images must be http(s) or Forart asset URLs. Base64 is not supported.');
    }
    seen.add(value);
    if (/^https:\/\/upload\.apimart\.ai\//i.test(value)) {
      normalized.push(value);
    } else {
      context.generationTaskStore.updateTask(taskId, { status: 'running', message: `Uploading reference image ${normalized.length + 1}...` });
      normalized.push(await uploadReferenceImage(context, imageUploadsUrl(baseUrl), uploadHeaders, value, normalized.length, signal));
    }
  }
  return normalized;
}

async function normalizeReferenceImageDataUris(context, referenceImages, taskId, signal) {
  const normalized = [];
  const seen = new Set();
  for (const image of referenceImages || []) {
    if (signal?.aborted) throw new Error('Aborted');
    const value = String(image || '').trim();
    if (!value || seen.has(value)) continue;
    if (!/^https?:\/\/|^forart-asset:|^data:image\//i.test(value)) {
      throw new Error('Reference images must be http(s), Forart asset URLs, or image Data URIs.');
    }
    seen.add(value);
    if (/^data:image\//i.test(value)) {
      normalized.push(value);
      continue;
    }
    context.generationTaskStore.updateTask(taskId, { status: 'running', message: `Preparing reference image ${normalized.length + 1}...` });
    normalized.push(await referenceImageToDataUri(context, value, signal));
  }
  return normalized;
}

function openAiSizeFor(resolution, aspectRatio) {
  const normalizedResolution = String(resolution || '').toLowerCase();
  const shortEdge = normalizedResolution === '4k' ? 4096 : normalizedResolution === '3k' ? 3072 : normalizedResolution === '2k' ? 2048 : 1024;
  const [rawW, rawH] = String(aspectRatio || '1:1').split(':').map(Number);
  const ratioW = rawW || 1;
  const ratioH = rawH || 1;
  if (ratioW === ratioH) return `${shortEdge}x${shortEdge}`;
  if (ratioW > ratioH) return `${shortEdge}x${Math.round(shortEdge * ratioH / ratioW)}`;
  return `${Math.round(shortEdge * ratioW / ratioH)}x${shortEdge}`;
}

async function pollImageTask(context, baseUrl, headers, taskId, upstreamTaskId, initialPayload, signal) {
  let lastPayload = initialPayload;
  context.generationTaskStore.updateTask(taskId, { status: 'running', message: 'Waiting for image result...' });
  await wait(3000, signal);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const current = context.generationTaskStore.getTask(taskId);
    if (!current || current.status === 'interrupted' || current.status === 'superseded') throw new Error('Interrupted');
    const payload = await requestFirstJson(context.net, taskUrlCandidates(baseUrl, upstreamTaskId), {
      method: 'GET',
      headers,
      signal,
    });
    lastPayload = payload;
    const result = findImageInPayload(payload);
    if (result) return result;
    const status = readTaskStatus(payload).toLowerCase();
    if (status) context.generationTaskStore.updateTask(taskId, { status: 'running', message: `Generating: ${status}` });
    if (/(failure|failed|fail|error|errored|cancelled|canceled|rejected|expired|timeout)/i.test(status)) {
      throw new Error(readTaskError(payload) || `Image generation task failed (${summarizePayloadShape(payload)}).`);
    }
    await wait(4000, signal);
  }
  throw new Error(`Image generation task timed out (${summarizePayloadShape(lastPayload)}).`);
}

async function saveOutputAsset(context, result) {
  const saved = await context.assetStore.saveAsset({
    url: result.url,
    defaultName: result.fileName || 'generated-image.png',
    kind: 'output',
  });
  return {
    ...result,
    localUrl: saved.url,
    fileName: saved.fileName || result.fileName || 'generated-image.png',
  };
}

async function executeImageTask(context, task, payload, signal) {
  const provider = payload.provider || {};
  const model = String(payload.model || task.model || '').trim();
  const prompt = String(payload.prompt || task.prompt || '').trim();
  const referenceImages = Array.isArray(payload.referenceImages) ? payload.referenceImages.map(String).filter(Boolean) : [];
  const resolution = String(payload.resolution || task.resolution || '1k');
  const aspectRatio = String(payload.aspectRatio || task.aspectRatio || '1:1');
  const rule = payload.modelRule && typeof payload.modelRule === 'object' ? payload.modelRule : {};
  const baseUrl = String(provider.baseUrl || '').trim();
  if (!baseUrl) throw new Error('API provider base URL is empty.');
  if (!model) throw new Error('No image model selected.');
  if (provider.protocol === 'gemini') throw new Error('Gemini native image generation is disabled because it uses base64 image payloads. Use an OpenAI-compatible image endpoint instead.');
  if (/edit/i.test(model)) throw new Error('Image editing endpoints are disabled. Only text-to-image and image-to-image generation are supported.');

  const headers = {
    'Content-Type': 'application/json',
    ...(String(provider.apiKey || '').trim() ? { Authorization: `Bearer ${String(provider.apiKey || '').trim()}` } : {}),
  };
  const uploadHeaders = String(provider.apiKey || '').trim() ? { Authorization: `Bearer ${String(provider.apiKey || '').trim()}` } : {};
  if (task.upstreamTaskId && payload.recoverOnly !== false) {
    const polledResult = await pollImageTask(context, baseUrl, headers, task.id, task.upstreamTaskId, {}, signal);
    return saveOutputAsset(context, polledResult);
  }
  context.generationTaskStore.updateTask(task.id, { status: 'running', message: referenceImages.length ? 'Preparing reference images...' : 'Preparing text-to-image request...' });
  const requestFormat = rule.requestFormat || 'standard';
  const refs = requestFormat === 'openai-json-extra-body'
    ? await normalizeReferenceImageDataUris(context, referenceImages, task.id, signal)
    : await normalizeReferenceImages(context, baseUrl, uploadHeaders, referenceImages, task.id, signal);
  const sizeMode = rule.sizeMode || (provider.protocol === 'async' ? 'ratio' : 'pixel');
  const resolutionCase = rule.resolutionCase || 'lower';
  const resolutionField = rule.sizeRule?.resolutionField || rule.resolutionField || 'resolution';
  const requestSize = sizeMode === 'ratio' || provider.protocol === 'async' ? aspectRatio : payload.size || openAiSizeFor(resolution, aspectRatio);
  const requestResolution = resolutionCase === 'upper' ? resolution.toUpperCase() : resolution.toLowerCase();
  const sizePayload = resolutionField === 'size'
    ? { size: requestSize }
    : {
      size: requestSize,
      aspect_ratio: aspectRatio,
      ...(resolutionField === 'none' || !requestResolution ? {} : { resolution: requestResolution }),
    };
  const requestBody = requestFormat === 'openai-json-extra-body'
    ? {
      model,
      prompt,
      size: requestSize,
      extra_body: {
        response_format: 'url',
        ...(refs.length ? { image: refs } : {}),
      },
    }
    : {
      model,
      prompt,
      n: 1,
      ...sizePayload,
      ...(refs.length ? { image_urls: refs } : {}),
    };

  context.generationTaskStore.updateTask(task.id, { status: 'running', message: 'Submitting image generation...' });
  const submitPayload = await requestJson(context.net, imageGenerationsUrl(baseUrl), {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(requestBody),
  });
  const directResult = findImageInPayload(submitPayload);
  if (directResult) return saveOutputAsset(context, directResult);
  const upstreamTaskId = readTaskId(submitPayload);
  if (!upstreamTaskId) throw new Error(`The image API response did not contain an image or task_id (${summarizePayloadShape(submitPayload)}).`);
  context.generationTaskStore.updateTask(task.id, { upstreamTaskId, status: 'running' });
  const polledResult = await pollImageTask(context, baseUrl, headers, task.id, upstreamTaskId, submitPayload, signal);
  return saveOutputAsset(context, polledResult);
}

function createImageGenerationRunner({ net, assetStore, generationTaskStore }) {
  const context = { net, assetStore, generationTaskStore };

  async function startTask(payload = {}) {
    const task = generationTaskStore.createTask({ ...payload, status: payload.status || 'submitting' });
    if (activeControllers.has(task.id)) activeControllers.get(task.id)?.abort();
    const controller = new AbortController();
    activeControllers.set(task.id, controller);
    void (async () => {
      try {
        const result = await executeImageTask(context, task, payload, controller.signal);
        const current = generationTaskStore.getTask(task.id);
        if (!current || current.status === 'interrupted' || current.status === 'superseded') return;
        generationTaskStore.updateTask(task.id, {
          status: 'succeeded',
          error: '',
          result,
        });
      } catch (error) {
        const current = generationTaskStore.getTask(task.id);
        if (!current || current.status === 'interrupted' || current.status === 'superseded') return;
        const interrupted = controller.signal.aborted || String(error?.message || error) === 'Interrupted';
        generationTaskStore.updateTask(task.id, {
          status: interrupted ? 'interrupted' : 'failed',
          error: interrupted ? 'Interrupted' : error instanceof Error ? error.message : String(error),
        });
      } finally {
        activeControllers.delete(task.id);
      }
    })();
    return task;
  }

  async function resumeTask(taskId, payload = {}) {
    let task = generationTaskStore.getTask(taskId);
    if (!task && payload && typeof payload === 'object' && payload.id) {
      task = generationTaskStore.createTask({ ...payload, id: taskId, status: payload.status || 'running' });
    }
    if (!task) throw new Error('Generation task not found.');
    if (!task.upstreamTaskId && !payload.provider) return task;
    if (['succeeded', 'failed', 'interrupted', 'superseded'].includes(task.status)) return task;
    if (activeControllers.has(task.id)) return task;
    const controller = new AbortController();
    activeControllers.set(task.id, controller);
    generationTaskStore.updateTask(task.id, { status: 'running' });
    void (async () => {
      try {
        const result = await executeImageTask(context, task, { ...task, ...payload, recoverOnly: true }, controller.signal);
        const current = generationTaskStore.getTask(task.id);
        if (!current || current.status === 'interrupted' || current.status === 'superseded') return;
        generationTaskStore.updateTask(task.id, {
          status: 'succeeded',
          error: '',
          result,
        });
      } catch (error) {
        const current = generationTaskStore.getTask(task.id);
        if (!current || current.status === 'interrupted' || current.status === 'superseded') return;
        const interrupted = controller.signal.aborted || String(error?.message || error) === 'Interrupted';
        generationTaskStore.updateTask(task.id, {
          status: interrupted ? 'interrupted' : 'failed',
          error: interrupted ? 'Interrupted' : error instanceof Error ? error.message : String(error),
        });
      } finally {
        activeControllers.delete(task.id);
      }
    })();
    return generationTaskStore.getTask(task.id);
  }

  function stopTask(taskId) {
    activeControllers.get(taskId)?.abort();
    activeControllers.delete(taskId);
    const task = generationTaskStore.getTask(taskId);
    return generationTaskStore.stopTask(taskId);
  }

  function abortTasks(taskIds = []) {
    taskIds.forEach((taskId) => {
      activeControllers.get(taskId)?.abort();
      activeControllers.delete(taskId);
    });
  }

  function stopTasksForTarget(canvasId, target) {
    const result = generationTaskStore.stopTasksForTarget(canvasId, target);
    abortTasks(result.taskIds);
    return result;
  }

  function stopTasksForNode(canvasId, nodeId) {
    const result = generationTaskStore.stopTasksForNode(canvasId, nodeId);
    abortTasks(result.taskIds);
    return result;
  }

  function stopTasksForCanvas(canvasId) {
    const result = generationTaskStore.stopTasksForCanvas(canvasId);
    abortTasks(result.taskIds);
    return result;
  }

  return {
    resumeTask,
    startTask,
    stopTask,
    stopTasksForCanvas,
    stopTasksForNode,
    stopTasksForTarget,
  };
}

module.exports = { createImageGenerationRunner };
