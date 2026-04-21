import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LLMProfile, EmbeddingProfile } from "@trpg-workbench/shared-schema";

interface SettingsState {
  llmProfiles: LLMProfile[];
  embeddingProfiles: EmbeddingProfile[];
  setLLMProfiles: (profiles: LLMProfile[]) => void;
  setEmbeddingProfiles: (profiles: EmbeddingProfile[]) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      llmProfiles: [],
      embeddingProfiles: [],
      setLLMProfiles: (profiles) => set({ llmProfiles: profiles }),
      setEmbeddingProfiles: (profiles) => set({ embeddingProfiles: profiles }),
    }),
    { name: "trpg-settings" }
  )
);
