import { useQuery } from "@tanstack/react-query";
import type { CustomAssetTypeConfig } from "@trpg-workbench/shared-schema";
import { apiFetch } from "@/lib/api";

export function useCustomAssetTypes(ruleSetId: string | null | undefined) {
  return useQuery<CustomAssetTypeConfig[]>({
    queryKey: ["custom-asset-types", ruleSetId],
    queryFn: () =>
      apiFetch<CustomAssetTypeConfig[]>(
        `/rule-sets/${ruleSetId}/asset-type-configs`,
      ),
    enabled: !!ruleSetId,
    staleTime: 1000 * 60 * 5, // 5 min cache — changes are infrequent
  });
}
