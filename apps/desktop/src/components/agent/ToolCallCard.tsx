import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Clock, Zap } from "lucide-react";
import type { ToolCall } from "@trpg-workbench/shared-schema";

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

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.arguments);
  } catch {}

  const isAutoApplied = toolCall.status === ("auto_applied" as string);

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
        {toolCall.result_summary && !isAutoApplied && (
          <span style={{ color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            — {toolCall.result_summary}
          </span>
        )}
      </button>
      {expanded && (
        <div style={{ padding: "6px 8px", background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
          <pre style={{
            fontSize: 10, margin: 0,
            color: "var(--text-muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
