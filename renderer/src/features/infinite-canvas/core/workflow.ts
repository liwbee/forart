import { fitImageNodeSize } from "../imageCrop";
import type { CanvasConnection, CanvasNode, OutputItem } from "../types";

export interface GeneratorRunPlan {
  image: CanvasNode;
  prompt: string;
  item: OutputItem;
  patch: Partial<CanvasNode>;
}

export function collectPrompt(node: CanvasNode, nodes: CanvasNode[], connections: CanvasConnection[]): string {
  if (node.type === "prompt") return node.text || "";
  if (node.type === "loop") {
    const variable = node.variablePrompt?.trim();
    const fixed = node.fixedPrompt?.trim();
    return [fixed, variable ? `Loop variable: ${variable}` : ""].filter(Boolean).join("\n");
  }
  if (node.type === "group") {
    return (node.items || [])
      .map((id) => nodes.find((candidate) => candidate.id === id))
      .filter(Boolean)
      .map((candidate) => collectPrompt(candidate as CanvasNode, nodes, connections))
      .filter(Boolean)
      .join("\n\n");
  }
  if (node.type === "output") {
    const generated = node.generated || [];
    return generated[generated.length - 1]?.prompt || "";
  }

  const upstream = connections
    .filter((connection) => connection.to === node.id)
    .map((connection) => nodes.find((candidate) => candidate.id === connection.from))
    .filter(Boolean) as CanvasNode[];

  return upstream
    .map((candidate) => collectPrompt(candidate, nodes, connections))
    .filter(Boolean)
    .join("\n\n");
}

export function createOutputItem(id: string, prompt: string, createdAt = Date.now()): OutputItem {
  return {
    id,
    title: `Result ${new Date(createdAt).toLocaleTimeString()}`,
    prompt,
    createdAt,
  };
}

function createGeneratedImageDataUrl(prompt: string, createdAt: number) {
  const safePrompt = prompt.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
  const lines = safePrompt.match(/.{1,38}(\s|$)/g)?.slice(0, 5).map((line) => line.trim()) || ["Generated image"];
  const text = lines
    .map((line, index) => `<text x="64" y="${190 + index * 30}" fill="#f8fafc" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700">${line}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="960" viewBox="0 0 768 960">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0f766e"/>
      <stop offset="0.54" stop-color="#334155"/>
      <stop offset="1" stop-color="#9333ea"/>
    </linearGradient>
    <radialGradient id="light" cx="0.35" cy="0.22" r="0.58">
      <stop offset="0" stop-color="#fbbf24" stop-opacity="0.78"/>
      <stop offset="1" stop-color="#fbbf24" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="768" height="960" fill="url(#bg)"/>
  <rect width="768" height="960" fill="url(#light)"/>
  <path d="M92 658 C206 512 286 558 366 436 C450 308 552 348 676 186 L676 868 L92 868 Z" fill="#020617" opacity="0.28"/>
  <circle cx="594" cy="214" r="78" fill="#f8fafc" opacity="0.18"/>
  <text x="64" y="118" fill="#f8fafc" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800">Generated preview</text>
  ${text}
  <text x="64" y="884" fill="#e2e8f0" font-family="Inter, Arial, sans-serif" font-size="18">${new Date(createdAt).toLocaleString()}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function planGeneratorRun(
  nodeId: string,
  nodes: CanvasNode[],
  connections: CanvasConnection[],
  nodeMap: Map<string, CanvasNode>,
  outputItemId: string,
  createdAt = Date.now(),
): GeneratorRunPlan | null {
  const image = nodeMap.get(nodeId);
  if (!image || image.type !== "image" || image.imageMode === "asset") return null;
  const prompt = [image.text || "", collectPrompt(image, nodes, connections)].filter(Boolean).join("\n\n").trim() || "No prompt provided";
  const url = createGeneratedImageDataUrl(prompt, createdAt);
  const nextSize = fitImageNodeSize(768, 960);

  return {
    image,
    prompt,
    item: createOutputItem(outputItemId, prompt, createdAt),
    patch: {
      url,
      fileName: "generated-image.svg",
      imageMode: "generator",
      imageSource: "generated",
      imageNaturalWidth: 768,
      imageNaturalHeight: 960,
      running: false,
      ...nextSize,
    },
  };
}
