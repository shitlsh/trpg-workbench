import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  RefreshCw, FileText, ChevronDown, ChevronUp, MessageSquare, Brain,
} from "lucide-react";
import { useModelList } from "../../hooks/useModelList";
import { useAgentStore } from "@/stores/agentStore";
import type {
  ChatSession, ChatSessionCreate, ChatMessage, ToolCall,
  LLMProfile, WorkspaceConfigResponse,
  AgentQuestion, AgentPlan, AgentPlanUpdate, PlanStepStatus,
} from "@trpg-workbench/shared-schema";
import { QuestionCard } from "./QuestionCard";
import { PlanCard } from "./PlanCard";
import { ToolCallCard, GroupedToolCallCard } from "./ToolCallCard";
import { MentionInput } from "./MentionInput";
import { SessionDrawer } from "./SessionDrawer";
import { apiFetch, resolveBackendUrl } from "@/lib/api";

/** Infer display tool name from parsed write-result JSON when there was no `tool_call_start`. */
function toolNameFromWriteResultPayload(data: { action?: string; asset_type?: string }): string {
  const act = data.action;
  if (act === "deleted") return "delete_asset";
  if (data.asset_type === "skill" && act === "created") return "create_skill";
  if (act === "updated") return "update_asset";
  if (act === "created") return "create_asset";
  return "create_asset";
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

// Renders assistant content, preserving tool-call ordering via {{tool:id}} placeholders.
// Falls back to legacy rendering (all tool cards below text) for old messages without placeholders.
function AssistantContent({ content, toolCalls }: { content: string; toolCalls: ToolCall[] }) {
  const tcById = Object.fromEntries(toolCalls.map((tc) => [tc.id, tc]));

  if (!content.includes("{{tool:")) {
    // Legacy / no-placeholder path
    return (
      <>
        {content && (
          <div className="agent-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
        {toolCalls.length > 0 && (
          <div style={{ marginTop: content ? 8 : 0 }}>
            {toolCalls.map((tc) => <ToolCallCard key={tc.id} toolCall={tc} />)}
          </div>
        )}
      </>
    );
  }

  // Placeholder path: interleave text segments and tool cards in order
  const parts = content.split(/(\{\{tool:[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\{\{tool:(.+)\}\}$/);
        if (match) {
          const tc = tcById[match[1]];
          return tc ? <ToolCallCard key={`tc_${i}`} toolCall={tc} /> : null;
        }
        const trimmed = part.trim();
        if (!trimmed) return null;
        return (
          <div key={i} className="agent-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
          </div>
        );
      })}
    </>
  );
}

function StoredMessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  // System messages (e.g. truncation notices) render as a centered divider
  if (msg.role === "system") {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBlock: 12,
        color: "var(--text-subtle)",
        fontSize: 11,
      }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span>{msg.content}</span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
    );
  }

  let toolCalls: ToolCall[] = [];
  if (msg.tool_calls_json) {
    try { toolCalls = JSON.parse(msg.tool_calls_json); } catch {}
  }

  if (isUser) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        marginBottom: 10,
      }}>
        <div style={{
          maxWidth: "88%",
          padding: "8px 12px",
          borderRadius: "12px 12px 4px 12px",
          background: "var(--accent)",
          fontSize: 13,
          lineHeight: 1.6,
          color: "#fff",
        }}>
          <div>{msg.content}</div>
        </div>
        <div
          title={new Date(msg.created_at).toLocaleString("zh-CN")}
          style={{ fontSize: 10, color: "var(--text-subtle)", marginTop: 2, paddingInline: 4, cursor: "default" }}
        >
          {new Date(msg.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    );
  }

  // Assistant reply — no bubble, content flows directly
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      marginBottom: 14,
    }}>
      <div style={{
        maxWidth: "96%",
        fontSize: 13,
        lineHeight: 1.6,
        color: "var(--text)",
      }}>
        {msg.thinking_json && (
          <ThinkingBlock content={msg.thinking_json} />
        )}
        <AssistantContent content={msg.content ?? ""} toolCalls={toolCalls} />
      </div>
      <div
        title={new Date(msg.created_at).toLocaleString("zh-CN")}
        style={{ fontSize: 10, color: "var(--text-subtle)", marginTop: 4, paddingInline: 0, cursor: "default" }}
      >
        {new Date(msg.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

type StreamEvent =
  | { kind: "text_chunk"; text: string }
  | { kind: "tool_call"; toolCall: ToolCall }
  | { kind: "question_interrupt"; question: AgentQuestion }
  | { kind: "thinking_chunk"; text: string; done: boolean }
  | { kind: "plan"; plan: AgentPlan }
  | { kind: "agent_status"; message: string };

// ─── ThinkingBlock ────────────────────────────────────────────────────────────

function ThinkingBlock({
  content, streaming, duration,
}: {
  content: string;
  streaming?: boolean;
  duration?: number | null;
}) {
  const [expanded, setExpanded] = useState(!!streaming);
  const preRef = useRef<HTMLPreElement>(null);

  // Auto-expand when streaming starts; auto-collapse when streaming ends
  useEffect(() => {
    if (streaming) setExpanded(true);
    else setExpanded(false);
  }, [streaming]);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (streaming && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content, streaming]);

  const headerLabel = duration != null && !streaming
    ? `推理 ${duration}s`
    : "推理过程";
  const firstLine = (content || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  const summary = firstLine.length > 28 ? `${firstLine.slice(0, 28)}…` : firstLine;

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "none", border: "none", cursor: "pointer",
          padding: "2px 0",
          color: "var(--text-muted)", fontSize: 11,
        }}
      >
        <Brain size={11} style={{ flexShrink: 0 }} />
        <span>{headerLabel}</span>
        {!expanded && summary && (
          <span style={{ color: "var(--text-subtle)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            · {summary}
          </span>
        )}
        {!streaming && content && (
          <span style={{ color: "var(--text-subtle)", fontSize: 10 }}>
            · {content.length} 字
          </span>
        )}
        {streaming && (
          <span style={{
            display: "inline-block", width: 5, height: 5,
            borderRadius: "50%", background: "var(--accent)",
            marginLeft: 2, animation: "blink 1s step-end infinite",
          }} />
        )}
        {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {expanded && (
        <pre ref={preRef} style={{
          margin: "4px 0 0",
          padding: "6px 8px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text-subtle, var(--text-muted))",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 300,
          overflowY: "auto",
        }}>
          {content}
          {streaming && (
            <span style={{
              display: "inline-block", width: 5, height: 11,
              background: "var(--text-muted)", marginLeft: 2,
              verticalAlign: "text-bottom", animation: "blink 1s step-end infinite",
            }} />
          )}
        </pre>
      )}
    </div>
  );
}

function StreamingBubble({
  events, isStreaming, onQuestionSubmit,
}: {
  events: StreamEvent[];
  isStreaming: boolean;
  onQuestionSubmit: (answers: Record<string, string[]>) => void;
}) {
  const lastTextIdx = events.reduce((last, e, i) => e.kind === "text_chunk" ? i : last, -1);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      marginBottom: 14,
    }}>
      <div style={{
        maxWidth: "96%",
        fontSize: 13,
        lineHeight: 1.6,
      }}>
        {lastTextIdx === -1 && isStreaming && (
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            思考中
            <span style={{ display: "inline-flex", gap: 3, marginLeft: 3 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{
                  display: "inline-block",
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--text-muted)",
                  animation: `thinking-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </span>
          </span>
        )}
        {(() => {
          // Pre-process: group consecutive completed tool_call events of the same name (≥2).
          // running tool calls are always rendered individually (sticky bottom effect).
          type RenderEntry =
            | { kind: "skip" }
            | { kind: "group_start"; groupKey: string; toolCalls: import("@trpg-workbench/shared-schema").ToolCall[] }
            | { kind: "passthrough" };

          const renderHints: RenderEntry[] = events.map(() => ({ kind: "passthrough" as const }));

          let ei = 0;
          while (ei < events.length) {
            const e = events[ei];
            if (e.kind === "tool_call" && e.toolCall.status !== "running") {
              let ej = ei + 1;
              while (
                ej < events.length &&
                events[ej].kind === "tool_call" &&
                (events[ej] as { kind: "tool_call"; toolCall: import("@trpg-workbench/shared-schema").ToolCall }).toolCall.name === e.toolCall.name &&
                (events[ej] as { kind: "tool_call"; toolCall: import("@trpg-workbench/shared-schema").ToolCall }).toolCall.status !== "running"
              ) {
                ej++;
              }
              if (ej - ei >= 2) {
                const groupTcs = events.slice(ei, ej).map(
                  (ev) => (ev as { kind: "tool_call"; toolCall: import("@trpg-workbench/shared-schema").ToolCall }).toolCall
                );
                renderHints[ei] = { kind: "group_start", groupKey: `group_${ei}`, toolCalls: groupTcs };
                for (let k = ei + 1; k < ej; k++) renderHints[k] = { kind: "skip" };
                ei = ej;
                continue;
              }
            }
            ei++;
          }

          return events.map((e, i) => {
            const hint = renderHints[i];
            if (hint.kind === "skip") return null;

            if (hint.kind === "group_start") {
              return <GroupedToolCallCard key={hint.groupKey} toolCalls={hint.toolCalls} />;
            }

            // passthrough — original rendering
            if (e.kind === "thinking_chunk") {
              return (
                <ThinkingBlock
                  key={`think_${i}`}
                  content={e.text}
                  streaming={isStreaming && !e.done}
                />
              );
            }
            if (e.kind === "tool_call") {
              if (e.toolCall.status === "running") {
                return (
                  <div
                    key={e.toolCall.id}
                    style={{
                      position: "sticky",
                      bottom: 0,
                      zIndex: 2,
                      background: "color-mix(in srgb, var(--bg) 86%, transparent)",
                      borderRadius: 4,
                      backdropFilter: "blur(2px)",
                    }}
                  >
                    <ToolCallCard toolCall={e.toolCall} />
                  </div>
                );
              }
              return <ToolCallCard key={e.toolCall.id} toolCall={e.toolCall} />;
            }
            if (e.kind === "question_interrupt") {
              return (
                <QuestionCard
                  key={`qi_${i}`}
                  question={e.question}
                  onSubmit={onQuestionSubmit}
                />
              );
            }
            if (e.kind === "plan") {
              return (
                <PlanCard
                  key={`plan_${e.plan.plan_id}`}
                  plan={e.plan}
                />
              );
            }
          if (e.kind === "agent_status") {
              return (
                <span key="agent_status" style={{ color: "var(--text-muted)", fontSize: 12, display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                  {e.message}
                  <span style={{ display: "inline-flex", gap: 3 }}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} style={{
                        display: "inline-block", width: 4, height: 4,
                        borderRadius: "50%", background: "var(--text-muted)",
                        animation: `thinking-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }} />
                    ))}
                  </span>
                </span>
              );
            }
            // text_chunk
            const isLast = i === lastTextIdx;
            return (
              <div key={i} className="agent-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.text}</ReactMarkdown>
                {isLast && isStreaming && (
                  <span style={{
                    display: "inline-block",
                    width: 6,
                    height: 13,
                    background: "var(--text-muted)",
                    marginLeft: 2,
                    verticalAlign: "text-bottom",
                    animation: "blink 1s step-end infinite",
                  }} />
                )}
              </div>
            );
          });
        })()}
        {/* Between-step waiting indicator: shown when streaming but last event is not a text_chunk
            (e.g. after a tool call completes or thinking ends, waiting for next LLM tokens) */}
        {isStreaming && events.length > 0 && events[events.length - 1].kind !== "text_chunk" && (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            marginTop: 6,
            color: "var(--text-muted)",
            fontSize: 11,
          }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{
                display: "inline-block",
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "var(--text-muted)",
                animation: `thinking-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Log Entry ────────────────────────────────────────────────────────────────

function LogEntry({ entry }: { entry: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const type = entry.type as string;
  const ts = entry.timestamp as string;
  const time = ts
    ? new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  const LOG_ICONS: Record<string, string> = {
    model_call: "🤖", retrieval: "🔍", asset_write: "💾",
  };

  const ACTION_LABELS: Record<string, { label: string; color: string }> = {
    create: { label: "新增", color: "#3fb950" },
    update: { label: "修改", color: "#d29922" },
    delete: { label: "删除", color: "#f85149" },
  };

  let summary = "";
  if (type === "model_call") {
    summary = `${entry.provider}/${entry.model} · ${entry.total_tokens} tokens`;
    if (entry.agent) summary = `[${entry.agent}] ` + summary;
  } else if (type === "retrieval") {
    summary = `检索 ${entry.result_count} 条 · ${(entry.query as string)?.slice(0, 40)}`;
  } else if (type === "asset_write") {
    const actionInfo = ACTION_LABELS[(entry.action as string) ?? "create"];
    const badge = actionInfo
      ? <span style={{ color: actionInfo.color, fontWeight: 600, marginRight: 4 }}>[{actionInfo.label}]</span>
      : null;
    return (
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ padding: "4px 0", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 11 }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span>{LOG_ICONS[type] ?? "📝"}</span>
          <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{time}</span>
          <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {badge}{entry.asset_type as string} &quot;{entry.asset_name as string}&quot; v{entry.revision_version as number}
          </span>
        </div>
        {expanded && (
          <pre style={{
            marginTop: 4, padding: 6,
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 3, fontSize: 10, whiteSpace: "pre-wrap",
            color: "var(--text-muted)", maxHeight: 120, overflowY: "auto",
          }}>
            {JSON.stringify(entry, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{ padding: "4px 0", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 11 }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span>{LOG_ICONS[type] ?? "📝"}</span>
        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{time}</span>
        <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
      </div>
      {expanded && (
        <pre style={{
          marginTop: 4, padding: 6,
          background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 3, fontSize: 10, whiteSpace: "pre-wrap",
          color: "var(--text-muted)", maxHeight: 120, overflowY: "auto",
        }}>
          {JSON.stringify(entry, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── AgentPanel ───────────────────────────────────────────────────────────────

// The send path uses resolveBackendUrl for the dynamic port.

export function AgentPanel({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const {
    session, messages,
    setActiveSession, addMessage, setTyping,
  } = useAgentStore();

  const [modelWarning, setModelWarning] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string>(""); // "" = use workspace default
  const [turnScope, setTurnScope] = useState<"director" | "explore">("director");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(() => {
    try { return localStorage.getItem(`agent_drawer_open_${workspaceId}`) === "true"; } catch { return false; }
  });

  // SSE streaming state
  const [streamingEvents, setStreamingEvents] = useState<StreamEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Queue for messages sent while a stream is in progress
  const [pendingQueue, setPendingQueue] = useState<Array<{ content: string; mentionedAssetIds: string[] }>>([]);
  const pendingQueueRef = useRef<Array<{ content: string; mentionedAssetIds: string[] }>>([]);
  // Keep ref in sync so the stream-end handler can read without stale closure
  const syncQueue = (q: Array<{ content: string; mentionedAssetIds: string[] }>) => {
    pendingQueueRef.current = q;
    setPendingQueue(q);
  };

  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // Workspace config to check model
  const { data: configResp } = useQuery({
    queryKey: ["workspace", workspaceId, "config"],
    queryFn: () => apiFetch<WorkspaceConfigResponse>(`/workspaces/${workspaceId}/config`),
    enabled: !!workspaceId,
  });
  const defaultLlmName = configResp?.config?.models?.default_llm ?? "";
  const defaultLlmModel = configResp?.config?.models?.default_llm_model ?? "";

  // LLM profile + catalog for context badge
  const { data: llmProfiles = [] } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
  });
  const activeProfile = llmProfiles.find((p) => p.name === defaultLlmName);

  // Fetch available models for the active profile (works for all provider types)
  const { models: availableModels } = useModelList(activeProfile?.id ?? null);
  const modelOptions = availableModels;





  // Logs
  const { data: logsData } = useQuery({
    queryKey: ["logs", workspaceId],
    queryFn: () =>
      apiFetch<{ entries: Array<Record<string, unknown>>; count: number }>(
        `/workspaces/${workspaceId}/logs`
      ),
    enabled: logsOpen,
    refetchInterval: logsOpen ? 5000 : false,
  });

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, streamingEvents]);

  // Switch to a session and load its messages
  const switchToSession = useCallback(async (s: ChatSession) => {
    setActiveSession(s, []);
    setTurnScope(s.agent_scope === "explore" ? "explore" : "director");
    localStorage.setItem(`last_session_${workspaceId}`, s.id);
    try {
      const msgs = await apiFetch<ChatMessage[]>(`/chat/sessions/${s.id}/messages?workspace_id=${workspaceId}`);
      setActiveSession(s, msgs);
    } catch (e) {
      setSessionError((e as Error)?.message ?? "加载消息失败");
    }
  }, [workspaceId, setActiveSession]);

  // Create a brand-new session (Director 创作 或 Explore 只读，由 agent_scope 区分)
  const createNewSession = useCallback(
    async (agentScope: string | null = null) => {
      setSessionError(null);
      try {
        const body: ChatSessionCreate = { workspace_id: workspaceId, agent_scope: agentScope };
        const s = await apiFetch<ChatSession>("/chat/sessions", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setActiveSession(s, []);
        setTurnScope(s.agent_scope === "explore" ? "explore" : "director");
        localStorage.setItem(`last_session_${workspaceId}`, s.id);
        qc.invalidateQueries({ queryKey: ["sessions", workspaceId] });
      } catch (e) {
        setSessionError((e as Error)?.message ?? "无法连接到后端，请检查服务状态");
      }
    },
    [workspaceId, setActiveSession, qc]
  );

  // Initialize: restore last session or create new one
  // Re-runs whenever workspaceId changes (workspace switch resets session)
  useEffect(() => {
    // If session belongs to a different workspace, reset
    if (session && session.workspace_id !== workspaceId) {
      setActiveSession({ ...session }, []);
    }
    setSessionError(null);
    apiFetch<ChatSession[]>(`/chat/sessions?workspace_id=${workspaceId}`)
      .then(async (sessions) => {
        if (sessions.length === 0) {
          await createNewSession();
          return;
        }
        const lastId = localStorage.getItem(`last_session_${workspaceId}`);
        const target = sessions.find((s) => s.id === lastId) ?? sessions[0];
        await switchToSession(target);
      })
      .catch(() => createNewSession());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleSend = async (content: string, mentionedAssetIds: string[] = []) => {
    if (!content.trim()) return;
    // If already streaming, queue the message for later
    if (isStreaming) {
      syncQueue([...pendingQueueRef.current, { content, mentionedAssetIds }]);
      return;
    }
    if (configResp && !defaultLlmName && !sessionModel) {
      setModelWarning("未配置默认 LLM。请前往工作空间设置完成配置后再发送。");
      return;
    }
    if (configResp && defaultLlmName && !defaultLlmModel && !sessionModel) {
      setModelWarning("未选择模型。请在下方选择模型或前往工作空间设置选择默认模型。");
      return;
    }
    setModelWarning(null);

    if (!session) return;

    // Optimistic user message display
    const fakeUserMsg: ChatMessage = {
      id: `local_${Date.now()}`,
      session_id: session.id,
      role: "user",
      content,
      references_json: null,
      tool_calls_json: null,
      thinking_json: null,
      created_at: new Date().toISOString(),
    };
    addMessage(fakeUserMsg);

    setIsStreaming(true);
    setStreamingEvents([]);
    setTyping(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // 10 min timeout — local LLMs need time for prompt processing + multi-tool rounds
    const timeoutSignal = AbortSignal.timeout(10 * 60 * 1000);
    const combinedSignal = AbortSignal.any([ctrl.signal, timeoutSignal]);

    // These are declared outside try so the catch (AbortError) block can read them
    // to finalize a partial message when the user stops mid-stream.
    let accEvents: StreamEvent[] = [];
    let accToolCallsById: Record<string, ToolCall> = {};
    let traceStartAtById: Record<string, number> = {};
    let textCarry = "";

    try {
      const baseUrl = await resolveBackendUrl();
      const resp = await fetch(`${baseUrl}/chat/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          workspace_id: workspaceId,
          ...(sessionModel ? { model: sessionModel } : {}),
          turn_scope: turnScope,
          ...(mentionedAssetIds.length > 0 ? { referenced_asset_ids: mentionedAssetIds } : {}),
        }),
        signal: combinedSignal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = "";

      accEvents = [];
      accToolCallsById = {};
      traceStartAtById = {};
      let currentEvent = "";
      let streamDone = false;
      let lastUiFlush = 0;
      textCarry = "";
      const flushUi = (force = false) => {
        const now = Date.now();
        if (!force && now - lastUiFlush < 33) return;
        setStreamingEvents([...accEvents]);
        lastUiFlush = now;
      };
      const appendThinking = (chunk: string) => {
        if (!chunk) return;
        const last = accEvents[accEvents.length - 1];
        // If the last event is an active (not-done) thinking chunk, append to it
        if (last && last.kind === "thinking_chunk" && !last.done) {
          accEvents = [
            ...accEvents.slice(0, -1),
            { kind: "thinking_chunk", text: last.text + chunk, done: false },
          ];
        } else {
          // New thinking phase: mark previous thinking_chunk as done, start a new one
          accEvents = accEvents.map((e) =>
            e.kind === "thinking_chunk" ? { ...e, done: true } : e
          );
          accEvents = [...accEvents, { kind: "thinking_chunk", text: chunk, done: false }];
        }
      };
      const appendText = (part: string) => {
        if (!part) return;
        const last = accEvents[accEvents.length - 1];
        if (last && last.kind === "text_chunk") {
          accEvents = [
            ...accEvents.slice(0, -1),
            { kind: "text_chunk", text: last.text + part },
          ];
        } else {
          accEvents = [...accEvents, { kind: "text_chunk", text: part }];
        }
      };
      const flushTextChunk = (chunk: string, force = false) => {
        if (chunk) textCarry += chunk;
        const boundaries = ["。", "！", "？", "!", "?", "；", ";", "\n"];
        let boundaryIdx = -1;
        for (const ch of boundaries) {
          boundaryIdx = Math.max(boundaryIdx, textCarry.lastIndexOf(ch));
        }
        if (boundaryIdx >= 0) {
          appendText(textCarry.slice(0, boundaryIdx + 1));
          textCarry = textCarry.slice(boundaryIdx + 1);
        }
        if (textCarry.length > 0 || force) {
          appendText(textCarry);
          textCarry = "";
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done || streamDone) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";


        for (const line of lines) {
          if (line === "") {
            // Blank line = SSE event boundary; reset for next event
            currentEvent = "";
          } else if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const rawData = line.slice(6).trim();
            let data: Record<string, unknown> = {};
            try { data = JSON.parse(rawData); } catch {}

            if (currentEvent === "text_delta") {
              const chunk = (data.content as string) ?? "";
              // Clear any pending agent_status when text starts
              accEvents = accEvents.filter((e) => e.kind !== "agent_status");
              // When text starts arriving, any preceding thinking phase is done.
              // This closes the thinking cursor even if no new thinking_delta follows.
              const hasActiveThinking = accEvents.some(
                (e) => e.kind === "thinking_chunk" && !e.done
              );
              if (hasActiveThinking) {
                accEvents = accEvents.map((e) =>
                  e.kind === "thinking_chunk" ? { ...e, done: true } : e
                );
              }
              flushTextChunk(chunk);
              flushUi();

            } else if (currentEvent === "thinking_delta") {
              const chunk = (data.content as string) ?? "";
              // Clear any pending agent_status when thinking resumes
              accEvents = accEvents.filter((e) => e.kind !== "agent_status");
              appendThinking(chunk);
              flushUi();

            } else if (currentEvent === "tool_call_start") {
              const tc: ToolCall = {
                id: (data.id as string) ?? `tc_${Date.now()}`,
                name: (data.name as string) ?? "",
                arguments: (data.arguments as string) ?? "{}",
                status: "running",
                result_summary: null,
                trace_logs: [],
              };
              accToolCallsById[tc.id] = tc;
              traceStartAtById[tc.id] = Date.now();
              accEvents = [...accEvents, { kind: "tool_call", toolCall: tc }];
              flushUi();

            } else if (currentEvent === "tool_trace") {
              const tcId = (data.id as string) ?? "";
              const trace = Array.isArray(data.trace) ? data.trace.map((x) => String(x)) : null;
              const deltaRaw = typeof data.delta === "string" ? data.delta : null;
              const delta = deltaRaw
                ? `[+${Math.max(0, Date.now() - (traceStartAtById[tcId] || Date.now()))}ms] ${deltaRaw}`
                : null;
              if (accToolCallsById[tcId]) {
                const prevTrace = accToolCallsById[tcId].trace_logs ?? [];
                const mergedTrace = trace ?? (delta ? [...prevTrace, delta] : prevTrace);
                const deduped = mergedTrace.filter((line, idx) => idx === 0 || line !== mergedTrace[idx - 1]);
                const updated: ToolCall = {
                  ...accToolCallsById[tcId],
                  trace_logs: deduped,
                };
                accToolCallsById[tcId] = updated;
                accEvents = accEvents.map((e) =>
                  e.kind === "tool_call" && e.toolCall.id === tcId
                    ? { kind: "tool_call", toolCall: updated }
                    : e
                );
                flushUi();
              }

            } else if (currentEvent === "tool_call_result") {
              const tcId = (data.id as string) ?? "";
              const workspaceMutating = (data as { workspace_mutating?: boolean }).workspace_mutating === true;
              if (workspaceMutating && workspaceId) {
                qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
              }
              if (accToolCallsById[tcId]) {
                const updated: ToolCall = {
                  ...accToolCallsById[tcId],
                  status: (workspaceMutating ? "auto_applied" : "done") as ToolCall["status"],
                  result_summary: (data.summary as string) ?? null,
                };
                accToolCallsById[tcId] = updated;
                accEvents = accEvents.map((e) =>
                  e.kind === "tool_call" && e.toolCall.id === tcId
                    ? { kind: "tool_call", toolCall: updated }
                    : e
                );
              } else if (workspaceMutating) {
                let parsed: { action?: string; asset_type?: string; slug?: string; asset_id?: string } = {};
                try {
                  parsed = JSON.parse((data.summary as string) || "{}") as typeof parsed;
                } catch {
                  /* empty */
                }
                const tc: ToolCall = {
                  id: tcId || `aa_${Date.now()}`,
                  name: toolNameFromWriteResultPayload(parsed),
                  arguments: JSON.stringify({ slug: parsed.slug, asset_id: parsed.asset_id }),
                  status: "auto_applied" as ToolCall["status"],
                  result_summary: (data.summary as string) ?? null,
                  trace_logs: [],
                };
                accToolCallsById[tc.id] = tc;
                accEvents = [...accEvents, { kind: "tool_call", toolCall: tc }];
              }
              flushUi();

            } else if (currentEvent === "agent_status") {
              // All tools done, waiting for next LLM response (TTFT gap filler)
              const message = (data.message as string) ?? "正在处理...";
              // Remove any existing agent_status events; keep only the latest
              accEvents = accEvents.filter((e) => e.kind !== "agent_status");
              accEvents = [...accEvents, { kind: "agent_status", message }];
              flushUi();

            } else if (currentEvent === "agent_question") {
              // Director wants to ask the user a question before continuing
              const q = data as unknown as AgentQuestion;
              accEvents = [...accEvents, { kind: "question_interrupt", question: q }];
              flushUi(true);
              // Stream ends after this (backend emits done next); keep isStreaming=true until done

            } else if (currentEvent === "agent_plan") {
              // Director emitted a structured task plan before starting execution
              const plan = data as unknown as AgentPlan;
              accEvents = [...accEvents, { kind: "plan", plan }];
              flushUi(true);

            } else if (currentEvent === "agent_plan_update") {
              // A plan step changed status (pending → running → done/error)
              const update = data as unknown as AgentPlanUpdate;
              accEvents = accEvents.map((e) => {
                if (e.kind !== "plan" || e.plan.plan_id !== update.plan_id) return e;
                return {
                  ...e,
                  plan: {
                    ...e.plan,
                    steps: e.plan.steps.map((s) =>
                      s.id === update.step_id
                        ? { ...s, status: update.status as PlanStepStatus }
                        : s
                    ),
                  },
                };
              });
              flushUi();

            } else if (currentEvent === "done") {
              if (textCarry) {
                flushTextChunk("", true);
              }
              // Ensure asset tree is up-to-date after the turn (covers missed flags or only-read tools).
              qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
              // Build content with {{tool:id}} placeholders to preserve ordering.
              // Text segments and tool-call markers are interleaved in accEvents order.
              // Mark all thinking_chunks as done before finalizing.
              accEvents = accEvents
                .filter((e) => e.kind !== "agent_status")
                .map((e) =>
                  e.kind === "thinking_chunk" ? { ...e, done: true } : e
                );
              let contentWithPlaceholders = "";
              let accThinking = "";
              for (const ev of accEvents) {
                if (ev.kind === "text_chunk") {
                  contentWithPlaceholders += ev.text;
                } else if (ev.kind === "tool_call") {
                  contentWithPlaceholders += `\n{{tool:${ev.toolCall.id}}}\n`;
                } else if (ev.kind === "thinking_chunk") {
                  // Concatenate all thinking chunks for storage
                  if (accThinking) accThinking += "\n\n---\n\n";
                  accThinking += ev.text;
                }
                // question_interrupt: skip (user reply becomes a separate user message)
                // plan: skip — UI-only metadata, not stored in message content
              }
              const accText = contentWithPlaceholders.trim();
              const accToolCalls = Object.values(accToolCallsById).map((tc) =>
                tc.status === "running"
                  ? { ...tc, status: "done" as ToolCall["status"], result_summary: tc.result_summary ?? "已完成" }
                  : tc
              );
              // Finalize: add assistant message to store
              const assistantMsg: ChatMessage = {
                id: `assistant_${Date.now()}`,
                session_id: session.id,
                role: "assistant",
                content: accText,
                references_json: null,
                tool_calls_json:
                  accToolCalls.length > 0
                    ? JSON.stringify(accToolCalls)
                    : null,
                thinking_json: accThinking || null,
                created_at: new Date().toISOString(),
              };
              addMessage(assistantMsg);
              setIsStreaming(false);
              setStreamingEvents([]);
              setTyping(false);
              streamDone = true;
              flushQueue();

            } else if (currentEvent === "error") {
              if (textCarry) {
                flushTextChunk("", true);
              }
              accEvents = accEvents.map((e) =>
                e.kind === "tool_call" && e.toolCall.status === "running"
                  ? { kind: "tool_call", toolCall: { ...e.toolCall, status: "error", result_summary: e.toolCall.result_summary ?? "执行中断" } }
                  : e
              );
              flushUi(true);
              const errMsg: ChatMessage = {
                id: `error_${Date.now()}`,
                session_id: session.id,
                role: "system",
                content: `⚠ 错误：${(data.message as string) ?? "未知错误"}`,
                references_json: null,
                tool_calls_json: null,
                thinking_json: null,
                created_at: new Date().toISOString(),
              };
              addMessage(errMsg);
              setIsStreaming(false);
              setStreamingEvents([]);
              setTyping(false);
              streamDone = true;
              flushQueue();
            }
          }
        }
      }
      // Guard: if stream closed without a `done` SSE event, clear streaming state
      readerRef.current = null;
      setIsStreaming(false);
      setStreamingEvents([]);
      setTyping(false);
      flushQueue();
    } catch (e) {
      readerRef.current = null;
      if ((e as Error).name !== "AbortError") {
        addMessage({
          id: `error_${Date.now()}`,
          session_id: session?.id ?? "",
          role: "system",
          content: `⚠ 发送失败：${(e as Error).message}`,
          references_json: null,
          tool_calls_json: null,
          thinking_json: null,
          created_at: new Date().toISOString(),
        });
      }
      setIsStreaming(false);
      setStreamingEvents([]);
      setTyping(false);
      // Don't flush on abort — user intentionally stopped; discard queue too
      if ((e as Error).name === "AbortError") {
        // Flush any partial text carry directly into accEvents
        if (textCarry) {
          const last = accEvents[accEvents.length - 1];
          if (last && last.kind === "text_chunk") {
            accEvents = [...accEvents.slice(0, -1), { kind: "text_chunk", text: last.text + textCarry }];
          } else {
            accEvents = [...accEvents, { kind: "text_chunk", text: textCarry }];
          }
          textCarry = "";
        }
        // Save accumulated content to local message list so it stays visible
        const finalEvents = accEvents
          .filter((ev) => ev.kind !== "agent_status")
          .map((ev) => ev.kind === "thinking_chunk" ? { ...ev, done: true } : ev);
        let abortContent = "";
        let abortThinking = "";
        for (const ev of finalEvents) {
          if (ev.kind === "text_chunk") abortContent += ev.text;
          else if (ev.kind === "tool_call") abortContent += `\n{{tool:${ev.toolCall.id}}}\n`;
          else if (ev.kind === "thinking_chunk") {
            if (abortThinking) abortThinking += "\n\n---\n\n";
            abortThinking += ev.text;
          }
        }
        const abortToolCalls = Object.values(accToolCallsById).map((tc) =>
          tc.status === "running"
            ? { ...tc, status: "done" as ToolCall["status"], result_summary: tc.result_summary ?? "已中断" }
            : tc
        );
        if (abortContent.trim() || abortToolCalls.length > 0 || abortThinking) {
          addMessage({
            id: `assistant_${Date.now()}`,
            session_id: session?.id ?? "",
            role: "assistant",
            content: abortContent.trim(),
            references_json: null,
            tool_calls_json: abortToolCalls.length > 0 ? JSON.stringify(abortToolCalls) : null,
            thinking_json: abortThinking || null,
            created_at: new Date().toISOString(),
          });
          // Refresh asset tree if any tool had already written workspace assets
          if (abortToolCalls.some((tc) => tc.status === "auto_applied") && workspaceId) {
            qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
          }
        }
        syncQueue([]);
      } else {
        flushQueue();
      }
    }
  };

  const handleReset = () => {
    abortRef.current?.abort();
    readerRef.current?.cancel();
    readerRef.current = null;
    setIsStreaming(false);
    setStreamingEvents([]);
    syncQueue([]);
    createNewSession(null);
  };


  // Called after every stream ends (done / error / abort) to drain the queue
  const flushQueue = () => {
    const next = pendingQueueRef.current[0];
    if (!next) return;
    const remaining = pendingQueueRef.current.slice(1);
    syncQueue(remaining);
    // Small timeout so React state settles before next send
    setTimeout(() => handleSend(next.content, next.mentionedAssetIds), 50);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px", fontWeight: 600, fontSize: 13,
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <button
          onClick={() => {
            const next = !drawerOpen;
            setDrawerOpen(next);
            try { localStorage.setItem(`agent_drawer_open_${workspaceId}`, String(next)); } catch {}
          }}
          title="会话历史"
          style={{
            background: drawerOpen ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "none",
            color: drawerOpen ? "var(--accent)" : "var(--text-muted)",
            border: "none",
            borderRadius: 4,
            padding: "2px 4px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <MessageSquare size={13} />
        </button>
        <span>AI 助手</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={handleReset}
            title="新建对话"
            style={{ background: "none", color: "var(--text-muted)", padding: 2 }}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Body: optional drawer + chat area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {drawerOpen && (
          <SessionDrawer
            workspaceId={workspaceId}
            activeSessionId={session?.id ?? null}
            onSelect={(s) => switchToSession(s)}
            onNewDirector={handleReset}
          />
        )}

        {/* Chat column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          {messages.length === 0 && !isStreaming && (
            <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 24 }}>
              {turnScope === "explore" ? (
                <>在下方输入探索请求，例如：<br />「列出所有地点」「查找某 NPC 的相关内容」</>
              ) : (
                <>在下方输入创作请求，例如：<br />「帮我创建一个 COC 乡村调查模组」</>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <StoredMessageBubble key={msg.id} msg={msg} />
          ))}

          {isStreaming && (
            <StreamingBubble
              events={streamingEvents}
              isStreaming={isStreaming}
              onQuestionSubmit={(answers) => {
                // Format answers as a structured reply and send
                const lines = Object.entries(answers).map(
                  ([header, labels]) => `- ${header}：${labels.join("、")}`
                );
                const reply = `[问题答复]\n${lines.join("\n")}`;
                handleSend(reply);
              }}
            />
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
          <div style={{ maxHeight: 200, overflowY: "auto", padding: "0 12px 8px" }}>
            {!logsData || logsData.count === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>今日暂无日志</div>
            ) : (
              logsData.entries
                .slice(-30)
                .reverse()
                .map((entry, i) => <LogEntry key={i} entry={entry} />)
            )}
          </div>
        )}
      </div>

      {/* Model warning */}
      {modelWarning && (
        <div style={{
          padding: "6px 12px",
          background: "rgba(240,165,0,0.1)",
          borderTop: "1px solid rgba(240,165,0,0.3)",
          fontSize: 12, color: "#f0a500",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{modelWarning}</span>
          <button onClick={() => setModelWarning(null)} style={{ background: "none", color: "#f0a500", fontSize: 12, padding: "2px 6px" }}>✕</button>
        </div>
      )}



      {/* Session error */}
      {sessionError && (
        <div style={{ padding: "6px 12px", background: "color-mix(in srgb, var(--danger) 12%, var(--bg))", color: "var(--danger)", fontSize: 12 }}>
          {sessionError}
        </div>
      )}

      {/* Input area */}
      <div style={{
        padding: "8px 12px", borderTop: "1px solid var(--border)",
      }}>
        {/* Bottom bar: model selector + hints */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <select
              value={turnScope}
              onChange={(e) => setTurnScope(e.target.value as "explore" | "director")}
              style={{
                fontSize: 11,
                color: "var(--text)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              <option value="director">创作</option>
              <option value="explore">探索</option>
            </select>
            <select
              value={sessionModel}
              onChange={(e) => setSessionModel(e.target.value)}
              title="本次对话使用的模型（临时覆盖，不修改工作空间设置）"
              style={{
                fontSize: 11,
                color: sessionModel ? "var(--text)" : "var(--text-muted)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "2px 6px",
                cursor: "pointer",
                maxWidth: 200,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <option value="">
                {defaultLlmModel ? `默认: ${defaultLlmModel}` : defaultLlmName ? `${defaultLlmName}（未选模型）` : "未配置模型"}
              </option>
              {modelOptions.length > 0
                ? modelOptions.map((m) => <option key={m} value={m}>{m}</option>)
                : null
              }
            </select>
          </div>
          <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            Enter 发送 · Shift+Enter 换行 · @ 引用资产
          </span>
        </div>
        <MentionInput
          workspaceId={workspaceId}
          disabled={!session}
          isStreaming={isStreaming}
          queueLength={pendingQueue.length}
          onSubmit={handleSend}
          onStop={() => {
            abortRef.current?.abort();
            readerRef.current?.cancel();
          }}
        />
      </div>
      </div>{/* end chat column */}
      </div>{/* end body */}
    </div>
  );
}
