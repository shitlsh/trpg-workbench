import { useState } from "react";
import type { AgentQuestion, AgentQuestionItem } from "@trpg-workbench/shared-schema";

interface QuestionCardProps {
  question: AgentQuestion;
  onSubmit: (answers: Record<string, string[]>) => void;
  /** If true, card starts in submitted/read-only state (for history reconstruction) */
  initialSubmitted?: boolean;
  /** Pre-selected answers for read-only mode */
  initialSelected?: Record<string, string[]>;
}

/**
 * Renders a structured question card from the Director's ask_user tool call.
 * Questions are shown one at a time with Next / Submit step navigation.
 * Each question has a fixed "Other" option that reveals a free-text input.
 * After submission the card becomes read-only, showing the selected answers.
 */
export function QuestionCard({ question, onSubmit, initialSubmitted = false, initialSelected = {} }: QuestionCardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>(initialSelected);
  const [customText, setCustomText] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(initialSubmitted);

  const totalSteps = question.questions.length;
  const item = question.questions[currentStep];
  const isLastStep = currentStep === totalSteps - 1;

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

  function currentStepAnswered() {
    const key = item.header;
    const choices = selected[key] ?? [];
    if (choices.length === 0) return false;
    // If "其他" is selected, require non-empty custom text
    if (choices.includes("__custom__")) {
      return (customText[currentStep] ?? "").trim().length > 0;
    }
    return true;
  }

  function handleNext() {
    if (!currentStepAnswered() || submitted) return;
    setCurrentStep((s) => s + 1);
  }

  function handleSubmit() {
    if (!currentStepAnswered() || submitted) return;
    // Replace __custom__ sentinel with actual typed text in the final answers
    const finalAnswers: Record<string, string[]> = {};
    for (const [header, labels] of Object.entries(selected)) {
      const stepIndex = question.questions.findIndex((q) => q.header === header);
      finalAnswers[header] = labels.map((l) =>
        l === "__custom__" ? (customText[stepIndex] ?? "").trim() : l
      );
    }
    setSubmitted(true);
    onSubmit(finalAnswers);
  }

  // ── Read-only submitted view ──────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-surface)",
        padding: "14px 16px",
        marginTop: 6,
        maxWidth: "100%",
      }}>
        {/* Header */}
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
            background: "var(--text-subtle)",
            flexShrink: 0,
          }} />
          已回答
        </div>
        {/* All questions summary */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {question.questions.map((q, idx) => {
            const choices = selected[q.header] ?? [];
            const displayChoices = choices.map((l) =>
              l === "__custom__" ? (customText[idx] ?? "").trim() : l
            );
            return (
              <div key={q.header}>
                <div style={{ fontSize: 11, color: "var(--text-subtle)", marginBottom: 2 }}>
                  {q.header}
                </div>
                <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
                  {displayChoices.join("、") || "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Interactive view ──────────────────────────────────────────────────────
  const chosenLabels = selected[item.header] ?? [];
  const isCustomSelected = chosenLabels.includes("__custom__");
  const canProceed = currentStepAnswered();
  const allowCustom = item.allow_custom ?? false;

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 10,
      background: "var(--bg-surface)",
      padding: "14px 16px",
      marginTop: 6,
      maxWidth: "100%",
    }}>
      {/* Header row with step indicator */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
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
            background: "var(--accent)",
            flexShrink: 0,
            boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)",
          }} />
          需要确认
        </div>
        {totalSteps > 1 && (
          <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
            {currentStep + 1} / {totalSteps}
          </span>
        )}
      </div>

      {/* Current question */}
      <div style={{ marginBottom: 12 }}>
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
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "7px 10px",
                  borderRadius: 7,
                  border: isChosen ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: isChosen
                    ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                    : "var(--bg)",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  transition: "background 0.12s, border-color 0.12s",
                }}
              >
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

          {/* "其他" option — always shown */}
          {(() => {
            const isChosen = isCustomSelected;
            return (
              <button
                key="__custom__"
                onClick={() => toggle(item, "__custom__")}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "7px 10px",
                  borderRadius: 7,
                  border: isChosen ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: isChosen
                    ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                    : "var(--bg)",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  transition: "background 0.12s, border-color 0.12s",
                }}
              >
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
                <span style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, color: "var(--text)", fontWeight: isChosen ? 500 : 400 }}>
                    其他
                  </span>
                  {!isChosen && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginTop: 1 }}>
                      {allowCustom ? "欢迎自由输入你的想法" : "自行输入内容"}
                    </span>
                  )}
                </span>
              </button>
            );
          })()}

          {/* Free-text input shown when "其他" is selected */}
          {isCustomSelected && (
            <input
              autoFocus
              type="text"
              placeholder={allowCustom ? "请输入你的想法..." : "请输入内容..."}
              value={customText[currentStep] ?? ""}
              onChange={(e) =>
                setCustomText((prev) => ({ ...prev, [currentStep]: e.target.value }))
              }
              style={{
                marginTop: 4,
                padding: "7px 10px",
                borderRadius: 7,
                border: "1px solid var(--accent)",
                background: "var(--bg)",
                fontSize: 13,
                color: "var(--text)",
                width: "100%",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>
      </div>

      {/* Navigation button */}
      <button
        onClick={isLastStep ? handleSubmit : handleNext}
        disabled={!canProceed}
        style={{
          marginTop: 4,
          padding: "6px 16px",
          borderRadius: 6,
          border: "none",
          background: canProceed ? "var(--accent)" : "var(--bg-hover)",
          color: canProceed ? "#fff" : "var(--text-subtle)",
          fontSize: 12,
          fontWeight: 600,
          cursor: canProceed ? "pointer" : "not-allowed",
          transition: "background 0.12s",
        }}
      >
        {isLastStep ? "提交" : "下一个 →"}
      </button>
    </div>
  );
}
