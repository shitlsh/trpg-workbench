/**
 * MentionInput – tiptap-based input with @asset mention support.
 *
 * Usage:
 *   <MentionInput
 *     workspaceId="ws_..."
 *     onSubmit={(text, mentionedIds) => handleSend(text, mentionedIds)}
 *     disabled={false}
 *   />
 */
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { SuggestionProps } from "@tiptap/suggestion";
import { apiFetch } from "@/lib/api";

// ─── Suggestion dropdown ──────────────────────────────────────────────────────

interface AssetOption {
  id: string;
  name: string;
  type: string;
  slug: string;
}

interface SuggestionListProps {
  items: AssetOption[];
  command: (item: { id: string; label: string }) => void;
  selectedIndex: number;
}

function SuggestionList({ items, command, selectedIndex }: SuggestionListProps) {
  if (items.length === 0) return null;
  return (
    <div style={{
      position: "absolute",
      background: "var(--bg-surface)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      padding: "4px 0",
      zIndex: 500,
      minWidth: 200,
      maxWidth: 300,
      maxHeight: 200,
      overflowY: "auto",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    }}>
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={() => command({ id: item.id, label: item.name })}
          style={{
            display: "block",
            width: "100%",
            padding: "6px 12px",
            textAlign: "left",
            background: i === selectedIndex ? "var(--bg-hover)" : "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            color: "var(--text)",
          }}
        >
          <span style={{ color: "var(--text-muted)", marginRight: 6, fontSize: 10 }}>{item.type}</span>
          {item.name}
        </button>
      ))}
    </div>
  );
}

// ─── MentionInput component ───────────────────────────────────────────────────

interface MentionInputProps {
  workspaceId: string;
  disabled?: boolean;
  isStreaming?: boolean;
  queueLength?: number;
  onSubmit: (text: string, mentionedAssetIds: string[]) => void;
  onStop?: () => void;
}

export function MentionInput({ workspaceId, disabled = false, isStreaming = false, queueLength = 0, onSubmit, onStop }: MentionInputProps) {
  const [allAssets, setAllAssets] = useState<AssetOption[]>([]);
  // Load assets once for suggestions
  useEffect(() => {
    if (!workspaceId) return;
    apiFetch<{ items: AssetOption[] }>(`/workspaces/${workspaceId}/assets?page_size=200`)
      .then((r) => setAllAssets(r.items ?? []))
      .catch(() => {});
  }, [workspaceId]);

  // Suggestion state managed by tiptap's renderer pattern
  const [suggestionProps, setSuggestionProps] = useState<SuggestionProps | null>(null);
  const [suggestionPos, setSuggestionPos] = useState<{ bottom: number; left: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredItems = (suggestionProps?.query
    ? allAssets.filter((a) =>
        a.name.toLowerCase().includes(suggestionProps.query.toLowerCase()) ||
        a.slug.toLowerCase().includes(suggestionProps.query.toLowerCase())
      )
    : allAssets
  ).slice(0, 10);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ hardBreak: false }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: {
          items: ({ query }: { query: string }) =>
            allAssets
              .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 10),
          render: () => {
            return {
              onStart: (props: SuggestionProps) => {
                setSuggestionProps(props);
                setSelectedIndex(0);
                // Position dropdown ABOVE the cursor (input is at panel bottom)
                const rect = props.clientRect?.();
                if (rect && containerRef.current) {
                  const containerRect = containerRef.current.getBoundingClientRect();
                  setSuggestionPos({
                    bottom: containerRect.bottom - rect.top,
                    left: rect.left - containerRect.left,
                  });
                }
              },
              onUpdate: (props: SuggestionProps) => {
                setSuggestionProps(props);
                setSelectedIndex(0);
                const rect = props.clientRect?.();
                if (rect && containerRef.current) {
                  const containerRect = containerRef.current.getBoundingClientRect();
                  setSuggestionPos({
                    bottom: containerRect.bottom - rect.top,
                    left: rect.left - containerRect.left,
                  });
                }
              },
              onKeyDown: ({ event }: { event: KeyboardEvent }) => {
                if (event.key === "ArrowDown") {
                  setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
                  return true;
                }
                if (event.key === "ArrowUp") {
                  setSelectedIndex((i) => Math.max(i - 1, 0));
                  return true;
                }
                if (event.key === "Enter" && suggestionProps) {
                  const item = filteredItems[selectedIndex];
                  if (item) {
                    suggestionProps.command({ id: item.id, label: item.name });
                    setSuggestionProps(null);
                    return true;
                  }
                }
                if (event.key === "Escape") {
                  setSuggestionProps(null);
                  return true;
                }
                return false;
              },
              onExit: () => {
                setSuggestionProps(null);
                setSuggestionPos(null);
              },
            };
          },
        },
      }),
    ],
    editorProps: {
      attributes: {
        style: [
          "min-height:68px",
          "max-height:150px",
          "overflow-y:auto",
          "padding:8px 38px 8px 8px",
          "outline:none",
          "font-size:13px",
          "line-height:1.5",
          "color:var(--text)",
          "word-break:break-word",
        ].join(";"),
      },
      handleKeyDown: (_view, event) => {
        // Submit on Enter (without shift), unless suggestion open
        if (event.key === "Enter" && !event.shiftKey && !suggestionProps) {
          event.preventDefault();
          doSubmit();
          return true;
        }
        return false;
      },
    },
    editable: !disabled,
  });

  // Sync disabled → editor.editable (TipTap doesn't watch the init-time option)
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Extract plain text and mention ids from editor
  const doSubmit = () => {
    if (!editor) return;
    const json = editor.getJSON();

    // Extract mentioned asset IDs
    const mentionedIds: string[] = [];
    const traverse = (node: Record<string, unknown>) => {
      if (node.type === "mention" && node.attrs) {
        const id = (node.attrs as Record<string, unknown>).id as string;
        if (id && !mentionedIds.includes(id)) mentionedIds.push(id);
      }
      if (Array.isArray(node.content)) {
        (node.content as Record<string, unknown>[]).forEach(traverse);
      }
    };
    traverse(json as Record<string, unknown>);

    // Extract plain text
    const text = editor.getText({ blockSeparator: "\n" }).trim();
    if (!text) return;

    onSubmit(text, mentionedIds);
    editor.commands.clearContent();
  };

  return (
    <div ref={containerRef} style={{ position: "relative", flex: 1 }}>
      {/* Queue indicator */}
      {queueLength > 0 && (
        <div style={{
          fontSize: 11,
          color: "var(--text-muted)",
          padding: "2px 6px 4px",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}>
          <span style={{
            display: "inline-block",
            width: 6, height: 6,
            borderRadius: "50%",
            background: "#d29922",
            flexShrink: 0,
          }} />
          {queueLength} 条消息将在当前回复完成后发送
        </div>
      )}
      <div style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        opacity: disabled && !isStreaming ? 0.6 : 1,
        position: "relative",
      }}>
        <EditorContent editor={editor} />

        {/* Send / Stop button — bottom-right of input */}
        <button
          onClick={isStreaming ? onStop : doSubmit}
          title={isStreaming ? "停止生成" : "发送 (Enter)"}
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            width: 26,
            height: 26,
            borderRadius: 6,
            border: "none",
            cursor: isStreaming ? "pointer" : (disabled ? "default" : "pointer"),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isStreaming
              ? "rgba(239, 68, 68, 0.15)"
              : "var(--accent, rgba(74,144,217,0.15))",
            color: isStreaming ? "#ef4444" : "var(--accent-text, #4a90d9)",
            transition: "background 0.15s, color 0.15s",
            flexShrink: 0,
          }}
        >
          {isStreaming
            ? <Square size={12} fill="currentColor" />
            : <ArrowUp size={13} strokeWidth={2.5} />
          }
        </button>
      </div>

      {/* Suggestion dropdown — anchored above cursor */}
      {suggestionProps && suggestionPos && filteredItems.length > 0 && (
        <div style={{
          position: "absolute",
          bottom: suggestionPos.bottom,
          left: suggestionPos.left,
          zIndex: 500,
        }}>
          <SuggestionList
            items={filteredItems}
            command={(item) => {
              suggestionProps.command(item);
              setSuggestionProps(null);
            }}
            selectedIndex={selectedIndex}
          />
        </div>
      )}

      {/* Mention chip styles injected globally */}
      <style>{`
        .mention {
          display: inline-block;
          background: rgba(74, 144, 217, 0.15);
          border: 1px solid rgba(74, 144, 217, 0.4);
          color: #4a90d9;
          border-radius: 4px;
          padding: 0 4px;
          font-size: 12px;
          cursor: default;
          user-select: none;
        }
        .ProseMirror p { margin: 0; }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--text-muted);
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
}
