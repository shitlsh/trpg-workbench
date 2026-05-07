/**
 * useModelList
 *
 * Fetches the list of available model names for a saved profile.
 * Supports llm, embedding, and rerank profile types.
 *
 * Usage:
 *   const { models, isLoading, error } = useModelList({ llmProfileId: id });
 *   const { models, isLoading, error } = useModelList({ embeddingProfileId: id });
 *   const { models, isLoading, error } = useModelList({ rerankProfileId: id });
 */

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

interface ProbeModelsResponse {
  models: string[];
  error?: string | null;
}

interface UseModelListOptions {
  llmProfileId?: string | null;
  embeddingProfileId?: string | null;
  rerankProfileId?: string | null;
}

interface UseModelListResult {
  models: string[];
  isLoading: boolean;
  error: string | null;
}

function buildQueryKey(opts: UseModelListOptions): unknown[] {
  if (opts.llmProfileId) return ["model-list", "llm", opts.llmProfileId];
  if (opts.embeddingProfileId) return ["model-list", "embedding", opts.embeddingProfileId];
  if (opts.rerankProfileId) return ["model-list", "rerank", opts.rerankProfileId];
  return ["model-list", null];
}

function buildQueryParams(opts: UseModelListOptions): string {
  const params = new URLSearchParams();
  if (opts.llmProfileId) params.set("llm_profile_id", opts.llmProfileId);
  if (opts.embeddingProfileId) params.set("embedding_profile_id", opts.embeddingProfileId);
  if (opts.rerankProfileId) params.set("rerank_profile_id", opts.rerankProfileId);
  return params.toString();
}

function isEnabled(opts: UseModelListOptions): boolean {
  return !!(opts.llmProfileId || opts.embeddingProfileId || opts.rerankProfileId);
}

export function useModelList(opts: UseModelListOptions | string | null | undefined): UseModelListResult {
  // Support legacy string call: useModelList(profileId) → treated as llmProfileId
  const normalized: UseModelListOptions =
    typeof opts === "string" ? { llmProfileId: opts }
    : opts == null ? {}
    : opts;

  const enabled = isEnabled(normalized);
  const queryKey = buildQueryKey(normalized);
  const queryParams = buildQueryParams(normalized);

  const { data, isLoading } = useQuery<ProbeModelsResponse>({
    queryKey,
    queryFn: async () =>
      apiFetch<ProbeModelsResponse>(
        `/settings/model-catalog/probe-models?${queryParams}`
      ),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: false,
  });

  return {
    models: data?.models ?? [],
    isLoading: enabled && isLoading,
    error: data?.error ?? null,
  };
}
