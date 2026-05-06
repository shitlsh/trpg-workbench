/**
 * ExportDialog — validates and triggers PDF export for a workspace module handbook.
 *
 * Flow:
 *   1. On open: POST /export/validate → show draft warnings + broken ref warnings
 *   2. User confirms → shell.open(export/html URL) → system browser opens the
 *      print-ready HTML page → user presses Cmd+P / Ctrl+P to save as PDF.
 *
 * Note: iframe.contentWindow.print() is silently suppressed in Tauri's WKWebView
 * on macOS, so we delegate to the system browser instead.
 */
import React, { useCallback, useEffect, useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { apiFetch, BACKEND_URL } from "../lib/api";
import type { ExportValidateResult } from "@trpg-workbench/shared-schema";

interface Props {
  workspaceId: string;
  onClose: () => void;
}

type Phase = "validating" | "ready" | "opening" | "done" | "error";

export function ExportDialog({ workspaceId, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("validating");
  const [validation, setValidation] = useState<ExportValidateResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

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
    setPhase("opening");
    try {
      // Open the backend-rendered print-ready HTML directly in the system browser.
      // The system browser supports window.print() / Cmd+P natively; Tauri's
      // embedded WebView (WKWebView on macOS) silently ignores print() calls.
      const exportUrl = `${BACKEND_URL}/workspaces/${workspaceId}/export/html`;
      await shellOpen(exportUrl);
      setPhase("done");
    } catch (err) {
      setErrorMsg(String(err));
      setPhase("error");
    }
  }, [workspaceId]);

  const hasWarnings =
    (validation?.draft_assets.length ?? 0) > 0 ||
    (validation?.broken_refs.length ?? 0) > 0;

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  };
  const dialog: React.CSSProperties = {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "24px 28px",
    width: 480,
    maxHeight: "80vh",
    overflowY: "auto",
    color: "var(--text)",
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
    margin: 0, paddingLeft: 16, lineHeight: 1.8, color: "var(--text-muted)",
  };
  const footer: React.CSSProperties = {
    display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20,
  };
  const btnCancel: React.CSSProperties = {
    padding: "6px 16px", borderRadius: 6,
    background: "transparent", border: "1px solid var(--border)",
    color: "var(--text-muted)", cursor: "pointer", fontSize: 13,
  };
  const btnPrint: React.CSSProperties = {
    padding: "6px 18px", borderRadius: 6,
    background: "var(--accent)", border: "none",
    color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13,
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialog}>
        <h2 style={title}>导出模组手册</h2>

        {phase === "validating" && (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>正在校验资产…</p>
        )}

        {phase === "error" && (
          <p style={{ color: "var(--danger)", fontSize: 13 }}>
            错误：{errorMsg}
          </p>
        )}

        {(phase === "ready" || phase === "opening" || phase === "done") && validation && (
          <>
            {!hasWarnings && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
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
                <div style={{ ...warningTitle, color: "var(--danger)" }}>
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
          <p style={{ fontSize: 13, color: "var(--success)", marginTop: 12 }}>
            已在系统浏览器中打开，请按 <kbd style={{ padding: "1px 5px", borderRadius: 3, border: "1px solid var(--border)", fontSize: 11 }}>Cmd+P</kbd> 存储为 PDF。
          </p>
        )}

        <div style={footer}>
          <button style={btnCancel} onClick={onClose}>
            {phase === "done" ? "关闭" : "取消"}
          </button>
          {phase === "ready" && (
            <button style={btnPrint} onClick={handlePrint}>
              {hasWarnings ? "忽略警告并导出" : "导出 PDF"}
            </button>
          )}
          {phase === "opening" && (
            <button style={{ ...btnPrint, opacity: 0.6, cursor: "default" }} disabled>
              正在打开…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
