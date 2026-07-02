import { Bot, ImageIcon, ImagePlus, MonitorUp, Split, TextCursorInput, type LucideIcon } from "lucide-react";
import { createDefaultActionFissionState } from "../action-fission/actionFissionState";
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
    init: (node) => ({ ...node, text: "", imageGenerationApiType: "third-party-api", imageMode: "imageGenerator", imageSource: "generated" }),
  },
  libtvImageGenerator: {
    type: "libtvImageGenerator",
    label: "LibTV Image Generator",
    icon: MonitorUp,
    defaultSize: NODE_DEFAULTS.libtvImageGenerator,
    init: (node) => ({
      ...node,
      imageMode: "imageGenerator",
      imageSource: "generated",
      libtvImageGeneration: {
        aspectRatio: "1:1",
        quality: "2K",
        prompt: "",
      },
    }),
  },
  imageLoader: {
    type: "imageLoader",
    label: "Image Loader",
    icon: ImageIcon,
    defaultSize: NODE_DEFAULTS.imageLoader,
    init: (node) => ({ ...node, text: "", imageMode: "asset", imageSource: "uploaded" }),
  },
  prompt: {
    type: "prompt",
    label: "Prompt",
    icon: TextCursorInput,
    defaultSize: NODE_DEFAULTS.prompt,
    init: (node) => ({ ...node, text: "" }),
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
  actionFission: {
    type: "actionFission",
    label: "Action Fission",
    icon: Split,
    defaultSize: NODE_DEFAULTS.actionFission,
    init: (node) => ({
      ...node,
      title: "Action Fission",
      actionFission: createDefaultActionFissionState(),
    }),
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
