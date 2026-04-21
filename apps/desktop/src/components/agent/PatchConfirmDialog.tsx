import { DiffEditor } from "@monaco-editor/react";
import { useState } from "react";
import type { PatchProposal } from "@trpg-workbench/shared-schema";
import { apiFetch } from "@/lib/api";
import { useAgentStore } from "@/stores/agentStore";
import { useQueryClient } from "@tanstack/react-query";

interface PatchConfirmDialogProps {
  patches: PatchProposal[];
  workflowId?: string | null;
  onDone: () => void;
}

export function PatchConfirmDialog({ patches, workflowId, onDone }: PatchConfirmDialogProps) {
  const qc = useQueryClient();
  const { closePatchDialog } = useAgentStore();
  const [selected, setSelected] = useState(0);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = patches[selected];

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      if (workflowId) {
        await apiFetch(`/workflows/${workflowId}/confirm`, { method: "POST" });
      } else {
        for (const p of patches) {
          if (!p.asset_id) continue;
          await apiFetch(`/assets/${p.asset_id}/apply-patch`, {
            method: "POST",
            body: JSON.stringify({
              content_md: p.content_md,
              content_json: p.content_json,
              change_summary: p.change_summary,
              source_type: "agent",
            }),
          });
        }
      }
      qc.invalidateQueries({ queryKey: ["assets"] });
      closePatchDialog();
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
    }}>
      <div style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: 8, width: "80vw", maxWidth: 900, height: "70vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>确认变更 ({patches.length} 个资产)</span>
          {patches.length > 1 && (
            <div style={{ display: "flex", gap: 4 }}>
              {patches.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  style={{
                    padding: "2px 8px", borderRadius: 3, fontSize: 11,
                    background: selected === i ? "var(--accent)" : "var(--bg)",
                    color: selected === i ? "#fff" : "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {p.asset_name}
                </button>
              ))}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => { closePatchDialog(); onDone(); }} style={{ background: "none", color: "var(--text-muted)" }}>✕</button>
        </div>

        {/* Diff editor */}
        {patch && (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <DiffEditor
              height="100%"
              language="markdown"
              theme="vs-dark"
              original={""}
              modified={patch.content_md}
              options={{ readOnly: true, wordWrap: "on", renderSideBySide: true }}
            />
          </div>
        )}

        {/* Change summary */}
        {patch && (
          <div style={{
            padding: "8px 16px", background: "var(--bg)", borderTop: "1px solid var(--border)",
            fontSize: 12, color: "var(--text-muted)",
          }}>
            变更说明：{patch.change_summary}
          </div>
        )}

        {/* Actions */}
        <div style={{
          padding: "10px 16px", borderTop: "1px solid var(--border)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          {error && <span style={{ fontSize: 11, color: "var(--danger)", flex: 1 }}>{error}</span>}
          <div style={{ flex: 1 }} />
          <button
            onClick={handleApply}
            disabled={applying}
            style={{ padding: "6px 16px", borderRadius: 4, background: "var(--accent)", color: "#fff", fontSize: 13, cursor: "pointer" }}
          >
            {applying ? "应用中..." : "应用变更"}
          </button>
          <button
            onClick={() => { closePatchDialog(); onDone(); }}
            style={{ padding: "6px 12px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
