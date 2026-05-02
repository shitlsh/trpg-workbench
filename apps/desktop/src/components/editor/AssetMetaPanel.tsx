import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Asset, AssetWithContent, AssetStatus, CustomAssetTypeConfig } from "@trpg-workbench/shared-schema";
import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { apiFetch } from "@/lib/api";
import { useAssetRelations } from "@/hooks/useAssetRelations";
import { getAssetTypeIcon, getAssetTypeColor, getAssetTypeLabel, getCustomTypeEmoji } from "@/lib/assetTypeVisual";
import { useCustomAssetTypes } from "@/hooks/useCustomAssetTypes";

const STATUS_OPTIONS: { value: AssetStatus; label: string; color: string }[] = [
  { value: "draft", label: "草稿", color: "#888" },
  { value: "review", label: "审查中", color: "#f0a500" },
  { value: "final", label: "定稿", color: "#52c97e" },
];

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function AssetMetaPanel() {
  const qc = useQueryClient();
  const { tabs, activeTabId, markSaved } = useEditorStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const tab = tabs.find((t) => t.assetId === activeTabId);

  // Fetch workspace config to get ruleSetId for custom type labels
  const { data: workspaceConfig } = useQuery({
    queryKey: ["workspace", activeWorkspaceId, "config"],
    queryFn: () => apiFetch<{ rule_set?: string }>(`/workspaces/${activeWorkspaceId}/config`),
    enabled: !!activeWorkspaceId,
  });
  const { data: ruleSets = [] } = useQuery<{ id: string; name: string; slug: string }[]>({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch("/rule-sets"),
    enabled: !!activeWorkspaceId,
  });
  const ruleSet = ruleSets.find(
    (rs) => rs.name === workspaceConfig?.rule_set || rs.slug === workspaceConfig?.rule_set
  );
  const { data: customConfigs = [] } = useCustomAssetTypes(ruleSet?.id ?? null);

  // All assets for relation label lookup (already cached by AssetTree)
  const { data: allAssets = [] } = useQuery<Asset[]>({
    queryKey: ["assets", activeWorkspaceId],
    queryFn: () => apiFetch<Asset[]>(`/workspaces/${activeWorkspaceId}/assets`),
    enabled: !!activeWorkspaceId,
  });

  const { outgoing, incoming } = useAssetRelations(
    activeWorkspaceId,
    tab?.asset.slug ?? null,
    allAssets,
  );

  const statusMutation = useMutation({
    mutationFn: async (status: AssetStatus) => {
      return apiFetch<AssetWithContent>(`/assets/${tab!.assetId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: (updated) => {
      markSaved(tab!.assetId, updated);
      qc.invalidateQueries({ queryKey: ["assets", activeWorkspaceId] });
      qc.invalidateQueries({ queryKey: ["asset-relations", activeWorkspaceId] });
    },
  });

  if (!tab) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-muted)", fontSize: 12, padding: 16, textAlign: "center",
      }}>
        选中资产后在此查看元信息
      </div>
    );
  }

  const asset = tab.asset;
  const hasRelations = outgoing.length > 0 || incoming.length > 0;

  return (
    <div style={{ padding: 16, overflowY: "auto" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{asset.name}</div>

      <Field label="类型" value={asset.type} />
      <Field label="Slug" value={asset.slug} mono />
      <Field label="路径" value={asset.path} mono small />

      {/* Status selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>状态</div>
        <div style={{ display: "flex", gap: 6 }}>
          {STATUS_OPTIONS.map(({ value, label, color }) => (
            <button
              key={value}
              onClick={() => statusMutation.mutate(value)}
              style={{
                padding: "3px 10px", borderRadius: 4, fontSize: 12,
                background: asset.status === value ? color + "33" : "var(--bg)",
                border: `1px solid ${asset.status === value ? color : "var(--border)"}`,
                color: asset.status === value ? color : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {asset.summary && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>摘要</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>{asset.summary}</div>
        </div>
      )}

      <Field label="当前版本" value={`v${asset.version}`} />
      <Field label="创建时间" value={new Date(asset.created_at).toLocaleString("zh-CN")} small />
      <Field label="最后更新" value={new Date(asset.updated_at).toLocaleString("zh-CN")} small />

      {/* Related assets */}
      {hasRelations && (
        <RelationsSection
          outgoing={outgoing}
          incoming={incoming}
          customConfigs={customConfigs}
          onOpenAsset={(id) => {
            apiFetch<AssetWithContent>(`/assets/${id}`).then((full) => {
              useEditorStore.getState().openTab(full);
            });
          }}
        />
      )}
    </div>
  );
}

// ─── Relations Section ────────────────────────────────────────────────────────

interface AssetRef { slug: string; name: string; type: string; id: string; }

function RelationsSection({
  outgoing, incoming, customConfigs, onOpenAsset,
}: {
  outgoing: AssetRef[];
  incoming: AssetRef[];
  customConfigs: CustomAssetTypeConfig[];
  onOpenAsset: (id: string) => void;
}) {
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
        关联资产
      </div>

      {outgoing.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "var(--text-subtle)", marginBottom: 4 }}>引用了</div>
          {outgoing.map((ref) => (
            <AssetRefRow key={ref.id} ref_={ref} customConfigs={customConfigs} onClick={() => onOpenAsset(ref.id)} />
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-subtle)", marginBottom: 4 }}>被引用</div>
          {incoming.map((ref) => (
            <AssetRefRow key={ref.id} ref_={ref} customConfigs={customConfigs} onClick={() => onOpenAsset(ref.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetRefRow({
  ref_, customConfigs, onClick,
}: {
  ref_: AssetRef;
  customConfigs: CustomAssetTypeConfig[];
  onClick: () => void;
}) {
  const emoji = getCustomTypeEmoji(ref_.type, customConfigs);
  const Icon = getAssetTypeIcon(ref_.type);
  const color = getAssetTypeColor(ref_.type);
  const typeLabel = getAssetTypeLabel(ref_.type, customConfigs);

  return (
    <button
      onClick={onClick}
      title={`${typeLabel}：${ref_.name}`}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        width: "100%", padding: "4px 6px", marginBottom: 2,
        background: "none", borderRadius: 4, cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {emoji
        ? <span style={{ fontSize: 12, color }}>{emoji}</span>
        : <Icon size={12} color={color} />
      }
      <span style={{
        fontSize: 12, color: "var(--text)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {ref_.name}
      </span>
    </button>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({ label, value, mono = false, small = false }: {
  label: string; value: string | number; mono?: boolean; small?: boolean;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: small ? 11 : 13,
        fontFamily: mono ? "monospace" : undefined,
        color: "var(--text)",
        wordBreak: "break-all",
      }}>{value}</div>
    </div>
  );
}

