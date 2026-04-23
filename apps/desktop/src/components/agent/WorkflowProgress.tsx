import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader, Clock, ChevronDown, ChevronRight, BookOpen } from "lucide-react";
import type { WorkflowState, WorkflowStepResult } from "@trpg-workbench/shared-schema";
import { useAgentStore } from "@/stores/agentStore";
import { apiFetch } from "@/lib/api";

interface WorkflowProgressProps {
  onPatchesReady?: (patches: unknown[]) => void;
  onComplete?: () => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle size={14} color="#52c97e" />,
  failed: <XCircle size={14} color="#e05252" />,
  running: <Loader size={14} color="#7c6af7" className="animate-spin" />,
  planning: <Loader size={14} color="#7c6af7" className="animate-spin" />,
  waiting_for_clarification: <Clock size={14} color="#f0a500" />,
  waiting_confirm: <Clock size={14} color="#f0a500" />,
  pending: <div style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--border)" }} />,
};

interface Citation {
  document_filename: string;
  page_from?: number | null;
  page_to?: number | null;
  content: string;
}

function CitationsPanel({ detail }: { detail: string }) {
  const [open, setOpen] = useState(false);
  let citations: Citation[] = [];
  try { citations = JSON.parse(detail) as Citation[]; } catch {}
  if (!citations.length) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          fontSize: 11, color: "var(--accent)", background: "none",
          border: "none", padding: 0, cursor: "pointer",
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <BookOpen size={11} />
        查看 {citations.length} 条引用来源
      </button>
      {open && (
        <div style={{
          marginTop: 4, borderLeft: "2px solid var(--accent)",
          paddingLeft: 8, display: "flex", flexDirection: "column", gap: 6,
        }}>
          {citations.map((c, i) => (
            <div key={i} style={{ fontSize: 11 }}>
              <div style={{ fontWeight: 500, color: "var(--text)" }}>
                {c.document_filename}
                {c.page_from != null && (
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    {" "}p.{c.page_from}{c.page_to && c.page_to !== c.page_from ? `–${c.page_to}` : ""}
                  </span>
                )}
              </div>
              {c.content && (
                <div style={{ color: "var(--text-muted)", marginTop: 1, whiteSpace: "pre-wrap", maxHeight: 60, overflowY: "auto" }}>
                  {c.content.length > 200 ? c.content.slice(0, 200) + "…" : c.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: WorkflowStepResult }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "6px 0",
      borderBottom: "1px solid var(--border)",
      opacity: step.status === "pending" ? 0.4 : 1,
    }}>
      <div style={{ marginTop: 1, flexShrink: 0 }}>{STATUS_ICONS[step.status] ?? STATUS_ICONS.pending}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{step.name}</div>
        {step.summary && step.status !== "waiting_confirm" && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {step.summary.length > 80 ? step.summary.slice(0, 80) + "…" : step.summary}
          </div>
        )}
        {step.error && (
          <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}>{step.error}</div>
        )}
        {step.detail && step.status === "completed" && (
          <CitationsPanel detail={step.detail} />
        )}
      </div>
    </div>
  );
}

export function WorkflowProgress({ onPatchesReady, onComplete }: WorkflowProgressProps) {
  const { activeWorkflow, workflowPolling, setActiveWorkflow, setWorkflowPolling } = useAgentStore();

  // Poll workflow status
  useEffect(() => {
    if (!activeWorkflow || !workflowPolling) return;
    if (["completed", "failed"].includes(activeWorkflow.status)) {
      setWorkflowPolling(false);
      if (activeWorkflow.status === "completed") onComplete?.();
      return;
    }

    const interval = setInterval(async () => {
      try {
        const updated = await apiFetch<WorkflowState>(`/workflows/${activeWorkflow.id}`);
        setActiveWorkflow(updated);

        if (["completed", "failed"].includes(updated.status)) {
          setWorkflowPolling(false);
          if (updated.status === "completed") onComplete?.();
        }

        // If paused at step 6 (modify_asset) — patches are ready for confirm
        if (updated.status === "paused" && updated.type === "modify_asset") {
          setWorkflowPolling(false);
          try {
            const patches = await apiFetch<unknown[]>(`/workflows/${updated.id}/patches`);
            onPatchesReady?.(patches);
          } catch {}
        }
      } catch {}
    }, 2000);

    return () => clearInterval(interval);
  }, [activeWorkflow?.id, workflowPolling]);

  if (!activeWorkflow) return null;

  let stepResults: WorkflowStepResult[] = [];
  try {
    stepResults = JSON.parse(activeWorkflow.step_results) as WorkflowStepResult[];
  } catch {}

  // Build display list: known steps + fill gaps
  const totalSteps = activeWorkflow.total_steps;
  const displaySteps: WorkflowStepResult[] = [];
  for (let i = 1; i <= totalSteps; i++) {
    const found = stepResults.find((s) => s.step === i);
    displaySteps.push(found ?? { step: i, name: `步骤 ${i}`, status: "pending", summary: null });
  }

  const progress = Math.round((activeWorkflow.current_step / totalSteps) * 100);

  return (
    <div style={{
      margin: "8px 0",
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          Workflow: {WORKFLOW_TYPE_LABELS[activeWorkflow.type] ?? activeWorkflow.type}
        </span>
        <span style={{
          fontSize: 11, padding: "1px 6px", borderRadius: 3,
          background: STATUS_BG[activeWorkflow.status] ?? "var(--bg-hover)",
          color: STATUS_FG[activeWorkflow.status] ?? "var(--text-muted)",
        }}>{STATUS_LABELS[activeWorkflow.status] ?? activeWorkflow.status}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>{progress}%</span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: "var(--border)" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", transition: "width 0.3s" }} />
      </div>

      {/* Steps */}
      <div style={{ padding: "0 12px", maxHeight: 240, overflowY: "auto" }}>
        {displaySteps.map((step) => (
          <StepRow key={step.step} step={step} />
        ))}
      </div>

      {/* Actions for paused/waiting */}
      {activeWorkflow.status === "paused" && activeWorkflow.type === "create_module" && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          {activeWorkflow.director_intent && (
            <div style={{
              marginBottom: 8, padding: "6px 8px",
              background: "var(--bg-surface)", borderRadius: 4,
              border: "1px solid var(--border)",
              fontSize: 12, color: "var(--text)",
            }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3, fontWeight: 500 }}>
                Director 意图
              </div>
              {activeWorkflow.director_intent}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={async () => {
                const updated = await apiFetch<WorkflowState>(`/workflows/${activeWorkflow.id}/confirm`, { method: "POST" });
                setActiveWorkflow(updated);
                setWorkflowPolling(true);
              }}
              style={{ ...btnPrimary, flex: 1 }}
            >确认执行</button>
            <button
              onClick={async () => {
                const updated = await apiFetch<WorkflowState>(`/workflows/${activeWorkflow.id}/cancel`, { method: "POST" });
                setActiveWorkflow(updated);
              }}
              style={{ ...btnSecondary, flex: 1 }}
            >取消</button>
          </div>
        </div>
      )}

      {activeWorkflow.status === "failed" && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "#e05252", marginBottom: 6 }}>
            {activeWorkflow.error_message ?? "执行失败"}
          </div>
          {activeWorkflow.error_message?.includes("ModelNotConfiguredError") && (
            <a
              href="/settings/models"
              onClick={(e) => { e.preventDefault(); window.location.href = "/settings/models"; }}
              style={{ fontSize: 11, color: "var(--accent)", textDecoration: "underline", display: "block", marginBottom: 6 }}
            >
              → 前往模型配置页面设置 LLM Profile
            </a>
          )}
          {activeWorkflow.error_message?.includes("API key") && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
              提示：请检查模型配置页中的 API Key 和 Base URL 是否正确。
            </div>
          )}
          <button
            onClick={() => setActiveWorkflow(null)}
            style={{ ...btnSecondary, marginTop: 6, fontSize: 11 }}
          >关闭</button>
        </div>
      )}

      {activeWorkflow.status === "completed" && activeWorkflow.result_summary && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 12, color: "#52c97e" }}>
          ✓ {activeWorkflow.result_summary}
        </div>
      )}
    </div>
  );
}

const WORKFLOW_TYPE_LABELS: Record<string, string> = {
  create_module: "新建模组",
  modify_asset: "修改资产",
  rules_review: "规则审查",
  generate_image: "图像生成",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "等待中", running: "执行中", planning: "规划中",
  waiting_for_clarification: "等待澄清", paused: "等待确认",
  completed: "完成", failed: "失败",
};
const STATUS_BG: Record<string, string> = {
  running: "#1a1a3a", planning: "#1a1a3a", waiting_for_clarification: "#3a2c0a",
  paused: "#3a2c0a", completed: "#0a2a1a", failed: "#2a0a0a",
};
const STATUS_FG: Record<string, string> = {
  running: "#7c6af7", planning: "#7c6af7", waiting_for_clarification: "#f0a500",
  paused: "#f0a500", completed: "#52c97e", failed: "#e05252",
};

const btnPrimary: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 4, fontSize: 12,
  background: "var(--accent)", color: "#fff", cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 4, fontSize: 12,
  background: "var(--bg-surface)", border: "1px solid var(--border)",
  color: "var(--text)", cursor: "pointer",
};
