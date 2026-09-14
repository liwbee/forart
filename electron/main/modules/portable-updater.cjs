const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const REPO_URL = 'https://github.com/liwbee/forart';
const GITHUB_API_ROOT = 'https://api.github.com/repos/liwbee/forart';
const LATEST_RELEASE_URL = `${GITHUB_API_ROOT}/releases/latest`;
const PORTABLE_ASSET_PATTERN = /forart.*windows.*portable.*\.zip$/i;

function readPackageInfo(rootDir) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    return {
      version: String(packageJson.version || '0.0.0'),
      name: String(packageJson.name || 'Forart'),
    };
  } catch {
    return { version: '0.0.0', name: 'Forart' };
  }
}

async function fetchJson(net, url) {
  const response = await net.fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Forart-Updater',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function normalizeSha256Digest(value) {
  const match = String(value || '').trim().match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : '';
}

async function downloadFileWithProgress(net, url, filePath, onProgress, expectedDigest = '') {
  const response = await net.fetch(url, {
    headers: {
      Accept: 'application/octet-stream, */*',
      'User-Agent': 'Forart-Updater',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const totalBytes = Number(response.headers.get('content-length') || 0) || 0;
  const reader = response.body?.getReader?.();
  const stream = fs.createWriteStream(filePath);
  const hash = createHash('sha256');
  let receivedBytes = 0;

  function writeChunk(chunk) {
    return new Promise((resolve, reject) => {
      stream.write(chunk, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  try {
    if (!reader) {
      const bytes = Buffer.from(await response.arrayBuffer());
      hash.update(bytes);
      await writeChunk(bytes);
      receivedBytes = bytes.length;
      onProgress?.({ receivedBytes, totalBytes, done: true });
    } else {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = Buffer.from(value);
        hash.update(chunk);
        await writeChunk(chunk);
        receivedBytes += chunk.length;
        onProgress?.({ receivedBytes, totalBytes, done: false });
      }
      onProgress?.({ receivedBytes, totalBytes, done: true });
    }
  } catch (error) {
    stream.destroy();
    fs.rmSync(filePath, { force: true });
    throw error;
  }

  await new Promise((resolve, reject) => {
    stream.end((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const expected = normalizeSha256Digest(expectedDigest);
  if (expectedDigest && !expected) {
    fs.rmSync(filePath, { force: true });
    throw new Error('Expected update digest must use the sha256:<64 hex characters> format.');
  }
  if (expected) {
    const actual = hash.digest('hex');
    if (actual !== expected) {
      fs.rmSync(filePath, { force: true });
      throw new Error(`Downloaded update digest mismatch. Expected sha256:${expected}, got sha256:${actual}.`);
    }
  }

  return { receivedBytes, totalBytes };
}

function stripUtf8Bom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function parseJsonText(text) {
  return JSON.parse(stripUtf8Bom(text));
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function normalizeVersionField(value, fallbackVersion = '') {
  return normalizeVersion(value || fallbackVersion);
}

function versionParts(value) {
  return normalizeVersion(value).match(/\d+/g)?.map(Number) || [];
}

function compareVersions(a, b) {
  const aa = versionParts(a);
  const bb = versionParts(b);
  const length = Math.max(aa.length, bb.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (aa[index] || 0) - (bb[index] || 0);
    if (diff) return diff;
  }
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function normalizeUpdateNotes(input, fallbackVersion = '') {
  const payload = input && typeof input === 'object' ? input : {};
  const items = Array.isArray(payload.items)
    ? payload.items
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return String(item.text || item.title || '').trim();
        return '';
      })
      .filter(Boolean)
    : [];

  return {
    version: normalizeVersionField(payload.version, fallbackVersion),
    updatedAt: String(payload.updatedAt || payload.updated_at || payload.date || '').trim(),
    revision: normalizeVersionField(payload.revision, fallbackVersion),
    items,
  };
}

function notesFromReleaseBody(body, fallbackVersion = '') {
  const text = String(body || '').trim();
  if (!text) return normalizeUpdateNotes({}, fallbackVersion);
  try {
    return normalizeUpdateNotes(parseJsonText(text), fallbackVersion);
  } catch {
    const items = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 12);
    return normalizeUpdateNotes({ version: fallbackVersion, items }, fallbackVersion);
  }
}

function readLocalVersion(rootDir) {
  const version = fs.readFileSync(path.join(rootDir, 'VERSION'), 'utf8').trim().split(/\r?\n/)[0]?.trim();
  if (!version) throw new Error('Local VERSION is empty.');
  return normalizeVersion(version);
}

function portableDataRoot(rootDir) {
  const directory = path.join(rootDir, '.forart-data');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function updateStagingRoot(rootDir) {
  const directory = path.join(portableDataRoot(rootDir), 'update_staging');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function timestampName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeDirectoryBestEffort(directory) {
  if (!directory || !fs.existsSync(directory)) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch {
      if (attempt === 4) return;
      await wait(150 * (attempt + 1));
    }
  }
}

function safeFileName(fileName, fallback = 'Forart-windows-portable.zip') {
  const baseName = path.basename(String(fileName || fallback));
  return baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || fallback;
}

function readPortableArchiveText(zip, candidates) {
  for (const candidate of candidates) {
    const entry = zip.getEntry(candidate);
    if (entry) return zip.readAsText(entry).replace(/^\uFEFF/, '').trim();
  }
  return '';
}

function validatePortableArchiveVersion(zipPath, expectedVersion) {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (error) {
    throw new Error(`Downloaded portable package is not a readable zip: ${error instanceof Error ? error.message : String(error)}`);
  }

  const versionText = readPortableArchiveText(zip, [
    'resources/app/VERSION',
    'app/VERSION',
    'VERSION',
  ]);
  const packageText = readPortableArchiveText(zip, [
    'resources/app/package.json',
    'app/package.json',
    'package.json',
  ]);
  const packagedVersion = normalizeVersion(versionText.split(/\r?\n/)[0] || (() => {
    try { return JSON.parse(packageText).version; } catch { return ''; }
  })());
  const expected = normalizeVersion(expectedVersion);
  if (!packagedVersion) throw new Error('Downloaded portable package does not contain an application VERSION file.');
  if (!expected || packagedVersion !== expected) {
    throw new Error(`Downloaded portable package version mismatch. Expected ${expected || 'unknown'}, got ${packagedVersion}.`);
  }
  if (packageText) {
    let packageVersion = '';
    try { packageVersion = normalizeVersion(JSON.parse(packageText).version); } catch { /* VERSION is authoritative. */ }
    if (packageVersion && packageVersion !== expected) {
      throw new Error(`Downloaded portable package package.json version mismatch. Expected ${expected}, got ${packageVersion}.`);
    }
  }
  return packagedVersion;
}

function findPortableAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => PORTABLE_ASSET_PATTERN.test(String(asset?.name || '')))
    || assets.find((asset) => /portable.*\.zip$/i.test(String(asset?.name || '')))
    || assets.find((asset) => /\.zip$/i.test(String(asset?.name || '')))
    || null;
}

async function readLatestRelease(net) {
  const release = await fetchJson(net, LATEST_RELEASE_URL);
  const tagName = String(release.tag_name || '').trim();
  const version = normalizeVersion(tagName);
  if (!version || !/\d/.test(version)) throw new Error('Latest GitHub Release tag is empty or invalid.');
  const asset = findPortableAsset(release);
  if (!asset?.browser_download_url) {
    throw new Error('Latest GitHub Release does not contain a Forart Windows portable zip asset.');
  }
  const notes = notesFromReleaseBody(release.body || '', version);
  return {
    id: release.id,
    name: String(release.name || version),
    tagName: version,
    version,
    publishedAt: String(release.published_at || release.created_at || ''),
    htmlUrl: String(release.html_url || REPO_URL),
    notes,
    asset: {
      name: String(asset.name || 'Forart-windows-portable.zip'),
      size: Number(asset.size || 0),
      url: String(asset.browser_download_url),
      digest: String(asset.digest || ''),
    },
  };
}

async function readTextIfExists(filePath, maxLength = 1600) {
  try {
    const text = await fs.promises.readFile(filePath, 'utf8');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return '';
  }
}

async function waitForApplyStatus(statusPath, expectedState, timeoutMs = 10000, diagnosticPaths = []) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = parseJsonText(await fs.promises.readFile(statusPath, 'utf8'));
      if (payload?.state === expectedState) return payload;
      if (payload?.state === 'failed') throw new Error(payload.error || 'Update apply script failed before takeover.');
    } catch (error) {
      if (error?.code !== 'ENOENT' && !String(error?.message || '').includes('Unexpected end')) throw error;
    }
    await wait(150);
  }
  const details = [];
  for (const item of diagnosticPaths) {
    const text = await readTextIfExists(item.path);
    if (text) details.push(`${item.name}: ${text.trim()}`);
  }
  throw new Error(`Timed out waiting for update apply script to take over.${details.length ? ` ${details.join(' ')}` : ''}`);
}

function writePortableApplyScript(scriptPath) {
  const script = String.raw`param(
  [Parameter(Mandatory = $true)]
  [string]$PlanPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
}

function Write-Status {
  param([string]$State, [string]$ErrorMessage = "")
  $payload = [ordered]@{
    state = $State
    error = $ErrorMessage
    updatedAt = (Get-Date).ToString("o")
  }
  $json = $payload | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($script:StatusPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-TreeWithRetry {
  param([string]$Target)
  if (-not $Target -or -not (Test-Path -LiteralPath $Target)) {
    return
  }
  for ($attempt = 1; $attempt -le 10; $attempt += 1) {
    try {
      Remove-Item -LiteralPath $Target -Recurse -Force
      return
    } catch {
      if ($attempt -eq 10) {
        throw
      }
      Start-Sleep -Milliseconds (300 * $attempt)
    }
  }
}

function Wait-ForForartToExit {
  param([string]$ExePath, [int]$MainPid)
  if ($MainPid -gt 0) {
    Write-Log ("Waiting for Forart process {0} to exit." -f $MainPid)
  }
  for ($attempt = 1; $attempt -le 180; $attempt += 1) {
    $running = @(Get-CimInstance Win32_Process -Filter "name = 'Forart.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq [System.IO.Path]::GetFullPath($ExePath)) })
    if ($running.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for Forart to exit."
}

function Resolve-ExtractedRoot {
  param([string]$ExtractRoot)
  $directExe = Join-Path $ExtractRoot "Forart.exe"
  if (Test-Path -LiteralPath $directExe -PathType Leaf) {
    return $ExtractRoot
  }
  $candidate = Get-ChildItem -LiteralPath $ExtractRoot -Filter "Forart.exe" -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName "resources") -PathType Container } |
    Select-Object -First 1
  if ($candidate) {
    return $candidate.DirectoryName
  }
  throw "Portable package does not contain Forart.exe."
}

$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
$script:InstallRoot = [string]$plan.installRoot
$script:ZipPath = [string]$plan.zipPath
$script:ExtractRoot = [string]$plan.extractRoot
$script:BackupRoot = [string]$plan.backupRoot
$script:LogPath = [string]$plan.logPath
$script:StatusPath = [string]$plan.statusPath
$exePath = [string]$plan.exePath
$electronPid = [int]$plan.electronPid
$preserveNames = @("forart-config.json", "CanvasAssests", ".forart-data", "forart_data")

New-Item -ItemType Directory -Force -Path (Split-Path -Path $script:LogPath -Parent) | Out-Null

try {
  Write-Status -State "running"
  Write-Log ("Forart portable update started. Plan: {0}" -f $PlanPath)
  Wait-ForForartToExit -ExePath $exePath -MainPid $electronPid

  Remove-TreeWithRetry -Target $script:ExtractRoot
  New-Item -ItemType Directory -Force -Path $script:ExtractRoot | Out-Null
  Write-Log ("Extracting portable package: {0}" -f $script:ZipPath)
  Expand-Archive -LiteralPath $script:ZipPath -DestinationPath $script:ExtractRoot -Force
  $sourceRoot = Resolve-ExtractedRoot -ExtractRoot $script:ExtractRoot
  Write-Log ("Using extracted root: {0}" -f $sourceRoot)

  # Build the new tree completely before switching the install directory. The
  # helper itself lives outside InstallRoot so the directory can be renamed.
  $sourceNames = @(Get-ChildItem -LiteralPath $sourceRoot -Force | ForEach-Object { $_.Name })
  Remove-TreeWithRetry -Target $script:BackupRoot
  Write-Log ("Moving current install to backup: {0}" -f $script:BackupRoot)
  Move-Item -LiteralPath $script:InstallRoot -Destination $script:BackupRoot
  try {
    Write-Log ("Switching staged install into place: {0}" -f $script:InstallRoot)
    Move-Item -LiteralPath $sourceRoot -Destination $script:InstallRoot

    # Preserve the same user data as the old updater, plus unknown top-level
    # files that are not part of the new package.
    foreach ($item in Get-ChildItem -LiteralPath $script:BackupRoot -Force) {
      $keep = ($preserveNames -contains $item.Name) -or ($sourceNames -notcontains $item.Name)
      if (-not $keep) { continue }
      $target = Join-Path $script:InstallRoot $item.Name
      if (Test-Path -LiteralPath $target) { Remove-TreeWithRetry -Target $target }
      Write-Log ("Preserving user item: {0}" -f $item.Name)
      Move-Item -LiteralPath $item.FullName -Destination $target
    }
  } catch {
    Write-Log "Atomic switch failed; restoring previous install."
    if (Test-Path -LiteralPath $script:InstallRoot) {
      Remove-TreeWithRetry -Target $script:InstallRoot
    }
    if (Test-Path -LiteralPath $script:BackupRoot) {
      Move-Item -LiteralPath $script:BackupRoot -Destination $script:InstallRoot
    }
    throw
  }

  Write-Status -State "success"
  Write-Log "Forart portable update applied successfully."
  $nextExePath = Join-Path $script:InstallRoot "Forart.exe"
  Write-Log ("Restarting Forart: {0}" -f $nextExePath)
  Start-Process -FilePath $nextExePath -WorkingDirectory $script:InstallRoot
  $started = $false
  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    $started = @(Get-CimInstance Win32_Process -Filter "name = 'Forart.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq [System.IO.Path]::GetFullPath($nextExePath)) }).Count -gt 0
    if ($started) { break }
  }
  if (-not $started) { throw "Updated Forart process did not start." }
  Remove-TreeWithRetry -Target $script:BackupRoot
  Remove-TreeWithRetry -Target $script:ExtractRoot
  Write-Log "Update finished. Closing updater window."
  exit 0
} catch {
  $message = $_.Exception.Message
  if (Test-Path -LiteralPath $script:BackupRoot) {
    try {
      Write-Log "Update did not complete; restoring previous install."
      if (Test-Path -LiteralPath $script:InstallRoot) {
        Remove-TreeWithRetry -Target $script:InstallRoot
      }
      Move-Item -LiteralPath $script:BackupRoot -Destination $script:InstallRoot
    } catch {
      $message = "$message Restore failed: $($_.Exception.Message)"
    }
  }
  Write-Log ("Update failed: {0}" -f $message)
  Write-Status -State "failed" -ErrorMessage $message
  Write-Host ""
  Write-Host "Forart update failed. Please keep this window open and send the log file to support:"
  Write-Host $script:LogPath
  Read-Host "Press Enter to close"
  exit 1
}
`;
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, script, 'utf8');
}

function writePortableLauncherScript(scriptPath) {
  const script = String.raw`param(
  [Parameter(Mandatory = $true)]
  [string]$ApplyPath,
  [Parameter(Mandatory = $true)]
  [string]$PlanPath,
  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory,
  [Parameter(Mandatory = $true)]
  [string]$StatusPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-LauncherStatus {
  param([string]$State, [string]$ErrorMessage = "")
  $payload = [ordered]@{
    state = $State
    error = $ErrorMessage
    updatedAt = (Get-Date).ToString("o")
  }
  $json = $payload | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($StatusPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Quote-ProcessArgument {
  param([string]$Value)
  return '"' + ($Value -replace '"', '\"') + '"'
}

try {
  New-Item -ItemType Directory -Force -Path (Split-Path -Path $StatusPath -Parent) | Out-Null
  Write-LauncherStatus -State "starting"

  $argumentList = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Quote-ProcessArgument -Value $ApplyPath),
    "-PlanPath",
    (Quote-ProcessArgument -Value $PlanPath)
  ) -join " "

  Start-Process -FilePath "powershell.exe" -ArgumentList $argumentList -WorkingDirectory $WorkingDirectory -WindowStyle Normal
  Write-LauncherStatus -State "launched"
} catch {
  Write-LauncherStatus -State "failed" -ErrorMessage $_.Exception.Message
  exit 1
}
`;
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, script, 'utf8');
}

async function schedulePortableUpdateApply({ installRoot, zipPath, version }) {
  if (process.platform !== 'win32') throw new Error('Automatic portable update is currently supported on Windows only.');

  // Keep the helper outside InstallRoot but on the same volume. This lets the
  // apply script atomically rename the complete portable directory.
  const applyRoot = path.join(path.dirname(installRoot), `.${path.basename(installRoot)}.update-work`, `${timestampName()}-${process.pid}`);
  fs.mkdirSync(applyRoot, { recursive: true });
  const scriptPath = path.join(applyRoot, 'apply-portable-update.ps1');
  const launcherPath = path.join(applyRoot, 'portable-update-launcher.ps1');
  const planPath = path.join(applyRoot, 'portable-update-plan.json');
  const logPath = path.join(applyRoot, 'apply-portable-update.log');
  const statusPath = path.join(applyRoot, 'apply-status.json');
  const launcherStatusPath = path.join(applyRoot, 'launcher-status.json');
  const extractRoot = path.join(applyRoot, 'extracted');
  const backupRoot = path.join(path.dirname(installRoot), `.${path.basename(installRoot)}.update-backup-${timestampName()}-${process.pid}`);

  const plan = {
    installRoot,
    zipPath,
    extractRoot,
    backupRoot,
    version,
    exePath: process.execPath,
    electronPid: process.pid,
    logPath,
    statusPath,
    createdAt: new Date().toISOString(),
  };

  writePortableApplyScript(scriptPath);
  writePortableLauncherScript(launcherPath);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');

  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    launcherPath,
    '-ApplyPath',
    scriptPath,
    '-PlanPath',
    planPath,
    '-WorkingDirectory',
    applyRoot,
    '-StatusPath',
    launcherStatusPath,
  ], {
    cwd: applyRoot,
    stdio: 'ignore',
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    child.once('error', onError);
    child.unref();
    waitForApplyStatus(statusPath, 'running', 12000, [
      { name: 'launcher-status', path: launcherStatusPath },
      { name: 'apply-status', path: statusPath },
      { name: 'apply-log', path: logPath },
    ]).then(resolve, reject).finally(() => {
      child.off('error', onError);
    });
  });

  return { applyRoot, scriptPath, launcherPath, planPath, logPath, statusPath };
}

async function probeNet(name, net, url, required = true) {
  const startedAt = Date.now();
  try {
    const response = await net.fetch(url, {
      headers: {
        'User-Agent': 'Forart-Updater',
      },
    });
    return {
      name,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      detail: `HTTP ${response.status}`,
      required,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
      required,
    };
  }
}

async function probeWritable(rootDir) {
  const startedAt = Date.now();
  const filePath = path.join(portableDataRoot(rootDir), `.update-write-test-${process.pid}.tmp`);
  try {
    fs.writeFileSync(filePath, 'ok', 'utf8');
    fs.rmSync(filePath, { force: true });
    return {
      name: 'Local update directory',
      ok: true,
      elapsedMs: Date.now() - startedAt,
      detail: 'Writable',
      required: true,
    };
  } catch (error) {
    return {
      name: 'Local update directory',
      ok: false,
      elapsedMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
      required: true,
    };
  }
}

async function appInfoPayload(rootDir) {
  const packageInfo = readPackageInfo(rootDir);
  const version = readLocalVersion(rootDir);
  return {
    name: packageInfo.name,
    repoUrl: REPO_URL,
    updateUrl: LATEST_RELEASE_URL,
    currentRevision: version,
    currentUpdatedAt: '',
  };
}


function createPortableUpdater({ app, rootDir, dataRoot = rootDir, net }) {
  function emitProgress(onProgress, payload) {
    onProgress?.({
      phase: payload.phase || 'downloading',
      percent: Math.max(0, Math.min(100, Number(payload.percent || 0))),
      downloadedBytes: Number(payload.downloadedBytes || 0),
      bytesPerSecond: Number(payload.bytesPerSecond || 0),
      currentFile: String(payload.currentFile || ''),
      fileIndex: Number(payload.fileIndex || 0),
      fileCount: Number(payload.fileCount || 0),
      fileBytes: Number(payload.fileBytes || 0),
      fileTotalBytes: Number(payload.fileTotalBytes || 0),
    });
  }

  async function appInfo() {
    return appInfoPayload(rootDir);
  }

  async function check() {
    const info = await appInfoPayload(rootDir);
    try {
      const latestRelease = await readLatestRelease(net);
      const updateAvailable = compareVersions(latestRelease.version, info.currentRevision) > 0;
      return {
        ok: true,
        currentRevision: info.currentRevision,
        latestRevision: latestRelease.version,
        currentUpdatedAt: info.currentUpdatedAt,
        latestUpdatedAt: latestRelease.publishedAt || latestRelease.version,
        updateAvailable,
        repoUrl: latestRelease.htmlUrl || REPO_URL,
        updateNotes: {
          ...latestRelease.notes,
          version: latestRelease.version,
          updatedAt: latestRelease.publishedAt || latestRelease.notes.updatedAt,
          revision: latestRelease.version,
          source: 'github-release',
        },
      };
    } catch (error) {
      return {
        ok: false,
        currentRevision: info.currentRevision,
        latestRevision: '',
        currentUpdatedAt: info.currentUpdatedAt,
        latestUpdatedAt: '',
        updateAvailable: false,
        repoUrl: REPO_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function run({ onProgress } = {}) {
    if (!app.isPackaged) {
      return {
        ok: false,
        updated: [],
        count: 0,
        error: 'Development builds do not use the portable updater. Use git pull and npm install.',
      };
    }

    const stagingRoot = path.join(updateStagingRoot(dataRoot), `${timestampName()}-${process.pid}`);
    try {
      await removeDirectoryBestEffort(stagingRoot);
      fs.mkdirSync(stagingRoot, { recursive: true });

      emitProgress(onProgress, { phase: 'listing', percent: 0 });
      const latestRelease = await readLatestRelease(net);
      const currentVersion = readLocalVersion(rootDir);
      if (compareVersions(latestRelease.version, currentVersion) <= 0) {
        return {
          ok: false,
          updated: [],
          count: 0,
          error: 'No newer portable release is available.',
        };
      }

      const expectedDigest = normalizeSha256Digest(latestRelease.asset.digest);
      if (!expectedDigest) {
        throw new Error('Latest portable release does not contain a valid sha256 asset digest.');
      }

      const zipName = safeFileName(latestRelease.asset.name, `Forart-${latestRelease.version}-windows-portable.zip`);
      const zipPath = path.join(stagingRoot, zipName);
      const startedAt = Date.now();
      let lastEmittedAt = 0;
      emitProgress(onProgress, {
        phase: 'downloading',
        percent: 0,
        currentFile: zipName,
        fileIndex: 1,
        fileCount: 1,
        fileBytes: 0,
        fileTotalBytes: latestRelease.asset.size,
      });
      await downloadFileWithProgress(net, latestRelease.asset.url, zipPath, ({ receivedBytes, totalBytes, done }) => {
        const now = Date.now();
        if (!done && now - lastEmittedAt < 180) return;
        lastEmittedAt = now;
        const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001);
        const knownTotal = totalBytes || latestRelease.asset.size || 0;
        emitProgress(onProgress, {
          phase: 'downloading',
          percent: knownTotal ? Math.min((receivedBytes / knownTotal) * 100, 99.5) : (done ? 100 : 50),
          downloadedBytes: receivedBytes,
          bytesPerSecond: receivedBytes / elapsedSeconds,
          currentFile: zipName,
          fileIndex: 1,
          fileCount: 1,
          fileBytes: receivedBytes,
          fileTotalBytes: knownTotal,
        });
      }, `sha256:${expectedDigest}`);

      validatePortableArchiveVersion(zipPath, latestRelease.version);

      emitProgress(onProgress, {
        phase: 'scheduling',
        percent: 100,
        downloadedBytes: fs.statSync(zipPath).size,
        currentFile: zipName,
        fileIndex: 1,
        fileCount: 1,
      });
      await schedulePortableUpdateApply({
        installRoot: path.dirname(process.execPath),
        zipPath,
        version: latestRelease.version,
      });
      emitProgress(onProgress, { phase: 'scheduled', percent: 100, currentFile: zipName, fileIndex: 1, fileCount: 1 });

      setTimeout(() => {
        app.quit();
      }, 1200);

      return {
        ok: true,
        updated: [zipName],
        count: 1,
        version: latestRelease.version,
      };
    } catch (error) {
      await removeDirectoryBestEffort(stagingRoot);
      return {
        ok: false,
        updated: [],
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function checkConnectivity() {
    const results = await Promise.all([
      probeNet('GitHub latest release', net, LATEST_RELEASE_URL),
      probeWritable(dataRoot),
    ]);
    const required = results.filter((item) => item.required);
    return {
      ok: required.every((item) => item.ok),
      results,
    };
  }

  return { appInfo, check, checkConnectivity, run };
}

module.exports = {
  createPortableUpdater,
  downloadFileWithProgress,
  normalizeSha256Digest,
  validatePortableArchiveVersion,
};
