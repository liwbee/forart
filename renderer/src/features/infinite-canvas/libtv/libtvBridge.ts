import type { LibtvGeneratePayload } from "../../../app/appConfig";

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function getLibtvBridge() {
  return typeof window === "undefined" ? undefined : window.libtv;
}

export function hasLibtvUpdateNode() {
  return Boolean(getLibtvBridge()?.updateNode);
}

export async function updateLibtvNode(payload: LibtvGeneratePayload, bridgeUnavailableText = "LibTV bridge is not available.") {
  const bridge = getLibtvBridge();
  if (!bridge?.updateNode) {
    throw new Error(bridgeUnavailableText);
  }
  return bridge.updateNode(payload);
}
