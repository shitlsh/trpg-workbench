import { DiffEditor } from "@monaco-editor/react";
import { useState } from "react";
import type { PatchProposal } from "@trpg-workbench/shared-schema";
import { apiFetch } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useQueryClient } from "@tanstack/react-query";

interface PatchConfirmDialogProps {
  proposal: PatchProposal;
  sessionId: string;
  onDone: () => void;
  onSkip?: () => void;
}

export function PatchConfirmDialog({ proposal, sessionId, onDone, onSkip }: PatchConfirmDialogProps) {
  const qc = useQueryClient();
  const { activeWorkspaceId } = useWorkspaceStore();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      await apiFetch(`/chat/sessions/${sessionId}/confirm/${proposal.id}`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["assets", activeWorkspaceId] });
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  const handleReject = async () => {
    setApplying(true);
    setError(null);
    try {
      await apiFetch(`/chat/sessions/${sessionId}/reject/${proposal.id}`, { method: "POST" });
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  const actionLabel = proposal.action === "create" ? "新建" : "更新";

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
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 3,
            background: proposal.action === "create" ? "rgba(82,201,126,0.15)" : "rgba(74,144,217,0.15)",
            color: proposal.action === "create" ? "#52c97e" : "#4a90d9",
            border: `1px solid ${proposal.action === "create" ? "rgba(82,201,126,0.3)" : "rgba(74,144,217,0.3)"}`,
            fontWeight: 600,
          }}>
            {actionLabel}
          </span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{proposal.asset_name}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>({proposal.asset_type})</span>
          <div style={{ flex: 1 }} />
          {onSkip && (
            <button
              onClick={onSkip}
              style={{ background: "none", color: "var(--text-muted)", fontSize: 12, padding: "2px 8px" }}
            >
              跳过
            </button>
          )}
        </div>

        {/* Diff editor */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <DiffEditor
            height="100%"
            language="markdown"
            theme="vs-dark"
            original={proposal.original_content ?? ""}
            modified={proposal.content_md}
            options={{ readOnly: true, wordWrap: "on", renderSideBySide: true }}
          />
        </div>

        {/* Change summary */}
        <div style={{
          padding: "8px 16px", background: "var(--bg)", borderTop: "1px solid var(--border)",
          fontSize: 12, color: "var(--text-muted)",
        }}>
          变更说明：{proposal.change_summary}
        </div>

        {/* Actions */}
        <div style={{
          padding: "10px 16px", borderTop: "1px solid var(--border)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          {error && <span style={{ fontSize: 11, color: "#e05252", flex: 1 }}>{error}</span>}
          <div style={{ flex: 1 }} />
          <button
            onClick={handleApply}
            disabled={applying}
            style={{
              padding: "6px 16px", borderRadius: 4,
              background: "var(--accent)", color: "#fff",
              fontSize: 13, cursor: "pointer",
            }}
          >
            {applying ? "应用中..." : "应用变更"}
          </button>
          <button
            onClick={handleReject}
            disabled={applying}
            style={{
              padding: "6px 12px", borderRadius: 4,
              background: "var(--bg)", border: "1px solid var(--border)",
              color: "var(--text)", fontSize: 13, cursor: "pointer",
            }}
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
