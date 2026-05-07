import type { LLMProfile, EmbeddingProfile, RuleSet, Workspace } from "@trpg-workbench/shared-schema";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "../../stores/settingsStore";

interface Props {
  llmProfile: LLMProfile | null;
  embeddingProfile: EmbeddingProfile | null;
  ruleSet?: RuleSet | null;
  workspace: Workspace | null;
}

export function WizardSummary({ llmProfile, embeddingProfile, ruleSet, workspace }: Props) {
  const navigate = useNavigate();
  const { completeSetup } = useSettingsStore();

  function handleFinish() {
    completeSetup();
    if (workspace) {
      navigate(`/workspace/${workspace.id}`);
    } else {
      navigate("/");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 14, color: "var(--text)", margin: 0 }}>
        初始配置完成！以下是你的配置摘要：
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SummaryRow label="LLM 供应商" value={llmProfile?.name ?? null} skipped={!llmProfile} />
        <SummaryRow label="Embedding 模型" value={embeddingProfile?.name ?? null} skipped={!embeddingProfile} />
        <SummaryRow label="规则集" value={ruleSet?.name ?? null} skipped={!ruleSet} />
        <SummaryRow label="工作空间" value={workspace?.name ?? null} skipped={!workspace} />
      </div>
      <div style={{ padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6 }}>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          跳过的配置可以在「模型配置」页面随时补充。
        </p>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnPrimaryStyle} onClick={handleFinish}>
          开始使用 →
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, skipped }: { label: string; value: string | null; skipped: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 13, color: "var(--text-muted)", width: 120 }}>{label}</span>
      {skipped ? (
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>已跳过</span>
      ) : (
        <span style={{ fontSize: 13, color: "var(--text)" }}>{value}</span>
      )}
    </div>
  );
}

const btnPrimaryStyle: React.CSSProperties = { padding: "8px 24px", borderRadius: 6, background: "var(--accent, #7c6aff)", color: "#fff", fontSize: 13, cursor: "pointer", border: "none" };
