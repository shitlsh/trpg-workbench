import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BookMarked, Library, Cpu, BarChart2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import type {
  Workspace, RuleSet, CreateWorkspaceRequest,
  RuleSetLibraryBinding, PromptProfile,
} from "@trpg-workbench/shared-schema";
import { ThemeToggle } from "../components/ThemeToggle";
import { HelpButton } from "../components/HelpButton";
import styles from "./HomePage.module.css";

export default function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newRuleSetId, setNewRuleSetId] = useState("");

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Workspace[]>("/workspaces"),
  });

  const { data: ruleSets = [] } = useQuery({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  // For the new-workspace modal: preview selected rule set's metadata
  const { data: selectedRsBindings = [] } = useQuery({
    queryKey: ["rule-sets", newRuleSetId, "library-bindings"],
    queryFn: () => apiFetch<RuleSetLibraryBinding[]>(`/rule-sets/${newRuleSetId}/library-bindings`),
    enabled: !!newRuleSetId,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ["prompt-profiles"],
    queryFn: () => apiFetch<PromptProfile[]>("/prompt-profiles"),
    enabled: !!newRuleSetId,
  });

  const selectedRsPrompt = newRuleSetId
    ? allProfiles.find((p) => p.rule_set_id === newRuleSetId) ?? null
    : null;

  const createMutation = useMutation({
    mutationFn: (body: CreateWorkspaceRequest) =>
      apiFetch<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setShowNewForm(false);
      setNewName("");
      setNewDesc("");
      setNewRuleSetId("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/workspaces/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setDeleteTarget(null);
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newRuleSetId) return;
    createMutation.mutate({ name: newName.trim(), description: newDesc.trim(), rule_set_id: newRuleSetId });
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.logo}>TRPG Workbench</h1>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => navigate("/settings/rule-sets")}>
            <BookMarked size={14} style={{ flexShrink: 0 }} />
            规则集
          </button>
          <button className={styles.btnSecondary} onClick={() => navigate("/knowledge")}>
            <Library size={14} style={{ flexShrink: 0 }} />
            知识库
          </button>
          <button className={styles.btnSecondary} onClick={() => navigate("/settings/models")}>
            <Cpu size={14} style={{ flexShrink: 0 }} />
            模型配置
          </button>
          <button className={styles.btnSecondary} onClick={() => navigate("/usage")}>
            <BarChart2 size={14} style={{ flexShrink: 0 }} />
            用量观测
          </button>
          <button className={styles.btnPrimary} onClick={() => setShowNewForm(true)}>
            新建工作空间
          </button>
          <ThemeToggle />
          <HelpButton />
        </div>
      </header>

      <main className={styles.main}>
        <h2 className={styles.sectionTitle}>最近工作空间</h2>

        {isLoading && <p className={styles.muted}>加载中...</p>}

        {!isLoading && workspaces.length === 0 && (
          <div className={styles.empty}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎲</div>
            <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>欢迎使用 TRPG Workbench</p>
            <p style={{ fontSize: 14, color: "var(--text-muted, #888)", marginBottom: 20, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
              创建你的第一个工作空间，开始用 AI 辅助创作 TRPG 剧本。支持导入规则书、生成 NPC、设计场景和一致性检查。
            </p>
            <button className={styles.btnPrimary} onClick={() => setShowNewForm(true)}>
              新建第一个工作空间
            </button>
            <div style={{ display: "flex", gap: 12, marginTop: 16, fontSize: 13, color: "var(--text-muted, #888)" }}>
              <span>💡 建议先在"知识库"中导入规则书 PDF</span>
            </div>
          </div>
        )}

        <div className={styles.grid}>
          {workspaces.map((ws) => {
            const rs = ruleSets.find((r) => r.id === ws.rule_set_id);
            return (
              <div key={ws.id} className={styles.card}>
                <div className={styles.cardBody}>
                  <h3 className={styles.cardTitle}>{ws.name}</h3>
                  {ws.description && <p className={styles.cardDesc}>{ws.description}</p>}
                  <span className={styles.tag}>{rs?.name ?? ws.rule_set_id}</span>
                  <p className={styles.cardDate}>
                    最后修改：{new Date(ws.updated_at).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className={styles.cardActions}>
                  <button
                    className={styles.btnPrimary}
                    onClick={() => navigate(`/workspace/${ws.id}`)}
                  >
                    打开
                  </button>
                  <button
                    className={styles.btnSecondary}
                    onClick={() => navigate(`/workspace/${ws.id}/settings`)}
                  >
                    设置
                  </button>
                  <button
                    className={styles.btnDanger}
                    onClick={() => setDeleteTarget(ws)}
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* New Workspace Modal */}
      {showNewForm && (
        <div className={styles.overlay} onClick={() => setShowNewForm(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>新建工作空间</h2>
            <form onSubmit={handleCreate} className={styles.form}>
              <label className={styles.label}>
                名称 *
                <input
                  className={styles.input}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例：午夜图书馆"
                  autoFocus
                />
              </label>
              <label className={styles.label}>
                描述
                <textarea
                  className={styles.textarea}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="可选"
                  rows={2}
                />
              </label>
              <label className={styles.label}>
                规则体系 *
                <select
                  className={styles.select}
                  value={newRuleSetId}
                  onChange={(e) => setNewRuleSetId(e.target.value)}
                >
                  <option value="">请选择...</option>
                  {ruleSets.map((rs) => (
                    <option key={rs.id} value={rs.id}>{rs.name}</option>
                  ))}
                </select>
              </label>
              {/* A1.5: Rule set preview */}
              {newRuleSetId && (
                <div style={{
                  padding: "10px 12px",
                  background: "rgba(124,106,247,0.06)",
                  border: "1px solid rgba(124,106,247,0.2)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--text-muted)",
                  display: "flex",
                  gap: 16,
                }}>
                  <span>
                    📚 知识库：<strong style={{ color: "var(--text)" }}>{selectedRsBindings.length} 个</strong>
                  </span>
                  <span>
                    ✍️ 提示词：<strong style={{ color: "var(--text)" }}>
                      {selectedRsPrompt ? selectedRsPrompt.name : "未指定"}
                    </strong>
                  </span>
                </div>
              )}
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowNewForm(false)}>
                  取消
                </button>
                <button
                  type="submit"
                  className={styles.btnPrimary}
                  disabled={!newName.trim() || !newRuleSetId || createMutation.isPending}
                >
                  {createMutation.isPending ? "创建中..." : "创建"}
                </button>
              </div>
              {createMutation.isError && (
                <p className={styles.error}>{(createMutation.error as Error).message}</p>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className={styles.overlay} onClick={() => setDeleteTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>确认删除</h2>
            <p className={styles.confirmText}>
              确定要删除工作空间「<strong>{deleteTarget.name}</strong>」吗？此操作不可撤销。
            </p>
            <div className={styles.formActions}>
              <button className={styles.btnSecondary} onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                className={styles.btnDanger}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
