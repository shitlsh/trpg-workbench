/**
 * ContextUsageBadge — estimates context window usage for the current chat session.
 *
 * Uses simple char/4 approximation (±10% error acceptable per M7 spec).
 * Shows a progress bar; turns yellow warning when >80% of context_window is used.
 */

interface ContextUsageBadgeProps {
  /** All chat messages in the current session (content strings). */
  messages: string[];
  /** Context window size in tokens (from model catalog). null = unknown. */
  contextWindow: number | null;
}

function estimateTokens(texts: string[]): number {
  const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
  return Math.ceil(totalChars / 4);
}

export default function ContextUsageBadge({ messages, contextWindow }: ContextUsageBadgeProps) {
  if (!contextWindow || messages.length === 0) return null;

  const estimatedTokens = estimateTokens(messages);
  const pct = Math.min(estimatedTokens / contextWindow, 1);
  const pctDisplay = Math.round(pct * 100);
  const isWarning = pct >= 0.8;

  const barColor = isWarning ? "#f5a623" : "var(--accent, #7c6aff)";
  const textColor = isWarning ? "#f5a623" : "var(--text-muted, #888)";

  return (
    <div style={{
      padding: "6px 12px",
      borderRadius: 6,
      background: "var(--surface, #1a1a1a)",
      border: `1px solid ${isWarning ? "#f5a623" : "var(--border, #2a2a2a)"}`,
      marginBottom: 8,
      fontSize: 12,
      color: textColor,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span>Context: ~{estimatedTokens.toLocaleString()} / {contextWindow.toLocaleString()} tokens ({pctDisplay}%)</span>
        {isWarning && <span>⚠ 建议开启新对话或精简历史</span>}
      </div>
      <div style={{ height: 4, background: "var(--border, #2a2a2a)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pctDisplay}%`, background: barColor, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}
