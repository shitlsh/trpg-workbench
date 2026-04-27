import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { MessageSquarePlus, Compass, Pencil, Trash2, Check, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ChatSession, UpdateChatSessionRequest } from "@trpg-workbench/shared-schema";

interface SessionDrawerProps {
  workspaceId: string;
  activeSessionId: string | null;
  onSelect: (session: ChatSession) => void;
  onNewDirector: () => void;
  onNewExplore: () => void;
}

function relativeTime(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

export function SessionDrawer({ workspaceId, activeSessionId, onSelect, onNewDirector, onNewExplore }: SessionDrawerProps) {
  const qc = useQueryClient();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["sessions", workspaceId],
    queryFn: () => apiFetch<ChatSession[]>(`/chat/sessions?workspace_id=${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 5000,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiFetch<ChatSession>(`/chat/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title } satisfies UpdateChatSessionRequest),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions", workspaceId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/chat/sessions/${id}?workspace_id=${workspaceId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions", workspaceId] }),
  });

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  function startRename(s: ChatSession) {
    setRenamingId(s.id);
    setRenameValue(s.title ?? "");
    setConfirmDeleteId(null);
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      renameMutation.mutate({ id: renamingId, title: renameValue.trim() });
    }
    setRenamingId(null);
  }

  function cancelRename() {
    setRenamingId(null);
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id);
    setConfirmDeleteId(null);
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {/* New session: 创作 vs 探索 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "8px 8px 4px" }}>
        <button
          onClick={onNewDirector}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "transparent",
            cursor: "pointer",
            fontSize: 13,
            color: "var(--text)",
            whiteSpace: "nowrap",
          }}
        >
          <MessageSquarePlus size={14} />
          新对话（创作）
        </button>
        <button
          onClick={onNewExplore}
          title="只读浏览资产与规则，不写入"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))",
            background: "color-mix(in srgb, var(--accent) 6%, transparent)",
            cursor: "pointer",
            fontSize: 12,
            color: "var(--text)",
            whiteSpace: "nowrap",
          }}
        >
          <Compass size={14} />
          新探索（只读）
        </button>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 8px" }}>
        {isLoading && (
          <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)" }}>加载中...</div>
        )}
        {!isLoading && sessions.length === 0 && (
          <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)" }}>暂无历史对话</div>
        )}
        {sessions.map((s) => {
          const isActive = s.id === activeSessionId;
          const isRenaming = renamingId === s.id;
          const isConfirmDelete = confirmDeleteId === s.id;

          return (
            <div
              key={s.id}
              style={{
                position: "relative",
                borderRadius: 6,
                marginBottom: 2,
                background: isActive
                  ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                  : "transparent",
                cursor: "pointer",
              }}
              className="session-item"
            >
              <div
                onClick={() => !isRenaming && onSelect(s)}
                style={{ padding: "6px 8px", userSelect: "none" }}
              >
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") cancelRename();
                    }}
                    onBlur={commitRename}
                    style={{
                      width: "100%",
                      fontSize: 13,
                      border: "1px solid var(--accent)",
                      borderRadius: 4,
                      padding: "1px 4px",
                      outline: "none",
                      background: "var(--bg)",
                      color: "var(--text)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: isActive ? 500 : 400,
                      color: isActive ? "var(--accent)" : "var(--text)",
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      lineHeight: 1.4,
                    }}
                  >
                    {s.title ?? (s.agent_scope === "explore" ? "（新探索）" : "（新对话）")}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  {s.agent_scope === "explore" && (
                    <span
                      style={{
                        fontSize: 9,
                        lineHeight: "14px",
                        color: "var(--accent)",
                        border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
                        borderRadius: 3,
                        padding: "0 4px",
                      }}
                    >
                      探索
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {relativeTime(s.updated_at)}
                  </span>
                  {s.message_count > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        background: "var(--bg)",
                        borderRadius: 8,
                        padding: "0 5px",
                        lineHeight: "16px",
                      }}
                    >
                      {s.message_count}
                    </span>
                  )}
                </div>
              </div>

              {/* Confirm delete row */}
              {isConfirmDelete && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 6px 4px",
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--danger)", flex: 1 }}>确认删除?</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                    style={{
                      background: "var(--danger)",
                      color: "white",
                      border: "none",
                      borderRadius: 3,
                      padding: "2px 6px",
                      cursor: "pointer",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                    }}
                  >
                    <Check size={10} /> 删除
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 3,
                      padding: "2px 4px",
                      cursor: "pointer",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
                      color: "var(--text-muted)",
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              )}

              {/* Hover action buttons — shown via CSS class trick */}
              {!isRenaming && !isConfirmDelete && (
                <div
                  className="session-actions"
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    display: "none",
                    gap: 2,
                  }}
                >
                  <button
                    title="重命名"
                    onClick={(e) => { e.stopPropagation(); startRename(s); }}
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "2px 4px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      color: "var(--text-muted)",
                    }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    title="删除"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "2px 4px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      color: "var(--danger)",
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Inline CSS for hover behavior */}
      <style>{`
        .session-item:hover .session-actions {
          display: flex !important;
        }
      `}</style>
    </div>
  );
}
