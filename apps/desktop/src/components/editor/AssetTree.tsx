import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import type { Asset, AssetWithContent, CreateAssetRequest, CustomAssetTypeConfig } from "@trpg-workbench/shared-schema";
import { useEditorStore } from "@/stores/editorStore";
import { apiFetch } from "@/lib/api";
import { useCustomAssetTypes } from "@/hooks/useCustomAssetTypes";
import {
  getAssetTypeIcon,
  getCustomTypeEmoji,
  getAssetTypeColor,
  getAssetTypeLabel,
  ALL_ASSET_TYPES,
} from "@/lib/assetTypeVisual";

const STATUS_COLORS: Record<string, string> = {
  draft:  "#888",
  review: "#f0a500",
  final:  "#52c97e",
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
  customConfigs: CustomAssetTypeConfig[];
  onClose: () => void;
}

function NewAssetForm({ workspaceId, customConfigs, onClose }: NewAssetFormProps) {
  const qc = useQueryClient();
  const [type, setType] = useState<string>("npc");
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

  const emoji = getCustomTypeEmoji(type, customConfigs);
  const TypeIcon = getAssetTypeIcon(type);

  return (
    <div style={{
      padding: "12px",
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      margin: "8px",
    }}>
      <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>新建资产</div>

      {/* A6: type selector with builtin + custom groups */}
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        style={inputStyle}
      >
        <optgroup label="内置类型">
          {ALL_ASSET_TYPES.map((t) => (
            <option key={t} value={t}>{getAssetTypeLabel(t)}</option>
          ))}
        </optgroup>
        {customConfigs.length > 0 && (
          <optgroup label="自定义类型">
            {customConfigs.map((c) => (
              <option key={c.type_key} value={c.type_key}>
                {c.icon} {c.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {/* Type preview */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        margin: "6px 0", padding: "4px 6px",
        background: "var(--bg-surface)", borderRadius: 4, fontSize: 12,
        color: getAssetTypeColor(type),
      }}>
        {emoji
          ? <span style={{ fontSize: 13 }}>{emoji}</span>
          : <TypeIcon size={13} />
        }
        <span>{getAssetTypeLabel(type, customConfigs)}</span>
      </div>

      <input
        placeholder="名称"
        value={name}
        onChange={(e) => handleNameChange(e.target.value)}
        style={{ ...inputStyle, marginTop: 2 }}
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

export function AssetTree({ workspaceId, ruleSetId }: { workspaceId: string; ruleSetId?: string | null }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showNewForm, setShowNewForm] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; asset: Asset } | null>(null);
  const [hoverAssetId, setHoverAssetId] = useState<string | null>(null);

  const openTab = useEditorStore((s) => s.openTab);
  const activeTabId = useEditorStore((s) => s.activeTabId);

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["assets", workspaceId],
    queryFn: () => apiFetch<Asset[]>(`/workspaces/${workspaceId}/assets`),
  });

  const { data: customConfigs = [] } = useCustomAssetTypes(ruleSetId);

  const deleteMutation = useMutation({
    mutationFn: async (assetId: string) => {
      await apiFetch(`/assets/${assetId}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets", workspaceId] }),
  });

  const filtered = assets.filter(
    (a) => a.status !== "deleted" && a.name.toLowerCase().includes(search.toLowerCase())
  );

  // A4.2: Group assets — builtin types first (fixed order), then custom types, then "其他"
  const builtinKeys = ALL_ASSET_TYPES as string[];
  const customKeys = customConfigs.map((c) => c.type_key);
  const allKnownTypes = new Set([...builtinKeys, ...customKeys]);

  const byType: Record<string, Asset[]> = {};
  // Builtin groups
  for (const t of builtinKeys) {
    const items = filtered.filter((a) => a.type === t);
    if (items.length > 0) byType[t] = items;
  }
  // Custom type groups
  for (const t of customKeys) {
    const items = filtered.filter((a) => a.type === t);
    if (items.length > 0) byType[t] = items;
  }
  // "其他" — types present in data but not registered anywhere
  const otherItems = filtered.filter((a) => !allKnownTypes.has(a.type));
  if (otherItems.length > 0) byType["__other__"] = otherItems;

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
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--bg)", borderRadius: 4, padding: "4px 8px",
        }}>
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
        <NewAssetForm workspaceId={workspaceId} customConfigs={customConfigs} onClose={() => setShowNewForm(false)} />
      )}

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {Object.entries(byType).map(([type, items]) => {
          const isOther = type === "__other__";
          const emoji = isOther ? null : getCustomTypeEmoji(type, customConfigs);
          const TypeIcon = isOther ? null : getAssetTypeIcon(type);
          const typeColor = isOther ? "var(--text-muted)" : getAssetTypeColor(type);
          const typeLabel = isOther ? "其他" : getAssetTypeLabel(type, customConfigs);

          return (
            <div key={type}>
              {/* Section header */}
              <button
                onClick={() => toggleCollapse(type)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
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
                {collapsed.has(type)
                  ? <ChevronRight size={11} />
                  : <ChevronDown size={11} />
                }
                {emoji
                  ? <span style={{ fontSize: 11, color: typeColor }}>{emoji}</span>
                  : TypeIcon && <TypeIcon size={11} color={typeColor} />
                }
                <span style={{ color: typeColor }}>{typeLabel}</span>
                <span style={{ marginLeft: "auto", color: "var(--text-subtle)" }}>{items.length}</span>
              </button>

              {/* Asset rows */}
              {!collapsed.has(type) && items.map((asset) => {
                const isActive = activeTabId === asset.id;
                const isHovered = hoverAssetId === asset.id;
                const rowEmoji = getCustomTypeEmoji(asset.type, customConfigs);
                const RowIcon = getAssetTypeIcon(asset.type);
                const rowColor = getAssetTypeColor(asset.type);

                return (
                  <div
                    key={asset.id}
                    onClick={() => openAsset(asset)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, asset });
                    }}
                    onMouseEnter={() => setHoverAssetId(asset.id)}
                    onMouseLeave={() => setHoverAssetId(null)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px 5px 0",
                      paddingLeft: 0,
                      cursor: "pointer",
                      borderRadius: 4,
                      margin: "1px 4px",
                      background: isActive
                        ? `color-mix(in srgb, ${rowColor} 10%, transparent)`
                        : isHovered
                          ? "var(--bg-hover)"
                          : "none",
                      borderLeft: isActive
                        ? `var(--active-bar-width) solid ${rowColor}`
                        : "var(--active-bar-width) solid transparent",
                    }}
                  >
                    {/* indent after the border */}
                    <span style={{ width: 20, flexShrink: 0 }} />
                    {rowEmoji
                      ? <span style={{ fontSize: 13, color: isActive ? rowColor : "var(--text-muted)" }}>{rowEmoji}</span>
                      : <RowIcon size={13} color={isActive ? rowColor : "var(--text-muted)"} />
                    }
                    <span style={{
                      flex: 1,
                      fontSize: 13,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: isActive ? "var(--text)" : undefined,
                    }}>
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
                );
              })}
            </div>
          );
        })}

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
