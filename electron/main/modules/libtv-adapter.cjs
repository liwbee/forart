const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function createLibtvAdapter({ rootDir }) {
  const LIBTV_IMPORT_DETAIL_CONCURRENCY = 3;
  const LIBTV_DEFAULT_BINARY = process.platform === 'win32' && process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, '.libtv', 'libtv.exe')
    : 'libtv';
  const LIBTV_INSTALL_COMMAND = 'irm https://liblibai-web-static.liblib.cloud/cli/latest/install-libtv-cli.ps1 | iex';
  const LIBTV_IMAGE_RATIOS = new Set(['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16']);

  function resolveLibtvBinary() {
    return process.env.LIBTV_CLI_BINARY || process.env.LIBTV_BIN || (fs.existsSync(LIBTV_DEFAULT_BINARY) ? LIBTV_DEFAULT_BINARY : 'libtv');
  }

  function runProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args.map(String), {
        cwd: options.cwd || rootDir,
        windowsHide: true,
        env: options.env || process.env,
      });
      let stdout = '';
      let stderr = '';
      const timeoutMs = options.timeoutMs || 120000;
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`${command} timed out`));
      }, timeoutMs);
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()));
      });
    });
  }

  function safeNodeId(value, index) {
    const text = String(value || `node-${index}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    return `libtv_${index}_${text || 'node'}`;
  }

  function runLibtv(args, options = {}) {
    return runProcess(resolveLibtvBinary(), args, options).catch((error) => {
      if (error?.message?.includes('timed out')) throw new Error(`libtv timed out: libtv ${args.join(' ')}`);
      throw error;
    });
  }

  function parseJsonOutput(stdout) {
    const text = String(stdout || '').trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Pipeline mode can return NDJSON; use the last parseable frame.
    }
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line);
      } catch {
        // Keep trying earlier lines.
      }
    }
    return null;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    for (const key of ['nodes', 'items', 'list', 'records', 'data']) {
      const candidate = value[key];
      if (Array.isArray(candidate)) return candidate;
      if (candidate && typeof candidate === 'object') {
        const nested = asArray(candidate);
        if (nested.length) return nested;
      }
    }
    return [];
  }

  function firstString(...values) {
    return values.find((value) => typeof value === 'string' && value.trim()) || '';
  }

  function firstNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return 0;
  }

  function unwrapLibtvNode(input) {
    if (!input || typeof input !== 'object') return {};
    if (input.node && typeof input.node === 'object') return input.node;
    if (input.data && typeof input.data === 'object' && (input.data.nodeKey || input.data.id || input.data.type || input.data.params || input.data.url)) {
      return input;
    }
    return input;
  }

  function libtvNodeData(node) {
    return node?.data && typeof node.data === 'object' ? node.data : node || {};
  }

  function libtvNodeId(node) {
    const data = libtvNodeData(node);
    return firstString(node?.nodeKey, node?.newNodeKey, data.nodeKey, data.newNodeKey, node?.nodeId, data.nodeId, node?.id, node?.key, data.id, data.key);
  }

  function libtvNodeTitle(node) {
    const data = libtvNodeData(node);
    return firstString(node?.name, node?.label, node?.title, node?.displayName, data.name, data.label, data.title, data.displayName, libtvNodeId(node));
  }

  function libtvNodeType(node) {
    const data = libtvNodeData(node);
    return firstString(node?.type, node?.nodeType, data.type, data.nodeType).toLowerCase();
  }

  function libtvNodeInternalIds(node) {
    const data = libtvNodeData(node);
    return [
      node?.nodeId,
      data.nodeId,
      node?.id,
      data.id,
      node?.key,
      data.key,
    ].map((value) => String(value || '').trim()).filter(Boolean);
  }

  function libtvNodeParams(node) {
    const data = libtvNodeData(node);
    return data.params && typeof data.params === 'object' ? data.params : node?.params && typeof node.params === 'object' ? node.params : {};
  }

  function libtvNodeAction(node) {
    const data = libtvNodeData(node);
    return firstString(data.action, node?.action, data.generatorAction, node?.generatorAction).toLowerCase();
  }

  function libtvParamValue(params, key) {
    return firstString(
      params?.[key],
      params?.settings?.[key],
      params?.advancedSettings?.[key],
    );
  }

  function normalizeLibtvResolution(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text.includes('4')) return '4k';
    if (text.includes('2')) return '2k';
    return '1k';
  }

  function normalizeLibtvRatio(value) {
    const text = String(value || '').trim();
    return LIBTV_IMAGE_RATIOS.has(text) ? text : '1:1';
  }

  function findFirstUrl(value) {
    const queue = [value];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      if (typeof current === 'string') {
        if (/^(https?:\/\/|data:image\/|asset:\/\/|forart-asset:\/\/)/i.test(current.trim())) return current.trim();
        continue;
      }
      if (typeof current !== 'object') continue;
      seen.add(current);
      if (Array.isArray(current)) {
        current.forEach((item) => queue.push(item));
        continue;
      }
      for (const key of ['url', 'originalUrl', 'imageUrl', 'image_url', 'poster']) {
        const candidate = current[key];
        if (Array.isArray(candidate)) {
          const url = candidate.find((item) => typeof item === 'string' && /^(https?:\/\/|data:image\/|asset:\/\/)/i.test(item));
          if (url) return url;
        }
        if (typeof candidate === 'string' && /^(https?:\/\/|data:image\/|asset:\/\/)/i.test(candidate)) return candidate;
      }
      Object.values(current).forEach((item) => queue.push(item));
    }
    return '';
  }

  function imageFileNameFromUrl(url, fallback = 'libtv-image.png') {
    try {
      const parsed = new URL(String(url || ''));
      const base = path.basename(decodeURIComponent(parsed.pathname || ''));
      return base || fallback;
    } catch {
      return fallback;
    }
  }

  function libtvEdgeEndpoints(edge) {
    return {
      from: firstString(edge?.from, edge?.source, edge?.sourceNodeId, edge?.sourceNodeKey, edge?.start, edge?.fromNodeKey),
      to: firstString(edge?.to, edge?.target, edge?.targetNodeId, edge?.targetNodeKey, edge?.end, edge?.toNodeKey),
    };
  }

  function projectNodesFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.nodes)) return payload.nodes;
    if (payload.data && typeof payload.data === 'object' && Array.isArray(payload.data.nodes)) return payload.data.nodes;
    return asArray(payload);
  }

  function projectEdgesFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return [];
    for (const key of ['edges', 'connections', 'links']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
    if (data) {
      for (const key of ['edges', 'connections', 'links']) {
        if (Array.isArray(data[key])) return data[key];
      }
    }
    return [];
  }

  function forartNodePosition(node, index) {
    const data = libtvNodeData(node);
    const position = node?.position || data.position || node?.layout || data.layout || {};
    return {
      x: firstNumber(node?.x, data.x, position.x, position.left, index * 360),
      y: firstNumber(node?.y, data.y, position.y, position.top, 0),
    };
  }

  function forartNodeSize(node, fallback = {}) {
    const data = libtvNodeData(node);
    const width = firstNumber(node?.w, node?.width, data.w, data.width, data.nodeWidth, data.contentWidth, fallback.w);
    const height = firstNumber(node?.h, node?.height, data.h, data.height, data.nodeHeight, data.contentHeight, fallback.h);
    return {
      w: Math.max(120, Math.round(width || fallback.w || 300)),
      h: Math.max(120, Math.round(height || fallback.h || 220)),
    };
  }

  function mergeLibtvNodeDetail(summary, detail) {
    const base = summary && typeof summary === 'object' ? summary : {};
    const full = detail && typeof detail === 'object' ? detail : {};
    const merged = {
      ...base,
      ...full,
      position: full.position || base.position,
      layout: full.layout || base.layout,
      x: full.x ?? base.x,
      y: full.y ?? base.y,
      w: full.w ?? base.w,
      h: full.h ?? base.h,
      width: full.width ?? base.width,
      height: full.height ?? base.height,
    };
    if (base.data && typeof base.data === 'object' || full.data && typeof full.data === 'object') {
      merged.data = {
        ...(base.data && typeof base.data === 'object' ? base.data : {}),
        ...(full.data && typeof full.data === 'object' ? full.data : {}),
      };
    }
    return merged;
  }

  function viewportForImportedNodes(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) return { x: 0, y: 0, scale: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((node) => {
      const x = Number(node?.x);
      const y = Number(node?.y);
      const w = Number(node?.w);
      const h = Number(node?.h);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + (Number.isFinite(w) ? w : 0));
      maxY = Math.max(maxY, y + (Number.isFinite(h) ? h : 0));
    });
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return { x: 0, y: 0, scale: 1 };
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const centerX = minX + width / 2;
    const centerY = minY + height / 2;
    const scale = width > 3200 || height > 2200 ? 0.45 : width > 1800 || height > 1400 ? 0.65 : 1;
    return {
      x: Math.round(-centerX * scale),
      y: Math.round(-centerY * scale),
      scale,
    };
  }

  function libtvTextContent(node) {
    const data = libtvNodeData(node);
    const params = libtvNodeParams(node);
    return firstString(libtvTextFromValue(data.content), libtvTextFromValue(data.text), params.text, params.prompt);
  }

  function isLibtvImageGenerator(node) {
    const action = libtvNodeAction(node);
    if (action.includes('resource')) return false;
    if (action.includes('image_generate') || action.includes('generate_image')) return true;
    const data = libtvNodeData(node);
    const params = libtvNodeParams(node);
    return Boolean(libtvNodeType(node) === 'image'
      && firstString(data.resultTaskId, data.taskId, data.generationId)
      && Boolean(params && typeof params === 'object' && Object.keys(params).length));
  }

  function libtvTextFromValue(value) {
    if (Array.isArray(value)) return value.map(libtvTextFromValue).filter(Boolean).join('\n\n');
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    return firstString(
      libtvTextFromValue(value.content),
      libtvTextFromValue(value.text),
      libtvTextFromValue(value.prompt),
    );
  }

  function libtvParamTextRefs(node) {
    const params = libtvNodeParams(node);
    return (Array.isArray(params.textList) ? params.textList : []).map((item) => ({
      nodeId: firstString(item?.nodeId, item?.id, item?.key),
      content: libtvTextFromValue(item?.content) || libtvTextFromValue(item?.text) || libtvTextFromValue(item?.prompt),
    })).filter((item) => item.nodeId || item.content);
  }

  function libtvParamImageRefs(node) {
    const params = libtvNodeParams(node);
    return (Array.isArray(params.imageList) ? params.imageList : []).map((item) => ({
      nodeId: firstString(item?.nodeId, item?.id, item?.key),
      url: findFirstUrl(item),
    })).filter((item) => item.nodeId || item.url);
  }

  function mapLibtvNodeToForart(node, index, projectId) {
    const type = libtvNodeType(node);
    const id = libtvNodeId(node);
    const title = libtvNodeTitle(node);
    const { x, y } = forartNodePosition(node, index);
    const data = libtvNodeData(node);
    const params = libtvNodeParams(node);
    if (type === 'text') {
      const text = libtvTextContent(node);
      const { w, h } = forartNodeSize(node, { w: 310, h: 220 });
      return {
        id: safeNodeId(id, index),
        type: 'libtvPrompt',
        x,
        y,
        w,
        h,
        title: title || 'LibTV Prompt',
        text,
        libtvProjectId: projectId,
        libtvNodeId: id,
      };
    }
    if (type !== 'image') return null;

    const url = findFirstUrl(data) || findFirstUrl(node);
    const generated = isLibtvImageGenerator(node);
    if (!generated) {
      const { w, h } = forartNodeSize(node, { w: 300, h: 400 });
      return {
        id: safeNodeId(id, index),
        type: 'libtvUpload',
        x,
        y,
        w,
        h,
        title: title || imageFileNameFromUrl(url),
        text: '',
        url,
        fileName: imageFileNameFromUrl(url),
        imageMode: 'asset',
        imageSource: 'uploaded',
        libtvProjectId: projectId,
        libtvNodeId: id,
      };
    }
    const model = firstString(params.modelName, params.model, params.modelKey);
    const prompt = firstString(params.prompt);
    const ratio = normalizeLibtvRatio(libtvParamValue(params, 'ratio'));
    const resolution = normalizeLibtvResolution(firstString(libtvParamValue(params, 'quality'), libtvParamValue(params, 'resolution')));
    const { w, h } = forartNodeSize(node, { w: 300, h: 400 });
    return {
      id: safeNodeId(id, index),
      type: 'libtvImage',
      x,
      y,
      w,
      h,
      title: title || 'LibTV Image',
      text: prompt,
      url,
      fileName: imageFileNameFromUrl(url),
      imageMode: 'imageGenerator',
      imageSource: 'generated',
      libtvProjectId: projectId,
      libtvNodeId: id,
      libtvModel: model,
      libtvModelName: model,
      libtvResolution: resolution,
      libtvAspectRatio: ratio,
      libtvOriginalUrl: url,
      generationError: '',
      generationStatus: '',
    };
  }

  async function queryLibtvNode(projectId, nodeId) {
    const result = await runLibtv(['node', nodeId, '-p', projectId], { timeoutMs: 120000 });
    return parseJsonOutput(result.stdout);
  }

  async function importLibtvProject(projectId, onProgress) {
    const progress = (payload) => {
      if (typeof onProgress === 'function') onProgress({ projectId, ...payload });
    };
    progress({ stage: 'loadingProject' });
    const project = parseJsonOutput((await runLibtv(['project', projectId], { timeoutMs: 120000 })).stdout);
    if (!project) throw new Error('libtv project did not return JSON.');
    const projectNodes = projectNodesFromPayload(project).map(unwrapLibtvNode);
    const imageOrTextNodes = projectNodes.filter((node) => ['image', 'text'].includes(libtvNodeType(node)));
    const detailById = new Map();
    let loadedDetailCount = 0;
    progress({ stage: 'loadingNodeDetails', current: 0, total: imageOrTextNodes.length });

    async function loadNodeDetail(node) {
      const id = libtvNodeId(node);
      if (!id) {
        loadedDetailCount += 1;
        progress({ stage: 'loadingNodeDetails', current: loadedDetailCount, total: imageOrTextNodes.length });
        return;
      }
      try {
        const detail = unwrapLibtvNode(await queryLibtvNode(projectId, id)) || node;
        detailById.set(id, mergeLibtvNodeDetail(node, detail));
      } catch {
        detailById.set(id, node);
      } finally {
        loadedDetailCount += 1;
        progress({ stage: 'loadingNodeDetails', current: loadedDetailCount, total: imageOrTextNodes.length });
      }
    }

    const workers = Array.from(
      { length: Math.min(LIBTV_IMPORT_DETAIL_CONCURRENCY, imageOrTextNodes.length) },
      async (_, workerIndex) => {
        for (let index = workerIndex; index < imageOrTextNodes.length; index += LIBTV_IMPORT_DETAIL_CONCURRENCY) {
          await loadNodeDetail(imageOrTextNodes[index]);
        }
      },
    );
    await Promise.all(workers);

    progress({ stage: 'mappingNodes' });
    const idMap = new Map();
    const detailByOriginalId = new Map();
    const nodes = [];
    imageOrTextNodes.forEach((node, index) => {
      const id = libtvNodeId(node);
      const detail = detailById.get(id) || node;
      const mapped = mapLibtvNodeToForart(detail, index, projectId);
      if (!mapped) return;
      idMap.set(id, mapped.id);
      detailByOriginalId.set(id, detail);
      nodes.push(mapped);
    });
    const connectionKeys = new Set();
    const connections = [];
    const addConnection = (from, to, keyHint = '') => {
      if (!from || !to || from === to) return;
      const key = `${from}->${to}`;
      if (connectionKeys.has(key)) return;
      connectionKeys.add(key);
      connections.push({
        id: `libtv_link_${connections.length}_${keyHint || from}_${to}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120),
        from,
        to,
      });
    };
    projectEdgesFromPayload(project).forEach((edge, index) => {
      const endpoints = libtvEdgeEndpoints(edge);
      const from = idMap.get(endpoints.from);
      const to = idMap.get(endpoints.to);
      if (!from || !to) return;
      const target = nodes.find((node) => node.id === to);
      if (!target || (target.type !== 'libtvImage' && target.type !== 'libtvPrompt')) return;
      addConnection(from, to, `edge_${index}`);
    });
    for (const [originalId, detail] of detailByOriginalId.entries()) {
      const targetId = idMap.get(originalId);
      const target = nodes.find((node) => node.id === targetId);
      if (!target || target.type !== 'libtvImage') continue;
      libtvParamTextRefs(detail).forEach((ref, refIndex) => {
        let from = ref.nodeId ? idMap.get(ref.nodeId) : '';
        if (!from && ref.content) {
          const promptNode = {
            id: safeNodeId(ref.nodeId || `${originalId}_prompt_${refIndex}`, nodes.length),
            type: 'libtvPrompt',
            x: Math.round(target.x - 350),
            y: Math.round(target.y + refIndex * 240),
            w: 310,
            h: 220,
            title: 'LibTV Prompt',
            text: ref.content,
          };
          nodes.push(promptNode);
          if (ref.nodeId) idMap.set(ref.nodeId, promptNode.id);
          from = promptNode.id;
        }
        addConnection(from, target.id, `text_${refIndex}`);
      });
      libtvParamImageRefs(detail).forEach((ref, refIndex) => {
        let from = ref.nodeId ? idMap.get(ref.nodeId) : '';
        if (!from && ref.url) {
          const imageNode = {
            id: safeNodeId(ref.nodeId || `${originalId}_image_${refIndex}`, nodes.length),
            type: 'libtvUpload',
            x: Math.round(target.x - 350),
            y: Math.round(target.y + 260 + refIndex * 240),
            w: 300,
            h: 400,
            title: imageFileNameFromUrl(ref.url),
            text: '',
            url: ref.url,
            fileName: imageFileNameFromUrl(ref.url),
            imageMode: 'asset',
            imageSource: 'uploaded',
            libtvProjectId: projectId,
            libtvNodeId: ref.nodeId || '',
          };
          nodes.push(imageNode);
          if (ref.nodeId) idMap.set(ref.nodeId, imageNode.id);
          from = imageNode.id;
        }
        addConnection(from, target.id, `image_${refIndex}`);
      });
    }
    const imported = {
      title: firstString(project.name, project.title, project.data?.name, project.data?.title, `LibTV ${projectId}`),
      nodes,
      connections,
      groups: [],
      viewport: viewportForImportedNodes(nodes),
    };
    progress({ stage: 'done', current: nodes.length, total: nodes.length });
    return imported;
  }

  function parseLibtvModels(payload) {
    const items = Array.isArray(payload?.matches)
      ? payload.matches
      : Array.isArray(payload?.data?.matches)
        ? payload.data.matches
        : asArray(payload);
    return items.map((item) => {
      const key = firstString(item?.modelKey, item?.key, item?.id, item?.value, item?.name);
      const name = firstString(item?.modelName, item?.name, item?.label, item?.displayName, key);
      const label = firstString(item?.displayName, item?.label, item?.modelName, key);
      return key || name ? { key: key || name, name: name || key, label: label || name || key } : null;
    }).filter(Boolean);
  }

  function parseLibtvProjects(payload) {
    const source = Array.isArray(payload?.projectMetaList)
      ? payload.projectMetaList
      : Array.isArray(payload?.projects)
        ? payload.projects
        : Array.isArray(payload?.data?.projectMetaList)
          ? payload.data.projectMetaList
          : asArray(payload);
    return source.map((item) => {
      const uuid = firstString(item?.uuid, item?.projectUuid, item?.id);
      const name = firstString(item?.name, item?.title, uuid);
      if (!uuid) return null;
      return {
        id: Number.isFinite(Number(item?.id)) ? Number(item.id) : undefined,
        uuid,
        name,
        teamId: Number.isFinite(Number(item?.teamId)) ? Number(item.teamId) : undefined,
        updatedAtMs: Number.isFinite(Number(item?.updatedAtMs)) ? Number(item.updatedAtMs) : undefined,
        createdAtMs: Number.isFinite(Number(item?.createdAtMs)) ? Number(item.createdAtMs) : undefined,
        coverUrl: firstString(item?.coverUrl),
      };
    }).filter(Boolean);
  }

  async function syncLibtvImageNode(projectId, nodeId) {
    const node = unwrapLibtvNode(await queryLibtvNode(projectId, nodeId));
    const url = findFirstUrl(libtvNodeData(node)) || findFirstUrl(node);
    return {
      nodeId,
      projectId,
      url,
      fileName: imageFileNameFromUrl(url, 'libtv-image.png'),
      raw: node,
    };
  }

  function libtvNodeParamArgs(payload = {}) {
    const args = [];
    if (payload.prompt !== undefined) {
      const prompt = String(payload.prompt);
      if (prompt.length > 0) args.push('--prompt', prompt);
      else args.push('--set', 'prompt=');
    }
    const model = String(payload.model || '').trim();
    if (model) args.push('--set', `model=${model}`);
    const aspectRatio = String(payload.aspectRatio || '').trim();
    if (aspectRatio) args.push('--set', `ratio=${aspectRatio}`);
    const resolution = String(payload.resolution || '').trim().toUpperCase();
    if (resolution) args.push('--set', `quality=${resolution}`);
    return args;
  }

  function libtvNodeUpdateArgs(payload = {}) {
    const args = [];
    if (payload.content !== undefined) {
      const content = Array.isArray(payload.content)
        ? payload.content.map((item) => String(item || ''))
        : [String(payload.content || '')];
      args.push('--update', `content=${JSON.stringify(content)}`);
    }
    if (payload.url !== undefined) {
      const url = Array.isArray(payload.url)
        ? payload.url.map((item) => String(item || '').trim()).filter(Boolean)
        : [String(payload.url || '').trim()].filter(Boolean);
      if (url.length) args.push('--update', `url=${JSON.stringify(url)}`);
    }
    if (payload.originalUrl !== undefined) {
      const originalUrl = Array.isArray(payload.originalUrl)
        ? payload.originalUrl.map((item) => String(item || '').trim()).filter(Boolean)
        : [String(payload.originalUrl || '').trim()].filter(Boolean);
      if (originalUrl.length) args.push('--update', `originalUrl=${JSON.stringify(originalUrl)}`);
    }
    const left = Array.isArray(payload.left) ? payload.left : payload.left !== undefined ? [payload.left] : [];
    left.map((item) => String(item || '').trim()).filter(Boolean).forEach((node) => args.push('--left', node));
    const leftAdd = Array.isArray(payload.leftAdd) ? payload.leftAdd : payload.leftAdd !== undefined ? [payload.leftAdd] : [];
    leftAdd.map((item) => String(item || '').trim()).filter(Boolean).forEach((node) => args.push('--left-add', node));
    const leftRemove = Array.isArray(payload.leftRemove) ? payload.leftRemove : payload.leftRemove !== undefined ? [payload.leftRemove] : [];
    leftRemove.map((item) => String(item || '').trim()).filter(Boolean).forEach((node) => args.push('--left-rm', node));
    return args;
  }

  async function updateLibtvNode(projectId, nodeId, payload = {}) {
    const args = ['node', nodeId, '-p', projectId, ...libtvNodeParamArgs(payload), ...libtvNodeUpdateArgs(payload)];
    if (args.length <= 4) return syncLibtvImageNode(projectId, nodeId);
    const result = await runLibtv(args, { timeoutMs: 120000 });
    const raw = parseJsonOutput(result.stdout);
    const node = unwrapLibtvNode(raw);
    const url = findFirstUrl(libtvNodeData(node)) || findFirstUrl(node) || findFirstUrl(raw);
    return {
      nodeId,
      projectId,
      url,
      fileName: imageFileNameFromUrl(url, 'libtv-image.png'),
      raw,
    };
  }

  async function createLibtvNode(projectId, payload = {}) {
    const title = String(payload.title || payload.type || 'Forart node').trim();
    const type = String(payload.type || '').trim().toLowerCase();
    if (!title || !type) throw new Error('LibTV node title and type are required.');
    const args = [
      'node',
      'create',
      title,
      '-p',
      projectId,
      '-t',
      type,
      '--x',
      Math.round(Number(payload.x) || 0),
      '--y',
      Math.round(Number(payload.y) || 0),
      ...libtvNodeParamArgs(payload),
      ...libtvNodeUpdateArgs(payload),
    ];
    const result = await runLibtv(args, { timeoutMs: 120000 });
    const raw = parseJsonOutput(result.stdout);
    const node = unwrapLibtvNode(raw);
    const nodeId = libtvNodeId(raw) || libtvNodeId(node);
    if (!nodeId) throw new Error('LibTV did not return a node id.');
    const url = findFirstUrl(libtvNodeData(node)) || findFirstUrl(node) || findFirstUrl(raw);
    return {
      nodeId,
      projectId,
      title: libtvNodeTitle(node) || title,
      type: libtvNodeType(node) || type,
      url,
      fileName: imageFileNameFromUrl(url, 'libtv-image.png'),
      raw,
    };
  }

  async function resolveLibtvNodeKey(projectId, payload = {}) {
    const requestedNodeId = String(payload.nodeId || '').trim();
    const title = String(payload.title || '').trim();
    const type = String(payload.type || '').trim();
    if (!requestedNodeId && !title) return '';
    const project = parseJsonOutput((await runLibtv(['project', projectId], { timeoutMs: 120000 })).stdout);
    const nodes = projectNodesFromPayload(project).map(unwrapLibtvNode);
    const byKey = nodes.find((node) => libtvNodeId(node) === requestedNodeId);
    if (byKey) return libtvNodeId(byKey);
    const byInternalId = nodes.find((node) => libtvNodeInternalIds(node).includes(requestedNodeId));
    if (byInternalId) return libtvNodeId(byInternalId);
    const byTitleAndType = nodes.find((node) => (
      (!title || libtvNodeTitle(node) === title)
      && (!type || libtvNodeType(node) === type)
    ));
    return byTitleAndType ? libtvNodeId(byTitleAndType) : '';
  }

  async function deleteLibtvNode(projectId, payload = {}) {
    const requestedNodeId = String(payload.nodeId || '').trim();
    let nodeKey = requestedNodeId;
    try {
      await runLibtv(['node', 'delete', nodeKey, '-p', projectId], { timeoutMs: 120000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('未找到节点') && !message.includes('not found')) throw error;
      nodeKey = await resolveLibtvNodeKey(projectId, payload);
      if (!nodeKey || nodeKey === requestedNodeId) throw error;
      await runLibtv(['node', 'delete', nodeKey, '-p', projectId], { timeoutMs: 120000 });
    }
    return { ok: true, projectId, nodeId: nodeKey };
  }

  async function uploadLibtvImageNode(projectId, filePath, payload = {}) {
    const resolvedPath = path.resolve(String(filePath || '').trim());
    if (!fs.existsSync(resolvedPath)) throw new Error('LibTV upload file not found.');
    const displayTitle = String(payload.title || path.basename(resolvedPath) || 'Forart image').trim();
    const args = ['upload', displayTitle, '-p', projectId, '-t', 'image', '-f', resolvedPath];
    if (payload.x !== undefined) args.push('--x', Math.round(Number(payload.x) || 0));
    if (payload.y !== undefined) args.push('--y', Math.round(Number(payload.y) || 0));
    const result = await runLibtv(args, { timeoutMs: 10 * 60 * 1000 });
    const raw = parseJsonOutput(result.stdout);
    const node = unwrapLibtvNode(raw);
    const nodeId = libtvNodeId(raw) || libtvNodeId(node);
    const url = findFirstUrl(libtvNodeData(node)) || findFirstUrl(node) || findFirstUrl(raw);
    return {
      nodeId,
      projectId,
      title: libtvNodeTitle(node) || displayTitle,
      url,
      fileName: imageFileNameFromUrl(url, path.basename(resolvedPath)),
      raw,
    };
  }

  async function runLibtvImageNode(projectId, nodeId) {
    const result = await runLibtv(['node', nodeId, '-p', projectId, '--run'], { timeoutMs: 10 * 60 * 1000 });
    const payload = parseJsonOutput(result.stdout);
    const node = unwrapLibtvNode(payload);
    let url = findFirstUrl(libtvNodeData(node)) || findFirstUrl(node) || findFirstUrl(payload);
    let raw = payload;
    if (!url) {
      const synced = await syncLibtvImageNode(projectId, nodeId);
      url = synced.url;
      raw = synced.raw || payload;
    }
    return {
      nodeId,
      projectId,
      url,
      fileName: imageFileNameFromUrl(url, 'libtv-image.png'),
      status: 'done',
      raw,
    };
  }

  async function status() {
    const libtvBinary = resolveLibtvBinary();
    try {
      const result = await runLibtv(['--help'], { timeoutMs: 15000 });
      const firstLine = (result.stdout || result.stderr || '').split(/\r?\n/).find(Boolean) || '';
      return { ok: true, available: true, path: libtvBinary, version: firstLine };
    } catch (error) {
      return { ok: false, available: false, path: libtvBinary, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function install() {
    if (process.platform !== 'win32') {
      throw new Error('LibTV one-click install is currently only available on Windows.');
    }
    const result = await runProcess('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      LIBTV_INSTALL_COMMAND,
    ], { timeoutMs: 10 * 60 * 1000 });
    return {
      ok: true,
      path: resolveLibtvBinary(),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async function imageModels() {
    const payload = parseJsonOutput((await runLibtv(['model', 'search', '--type', 'image'], { timeoutMs: 120000 })).stdout);
    return { models: parseLibtvModels(payload) };
  }

  async function searchProjects(payload = {}) {
    const page = Math.max(1, Number(payload.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(payload.pageSize) || 20));
    const args = ['project', 'list', '-p', String(page), '-s', String(pageSize)];
    const name = String(payload.name || '').trim();
    if (name) args.push('--name', name);
    if (payload.teamId !== null && payload.teamId !== undefined && payload.teamId !== '') {
      args.push('--team-id', String(Number(payload.teamId) || 0));
    }
    const result = parseJsonOutput((await runLibtv(args, { timeoutMs: 120000 })).stdout);
    return {
      projects: parseLibtvProjects(result),
      total: Number(result?.total || 0),
    };
  }

  async function account() {
    try {
      const payload = parseJsonOutput((await runLibtv(['account', 'info'], { timeoutMs: 30000 })).stdout);
      return { ok: true, loggedIn: true, account: payload };
    } catch (error) {
      return { ok: false, loggedIn: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function accounts() {
    const payload = parseJsonOutput((await runLibtv(['account', 'list'], { timeoutMs: 30000 })).stdout);
    return {
      ok: true,
      accounts: Array.isArray(payload?.accounts) ? payload.accounts : [],
    };
  }

  async function useAccount(accountName) {
    const target = String(accountName || '').trim();
    if (!target) throw new Error('LibTV account is required.');
    await runLibtv(['account', 'use', target], { timeoutMs: 30000 });
    return { ok: true };
  }

  async function loginWeb() {
    await runLibtv(['login', 'web', '--open'], { timeoutMs: 5 * 60 * 1000 });
    return { ok: true };
  }

  async function logout() {
    await runLibtv(['logout'], { timeoutMs: 30000 });
    return { ok: true };
  }

  return {
    account,
    accounts,
    createNode: createLibtvNode,
    deleteNode: deleteLibtvNode,
    imageModels,
    importProject: importLibtvProject,
    install,
    loginWeb,
    logout,
    runImageNode: runLibtvImageNode,
    searchProjects,
    status,
    syncNode: syncLibtvImageNode,
    updateNode: updateLibtvNode,
    uploadNode: uploadLibtvImageNode,
    useAccount,
  };
}

module.exports = { createLibtvAdapter };
