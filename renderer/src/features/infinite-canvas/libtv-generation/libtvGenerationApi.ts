import type { LibtvBatchGenerationResult, LibtvImageGenerationResult } from "../../../app/appConfig";

function libtvApi() {
  if (!window.libtv) throw new Error("LibTV bridge is unavailable.");
  return window.libtv;
}

export async function getLibtvAvailability() {
  if (!window.libtv?.status || !window.libtv.account) {
    return { ready: false, available: false, loggedIn: false, error: "LibTV bridge is unavailable." };
  }
  const status = await window.libtv.status();
  if (!status.available) {
    return { ready: false, available: false, loggedIn: false, error: status.error || "LibTV CLI is unavailable." };
  }
  const account = await window.libtv.account();
  return {
    ready: Boolean(account.loggedIn),
    available: true,
    loggedIn: Boolean(account.loggedIn),
    error: account.loggedIn ? "" : account.error || "LibTV is not logged in.",
  };
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
