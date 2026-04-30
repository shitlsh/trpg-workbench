import type { AgentPlan, AgentPlanStep, PlanStepStatus } from "@trpg-workbench/shared-schema";

interface PlanCardProps {
  plan: AgentPlan;
}

function statusIcon(status: PlanStepStatus): React.ReactNode {
  switch (status) {
    case "done":
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--accent)",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}>✓</span>
      );
    case "running":
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: "2px solid var(--accent)",
          flexShrink: 0,
          animation: "plan-spin 1s linear infinite",
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
          }} />
        </span>
      );
    case "error":
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--danger)",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}>✗</span>
      );
    default: // pending
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: "1.5px solid var(--text-muted)",
          flexShrink: 0,
        }} />
      );
  }
}

function stepTextColor(status: PlanStepStatus): string {
  switch (status) {
    case "done": return "var(--text-subtle)";
    case "running": return "var(--text)";
    case "error": return "var(--danger)";
    default: return "var(--text-muted)";
  }
}

function PlanStep({ step }: { step: AgentPlanStep }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 0",
    }}>
      {statusIcon(step.status)}
      <span style={{
        fontSize: 12,
        lineHeight: 1.5,
        color: stepTextColor(step.status),
        textDecoration: step.status === "done" ? "line-through" : "none",
        transition: "color 0.2s, text-decoration 0.2s",
      }}>
        {step.label}
      </span>
    </div>
  );
}

/**
 * Renders a structured task plan emitted by the Director before batch execution.
 * Steps transition through pending → running → done/error as tool calls complete.
 * This component is UI-only metadata and is not persisted to message history.
 */
export function PlanCard({ plan }: PlanCardProps) {
  const allDone = plan.steps.every((s) => s.status === "done" || s.status === "error");
  const doneCount = plan.steps.filter((s) => s.status === "done").length;
  const total = plan.steps.length;

  return (
    <div style={{
      marginBottom: 10,
      padding: "10px 12px",
      borderRadius: 8,
      border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
      background: "color-mix(in srgb, var(--bg-surface) 60%, transparent)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 8,
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: allDone ? "var(--accent)" : "color-mix(in srgb, var(--accent) 50%, var(--color-type-clue))",
          flexShrink: 0,
          transition: "background 0.3s",
        }} />
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-subtle)",
          letterSpacing: "0.03em",
          textTransform: "uppercase",
        }}>
          {allDone ? `已完成 ${doneCount}/${total}` : `执行计划 ${doneCount}/${total}`}
        </span>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {plan.steps.map((step) => (
          <PlanStep key={step.id} step={step} />
        ))}
      </div>

      {/* Inline keyframes via style tag — scoped to avoid global pollution */}
      <style>{`
        @keyframes plan-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
