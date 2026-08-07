import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDevSupervisor } from "../scripts/dev-supervisor.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class FakeProcess extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
  }

  exit(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

function createHarness({ rendererReady = Promise.resolve() } = {}) {
  const signalSource = new EventEmitter();
  const vite = new FakeProcess(101);
  const electron = new FakeProcess(102);
  const spawned = [];
  const terminated = [];
  const run = runDevSupervisor({
    cwd: "D:/Forart",
    signalSource,
    viteCommand: { command: "node", args: ["vite"] },
    electronCommand: { command: "electron", args: ["."] },
    waitUntilRendererReady: () => rendererReady,
    spawnProcess(command) {
      spawned.push(command);
      return command === "node" ? vite : electron;
    },
    terminateProcess(child) {
      if (child && child.exitCode === null) terminated.push(child.pid);
    },
  });
  return { electron, run, signalSource, spawned, terminated, vite };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function assertPortCanBeReused(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
}

test("development supervisor terminates Vite after Electron exits", async () => {
  const harness = createHarness();
  await flush();
  assert.deepEqual(harness.spawned, ["node", "electron"]);
  harness.electron.exit(0);
  assert.equal(await harness.run, 0);
  assert.deepEqual(harness.terminated, [101]);
});

test("development supervisor terminates Electron after Vite exits", async () => {
  const harness = createHarness();
  await flush();
  harness.vite.exit(1);
  assert.equal(await harness.run, 1);
  assert.deepEqual(harness.terminated, [102]);
});

test("development supervisor terminates both children on Ctrl+C", async () => {
  const harness = createHarness();
  await flush();
  harness.signalSource.emit("SIGINT");
  assert.equal(await harness.run, 130);
  assert.deepEqual(harness.terminated, [102, 101]);
});

test("development supervisor does not start Electron if Vite exits before becoming ready", async () => {
  const harness = createHarness({ rendererReady: new Promise(() => {}) });
  await flush();
  harness.vite.exit(1);
  assert.equal(await harness.run, 1);
  assert.deepEqual(harness.spawned, ["node"]);
  assert.deepEqual(harness.terminated, []);
});

test("development supervisor releases the real Vite port after the app process exits", { timeout: 20_000 }, async () => {
  const port = await reserveFreePort();
  const code = await runDevSupervisor({
    cwd: repositoryRoot,
    rendererUrl: `http://127.0.0.1:${port}`,
    signalSource: new EventEmitter(),
    viteCommand: {
      command: process.execPath,
      args: [path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    },
    electronCommand: {
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 250)"],
    },
  });
  assert.equal(code, 0);
  await assertPortCanBeReused(port);
});
