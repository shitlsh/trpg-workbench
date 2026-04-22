import { useState } from "react";
import { MessageSquare, ChevronRight } from "lucide-react";
import type { ClarificationQuestion } from "@trpg-workbench/shared-schema";

interface Props {
  questions: ClarificationQuestion[];
  preliminaryPlan: string | null;
  onSubmit: (answers: Record<string, string | string[]>) => void;
  isSubmitting: boolean;
}

export function ClarificationCard({ questions, preliminaryPlan, onSubmit, isSubmitting }: Props) {
  // Initialize answers with recommended defaults
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() => {
    const initial: Record<string, string | string[]> = {};
    for (const q of questions) {
      if (q.recommended_default) {
        initial[q.id] = q.type === "multi_choice" ? [q.recommended_default] : q.recommended_default;
      } else if (q.type === "multi_choice") {
        initial[q.id] = [];
      } else {
        initial[q.id] = "";
      }
    }
    return initial;
  });
  const [freeTexts, setFreeTexts] = useState<Record<string, string>>({});

  const setAnswer = (qid: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const handleUseDefaults = () => {
    const defaults: Record<string, string | string[]> = {};
    for (const q of questions) {
      if (q.recommended_default) {
        defaults[q.id] = q.type === "multi_choice" ? [q.recommended_default] : q.recommended_default;
      } else {
        defaults[q.id] = freeTexts[q.id] || answers[q.id] || "";
      }
    }
    onSubmit(defaults);
  };

  const handleSubmit = () => {
    const finalAnswers = { ...answers };
    // Merge in free text overrides
    for (const [qid, text] of Object.entries(freeTexts)) {
      if (text.trim()) finalAnswers[qid] = text.trim();
    }
    onSubmit(finalAnswers);
  };

  return (
    <div style={{
      margin: "8px 0",
      padding: "12px 14px",
      background: "var(--bg-surface)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      fontSize: 13,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontWeight: 600, color: "var(--text)" }}>
        <MessageSquare size={14} />
        AI 需要了解几个关键信息
      </div>

      {preliminaryPlan && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, fontStyle: "italic" }}>
          {preliminaryPlan}
        </div>
      )}

      {questions.map((q, qi) => (
        <div key={q.id} style={{ marginBottom: qi < questions.length - 1 ? 14 : 8 }}>
          <div style={{ marginBottom: 6, fontWeight: 500, color: "var(--text)", fontSize: 12 }}>
            {qi + 1}. {q.question}
          </div>

          {q.type === "free_text" ? (
            <textarea
              value={freeTexts[q.id] ?? (answers[q.id] as string ?? "")}
              onChange={(e) => {
                setFreeTexts((prev) => ({ ...prev, [q.id]: e.target.value }));
                setAnswer(q.id, e.target.value);
              }}
              rows={2}
              placeholder="请输入您的想法..."
              style={{
                width: "100%", resize: "none", padding: "6px 8px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 4, color: "var(--text)", fontSize: 12,
                boxSizing: "border-box",
              }}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {q.options.map((opt) => {
                const isSelected = q.type === "single_choice"
                  ? answers[q.id] === opt.id
                  : (answers[q.id] as string[]).includes(opt.id);
                const isDefault = opt.id === q.recommended_default;

                return (
                  <label
                    key={opt.id}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
                      padding: "5px 8px", borderRadius: 4,
                      background: isSelected ? "rgba(var(--accent-rgb, 99,102,241), 0.12)" : "transparent",
                      border: isSelected ? "1px solid rgba(var(--accent-rgb, 99,102,241), 0.4)" : "1px solid transparent",
                      transition: "all 0.1s",
                    }}
                    onClick={() => {
                      if (q.type === "single_choice") {
                        setAnswer(q.id, opt.id);
                      } else {
                        const current = (answers[q.id] as string[]) || [];
                        if (current.includes(opt.id)) {
                          setAnswer(q.id, current.filter((v) => v !== opt.id));
                        } else {
                          setAnswer(q.id, [...current, opt.id]);
                        }
                      }
                    }}
                  >
                    <div style={{
                      flexShrink: 0, marginTop: 2,
                      width: 13, height: 13,
                      borderRadius: q.type === "single_choice" ? "50%" : 3,
                      border: `2px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                      background: isSelected ? "var(--accent)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isSelected && q.type === "multi_choice" && (
                        <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, color: "var(--text)" }}>{opt.label}</span>
                      {isDefault && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, color: "var(--accent)",
                          background: "rgba(var(--accent-rgb, 99,102,241), 0.1)",
                          padding: "1px 5px", borderRadius: 10,
                        }}>推荐</span>
                      )}
                      {opt.description && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                          {opt.description}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button
          onClick={handleUseDefaults}
          disabled={isSubmitting}
          style={{
            padding: "5px 12px", borderRadius: 5, fontSize: 11,
            background: "var(--bg-hover)", border: "1px solid var(--border)",
            color: "var(--text-muted)", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          使用推荐默认值，直接开始
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          style={{
            padding: "5px 14px", borderRadius: 5, fontSize: 11,
            background: "var(--accent)", border: "none",
            color: "#fff", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          {isSubmitting ? "提交中..." : "提交回答"}
          {!isSubmitting && <ChevronRight size={12} />}
        </button>
      </div>
    </div>
  );
}
