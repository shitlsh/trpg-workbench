import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, AlertCircle, CheckCircle, Copy, Search, Brain, Save, Info } from "lucide-react";
import type { ToolCall, ConsistencyReport, ConsistencyIssue } from "@trpg-workbench/shared-schema";

const TOOL_LABELS: Record<string, string> = {
  list_assets: "列出资产",
  read_asset: "读取资产",
  grep_asset: "文内搜索",
  read_asset_section: "读取章节",
  search_assets: "搜索资产",
  read_config: "读取配置",
  search_knowledge: "检索知识库",
  get_asset_type_spec: "获取资产类型规范",
  create_asset: "新建资产",
  patch_asset: "局部修改资产",
  update_asset: "全量更新资产",
  delete_asset: "删除资产",
  move_asset: "移动/重命名资产",
  check_consistency: "一致性检查",
  consult_rules: "规则咨询",
  consult_lore: "世界观检索",
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

function KnowledgeResultView({ raw }: { raw: string; args: Record<string, unknown> }) {
  let results: Array<{ content?: string; document_name?: string; page_from?: number; page_to?: number }> = [];
  let message = "";
  let warning = "";
  try {
    const data = JSON.parse(raw);
    results = data.results ?? [];
    message = data.message as string ?? "";
    warning = data.warning as string ?? "";
  } catch {}

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      {message && <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 4 }}>{message}</div>}
      {warning && <div style={{ fontSize: 10, color: "var(--color-type-clue)", marginBottom: 4 }}>{warning}</div>}
      {results.length === 0 && !message && !warning && (
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
          <div style={{ color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflowY: "auto" }}>{r.content ?? ""}</div>
        </div>
      ))}
    </div>
  );
}

// Build a short inline description of args for display in the card header
function argsSummary(name: string, args: Record<string, unknown>): string | null {
  if (name === "search_knowledge" || name === "web_search") {
    const q = args.query as string;
    return q ? `"${q}"` : null;
  }
  if (name === "consult_rules" || name === "consult_lore") {
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
  if (name === "get_asset_type_spec" && args.type_key) {
    return String(args.type_key);
  }
  if (name === "read_config" && args.key) {
    return String(args.key);
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

// ─── Input / Output sections ──────────────────────────────────────────────────

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: "var(--text-subtle)",
  letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4,
};

function InputRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 11, marginBottom: 3, alignItems: "flex-start" }}>
      <span style={{ color: "var(--text-subtle)", flexShrink: 0, minWidth: 48 }}>{label}</span>
      <span style={{
        color: "var(--text)", wordBreak: "break-all",
        fontFamily: mono ? "var(--font-mono, monospace)" : undefined,
      }}>{value}</span>
    </div>
  );
}

function ToolInputView({ name, args }: { name: string; args: Record<string, unknown> }) {
  const show = (label: string, value: string | null | undefined, mono?: boolean) =>
    value ? <InputRow key={label} label={label} value={value} mono={mono} /> : null;

  const items: React.ReactNode[] = [];
  const add = (label: string, value: string | null | undefined, mono?: boolean) => {
    const el = show(label, value, mono);
    if (el) items.push(el);
  };

  switch (name) {
    case "search_knowledge":
      add("查询", args.query as string | undefined);
      if (args.chunk_types) add("类型过滤", args.chunk_types as string | undefined);
      break;
    case "web_search":
    case "search_assets":
      add("查询", args.query as string | undefined);
      break;
    case "read_asset":
    case "read_asset_section":
      add("资产", (args.asset_slug ?? args.slug) as string | undefined, true);
      if (name === "read_asset_section") add("章节", args.heading as string | undefined);
      break;
    case "grep_asset":
      add("资产", (args.asset_slug ?? args.slug) as string | undefined, true);
      add("搜索", args.pattern as string | undefined, true);
      break;
    case "list_assets":
      add("类型", args.asset_type as string | undefined);
      add("名称包含", args.name_contains as string | undefined);
      add("状态", args.status as string | undefined);
      if (args.limit != null) add("上限", String(args.limit));
      break;
    case "create_asset": {
      add("类型", args.asset_type as string | undefined);
      add("名称", (args.name ?? args.slug ?? args.asset_name) as string | undefined);
      const content = args.content_md ?? args.content;
      if (typeof content === "string") add("内容预览", content.slice(0, 80) + (content.length > 80 ? "…" : ""));
      break;
    }
    case "update_asset":
      add("资产", (args.asset_slug ?? args.slug) as string | undefined, true);
      if (typeof args.content_md === "string") add("内容预览", (args.content_md as string).slice(0, 80) + ((args.content_md as string).length > 80 ? "…" : ""));
      break;
    case "patch_asset":
      add("资产", (args.asset_slug ?? args.slug) as string | undefined, true);
      if (typeof args.old_str === "string" && args.old_str) {
        const t = String(args.old_str);
        add("替换前", t.length > 60 ? `${t.slice(0, 60)}…` : t, true);
      }
      if (typeof args.new_str === "string" && args.new_str) {
        const t = String(args.new_str);
        add("替换后", t.length > 60 ? `${t.slice(0, 60)}…` : t);
      }
      break;
    case "delete_asset":
      add("资产", (args.asset_slug ?? args.slug ?? args.asset_id) as string | undefined, true);
      break;
    case "move_asset":
      add("从", args.from_slug as string | undefined, true);
      add("到", args.to_slug as string | undefined, true);
      break;
    case "create_skill":
      add("意图", args.user_intent as string | undefined);
      break;
    case "check_consistency":
      add("检查范围", args.focus as string | undefined);
      break;
    case "read_config":
      add("配置项", args.key as string | undefined);
      break;
    case "get_asset_type_spec":
      add("资产类型", args.type_key as string | undefined);
      break;
    case "ask_user":
      if (Array.isArray(args.questions)) add("问题数量", `${args.questions.length} 道`);
      break;
    default:
      // Generic: show known args keys (non-empty strings)
      for (const [k, v] of Object.entries(args)) {
        if (typeof v === "string" && v) {
          add(k, v.length > 60 ? `${v.slice(0, 60)}…` : v);
        }
      }
  }

  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输入</div>
      {items}
    </div>
  );
}

function WriteResultView({ data }: { data: Record<string, unknown> }) {
  const success = data.success === true;
  const actionLabel = (data.action as string) === "created" ? "已创建" : "已更新";
  const slug = data.slug as string | undefined;
  const error = data.error as string | undefined;
  const changeSummary = data.change_summary as string | undefined;
  const assetName = data.asset_name as string | undefined;

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      {success ? (
        <div style={{ fontSize: 11 }}>
          <span style={{ color: "var(--success)", fontWeight: 600 }}>✅ {actionLabel}</span>
          {(slug || assetName) && (
            <span style={{ color: "var(--text-muted)", marginLeft: 6, fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}>
              {slug || assetName}
            </span>
          )}
          {changeSummary && (
            <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 2 }}>{changeSummary}</div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--danger)" }}>
          ❌ {error || "执行失败"}
        </div>
      )}
    </div>
  );
}

function SearchAssetsListView({ raw }: { raw: string }) {
  let items: Array<{ type?: string; name?: string; slug?: string; summary?: string }> = [];
  let message = "";
  let error = "";
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(data)) {
      items = data as typeof items;
    } else {
      items = (data.results ?? data.items) as typeof items ?? [];
      message = data.message as string ?? "";
      error = data.error as string ?? "";
    }
  } catch {}
  return <AssetsList items={items} message={message} error={error} />;
}

function AssetsList({ items, message, error }: {
  items: Array<{ type?: string; name?: string; slug?: string; summary?: string }>;
  message?: string;
  error?: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      {error ? (
        <div style={{ fontSize: 11, color: "var(--danger)" }}>{error}</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{message || "无结果"}</div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>{items.length} 项结果</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
            {items.map((item, i) => (
              <div key={i} style={{
                padding: "3px 6px", borderRadius: 3,
                background: "var(--bg)", border: "1px solid var(--border)", fontSize: 10,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {item.type && (
                    <span style={{ fontSize: 9, color: "var(--text-subtle)", background: "var(--bg-hover)", padding: "0 3px", borderRadius: 2 }}>
                      {item.type}
                    </span>
                  )}
                  <span style={{ color: "var(--text)", fontWeight: 500 }}>{item.name || item.slug}</span>
                </div>
                {item.summary && (
                  <div style={{ color: "var(--text-muted)", marginTop: 1, lineHeight: 1.3, maxHeight: 60, overflowY: "auto" }}>
                    {item.summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GrepResultView({ raw }: { raw: string }) {
  let data: { asset_slug?: string; pattern?: string; matches?: Array<{ line: number; context: string }>; message?: string; error?: string } = {};
  try { data = JSON.parse(raw) as typeof data; } catch {}

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      {data.error ? (
        <div style={{ fontSize: 11, color: "var(--danger)" }}>{data.error}</div>
      ) : !data.matches || data.matches.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{data.message || "未找到匹配"}</div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
            {data.matches.length} 处匹配
            {data.pattern && <span> · <code style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>{data.pattern}</code></span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {data.matches.slice(0, 10).map((m, i) => (
              <div key={i} style={{
                padding: "4px 6px", borderRadius: 3,
                background: "var(--bg)", border: "1px solid var(--border)", fontSize: 10,
              }}>
                <span style={{ color: "var(--text-subtle)", marginRight: 4, fontFamily: "var(--font-mono)" }}>L{m.line}</span>
                <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 60, overflowY: "auto" }}>
                  {m.context}
                </span>
              </div>
            ))}
            {data.matches.length > 10 && (
              <div style={{ fontSize: 9, color: "var(--text-subtle)" }}>… 还有 {data.matches.length - 10} 处匹配</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function WebSearchResultView({ raw }: { raw: string }) {
  let results: Array<{ title?: string; url?: string; snippet?: string }> = [];
  let note = "";
  let error = "";
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    results = (data.results ?? []) as typeof results;
    note = data.note as string ?? "";
    error = data.error as string ?? "";
  } catch {}

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      {error ? (
        <div style={{ fontSize: 11, color: "var(--danger)" }}>{error}</div>
      ) : results.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{note || "无搜索结果"}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {results.map((r, i) => (
            <div key={i} style={{ fontSize: 10 }}>
              <div style={{ color: "var(--accent)", fontWeight: 500 }}>{r.title || "无标题"}</div>
              {r.snippet && <div style={{ color: "var(--text-muted)", marginTop: 1, maxHeight: 80, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.snippet}</div>}
              {r.url && <div style={{ color: "var(--text-subtle)", fontSize: 9, wordBreak: "break-all" }}>{r.url}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConsultRulesView({ raw }: { raw: string }) {
  let suggestions: Array<{ text?: string; citation?: { document?: string; page_from?: number; page_to?: number }; has_citation?: boolean }> = [];
  let summary = "";
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    suggestions = (data.suggestions ?? []) as typeof suggestions;
    summary = data.summary as string ?? "";
  } catch {}

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      {summary && (
        <div style={{ fontSize: 11, color: "var(--text)", marginBottom: 6, fontWeight: 500, lineHeight: 1.5 }}>{summary}</div>
      )}
      {suggestions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 300, overflowY: "auto" }}>
          {suggestions.map((s, i) => (
            <div key={i} style={{
              padding: "6px 8px", borderRadius: 3,
              background: "var(--bg)", border: "1px solid var(--border)", fontSize: 10,
            }}>
              <div style={{ color: "var(--text-subtle)", fontSize: 9, marginBottom: 2 }}>建议 {i + 1}</div>
              <div style={{ color: "var(--text)", lineHeight: 1.5 }}>{s.text}</div>
              {s.has_citation && s.citation && (
                <div style={{ color: "var(--text-muted)", fontSize: 9, marginTop: 3 }}>
                  引用：{s.citation.document}{s.citation.page_from != null ? ` · p${s.citation.page_from}` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>无建议</div>
      )}
    </div>
  );
}

function ConsultLoreView({ raw }: { raw: string }) {
  let results: Array<{ content?: string; document_name?: string; page_from?: number; page_to?: number; chunk_type?: string }> = [];
  let summary = "";
  let message = "";
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    results = (data.results ?? []) as typeof results;
    summary = (data.summary as string) ?? "";
    message = (data.message as string) ?? "";
  } catch {}

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      {summary && (
        <div style={{ fontSize: 11, color: "var(--text)", marginBottom: 6, fontWeight: 500, lineHeight: 1.5 }}>{summary}</div>
      )}
      {message && <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 4 }}>{message}</div>}
      {results.length === 0 && !message && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>未找到相关世界观或剧情内容</div>
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
            {r.chunk_type && <span style={{ marginLeft: 4, opacity: 0.6 }}>[{r.chunk_type}]</span>}
          </div>
          <div style={{ color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflowY: "auto" }}>{r.content ?? ""}</div>
        </div>
      ))}
    </div>
  );
}

function ReadAssetResultView({ raw }: { raw: string }) {  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
        内容长度：{raw.length} 字
      </div>
      <div style={{
        padding: "6px 8px", borderRadius: 3,
        background: "var(--bg)", border: "1px solid var(--border)",
        fontSize: 11, lineHeight: 1.5, color: "var(--text)",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        maxHeight: 200, overflowY: "auto",
      }}>
        {raw}
      </div>
    </div>
  );
}

function GenericResultView({ resultSummary }: { resultSummary: string | null }) {
  if (!resultSummary) return null;
  let text = resultSummary;
  try {
    const data = JSON.parse(resultSummary) as Record<string, unknown>;
    if (data.error && typeof data.error === "string") {
      return (
        <div style={{ marginBottom: 6 }}>
          <div style={sectionHeaderStyle}>输出</div>
          <div style={{ fontSize: 11, color: "var(--danger)" }}>❌ {data.error}</div>
        </div>
      );
    }
    if (data.message && typeof data.message === "string") {
      return (
        <div style={{ marginBottom: 6 }}>
          <div style={sectionHeaderStyle}>输出</div>
          <div style={{ fontSize: 11, color: "var(--text)" }}>{data.message}</div>
        </div>
      );
    }
    if (data.summary && typeof data.summary === "string") {
      return (
        <div style={{ marginBottom: 6 }}>
          <div style={sectionHeaderStyle}>输出</div>
          <div style={{ fontSize: 11, color: "var(--text)" }}>{data.summary}</div>
        </div>
      );
    }
  } catch {
    // Not JSON — show raw text (likely read_asset markdown)
    return <ReadAssetResultView raw={text} />;
  }
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      <div style={{
        fontSize: 10, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word",
        maxHeight: 200, overflowY: "auto",
        padding: "6px 8px", borderRadius: 3,
        background: "var(--bg)", border: "1px solid var(--border)",
      }}>
        {text}
      </div>
    </div>
  );
}

function SpecConfigResultView({ raw }: { raw: string }) {
  let description = "";
  let template = "";
  let skills: Array<{ name?: string; description?: string }> = [];
  let rules = "";
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    description = data.description as string ?? "";
    template = data.template_md as string ?? "";
    if (Array.isArray(data.skills)) skills = data.skills as typeof skills;
    rules = data.rules_set as string ?? "";
  } catch {}

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={sectionHeaderStyle}>输出</div>
      {description && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>{description}</div>
      )}
      {rules && (
        <div style={{ fontSize: 10, color: "var(--text)", marginBottom: 4, fontWeight: 500 }}>规则集：{rules}</div>
      )}
      {skills.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
          Skill 列表（{skills.length}）：{skills.map((s) => s.name).join("、")}
        </div>
      )}
      {template && (
        <div style={{
          marginTop: 4, padding: "6px 8px", borderRadius: 3,
          background: "var(--bg)", border: "1px solid var(--border)",
          fontSize: 10, lineHeight: 1.4, color: "var(--text)",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          maxHeight: 200, overflowY: "auto",
          fontFamily: "var(--font-mono, monospace)",
        }}>
          {template}
        </div>
      )}
      {!description && !rules && skills.length === 0 && !template && (
        <div style={{ fontSize: 10, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto" }}>
          {raw}
        </div>
      )}
    </div>
  );
}

function ToolOutputView({ name, resultSummary, args, consistencyReport }: {
  name: string;
  resultSummary: string | null;
  args: Record<string, unknown>;
  consistencyReport: ConsistencyReport | null;
}) {
  if (!resultSummary) return null;
  if (consistencyReport) return <ConsistencyReportView report={consistencyReport} />;

  // Per-tool type specialized output
  switch (name) {
    case "search_knowledge":
      return <KnowledgeResultView raw={resultSummary} args={args} />;
    case "list_assets":
    case "search_assets":
      return <SearchAssetsListView raw={resultSummary} />;
    case "grep_asset":
      return <GrepResultView raw={resultSummary} />;
    case "web_search":
      return <WebSearchResultView raw={resultSummary} />;
    case "consult_rules":
      return <ConsultRulesView raw={resultSummary} />;
    case "consult_lore":
      return <ConsultLoreView raw={resultSummary} />;
    case "read_asset":
    case "read_asset_section":
      return <ReadAssetResultView raw={resultSummary} />;
    case "read_config":
    case "get_asset_type_spec":
      return <SpecConfigResultView raw={resultSummary} />;
    case "create_asset":
    case "patch_asset":
    case "update_asset":
    case "delete_asset":
    case "move_asset":
    case "create_skill": {
      try {
        const data = JSON.parse(resultSummary) as Record<string, unknown>;
        return <WriteResultView data={data} />;
      } catch {
        return <GenericResultView resultSummary={resultSummary} />;
      }
    }
    case "check_consistency":
      return null; // handled by consistencyReport above
    case "ask_user":
      return null; // handled by QuestionCard
    default:
      return <GenericResultView resultSummary={resultSummary} />;
  }
}

// ─── Trace log helpers ───────────────────────────────────────────────────────

function parseTimedTrace(line: string): { elapsedMs: number | null; text: string } {
  const m = line.match(/^\[\+(\d+)ms\]\s*(.*)$/);
  if (!m) return { elapsedMs: null, text: line };
  return { elapsedMs: Number(m[1]), text: m[2] || "" };
}

function traceGroupName(line: string): string {
  const t = line.toLowerCase();
  if (t.includes("检索") || t.includes("rag") || t.includes("引用")) return "检索";
  if (t.includes("推理") || t.includes("分析") || t.includes("生成")) return "推理";
  if (t.includes("写入") || t.includes("保存") || t.includes("执行") || t.includes("完成")) return "执行";
  return "其他";
}

function traceIcon(line: string) {
  const t = line.toLowerCase();
  if (t.includes("检索") || t.includes("rag") || t.includes("引用")) return <Search size={10} />;
  if (t.includes("推理") || t.includes("分析") || t.includes("生成")) return <Brain size={10} />;
  if (t.includes("写入") || t.includes("保存")) return <Save size={10} />;
  if (t.includes("完成") || t.includes("成功")) return <CheckCircle2 size={10} />;
  return <Info size={10} />;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>({});

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
  const knowledgeSummary = (toolCall.name === "search_knowledge" || toolCall.name === "consult_rules" || toolCall.name === "consult_lore") && toolCall.result_summary
    ? knowledgeResultSummary(toolCall.result_summary)
    : null;
  const genericSummary = !consistencyReport && !knowledgeSummary
    ? humanizeResultSummary(toolCall)
    : null;
  const traceLines = toolCall.trace_logs ?? [];
  const traceGroups = traceLines.reduce((acc, line) => {
    const key = traceGroupName(line);
    if (!acc[key]) acc[key] = [];
    acc[key].push(line);
    return acc;
  }, {} as Record<string, string[]>);

  useEffect(() => {
    if (toolCall.status === "running" && (toolCall.trace_logs?.length ?? 0) > 0) {
      setTraceExpanded(true);
      return;
    }
    if (toolCall.status !== "running") {
      setTraceExpanded(false);
    }
  }, [toolCall.status, toolCall.trace_logs]);

  useEffect(() => {
    if (!traceExpanded) return;
    const next: Record<string, boolean> = {};
    Object.keys(traceGroups).forEach((k) => { next[k] = true; });
    setGroupExpanded(next);
  }, [traceExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

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
      border: `1px solid ${isAutoApplied ? "rgba(82,201,126,0.65)" : "var(--border)"}`,
      borderRadius: 4,
      overflow: "hidden",
      fontSize: 11,
      boxShadow: isAutoApplied ? "0 0 0 1px rgba(82,201,126,0.2) inset" : "none",
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: isAutoApplied ? "rgba(82,201,126,0.12)" : "var(--bg)",
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
            background: "rgba(82,201,126,0.22)", color: "#52c97e",
            border: "1px solid rgba(82,201,126,0.45)",
          }}>
            已自动写入
          </span>
        )}
        {genericSummary && !isAutoApplied && !consistencyReport && !knowledgeSummary && (
          <span style={{ color: "var(--text-subtle)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            — {genericSummary}
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
          <ToolInputView name={toolCall.name} args={args} />
          {toolCall.status !== "running" && (
            <ToolOutputView
              name={toolCall.name}
              resultSummary={toolCall.result_summary}
              args={args}
              consistencyReport={consistencyReport}
            />
          )}
          {toolCall.status === "error" && toolCall.result_summary && !consistencyReport && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try { await navigator.clipboard.writeText(toolCall.result_summary || ""); } catch {}
              }}
              style={{
                marginTop: 4,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10,
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              <Copy size={10} />
              复制错误详情
            </button>
          )}
          {toolCall.trace_logs && toolCall.trace_logs.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
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
                <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 6 }}>
                  {Object.entries(traceGroups).map(([group, lines]) => (
                    <div key={group}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setGroupExpanded((prev) => ({ ...prev, [group]: !prev[group] }));
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          border: "none",
                          background: "none",
                          color: "var(--text-subtle)",
                          cursor: "pointer",
                          fontSize: 10,
                          padding: 0,
                        }}
                      >
                        {groupExpanded[group] ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                        <span>{group}（{lines.length}）</span>
                      </button>
                      {groupExpanded[group] && (
                        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                          {lines.map((line, idx) => {
                            const parsed = parseTimedTrace(line);
                            return (
                              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)" }}>
                                <span style={{ opacity: 0.9 }}>{traceIcon(parsed.text)}</span>
                                {parsed.elapsedMs != null && (
                                  <span style={{ color: "var(--text-subtle)", minWidth: 56 }}>+{parsed.elapsedMs}ms</span>
                                )}
                                <span>{parsed.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
