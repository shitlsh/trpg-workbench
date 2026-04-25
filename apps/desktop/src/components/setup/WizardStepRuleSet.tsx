import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { RuleSet, CreateRuleSetRequest } from "@trpg-workbench/shared-schema";

interface Props {
  onComplete: (ruleSet: RuleSet) => void;
  onSkip: () => void;
}

export function WizardStepRuleSet({ onComplete, onSkip }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const createMutation = useMutation({
    mutationFn: (body: CreateRuleSetRequest) =>
      apiFetch<RuleSet>("/rule-sets", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (rs) => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      onComplete(rs);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const slug =
      name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 60) +
      "-" +
      Date.now();
    createMutation.mutate({
      name: name.trim(),
      slug,
      description: desc.trim() || undefined,
    });
  }

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          padding: "10px 14px",
          background: "rgba(124,106,247,0.06)",
          border: "1px solid rgba(124,106,247,0.2)",
          borderRadius: 6,
        }}
      >
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          规则集定义了工作空间的创作风格和知识体系。每个工作空间都需要绑定一个规则集。
        </p>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={labelStyle}>
          规则集名称 *
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：克苏鲁神话 / 奇幻大陆"
            autoFocus
          />
        </label>
        <label style={labelStyle}>
          描述
          <input
            style={inputStyle}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="简单描述这套规则集的主题和风格..."
          />
        </label>
        {createMutation.isError && (
          <p style={{ fontSize: 12, color: "var(--error, #f55)" }}>
            {(createMutation.error as Error).message}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" style={btnSecondaryStyle} onClick={onSkip}>
            稍后创建
          </button>
          <button
            type="submit"
            style={btnPrimaryStyle}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "创建中..." : "创建并继续"}
          </button>
        </div>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
};
const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  fontSize: 13,
  color: "var(--text)",
};
const btnPrimaryStyle: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 6,
  background: "var(--accent, #7c6aff)",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
  border: "none",
};
const btnSecondaryStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: 13,
  cursor: "pointer",
  border: "1px solid var(--border)",
};
