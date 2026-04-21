import { useEffect, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, History, Save, RotateCcw } from "lucide-react";
import type { AssetWithContent, AssetRevision } from "@trpg-workbench/shared-schema";
import { useEditorStore, EditorTab, EditorView } from "@/stores/editorStore";
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

  const { data: revisions = [] } = useQuery<AssetRevision[]>({
    queryKey: ["asset", tab.assetId, "revisions"],
    queryFn: () => apiFetch<AssetRevision[]>(`/assets/${tab.assetId}/revisions`),
  });

  const rollbackMutation = useMutation({
    mutationFn: async (revId: string) => {
      return apiFetch<AssetWithContent>(`/assets/${tab.assetId}/revisions/${revId}/rollback`, {
        method: "POST",
      });
    },
    onSuccess: (asset) => {
      markSaved(tab.assetId, asset);
      qc.invalidateQueries({ queryKey: ["asset", tab.assetId, "revisions"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
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
            onClick={() => {
              if (confirm(`回滚到版本 ${rev.version}？`)) rollbackMutation.mutate(rev.id);
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { change_summary: "用户手动编辑" };
      if (tab.view === "markdown") body.content_md = tab.draftMd;
      else if (tab.view === "json") body.content_json = tab.draftJson;
      else {
        body.content_md = tab.draftMd;
        body.content_json = tab.draftJson;
      }
      return apiFetch<AssetWithContent>(`/assets/${tab.assetId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (updated) => {
      markSaved(tab.assetId, updated);
      qc.invalidateQueries({ queryKey: ["assets"] });
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
  }, [tab.isDirty, tab.draftMd, tab.draftJson, tab.view]);

  const viewTabs: { key: EditorView; label: string }[] = [
    { key: "markdown", label: "Markdown" },
    { key: "json", label: "JSON" },
    { key: "diff", label: "Diff" },
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
              theme="vs-dark"
              value={tab.draftMd}
              onChange={(v) => updateDraft(tab.assetId, v ?? "", undefined)}
              options={{ wordWrap: "on", minimap: { enabled: false }, fontSize: 14, lineNumbers: "off" }}
            />
          )}
          {tab.view === "json" && (
            <Editor
              height="100%"
              language="json"
              theme="vs-dark"
              value={tab.draftJson}
              onChange={(v) => updateDraft(tab.assetId, undefined, v ?? "")}
              options={{ wordWrap: "on", minimap: { enabled: false }, fontSize: 13, formatOnPaste: true }}
            />
          )}
          {tab.view === "diff" && (
            <DiffEditor
              height="100%"
              language="markdown"
              theme="vs-dark"
              original={tab.asset.content_md}
              modified={tab.draftMd}
              options={{ readOnly: true, wordWrap: "on", renderSideBySide: true }}
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <TabBar />
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
