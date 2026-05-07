import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { RuleSet, Workspace, CreateWorkspaceRequest, WorkspaceConfigResponse } from "@trpg-workbench/shared-schema";

interface Props {
  onComplete: (workspace: Workspace) => void;
  onSkip: () => void;
  /** A7: LLM profile name selected in Step 1 — pre-fills workspace model routing */
  suggestedLlmProfileName?: string;
  /** A7: model name selected after key verification in Step 1 */
  suggestedLlmModel?: string;
}

export function WizardStep4Workspace({ onComplete, onSkip, suggestedLlmProfileName, suggestedLlmModel }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateWorkspaceRequest>({ name: "", description: "" });

  const { data: ruleSets = [] } = useQuery<RuleSet[]>({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateWorkspaceRequest) =>
      apiFetch<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async (workspace) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      // A7: if Step 1 produced a suggested model, patch workspace config immediately
      if (suggestedLlmProfileName) {
        try {
          const { config } = await apiFetch<WorkspaceConfigResponse>(`/workspaces/${workspace.id}/config`);
          await apiFetch(`/workspaces/${workspace.id}/config`, {
            method: "PATCH",
            body: JSON.stringify({
              ...config,
              models: {
                ...(config.models ?? {}),
                default_llm: suggestedLlmProfileName,
                ...(suggestedLlmModel ? { default_llm_model: suggestedLlmModel } : {}),
              },
            }),
          });
        } catch {
          // Non-fatal: workspace is created, model pre-fill just didn't happen
        }
      }
      onComplete(workspace);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate(form);
  }

  return (
    <div>
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6 }}>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          创建你的第一个工作空间，每个工作空间对应一个独立的游戏世界或模组项目。
        </p>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={labelStyle}>
          工作空间名称 *
          <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：克苏鲁世界观 2024" autoFocus />
        </label>
        <label style={labelStyle}>
          描述
          <input style={inputStyle} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="简单描述这个工作空间的内容..." />
        </label>
        <label style={labelStyle}>
          规则集 *
          {ruleSets.length === 0 ? (
            <div style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle, var(--bg))", fontSize: 12, color: "var(--text-muted)" }}>
              暂无规则集，请先在「规则集」页面创建
            </div>
          ) : (
            <select style={inputStyle} value={form.rule_set ?? ""} onChange={(e) => setForm({ ...form, rule_set: e.target.value })}>
              <option value="">请选择规则集...</option>
              {ruleSets.map((rs) => <option key={rs.id} value={rs.name}>{rs.name}</option>)}
            </select>
          )}
        </label>
        {createMutation.isError && (
          <p style={{ fontSize: 12, color: "var(--error, #f55)" }}>{(createMutation.error as Error).message}</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" style={btnSecondaryStyle} onClick={onSkip}>稍后创建</button>
          <button type="submit" style={btnPrimaryStyle} disabled={!form.name || !form.rule_set || createMutation.isPending}>
            {createMutation.isPending ? "创建中..." : "创建并继续"}
          </button>
        </div>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 };
const inputStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 13, color: "var(--text)" };
const btnPrimaryStyle: React.CSSProperties = { padding: "8px 20px", borderRadius: 6, background: "var(--accent, #7c6aff)", color: "#fff", fontSize: 13, cursor: "pointer", border: "none" };
const btnSecondaryStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", border: "1px solid var(--border)" };
