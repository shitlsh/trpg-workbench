import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Workspace, RuleSet, WorkspaceConfigResponse } from "@trpg-workbench/shared-schema";
import { ThreePanelLayout } from "@/components/editor/ThreePanelLayout";
import { AssetTree } from "@/components/editor/AssetTree";
import { EditorCenter } from "@/components/editor/EditorCenter";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: workspace, isLoading } = useQuery<Workspace>({
    queryKey: ["workspace", id],
    queryFn: () => apiFetch<Workspace>(`/workspaces/${id}`),
    enabled: !!id,
  });

  const { data: configResp } = useQuery({
    queryKey: ["workspace", id, "config"],
    queryFn: () => apiFetch<WorkspaceConfigResponse>(`/workspaces/${id}/config`),
    enabled: !!id,
  });

  const { data: ruleSets = [] } = useQuery({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  const config = configResp?.config;
  const ruleSet = ruleSets.find((rs) => rs.name === config?.rule_set || rs.slug === config?.rule_set);

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: "var(--text-muted)" }}>加载中...</div>
    );
  }

  if (!workspace) {
    return (
      <div style={{ padding: 32, color: "var(--danger)" }}>
        找不到 Workspace
        <button onClick={() => navigate("/")} style={{ marginLeft: 12, color: "var(--accent)", background: "none" }}>
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate("/")}
          style={{ background: "none", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}
        >
          <ArrowLeft size={14} /> 首页
        </button>
        <span style={{ color: "var(--border)" }}>|</span>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{workspace.name}</span>
        {config?.description && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{config.description}</span>
        )}
      </div>

      {/* Three panel layout */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <ThreePanelLayout
          left={
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <AgentPanel workspaceId={workspace.id} />
            </div>
          }
          center={<EditorCenter />}
          right={<AssetTree workspaceId={workspace.id} ruleSetId={ruleSet?.id} />}
        />
      </div>
    </div>
  );
}
