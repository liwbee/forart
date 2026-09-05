import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const INIT_PY = `WEB_DIRECTORY = "./web"
NODE_CLASS_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "WEB_DIRECTORY"]
`

const BRIDGE_JS = `import { app } from "../../scripts/app.js";

const params = new URLSearchParams(window.location.search);
const allowedOrigin = params.get("dxosOrigin");
const bridgeToken = params.get("dxosBridgeToken");
const BRIDGE_VERSION = "7";

function reply(type, detail = {}) {
  if (!allowedOrigin || !bridgeToken || window.parent === window) return;
  window.parent.postMessage({ type, token: bridgeToken, ...detail }, allowedOrigin);
}

function canvasPosition(clientX, clientY) {
  if (app.canvas?.convertEventToCanvasOffset) {
    return app.canvas.convertEventToCanvasOffset({ clientX, clientY });
  }
  const scale = app.canvas?.ds?.scale || 1;
  const offset = app.canvas?.ds?.offset || [0, 0];
  return [clientX / scale - offset[0], clientY / scale - offset[1]];
}

function imageValue(upload) {
  return upload.subfolder ? upload.subfolder + "/" + upload.name : upload.name;
}

function setLoadImage(node, upload) {
  const widget = node.widgets?.find((item) => item.name === "image");
  if (!widget) throw new Error("LoadImage 节点缺少 image 控件");
  const previous = widget.value;
  const value = imageValue(upload);
  const values = widget.options?.values;
  if (Array.isArray(values) && !values.includes(value)) values.push(value);
  widget.value = value;
  widget.callback?.(value);
  node.onWidgetChanged?.("image", value, previous, widget);
  node.setSize?.(node.computeSize?.() || node.size);
  app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.captureCanvasState?.();
  return node;
}

function addLoadImage(upload, position, index) {
  const node = LiteGraph.createNode("LoadImage");
  if (!node) throw new Error("ComfyUI 中没有 LoadImage 节点");
  app.graph.add(node);
  node.pos = [position[0] + index * 36, position[1] + index * 36];
  return setLoadImage(node, upload);
}

function targetLoadImage(position) {
  const nodes = (app.graph?._nodes || []).filter((node) => node.type === "LoadImage");
  const underPointer = [...nodes].reverse().find((node) => {
    const width = node.size?.[0] || 0;
    const height = node.size?.[1] || 0;
    return position[0] >= node.pos[0] && position[0] <= node.pos[0] + width
      && position[1] >= node.pos[1] && position[1] <= node.pos[1] + height;
  });
  if (underPointer) return underPointer;
  const selected = nodes.filter((node) => app.canvas?.selected_nodes?.[node.id]);
  if (selected.length === 1) return selected[0];
  return nodes.length === 1 ? nodes[0] : null;
}

let designMode = false;
let designWorkflow = null;
let mappingToolbar = null;
let activeMappings = [];
let loadingWorkflow = false;
let lastWorkflowRequestId = "";
let selectedNodeId = "";
let selectionTimer = 0;

function primitiveInput(value) {
  return !(Array.isArray(value) && value.length === 2);
}

function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function apiNodeId(node) {
  return String(node?.properties?.dxosApiNodeId || node?.id || "");
}

function ensureMappingToolbar() {
  if (mappingToolbar) return mappingToolbar;
  if (!document.getElementById("dxos-workflow-mapper-style")) {
    const style = document.createElement("style");
    style.id = "dxos-workflow-mapper-style";
    style.textContent = [
      '#dxos-workflow-mapper{position:fixed;right:18px;top:68px;z-index:99999;width:276px;max-height:calc(100vh - 92px);box-sizing:border-box;overflow:auto;padding:12px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:linear-gradient(180deg,rgba(42,45,52,.88),rgba(24,26,31,.9));box-shadow:0 18px 48px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.11);backdrop-filter:saturate(145%) blur(22px);color:#f5f5f7;font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;display:none}',
      '#dxos-workflow-mapper .dxos-mapper-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.1)}',
      '#dxos-workflow-mapper .dxos-mapper-head strong{display:block;font-size:13px;letter-spacing:-.1px}#dxos-workflow-mapper .dxos-mapper-head small{color:rgba(255,255,255,.48);font-size:9.5px}',
      '#dxos-workflow-mapper button{font:inherit;transition:transform .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease}',
      '#dxos-workflow-mapper button:hover{transform:translateY(-1px);border-color:rgba(83,168,255,.58)!important;background:rgba(62,145,235,.16)!important;box-shadow:0 5px 14px rgba(0,0,0,.2)}',
      '#dxos-workflow-mapper .dxos-output{padding:5px 8px;border:1px solid rgba(255,255,255,.16);border-radius:7px;background:rgba(255,255,255,.07);color:inherit;cursor:pointer}',
      '#dxos-workflow-mapper .dxos-input{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;padding:9px 10px;border:1px solid rgba(255,255,255,.11);border-radius:9px;background:rgba(255,255,255,.045);color:inherit;text-align:left;cursor:pointer}',
      '#dxos-workflow-mapper .dxos-input.mapped{border-color:rgba(66,161,255,.62);background:rgba(34,125,218,.16);box-shadow:inset 3px 0 0 #3d9cff}',
      '#dxos-workflow-mapper .dxos-input span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#dxos-workflow-mapper .dxos-input small{color:rgba(255,255,255,.5);font-size:9.5px}#dxos-workflow-mapper .dxos-input.mapped small{color:#79c8ff}'
    ].join('');
    document.head.appendChild(style);
  }
  mappingToolbar = document.createElement("div");
  mappingToolbar.id = "dxos-workflow-mapper";
  document.body.appendChild(mappingToolbar);
  return mappingToolbar;
}

function mappingType(value, name) {
  if (/seed/i.test(name)) return "seed";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (/prompt|text|positive|negative/i.test(name) || (typeof value === "string" && value.length > 60)) return "textarea";
  if (/image|mask/i.test(name)) return "image";
  return "text";
}

function widgetMetadata(node, input, fallback) {
  const widget = node?.widgets?.find((item) => item.name === input);
  if (!widget) return { value: fallback };
  const rawValues = typeof widget.options?.values === "function" ? widget.options.values() : widget.options?.values;
  const values = Array.isArray(rawValues) ? rawValues.filter((item) => ["string", "number"].includes(typeof item)) : [];
  return {
    value: widget.value ?? fallback,
    ...(values.length ? { options: values.map((item) => ({ label: String(item), value: item })) } : {}),
    ...(Number.isFinite(Number(widget.options?.min)) ? { min: Number(widget.options.min) } : {}),
    ...(Number.isFinite(Number(widget.options?.max)) ? { max: Number(widget.options.max) } : {}),
    ...(Number.isFinite(Number(widget.options?.step)) ? { step: Number(widget.options.step) } : {}),
  };
}

function showMappingToolbar(node) {
  if (!designMode || !designWorkflow) return;
  const toolbar = ensureMappingToolbar();
  const nodeId = apiNodeId(node);
  const apiNode = designWorkflow[nodeId];
  if (!apiNode) return;
  const mapped = new Map(activeMappings.map((item) => [item.nodeId + ":" + item.input, item]));
  const rows = Object.entries(apiNode.inputs || {}).filter(([, value]) => primitiveInput(value)).map(([name, value]) => {
    const item = mapped.get(nodeId + ":" + name);
    const suggested = mappingType(value, name);
    return '<button class="dxos-input' + (item ? ' mapped' : '') + '" data-input="' + encodeURIComponent(name) + '" data-kind="' + suggested + '"><span>' + html(name) + '</span><small>' + html(item ? item.label : '添加映射') + '</small></button>';
  }).join("");
  toolbar.innerHTML = '<div class="dxos-mapper-head"><div><strong>' + html(apiNode._meta?.title || apiNode.class_type) + '</strong><small>#' + html(nodeId) + ' · 节点参数映射</small></div><button class="dxos-output" data-output="1">设为输出</button></div>' + (rows || '<p style="color:rgba(255,255,255,.48)">此节点没有可映射的常量输入</p>');
  toolbar.style.display = "block";
  toolbar.querySelectorAll("button[data-input]").forEach((button) => button.addEventListener("click", () => {
    const input = decodeURIComponent(button.dataset.input || "");
    reply("dxos:workflow-map-request", { nodeId, input, ...widgetMetadata(node, input, apiNode.inputs[input]), suggestedType: button.dataset.kind, classType: apiNode.class_type, title: apiNode._meta?.title || apiNode.class_type });
  }));
  toolbar.querySelector("button[data-output]")?.addEventListener("click", () => {
    reply("dxos:workflow-output-request", { nodeId, classType: apiNode.class_type, title: apiNode._meta?.title || apiNode.class_type });
  });
  reply("dxos:workflow-node-selected", { nodeId, classType: apiNode.class_type, title: apiNode._meta?.title || apiNode.class_type });
}

function selectedCanvasNode() {
  const selected = app.canvas?.selected_nodes;
  if (!selected) return null;
  if (selected instanceof Map) return Array.from(selected.values())[0] || null;
  if (selected instanceof Set) {
    const first = Array.from(selected.values())[0];
    return typeof first === "object" ? first : app.graph?.getNodeById?.(first);
  }
  const first = Object.values(selected)[0];
  return typeof first === "object" ? first : app.graph?.getNodeById?.(first);
}

function watchSelectedNode() {
  window.clearInterval(selectionTimer);
  selectedNodeId = "";
  selectionTimer = window.setInterval(() => {
    if (!designMode) return;
    const node = selectedCanvasNode();
    const nodeId = apiNodeId(node);
    if (!node || !nodeId || nodeId === selectedNodeId) return;
    selectedNodeId = nodeId;
    showMappingToolbar(node);
  }, 120);
}

function layoutNodes(nodes, workflow) {
  const levels = new Map();
  function level(id, trail = new Set()) {
    if (levels.has(id)) return levels.get(id);
    if (trail.has(id)) return 0;
    trail.add(id);
    const deps = Object.values(workflow[id]?.inputs || {}).filter((value) => Array.isArray(value) && value.length === 2).map((value) => String(value[0]));
    const result = deps.length ? Math.max(...deps.map((dep) => level(dep, new Set(trail)))) + 1 : 0;
    levels.set(id, result);
    return result;
  }
  const rows = new Map();
  for (const [id, node] of nodes) {
    const column = level(id);
    const row = rows.get(column) || 0;
    rows.set(column, row + 1);
    node.pos = [80 + column * 310, 80 + row * 210];
  }
}

function focusDesignGraph(nodes) {
  const list = Array.from(nodes.values());
  if (!list.length || !app.canvas?.ds) return;
  const bounds = list.reduce((box, node) => {
    const width = Number(node.size?.[0]) || 240;
    const height = Number(node.size?.[1]) || 160;
    box.left = Math.min(box.left, Number(node.pos?.[0]) || 0);
    box.top = Math.min(box.top, Number(node.pos?.[1]) || 0);
    box.right = Math.max(box.right, (Number(node.pos?.[0]) || 0) + width);
    box.bottom = Math.max(box.bottom, (Number(node.pos?.[1]) || 0) + height);
    return box;
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const canvas = app.canvas.canvas || app.canvasEl;
  const viewportWidth = Math.max(320, Number(canvas?.clientWidth || canvas?.width) || window.innerWidth);
  const viewportHeight = Math.max(240, Number(canvas?.clientHeight || canvas?.height) || window.innerHeight);
  const graphWidth = Math.max(1, bounds.right - bounds.left);
  const graphHeight = Math.max(1, bounds.bottom - bounds.top);
  const scale = Math.max(0.12, Math.min(1, (viewportWidth - 80) / graphWidth, (viewportHeight - 100) / graphHeight));
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  app.canvas.ds.scale = scale;
  app.canvas.ds.offset[0] = viewportWidth / (2 * scale) - centerX;
  app.canvas.ds.offset[1] = viewportHeight / (2 * scale) - centerY;
  app.graph?.setDirtyCanvas?.(true, true);
  app.canvas?.setDirty?.(true, true);
}

async function loadDesignWorkflowOnce(message) {
  const workflow = message.workflow;
  if (!workflow || typeof workflow !== "object") throw new Error("工作流为空");
  const requiredTypes = [...new Set(Object.values(workflow).map((item) => item.class_type))];
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const unresolved = requiredTypes.filter((type) => !LiteGraph.registered_node_types?.[type]);
    if (!unresolved.length) break;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  designMode = true;
  designWorkflow = workflow;
  activeMappings = Array.isArray(message.mappings) ? message.mappings : [];
  ensureMappingToolbar().style.display = "none";
  watchSelectedNode();
  app.graph.clear();
  const nodes = new Map();
  const missing = [];
  for (const [id, apiNode] of Object.entries(workflow)) {
    const node = LiteGraph.createNode(apiNode.class_type);
    if (!node) { missing.push({ id, classType: apiNode.class_type }); continue; }
    node.properties = { ...(node.properties || {}), dxosApiNodeId: id };
    node.title = apiNode._meta?.title || node.title || apiNode.class_type;
    app.graph.add(node);
    nodes.set(id, node);
    for (const [name, value] of Object.entries(apiNode.inputs || {})) {
      if (!primitiveInput(value)) continue;
      const widget = node.widgets?.find((item) => item.name === name);
      if (widget) widget.value = value;
    }
    const originalSelected = node.onSelected;
    node.onSelected = function() {
      originalSelected?.apply(this, arguments);
      showMappingToolbar(this);
    };
  }
  for (const [targetId, apiNode] of Object.entries(workflow)) {
    const target = nodes.get(targetId);
    if (!target) continue;
    for (const [inputName, value] of Object.entries(apiNode.inputs || {})) {
      if (!Array.isArray(value) || value.length !== 2) continue;
      const source = nodes.get(String(value[0]));
      const targetSlot = target.inputs?.findIndex((input) => input.name === inputName) ?? -1;
      if (source && targetSlot >= 0) source.connect(Number(value[1]) || 0, target, targetSlot);
    }
  }
  layoutNodes(nodes, workflow);
  app.graph.setDirtyCanvas(true, true);
  app.canvas?.setDirty?.(true, true);
  if (nodes.size) {
    app.canvas?.selectNode?.(nodes.values().next().value, false);
    focusDesignGraph(nodes);
    window.requestAnimationFrame(() => focusDesignGraph(nodes));
    window.setTimeout(() => focusDesignGraph(nodes), 300);
    window.setTimeout(() => showMappingToolbar(selectedCanvasNode() || nodes.values().next().value), 0);
  }
  reply("dxos:workflow-loaded", { requestId: message.requestId, nodeCount: nodes.size, missing });
}

async function loadDesignWorkflow(message) {
  const requestId = String(message.requestId || "");
  if (loadingWorkflow || (requestId && requestId === lastWorkflowRequestId)) return;
  loadingWorkflow = true;
  lastWorkflowRequestId = requestId;
  reply("dxos:workflow-loading", { requestId });
  try {
    await loadDesignWorkflowOnce(message);
  } finally {
    loadingWorkflow = false;
  }
}

function updateDesignMappings(message) {
  activeMappings = Array.isArray(message.mappings) ? message.mappings : [];
  const selected = selectedCanvasNode();
  if (selected) showMappingToolbar(selected);
  app.graph?.setDirtyCanvas?.(true, true);
}

function importDesignParameter(message) {
  const node = (app.graph?._nodes || []).find((item) => apiNodeId(item) === String(message.nodeId));
  const apiNode = designWorkflow?.[String(message.nodeId)];
  if (!node || !apiNode) throw new Error("当前画布中找不到该节点");
  const input = String(message.input || "");
  reply("dxos:workflow-param-imported", {
    requestId: message.requestId,
    nodeId: String(message.nodeId),
    input,
    ...widgetMetadata(node, input, apiNode.inputs?.[input]),
  });
}

function exitDesignMode() {
  designMode = false;
  designWorkflow = null;
  activeMappings = [];
  selectedNodeId = "";
  window.clearInterval(selectionTimer);
  if (mappingToolbar) mappingToolbar.style.display = "none";
}

async function importImages(message) {
  const uploads = Array.isArray(message.uploads) ? message.uploads : [];
  if (!uploads.length) throw new Error("没有可导入的图片");
  const position = canvasPosition(Number(message.clientX) || 0, Number(message.clientY) || 0);
  const target = targetLoadImage(position);
  const nodes = uploads.map((upload, index) => index === 0 && target
    ? setLoadImage(target, upload)
    : addLoadImage(upload, position, index));
  if (nodes[0]) app.canvas?.selectNode?.(nodes[0], false);
  app.graph?.setDirtyCanvas?.(true, true);
  app.canvas?.setDirty?.(true, true);
  reply("dxos:comfy-imported", { requestId: message.requestId, count: nodes.length, updated: !!target });
}

app.registerExtension({
  name: "DXOS.Bridge",
  setup() {
    if (!allowedOrigin || !bridgeToken || window.parent === window) return;
    window.addEventListener("message", (event) => {
      if (event.origin !== allowedOrigin || event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.token !== bridgeToken) return;
      if (message.type === "dxos:bridge-ping") {
        reply("dxos:comfy-ready", { version: BRIDGE_VERSION });
        return;
      }
      const task = message.type === "dxos:comfy-import" ? importImages(message)
        : message.type === "dxos:workflow-load" ? loadDesignWorkflow(message)
        : message.type === "dxos:workflow-mappings" ? Promise.resolve(updateDesignMappings(message))
        : message.type === "dxos:workflow-param-import" ? Promise.resolve(importDesignParameter(message))
        : message.type === "dxos:workflow-exit" ? Promise.resolve(exitDesignMode())
        : null;
      if (!task) return;
      task.catch((error) => {
        reply("dxos:comfy-import-error", {
          requestId: message.requestId,
          error: String(error?.message || error),
        });
      });
    });
    reply("dxos:comfy-ready", { version: BRIDGE_VERSION });
  },
});
`

function writeIfChanged(path: string, content: string) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false
  writeFileSync(path, content, 'utf8')
  return true
}

export function installComfyBridge(rootDir: string) {
  const bridgeDir = join(rootDir, 'ComfyUI', 'custom_nodes', 'dx_os_bridge')
  return installComfyBridgeAt(bridgeDir)
}

/** Install beside the main.py that the configured instance actually launches. */
export function installComfyBridgeForMainPath(mainPath: string) {
  const bridgeDir = join(dirname(mainPath), 'custom_nodes', 'dx_os_bridge')
  return installComfyBridgeAt(bridgeDir)
}

function installComfyBridgeAt(bridgeDir: string) {
  const webDir = join(bridgeDir, 'web')
  mkdirSync(webDir, { recursive: true })
  const initChanged = writeIfChanged(join(bridgeDir, '__init__.py'), INIT_PY)
  const scriptChanged = writeIfChanged(join(webDir, 'dx-os-bridge.js'), BRIDGE_JS)
  return { path: bridgeDir, changed: initChanged || scriptChanged }
}
