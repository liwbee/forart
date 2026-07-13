const fs = require('fs');
const path = require('path');

const activeControllers = new Map();

function joinApiPath(baseUrl, pathName) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${String(pathName || '').replace(/^\/+/, '')}`;
}

function isHttpUrl(value) {
  return /^https?:\/\/\S+/i.test(String(value || '').trim());
}

function imageGenerationsUrl(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/images\/generations$/i.test(normalized)) return normalized;
  for (const prefix of ['/api/v3', '/v1beta', '/v1', '/v2']) {
    if (normalized.endsWith(prefix)) return joinApiPath(normalized, 'images/generations');
  }
  return joinApiPath(normalized, 'v1/images/generations');
}

function providerEndpointUrl(provider, key, defaultPath) {
  const baseUrl = String(provider?.baseUrl || '').trim().replace(/\/+$/, '');
  const override = String(provider?.[key] || '').trim();
  if (override) {
    if (/^https?:\/\//i.test(override)) return override.replace(/\/+$/, '');
    if (override.startsWith('/')) {
      try {
        const parsed = new URL(baseUrl);
        return `${parsed.protocol}//${parsed.host}${override}`;
      } catch {
        return override;
      }
    }
    return joinApiPath(baseUrl, override);
  }
  const normalizedDefault = String(defaultPath || '').replace(/^\/+/, '');
  const defaultWithoutVersion = normalizedDefault.replace(/^(?:api\/)?v\d+(?:beta)?\//i, '');
  const trailingVersion = baseUrl.match(/\/(?:api\/)?v\d+(?:beta)?$/i);
  if (trailingVersion && defaultWithoutVersion !== normalizedDefault) {
    if (String(provider?.protocol || '').toLowerCase() === 'gemini') {
      return `${baseUrl.slice(0, trailingVersion.index)}/${normalizedDefault}`;
    }
    return joinApiPath(baseUrl, defaultWithoutVersion);
  }
  if (normalizedDefault && baseUrl.toLowerCase().endsWith(`/${normalizedDefault.toLowerCase()}`)) return baseUrl;
  if (/\/images\/generations$/i.test(baseUrl) && /\/images\/generations$/i.test(defaultPath)) return baseUrl;
  if (/\/images\/edits$/i.test(baseUrl) && /\/images\/edits$/i.test(defaultPath)) return baseUrl;
  for (const prefix of ['/api/v3', '/v1beta', '/v1', '/v2']) {
    if (baseUrl.endsWith(prefix) && String(defaultPath || '').startsWith(`${prefix}/`)) {
      return `${baseUrl}${defaultPath.slice(prefix.length)}`;
    }
  }
  return joinApiPath(baseUrl, defaultPath);
}

function imageEditsUrl(provider) {
  return providerEndpointUrl(provider, 'imageEditEndpoint', '/v1/images/edits');
}

function geminiModelName(model) {
  return String(model || '').trim().replace(/^models\//, '') || 'gemini-3-pro-image-preview';
}

function geminiGenerateContentUrl(provider, model) {
  const modelName = encodeURIComponent(geminiModelName(model));
  return providerEndpointUrl(provider, 'imageGenerationEndpoint', `/v1beta/models/${modelName}:generateContent`);
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
  const imageGenerationPath = `images/generations/${encodeURIComponent(taskId)}`;
  const candidates = [
    joinApiPath(normalized, taskPath),
    joinApiPath(normalized, imageTaskPath),
    joinApiPath(normalized, imageGenerationPath),
  ];
  return [...new Set(candidates)].filter(isHttpUrl);
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && Boolean(value.trim())) || '';
}

function isHttpImageUrl(value) {
  return isHttpUrl(value);
}

function valueToImage(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (isHttpImageUrl(text)) return { url: text, fileName: 'generated-image.png' };
  if (/^data:image\//i.test(text)) return { dataUrl: text, fileName: 'generated-image.png' };
  return null;
}

function findImagesInPayload(payload) {
  const record = payload && typeof payload === 'object' ? payload : null;
  const data = record?.data;
  const dataRecord = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  const preferredOutput = dataRecord?.result?.images
    || record?.result?.images
    || dataRecord?.images
    || record?.images
    || (Array.isArray(data) ? data : null);
  const queue = [preferredOutput || payload];
  const seen = new Set();
  const imageKeys = new Set();
  const images = [];
  const addImage = (image) => {
    if (!image) return;
    const key = String(image.url || image.dataUrl || '').trim();
    if (!key || imageKeys.has(key)) return;
    imageKeys.add(key);
    images.push({ ...image, fileName: `generated-image-${images.length + 1}.png` });
  };
  while (queue.length) {
    const value = queue.shift();
    const image = valueToImage(value);
    if (image) {
      addImage(image);
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => queue.push(item));
      continue;
    }
    const imageUrl = value.image_url;
    if (typeof imageUrl === 'string' && isHttpImageUrl(imageUrl)) addImage({ url: imageUrl });
    if (imageUrl && typeof imageUrl === 'object') {
      const nestedUrl = firstString(imageUrl.url);
      if (nestedUrl && isHttpImageUrl(nestedUrl)) addImage({ url: nestedUrl });
    }
    const b64 = firstString(value.b64_json, value.base64, value.image_base64, value.imageBase64);
    if (b64) {
      const mimeType = firstString(value.mime_type, value.mimeType) || 'image/png';
      addImage({ dataUrl: `data:${mimeType};base64,${b64}` });
    }
    Object.values(value).forEach((childValue) => queue.push(childValue));
  }
  return images;
}

function findGeminiImageInPayload(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      const data = firstString(inline?.data);
      if (data) {
        return {
          dataUrl: `data:${firstString(inline?.mimeType, inline?.mime_type) || 'image/png'};base64,${data}`,
          fileName: 'generated-image.png',
        };
      }
    }
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
    return firstString(first?.task_id, first?.taskId, first?.taskID, first?.task, first?.request_id, first?.submit_id, first?.submitId);
  }
  const dataRecord = data && typeof data === 'object' ? data : null;
  return firstString(
    dataRecord?.task_id,
    dataRecord?.taskId,
    dataRecord?.taskID,
    dataRecord?.task,
    dataRecord?.request_id,
    dataRecord?.submit_id,
    dataRecord?.submitId,
    record?.task_id,
    record?.taskId,
    record?.taskID,
    record?.task,
    record?.request_id,
    record?.submit_id,
    record?.submitId,
  );
}

function readTaskStatus(payload) {
  const record = payload && typeof payload === 'object' ? payload : null;
  const data = Array.isArray(record?.data)
    ? record.data.find((item) => item && typeof item === 'object') || null
    : record?.data && typeof record.data === 'object' ? record.data : null;
  return firstString(data?.status, data?.state, data?.task_status, data?.taskStatus, record?.status, record?.state, record?.task_status, record?.taskStatus);
}

function readTaskError(payload) {
  const record = payload && typeof payload === 'object' ? payload : null;
  const data = Array.isArray(record?.data)
    ? record.data.find((item) => item && typeof item === 'object') || null
    : record?.data && typeof record.data === 'object' ? record.data : null;
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
  if (!response.ok) {
    const error = new Error(await readErrorMessage(response));
    error.status = response.status;
    error.url = url;
    throw error;
  }
  return response.json();
}

async function requestFirstJson(net, urls, init) {
  if (!urls.length) throw new Error('Image task polling URL must be an absolute http(s) URL.');
  let lastError;
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    try {
      return await requestJson(net, url, init);
    } catch (error) {
      lastError = error;
      if (![404, 405].includes(Number(error?.status)) || index === urls.length - 1) throw error;
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

async function referenceToFile(context, source, index, signal) {
  const { blob, contentType, source: readableSource } = await readReferenceBlob(context, source, signal);
  const mimeType = blob.type || contentType || 'image/png';
  if (!/^image\//i.test(mimeType)) throw new Error(`Reference image must be an image file, received ${mimeType}.`);
  return {
    blob,
    mimeType,
    fileName: fileNameFromImageSource(readableSource, mimeType, index),
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
      context.generationTaskStore.updateTask(taskId, {
        status: 'running',
        message: '',
        messageCode: 'image.referenceUploading',
        messageParams: { current: normalized.length + 1, total: referenceImages.length },
      });
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
    context.generationTaskStore.updateTask(taskId, {
      status: 'running',
      message: '',
      messageCode: 'image.referencePreparing',
      messageParams: { current: normalized.length + 1, total: referenceImages.length },
    });
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

function isGptImage2Model(model) {
  return /gpt[-_. ]?image[-_. ]?(?:v)?2/i.test(String(model || ''));
}

function geminiImageConfig(resolution, aspectRatio) {
  const rawResolution = String(resolution || '').trim().toUpperCase();
  const imageSize = ['1K', '2K', '4K'].includes(rawResolution) ? rawResolution : '2K';
  const ratio = /^\d+\s*:\s*\d+$/.test(String(aspectRatio || '').trim())
    ? String(aspectRatio).replace(/\s+/g, '')
    : '1:1';
  return { aspectRatio: ratio, imageSize };
}

function dataUriToGeminiPart(dataUri) {
  const match = String(dataUri || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (!match) return null;
  return { inlineData: { mimeType: match[1] || 'image/png', data: match[2] || '' } };
}

async function generateGeminiImage(context, provider, model, prompt, referenceImages, resolution, aspectRatio, taskId, signal) {
  const apiKey = String(provider.apiKey || '').trim();
  const parts = [{ text: prompt }];
  const refs = await normalizeReferenceImageDataUris(context, referenceImages, taskId, signal);
  refs.forEach((ref) => {
    const part = dataUriToGeminiPart(ref);
    if (part) parts.push(part);
  });
  const payload = await requestJson(context.net, geminiGenerateContentUrl(provider, model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
    },
    signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: geminiImageConfig(resolution, aspectRatio),
      },
    }),
  });
  const result = findGeminiImageInPayload(payload) || findImagesInPayload(payload)[0];
  if (!result) throw new Error(`The Gemini response did not contain an image (${summarizePayloadShape(payload)}).`);
  return saveOutputAsset(context, result, taskId);
}

async function pollImageTask(context, baseUrl, headers, taskId, upstreamTaskId, initialPayload, signal) {
  let lastPayload = initialPayload;
  context.generationTaskStore.updateTask(taskId, { status: 'running', message: '', messageCode: 'image.waitingForResult', messageParams: null });
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
    const results = findImagesInPayload(payload);
    if (results.length) return results;
    const status = readTaskStatus(payload).toLowerCase();
    if (status) context.generationTaskStore.updateTask(taskId, { status: 'running', message: status, messageCode: '', messageParams: null });
    if (/(failure|failed|fail|error|errored|cancelled|canceled|rejected|expired|timeout)/i.test(status)) {
      throw new Error(readTaskError(payload) || `Image generation task failed (${summarizePayloadShape(payload)}).`);
    }
    await wait(4000, signal);
  }
  throw new Error(`Image generation task timed out (${summarizePayloadShape(lastPayload)}).`);
}

async function saveOutputAsset(context, result, taskId) {
  if (taskId) {
    const current = context.generationTaskStore.getTask(taskId);
    if (!current || ['interrupted', 'superseded'].includes(current.status)) throw new Error('Interrupted');
    context.generationTaskStore.updateTask(taskId, { status: 'running', message: '', messageCode: 'generation.resultProcessing', messageParams: null });
  }
  const saved = await context.assetStore.saveAsset({
    url: result.url,
    dataUrl: result.dataUrl,
    defaultName: result.fileName || 'generated-image.png',
    kind: 'output',
  });
  return {
    ...result,
    url: result.url || result.dataUrl || '',
    localUrl: saved.url,
    thumbUrl: saved.thumbUrl || '',
    fileName: saved.fileName || result.fileName || 'generated-image.png',
  };
}

async function saveOutputAssets(context, results, taskId) {
  const candidates = Array.isArray(results) ? results.filter(Boolean) : [];
  if (!candidates.length) throw new Error('The image response did not contain a usable result.');
  const savedResults = [];
  for (let index = 0; index < candidates.length; index += 1) {
    savedResults.push(await saveOutputAsset(context, {
      ...candidates[index],
      fileName: candidates[index].fileName || `generated-image-${index + 1}.png`,
    }, taskId));
  }
  return { ...savedResults[0], results: savedResults };
}

function updateTaskWithRemoteAnchor(context, taskId, patch) {
  const current = context.generationTaskStore.getTask(taskId);
  if (!current || ['interrupted', 'superseded'].includes(current.status)) throw new Error('Interrupted');
  const task = context.generationTaskStore.updateTask(taskId, patch);
  if (patch.upstreamTaskId && task.canvasId && task.target?.nodeId) {
    if (task.target.type === 'actionFissionRow') {
      context.canvasStore?.setActionFissionRowRemoteTaskId(task.canvasId, task.target.nodeId, task.target.rowId, patch.upstreamTaskId);
    } else {
      context.canvasStore?.setGenerationRemoteTaskId(task.canvasId, task.target.nodeId, patch.upstreamTaskId);
    }
  }
  return task;
}

function writeTaskTerminalToCanvas(context, task, status, result, error) {
  if (!task?.canvasId || !task.target?.nodeId) return;
  const payload = {
    canvasId: task.canvasId,
    nodeId: task.target.nodeId,
    taskId: task.id,
    remoteTaskId: task.upstreamTaskId,
    status,
    result,
    error,
  };
  if (task.target.type === 'actionFissionRow') {
    context.canvasStore?.completeActionFissionRow({ ...payload, rowId: task.target.rowId });
  } else {
    context.canvasStore?.completeGenerationNode(payload);
  }
}

async function submitOpenAiEditTask(context, provider, headers, model, prompt, referenceImages, size, quality, imageCount, signal) {
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('size', size);
  formData.append('response_format', 'url');
  formData.append('n', String(imageCount));
  if (quality) formData.append('quality', quality);
  for (let index = 0; index < referenceImages.length; index += 1) {
    const file = await referenceToFile(context, referenceImages[index], index, signal);
    formData.append('image', file.blob, file.fileName);
  }
  const { 'Content-Type': _contentType, ...multipartHeaders } = headers;
  return requestJson(context.net, imageEditsUrl(provider), {
    method: 'POST',
    headers: multipartHeaders,
    signal,
    body: formData,
  });
}

async function executeImageTask(context, task, payload, signal) {
  const provider = payload.provider || {};
  const model = String(payload.model || task.model || '').trim();
  const prompt = String(payload.prompt || task.prompt || '').trim();
  const referenceImages = Array.isArray(payload.referenceImages) ? payload.referenceImages.map(String).filter(Boolean) : [];
  const resolution = String(payload.resolution || task.resolution || '1k');
  const aspectRatio = String(payload.aspectRatio || task.aspectRatio || '1:1');
  const rule = payload.modelRule && typeof payload.modelRule === 'object' ? payload.modelRule : {};
  const qualityOptions = Array.isArray(rule.qualityRule?.options) ? rule.qualityRule.options.map(String) : [];
  const quality = qualityOptions.includes(String(payload.quality || task.quality || ''))
    ? String(payload.quality || task.quality)
    : String(rule.qualityRule?.defaultQuality || '');
  const countOptions = Array.isArray(rule.imageCountRule?.options)
    ? rule.imageCountRule.options.map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : [1];
  const combinedLimit = Number(rule.imageCountRule?.maxCombinedWithReferences || 0);
  const availableCounts = countOptions.filter((count) => !combinedLimit || referenceImages.length + count <= combinedLimit);
  const requestedCount = Math.max(1, Math.round(Number(payload.imageCount || task.imageCount || rule.imageCountRule?.defaultCount || 1)));
  const imageCount = availableCounts.includes(requestedCount) ? requestedCount : availableCounts[0] || 1;
  const baseUrl = String(provider.baseUrl || '').trim();
  const protocol = String(provider.protocol || 'openai').trim().toLowerCase();
  if (!baseUrl) throw new Error('API provider base URL is empty.');
  if (!model) throw new Error('No image model selected.');
  const headers = {
    'Content-Type': 'application/json',
    ...(String(provider.apiKey || '').trim() ? { Authorization: `Bearer ${String(provider.apiKey || '').trim()}` } : {}),
  };
  const uploadHeaders = String(provider.apiKey || '').trim() ? { Authorization: `Bearer ${String(provider.apiKey || '').trim()}` } : {};
  if (task.upstreamTaskId && payload.recoverOnly !== false) {
    const pollBaseUrl = providerEndpointUrl(provider, 'imageGenerationEndpoint', '/v1/images/generations');
    const polledResults = await pollImageTask(context, pollBaseUrl, headers, task.id, task.upstreamTaskId, {}, signal);
    return saveOutputAssets(context, polledResults, task.id);
  }
  context.generationTaskStore.updateTask(task.id, {
    status: 'running',
    message: '',
    messageCode: referenceImages.length ? 'image.referencesPreparing' : 'image.textRequestPreparing',
    messageParams: null,
  });
  if (protocol === 'gemini') {
    context.generationTaskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'image.geminiSubmitting', messageParams: null });
    return generateGeminiImage(context, provider, model, prompt, referenceImages, resolution, aspectRatio, task.id, signal);
  }

  if (protocol === 'openai') {
    const requestSize = payload.size || openAiSizeFor(resolution, aspectRatio);
    const requestMode = provider.imageRequestMode === 'openai-json' ? 'openai-json' : 'openai';
    let submitPayload;
    if (referenceImages.length && requestMode === 'openai') {
      context.generationTaskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'image.editSubmitting', messageParams: null });
      try {
        submitPayload = await submitOpenAiEditTask(context, provider, headers, model, prompt, referenceImages, requestSize, quality, imageCount, signal);
      } catch (error) {
        if (isGptImage2Model(model)) throw error;
        context.generationTaskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'image.jsonReferenceRetrying', messageParams: null });
      }
    }
    if (!submitPayload) {
      const refs = referenceImages.length ? await normalizeReferenceImageDataUris(context, referenceImages, task.id, signal) : [];
      const submitUrl = providerEndpointUrl(provider, 'imageGenerationEndpoint', '/v1/images/generations');
      const requestBody = {
        model,
        prompt,
        size: requestSize,
        response_format: 'url',
        n: imageCount,
        ...(quality ? { quality } : {}),
        ...(refs.length ? { image: refs } : {}),
      };
      context.generationTaskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'image.generationSubmitting', messageParams: null });
      submitPayload = await requestJson(context.net, submitUrl, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify(requestBody),
      });
    }
    const directResults = findImagesInPayload(submitPayload);
    if (directResults.length) return saveOutputAssets(context, directResults, task.id);
    const upstreamTaskId = readTaskId(submitPayload);
    if (!upstreamTaskId) throw new Error(`The image API response did not contain an image or task_id (${summarizePayloadShape(submitPayload)}).`);
    updateTaskWithRemoteAnchor(context, task.id, { upstreamTaskId, status: 'running' });
    const pollBaseUrl = providerEndpointUrl(provider, 'imageGenerationEndpoint', '/v1/images/generations');
    const polledResults = await pollImageTask(context, pollBaseUrl, headers, task.id, upstreamTaskId, submitPayload, signal);
    return saveOutputAssets(context, polledResults, task.id);
  }

  const requestFormat = rule.requestFormat || 'standard';
  const refs = requestFormat === 'openai-json-extra-body'
    ? await normalizeReferenceImageDataUris(context, referenceImages, task.id, signal)
    : await normalizeReferenceImages(context, baseUrl, uploadHeaders, referenceImages, task.id, signal);
  const sizeMode = rule.sizeMode || (provider.protocol === 'compatible' ? 'ratio' : 'pixel');
  const resolutionCase = rule.resolutionCase || 'lower';
  const resolutionField = rule.sizeRule?.resolutionField || rule.resolutionField || 'resolution';
  const requestSize = sizeMode === 'ratio' || provider.protocol === 'compatible' ? aspectRatio : payload.size || openAiSizeFor(resolution, aspectRatio);
  const requestResolution = resolutionCase === 'upper' ? resolution.toUpperCase() : resolution.toLowerCase();
  const sizePayload = resolutionField === 'size'
    ? { size: requestSize }
    : {
      size: requestSize,
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
      n: imageCount,
      ...(quality ? { quality } : {}),
      ...sizePayload,
      ...(refs.length ? { image_urls: refs } : {}),
    };

  context.generationTaskStore.updateTask(task.id, { status: 'running', message: '', messageCode: 'image.generationSubmitting', messageParams: null });
  const submitUrl = providerEndpointUrl(provider, 'imageGenerationEndpoint', '/v1/images/generations') || imageGenerationsUrl(baseUrl);
  const submitPayload = await requestJson(context.net, submitUrl, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(requestBody),
  });
  const directResults = findImagesInPayload(submitPayload);
  if (directResults.length) return saveOutputAssets(context, directResults, task.id);
  const upstreamTaskId = readTaskId(submitPayload);
  if (!upstreamTaskId) throw new Error(`The image API response did not contain an image or task_id (${summarizePayloadShape(submitPayload)}).`);
  updateTaskWithRemoteAnchor(context, task.id, { upstreamTaskId, status: 'running' });
  const polledResults = await pollImageTask(context, submitUrl, headers, task.id, upstreamTaskId, submitPayload, signal);
  return saveOutputAssets(context, polledResults, task.id);
}

function createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore }) {
  const context = { net, assetStore, canvasStore, generationTaskStore };

  async function startTask(payload = {}) {
    const supersededTaskIds = generationTaskStore.activeTaskIdsForTarget?.(payload.canvasId, payload.target) || [];
    const task = generationTaskStore.createTask({ ...payload, status: payload.status || 'submitting' });
    if (task.target?.type === 'actionFissionRow') {
      context.canvasStore?.setActionFissionRowTaskAnchor(task.canvasId, task.target.nodeId, task.target.rowId, { taskId: task.id });
    }
    supersededTaskIds.forEach((taskId) => {
      const superseded = generationTaskStore.getTask(taskId);
      activeControllers.get(taskId)?.abort();
      activeControllers.delete(taskId);
      writeTaskTerminalToCanvas(context, superseded, 'interrupted');
    });
    if (activeControllers.has(task.id)) activeControllers.get(task.id)?.abort();
    const controller = new AbortController();
    activeControllers.set(task.id, controller);
    void (async () => {
      try {
        const result = await executeImageTask(context, task, payload, controller.signal);
        const current = generationTaskStore.getTask(task.id);
        if (!current || current.status === 'interrupted' || current.status === 'superseded') return;
        const completed = generationTaskStore.updateTask(task.id, {
          status: 'succeeded',
          error: '',
          result,
        });
        writeTaskTerminalToCanvas(context, completed, 'succeeded', result);
      } catch (error) {
        const current = generationTaskStore.getTask(task.id);
        if (!current || current.status === 'interrupted' || current.status === 'superseded') return;
        const interrupted = controller.signal.aborted || String(error?.message || error) === 'Interrupted';
        const completed = generationTaskStore.updateTask(task.id, {
          status: interrupted ? 'interrupted' : 'failed',
          error: interrupted ? 'Interrupted' : error instanceof Error ? error.message : String(error),
        });
        writeTaskTerminalToCanvas(context, completed, completed.status, undefined, completed.error);
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
        const completed = generationTaskStore.updateTask(task.id, {
          status: 'succeeded',
          error: '',
          result,
        });
        writeTaskTerminalToCanvas(context, completed, 'succeeded', result);
      } catch (error) {
        const current = generationTaskStore.getTask(task.id);
        if (!current || current.status === 'interrupted' || current.status === 'superseded') return;
        const interrupted = controller.signal.aborted || String(error?.message || error) === 'Interrupted';
        const completed = generationTaskStore.updateTask(task.id, {
          status: interrupted ? 'interrupted' : 'failed',
          error: interrupted ? 'Interrupted' : error instanceof Error ? error.message : String(error),
        });
        writeTaskTerminalToCanvas(context, completed, completed.status, undefined, completed.error);
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
    if (!task) return null;
    const stopped = generationTaskStore.stopTask(taskId);
    writeTaskTerminalToCanvas(context, stopped, 'interrupted');
    return stopped;
  }

  function getTask(taskId) {
    return generationTaskStore.getTask(taskId);
  }

  async function recoverTask(payload = {}) {
    const canvasId = String(payload.canvasId || '').trim();
    const nodeId = String(payload.nodeId || '').trim();
    const upstreamTaskId = String(payload.upstreamTaskId || payload.remoteTaskId || '').trim();
    if (!canvasId || !nodeId || !upstreamTaskId) throw new Error('Generation recovery target is incomplete.');
    const target = payload.target?.type === 'actionFissionRow'
      ? { type: 'actionFissionRow', nodeId, rowId: String(payload.target.rowId || payload.rowId || '').trim() }
      : { type: 'imageGenerator', nodeId };
    if (target.type === 'actionFissionRow' && !target.rowId) throw new Error('Generation recovery row target is incomplete.');
    const existingId = generationTaskStore.activeTaskIdsForTarget?.(canvasId, target)?.[0];
    const existing = existingId ? generationTaskStore.getTask(existingId) : null;
    if (existing?.upstreamTaskId === upstreamTaskId) return existing;
    if (existing) stopTask(existing.id);
    const anchoredTaskId = String(payload.taskId || '').trim();
    const safeRemoteId = upstreamTaskId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
    const taskId = anchoredTaskId || `gen_recover_${safeRemoteId || Date.now().toString(36)}`;
    return resumeTask(taskId, {
      ...payload,
      id: taskId,
      canvasId,
      nodeId,
      target,
      upstreamTaskId,
      status: 'running',
    });
  }

  async function recoverCanvasTasks(payload = {}) {
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const providersById = new Map(providers.map((provider) => [String(provider?.id || ''), provider]));
    const recovered = [];
    const errors = [];
    for (const anchor of canvasStore?.listGenerationTaskAnchors?.() || []) {
      const provider = providersById.get(anchor.providerId);
      if (!provider) continue;
      try {
        const existing = anchor.taskId ? generationTaskStore.getTask(anchor.taskId) : null;
        if (existing) {
          recovered.push(existing);
          continue;
        }
        if (!anchor.remoteTaskId) {
          if (anchor.target?.type === 'actionFissionRow') {
            canvasStore?.completeActionFissionRow({
              canvasId: anchor.canvasId,
              nodeId: anchor.nodeId,
              rowId: anchor.target.rowId,
              taskId: anchor.taskId,
              status: 'interrupted',
            });
          }
          continue;
        }
        recovered.push(await recoverTask({
          canvasId: anchor.canvasId,
          nodeId: anchor.nodeId,
          rowId: anchor.rowId,
          target: anchor.target,
          taskId: anchor.taskId,
          upstreamTaskId: anchor.remoteTaskId,
          providerId: anchor.providerId,
          provider,
          model: anchor.model,
        }));
      } catch (error) {
        errors.push({
          canvasId: anchor.canvasId,
          nodeId: anchor.nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { ok: true, tasks: recovered, errors };
  }

  function reconcileCanvasPayload(canvasId, payload = {}) {
    if (!Array.isArray(payload.nodes)) return payload;
    return {
      ...payload,
      nodes: payload.nodes.map((node) => {
        const data = node?.data && typeof node.data === 'object' ? { ...node.data } : {};
        delete data.generationTask;
        const nodeId = String(node?.id || '');
        if (data.actionFission && typeof data.actionFission === 'object' && Array.isArray(data.actionFission.rows)) {
          data.actionFission = {
            ...data.actionFission,
            rows: data.actionFission.rows.map((sourceRow) => {
              const row = sourceRow && typeof sourceRow === 'object' ? { ...sourceRow } : {};
              delete row.generationTask;
              const rowId = String(row.id || '');
              const rowTask = generationTaskStore.latestTaskForTarget?.(canvasId, { type: 'actionFissionRow', nodeId, rowId });
              if (rowTask && ['queued', 'submitting', 'running'].includes(rowTask.status)) {
                row.generationTaskId = rowTask.id;
                if (rowTask.upstreamTaskId) row.generationRemoteTaskId = rowTask.upstreamTaskId;
              } else if (rowTask && ['succeeded', 'failed', 'interrupted', 'superseded'].includes(rowTask.status)) {
                delete row.generationTaskId;
                delete row.generationRemoteTaskId;
                if (rowTask.status === 'succeeded' && rowTask.result?.localUrl) {
                  row.resultUrl = rowTask.result.localUrl;
                  row.resultFileName = rowTask.result.fileName || row.selectedActionName || 'Generated image';
                  row.resultWidth = Number(rowTask.result.width || 0) || undefined;
                  row.resultHeight = Number(rowTask.result.height || 0) || undefined;
                  row.resultDownloadState = 'pending';
                  delete row.resultDownloadedAt;
                  row.error = '';
                } else if (rowTask.status === 'failed') {
                  row.error = rowTask.error || 'Image generation failed.';
                } else {
                  row.error = '';
                }
              }
              return row;
            }),
          };
        }
        const task = generationTaskStore.latestTaskForTarget?.(canvasId, { type: 'imageGenerator', nodeId });
        if (task && ['queued', 'submitting', 'running'].includes(task.status) && task.upstreamTaskId) {
          data.generationRemoteTaskId = task.upstreamTaskId;
        } else if (task && ['succeeded', 'failed', 'interrupted', 'superseded'].includes(task.status)) {
          delete data.generationRemoteTaskId;
        }
        return { ...node, data };
      }),
    };
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
    result.tasks.forEach((task) => writeTaskTerminalToCanvas(context, task, 'interrupted'));
    return result;
  }

  function stopTasksForNode(canvasId, nodeId) {
    const result = generationTaskStore.stopTasksForNode(canvasId, nodeId);
    abortTasks(result.taskIds);
    result.tasks.forEach((task) => writeTaskTerminalToCanvas(context, task, 'interrupted'));
    return result;
  }

  function stopTasksForCanvas(canvasId) {
    const result = generationTaskStore.stopTasksForCanvas(canvasId);
    abortTasks(result.taskIds);
    result.tasks.forEach((task) => writeTaskTerminalToCanvas(context, task, 'interrupted'));
    return result;
  }

  return {
    getTask,
    reconcileCanvasPayload,
    recoverCanvasTasks,
    recoverTask,
    resumeTask,
    startTask,
    stopTask,
    stopTasksForCanvas,
    stopTasksForNode,
    stopTasksForTarget,
  };
}

module.exports = { createImageGenerationRunner };
