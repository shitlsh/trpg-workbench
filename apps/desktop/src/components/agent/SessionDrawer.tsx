import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { MessageSquarePlus, Pencil, Trash2, Check, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ChatSession, UpdateChatSessionRequest } from "@trpg-workbench/shared-schema";

interface SessionDrawerProps {
  workspaceId: string;
  activeSessionId: string | null;
  onSelect: (session: ChatSession) => void;
  onNew: () => void;
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

export function SessionDrawer({ workspaceId, activeSessionId, onSelect, onNew }: SessionDrawerProps) {
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
        width: 200,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--color-border, #e2e8f0)",
        background: "var(--color-surface-2, #f8fafc)",
        overflow: "hidden",
      }}
    >
      {/* New chat button */}
      <button
        onClick={onNew}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          margin: "8px 8px 4px",
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid var(--color-border, #e2e8f0)",
          background: "transparent",
          cursor: "pointer",
          fontSize: 13,
          color: "var(--color-text, #1e293b)",
          whiteSpace: "nowrap",
        }}
      >
        <MessageSquarePlus size={14} />
        新对话
      </button>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 8px" }}>
        {isLoading && (
          <div style={{ padding: "8px 12px", fontSize: 12, color: "#94a3b8" }}>加载中...</div>
        )}
        {!isLoading && sessions.length === 0 && (
          <div style={{ padding: "8px 12px", fontSize: 12, color: "#94a3b8" }}>暂无历史对话</div>
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
                  ? "var(--color-primary-subtle, #eff6ff)"
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
                      border: "1px solid #93c5fd",
                      borderRadius: 4,
                      padding: "1px 4px",
                      outline: "none",
                      background: "white",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: isActive ? 500 : 400,
                      color: isActive ? "var(--color-primary, #2563eb)" : "var(--color-text, #1e293b)",
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      lineHeight: 1.4,
                    }}
                  >
                    {s.title ?? "（新对话）"}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 2,
                  }}
                >
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    {relativeTime(s.updated_at)}
                  </span>
                  {s.message_count > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "#94a3b8",
                        background: "#f1f5f9",
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
                  <span style={{ fontSize: 11, color: "#ef4444", flex: 1 }}>确认删除?</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                    style={{
                      background: "#ef4444",
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
                      border: "1px solid #e2e8f0",
                      borderRadius: 3,
                      padding: "2px 4px",
                      cursor: "pointer",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
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
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 4,
                      padding: "2px 4px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    title="删除"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                    style={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 4,
                      padding: "2px 4px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      color: "#ef4444",
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
