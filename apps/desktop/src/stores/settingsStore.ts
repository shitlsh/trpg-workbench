import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LLMProfile, EmbeddingProfile } from "@trpg-workbench/shared-schema";

interface SettingsState {
  llmProfiles: LLMProfile[];
  embeddingProfiles: EmbeddingProfile[];
  hasCompletedSetup: boolean;
  setLLMProfiles: (profiles: LLMProfile[]) => void;
  setEmbeddingProfiles: (profiles: EmbeddingProfile[]) => void;
  completeSetup: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      llmProfiles: [],
      embeddingProfiles: [],
      hasCompletedSetup: false,
      setLLMProfiles: (profiles) => set({ llmProfiles: profiles }),
      setEmbeddingProfiles: (profiles) => set({ embeddingProfiles: profiles }),
      completeSetup: () => set({ hasCompletedSetup: true }),
    }),
    { name: "trpg-settings" }
  )
);
