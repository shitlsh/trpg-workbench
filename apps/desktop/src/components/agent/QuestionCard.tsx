import { useState } from "react";
import type { AgentQuestion, AgentQuestionItem } from "@trpg-workbench/shared-schema";

interface QuestionCardProps {
  question: AgentQuestion;
  onSubmit: (answers: Record<string, string[]>) => void;
}

/**
 * Renders a structured question card from the Director's ask_user tool call.
 * Each AgentQuestionItem is displayed as a block with option buttons.
 * After submission the card becomes read-only, showing the selected answers.
 */
export function QuestionCard({ question, onSubmit }: QuestionCardProps) {
  // selected[header] = array of chosen option labels
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);

  function toggle(item: AgentQuestionItem, label: string) {
    if (submitted) return;
    const key = item.header;
    const current = selected[key] ?? [];
    if (item.multiple) {
      setSelected((prev) => ({
        ...prev,
        [key]: current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label],
      }));
    } else {
      setSelected((prev) => ({ ...prev, [key]: [label] }));
    }
  }

  function allAnswered() {
    return question.questions.every((item) => (selected[item.header]?.length ?? 0) > 0);
  }

  function handleSubmit() {
    if (!allAnswered() || submitted) return;
    setSubmitted(true);
    onSubmit(selected);
  }

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 10,
      background: "var(--bg-surface)",
      padding: "14px 16px",
      marginTop: 6,
      maxWidth: "100%",
    }}>
      {/* Header row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 12,
        color: "var(--text-muted)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: submitted ? "var(--text-subtle)" : "var(--accent)",
          flexShrink: 0,
          boxShadow: submitted ? "none" : "0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)",
        }} />
        {submitted ? "已回答" : "需要确认"}
      </div>

      {/* Question blocks */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {question.questions.map((item) => {
          const chosenLabels = selected[item.header] ?? [];
          return (
            <div key={item.header}>
              {/* Question header + text */}
              <div style={{ fontSize: 11, color: "var(--text-subtle)", marginBottom: 2 }}>
                {item.header}
              </div>
              <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8, lineHeight: 1.5 }}>
                {item.question}
              </div>

              {/* Options */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {item.options.map((opt) => {
                  const isChosen = chosenLabels.includes(opt.label);
                  return (
                    <button
                      key={opt.label}
                      onClick={() => toggle(item, opt.label)}
                      disabled={submitted}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "7px 10px",
                        borderRadius: 7,
                        border: isChosen
                          ? "1px solid var(--accent)"
                          : "1px solid var(--border)",
                        background: isChosen
                          ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                          : "var(--bg)",
                        cursor: submitted ? "default" : "pointer",
                        textAlign: "left",
                        width: "100%",
                        transition: "background 0.12s, border-color 0.12s",
                      }}
                    >
                      {/* Radio/checkbox indicator */}
                      <span style={{
                        width: 14,
                        height: 14,
                        borderRadius: item.multiple ? 3 : "50%",
                        border: isChosen ? "2px solid var(--accent)" : "2px solid var(--border)",
                        background: isChosen ? "var(--accent)" : "transparent",
                        flexShrink: 0,
                        marginTop: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        {isChosen && (
                          <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>
                        )}
                      </span>
                      <span>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: isChosen ? 500 : 400 }}>
                          {opt.label}
                        </span>
                        {opt.description && (
                          <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginTop: 1 }}>
                            {opt.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit button */}
      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={!allAnswered()}
          style={{
            marginTop: 14,
            padding: "6px 16px",
            borderRadius: 6,
            border: "none",
            background: allAnswered() ? "var(--accent)" : "var(--bg-hover)",
            color: allAnswered() ? "#fff" : "var(--text-subtle)",
            fontSize: 12,
            fontWeight: 600,
            cursor: allAnswered() ? "pointer" : "not-allowed",
            transition: "background 0.12s",
          }}
        >
          提交
        </button>
      )}
    </div>
  );
}
