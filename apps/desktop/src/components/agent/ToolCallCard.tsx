import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";
import type { ToolCall, ConsistencyReport, ConsistencyIssue } from "@trpg-workbench/shared-schema";

const TOOL_LABELS: Record<string, string> = {
  list_assets: "列出资产",
  read_asset: "读取资产",
  search_assets: "搜索资产",
  read_config: "读取配置",
  search_knowledge: "检索知识库",
  create_asset: "新建资产",
  update_asset: "更新资产",
  check_consistency: "一致性检查",
  consult_rules: "规则咨询",
  create_skill: "新建 Skill",
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

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.arguments);
  } catch {}

  const isAutoApplied = toolCall.status === ("auto_applied" as string);

  // Parse consistency report from result_summary if applicable
  let consistencyReport: ConsistencyReport | null = null;
  if (toolCall.name === "check_consistency" && toolCall.result_summary) {
    try {
      consistencyReport = JSON.parse(toolCall.result_summary) as ConsistencyReport;
    } catch {}
  }

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
        {statusIcon()}
        <span style={{ color: "var(--text)", fontWeight: 500 }}>{label}</span>
        {isAutoApplied && (
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 8,
            background: "rgba(82,201,126,0.15)", color: "#52c97e",
            border: "1px solid rgba(82,201,126,0.3)", flexShrink: 0,
          }}>
            已自动应用
          </span>
        )}
        {toolCall.result_summary && !isAutoApplied && !consistencyReport && (
          <span style={{ color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            — {toolCall.result_summary}
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
          ) : (
            <pre style={{
              fontSize: 10, margin: 0,
              color: "var(--text-muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {JSON.stringify(args, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
