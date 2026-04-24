import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BookMarked, Cpu, BarChart2, FolderOpen } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { apiFetch } from "../lib/api";
import type {
  Workspace, RuleSet, CreateWorkspaceRequest,
  KnowledgeLibrary, PromptProfile,
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
  const [newRuleSet, setNewRuleSet] = useState("");
  const [openPathInput, setOpenPathInput] = useState("");
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [newWorkspacePath, setNewWorkspacePath] = useState("");

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Workspace[]>("/workspaces"),
  });

  const { data: ruleSets = [] } = useQuery({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  // For the new-workspace modal: preview selected rule set's metadata
  const selectedRs = ruleSets.find((rs) => rs.name === newRuleSet);
  const selectedRsId = selectedRs?.id ?? "";

  const { data: selectedRsLibraries = [] } = useQuery({
    queryKey: ["knowledge", "libraries", { rule_set_id: selectedRsId }],
    queryFn: () => apiFetch<KnowledgeLibrary[]>(`/knowledge/libraries?rule_set_id=${selectedRsId}`),
    enabled: !!selectedRsId,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ["prompt-profiles"],
    queryFn: () => apiFetch<PromptProfile[]>("/prompt-profiles"),
    enabled: !!selectedRsId,
  });

  const selectedRsPrompt = selectedRsId
    ? allProfiles.find((p) => p.rule_set_id === selectedRsId) ?? null
    : null;

  const createMutation = useMutation({
    mutationFn: (body: CreateWorkspaceRequest) =>
      apiFetch<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setShowNewForm(false);
      setNewName("");
      setNewDesc("");
      setNewRuleSet("");
      setNewWorkspacePath("");
    },
  });

  const openMutation = useMutation({
    mutationFn: (workspace_path: string) =>
      apiFetch<Workspace>("/workspaces/open", {
        method: "POST",
        body: JSON.stringify({ workspace_path }),
      }),
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setShowOpenForm(false);
      setOpenPathInput("");
      navigate(`/workspace/${ws.id}`);
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
    if (!newName.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      description: newDesc.trim(),
      rule_set: newRuleSet || undefined,
      workspace_path: newWorkspacePath || undefined,
    });
  }

  function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    if (!openPathInput.trim()) return;
    openMutation.mutate(openPathInput.trim());
  }

  async function handleOpenBrowse() {
    const selected = await openDialog({ directory: true, title: "选择工作空间目录" });
    if (selected) {
      openMutation.mutate(selected);
    }
  }

  async function handleBrowseNewPath() {
    const selected = await openDialog({ directory: true, title: "选择工作空间存储位置" });
    if (selected) {
      setNewWorkspacePath(selected);
    }
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
          <button className={styles.btnSecondary} onClick={() => navigate("/settings/models")}>
            <Cpu size={14} style={{ flexShrink: 0 }} />
            模型配置
          </button>
          <button className={styles.btnSecondary} onClick={() => navigate("/usage")}>
            <BarChart2 size={14} style={{ flexShrink: 0 }} />
            用量观测
          </button>
          <button className={styles.btnSecondary} onClick={handleOpenBrowse}>
            <FolderOpen size={14} style={{ flexShrink: 0 }} />
            打开已有
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
              <span>建议先在"规则集"中创建知识库并导入规则书 PDF</span>
            </div>
          </div>
        )}

        <div className={styles.grid}>
          {workspaces.map((ws) => (
            <div key={ws.id} className={styles.card}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>{ws.name}</h3>
                {ws.status === "missing" && (
                  <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "rgba(224,82,82,0.15)", color: "#e05252", border: "1px solid rgba(224,82,82,0.3)" }}>
                    目录不存在
                  </span>
                )}
                <p className={styles.cardDate} style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", wordBreak: "break-all" }}>
                  {ws.workspace_path}
                </p>
                <p className={styles.cardDate}>
                  最后打开：{new Date(ws.last_opened_at).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className={styles.cardActions}>
                <button
                  className={styles.btnPrimary}
                  onClick={() => navigate(`/workspace/${ws.id}`)}
                  disabled={ws.status === "missing"}
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
                  移除
                </button>
              </div>
            </div>
          ))}
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
                规则体系
                <select
                  className={styles.select}
                  value={newRuleSet}
                  onChange={(e) => setNewRuleSet(e.target.value)}
                >
                  <option value="">不指定（稍后可在设置中选择）</option>
                  {ruleSets.map((rs) => (
                    <option key={rs.id} value={rs.name}>{rs.name}</option>
                  ))}
                </select>
              </label>
              {/* A1.5: Rule set preview */}
              {selectedRsId && (
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
                    知识库：<strong style={{ color: "var(--text)" }}>{selectedRsLibraries.length} 个</strong>
                  </span>
                  <span>
                    提示词：<strong style={{ color: "var(--text)" }}>
                      {selectedRsPrompt ? selectedRsPrompt.name : "未指定"}
                    </strong>
                  </span>
                </div>
              )}
              <label className={styles.label}>
                存储位置
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className={styles.input}
                    value={newWorkspacePath}
                    onChange={(e) => setNewWorkspacePath(e.target.value)}
                    placeholder="留空则使用默认位置"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={handleBrowseNewPath}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    浏览…
                  </button>
                </div>
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowNewForm(false)}>
                  取消
                </button>
                <button
                  type="submit"
                  className={styles.btnPrimary}
                  disabled={!newName.trim() || createMutation.isPending}
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

      {/* Open Existing Workspace Modal */}
      {showOpenForm && (
        <div className={styles.overlay} onClick={() => setShowOpenForm(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>打开已有工作空间</h2>
            <form onSubmit={handleOpen} className={styles.form}>
              <label className={styles.label}>
                工作空间目录路径 *
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className={styles.input}
                    value={openPathInput}
                    onChange={(e) => setOpenPathInput(e.target.value)}
                    placeholder="例：/Users/you/my-trpg-module"
                    autoFocus
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={async () => {
                      const selected = await openDialog({ directory: true, title: "选择工作空间目录" });
                      if (selected) setOpenPathInput(selected);
                    }}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    浏览…
                  </button>
                </div>
              </label>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4 }}>
                目录中需包含 .trpg/config.yaml 才能被识别为有效工作空间。
              </p>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowOpenForm(false)}>
                  取消
                </button>
                <button
                  type="submit"
                  className={styles.btnPrimary}
                  disabled={!openPathInput.trim() || openMutation.isPending}
                >
                  {openMutation.isPending ? "打开中..." : "打开"}
                </button>
              </div>
              {openMutation.isError && (
                <p className={styles.error}>{(openMutation.error as Error).message}</p>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className={styles.overlay} onClick={() => setDeleteTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>确认移除</h2>
            <p className={styles.confirmText}>
              确定要从列表中移除工作空间「<strong>{deleteTarget.name}</strong>」吗？
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              磁盘上的文件不会被删除，之后可通过「打开已有」重新添加。
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
                {deleteMutation.isPending ? "移除中..." : "确认移除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
