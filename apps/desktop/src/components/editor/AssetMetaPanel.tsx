import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AssetWithContent, AssetStatus } from "@trpg-workbench/shared-schema";
import { useEditorStore } from "@/stores/editorStore";
import { apiFetch } from "@/lib/api";

const STATUS_OPTIONS: { value: AssetStatus; label: string; color: string }[] = [
  { value: "draft", label: "草稿", color: "#888" },
  { value: "review", label: "审查中", color: "#f0a500" },
  { value: "final", label: "定稿", color: "#52c97e" },
];

export function AssetMetaPanel() {
  const qc = useQueryClient();
  const { tabs, activeTabId, markSaved } = useEditorStore();
  const tab = tabs.find((t) => t.assetId === activeTabId);

  const statusMutation = useMutation({
    mutationFn: async (status: AssetStatus) => {
      return apiFetch<AssetWithContent>(`/assets/${tab!.assetId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: (updated) => {
      markSaved(tab!.assetId, updated);
      qc.invalidateQueries({ queryKey: ["assets"] });
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
    </div>
  );
}

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
