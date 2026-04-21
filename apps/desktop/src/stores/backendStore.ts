import { create } from "zustand";

export type BackendStatus = "starting" | "ready" | "failed" | "disconnected";

interface BackendState {
  status: BackendStatus;
  error: string | null;
  setStatus: (status: BackendStatus, error?: string | null) => void;
}

export const useBackendStore = create<BackendState>((set) => ({
  status: "starting",
  error: null,
  setStatus: (status, error = null) => set({ status, error }),
}));
