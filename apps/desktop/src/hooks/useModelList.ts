/**
 * useModelList
 *
 * Fetches the list of available model names for a given LLM profile.
 * Supports all provider types: anthropic, openai, google, openrouter,
 * openai_compatible (and any future providers handled by probe-models).
 *
 * Usage:
 *   const { models, isLoading, error } = useModelList(profileId);
 */

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

interface ProbeModelsResponse {
  models: string[];
  error?: string | null;
}

interface UseModelListResult {
  models: string[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch available models for the given LLM profile ID.
 * Returns an empty list when no profileId is provided.
 */
export function useModelList(profileId: string | null | undefined): UseModelListResult {
  const { data, isLoading } = useQuery<ProbeModelsResponse>({
    queryKey: ["model-list", profileId],
    queryFn: async () => {
      const params = new URLSearchParams({ llm_profile_id: profileId! });
      return apiFetch<ProbeModelsResponse>(
        `/settings/model-catalog/probe-models?${params.toString()}`
      );
    },
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000, // 5 min – don't hammer the upstream APIs
    retry: false,
  });

  return {
    models: data?.models ?? [],
    isLoading: !!profileId && isLoading,
    error: data?.error ?? null,
  };
}
