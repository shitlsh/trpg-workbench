import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  presetType?: string;
  onClose: () => void;
}

function NewAssetForm({ workspaceId, customConfigs, presetType, onClose }: NewAssetFormProps) {
  const qc = useQueryClient();
  const [type, setType] = useState<string>(presetType ?? "npc");
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
    if (!slugEdited) {
      const s = slugify(v);
      setSlug(s || "");
    }
  };

  // Derive effective slug: fall back to `{type}-{timestamp}` only at submit time if still empty
  const effectiveSlug = slug || `${type}-${Date.now().toString(36)}`;

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
          onClick={() => mutation.mutate({ type, name, slug: effectiveSlug })}
          disabled={!name || mutation.isPending}
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
  const [newFormPresetType, setNewFormPresetType] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; asset: Asset } | null>(null);
  const [hoverAssetId, setHoverAssetId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Asset | null>(null);
  const [renameState, setRenameState] = useState<{ asset: Asset; name: string } | null>(null);

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

  const renameMutation = useMutation({
    mutationFn: async ({ assetId, name }: { assetId: string; name: string }) => {
      return apiFetch<AssetWithContent>(`/assets/${assetId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, change_summary: "重命名" }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets", workspaceId] }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (asset: Asset) => {
      const newSlug = `${asset.slug}-copy-${Date.now().toString(36)}`;
      return apiFetch<AssetWithContent>(`/workspaces/${workspaceId}/assets`, {
        method: "POST",
        body: JSON.stringify({ type: asset.type, name: `${asset.name} 副本`, slug: newSlug }),
      });
    },
    onSuccess: (newAsset) => {
      qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
      openTab(newAsset);
    },
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

  // ── Flatten tree into virtual rows ──────────────────────────────────────────
  type HeaderRow = { kind: "header"; type: string; typeLabel: string; typeColor: string; emoji: string | null; TypeIcon: ReturnType<typeof getAssetTypeIcon> | null; isOther: boolean; count: number };
  type AssetRow  = { kind: "asset";  asset: Asset; type: string; typeColor: string; emoji: string | null; RowIcon: ReturnType<typeof getAssetTypeIcon> };
  type TreeRow   = HeaderRow | AssetRow;

  const flatRows: TreeRow[] = [];
  for (const [type, items] of Object.entries(byType)) {
    const isOther = type === "__other__";
    flatRows.push({
      kind: "header",
      type,
      typeLabel: isOther ? "其他" : getAssetTypeLabel(type, customConfigs),
      typeColor: isOther ? "var(--text-muted)" : getAssetTypeColor(type),
      emoji: isOther ? null : getCustomTypeEmoji(type, customConfigs),
      TypeIcon: isOther ? null : getAssetTypeIcon(type),
      isOther,
      count: items.length,
    });
    if (!collapsed.has(type)) {
      for (const asset of items) {
        flatRows.push({
          kind: "asset",
          asset,
          type,
          typeColor: getAssetTypeColor(asset.type),
          emoji: getCustomTypeEmoji(asset.type, customConfigs),
          RowIcon: getAssetTypeIcon(asset.type),
        });
      }
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => flatRows[i].kind === "header" ? 26 : 30,
    overscan: 5,
  });

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
        <NewAssetForm
          workspaceId={workspaceId}
          customConfigs={customConfigs}
          presetType={newFormPresetType ?? undefined}
          onClose={() => { setShowNewForm(false); setNewFormPresetType(null); }}
        />
      )}

      {/* Tree — virtualized */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "12px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
            {search ? "无匹配资产" : "暂无资产，点击 + 新建"}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vitem) => {
              const row = flatRows[vitem.index];
              return (
                <div
                  key={vitem.key}
                  data-index={vitem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: vitem.start,
                    left: 0,
                    right: 0,
                  }}
                >
                  {row.kind === "header" ? (
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <button
                        onClick={() => toggleCollapse(row.type)}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          flex: 1, padding: "4px 6px 4px 12px",
                          background: "none", color: "var(--text-muted)",
                          fontSize: 11, fontWeight: 600,
                          textTransform: "uppercase", letterSpacing: 0.5,
                        }}
                      >
                        {collapsed.has(row.type) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                        {row.emoji
                          ? <span style={{ fontSize: 11, color: row.typeColor }}>{row.emoji}</span>
                          : row.TypeIcon && <row.TypeIcon size={11} color={row.typeColor} />
                        }
                        <span style={{ color: row.typeColor }}>{row.typeLabel}</span>
                        <span style={{ marginLeft: "auto", color: "var(--text-subtle)" }}>{row.count}</span>
                      </button>
                      {!row.isOther && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setNewFormPresetType(row.type);
                            setShowNewForm(true);
                          }}
                          title={`新建 ${row.typeLabel}`}
                          style={{
                            padding: "2px 6px", background: "none",
                            color: "var(--text-subtle)", fontSize: 12,
                            lineHeight: 1, borderRadius: 3,
                          }}
                        >
                          <Plus size={11} />
                        </button>
                      )}
                    </div>
                  ) : (
                    (() => {
                      const { asset, typeColor, emoji, RowIcon } = row;
                      const isActive = activeTabId === asset.id;
                      const isHovered = hoverAssetId === asset.id;
                      return (
                        <div
                          onClick={() => openAsset(asset)}
                          onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, asset }); }}
                          onMouseEnter={() => setHoverAssetId(asset.id)}
                          onMouseLeave={() => setHoverAssetId(null)}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "5px 12px 5px 0", paddingLeft: 0,
                            cursor: "pointer", borderRadius: 4, margin: "1px 4px",
                            background: isActive
                              ? `color-mix(in srgb, ${typeColor} 10%, transparent)`
                              : isHovered ? "var(--bg-hover)" : "none",
                            borderLeft: isActive
                              ? `var(--active-bar-width) solid ${typeColor}`
                              : "var(--active-bar-width) solid transparent",
                          }}
                        >
                          <span style={{ width: 20, flexShrink: 0 }} />
                          {emoji
                            ? <span style={{ fontSize: 13, color: isActive ? typeColor : "var(--text-muted)" }}>{emoji}</span>
                            : <RowIcon size={13} color={isActive ? typeColor : "var(--text-muted)"} />
                          }
                          <span style={{
                            flex: 1, fontSize: 13,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
                    })()
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (        <>
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
                setContextMenu(null);
                setRenameState({ asset: contextMenu.asset, name: contextMenu.asset.name });
              }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "6px 12px",
                background: "none", color: "var(--text)", fontSize: 13,
              }}
            >
              ✏️ 重命名
            </button>
            <button
              onClick={() => {
                duplicateMutation.mutate(contextMenu.asset);
                setContextMenu(null);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "6px 12px",
                background: "none", color: "var(--text)", fontSize: 13,
              }}
            >
              📋 复制
            </button>
            <div style={{ height: 1, background: "var(--border)", margin: "3px 0" }} />
            <button
              onClick={() => {
                setContextMenu(null);
                setDeleteConfirm(contextMenu.asset);
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

      {/* Rename dialog */}
      {renameState && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)" }}
            onClick={() => setRenameState(null)}
          />
          <div style={{
            position: "fixed",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 201,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "20px 24px",
            minWidth: 280,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>重命名资产</div>
            <input
              autoFocus
              value={renameState.name}
              onChange={(e) => setRenameState({ ...renameState, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameState.name.trim()) {
                  renameMutation.mutate({ assetId: renameState.asset.id, name: renameState.name.trim() });
                  setRenameState(null);
                } else if (e.key === "Escape") {
                  setRenameState(null);
                }
              }}
              style={{ ...inputStyle, marginBottom: 16 }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setRenameState(null)} style={btnSecondaryStyle}>取消</button>
              <button
                onClick={() => {
                  if (renameState.name.trim()) {
                    renameMutation.mutate({ assetId: renameState.asset.id, name: renameState.name.trim() });
                    setRenameState(null);
                  }
                }}
                disabled={!renameState.name.trim()}
                style={btnPrimaryStyle}
              >
                确认
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <>
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              background: "rgba(0,0,0,0.5)",
            }}
            onClick={() => setDeleteConfirm(null)}
          />
          <div style={{
            position: "fixed",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 201,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "20px 24px",
            minWidth: 280,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>确认删除</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
              删除资产「{deleteConfirm.name}」？此操作将同时删除磁盘文件，不可恢复。
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={btnSecondaryStyle}
              >
                取消
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate(deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
                style={{ ...btnPrimaryStyle, background: "var(--danger)" }}
              >
                删除
              </button>
            </div>
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
