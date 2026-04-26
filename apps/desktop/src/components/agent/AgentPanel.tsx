import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, FileText, ChevronDown, ChevronUp, MessageSquare,
} from "lucide-react";
import type {
  ChatSession, ChatMessage, ToolCall,
  LLMProfile, ModelCatalogEntry, WorkspaceConfigResponse,
} from "@trpg-workbench/shared-schema";
import { useAgentStore } from "@/stores/agentStore";
import ContextUsageBadge from "./ContextUsageBadge";
import { ToolCallCard } from "./ToolCallCard";
import { MentionInput } from "./MentionInput";
import { SessionDrawer } from "./SessionDrawer";
import { apiFetch } from "@/lib/api";

// ─── MessageBubble ────────────────────────────────────────────────────────────

function StoredMessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  let toolCalls: ToolCall[] = [];
  if (msg.tool_calls_json) {
    try { toolCalls = JSON.parse(msg.tool_calls_json); } catch {}
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: "88%",
        padding: "8px 12px",
        borderRadius: isUser ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
        background: isUser
          ? "var(--accent)"
          : msg.role === "system"
          ? "var(--bg)"
          : "var(--bg-surface)",
        border: isUser ? "none" : "1px solid var(--border)",
        fontSize: 13,
        lineHeight: 1.6,
        color: msg.role === "system" ? "var(--text-muted)" : "var(--text)",
      }}>
        {msg.content && <div>{msg.content}</div>}
        {toolCalls.length > 0 && (
          <div style={{ marginTop: msg.content ? 8 : 0 }}>
            {toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, paddingInline: 4 }}>
        {new Date(msg.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

function StreamingBubble({ content, toolCalls }: { content: string; toolCalls: ToolCall[] }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: "88%",
        padding: "8px 12px",
        borderRadius: "12px 12px 12px 4px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        fontSize: 13,
        lineHeight: 1.6,
      }}>
        {toolCalls.map((tc) => (
          <ToolCallCard key={tc.id} toolCall={tc} />
        ))}
        {content && (
          <div style={{ marginTop: toolCalls.length > 0 ? 8 : 0 }}>
            {content}
            <span style={{
              display: "inline-block",
              width: 6,
              height: 13,
              background: "var(--text-muted)",
              marginLeft: 2,
              verticalAlign: "text-bottom",
              animation: "blink 1s step-end infinite",
            }} />
          </div>
        )}
        {!content && toolCalls.length === 0 && (
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>思考中...</span>
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

const BACKEND_URL = (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL
  ?? "http://127.0.0.1:7821";

export function AgentPanel({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const {
    session, messages,
    setActiveSession, addMessage, setTyping,
  } = useAgentStore();

  const [modelWarning, setModelWarning] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string>(""); // "" = use workspace default
  const bottomRef = useRef<HTMLDivElement>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(() => {
    try { return localStorage.getItem(`agent_drawer_open_${workspaceId}`) === "true"; } catch { return false; }
  });

  // SSE streaming state
  const [streamingText, setStreamingText] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([]);
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

  // Probe available models from active profile's base_url
  const { data: probeResult } = useQuery({
    queryKey: ["probe-models-chat", activeProfile?.base_url],
    queryFn: async () => {
      const params = new URLSearchParams({ base_url: activeProfile!.base_url! });
      return apiFetch<{ models: string[]; error: string | null }>(
        `/settings/model-catalog/probe-models?${params.toString()}`
      );
    },
    enabled: !!activeProfile?.base_url,
    staleTime: 60_000,
  });
  const availableModels = probeResult?.models ?? [];

  const effectiveModel = sessionModel || defaultLlmModel;

  const { data: catalogEntry } = useQuery({
    queryKey: ["model-catalog-entry", activeProfile?.provider_type, effectiveModel],
    queryFn: () =>
      apiFetch<ModelCatalogEntry[]>(
        `/settings/model-catalog?provider_type=${activeProfile!.provider_type}`
      ).then((entries) => entries.find((e) => e.model_name === effectiveModel) ?? null),
    enabled: !!activeProfile && !!effectiveModel,
  });

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
  }, [messages, isStreaming, streamingText, streamingToolCalls]);

  // Switch to a session and load its messages
  const switchToSession = useCallback(async (s: ChatSession) => {
    setActiveSession(s, []);
    localStorage.setItem(`last_session_${workspaceId}`, s.id);
    try {
      const msgs = await apiFetch<ChatMessage[]>(`/chat/sessions/${s.id}/messages`);
      setActiveSession(s, msgs);
    } catch (e) {
      setSessionError((e as Error)?.message ?? "加载消息失败");
    }
  }, [workspaceId, setActiveSession]);

  // Create a brand-new session
  const createNewSession = useCallback(async () => {
    setSessionError(null);
    try {
      const s = await apiFetch<ChatSession>("/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      setActiveSession(s, []);
      localStorage.setItem(`last_session_${workspaceId}`, s.id);
      qc.invalidateQueries({ queryKey: ["sessions", workspaceId] });
    } catch (e) {
      setSessionError((e as Error)?.message ?? "无法连接到后端，请检查服务状态");
    }
  }, [workspaceId, setActiveSession, qc]);

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
      created_at: new Date().toISOString(),
    };
    addMessage(fakeUserMsg);

    setIsStreaming(true);
    setStreamingText("");
    setStreamingToolCalls([]);
    setTyping(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // 10 min timeout — local LLMs need time for prompt processing + multi-tool rounds
    const timeoutSignal = AbortSignal.timeout(10 * 60 * 1000);
    const combinedSignal = AbortSignal.any([ctrl.signal, timeoutSignal]);

    try {
      const resp = await fetch(`${BACKEND_URL}/chat/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          workspace_id: workspaceId,
          ...(sessionModel ? { model: sessionModel } : {}),
          ...(mentionedAssetIds.length > 0 ? { referenced_asset_ids: mentionedAssetIds } : {}),
        }),
        signal: combinedSignal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      let accText = "";
      let accToolCalls: ToolCall[] = [];
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
              accText += chunk;
              setStreamingText(accText);

            } else if (currentEvent === "tool_call_start") {
              const tc: ToolCall = {
                id: (data.id as string) ?? `tc_${Date.now()}`,
                name: (data.name as string) ?? "",
                arguments: (data.arguments as string) ?? "{}",
                status: "running",
                result_summary: null,
              };
              accToolCalls = [...accToolCalls, tc];
              setStreamingToolCalls([...accToolCalls]);

            } else if (currentEvent === "tool_call_result") {
              const tcId = data.id as string;
              accToolCalls = accToolCalls.map((tc) =>
                tc.id === tcId
                  ? { ...tc, status: "done" as const, result_summary: (data.summary as string) ?? null }
                  : tc
              );
              setStreamingToolCalls([...accToolCalls]);

            } else if (currentEvent === "auto_applied") {
              // Asset written directly — refresh assets list
              qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
              const tc: ToolCall = {
                id: (data.slug as string) ?? `aa_${Date.now()}`,
                name: (data.action as string) === "updated" ? "update_asset" : "create_asset",
                arguments: JSON.stringify({ slug: data.slug, asset_id: data.asset_id }),
                status: "auto_applied" as ToolCall["status"],
                result_summary: null,
              };
              accToolCalls = [...accToolCalls, tc];
              setStreamingToolCalls([...accToolCalls]);

            } else if (currentEvent === "done") {
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
                created_at: new Date().toISOString(),
              };
              addMessage(assistantMsg);
              setIsStreaming(false);
              setStreamingText("");
              setStreamingToolCalls([]);
              setTyping(false);
              flushQueue();

            } else if (currentEvent === "error") {
              const errMsg: ChatMessage = {
                id: `error_${Date.now()}`,
                session_id: session.id,
                role: "system",
                content: `⚠ 错误：${(data.message as string) ?? "未知错误"}`,
                references_json: null,
                tool_calls_json: null,
                created_at: new Date().toISOString(),
              };
              addMessage(errMsg);
              setIsStreaming(false);
              setStreamingText("");
              setStreamingToolCalls([]);
              setTyping(false);
              flushQueue();
            }
          }
        }
      }
      // Guard: if stream closed without a `done` SSE event, clear streaming state
      setIsStreaming(false);
      setStreamingText("");
      setStreamingToolCalls([]);
      setTyping(false);
      flushQueue();
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        addMessage({
          id: `error_${Date.now()}`,
          session_id: session?.id ?? "",
          role: "system",
          content: `⚠ 发送失败：${(e as Error).message}`,
          references_json: null,
          tool_calls_json: null,
          created_at: new Date().toISOString(),
        });
      }
      setIsStreaming(false);
      setStreamingText("");
      setStreamingToolCalls([]);
      setTyping(false);
      // Don't flush on abort — user intentionally stopped; discard queue too
      if ((e as Error).name === "AbortError") {
        syncQueue([]);
      } else {
        flushQueue();
      }
    }
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingText("");
    setStreamingToolCalls([]);
    syncQueue([]);
    createNewSession();
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
            onNew={handleReset}
          />
        )}

        {/* Chat column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          {messages.length === 0 && !isStreaming && (
            <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 24 }}>
              在下方输入创作请求，例如：<br />
              "帮我创建一个 COC 乡村调查模组"<br />
              "把第一幕改得更压抑一点"
            </div>
          )}

          {messages.map((msg) => (
            <StoredMessageBubble key={msg.id} msg={msg} />
          ))}

          {isStreaming && (
            <StreamingBubble content={streamingText} toolCalls={streamingToolCalls} />
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
      }}>
        {/* Bottom bar: model selector + hints */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
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
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <option value="">
              {defaultLlmModel ? `默认: ${defaultLlmModel}` : defaultLlmName ? `${defaultLlmName}（未选模型）` : "未配置模型"}
            </option>
            {availableModels.length > 0
              ? availableModels.map((m) => <option key={m} value={m}>{m}</option>)
              : null
            }
          </select>
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
          onStop={() => abortRef.current?.abort()}
        />
      </div>
      </div>{/* end chat column */}
      </div>{/* end body */}
    </div>
  );
}
