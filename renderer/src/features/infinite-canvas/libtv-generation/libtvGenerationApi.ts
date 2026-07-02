import type { LibtvBatchGenerationResult, LibtvImageGenerationResult } from "../../../app/appConfig";

function libtvApi() {
  if (!window.libtv) throw new Error("LibTV bridge is unavailable.");
  return window.libtv;
}

export async function listLibtvWorkspaces() {
  return libtvApi().workspaces({ page: 1, pageSize: 100 });
}

export async function listLibtvProjects(workspaceId: string) {
  return libtvApi().projects({ workspaceId, page: 1, pageSize: 100 });
}

export async function listLibtvImageModels() {
  return libtvApi().imageModels();
}

export async function generateLibtvImage(payload: {
  workspaceId?: string;
  projectUuid?: string;
  prompt: string;
  modelName: string;
  aspectRatio?: string;
  quality?: string;
  referenceImages?: string[];
  nodeTitle?: string;
  x?: number;
  y?: number;
}): Promise<LibtvImageGenerationResult> {
  return libtvApi().generateImage(payload);
}

export async function generateLibtvBatch(payload: {
  workspaceId?: string;
  projectUuid?: string;
  modelName?: string;
  aspectRatio?: string;
  quality?: string;
  groupTitle?: string;
  jobs: Array<{
    id?: string;
    localTargetId?: string;
    prompt: string;
    modelName?: string;
    aspectRatio?: string;
    quality?: string;
    referenceImages?: string[];
    nodeTitle?: string;
    x?: number;
    y?: number;
  }>;
}): Promise<LibtvBatchGenerationResult> {
  return libtvApi().generateBatch(payload);
}
