interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export function WizardStep3Rerank({ onComplete: _onComplete, onSkip }: Props) {
  return (
    <div>
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(255,200,100,0.08)", border: "1px solid rgba(255,200,100,0.25)", borderRadius: 6 }}>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          重排序（Rerank）是可选功能，用于提升 RAG 检索精度。如无特殊需求，可跳过此步骤，稍后在模型配置中添加。
        </p>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSecondaryStyle} onClick={onSkip}>跳过此步骤</button>
      </div>
    </div>
  );
}

const btnSecondaryStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", border: "1px solid var(--border)" };
