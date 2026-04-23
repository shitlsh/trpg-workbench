import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BookOpen, Plus, Trash2, Edit2, Library, MessageSquare, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import type {
  RuleSet,
  CreateRuleSetRequest,
  UpdateRuleSetRequest,
  RuleSetLibraryBinding,
  CreateRuleSetLibraryBindingRequest,
  KnowledgeLibrary,
  PromptProfile,
} from "@trpg-workbench/shared-schema";
import styles from "./RuleSetPage.module.css";
import { HelpButton } from "../components/HelpButton";

const GENRE_OPTIONS = [
  { value: "", label: "通用" },
  { value: "horror", label: "恐怖" },
  { value: "fantasy", label: "奇幻" },
  { value: "sci_fi", label: "科幻" },
  { value: "modern", label: "现代" },
  { value: "historical", label: "历史" },
  { value: "cyberpunk", label: "赛博朋克" },
];

function isBuiltin(id: string) {
  return id.startsWith("builtin-");
}

// ─── Add Library Modal ────────────────────────────────────────────────────────

function AddLibraryModal({
  ruleSetId,
  boundLibraryIds,
  onClose,
}: {
  ruleSetId: string;
  boundLibraryIds: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: libraries = [] } = useQuery({
    queryKey: ["knowledge", "libraries"],
    queryFn: () => apiFetch<KnowledgeLibrary[]>("/knowledge/libraries"),
  });

  const addMutation = useMutation({
    mutationFn: (body: CreateRuleSetLibraryBindingRequest) =>
      apiFetch<RuleSetLibraryBinding>(`/rule-sets/${ruleSetId}/library-bindings`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets", ruleSetId, "library-bindings"] });
      onClose();
    },
  });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>添加知识库</h2>
        <div className={styles.selectList}>
          {libraries.length === 0 && (
            <p className={styles.empty}>没有可用的知识库，请先在「知识库」页面创建</p>
          )}
          {libraries.map((lib) => {
            const already = boundLibraryIds.includes(lib.id);
            return (
              <div
                key={lib.id}
                className={`${styles.selectListItem} ${already ? styles.disabled : ""}`}
                onClick={() => {
                  if (!already) addMutation.mutate({ library_id: lib.id });
                }}
              >
                <Library size={14} />
                <span style={{ flex: 1 }}>{lib.name}</span>
                {already && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>已添加</span>}
              </div>
            );
          })}
        </div>
        {addMutation.isError && (
          <p className={styles.error}>{(addMutation.error as Error).message}</p>
        )}
        <div className={styles.formActions} style={{ marginTop: 16 }}>
          <button className={styles.btnSecondary} onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ─── Set Prompt Modal ─────────────────────────────────────────────────────────

function SetPromptModal({
  ruleSetId,
  currentProfileId,
  onClose,
}: {
  ruleSetId: string;
  currentProfileId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: profiles = [] } = useQuery({
    queryKey: ["prompt-profiles"],
    queryFn: () => apiFetch<PromptProfile[]>("/prompt-profiles"),
  });

  const updateMutation = useMutation({
    mutationFn: (profileId: string) =>
      apiFetch<PromptProfile>(`/prompt-profiles/${profileId}`, {
        method: "PATCH",
        body: JSON.stringify({ rule_set_id: ruleSetId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles"] });
      onClose();
    },
  });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>指定创作风格提示词</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          选择一个 PromptProfile 作为该规则集的创作风格约束。Agent 生成内容时将以此为前置上下文。
        </p>
        <div className={styles.selectList}>
          {profiles.length === 0 && (
            <p className={styles.empty}>没有可用的提示词，请先在「Prompt 配置」页面创建</p>
          )}
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`${styles.selectListItem} ${p.id === currentProfileId ? styles.selected : ""}`}
              onClick={() => updateMutation.mutate(p.id)}
            >
              <MessageSquare size={14} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{p.name}</div>
                {p.style_notes && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {p.style_notes.slice(0, 80)}{p.style_notes.length > 80 ? "..." : ""}
                  </div>
                )}
              </div>
              {p.id === currentProfileId && (
                <span style={{ fontSize: 11, color: "var(--accent)" }}>当前</span>
              )}
            </div>
          ))}
        </div>
        {updateMutation.isError && (
          <p className={styles.error}>{(updateMutation.error as Error).message}</p>
        )}
        <div className={styles.formActions} style={{ marginTop: 16 }}>
          <button className={styles.btnSecondary} onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function RuleSetPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newGenre, setNewGenre] = useState("");

  // Edit modal
  const [editTarget, setEditTarget] = useState<RuleSet | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<RuleSet | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Library/prompt modals
  const [showAddLib, setShowAddLib] = useState(false);
  const [showSetPrompt, setShowSetPrompt] = useState(false);

  const { data: ruleSets = [], isLoading } = useQuery({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  const selectedRuleSet = ruleSets.find((r) => r.id === selectedId) ?? null;

  const { data: bindings = [] } = useQuery({
    queryKey: ["rule-sets", selectedId, "library-bindings"],
    queryFn: () => apiFetch<RuleSetLibraryBinding[]>(`/rule-sets/${selectedId}/library-bindings`),
    enabled: !!selectedId,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ["prompt-profiles"],
    queryFn: () => apiFetch<PromptProfile[]>("/prompt-profiles"),
    enabled: !!selectedId,
  });

  const currentPrompt = selectedId
    ? allProfiles.find((p) => p.rule_set_id === selectedId) ?? null
    : null;

  const createMutation = useMutation({
    mutationFn: (body: CreateRuleSetRequest) =>
      apiFetch<RuleSet>("/rule-sets", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (rs) => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      setShowCreate(false);
      setNewName(""); setNewDesc(""); setNewGenre("");
      setSelectedId(rs.id);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRuleSetRequest }) =>
      apiFetch<RuleSet>(`/rule-sets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      setEditTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/rule-sets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      setDeleteTarget(null);
      setDeleteError(null);
      setSelectedId(null);
    },
    onError: async (err: unknown) => {
      // Try to parse 409 detail
      const msg = (err as Error).message ?? "";
      setDeleteError(msg);
    },
  });

  const removeBindingMutation = useMutation({
    mutationFn: ({ bindingId }: { bindingId: string }) =>
      apiFetch(`/rule-sets/${selectedId}/library-bindings/${bindingId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets", selectedId, "library-bindings"] });
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const slug = newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 60) + "-" + Date.now();
    createMutation.mutate({ name: newName.trim(), slug, description: newDesc.trim() || undefined, genre: newGenre || undefined });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget || !editName.trim()) return;
    updateMutation.mutate({ id: editTarget.id, body: { name: editName.trim(), description: editDesc.trim() || undefined } });
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/")}>← 返回</button>
        <h1 className={styles.title}>
          <BookOpen size={16} />
          规则集管理
        </h1>
        <HelpButton doc="rule-set-management" />
        <button className={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          <Plus size={14} /> 新建规则集
        </button>
      </header>

      <div className={styles.layout}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <p className={styles.sidebarTitle}>规则集列表</p>
          {isLoading && <p className={styles.empty} style={{ padding: "0 16px" }}>加载中...</p>}
          {ruleSets.map((rs) => (
            <button
              key={rs.id}
              className={`${styles.rsItem} ${rs.id === selectedId ? styles.rsItemActive : ""}`}
              onClick={() => setSelectedId(rs.id)}
            >
              <span className={styles.rsName}>{rs.name}</span>
              {isBuiltin(rs.id) && <span className={styles.builtinBadge}>内置</span>}
              {rs.genre && <span className={styles.rsGenre}>{GENRE_OPTIONS.find(g => g.value === rs.genre)?.label ?? rs.genre}</span>}
            </button>
          ))}
        </aside>

        {/* Detail */}
        <main className={styles.detail}>
          {!selectedRuleSet ? (
            <div className={styles.placeholder}>
              <BookOpen size={40} color="var(--border)" />
              <p>选择左侧规则集查看详情</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className={styles.detailHeader}>
                <div>
                  <div className={styles.detailName}>
                    {selectedRuleSet.name}
                    {isBuiltin(selectedRuleSet.id) && (
                      <span className={styles.builtinBadge}>内置</span>
                    )}
                    {selectedRuleSet.genre && (
                      <span className={styles.badge}>
                        {GENRE_OPTIONS.find(g => g.value === selectedRuleSet.genre)?.label ?? selectedRuleSet.genre}
                      </span>
                    )}
                  </div>
                  {selectedRuleSet.description && (
                    <p className={styles.detailDesc}>{selectedRuleSet.description}</p>
                  )}
                </div>
                <div className={styles.detailActions}>
                  {!isBuiltin(selectedRuleSet.id) && (
                    <>
                      <button
                        className={styles.btnSecondary}
                        onClick={() => {
                          setEditTarget(selectedRuleSet);
                          setEditName(selectedRuleSet.name);
                          setEditDesc(selectedRuleSet.description ?? "");
                        }}
                      >
                        <Edit2 size={13} /> 编辑
                      </button>
                      <button
                        className={styles.btnDanger}
                        onClick={() => { setDeleteTarget(selectedRuleSet); setDeleteError(null); }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Prompt section */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionLabel}>
                    <MessageSquare size={12} /> 创作风格提示词
                  </span>
                  <button className={styles.btnSecondary} style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setShowSetPrompt(true)}>
                    {currentPrompt ? "更换" : "指定提示词"}
                  </button>
                </div>
                {currentPrompt ? (
                  <div className={styles.promptCard}>
                    <div className={styles.promptName}>{currentPrompt.name}</div>
                    {currentPrompt.style_notes && (
                      <div className={styles.promptNotes}>{currentPrompt.style_notes.slice(0, 200)}{currentPrompt.style_notes.length > 200 ? "..." : ""}</div>
                    )}
                    <div className={styles.promptActions}>
                      <button
                        className={styles.btnGhost}
                        onClick={() => navigate("/settings/prompts")}
                      >
                        查看/编辑 →
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={styles.empty}>暂未指定提示词——Agent 将使用默认创作风格</p>
                )}
              </div>

              {/* Library bindings section */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionLabel}>
                    <Library size={12} /> 关联知识库
                  </span>
                  <button
                    className={styles.btnSecondary}
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => setShowAddLib(true)}
                  >
                    <Plus size={12} /> 添加
                  </button>
                </div>
                {bindings.length === 0 ? (
                  <p className={styles.empty}>暂无关联知识库——知识检索时将无规则集来源</p>
                ) : (
                  bindings.map((b) => (
                    <div key={b.id} className={styles.bindingItem}>
                      <Library size={14} color="var(--text-muted)" />
                      <span className={styles.bindingName}>
                        {b.library?.name ?? b.library_id}
                      </span>
                      {b.library?.type && (
                        <span className={styles.bindingType}>{b.library.type}</span>
                      )}
                      <button
                        className={styles.btnGhost}
                        onClick={() => removeBindingMutation.mutate({ bindingId: b.id })}
                        title="移除"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className={styles.overlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>新建规则集</h2>
            <form onSubmit={handleCreate} className={styles.form}>
              <label className={styles.label}>
                名称 *
                <input className={styles.input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例：我的奇幻世界" autoFocus />
              </label>
              <label className={styles.label}>
                描述
                <textarea className={styles.textarea} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} placeholder="可选" />
              </label>
              <label className={styles.label}>
                风格类型
                <select className={styles.select} value={newGenre} onChange={(e) => setNewGenre(e.target.value)}>
                  {GENRE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowCreate(false)}>取消</button>
                <button type="submit" className={styles.btnPrimary} disabled={!newName.trim() || createMutation.isPending}>
                  {createMutation.isPending ? "创建中..." : "创建"}
                </button>
              </div>
              {createMutation.isError && <p className={styles.error}>{(createMutation.error as Error).message}</p>}
            </form>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div className={styles.overlay} onClick={() => setEditTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>编辑规则集</h2>
            <form onSubmit={handleEdit} className={styles.form}>
              <label className={styles.label}>
                名称 *
                <input className={styles.input} value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
              </label>
              <label className={styles.label}>
                描述
                <textarea className={styles.textarea} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setEditTarget(null)}>取消</button>
                <button type="submit" className={styles.btnPrimary} disabled={!editName.trim() || updateMutation.isPending}>
                  {updateMutation.isPending ? "保存中..." : "保存"}
                </button>
              </div>
              {updateMutation.isError && <p className={styles.error}>{(updateMutation.error as Error).message}</p>}
            </form>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <div className={styles.overlay} onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>确认删除</h2>
            <p className={styles.confirmText}>
              确定要删除规则集「<strong>{deleteTarget.name}</strong>」吗？其下的所有知识库绑定也将一并删除。
            </p>
            {deleteError && (
              <p className={styles.error} style={{ marginBottom: 12 }}>
                {deleteError.includes("workspaces") ? "无法删除：仍有工作空间正在使用该规则集" : deleteError}
              </p>
            )}
            <div className={styles.formActions}>
              <button className={styles.btnSecondary} onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>取消</button>
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

      {/* Add Library modal */}
      {showAddLib && selectedId && (
        <AddLibraryModal
          ruleSetId={selectedId}
          boundLibraryIds={bindings.map((b) => b.library_id)}
          onClose={() => setShowAddLib(false)}
        />
      )}

      {/* Set Prompt modal */}
      {showSetPrompt && selectedId && (
        <SetPromptModal
          ruleSetId={selectedId}
          currentProfileId={currentPrompt?.id ?? null}
          onClose={() => setShowSetPrompt(false)}
        />
      )}
    </div>
  );
}
