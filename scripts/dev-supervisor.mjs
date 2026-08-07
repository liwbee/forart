import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import electronPath from "electron";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..");

function hasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

export function terminateProcessTree(child, {
  platform = process.platform,
  spawnSyncProcess = spawnSync,
} = {}) {
  if (hasExited(child) || !Number.isInteger(child.pid)) return;
  if (platform === "win32") {
    spawnSyncProcess("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

export function waitForRenderer(url, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if ((response.statusCode || 500) < 500) {
          resolve();
          return;
        }
        scheduleNext();
      });
      request.setTimeout(Math.min(intervalMs, 1_000), () => request.destroy());
      request.once("error", scheduleNext);
    };
    const scheduleNext = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(probe, intervalMs);
    };
    probe();
  });
}

function exitResult(source, code, signal) {
  return {
    source,
    code: Number.isInteger(code) ? code : signal ? 1 : 0,
    signal: signal || null,
  };
}

export async function runDevSupervisor({
  cwd = defaultRoot,
  rendererUrl = "http://127.0.0.1:6981",
  spawnProcess = spawn,
  terminateProcess = terminateProcessTree,
  waitUntilRendererReady = waitForRenderer,
  signalSource = process,
  viteCommand = {
    command: process.execPath,
    args: [path.join(defaultRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--strictPort"],
  },
  electronCommand = { command: electronPath, args: ["."] },
} = {}) {
  let viteProcess = null;
  let electronProcess = null;
  let signalResolve = null;
  const signalPromise = new Promise((resolve) => { signalResolve = resolve; });
  const signalHandlers = new Map([
    ["SIGINT", () => signalResolve(exitResult("signal", 130, "SIGINT"))],
    ["SIGTERM", () => signalResolve(exitResult("signal", 143, "SIGTERM"))],
  ]);
  for (const [signal, handler] of signalHandlers) signalSource.on(signal, handler);

  try {
    viteProcess = spawnProcess(viteCommand.command, viteCommand.args, {
      cwd,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    });
    const viteExit = once(viteProcess, "exit").then(([code, signal]) => exitResult("vite", code, signal));
    const rendererStart = await Promise.race([
      waitUntilRendererReady(rendererUrl).then(() => null),
      viteExit,
      signalPromise,
    ]);
    if (rendererStart) return rendererStart.code;

    electronProcess = spawnProcess(electronCommand.command, electronCommand.args, {
      cwd,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    });
    const electronExit = once(electronProcess, "exit").then(([code, signal]) => exitResult("electron", code, signal));
    const result = await Promise.race([electronExit, viteExit, signalPromise]);
    return result.code;
  } finally {
    for (const [signal, handler] of signalHandlers) signalSource.removeListener(signal, handler);
    terminateProcess(electronProcess);
    terminateProcess(viteProcess);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  runDevSupervisor()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error("Failed to run Forart development app:", error);
      process.exitCode = 1;
    });
}
