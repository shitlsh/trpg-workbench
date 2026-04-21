import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Workspace } from "@trpg-workbench/shared-schema";
import { ThreePanelLayout } from "@/components/editor/ThreePanelLayout";
import { AssetTree } from "@/components/editor/AssetTree";
import { EditorCenter } from "@/components/editor/EditorCenter";
import { AssetMetaPanel } from "@/components/editor/AssetMetaPanel";
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
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{workspace.description}</span>
      </div>

      {/* Three panel layout */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <ThreePanelLayout
          left={<AssetTree workspaceId={workspace.id} />}
          center={<EditorCenter />}
          right={
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13, borderBottom: "1px solid var(--border)" }}>
                资产信息
              </div>
              <AssetMetaPanel />
            </div>
          }
        />
      </div>
    </div>
  );
}
