import { create } from "zustand";

interface ServerLoginDialogRequest {
  serverUrl?: string;
  username?: string;
}

interface ServerLoginDialogState {
  open: boolean;
  request: ServerLoginDialogRequest;
  openDialog: (request?: ServerLoginDialogRequest) => void;
  closeDialog: () => void;
}

export const useServerLoginDialogStore = create<ServerLoginDialogState>((set) => ({
  open: false,
  request: {},
  openDialog: (request = {}) => set({ open: true, request }),
  closeDialog: () => set({ open: false }),
}));

export function openServerLoginDialog(request?: ServerLoginDialogRequest) {
  useServerLoginDialogStore.getState().openDialog(request);
}
