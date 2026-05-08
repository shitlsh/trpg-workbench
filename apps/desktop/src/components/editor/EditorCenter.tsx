import { useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import Editor, { DiffEditor, type BeforeMount } from "@monaco-editor/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, History, Save, RotateCcw } from "lucide-react";
import type { Asset, AssetWithContent, AssetRevision } from "@trpg-workbench/shared-schema";
import { useEditorStore, EditorTab, EditorView } from "@/stores/editorStore";
import { useThemeStore } from "@/stores/themeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { MarkdownPreview } from "./MarkdownPreview";
import { AssetMetaPanel } from "./AssetMetaPanel";
import { apiFetch } from "@/lib/api";

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, forceCloseTab } = useEditorStore();
  const [confirmClose, setConfirmClose] = useState<string | null>(null);

  const handleClose = (assetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = closeTab(assetId);
    if (!ok) setConfirmClose(assetId);
  };

  return (
    <>
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        overflowX: "auto",
        flexShrink: 0,
      }}>
        {tabs.map((tab) => (
          <div
            key={tab.assetId}
            onClick={() => setActiveTab(tab.assetId)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              cursor: "pointer",
              borderRight: "1px solid var(--border)",
              background: tab.assetId === activeTabId ? "var(--bg)" : "transparent",
              borderBottom: tab.assetId === activeTabId ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab.assetId === activeTabId ? "var(--text)" : "var(--text-muted)",
              fontSize: 13,
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            <span>
              {tab.asset.name}
              {tab.isDirty && <span style={{ color: "var(--accent)", marginLeft: 4 }}>●</span>}
            </span>
            <button
              onClick={(e) => handleClose(tab.assetId, e)}
              style={{ background: "none", color: "inherit", padding: 1, borderRadius: 2, lineHeight: 1 }}
              title="关闭"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {tabs.length === 0 && (
          <div style={{ padding: "8px 14px", color: "var(--text-muted)", fontSize: 13 }}>
            从左侧点击资产以打开
          </div>
        )}
      </div>

      {/* Dirty-close confirm dialog */}
      {confirmClose && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
        }}>
          <div style={{
            background: "var(--bg-surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: 24, maxWidth: 360,
          }}>
            <div style={{ marginBottom: 12, fontWeight: 600 }}>有未保存的改动，确认关闭？</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { forceCloseTab(confirmClose); setConfirmClose(null); }}
                style={{ ...btnDangerStyle }}
              >关闭不保存</button>
              <button
                onClick={() => setConfirmClose(null)}
                style={{ ...btnSecondaryStyle }}
              >取消</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Revision History Sidebar ─────────────────────────────────────────────────

function RevisionSidebar({ tab }: { tab: EditorTab }) {
  const qc = useQueryClient();
  const { markSaved } = useEditorStore();
  const { activeWorkspaceId } = useWorkspaceStore();

  const { data: revisions = [] } = useQuery<AssetRevision[]>({
    queryKey: ["asset", tab.assetId, "revisions"],
    queryFn: () => apiFetch<AssetRevision[]>(`/assets/${tab.assetId}/revisions`),
  });

  const rollbackMutation = useMutation({
    mutationFn: async (version: number) => {
      return apiFetch<AssetWithContent>(`/assets/${tab.assetId}/revisions/${version}/rollback`, {
        method: "POST",
      });
    },
    onSuccess: (asset) => {
      markSaved(tab.assetId, asset);
      qc.invalidateQueries({ queryKey: ["asset", tab.assetId, "revisions"] });
      qc.invalidateQueries({ queryKey: ["assets", activeWorkspaceId] });
    },
  });

  return (
    <div style={{
      width: 220, borderLeft: "1px solid var(--border)",
      background: "var(--bg-surface)", overflowY: "auto", flexShrink: 0,
    }}>
      <div style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13, borderBottom: "1px solid var(--border)" }}>
        修改历史
      </div>
      {revisions.map((rev) => (
        <div key={rev.id} style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>v{rev.version}</span>
            <span style={{
              fontSize: 10, padding: "1px 5px", borderRadius: 3,
              background: rev.source_type === "agent" ? "#3a2c7a" : "#1a3a2c",
              color: rev.source_type === "agent" ? "#b0a0ff" : "#52c97e",
            }}>{rev.source_type === "agent" ? "AI" : "用户"}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {new Date(rev.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--text)" }}>{rev.change_summary}</div>
          <button
            onClick={async () => {
              if (await confirm(`回滚到版本 ${rev.version}？`)) rollbackMutation.mutate(rev.version);
            }}
            style={{
              marginTop: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 4,
              background: "none", color: "var(--accent)", padding: 0,
            }}
          >
            <RotateCcw size={11} /> 回滚到此版本
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Asset Editor ─────────────────────────────────────────────────────────────

function AssetEditor({ tab }: { tab: EditorTab }) {
  const qc = useQueryClient();
  const { updateDraft, markSaved, setView, toggleHistory } = useEditorStore();
  const { theme } = useThemeStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";

  // Suppress Monaco's built-in markdown diagnostics that warn about Unicode
  // confusable characters (e.g. Chinese punctuation "，。！？"). These are
  // triggered by the internal markdown language worker and are noise for TRPG
  // content which legitimately uses full-width CJK punctuation.
  const handleBeforeMount: BeforeMount = (monaco) => {
    // Override setModelMarkers to drop any markers emitted for "markdown" owners.
    // This is the only reliable way to silence the markdown language worker's
    // unicode-confusable diagnostics without disabling the entire language support.
    const originalSetMarkers = monaco.editor.setModelMarkers.bind(monaco.editor);
    monaco.editor.setModelMarkers = (
      model: Parameters<typeof originalSetMarkers>[0],
      owner: string,
      markers: Parameters<typeof originalSetMarkers>[2],
    ) => {
      if (owner === "markdown" || owner === "markdownDiagnostics") return;
      originalSetMarkers(model, owner, markers);
    };
  };

  // All workspace assets for [[slug]] wikilink resolution in preview
  const { data: allAssets = [] } = useQuery<Asset[]>({
    queryKey: ["assets", activeWorkspaceId],
    queryFn: () => apiFetch<Asset[]>(`/workspaces/${activeWorkspaceId}/assets`),
    enabled: !!activeWorkspaceId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {
        change_summary: "用户手动编辑",
        content_md: tab.draftMd,
      };
      return apiFetch<AssetWithContent>(`/assets/${tab.assetId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (updated) => {
      markSaved(tab.assetId, updated);
      qc.invalidateQueries({ queryKey: ["assets", activeWorkspaceId] });
      qc.invalidateQueries({ queryKey: ["asset", tab.assetId, "revisions"] });
    },
  });

  // Cmd/Ctrl+S save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (tab.isDirty) saveMutation.mutate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tab.isDirty, tab.draftMd, tab.view]);

  const viewTabs: { key: EditorView; label: string }[] = [
    { key: "markdown", label: "Markdown" },
    { key: "diff",     label: "Diff" },
    { key: "preview",  label: "预览" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)", flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, marginRight: 4 }}>{tab.asset.name}</span>

        {/* View toggle */}
        <div style={{ display: "flex", gap: 2, background: "var(--bg)", borderRadius: 4, padding: 2 }}>
          {viewTabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(tab.assetId, key)}
              style={{
                padding: "3px 10px", borderRadius: 3, fontSize: 12,
                background: tab.view === key ? "var(--accent)" : "none",
                color: tab.view === key ? "#fff" : "var(--text-muted)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {saveMutation.isError && (
          <span style={{ color: "var(--danger)", fontSize: 11 }}>保存失败</span>
        )}

        <button
          onClick={() => saveMutation.mutate()}
          disabled={!tab.isDirty || saveMutation.isPending}
          title="保存 (Cmd/Ctrl+S)"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "4px 10px", borderRadius: 4, fontSize: 12,
            background: tab.isDirty ? "var(--accent)" : "var(--bg-hover)",
            color: tab.isDirty ? "#fff" : "var(--text-muted)",
          }}
        >
          <Save size={12} />
          {saveMutation.isPending ? "保存中..." : "保存"}
        </button>

        <button
          onClick={() => toggleHistory(tab.assetId)}
          title="修改历史"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "4px 8px", borderRadius: 4, fontSize: 12,
            background: tab.showHistory ? "var(--bg-hover)" : "none",
            color: tab.showHistory ? "var(--text)" : "var(--text-muted)",
          }}
        >
          <History size={14} />
        </button>
      </div>

      {/* Editor area + history */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "hidden" }}>
          {tab.view === "markdown" && (
            <Editor
              height="100%"
              language="markdown"
              theme={monacoTheme}
              value={tab.draftMd}
              onChange={(v) => updateDraft(tab.assetId, v ?? "")}
              options={{ wordWrap: "on", minimap: { enabled: false }, fontSize: 14, lineNumbers: "off" }}
              beforeMount={handleBeforeMount}
            />
          )}
          {tab.view === "diff" && (
            <DiffEditor
              height="100%"
              language="markdown"
              theme={monacoTheme}
              original={tab.asset.content_md}
              modified={tab.draftMd}
              beforeMount={handleBeforeMount}
              options={{ readOnly: true, wordWrap: "on", renderSideBySide: true }}
            />
          )}
          {tab.view === "preview" && (
            <MarkdownPreview
              content={tab.draftMd}
              assetName={tab.asset.name}
              allAssets={allAssets}
              onOpenAsset={(id) => {
                apiFetch<AssetWithContent>(`/assets/${id}`).then((full) => {
                  useEditorStore.getState().openTab(full);
                });
              }}
            />
          )}
        </div>

        {tab.showHistory && <RevisionSidebar tab={tab} />}
      </div>
    </div>
  );
}

// ─── Main: EditorCenter ───────────────────────────────────────────────────────

export function EditorCenter() {
  const { tabs, activeTabId } = useEditorStore();
  const activeTab = tabs.find((t) => t.assetId === activeTabId);
  const [metaOpen, setMetaOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <TabBar />
      {/* Meta panel strip */}
      {activeTab && (
        <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <button
            onClick={() => setMetaOpen((v) => !v)}
            style={{
              width: "100%", padding: "4px 12px",
              display: "flex", alignItems: "center", gap: 6,
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", fontSize: 11, textAlign: "left",
            }}
          >
            {metaOpen ? "▾" : "▸"}
            <span style={{ fontFamily: "monospace" }}>{activeTab.asset.slug}</span>
            <span style={{
              fontSize: 10, padding: "1px 5px", borderRadius: 3,
              marginLeft: 4,
              background: activeTab.asset.status === "final" ? "rgba(82,201,126,0.15)"
                : activeTab.asset.status === "review" ? "rgba(240,165,0,0.15)"
                : "rgba(136,136,136,0.15)",
              color: activeTab.asset.status === "final" ? "#52c97e"
                : activeTab.asset.status === "review" ? "#f0a500"
                : "#888",
            }}>
              {activeTab.asset.status === "final" ? "定稿"
                : activeTab.asset.status === "review" ? "审查中"
                : "草稿"}
            </span>
            <span style={{ marginLeft: "auto", color: "var(--text-subtle)", fontSize: 10 }}>
              v{activeTab.asset.version}
            </span>
          </button>
          {metaOpen && (
            <div style={{ maxHeight: 280, overflowY: "auto", borderTop: "1px solid var(--border)" }}>
              <AssetMetaPanel />
            </div>
          )}
        </div>
      )}
      {activeTab ? (
        <AssetEditor key={activeTab.assetId} tab={activeTab} />
      ) : (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-muted)", fontSize: 14,
        }}>
          从左侧选择资产以开始编辑
        </div>
      )}
    </div>
  );
}

const btnDangerStyle: React.CSSProperties = {
  flex: 1, padding: "6px 12px", borderRadius: 4, fontSize: 13,
  background: "var(--danger)", color: "#fff", cursor: "pointer",
};
const btnSecondaryStyle: React.CSSProperties = {
  flex: 1, padding: "6px 12px", borderRadius: 4, fontSize: 13,
  background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer",
};
