import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelProfile } from "@trpg-workbench/shared-schema";

interface SettingsState {
  modelProfiles: ModelProfile[];
  setModelProfiles: (profiles: ModelProfile[]) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      modelProfiles: [],
      setModelProfiles: (profiles) => set({ modelProfiles: profiles }),
    }),
    { name: "trpg-settings" }
  )
);
