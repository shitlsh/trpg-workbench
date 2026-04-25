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
  onSubmit: (text: string, mentionedAssetIds: string[]) => void;
}

export function MentionInput({ workspaceId, disabled = false, onSubmit }: MentionInputProps) {
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
  const [suggestionPos, setSuggestionPos] = useState<{ top: number; left: number } | null>(null);
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
                // Calculate position relative to container
                const rect = props.clientRect?.();
                if (rect && containerRef.current) {
                  const containerRect = containerRef.current.getBoundingClientRect();
                  setSuggestionPos({
                    top: rect.bottom - containerRect.top,
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
                    top: rect.bottom - containerRect.top,
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
          "padding:8px",
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
      <div style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        opacity: disabled ? 0.6 : 1,
      }}>
        <EditorContent editor={editor} />
      </div>

      {/* Suggestion dropdown */}
      {suggestionProps && suggestionPos && filteredItems.length > 0 && (
        <div style={{
          position: "absolute",
          top: suggestionPos.top,
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
