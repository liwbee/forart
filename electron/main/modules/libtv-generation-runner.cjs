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
  const candidates = [];
  walk(payload, (item) => {
    candidates.push(
      item.url,
      item.imageUrl,
      item.resultUrl,
      item.downloadUrl,
      item.outputUrl,
      item.src,
      item.data?.url,
      item.data?.imageUrl,
      item.data?.resultUrl,
    );
  });
  const fromJson = candidates
    .map((item) => String(item || '').trim())
    .find((item) => /^https?:\/\//i.test(item) || /^data:image\//i.test(item));
  if (fromJson) return fromJson;
  const text = String(stdout || '');
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0] || '';
}

function collectImageUrls(payload, stdout = '') {
  const urls = [];
  const seen = new Set();
  const addUrl = (value) => {
    const text = String(value || '').trim();
    if (!(/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) || seen.has(text)) return;
    seen.add(text);
    urls.push(text);
  };
  walk(payload, (item) => {
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

function extractGroupId(payload, stdout = '') {
  const candidates = [];
  walk(payload, (item) => {
    candidates.push(
      item.groupNodeKey,
      item.newNodeKey,
      item.nodeKey,
      item.groupId,
      item.id,
      item.uuid,
      item.data?.groupNodeKey,
      item.data?.newNodeKey,
      item.data?.nodeKey,
      item.data?.id,
    );
  });
  const jsonCandidate = candidates.map((item) => String(item || '').trim()).find(Boolean);
  if (jsonCandidate) return jsonCandidate;
  const text = String(stdout || '');
  const match = text.match(/(?:groupNodeKey|newNodeKey|nodeKey|groupId|id|uuid)["'\s:=]+([a-zA-Z0-9_-]{6,})/i);
  return match?.[1] || '';
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

function stringifyDiagnostic(value, maxLength = 12000) {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... [truncated ${text.length - maxLength} chars]`;
}

function createLibtvGenerationRunner({ libtv, assetStore }) {
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
      const ensuredProject = await libtv.ensureDailyProject({ workspaceId });
      projectUuid = firstString(ensuredProject.project?.uuid);
      projectName = firstString(ensuredProject.project?.name, projectName);
      if (!projectUuid) throw new Error('LibTV daily canvas could not be created or resolved.');
    }
    return { projectUuid, projectName };
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
        aspectRatio: firstString(job.aspectRatio, payload.aspectRatio, '1:1'),
        quality: firstString(job.quality, payload.quality, '2K'),
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
      modeType: remoteReferenceNodeIds.length ? 'image2image' : '',
      ratio: job.aspectRatio,
      quality: job.quality,
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

  async function saveResult(resultUrl) {
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
      lines.push(`  aspectRatio: ${job.aspectRatio || ''}`);
      lines.push(`  quality: ${job.quality || ''}`);
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
    generateBatch,
    generateImage,
  };
}

module.exports = { createLibtvGenerationRunner, extractImageUrl, extractNodeId };
