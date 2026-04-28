import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";
import type { ToolCall, ConsistencyReport, ConsistencyIssue } from "@trpg-workbench/shared-schema";

const TOOL_LABELS: Record<string, string> = {
  list_assets: "列出资产",
  read_asset: "读取资产",
  grep_asset: "文内搜索",
  read_asset_section: "读取章节",
  search_assets: "搜索资产",
  read_config: "读取配置",
  search_knowledge: "检索知识库",
  create_asset: "新建资产",
  create_assets: "批量新建资产",
  patch_asset: "局部修改资产",
  patch_assets: "批量局部修改",
  update_asset: "全量更新资产",
  delete_asset: "删除资产",
  move_asset: "移动/重命名资产",
  delete_assets: "批量删除资产",
  move_assets: "批量移动资产",
  preview_bulk_text_replace: "预检跨资产替换",
  apply_bulk_text_replace: "应用跨资产替换",
  check_consistency: "一致性检查",
  consult_rules: "规则咨询",
  create_skill: "新建 Skill",
  web_search: "网络搜索",
  ask_user: "向用户提问",
};

interface ToolCallCardProps {
  toolCall: ToolCall;
}

function ConsistencyReportView({ report }: { report: ConsistencyReport }) {
  const [issuesExpanded, setIssuesExpanded] = useState(false);

  const statusColor =
    report.overall_status === "clean"
      ? "#52c97e"
      : report.overall_status === "has_warnings"
      ? "#f0c050"
      : "#e05252";

  const statusLabel =
    report.overall_status === "clean"
      ? "无冲突"
      : report.overall_status === "has_warnings"
      ? "有警告"
      : "有错误";

  const StatusIcon =
    report.overall_status === "clean"
      ? CheckCircle
      : report.overall_status === "has_warnings"
      ? AlertTriangle
      : AlertCircle;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <StatusIcon size={11} style={{ color: statusColor }} />
        <span style={{
          fontSize: 10, padding: "1px 6px", borderRadius: 8,
          background: `${statusColor}22`, color: statusColor,
          border: `1px solid ${statusColor}44`,
        }}>
          {statusLabel}
        </span>
        {report.issues.length > 0 && (
          <button
            onClick={() => setIssuesExpanded(!issuesExpanded)}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", fontSize: 10, padding: 0,
            }}
          >
            {issuesExpanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
            {report.issues.length} 条问题
          </button>
        )}
      </div>
      {issuesExpanded && report.issues.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {report.issues.map((issue: ConsistencyIssue, idx: number) => {
            const isError = issue.severity === "error";
            const color = isError ? "#e05252" : "#f0c050";
            return (
              <div key={idx} style={{
                padding: "5px 7px", borderRadius: 4,
                background: `${color}10`,
                border: `1px solid ${color}30`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                  <span style={{
                    fontSize: 9, padding: "0 4px", borderRadius: 3,
                    background: `${color}22`, color,
                    fontWeight: 600, textTransform: "uppercase",
                  }}>
                    {isError ? "错误" : "警告"}
                  </span>
                  <span style={{ color: "var(--text-muted)", fontSize: 9 }}>{issue.type}</span>
                </div>
                <div style={{ color: "var(--text)", fontSize: 10, marginBottom: 2 }}>
                  {issue.description}
                </div>
                {issue.suggestion && (
                  <div style={{ color: "var(--text-muted)", fontSize: 9, fontStyle: "italic" }}>
                    建议：{issue.suggestion}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KnowledgeResultView({ raw, args }: { raw: string; args: Record<string, unknown> }) {
  let results: Array<{ content?: string; document_name?: string; page_from?: number; page_to?: number }> = [];
  let message = "";
  try {
    const data = JSON.parse(raw);
    results = data.results ?? [];
    message = data.message ?? "";
  } catch {}

  return (
    <div>
      {args.query !== undefined && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>
          <span style={{ fontWeight: 600 }}>查询：</span>{String(args.query)}
        </div>
      )}
      {message && <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>{message}</div>}
      {results.length === 0 && !message && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>无匹配结果</div>
      )}
      {results.map((r, i) => (
        <div key={i} style={{
          marginBottom: 6, padding: "4px 6px",
          background: "var(--bg)", borderRadius: 3,
          border: "1px solid var(--border)",
          fontSize: 10,
        }}>
          <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>
            {r.document_name} · p{r.page_from}{r.page_to && r.page_to !== r.page_from ? `–${r.page_to}` : ""}
          </div>
          <div style={{ color: "var(--text)", lineHeight: 1.4 }}>{(r.content ?? "").slice(0, 150)}{(r.content?.length ?? 0) > 150 ? "…" : ""}</div>
        </div>
      ))}
    </div>
  );
}

function _jsonArrayLength(param: unknown): number | null {
  if (typeof param !== "string" || !param) return null;
  try {
    const v = JSON.parse(param) as unknown;
    return Array.isArray(v) ? v.length : null;
  } catch {
    return null;
  }
}

// Build a short inline description of args for display in the card header
function argsSummary(name: string, args: Record<string, unknown>): string | null {
  if (name === "search_knowledge" || name === "web_search") {
    const q = args.query as string;
    return q ? `"${q}"` : null;
  }
  if (name === "consult_rules") {
    const q = (args.question ?? args.query) as string;
    return q ? `"${q}"` : null;
  }
  if (name === "search_assets") {
    const q = (args.query ?? args.name ?? args.type) as string;
    return q ? `"${q}"` : null;
  }
  if (name === "list_assets") {
    const parts: string[] = [];
    if (args.asset_type) parts.push(String(args.asset_type));
    if (args.name_contains) parts.push(`*${String(args.name_contains).slice(0, 20)}*`);
    if (args.status) parts.push(String(args.status));
    if (args.limit) parts.push(`limit ${args.limit}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (name === "read_asset") {
    return ((args.asset_slug ?? args.slug ?? args.asset_id) as string) ?? null;
  }
  if (name === "grep_asset" || name === "read_asset_section" || name === "patch_asset") {
    const slug = (args.asset_slug ?? args.slug) as string | undefined;
    if (name === "grep_asset" && (args.pattern || slug)) {
      const p = String(args.pattern ?? "");
      return slug ? `${slug} · ${p.slice(0, 40)}${p.length > 40 ? "…" : ""}` : p.slice(0, 40);
    }
    if (name === "read_asset_section" && (args.heading || slug)) {
      return [slug, args.heading as string | undefined].filter(Boolean).join(" · ") || null;
    }
    return slug ?? null;
  }
  if (name === "create_asset" || name === "update_asset") {
    return ((args.name ?? args.asset_slug) as string) ?? null;
  }
  if (name === "create_skill" && args.user_intent) {
    const t = String(args.user_intent);
    return t.length > 48 ? `${t.slice(0, 48)}…` : t;
  }
  if (name === "check_consistency" && args.focus) {
    return String(args.focus).slice(0, 40);
  }
  if (name === "delete_asset") {
    if (args.asset_id) return `id: ${String(args.asset_id).slice(0, 8)}…`;
    if (args.asset_slug) return String(args.asset_slug);
  }
  if (name === "move_asset" && (args.from_slug || args.to_slug)) {
    return `${String(args.from_slug)} → ${String(args.to_slug)}`;
  }
  if (name === "ask_user" && Array.isArray(args.questions)) {
    return `${(args.questions as unknown[]).length} 问`;
  }
  if (name === "create_assets" || name === "patch_assets" || name === "delete_assets" || name === "move_assets") {
    const n = _jsonArrayLength(args.items_json);
    if (n != null) return `${n} 项`;
  }
  if (name === "preview_bulk_text_replace" && args.old_str) {
    const t = String(args.old_str);
    return t.length > 36 ? `${t.slice(0, 36)}…` : t;
  }
  if (name === "apply_bulk_text_replace") {
    const n = _jsonArrayLength(args.slugs_json);
    if (n != null) return `${n} 个 slug`;
  }
  return null;
}

// Parse search_knowledge result into a readable summary
function knowledgeResultSummary(raw: string): string | null {
  try {
    const data = JSON.parse(raw);
    if (data.message) return data.message;
    const results = data.results as Array<{ content?: string; document_name?: string; page_from?: number }>;
    if (!results || results.length === 0) return "无匹配结果";
    return `${results.length} 条结果 · ${results[0].document_name ?? ""} p${results[0].page_from ?? "?"}: ${(results[0].content ?? "").slice(0, 60)}…`;
  } catch {
    return null;
  }
}

function humanizeResultSummary(toolCall: ToolCall): string | null {
  const raw = toolCall.result_summary;
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data.error === "string" && data.error) return `失败：${data.error}`;
    if (typeof data.message === "string" && data.message) return data.message;

    const success = data.success;
    if (success === true) {
      if (typeof data.change_summary === "string" && data.change_summary) return data.change_summary;
      if (typeof data.asset_name === "string" && data.asset_name) return `已处理：${data.asset_name}`;
      if (typeof data.slug === "string" && data.slug) return `已完成（${data.slug}）`;
      return "执行成功";
    }
    if (success === false) {
      return "执行失败";
    }
  } catch {
    // non-JSON summary, keep concise raw preview below
  }
  return raw.length > 140 ? `${raw.slice(0, 140)}...` : raw;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.arguments);
  } catch {}

  const isAutoApplied = toolCall.status === "auto_applied";

  // Parse consistency report from result_summary if applicable
  let consistencyReport: ConsistencyReport | null = null;
  if (toolCall.name === "check_consistency" && toolCall.result_summary) {
    try {
      consistencyReport = JSON.parse(toolCall.result_summary) as ConsistencyReport;
    } catch {}
  }

  const inlineArgsSummary = argsSummary(toolCall.name, args);
  const knowledgeSummary = (toolCall.name === "search_knowledge" || toolCall.name === "consult_rules") && toolCall.result_summary
    ? knowledgeResultSummary(toolCall.result_summary)
    : null;
  const genericSummary = !consistencyReport && !knowledgeSummary
    ? humanizeResultSummary(toolCall)
    : null;

  useEffect(() => {
    if (toolCall.status === "running" && (toolCall.trace_logs?.length ?? 0) > 0) {
      setTraceExpanded(true);
      return;
    }
    if (toolCall.status !== "running") {
      setTraceExpanded(false);
    }
  }, [toolCall.status, toolCall.trace_logs]);

  const statusIcon = () => {
    switch (toolCall.status) {
      case "running":
        return <Loader2 size={11} className="animate-spin" style={{ color: "var(--text-muted)" }} />;
      case "done":
        return <CheckCircle2 size={11} style={{ color: "#52c97e" }} />;
      case "error":
        return <XCircle size={11} style={{ color: "#e05252" }} />;
      default:
        if (isAutoApplied) {
          return <Zap size={11} style={{ color: "#52c97e" }} />;
        }
        return <Clock size={11} style={{ color: "#f0c050" }} />;
    }
  };

  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name;

  return (
    <div style={{
      margin: "4px 0",
      border: `1px solid ${isAutoApplied ? "rgba(82,201,126,0.4)" : "var(--border)"}`,
      borderRadius: 4,
      overflow: "hidden",
      fontSize: 11,
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: isAutoApplied ? "rgba(82,201,126,0.06)" : "var(--bg)",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          textAlign: "left",
        }}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span style={{ flexShrink: 0 }}>{statusIcon()}</span>
        <span style={{ color: "var(--text)", fontWeight: 500, flexShrink: 0 }}>{label}</span>
        {inlineArgsSummary && (
          <span style={{ color: "var(--text-muted)", fontSize: 10, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {inlineArgsSummary}
          </span>
        )}
        {isAutoApplied && (
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 8, flexShrink: 0,
            background: "rgba(82,201,126,0.15)", color: "#52c97e",
            border: "1px solid rgba(82,201,126,0.3)",
          }}>
            已写入
          </span>
        )}
        {toolCall.result_summary && !isAutoApplied && !consistencyReport && !knowledgeSummary && (
          <span style={{ color: "var(--text-subtle)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            — {toolCall.result_summary}
          </span>
        )}
        {knowledgeSummary && (
          <span style={{ color: "var(--text-muted)", fontSize: 10, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            — {knowledgeSummary}
          </span>
        )}
        {consistencyReport && (
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 8, flexShrink: 0,
            background: consistencyReport.overall_status === "clean"
              ? "rgba(82,201,126,0.15)"
              : consistencyReport.overall_status === "has_warnings"
              ? "rgba(240,192,80,0.15)"
              : "rgba(224,82,82,0.15)",
            color: consistencyReport.overall_status === "clean"
              ? "#52c97e"
              : consistencyReport.overall_status === "has_warnings"
              ? "#f0c050"
              : "#e05252",
            border: `1px solid ${
              consistencyReport.overall_status === "clean"
                ? "rgba(82,201,126,0.3)"
                : consistencyReport.overall_status === "has_warnings"
                ? "rgba(240,192,80,0.3)"
                : "rgba(224,82,82,0.3)"
            }`,
          }}>
            {consistencyReport.overall_status === "clean" ? "无冲突" : `${consistencyReport.issues.length} 条问题`}
          </span>
        )}
      </button>
      {expanded && (
        <div style={{ padding: "6px 8px", background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
          {consistencyReport ? (
            <ConsistencyReportView report={consistencyReport} />
          ) : knowledgeSummary && toolCall.result_summary ? (
            <KnowledgeResultView raw={toolCall.result_summary} args={args} />
          ) : (
            <>
              {inlineArgsSummary && (
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  目标：{inlineArgsSummary}
                </div>
              )}
              {genericSummary && (
                <div style={{ marginTop: 4, fontSize: 10, color: "var(--text)" }}>
                  结果：{genericSummary}
                </div>
              )}
              {toolCall.trace_logs && toolCall.trace_logs.length > 0 && (
                <div style={{ marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setTraceExpanded(!traceExpanded); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      fontSize: 10, background: "none", border: "none", cursor: "pointer",
                      color: "var(--text-muted)", padding: 0,
                    }}
                  >
                    {traceExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    执行过程（{toolCall.trace_logs.length}）
                  </button>
                  {traceExpanded && (
                    <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 4 }}>
                      {toolCall.trace_logs.map((line, idx) => (
                        <div key={idx} style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          {idx + 1}. {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
