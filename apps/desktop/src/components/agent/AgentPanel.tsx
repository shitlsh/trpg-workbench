import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Plus, ShieldCheck, RefreshCw, BookOpen, FileText, ChevronDown, ChevronUp } from "lucide-react";
import type {
  ChatSession, ChatMessage, WorkflowState,
  ChangePlan, ConsistencyReport, PatchProposal,
  LLMProfile, ModelCatalogEntry, ClarificationQuestion, RulesSuggestion,
  AssetWithContent,
} from "@trpg-workbench/shared-schema";
import { useAgentStore } from "@/stores/agentStore";
import { useEditorStore } from "@/stores/editorStore";
import { WorkflowProgress } from "./WorkflowProgress";
import { PatchConfirmDialog } from "./PatchConfirmDialog";
import { ClarificationCard } from "./ClarificationCard";
import ContextUsageBadge from "./ContextUsageBadge";
import { apiFetch } from "@/lib/api";
import { getAssetTypeIcon, getAssetTypeColor, getAssetTypeLabel } from "@/lib/assetTypeVisual";

// ─── Layered AI response display ──────────────────────────────────────────────

function ChangePlanView({ plan }: { plan: ChangePlan }) {
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ marginBottom: 6, color: "var(--text)" }}>{plan.change_plan}</div>
      {plan.affected_asset_types.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)" }}>涉及资产：</span>
          {plan.affected_asset_types.map((t) => {
            const TypeIcon = getAssetTypeIcon(t);
            const typeColor = getAssetTypeColor(t);
            return (
              <span key={t} style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                marginRight: 4, padding: "1px 6px",
                background: "var(--bg-hover)", borderRadius: 3, fontSize: 11,
                color: typeColor,
              }}>
                <TypeIcon size={10} />
                {getAssetTypeLabel(t)}
              </span>
            );
          })}
        </div>
      )}
      {plan.workflow && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Workflow：{WORKFLOW_LABELS[plan.workflow] ?? plan.workflow}
        </div>
      )}
    </div>
  );
}

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  error:   { bg: "#2a0a0a", border: "#e05252", text: "#e05252", label: "错误" },
  warning: { bg: "#2a1f00", border: "#f0a500", text: "#f0a500", label: "警告" },
  info:    { bg: "#0a1a2a", border: "#4a90d9", text: "#4a90d9", label: "提示" },
};

function RulesReviewView({
  suggestions, summary, onApply,
}: {
  suggestions: RulesSuggestion[];
  summary: string;
  onApply: (suggestion: RulesSuggestion) => void;
}) {
  const sorted = [...suggestions].sort((a, b) => {
    const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
    return (order[a.severity ?? "info"] ?? 2) - (order[b.severity ?? "info"] ?? 2);
  });
  return (
    <div>
      {summary && (
        <div style={{ fontSize: 12, marginBottom: 8, color: "var(--text-muted)" }}>{summary}</div>
      )}
      {sorted.map((s, i) => {
        const sev = (s.severity ?? "info") as keyof typeof SEVERITY_COLORS;
        const colors = SEVERITY_COLORS[sev] ?? SEVERITY_COLORS.info;
        return (
          <div key={i} style={{
            padding: "8px 10px", marginBottom: 6,
            background: colors.bg, border: `1px solid ${colors.border}`,
            borderRadius: 4, fontSize: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, padding: "1px 5px", borderRadius: 10, fontWeight: 600,
                background: colors.border + "33", color: colors.text,
              }}>{colors.label}</span>
              {s.affected_field && (
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                  {s.affected_field}
                </span>
              )}
            </div>
            <div style={{ lineHeight: 1.6, marginBottom: 4 }}>{s.text}</div>
            {s.suggestion_patch && (
              <div style={{
                padding: "4px 8px", background: "rgba(0,0,0,0.3)", borderRadius: 3,
                fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", marginBottom: 4,
              }}>
                {s.suggestion_patch}
              </div>
            )}
            {s.citation ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                来源：{s.citation.document}，第 {s.citation.page_from}–{s.citation.page_to} 页
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                基于通用经验，未找到对应规则原文
              </div>
            )}
            <button
              onClick={() => onApply(s)}
              style={{
                marginTop: 6, fontSize: 11, padding: "2px 8px",
                background: "var(--bg-hover)", border: "1px solid var(--border)",
                borderRadius: 3, cursor: "pointer", color: "var(--text)",
              }}
            >应用此建议</button>
          </div>
        );
      })}
    </div>
  );
}

function ConsistencyView({
  report, onAutoFix,
}: {
  report: ConsistencyReport;
  onAutoFix?: (suggestion: string) => void;
}) {
  if (report.overall_status === "clean") {
    return <div style={{ fontSize: 12, color: "#52c97e" }}>✓ 一致性检查通过，未发现问题</div>;
  }
  return (
    <div>
      {report.issues.map((issue, i) => (
        <div key={i} style={{
          padding: "6px 8px", marginBottom: 4,
          background: issue.severity === "error" ? "#2a0a0a" : "#2a1f00",
          border: `1px solid ${issue.severity === "error" ? "#e05252" : "#f0a500"}`,
          borderRadius: 4, fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, color: issue.severity === "error" ? "#e05252" : "#f0a500" }}>
            {ISSUE_TYPE_LABELS[issue.type] ?? issue.type} · {issue.severity === "error" ? "错误" : "警告"}
          </div>
          <div style={{ marginTop: 3 }}>{issue.description}</div>
          {issue.suggestion && (
            <div style={{ marginTop: 3, color: "var(--text-muted)" }}>建议：{issue.suggestion}</div>
          )}
          {issue.auto_fixable && issue.suggested_fix && onAutoFix && (
            <button
              onClick={() => onAutoFix(issue.suggested_fix!)}
              style={{
                marginTop: 5, fontSize: 11, padding: "2px 8px",
                background: "#1a3a1a", border: "1px solid #52c97e",
                borderRadius: 3, cursor: "pointer", color: "#52c97e",
              }}
            >一键修复</button>
          )}
        </div>
      ))}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  let changePlan: ChangePlan | null = null;
  if (msg.tool_calls_json) {
    try { changePlan = JSON.parse(msg.tool_calls_json); } catch {}
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: "88%",
        padding: "8px 12px",
        borderRadius: isUser ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
        background: isUser ? "var(--accent)" : "var(--bg-surface)",
        border: isUser ? "none" : "1px solid var(--border)",
        fontSize: 13,
        lineHeight: 1.6,
      }}>
        {isUser ? (
          <span>{msg.content}</span>
        ) : (
          <div>
            {msg.content && <div style={{ marginBottom: changePlan ? 8 : 0 }}>{msg.content}</div>}
            {changePlan && <ChangePlanView plan={changePlan} />}
          </div>
        )}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, paddingInline: 4 }}>
        {new Date(msg.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

// ─── Log Entry ────────────────────────────────────────────────────────────────

const LOG_TYPE_ICONS: Record<string, string> = {
  model_call: "🤖",
  retrieval: "🔍",
  asset_write: "💾",
};

function LogEntry({ entry }: { entry: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const type = entry.type as string;
  const ts = entry.timestamp as string;
  const time = ts ? new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

  let summary = "";
  if (type === "model_call") {
    summary = `${entry.provider}/${entry.model} · ${entry.total_tokens} tokens · ${entry.duration_ms}ms`;
    if (entry.agent) summary = `[${entry.agent}] ` + summary;
  } else if (type === "retrieval") {
    summary = `检索 ${entry.result_count} 条 · ${(entry.query as string)?.slice(0, 40)}`;
  } else if (type === "asset_write") {
    summary = `${entry.asset_type} "${entry.asset_name}" v${entry.revision_version} · ${entry.source_type}`;
  }

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        padding: "4px 0", borderBottom: "1px solid var(--border)",
        cursor: "pointer", fontSize: 11,
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span>{LOG_TYPE_ICONS[type] ?? "📝"}</span>
        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{time}</span>
        <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
      </div>
      {expanded && (
        <pre style={{
          marginTop: 4, padding: 6, background: "var(--bg)",
          border: "1px solid var(--border)", borderRadius: 3,
          fontSize: 10, whiteSpace: "pre-wrap", color: "var(--text-muted)",
          maxHeight: 120, overflowY: "auto",
        }}>
          {JSON.stringify(entry, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Main AgentPanel ──────────────────────────────────────────────────────────

export function AgentPanel({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const {
    session, messages, isTyping,
    setSession, addMessage, setMessages, setTyping,
    activeWorkflow, setActiveWorkflow, setWorkflowPolling,
    consistencyReport, setConsistencyReport,
    pendingPatches, showPatchDialog, setPendingPatches,
  } = useAgentStore();
  const { openTab } = useEditorStore();

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [rulesReview, setRulesReview] = useState<{ suggestions: RulesSuggestion[]; summary: string } | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [modelWarning, setModelWarning] = useState<string | null>(null);
  const [clarificationQuestions, setClarificationQuestions] = useState<ClarificationQuestion[] | null>(null);
  const [clarificationPreliminaryPlan, setClarificationPreliminaryPlan] = useState<string | null>(null);
  const [clarificationWorkflowId, setClarificationWorkflowId] = useState<string | null>(null);
  const [isSubmittingClarification, setIsSubmittingClarification] = useState(false);

  // Load workspace to check model configuration
  const { data: workspace } = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => apiFetch<{ default_llm_profile_id: string | null }>(`/workspaces/${workspaceId}`),
    enabled: !!workspaceId,
  });

  // Load LLM profile and catalog to get context_window for badge
  const { data: llmProfiles = [] } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
    enabled: !!workspace?.default_llm_profile_id,
  });
  const activeProfile = llmProfiles.find((p) => p.id === workspace?.default_llm_profile_id);

  const { data: catalogEntry } = useQuery({
    queryKey: ["model-catalog-entry", activeProfile?.provider_type, activeProfile?.model_name],
    queryFn: () => apiFetch<ModelCatalogEntry[]>(`/settings/model-catalog?provider_type=${activeProfile!.provider_type}`).then(
      (entries) => entries.find((e) => e.model_name === activeProfile!.model_name) ?? null
    ),
    enabled: !!activeProfile,
  });

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping, activeWorkflow]);

  // Ensure a session exists
  useEffect(() => {
    if (!session) {
      setSessionError(null);
      apiFetch<ChatSession>("/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace_id: workspaceId }),
      }).then((s) => {
        setSession(s);
        setMessages([]);
      }).catch((e) => {
        setSessionError(e?.message ?? "无法连接到后端，请检查服务状态");
      });
    }
  }, [workspaceId]);

  const handleClarificationSubmit = async (answers: Record<string, string | string[]>) => {
    if (!clarificationWorkflowId) return;
    setIsSubmittingClarification(true);
    try {
      const wf = await apiFetch<WorkflowState>(`/workflows/${clarificationWorkflowId}/clarify`, {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      setClarificationQuestions(null);
      setClarificationPreliminaryPlan(null);
      setActiveWorkflow(wf);
      setWorkflowPolling(true);
    } catch {
      // silently ignore
    } finally {
      setIsSubmittingClarification(false);
    }
  };

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!session) throw new Error("No session");
      return apiFetch<{
        user_message: ChatMessage;
        assistant_message: ChatMessage;
        change_plan: ChangePlan;
        workflow_id: string | null;
      }>(`/chat/sessions/${session.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, workspace_id: workspaceId }),
      });
    },
    onMutate: () => setTyping(true),
    onSuccess: async (data) => {
      addMessage(data.user_message);
      addMessage(data.assistant_message);

      // If plan requires a workflow, start it
      const plan = data.change_plan;
      if (plan.requires_user_confirm && plan.workflow) {
        try {
          const wf = await apiFetch<WorkflowState>("/workflows", {
            method: "POST",
            body: JSON.stringify({
              type: plan.workflow,
              workspace_id: workspaceId,
              input: { user_intent: input },
            }),
          });
          setActiveWorkflow(wf);
          if (wf.status === "waiting_for_clarification" && wf.clarification_questions) {
            setClarificationWorkflowId(wf.id);
            setClarificationQuestions(wf.clarification_questions);
            setClarificationPreliminaryPlan(null);
            setWorkflowPolling(false); // don't poll until user answers
          } else {
            setWorkflowPolling(true);
          }
        } catch {}
      }
    },
    onSettled: () => setTyping(false),
  });

  const handleSend = () => {
    const content = input.trim();
    if (!content) return;
    // Pre-flight check: warn if no LLM configured
    if (workspace && !workspace.default_llm_profile_id) {
      setModelWarning("未配置默认 LLM。请前往工作空间设置 → 模型路由完成配置后再发送。");
      return;
    }
    setModelWarning(null);
    setInput("");
    sendMutation.mutate(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const { data: logsData } = useQuery({
    queryKey: ["logs", workspaceId],
    queryFn: () => apiFetch<{ entries: Array<Record<string, unknown>>; count: number }>(`/workspaces/${workspaceId}/logs`),
    enabled: logsOpen,
    refetchInterval: logsOpen ? 5000 : false,
  });

  const handleConsistencyCheck = async () => {
    try {
      const report = await apiFetch<ConsistencyReport>(`/workspaces/${workspaceId}/consistency-check`);
      setConsistencyReport(report);
    } catch {}
  };

  const handleRulesReview = async () => {
    const question = input.trim() || "请检查当前 Workspace 中的资产是否符合规则，给出建议";
    try {
      const wf = await apiFetch<{ id: string }>("/workflows", {
        method: "POST",
        body: JSON.stringify({ type: "rules_review", workspace_id: workspaceId, input: { user_intent: question, asset_ids: [] } }),
      });
      // Poll until completed then fetch suggestions
      const poll = async (): Promise<void> => {
        const state = await apiFetch<{ status: string; id: string }>(`/workflows/${wf.id}`);
        if (state.status === "completed") {
          const result = await apiFetch<{ suggestions: RulesSuggestion[]; summary: string }>(`/workflows/${wf.id}/rules-suggestions`);
          setRulesReview(result);
        } else if (state.status === "running" || state.status === "pending") {
          setTimeout(poll, 2000);
        }
      };
      await poll();
    } catch {}
  };

  const handleNewAsset = () => {
    // Focus the left panel new asset button via a synthetic intent
    sendMutation.mutate("请帮我新建一个资产");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px", fontWeight: 600, fontSize: 13,
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>AI 助手</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            onClick={() => { setSession(null); setMessages([]); setActiveWorkflow(null); }}
            title="新建对话"
            style={{ background: "none", color: "var(--text-muted)", padding: 2 }}
          ><RefreshCw size={13} /></button>
        </div>
      </div>

      {/* Messages + workflow */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 24 }}>
            在下方输入创作请求，例如：<br />
            "帮我创建一个 COC 乡村调查模组"<br />
            "把第一幕改得更压抑一点"
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {isTyping && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "4px 0" }}>
            AI 思考中...
          </div>
        )}

        {sendMutation.isError && (
          <div style={{
            padding: "6px 10px", marginBottom: 6,
            background: "#2a0a0a", border: "1px solid #e05252",
            borderRadius: 4, fontSize: 12, color: "#e05252",
          }}>
            发送失败：{(sendMutation.error as Error).message}
          </div>
        )}

        {activeWorkflow && (
          <WorkflowProgress
            onPatchesReady={(patches) => {
              setPendingPatches(patches as PatchProposal[], true);
            }}
            onComplete={async () => {
              qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
              // Auto-open the first written asset in the editor
              try {
                const logsResp = await apiFetch<{ entries: Array<Record<string, unknown>>; count: number }>(
                  `/workspaces/${workspaceId}/logs`
                );
                const writtenIds: string[] = [];
                for (const entry of logsResp.entries) {
                  if (entry.type === "asset_write" && entry.asset_id && !writtenIds.includes(entry.asset_id as string)) {
                    writtenIds.push(entry.asset_id as string);
                  }
                }
                if (writtenIds.length > 0) {
                  const asset = await apiFetch<AssetWithContent>(`/assets/${writtenIds[0]}`);
                  openTab(asset);
                }
              } catch {
                // Non-critical: silently ignore if auto-open fails
              }
            }}
          />
        )}

        {clarificationQuestions && (
          <ClarificationCard
            questions={clarificationQuestions}
            preliminaryPlan={clarificationPreliminaryPlan}
            onSubmit={handleClarificationSubmit}
            isSubmitting={isSubmittingClarification}
          />
        )}

        {consistencyReport && (
          <div style={{
            marginTop: 8, padding: "8px 10px",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>一致性检查结果</div>
            <ConsistencyView
              report={consistencyReport}
              onAutoFix={(fix) => setInput(`请根据以下一致性修复建议修改相关资产：${fix}`)}
            />
            <button
              onClick={() => setConsistencyReport(null)}
              style={{ marginTop: 6, fontSize: 11, background: "none", color: "var(--text-muted)" }}
            >关闭</button>
          </div>
        )}

        {rulesReview && (
          <div style={{
            marginTop: 8, padding: "8px 10px",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>规则审查建议</div>
            <RulesReviewView
              suggestions={rulesReview.suggestions}
              summary={rulesReview.summary}
              onApply={(s) => {
                setInput(`请根据以下规则建议修改相关资产：${s.text}`);
                setRulesReview(null);
              }}
            />
            <button
              onClick={() => setRulesReview(null)}
              style={{ marginTop: 6, fontSize: 11, background: "none", color: "var(--text-muted)" }}
            >关闭</button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Execution log panel (collapsible) */}
      <div style={{ borderTop: "1px solid var(--border)" }}>
        <button
          onClick={() => setLogsOpen(!logsOpen)}
          style={{
            width: "100%", padding: "6px 12px",
            display: "flex", alignItems: "center", gap: 6,
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", fontSize: 11, textAlign: "left",
          }}
        >
          <FileText size={11} />
          执行日志
          <span style={{ marginLeft: "auto" }}>
            {logsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </span>
        </button>
        {logsOpen && (
          <div style={{
            maxHeight: 200, overflowY: "auto", padding: "0 12px 8px",
          }}>
            {!logsData || logsData.count === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>今日暂无日志</div>
            ) : (
              logsData.entries.slice(-30).reverse().map((entry, i) => (
                <LogEntry key={i} entry={entry} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div style={{
        padding: "6px 12px", borderTop: "1px solid var(--border)",
        display: "flex", gap: 6, flexWrap: "wrap",
      }}>
        <button onClick={handleNewAsset} style={quickBtn}>
          <Plus size={11} /> 新建资产
        </button>
        <button onClick={handleConsistencyCheck} style={quickBtn}>
          <ShieldCheck size={11} /> 一致性检查
        </button>
        <button onClick={handleRulesReview} style={quickBtn}>
          <BookOpen size={11} /> 规则审查
        </button>
      </div>

      {/* Model warning */}
      {modelWarning && (
        <div style={{ padding: "6px 12px", background: "rgba(240,165,0,0.1)", borderTop: "1px solid rgba(240,165,0,0.3)", fontSize: 12, color: "#f0a500", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{modelWarning}</span>
          <button onClick={() => setModelWarning(null)} style={{ background: "none", color: "#f0a500", fontSize: 12, padding: "2px 6px" }}>✕</button>
        </div>
      )}

      {/* Context usage badge */}
      {messages.length > 0 && (
        <div style={{ padding: "0 12px" }}>
          <ContextUsageBadge
            messages={messages.map((m) => m.content)}
            contextWindow={catalogEntry?.context_window ?? null}
          />
        </div>
      )}

      {/* Session error */}
      {sessionError && (
        <div style={{ padding: "6px 12px", background: "#2a0a0a", color: "#e05252", fontSize: 12 }}>
          {sessionError}
        </div>
      )}

      {/* Input area */}
      <div style={{
        padding: "8px 12px", borderTop: "1px solid var(--border)",
        display: "flex", gap: 8, alignItems: "flex-end",
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter 发送，Shift+Enter 换行"
          rows={3}
          style={{
            flex: 1, resize: "none", padding: "8px",
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 6, color: "var(--text)", fontSize: 13, lineHeight: 1.5,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sendMutation.isPending || !session}
          style={{
            padding: "8px", borderRadius: 6,
            background: input.trim() ? "var(--accent)" : "var(--bg-hover)",
            color: "#fff", cursor: "pointer", flexShrink: 0,
          }}
        >
          <Send size={16} />
        </button>
      </div>

      {/* Patch confirm dialog */}
      {showPatchDialog && pendingPatches.length > 0 && (
        <PatchConfirmDialog
          patches={pendingPatches}
          workflowId={activeWorkflow?.id}
          onDone={() => {}}
        />
      )}
    </div>
  );
}

const quickBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  padding: "3px 8px", borderRadius: 4, fontSize: 11,
  background: "var(--bg-surface)", border: "1px solid var(--border)",
  color: "var(--text-muted)", cursor: "pointer",
};

const WORKFLOW_LABELS: Record<string, string> = {
  create_module: "新建模组",
  modify_asset: "修改资产",
  rules_review: "规则审查",
  generate_image: "图像生成",
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  naming_conflict: "命名冲突",
  timeline_conflict: "时间线冲突",
  motivation_gap: "动机缺口",
  clue_break: "线索断裂",
  branch_conflict: "分支冲突",
};
