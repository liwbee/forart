import type { CanvasConnection, CanvasNode } from "../types";

export function collectPrompt(node: CanvasNode, nodes: CanvasNode[], connections: CanvasConnection[]): string {
  if (node.type === "prompt" || node.type === "libtvPrompt" || node.type === "llm" || node.type === "lovart") return node.text || "";
  if (node.type === "loop") {
    const variable = node.variablePrompt?.trim();
    const fixed = node.fixedPrompt?.trim();
    return [fixed, variable ? `Loop variable: ${variable}` : ""].filter(Boolean).join("\n");
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

export function collectUpstreamPrompt(node: CanvasNode, nodes: CanvasNode[], connections: CanvasConnection[]): string {
  return connections
    .filter((connection) => connection.to === node.id)
    .map((connection) => nodes.find((candidate) => candidate.id === connection.from))
    .filter(Boolean)
    .map((candidate) => collectPrompt(candidate as CanvasNode, nodes, connections))
    .filter(Boolean)
    .join("\n\n");
}

export function collectReferenceImages(node: CanvasNode, nodes: CanvasNode[], connections: CanvasConnection[]) {
  const results: string[] = [];
  const seenNodes = new Set<string>();
  const seenUrls = new Set<string>();

  function addUrl(url?: string) {
    const text = String(url || "").trim();
    if (!text || seenUrls.has(text)) return;
    seenUrls.add(text);
    results.push(text);
  }

  function visit(candidate: CanvasNode | undefined) {
    if (!candidate || seenNodes.has(candidate.id)) return;
    seenNodes.add(candidate.id);
    if ((candidate.type === "image" || candidate.type === "libtvUpload" || candidate.type === "imageGenerator" || candidate.type === "lovart" || candidate.type === "libtvImage") && candidate.url) addUrl(candidate.url);
    connections
      .filter((connection) => connection.to === candidate.id)
      .forEach((connection) => visit(nodes.find((item) => item.id === connection.from)));
  }

  connections
    .filter((connection) => connection.to === node.id)
    .forEach((connection) => visit(nodes.find((candidate) => candidate.id === connection.from)));

  return results;
}
