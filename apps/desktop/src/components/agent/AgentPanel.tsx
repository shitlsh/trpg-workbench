import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Plus, ShieldCheck, RefreshCw } from "lucide-react";
import type {
  ChatSession, ChatMessage, WorkflowState,
  ChangePlan, ConsistencyReport, PatchProposal,
} from "@trpg-workbench/shared-schema";
import { useAgentStore } from "@/stores/agentStore";
import { WorkflowProgress } from "./WorkflowProgress";
import { PatchConfirmDialog } from "./PatchConfirmDialog";
import { apiFetch } from "@/lib/api";

// ─── Layered AI response display ──────────────────────────────────────────────

function ChangePlanView({ plan }: { plan: ChangePlan }) {
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ marginBottom: 6, color: "var(--text)" }}>{plan.change_plan}</div>
      {plan.affected_asset_types.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)" }}>涉及资产：</span>
          {plan.affected_asset_types.map((t) => (
            <span key={t} style={{
              display: "inline-block", marginRight: 4, padding: "1px 6px",
              background: "var(--bg-hover)", borderRadius: 3, fontSize: 11,
            }}>{t}</span>
          ))}
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

function ConsistencyView({ report }: { report: ConsistencyReport }) {
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

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping, activeWorkflow]);

  // Ensure a session exists
  useEffect(() => {
    if (!session) {
      apiFetch<ChatSession>("/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace_id: workspaceId }),
      }).then((s) => {
        setSession(s);
        setMessages([]);
      }).catch(() => {});
    }
  }, [workspaceId]);

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
          setWorkflowPolling(true);
        } catch {}
      }
    },
    onSettled: () => setTyping(false),
  });

  const handleSend = () => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    sendMutation.mutate(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleConsistencyCheck = async () => {
    try {
      const report = await apiFetch<ConsistencyReport>(`/workspaces/${workspaceId}/consistency-check`);
      setConsistencyReport(report);
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

        {activeWorkflow && (
          <WorkflowProgress
            onPatchesReady={(patches) => {
              setPendingPatches(patches as PatchProposal[], true);
            }}
            onComplete={() => {
              qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
            }}
          />
        )}

        {consistencyReport && (
          <div style={{
            marginTop: 8, padding: "8px 10px",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>一致性检查结果</div>
            <ConsistencyView report={consistencyReport} />
            <button
              onClick={() => setConsistencyReport(null)}
              style={{ marginTop: 6, fontSize: 11, background: "none", color: "var(--text-muted)" }}
            >关闭</button>
          </div>
        )}

        <div ref={bottomRef} />
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
      </div>

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
          disabled={!input.trim() || sendMutation.isPending}
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
