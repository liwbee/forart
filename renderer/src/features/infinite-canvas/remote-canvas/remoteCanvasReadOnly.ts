export interface CanvasCapabilities {
  canEdit: boolean;
  canSave: boolean;
  canGenerate: boolean;
  canImport: boolean;
  canPasteOrDrop: boolean;
  canDelete: boolean;
}

export const editableCanvasCapabilities: CanvasCapabilities = {
  canEdit: true,
  canSave: true,
  canGenerate: true,
  canImport: true,
  canPasteOrDrop: true,
  canDelete: true,
};

export const readOnlyCanvasCapabilities: CanvasCapabilities = {
  canEdit: false,
  canSave: false,
  canGenerate: false,
  canImport: false,
  canPasteOrDrop: false,
  canDelete: false,
};

export function assertCanvasEditable(capabilities: CanvasCapabilities) {
  return capabilities.canEdit;
}

