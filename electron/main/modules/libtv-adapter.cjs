const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function createLibtvAdapter({ rootDir }) {
  const LIBTV_DEFAULT_BINARY = process.platform === 'win32' && process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, '.libtv', 'libtv.exe')
    : 'libtv';
  const LIBTV_VERSION_CHANNEL_URL = 'https://api2.liblib.art/api/www/landing-activities/getById?id=240';
  const LIBTV_FALLBACK_INSTALL_COMMAND = 'irm https://liblibai-web-static.liblib.cloud/cli/latest/install-libtv-cli.ps1 | iex';

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
        const error = new Error((stderr || stdout || `${command} exited with code ${code}`).trim());
        error.command = command;
        error.args = args.map(String);
        error.exitCode = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      });
    });
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
      // Some commands can emit progress lines before JSON; use the last parseable frame.
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

  function normalizeListPayload(payload, keys) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  }

  function requireText(value, label) {
    const text = String(value || '').trim();
    if (!text) throw new Error(`${label} is required.`);
    return text;
  }

  function normalizeProjectRecord(item) {
    return {
      uuid: String(item.uuid || item.id || item.projectUuid || item.projectId || ''),
      name: String(item.name || item.title || item.projectName || ''),
      raw: item,
    };
  }

  function extractProjectUuid(payload, stdout = '') {
    const candidates = [
      payload?.uuid,
      payload?.projectUuid,
      payload?.projectId,
      payload?.id,
      payload?.data?.uuid,
      payload?.data?.projectUuid,
      payload?.data?.projectId,
      payload?.data?.id,
    ];
    const jsonCandidate = candidates.map((item) => String(item || '').trim()).find(Boolean);
    if (jsonCandidate) return jsonCandidate;
    const match = String(stdout || '').match(/(?:projectUuid|uuid|projectId|id)["'\s:=]+([a-zA-Z0-9_-]{6,})/i);
    return match?.[1] || '';
  }

  function todayCanvasName(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function resolveInstallCommand() {
    try {
      const result = await runProcess('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        [
          `$resp = Invoke-RestMethod -Uri '${LIBTV_VERSION_CHANNEL_URL}' -UseBasicParsing`,
          '$link = ConvertFrom-Json $resp.data.linkUrl',
          'Write-Output $link.install.PowerShell',
        ].join('; '),
      ], { timeoutMs: 30000 });
      const installUrl = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
      if (/^https:\/\//i.test(installUrl || '')) return `irm ${installUrl} | iex`;
    } catch {
      // Keep the settings page usable if the activity endpoint is temporarily unavailable.
    }
    return LIBTV_FALLBACK_INSTALL_COMMAND;
  }

  async function status() {
    const libtvBinary = resolveLibtvBinary();
    try {
      const result = await runLibtv(['--help'], { timeoutMs: 15000 });
      const versionResult = await runLibtv(['--version'], { timeoutMs: 15000 }).catch(() => null);
      const firstLine = (result.stdout || result.stderr || '').split(/\r?\n/).find(Boolean) || '';
      const version = String(versionResult?.stdout || '').trim() || firstLine;
      return { ok: true, available: true, path: libtvBinary, version };
    } catch (error) {
      return { ok: false, available: false, path: libtvBinary, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function install() {
    if (process.platform !== 'win32') {
      throw new Error('LibTV one-click install is currently only available on Windows.');
    }
    const installCommand = await resolveInstallCommand();
    const result = await runProcess('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      installCommand,
    ], { timeoutMs: 10 * 60 * 1000 });
    const installedStatus = await status();
    return {
      ok: true,
      path: resolveLibtvBinary(),
      version: installedStatus.version,
      stdout: result.stdout,
      stderr: result.stderr,
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

  async function listWorkspaces(payload = {}) {
    const page = Math.max(1, Number(payload.page || 1));
    const pageSize = Math.max(1, Math.min(200, Number(payload.pageSize || 100)));
    const result = await runLibtv(['workspace', 'list', '-p', page, '-s', pageSize], { timeoutMs: 60000 });
    const parsed = parseJsonOutput(result.stdout);
    return {
      ok: true,
      workspaces: normalizeListPayload(parsed, ['folders', 'workspaces', 'items', 'list']).map((item) => ({
        id: String(item.id || item.uuid || item.folderId || ''),
        name: String(item.name || item.title || item.folderName || ''),
        fileCnt: Number(item.fileCnt || item.fileCount || 0),
        raw: item,
      })).filter((item) => item.id),
      raw: parsed,
    };
  }

  async function listProjects(payload = {}) {
    const workspaceId = requireText(payload.workspaceId, 'LibTV workspace');
    const page = Math.max(1, Number(payload.page || 1));
    const pageSize = Math.max(1, Math.min(200, Number(payload.pageSize || 100)));
    const args = ['project', 'list', '-w', workspaceId, '-p', page, '-s', pageSize];
    if (payload.name) args.push('--name', String(payload.name));
    const result = await runLibtv(args, { timeoutMs: 60000 });
    const parsed = parseJsonOutput(result.stdout);
    return {
      ok: true,
      projects: normalizeListPayload(parsed, ['projectMetaList', 'projects', 'items', 'list', 'data']).map(normalizeProjectRecord).filter((item) => item.uuid),
      raw: parsed,
    };
  }

  async function createProject(payload = {}) {
    const workspaceId = requireText(payload.workspaceId, 'LibTV workspace');
    const title = requireText(payload.title, 'LibTV canvas title');
    const result = await runLibtv(['project', 'create', title, '-w', workspaceId], { timeoutMs: 60000 });
    const parsed = parseJsonOutput(result.stdout);
    const uuid = extractProjectUuid(parsed, result.stdout);
    if (!uuid) throw new Error(`LibTV project create did not return a project uuid for ${title}.`);
    return {
      ok: true,
      project: {
        uuid,
        name: String(parsed?.name || parsed?.title || title),
        raw: parsed,
      },
      raw: parsed,
    };
  }

  async function ensureDailyProject(payload = {}) {
    const workspaceId = requireText(payload.workspaceId, 'LibTV workspace');
    const title = String(payload.title || todayCanvasName()).trim() || todayCanvasName();
    const listed = await listProjects({ workspaceId, page: 1, pageSize: 100, name: title });
    const existing = listed.projects.find((project) => project.name === title);
    if (existing) {
      return { ok: true, created: false, project: existing };
    }
    const created = await createProject({ workspaceId, title });
    return { ok: true, created: true, project: created.project };
  }

  async function waitForProjectReady(payload = {}) {
    const workspaceId = requireText(payload.workspaceId, 'LibTV workspace');
    const projectUuid = requireText(payload.projectUuid, 'LibTV project');
    const projectName = String(payload.projectName || '').trim();
    const attempts = Math.max(1, Math.min(10, Number(payload.attempts || 6)));
    const delayMs = Math.max(250, Math.min(5000, Number(payload.delayMs || 900)));
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const listed = await listProjects({ workspaceId, page: 1, pageSize: 100, name: projectName || undefined });
        const project = listed.projects.find((item) => item.uuid === projectUuid)
          || (projectName ? listed.projects.find((item) => item.name === projectName) : null);
        if (project?.uuid) {
          await runLibtv(['node', 'list', '-p', project.uuid], { timeoutMs: 60000 });
          return { ok: true, project };
        }
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts) await sleep(delayMs);
    }

    throw new Error(lastError instanceof Error
      ? `LibTV canvas is not ready: ${lastError.message}`
      : 'LibTV canvas is not ready.');
  }

  async function imageModels() {
    const result = await runLibtv(['model', 'search', '--type', 'image'], { timeoutMs: 60000 });
    const parsed = parseJsonOutput(result.stdout);
    return {
      ok: true,
      models: normalizeListPayload(parsed, ['matches', 'models', 'items', 'list']).map((item) => ({
        modelKey: String(item.modelKey || item.key || item.id || item.modelName || ''),
        modelName: String(item.modelName || item.name || item.title || item.modelKey || ''),
        raw: item,
      })).filter((item) => item.modelName || item.modelKey),
      raw: parsed,
    };
  }

  async function uploadImageNode(projectUuid, filePath, payload = {}) {
    const project = requireText(projectUuid, 'LibTV project');
    const file = requireText(filePath, 'Image file');
    const title = String(payload.title || path.basename(file)).trim() || path.basename(file);
    const args = ['upload', title, '-p', project, '-t', 'image', '-f', file];
    if (Number.isFinite(Number(payload.x))) args.push('--x', Math.round(Number(payload.x)));
    if (Number.isFinite(Number(payload.y))) args.push('--y', Math.round(Number(payload.y)));
    const result = await runLibtv(args, { timeoutMs: 5 * 60 * 1000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, payload: parseJsonOutput(result.stdout) };
  }

  async function createImageNode(projectUuid, payload = {}) {
    const project = requireText(projectUuid, 'LibTV project');
    const title = requireText(payload.title || 'Forart Image Generation', 'LibTV node title');
    const prompt = requireText(payload.prompt, 'Prompt');
    const args = ['node'];
    if (Number.isFinite(Number(payload.x))) args.push('--x', Math.round(Number(payload.x)));
    if (Number.isFinite(Number(payload.y))) args.push('--y', Math.round(Number(payload.y)));
    args.push('create', title, '-p', project, '-t', 'image', '--prompt', prompt);
    if (payload.model) args.push('-s', `model=${String(payload.model)}`);
    if (payload.modeType) args.push('-s', `modeType=${String(payload.modeType)}`);
    if (payload.ratio) args.push('-s', `ratio=${String(payload.ratio)}`);
    if (payload.quality) args.push('-s', `quality=${String(payload.quality)}`);
    const result = await runLibtv(args, { timeoutMs: 5 * 60 * 1000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, payload: parseJsonOutput(result.stdout) };
  }

  async function connectLeft(projectUuid, targetNodeId, sourceNodeId) {
    const project = requireText(projectUuid, 'LibTV project');
    const target = requireText(targetNodeId, 'LibTV target node');
    const source = requireText(sourceNodeId, 'LibTV source node');
    const result = await runLibtv(['node', target, '-p', project, '--left-add', source], { timeoutMs: 60000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, payload: parseJsonOutput(result.stdout) };
  }

  async function createGroup(projectUuid, payload = {}) {
    const project = requireText(projectUuid, 'LibTV project');
    const title = requireText(payload.title || 'Forart Generation Run', 'LibTV group title');
    const args = ['group', 'create', title, '-p', project];
    const nodes = Array.isArray(payload.nodeIds) ? payload.nodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean) : [];
    nodes.forEach((nodeId) => args.push('--node', nodeId));
    const result = await runLibtv(args, { timeoutMs: 60000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, payload: parseJsonOutput(result.stdout) };
  }

  async function bindGroupNodes(projectUuid, groupId, nodeIds = []) {
    const project = requireText(projectUuid, 'LibTV project');
    const group = requireText(groupId, 'LibTV group');
    const nodes = Array.isArray(nodeIds) ? nodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean) : [];
    if (!nodes.length) return { ok: true, stdout: '', stderr: '', payload: null };
    const args = ['group', group, '-p', project];
    nodes.forEach((nodeId) => args.push('--node', nodeId));
    const result = await runLibtv(args, { timeoutMs: 60000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, payload: parseJsonOutput(result.stdout) };
  }

  async function runGroup(projectUuid, groupId) {
    const project = requireText(projectUuid, 'LibTV project');
    const group = requireText(groupId, 'LibTV group');
    const result = await runLibtv(['group', group, '-p', project, '--run'], { timeoutMs: 30 * 60 * 1000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, payload: parseJsonOutput(result.stdout) };
  }

  async function queryNode(projectUuid, nodeId) {
    const project = requireText(projectUuid, 'LibTV project');
    const node = requireText(nodeId, 'LibTV node');
    const result = await runLibtv(['node', node, '-p', project], { timeoutMs: 60000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, payload: parseJsonOutput(result.stdout) };
  }

  async function runNode(projectUuid, nodeId) {
    const project = requireText(projectUuid, 'LibTV project');
    const target = requireText(nodeId, 'LibTV node');
    const result = await runLibtv(['node', target, '-p', project, '--run'], { timeoutMs: 30 * 60 * 1000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, payload: parseJsonOutput(result.stdout) };
  }

  return {
    account,
    accounts,
    bindGroupNodes,
    connectLeft,
    createGroup,
    createImageNode,
    createProject,
    ensureDailyProject,
    imageModels,
    install,
    listProjects,
    listWorkspaces,
    loginWeb,
    logout,
    queryNode,
    runGroup,
    runNode,
    status,
    uploadImageNode,
    useAccount,
    waitForProjectReady,
  };
}

module.exports = { createLibtvAdapter };
