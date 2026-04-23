import { useState } from "react";
import type { LLMProfile, EmbeddingProfile, Workspace } from "@trpg-workbench/shared-schema";
import { WizardStep1LLM } from "../components/setup/WizardStep1LLM";
import { WizardStep2Embedding } from "../components/setup/WizardStep2Embedding";
import { WizardStep3Rerank } from "../components/setup/WizardStep3Rerank";
import { WizardStep4Workspace } from "../components/setup/WizardStep4Workspace";
import { WizardSummary } from "../components/setup/WizardSummary";

type StepStatus = "pending" | "completed" | "skipped";

const STEPS = [
  { label: "LLM 模型" },
  { label: "Embedding 模型" },
  { label: "Rerank（可选）" },
  { label: "工作空间" },
];

export default function SetupWizardPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepStatus, setStepStatus] = useState<StepStatus[]>(["pending", "pending", "pending", "pending"]);
  const [llmProfile, setLlmProfile] = useState<LLMProfile | null>(null);
  const [embeddingProfile, setEmbeddingProfile] = useState<EmbeddingProfile | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [done, setDone] = useState(false);

  function advanceStep(index: number, status: StepStatus) {
    setStepStatus((prev) => { const next = [...prev]; next[index] = status; return next; });
    if (index + 1 < STEPS.length) setCurrentStep(index + 1);
    else setDone(true);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ width: 560, background: "var(--surface, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: 32, boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>欢迎使用 TRPG Workbench</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 0" }}>完成以下步骤以开始你的创作之旅</p>
        </div>

        {/* Stepper */}
        {!done && (
          <div style={{ display: "flex", gap: 0, marginBottom: 28 }}>
            {STEPS.map((step, i) => {
              const status = stepStatus[i];
              const isActive = i === currentStep;
              const isDone = status === "completed" || status === "skipped";
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, position: "relative" }}>
                  {/* connector line */}
                  {i > 0 && (
                    <div style={{ position: "absolute", left: 0, top: 13, width: "50%", height: 2, background: isDone || stepStatus[i - 1] !== "pending" ? "var(--accent, #7c6aff)" : "var(--border)" }} />
                  )}
                  {i < STEPS.length - 1 && (
                    <div style={{ position: "absolute", right: 0, top: 13, width: "50%", height: 2, background: isDone ? "var(--accent, #7c6aff)" : "var(--border)" }} />
                  )}
                  {/* dot */}
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", zIndex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 600,
                    background: isDone ? "var(--accent, #7c6aff)" : isActive ? "rgba(124,106,247,0.2)" : "var(--bg)",
                    border: `2px solid ${isDone || isActive ? "var(--accent, #7c6aff)" : "var(--border)"}`,
                    color: isDone ? "#fff" : isActive ? "var(--accent, #7c6aff)" : "var(--text-muted)",
                  }}>
                    {isDone ? (status === "skipped" ? "—" : "✓") : i + 1}
                  </div>
                  <span style={{ fontSize: 11, color: isActive ? "var(--accent, #7c6aff)" : "var(--text-muted)", textAlign: "center", whiteSpace: "nowrap" }}>{step.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Step content */}
        {done ? (
          <WizardSummary llmProfile={llmProfile} embeddingProfile={embeddingProfile} workspace={workspace} />
        ) : currentStep === 0 ? (
          <WizardStep1LLM
            onComplete={(p) => { setLlmProfile(p); advanceStep(0, "completed"); }}
            onSkip={() => advanceStep(0, "skipped")}
          />
        ) : currentStep === 1 ? (
          <WizardStep2Embedding
            onComplete={(p) => { setEmbeddingProfile(p); advanceStep(1, "completed"); }}
            onSkip={() => advanceStep(1, "skipped")}
          />
        ) : currentStep === 2 ? (
          <WizardStep3Rerank
            onComplete={() => advanceStep(2, "completed")}
            onSkip={() => advanceStep(2, "skipped")}
          />
        ) : (
          <WizardStep4Workspace
            onComplete={(w) => { setWorkspace(w); advanceStep(3, "completed"); }}
            onSkip={() => { advanceStep(3, "skipped"); setDone(true); }}
          />
        )}
      </div>
    </div>
  );
}
