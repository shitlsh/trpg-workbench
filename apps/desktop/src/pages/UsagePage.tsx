import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { UsageSummary, UsageRecord } from "@trpg-workbench/shared-schema";

function fmt(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number | null): string {
  if (n == null) return "—";
  return `~$${n.toFixed(4)}`;
}

export default function UsagePage() {
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [taskTypeFilter, setTaskTypeFilter] = useState("");

  const queryParams = new URLSearchParams();
  if (fromDate) queryParams.set("from", new Date(fromDate).toISOString());
  if (toDate) queryParams.set("to", new Date(toDate).toISOString());
  if (taskTypeFilter) queryParams.set("task_type", taskTypeFilter);
  const qs = queryParams.toString() ? `?${queryParams}` : "";

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["usage-summary", fromDate, toDate, taskTypeFilter],
    queryFn: () => apiFetch<UsageSummary>(`/usage/summary${qs}`),
  });

  const { data: recent = [], isLoading: recentLoading } = useQuery({
    queryKey: ["usage-recent", taskTypeFilter],
    queryFn: () => apiFetch<UsageRecord[]>(`/usage/recent?limit=50${taskTypeFilter ? `&task_type=${taskTypeFilter}` : ""}`),
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #0d0d0d)", color: "var(--text, #e0e0e0)" }}>
      <header style={{ padding: "20px 32px", borderBottom: "1px solid var(--border, #2a2a2a)", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => navigate("/")} style={{ background: "transparent", border: "none", color: "var(--text-muted, #888)", cursor: "pointer", fontSize: 14 }}>← 返回</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>用量观测</h1>
        <span style={{ fontSize: 12, color: "var(--text-muted)", background: "var(--surface, #1a1a1a)", padding: "2px 8px", borderRadius: 4 }}>estimated</span>
      </header>

      <main style={{ padding: "24px 32px", maxWidth: 1100 }}>
        {/* Filters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            从 <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }} />
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            至 <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }} />
          </label>
          <select value={taskTypeFilter} onChange={(e) => setTaskTypeFilter(e.target.value)}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }}>
            <option value="">全部任务类型</option>
            <option value="creative">creative</option>
            <option value="rules">rules</option>
            <option value="general">general</option>
          </select>
        </div>

        {/* Summary cards */}
        {summaryLoading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>加载中...</div>
        ) : summary ? (
          <>
            <div style={{ display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
              {[
                { label: "总调用次数", value: String(summary.call_count) },
                { label: "总输入 Tokens", value: fmt(summary.total_input_tokens) },
                { label: "总输出 Tokens", value: fmt(summary.total_output_tokens) },
                { label: "估算总费用 (USD)", value: fmtCost(summary.estimated_cost_usd) },
              ].map((card) => (
                <div key={card.label} style={{
                  flex: "1 1 180px", padding: "16px 20px",
                  background: "var(--surface, #1a1a1a)", borderRadius: 10,
                  border: "1px solid var(--border, #2a2a2a)",
                }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{card.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{card.value}</div>
                </div>
              ))}
            </div>

            {/* By model table */}
            {summary.by_model.length > 0 && (
              <>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>按模型分组</div>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginBottom: 32 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px" }}>Provider</th>
                      <th style={{ padding: "6px 8px" }}>模型</th>
                      <th style={{ padding: "6px 8px" }}>调用次数</th>
                      <th style={{ padding: "6px 8px" }}>输入 Tokens</th>
                      <th style={{ padding: "6px 8px" }}>输出 Tokens</th>
                      <th style={{ padding: "6px 8px" }}>估算费用 (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_model.map((m) => (
                      <tr key={`${m.provider_type}:${m.model_name}`} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{m.provider_type}</td>
                        <td style={{ padding: "6px 8px" }}>{m.model_name}</td>
                        <td style={{ padding: "6px 8px" }}>{m.call_count}</td>
                        <td style={{ padding: "6px 8px" }}>{fmt(m.input_tokens)}</td>
                        <td style={{ padding: "6px 8px" }}>{fmt(m.output_tokens)}</td>
                        <td style={{ padding: "6px 8px" }}>{fmtCost(m.estimated_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        ) : null}

        {/* Recent records */}
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>最近记录</div>
        {recentLoading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>加载中...</div>
        ) : recent.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>暂无用量记录。执行 AI 任务后将在此显示。</div>
        ) : (
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>时间</th>
                <th style={{ padding: "6px 8px" }}>模型</th>
                <th style={{ padding: "6px 8px" }}>任务类型</th>
                <th style={{ padding: "6px 8px" }}>Tokens (in/out)</th>
                <th style={{ padding: "6px 8px" }}>估算费用</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px", color: "var(--text-muted)", fontSize: 12 }}>
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{r.provider_type}/{r.model_name}</td>
                  <td style={{ padding: "6px 8px" }}>{r.task_type}</td>
                  <td style={{ padding: "6px 8px" }}>{fmt(r.input_tokens)} / {fmt(r.output_tokens)}</td>
                  <td style={{ padding: "6px 8px" }}>{fmtCost(r.estimated_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p style={{ marginTop: 24, fontSize: 12, color: "var(--text-muted)" }}>
          * 所有费用数字均为基于静态 pricing catalog 的估算值，不代表实际账单。价格可能落后于 provider 官网，请以 provider 账户为准。
        </p>
      </main>
    </div>
  );
}
