/**
 * ExportDialog — validates and triggers PDF export for a workspace module handbook.
 *
 * Flow:
 *   1. On open: POST /export/validate → show draft warnings + broken ref warnings
 *   2. User confirms → GET /export/html → inject into hidden <iframe> → print()
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, BACKEND_URL } from "../lib/api";
import type { ExportValidateResult } from "@trpg-workbench/shared-schema";

interface Props {
  workspaceId: string;
  onClose: () => void;
}

type Phase = "validating" | "ready" | "printing" | "done" | "error";

export function ExportDialog({ workspaceId, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("validating");
  const [validation, setValidation] = useState<ExportValidateResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Validate on mount
  useEffect(() => {
    apiFetch<ExportValidateResult>(`/workspaces/${workspaceId}/export/validate`, {
      method: "POST",
    })
      .then((result) => {
        setValidation(result);
        setPhase("ready");
      })
      .catch((err) => {
        setErrorMsg(String(err));
        setPhase("error");
      });
  }, [workspaceId]);

  const handlePrint = useCallback(async () => {
    setPhase("printing");
    try {
      // Fetch raw HTML string from backend
      const resp = await fetch(
        `${BACKEND_URL}/workspaces/${workspaceId}/export/html`,
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const htmlContent = await resp.text();

      const iframe = iframeRef.current!;
      iframe.srcdoc = htmlContent;
      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setPhase("done");
      };
    } catch (err) {
      setErrorMsg(String(err));
      setPhase("error");
    }
  }, [workspaceId]);

  const hasWarnings =
    (validation?.draft_assets.length ?? 0) > 0 ||
    (validation?.broken_refs.length ?? 0) > 0;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  };
  const dialog: React.CSSProperties = {
    background: "var(--bg-panel, #1e1e2e)",
    border: "1px solid var(--border, #333)",
    borderRadius: 10,
    padding: "24px 28px",
    width: 480,
    maxHeight: "80vh",
    overflowY: "auto",
    color: "var(--text, #cdd6f4)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  };
  const title: React.CSSProperties = {
    margin: "0 0 16px", fontSize: 16, fontWeight: 600,
  };
  const section: React.CSSProperties = {
    margin: "12px 0", padding: "10px 14px",
    background: "rgba(250,180,30,0.08)",
    border: "1px solid rgba(250,180,30,0.25)",
    borderRadius: 6,
    fontSize: 12,
  };
  const warningTitle: React.CSSProperties = {
    fontWeight: 600, color: "#d4a020", marginBottom: 6,
  };
  const itemList: React.CSSProperties = {
    margin: 0, paddingLeft: 16, lineHeight: 1.8, color: "var(--text-muted, #888)",
  };
  const footer: React.CSSProperties = {
    display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20,
  };
  const btnCancel: React.CSSProperties = {
    padding: "6px 16px", borderRadius: 6,
    background: "transparent", border: "1px solid var(--border, #444)",
    color: "var(--text-muted, #888)", cursor: "pointer", fontSize: 13,
  };
  const btnPrint: React.CSSProperties = {
    padding: "6px 18px", borderRadius: 6,
    background: "var(--accent, #89b4fa)", border: "none",
    color: "#1e1e2e", fontWeight: 600, cursor: "pointer", fontSize: 13,
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Hidden iframe for print */}
      <iframe
        ref={iframeRef}
        style={{ position: "fixed", width: 0, height: 0, border: "none", opacity: 0, pointerEvents: "none" }}
        title="export-print"
      />

      <div style={dialog}>
        <h2 style={title}>导出模组手册</h2>

        {phase === "validating" && (
          <p style={{ color: "var(--text-muted, #888)", fontSize: 13 }}>正在校验资产…</p>
        )}

        {phase === "error" && (
          <p style={{ color: "var(--danger, #f38ba8)", fontSize: 13 }}>
            错误：{errorMsg}
          </p>
        )}

        {(phase === "ready" || phase === "printing" || phase === "done") && validation && (
          <>
            {!hasWarnings && (
              <p style={{ fontSize: 13, color: "var(--text-muted, #888)" }}>
                校验通过，所有资产均已发布，无断裂引用。
              </p>
            )}

            {validation.draft_assets.length > 0 && (
              <div style={section}>
                <div style={warningTitle}>
                  {validation.draft_assets.length} 个草稿资产将被包含
                </div>
                <ul style={itemList}>
                  {validation.draft_assets.map((a) => (
                    <li key={a.slug}>{a.name} <span style={{ opacity: 0.6 }}>({a.type})</span></li>
                  ))}
                </ul>
              </div>
            )}

            {validation.broken_refs.length > 0 && (
              <div style={{ ...section, background: "rgba(243,139,168,0.08)", borderColor: "rgba(243,139,168,0.25)" }}>
                <div style={{ ...warningTitle, color: "var(--danger, #f38ba8)" }}>
                  {validation.broken_refs.length} 个断裂引用
                </div>
                <ul style={itemList}>
                  {validation.broken_refs.map((r, i) => (
                    <li key={i}>
                      <code>{r.source_slug}</code> → <code>{r.ref_slug}</code>（不存在）
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {phase === "done" && (
          <p style={{ fontSize: 13, color: "var(--success, #a6e3a1)", marginTop: 12 }}>
            打印对话框已打开，请选择"存储为 PDF"。
          </p>
        )}

        <div style={footer}>
          <button style={btnCancel} onClick={onClose}>
            {phase === "done" ? "关闭" : "取消"}
          </button>
          {(phase === "ready") && (
            <button style={btnPrint} onClick={handlePrint}>
              {hasWarnings ? "忽略警告并导出" : "导出 PDF"}
            </button>
          )}
          {phase === "printing" && (
            <button style={{ ...btnPrint, opacity: 0.6, cursor: "default" }} disabled>
              生成中…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
