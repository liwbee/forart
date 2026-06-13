const crypto = require('crypto');
const { LOVART_PROVIDER_ID, createLovartProvider } = require('./config-store.cjs');

function createLovartClient({ net, getProvider, readImageSource }) {
  function providerFromPayload(payload = {}) {
    const configured = getProvider(payload.providerId || LOVART_PROVIDER_ID);
    const provider = configured?.protocol === 'lovart' ? configured : createLovartProvider();
    return {
      ...provider,
      baseUrl: String(payload.baseUrl || provider.baseUrl || 'https://lgw.lovart.ai').trim().replace(/\/+$/, ''),
      accessKey: String(payload.accessKey || provider.accessKey || '').trim(),
      secretKey: String(payload.secretKey || provider.secretKey || '').trim(),
    };
  }

  function signHeaders(provider, method, pathOnly) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac('sha256', provider.secretKey)
      .update(`${method}\n${pathOnly}\n${timestamp}`)
      .digest('hex');
    return {
      'X-Access-Key': provider.accessKey,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Signed-Method': method,
      'X-Signed-Path': pathOnly,
      'User-Agent': 'Forart/LovartNode',
    };
  }

  async function jsonRequest(provider, method, pathOnly, { body, params } = {}) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    const url = `${provider.baseUrl}${pathOnly}${query}`;
    let response;
    try {
      response = await net.fetch(url, {
        method,
        headers: {
          ...signHeaders(provider, method, pathOnly),
          'Content-Type': 'application/json',
          ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID().replace(/-/g, '') } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const cause = error?.cause?.message || error?.message || String(error);
      throw new Error(`Lovart network request failed (${method} ${url}): ${cause}`);
    }
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || text || `${response.status} ${response.statusText}`;
      throw new Error(`Lovart API ${response.status}: ${message}`);
    }
    if (payload && typeof payload === 'object' && payload.code !== undefined && payload.code !== 0) {
      throw new Error(payload.message || payload.error || `Lovart API error ${payload.code}`);
    }
    return payload?.data !== undefined ? payload.data : payload;
  }

  function multipartFileBody(buffer, fileName) {
    const boundary = crypto.randomUUID().replace(/-/g, '');
    const safeName = String(fileName || 'reference.png').replace(/"/g, '_');
    const head = Buffer.from(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n`
      + 'Content-Type: application/octet-stream\r\n\r\n',
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    return { boundary, body: Buffer.concat([head, buffer, tail]) };
  }

  async function uploadReference(provider, sourceUrl, index) {
    const source = await readImageSource({ url: sourceUrl, defaultName: `reference-${index + 1}.png` });
    const { boundary, body } = multipartFileBody(source.buffer, `reference-${index + 1}${source.extension || '.png'}`);
    const pathOnly = '/v1/openapi/file/upload';
    let response;
    try {
      response = await net.fetch(`${provider.baseUrl}${pathOnly}`, {
        method: 'POST',
        headers: {
          ...signHeaders(provider, 'POST', pathOnly),
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
    } catch (error) {
      const cause = error?.cause?.message || error?.message || String(error);
      throw new Error(`Lovart upload request failed: ${cause}`);
    }
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text };
    }
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.message || payload.error || `Lovart upload failed (${response.status})`);
    }
    return payload.data?.url || '';
  }

  async function createProject(provider) {
    const result = await jsonRequest(provider, 'POST', '/v1/openapi/project/save', {
      body: {
        project_id: '',
        canvas: '',
        project_cover_list: [],
        pic_count: 0,
        project_type: 3,
        project_name: 'Forart Canvas',
      },
    });
    return result.project_id || '';
  }

  async function testConnection(payload = {}) {
    const provider = providerFromPayload(payload);
    if (!provider.accessKey || !provider.secretKey) throw new Error('Lovart AK/SK is not configured.');
    const result = await jsonRequest(provider, 'POST', '/v1/openapi/mode/query', { body: {} });
    return { ok: true, mode: result?.unlimited ? 'unlimited' : 'fast' };
  }

  function firstImageArtifact(result) {
    for (const item of result?.items || []) {
      for (const artifact of item?.artifacts || []) {
        if (artifact?.type === 'image' && artifact.content) return String(artifact.content);
      }
    }
    return '';
  }

  async function pollResult(provider, threadId) {
    const deadline = Date.now() + 180000;
    let finalStatus = 'timeout';
    while (Date.now() < deadline) {
      const statusPayload = await jsonRequest(provider, 'GET', '/v1/openapi/chat/status', { params: { thread_id: threadId } });
      const status = String(statusPayload.status || 'running');
      if (status === 'abort') {
        finalStatus = 'abort';
        break;
      }
      const result = await jsonRequest(provider, 'GET', '/v1/openapi/chat/result', { params: { thread_id: threadId } }).catch(() => null);
      if (result?.pending_confirmation) {
        throw new Error('Lovart generation needs manual confirmation before credits are consumed.');
      }
      const imageUrl = firstImageArtifact(result);
      if (imageUrl) return { result, finalStatus: status === 'done' ? 'done' : status, imageUrl };
      if (status === 'done') {
        finalStatus = 'done';
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    const result = await jsonRequest(provider, 'GET', '/v1/openapi/chat/result', { params: { thread_id: threadId } }).catch(() => null);
    const imageUrl = firstImageArtifact(result);
    if (imageUrl) return { result, finalStatus, imageUrl };
    throw new Error(finalStatus === 'done' ? 'Lovart finished without an image artifact.' : `Lovart generation ${finalStatus}.`);
  }

  async function status(payload = {}) {
    const provider = providerFromPayload(payload);
    if (!provider.accessKey || !provider.secretKey) throw new Error('Lovart AK/SK is not configured.');
    const threadId = String(payload.threadId || '').trim();
    if (!threadId) throw new Error('Lovart thread_id is required.');
    const statusPayload = await jsonRequest(provider, 'GET', '/v1/openapi/chat/status', { params: { thread_id: threadId } });
    const currentStatus = String(statusPayload.status || 'running');
    const result = await jsonRequest(provider, 'GET', '/v1/openapi/chat/result', { params: { thread_id: threadId } }).catch(() => null);
    if (result?.pending_confirmation) {
      return { threadId, status: currentStatus, pendingConfirmation: true };
    }
    const imageUrl = firstImageArtifact(result);
    return {
      threadId,
      status: imageUrl && currentStatus === 'done' ? 'done' : currentStatus,
      imageUrl,
      finalStatus: imageUrl ? currentStatus : '',
    };
  }

  async function generate(payload = {}) {
    const provider = providerFromPayload(payload);
    if (!provider.accessKey || !provider.secretKey) throw new Error('Lovart AK/SK is not configured.');
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) throw new Error('Prompt is required.');
    const projectId = String(payload.projectId || '').trim() || await createProject(provider);
    const referenceImages = Array.isArray(payload.referenceImages) ? payload.referenceImages.slice(0, 8) : [];
    const attachments = [];
    for (let index = 0; index < referenceImages.length; index += 1) {
      const uploaded = await uploadReference(provider, referenceImages[index], index);
      if (uploaded) attachments.push(uploaded);
    }
    const toolConfig = {};
    const model = String(payload.model || '').trim();
    if (model) toolConfig.prefer_tool_categories = { IMAGE: [model] };
    await jsonRequest(provider, 'POST', '/v1/openapi/mode/set', { body: { unlimited: Boolean(payload.unlimited) } });
    const body = {
      prompt,
      project_id: projectId,
      ...(payload.threadId ? { thread_id: String(payload.threadId) } : {}),
      ...(attachments.length ? { attachments } : {}),
      mode: 'fast',
      ...(Object.keys(toolConfig).length ? { tool_config: toolConfig } : {}),
    };
    const submitted = await jsonRequest(provider, 'POST', '/v1/openapi/chat', { body });
    const threadId = submitted.thread_id || submitted.threadId;
    if (!threadId) throw new Error('Lovart did not return a thread_id.');
    const polled = await pollResult(provider, threadId);
    return {
      url: polled.imageUrl,
      fileName: 'lovart-image.png',
      projectId,
      threadId,
      finalStatus: polled.finalStatus,
    };
  }

  return {
    generate,
    status,
    testConnection,
  };
}

module.exports = { createLovartClient };
