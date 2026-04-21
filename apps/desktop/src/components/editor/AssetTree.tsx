import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Plus, Search, Trash2, File } from "lucide-react";
import type { Asset, AssetType, AssetWithContent, CreateAssetRequest } from "@trpg-workbench/shared-schema";
import { useEditorStore } from "@/stores/editorStore";
import { apiFetch } from "@/lib/api";

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  outline: "大纲",
  stage: "场景",
  npc: "NPC",
  monster: "怪物",
  location: "地点",
  clue: "线索",
  branch: "分支",
  timeline: "时间线",
  map_brief: "地图简报",
  lore_note: "世界设定",
};

const ALL_TYPES: AssetType[] = Object.keys(ASSET_TYPE_LABELS) as AssetType[];

const STATUS_COLORS: Record<string, string> = {
  draft: "#888",
  review: "#f0a500",
  final: "#52c97e",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\u4e00-\u9fff]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface NewAssetFormProps {
  workspaceId: string;
  onClose: () => void;
}

function NewAssetForm({ workspaceId, onClose }: NewAssetFormProps) {
  const qc = useQueryClient();
  const [type, setType] = useState<AssetType>("npc");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const openTab = useEditorStore((s) => s.openTab);

  const mutation = useMutation({
    mutationFn: async (body: CreateAssetRequest) => {
      return apiFetch<AssetWithContent>(`/workspaces/${workspaceId}/assets`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (asset) => {
      qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
      openTab(asset);
      onClose();
    },
  });

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  return (
    <div style={{
      padding: "12px",
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      margin: "8px",
    }}>
      <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>新建资产</div>

      <select
        value={type}
        onChange={(e) => setType(e.target.value as AssetType)}
        style={inputStyle}
      >
        {ALL_TYPES.map((t) => (
          <option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>
        ))}
      </select>

      <input
        placeholder="名称"
        value={name}
        onChange={(e) => handleNameChange(e.target.value)}
        style={{ ...inputStyle, marginTop: 6 }}
      />

      <input
        placeholder="slug (英文)"
        value={slug}
        onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }}
        style={{ ...inputStyle, marginTop: 6 }}
      />

      {mutation.error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>
          {(mutation.error as Error).message}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          onClick={() => mutation.mutate({ type, name, slug })}
          disabled={!name || !slug || mutation.isPending}
          style={btnPrimaryStyle}
        >
          {mutation.isPending ? "创建中..." : "创建"}
        </button>
        <button onClick={onClose} style={btnSecondaryStyle}>取消</button>
      </div>
    </div>
  );
}

export function AssetTree({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showNewForm, setShowNewForm] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; asset: Asset } | null>(null);
  const openTab = useEditorStore((s) => s.openTab);

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["assets", workspaceId],
    queryFn: () => apiFetch<Asset[]>(`/workspaces/${workspaceId}/assets`),
  });

  const deleteMutation = useMutation({
    mutationFn: async (assetId: string) => {
      await apiFetch(`/assets/${assetId}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets", workspaceId] }),
  });

  const filtered = assets.filter(
    (a) => a.status !== "deleted" && a.name.toLowerCase().includes(search.toLowerCase())
  );

  const byType = ALL_TYPES.reduce<Record<string, Asset[]>>((acc, t) => {
    const items = filtered.filter((a) => a.type === t);
    if (items.length > 0) acc[t] = items;
    return acc;
  }, {});

  const toggleCollapse = (type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const openAsset = async (asset: Asset) => {
    const full = await apiFetch<AssetWithContent>(`/assets/${asset.id}`);
    openTab(full);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px 8px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>资产</span>
        <button
          onClick={() => setShowNewForm((v) => !v)}
          title="新建资产"
          style={{ background: "none", color: "var(--text-muted)", padding: 2, borderRadius: 4 }}
        >
          <Plus size={15} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", borderRadius: 4, padding: "4px 8px" }}>
          <Search size={12} color="var(--text-muted)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索资产..."
            style={{ background: "none", border: "none", color: "var(--text)", fontSize: 12, flex: 1 }}
          />
        </div>
      </div>

      {/* New asset form */}
      {showNewForm && (
        <NewAssetForm workspaceId={workspaceId} onClose={() => setShowNewForm(false)} />
      )}

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {Object.entries(byType).map(([type, items]) => (
          <div key={type}>
            <button
              onClick={() => toggleCollapse(type)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                width: "100%",
                padding: "4px 12px",
                background: "none",
                color: "var(--text-muted)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {collapsed.has(type) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {ASSET_TYPE_LABELS[type as AssetType]}
              <span style={{ marginLeft: "auto" }}>{items.length}</span>
            </button>

            {!collapsed.has(type) && items.map((asset) => (
              <div
                key={asset.id}
                onClick={() => openAsset(asset)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, asset });
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px 5px 24px",
                  cursor: "pointer",
                  borderRadius: 4,
                  margin: "1px 4px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                <File size={12} color="var(--text-muted)" />
                <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {asset.name}
                </span>
                <span
                  style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: STATUS_COLORS[asset.status] ?? "#888",
                    flexShrink: 0,
                  }}
                  title={asset.status}
                />
              </div>
            ))}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: "12px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
            {search ? "无匹配资产" : "暂无资产，点击 + 新建"}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
            onClick={() => setContextMenu(null)}
          />
          <div style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 100,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 0",
            minWidth: 140,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}>
            <button
              onClick={() => {
                if (confirm(`删除资产「${contextMenu.asset.name}」？`)) {
                  deleteMutation.mutate(contextMenu.asset.id);
                }
                setContextMenu(null);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "6px 12px",
                background: "none", color: "var(--danger)", fontSize: 13,
              }}
            >
              <Trash2 size={13} /> 删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  fontSize: 13,
};

const btnPrimaryStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 10px",
  background: "var(--accent)",
  color: "#fff",
  borderRadius: 4,
  fontSize: 13,
  cursor: "pointer",
};

const btnSecondaryStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 10px",
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: 4,
  fontSize: 13,
  cursor: "pointer",
};
