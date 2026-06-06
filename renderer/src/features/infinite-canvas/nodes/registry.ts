import { Boxes, CircleDot, ImagePlus, Repeat2, TextCursorInput, type LucideIcon } from "lucide-react";
import { NODE_DEFAULTS } from "../constants";
import type { CanvasNode, CanvasNodeType } from "../types";

export interface CanvasNodeDefinition {
  type: CanvasNodeType;
  label: string;
  icon: LucideIcon;
  defaultSize: { w: number; h: number; title: string };
  init?: (node: CanvasNode) => CanvasNode;
}

export const NODE_DEFINITIONS: Record<CanvasNodeType, CanvasNodeDefinition> = {
  image: {
    type: "image",
    label: "Image",
    icon: ImagePlus,
    defaultSize: NODE_DEFAULTS.image,
    init: (node) => ({ ...node, text: "", imageMode: "generator" }),
  },
  prompt: {
    type: "prompt",
    label: "Prompt",
    icon: TextCursorInput,
    defaultSize: NODE_DEFAULTS.prompt,
    init: (node) => ({ ...node, text: "" }),
  },
  output: {
    type: "output",
    label: "Output",
    icon: CircleDot,
    defaultSize: NODE_DEFAULTS.output,
    init: (node) => ({ ...node, generated: [] }),
  },
  group: {
    type: "group",
    label: "Group",
    icon: Boxes,
    defaultSize: NODE_DEFAULTS.group,
    init: (node) => ({ ...node, items: [] }),
  },
  loop: {
    type: "loop",
    label: "Loop",
    icon: Repeat2,
    defaultSize: NODE_DEFAULTS.loop,
    init: (node) => ({
      ...node,
      count: 3,
      mode: "serial",
      fixedPrompt: "",
      variablePrompt: "",
    }),
  },
};

export const NODE_TYPE_ORDER: CanvasNodeType[] = ["image", "prompt", "output", "loop", "group"];

export function getNodeDefinition(type: CanvasNodeType) {
  return NODE_DEFINITIONS[type];
}

export function getNodeKindLabel(type: CanvasNodeType) {
  return getNodeDefinition(type).label;
}

export function createCanvasNode(type: CanvasNodeType, id: string): CanvasNode {
  const definition = getNodeDefinition(type);
  const node: CanvasNode = {
    id,
    type,
    x: 0,
    y: 0,
    w: definition.defaultSize.w,
    h: definition.defaultSize.h,
    title: definition.defaultSize.title,
  };
  return definition.init ? definition.init(node) : node;
}
