function safeString(value) { return String(value == null ? '' : value).trim(); }

function chineseOrdinal(value) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 10) return value === 10 ? '十' : digits[value];
  if (value < 20) return `十${digits[value % 10]}`;
  return String(value);
}

function referenceAliases(index) {
  const ordinal = Math.max(0, index) + 1;
  return new Set([
    `@图${chineseOrdinal(ordinal)}`,
    `@图${ordinal}`,
    `@Image ${ordinal}`,
    `@image${ordinal}`,
  ].map((value) => value.toLowerCase()));
}

function promptDocumentFromReferenceText(prompt, references) {
  const source = String(prompt || '');
  const inputs = Array.isArray(references) ? references : [];
  if (!source || !inputs.length) return undefined;
  const aliases = inputs.map((_, index) => referenceAliases(index));
  const tokenPattern = /@(图(?:[零一二三四五六七八九十百]+|\d+)|Image\s+\d+|image\d+)/gi;
  let found = false;
  const children = source.split(/\n/).map((line) => {
    const paragraphChildren = [];
    let cursor = 0;
    for (const match of line.matchAll(tokenPattern)) {
      const token = match[0];
      const start = match.index || 0;
      if (start > cursor) paragraphChildren.push({ type: 'text', version: 1, text: line.slice(cursor, start) });
      const referenceIndex = aliases.findIndex((set) => set.has(token.toLowerCase()));
      if (referenceIndex < 0) paragraphChildren.push({ type: 'text', version: 1, text: token });
      else {
        const edgeId = safeString(inputs[referenceIndex]?.edgeId);
        if (edgeId) {
          paragraphChildren.push({ type: 'image-reference', version: 1, edgeId });
          found = true;
        } else paragraphChildren.push({ type: 'text', version: 1, text: token });
      }
      cursor = start + token.length;
    }
    if (cursor < line.length) paragraphChildren.push({ type: 'text', version: 1, text: line.slice(cursor) });
    return { type: 'paragraph', version: 1, children: paragraphChildren };
  });
  return found ? { root: { type: 'root', version: 1, children } } : undefined;
}

function createCanvasAgentRuntime({ canvasAgent, canvasStore } = {}) {
  if (!canvasAgent) throw new Error('Canvas Agent is required.');
  const active = new Map();

  const operationFor = (request) => String(request.operation || '') || (
    request.task === 'smart-reverse' ? 'smart_reverse' :
      request.task === 'generate-action-fission-prompts' ? 'action_fission_prompt_generate' :
        'image_prompt_optimize'
  );

  const reverseResultText = (result) => {
    const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
    if (outputs.length <= 1) return String(outputs[0]?.detailedPrompt || outputs[0]?.compactPrompt || result?.detailedPrompt || '');
    return outputs.map((output, index) => `图${index + 1}\n${String(output?.detailedPrompt || output?.compactPrompt || '')}`).join('\n\n');
  };

  function commitResult(request, result) {
    if (!canvasStore?.updateGenerationNode || !request.canvasId || !request.nodeId) return;
    const operation = operationFor(request);
    if (operation === 'smart_reverse') {
      canvasStore.updateGenerationNode(request.canvasId, request.nodeId, (data) => ({
        ...data,
        smartReverseResult: result,
        text: reverseResultText(result),
      }));
      return;
    }
    if (operation !== 'image_prompt_optimize') return;
    const optimizedPrompt = String(result?.optimizedPrompt || '').trim();
    if (!optimizedPrompt) return;
    const sourcePrompt = String(request.context?.prompt || '').trim();
    const references = Array.isArray(request.context?.referenceImages) ? request.context.referenceImages : [];
    canvasStore.updateGenerationNode(request.canvasId, request.nodeId, (data) => {
      // Do not overwrite edits made while the model was running.
      if (String(data.text || '').trim() !== sourcePrompt) return data;
      return {
        ...data,
        text: optimizedPrompt,
        imagePromptDocument: promptDocumentFromReferenceText(optimizedPrompt, references),
      };
    });
  }

  async function run(request = {}, emitProgress = () => {}) {
    const runId = safeString(request.runId) || `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const operation = operationFor(request);
    const key = `${safeString(request.canvasId)}:${safeString(request.nodeId)}:${operation}`;
    const previous = [...active.values()].find((item) => item.key === key);
    if (previous) {
      await cancel(previous.runId);
    }
    const runtimeRun = {
      runId,
      key,
      task: safeString(request.task),
      operation,
      canvasId: safeString(request.canvasId),
      nodeId: safeString(request.nodeId),
      sourcePrompt: operation === 'image_prompt_optimize' ? String(request.context?.prompt || '') : undefined,
      stage: 'queued',
      status: 'running',
      startedAt: Date.now(),
      notify: emitProgress,
    };
    const publish = (update = {}) => {
      Object.assign(runtimeRun, update);
      emitProgress({
        runId: runtimeRun.runId,
        task: runtimeRun.task,
        operation: runtimeRun.operation,
        canvasId: runtimeRun.canvasId,
        nodeId: runtimeRun.nodeId,
        sourcePrompt: runtimeRun.sourcePrompt,
        stage: runtimeRun.stage,
        status: runtimeRun.status,
        startedAt: runtimeRun.startedAt,
        ...(update.result !== undefined ? { result: update.result } : {}),
        ...(update.error ? { error: update.error } : {}),
      });
    };
    active.set(runId, runtimeRun);
    publish();
    try {
      const result = await canvasAgent.run({ ...request, runId }, (progress) => publish({ stage: safeString(progress?.stage) || runtimeRun.stage }));
      if (active.has(runId)) commitResult(request, result);
      publish({ status: 'completed', stage: 'completed', result });
      return result;
    } catch (error) {
      publish({ status: active.has(runId) ? 'failed' : 'canceled', error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      active.delete(runId);
    }
  }

  async function cancel(runId) {
    const id = safeString(runId);
    const runtimeRun = active.get(id);
    if (!runtimeRun) return { ok: true, canceled: false };
    active.delete(id);
    runtimeRun.notify?.({
      runId: runtimeRun.runId,
      task: runtimeRun.task,
      operation: runtimeRun.operation,
      canvasId: runtimeRun.canvasId,
      nodeId: runtimeRun.nodeId,
      sourcePrompt: runtimeRun.sourcePrompt,
      stage: runtimeRun.stage,
      status: 'canceled',
      startedAt: runtimeRun.startedAt,
    });
    return canvasAgent.cancel(id);
  }

  function listActive(canvasId = '') {
    const targetCanvasId = safeString(canvasId);
    return [...active.values()]
      .filter((item) => !targetCanvasId || item.canvasId === targetCanvasId)
      .map((item) => ({
        runId: item.runId,
        task: item.task,
        operation: item.operation,
        canvasId: item.canvasId,
        nodeId: item.nodeId,
        sourcePrompt: item.sourcePrompt,
        stage: item.stage,
        status: item.status,
        startedAt: item.startedAt,
      }));
  }

  return { cancel, run, listActive, activeCount: () => active.size };
}

module.exports = { createCanvasAgentRuntime, promptDocumentFromReferenceText };
