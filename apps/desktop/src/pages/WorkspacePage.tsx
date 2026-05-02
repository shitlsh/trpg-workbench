import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Workspace, RuleSet, WorkspaceConfigResponse } from "@trpg-workbench/shared-schema";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useEditorStore } from "@/stores/editorStore";
import { ThreePanelLayout } from "@/components/editor/ThreePanelLayout";
import { AssetTree } from "@/components/editor/AssetTree";
import { EditorCenter } from "@/components/editor/EditorCenter";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { ExportDialog } from "@/components/ExportDialog";
import { ArrowLeft, Settings, AlertTriangle, PanelRight, BookDown } from "lucide-react";
import { apiFetch } from "@/lib/api";

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setActiveWorkspace } = useWorkspaceStore();
  const { leftCollapsed, rightCollapsed, setLeftCollapsed, setRightCollapsed } = useEditorStore();
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    setActiveWorkspace(id ?? null);
    return () => setActiveWorkspace(null);
  }, [id, setActiveWorkspace]);

  // Zen Mode: Cmd+Shift+\ toggles both panels
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "\\") {
        e.preventDefault();
        const zen = !leftCollapsed || !rightCollapsed;
        setLeftCollapsed(zen);
        setRightCollapsed(zen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [leftCollapsed, rightCollapsed, setLeftCollapsed, setRightCollapsed]);

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

  const configWarnings: string[] = [];
  if (config) {
    if (!config.rule_set) configWarnings.push("未绑定规则集");
    if (!config.models?.default_llm) configWarnings.push("未配置 LLM 模型");
  }

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
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setRightCollapsed(!rightCollapsed)}
          style={{
            background: rightCollapsed ? "none" : "color-mix(in srgb, var(--accent) 12%, transparent)",
            color: rightCollapsed ? "var(--text-muted)" : "var(--accent)",
            display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer",
            border: "none", borderRadius: 4, padding: "2px 6px",
          }}
          title={rightCollapsed ? "展开资产面板" : "折叠资产面板"}
        >
          <PanelRight size={15} />
        </button>
        <button
          onClick={() => setShowExport(true)}
          style={{ background: "none", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}
          title="导出模组手册 PDF"
        >
          <BookDown size={15} />
        </button>
        <button
          onClick={() => navigate(`/workspace/${id}/settings`)}
          style={{ background: "none", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}
          title="工作空间设置"
        >
          <Settings size={15} />
        </button>
      </div>

      {/* Config warning banner */}
      {configWarnings.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 16px",
          background: "rgba(232,168,56,0.1)",
          borderBottom: "1px solid rgba(232,168,56,0.25)",
          fontSize: 13, color: "var(--warning, #e8a838)",
          flexShrink: 0,
        }}>
          <AlertTriangle size={14} />
          <span>工作空间配置不完整：{configWarnings.join("、")}。</span>
          <button
            onClick={() => navigate(`/workspace/${id}/settings`)}
            style={{ background: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
          >
            前往设置
          </button>
        </div>
      )}

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

      {showExport && id && (
        <ExportDialog workspaceId={id} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}
