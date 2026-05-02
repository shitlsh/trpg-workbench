/**
 * useAssetRelations — fetches and builds asset cross-reference maps.
 *
 * Returns:
 *   outgoing(slug): slugs that the given asset references
 *   incoming(slug): slugs of assets that reference the given asset
 *
 * Data sources:
 *   1. GET /workspaces/{id}/assets/relations (frontmatter fields)
 *   2. [[slug]] wikilinks found in currently-open asset's content_md
 */
import { useQuery } from "@tanstack/react-query";
import type { Asset, AssetRelationsMap } from "@trpg-workbench/shared-schema";
import { apiFetch } from "@/lib/api";
import { extractWikilinks } from "@/lib/wikilinks";

interface AssetRef {
  slug: string;
  name: string;
  type: string;
  id: string;
}

interface UseAssetRelationsResult {
  outgoing: AssetRef[];
  incoming: AssetRef[];
  isLoading: boolean;
}

export function useAssetRelations(
  workspaceId: string | null | undefined,
  currentSlug: string | null | undefined,
  allAssets: Asset[],
  /** content_md of the currently-open asset, used to extract [[wikilinks]] */
  contentMd?: string,
): UseAssetRelationsResult {
  const { data, isLoading } = useQuery<AssetRelationsMap>({
    queryKey: ["asset-relations", workspaceId],
    queryFn: () => apiFetch<AssetRelationsMap>(`/workspaces/${workspaceId}/assets/relations`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  if (!data || !currentSlug) {
    return { outgoing: [], incoming: [], isLoading };
  }

  const relations = data.relations;

  // Build a slug → Asset lookup
  const slugToAsset = new Map<string, Asset>();
  for (const asset of allAssets) {
    slugToAsset.set(asset.slug, asset);
  }

  const toRef = (slug: string): AssetRef | null => {
    const asset = slugToAsset.get(slug);
    if (!asset) return null;
    return { slug: asset.slug, name: asset.name, type: asset.type, id: asset.id };
  };

  // Outgoing: frontmatter refs + [[wikilinks]] from content_md
  const outgoingSlugs = new Set<string>(relations[currentSlug] ?? []);
  if (contentMd) {
    for (const slug of extractWikilinks(contentMd)) {
      outgoingSlugs.add(slug);
    }
  }

  const outgoing: AssetRef[] = Array.from(outgoingSlugs)
    .map(toRef)
    .filter((r): r is AssetRef => r !== null);

  // Incoming: assets whose outgoing list includes currentSlug
  const incoming: AssetRef[] = [];
  for (const [slug, refs] of Object.entries(relations)) {
    if (slug !== currentSlug && refs.includes(currentSlug)) {
      const ref = toRef(slug);
      if (ref) incoming.push(ref);
    }
  }

  return { outgoing, incoming, isLoading };
}
