import { Bot, ImageIcon, ImagePlus, Repeat2, Tv, TextCursorInput, type LucideIcon } from "lucide-react";
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
  imageGenerator: {
    type: "imageGenerator",
    label: "Image Generation",
    icon: ImagePlus,
    defaultSize: NODE_DEFAULTS.imageGenerator,
    init: (node) => ({ ...node, text: "", imageMode: "imageGenerator", imageSource: "generated" }),
  },
  image: {
    type: "image",
    label: "Image",
    icon: ImageIcon,
    defaultSize: NODE_DEFAULTS.image,
    init: (node) => ({ ...node, text: "", imageMode: "asset", imageSource: "uploaded" }),
  },
  prompt: {
    type: "prompt",
    label: "Prompt",
    icon: TextCursorInput,
    defaultSize: NODE_DEFAULTS.prompt,
    init: (node) => ({ ...node, text: "" }),
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
  llm: {
    type: "llm",
    label: "LLM Model",
    icon: Bot,
    defaultSize: NODE_DEFAULTS.llm,
    init: (node) => ({
      ...node,
      text: "",
      generationError: "",
      generationStatus: "",
    }),
  },
  libtvImage: {
    type: "libtvImage",
    label: "LibTV Image",
    icon: Tv,
    defaultSize: NODE_DEFAULTS.libtvImage,
    init: (node) => ({
      ...node,
      text: "",
      libtvModel: "",
      libtvModelName: "",
      libtvResolution: "1k",
      libtvAspectRatio: "1:1",
      generationError: "",
      generationStatus: "",
      imageSource: "generated",
    }),
  },
  libtvPrompt: {
    type: "libtvPrompt",
    label: "LibTV Prompt",
    icon: TextCursorInput,
    defaultSize: NODE_DEFAULTS.libtvPrompt,
    init: (node) => ({ ...node, text: "" }),
  },
  libtvUpload: {
    type: "libtvUpload",
    label: "LibTV Upload",
    icon: ImageIcon,
    defaultSize: NODE_DEFAULTS.libtvUpload,
    init: (node) => ({ ...node, text: "", imageMode: "asset", imageSource: "uploaded" }),
  },
};

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
