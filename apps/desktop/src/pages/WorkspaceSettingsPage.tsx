import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Zap, ChevronDown, ChevronRight, Trash2, FolderOpen } from "lucide-react";
import { apiFetch } from "../lib/api";
import type {
  Workspace, RuleSet, LLMProfile, EmbeddingProfile, ModelCatalogEntry,
  EmbeddingCatalogEntry, RerankProfile,
  WorkspaceConfigResponse,
  WorkspaceSkillMeta, WorkspaceSkill,
  CreateWorkspaceSkillRequest, UpdateWorkspaceSkillRequest,
} from "@trpg-workbench/shared-schema";
import styles from "./WorkspaceSettingsPage.module.css";
import { HelpButton } from "../components/HelpButton";

// ─── Skills Section ────────────────────────────────────────────────────────────

const AGENT_TYPE_OPTIONS = [
  { value: "npc", label: "NPC" },
  { value: "monster", label: "怪物/实体" },
  { value: "plot", label: "剧情大纲" },
  { value: "lore", label: "世界观/地点" },
  { value: "rules", label: "规则" },
];

function SkillForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: WorkspaceSkill;
  onSave: (data: CreateWorkspaceSkillRequest) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [agentTypes, setAgentTypes] = useState<string[]>(initial?.agent_types ?? []);
  const [body, setBody] = useState(initial?.body ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  function toggleType(v: string) {
    setAgentTypes((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        名称 *
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={styles.input}
          placeholder="CoC NPC 框架"
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        描述
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={styles.input}
          placeholder="一句话说明这个 Skill 的作用"
        />
      </label>
      <div style={{ fontSize: 13 }}>
        适用 Agent 类型（留空 = 所有创作型 Agent）
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
          {AGENT_TYPE_OPTIONS.map(({ value, label }) => (
            <label key={value} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={agentTypes.includes(value)}
                onChange={() => toggleType(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Skill 内容（Markdown）
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={styles.textarea}
          rows={8}
          style={{ fontFamily: "monospace", fontSize: 12 }}
          placeholder={"在创作 NPC 时，必须包含以下维度：\n- 职业（1920s 社会角色）\n- 神话接触程度：无 / 轻微 / 深度"}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        启用此 Skill
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className={styles.btnPrimary}
          disabled={!name.trim() || saving}
          onClick={() => onSave({ name: name.trim(), description, agent_types: agentTypes, body, enabled })}
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          onClick={onCancel}
          style={{ fontSize: 13, padding: "6px 14px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", color: "var(--text)" }}
        >
          取消
        </button>
      </div>
    </div>
  );
}

function SkillsSection({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const qKey = ["workspace", workspaceId, "skills"];

  const { data: skills = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => apiFetch<WorkspaceSkillMeta[]>(`/workspaces/${workspaceId}/skills`),
  });

  const { data: skillDetail } = useQuery({
    queryKey: [...qKey, editingSlug],
    queryFn: () => apiFetch<WorkspaceSkill>(`/workspaces/${workspaceId}/skills/${editingSlug}`),
    enabled: !!editingSlug,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateWorkspaceSkillRequest) =>
      apiFetch<WorkspaceSkill>(`/workspaces/${workspaceId}/skills`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setShowNew(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ slug, data }: { slug: string; data: UpdateWorkspaceSkillRequest }) =>
      apiFetch<WorkspaceSkill>(`/workspaces/${workspaceId}/skills/${slug}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setEditingSlug(null); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ slug, enabled }: { slug: string; enabled: boolean }) =>
      apiFetch<WorkspaceSkill>(`/workspaces/${workspaceId}/skills/${slug}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) =>
      apiFetch(`/workspaces/${workspaceId}/skills/${slug}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setConfirmDelete(null); },
  });

  return (
    <div style={{ marginTop: 32, padding: 20, border: "1px solid var(--border)", borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
        <Zap size={15} /> Skill
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, marginTop: 2 }}>
        Skill 为 Agent 提供持久化的创作框架指令，在 Workflow 执行时自动注入。
      </p>

      {isLoading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>加载中...</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {skills.map((s) => (
          <div key={s.slug} style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--bg)", cursor: "pointer" }}
              onClick={() => setExpandedSlug(expandedSlug === s.slug ? null : s.slug)}
            >
              {expandedSlug === s.slug ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s.name}</span>
              {s.agent_types.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.agent_types.join(", ")}</span>
              )}
              <input
                type="checkbox"
                checked={s.enabled}
                title={s.enabled ? "点击禁用" : "点击启用"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => toggleMutation.mutate({ slug: s.slug, enabled: e.target.checked })}
              />
            </div>
            {expandedSlug === s.slug && (
              <div style={{ padding: "10px 12px", background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
                {s.description && <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{s.description}</p>}
                {editingSlug === s.slug ? (
                  skillDetail ? (
                    <SkillForm
                      initial={skillDetail}
                      onSave={(data) => updateMutation.mutate({ slug: s.slug, data })}
                      onCancel={() => setEditingSlug(null)}
                      saving={updateMutation.isPending}
                    />
                  ) : <p style={{ fontSize: 12 }}>加载中...</p>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setEditingSlug(s.slug)}
                      style={{ fontSize: 12, padding: "4px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer", color: "var(--text)" }}
                    >
                      编辑
                    </button>
                    {confirmDelete === s.slug ? (
                      <>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>确认删除？</span>
                        <button
                          onClick={() => deleteMutation.mutate(s.slug)}
                          style={{ fontSize: 12, padding: "4px 10px", background: "var(--danger, #e53e3e)", border: "none", borderRadius: 5, cursor: "pointer", color: "#fff" }}
                        >删除</button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          style={{ fontSize: 12, padding: "4px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer", color: "var(--text)" }}
                        >取消</button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(s.slug)}
                        style={{ fontSize: 12, padding: "4px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <Trash2 size={11} /> 删除
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {skills.length === 0 && !isLoading && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>暂无 Skill。点击下方按钮添加第一个 Skill。</p>
        )}
      </div>

      {showNew ? (
        <SkillForm
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => setShowNew(false)}
          saving={createMutation.isPending}
        />
      ) : (
        <button
          onClick={() => setShowNew(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 12px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", color: "var(--text)" }}
        >
          <Plus size={13} /> 添加 Skill
        </button>
      )}
    </div>
  );
}

function CatalogHint({ profile, catalog }: { profile: LLMProfile | EmbeddingProfile | undefined; catalog: (ModelCatalogEntry | EmbeddingCatalogEntry)[] }) {
  if (!profile) return null;
  const entry = catalog.find((e) => e.model_name === profile.model_name);
  if (!entry) return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>（无 catalog 数据）</span>;
  const parts: string[] = [];
  if ("context_window" in entry && entry.context_window) {
    parts.push(`${(entry.context_window / 1000).toFixed(0)}K context`);
  }
  if ("dimensions" in entry && entry.dimensions) {
    parts.push(`${entry.dimensions}d`);
  }
  if (entry.input_price_per_1m != null) {
    parts.push(`~$${entry.input_price_per_1m}/M in`);
    if ("output_price_per_1m" in entry && entry.output_price_per_1m != null) {
      parts.push(`~$${entry.output_price_per_1m}/M out`);
    }
  }
  if (!parts.length) return null;
  return <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>· {parts.join(" · ")}</span>;
}

export default function WorkspaceSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Workspace registry (id, name, path)
  const { data: workspace } = useQuery({
    queryKey: ["workspace", id],
    queryFn: () => apiFetch<Workspace>(`/workspaces/${id}`),
    enabled: !!id,
  });

  // Workspace config from .trpg/config.yaml
  const { data: configResp } = useQuery({
    queryKey: ["workspace", id, "config"],
    queryFn: () => apiFetch<WorkspaceConfigResponse>(`/workspaces/${id}/config`),
    enabled: !!id,
  });
  const config = configResp?.config;

  const { data: ruleSets = [] } = useQuery({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  const { data: llmProfiles = [] } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
  });

  const { data: embeddingProfiles = [] } = useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: () => apiFetch<EmbeddingProfile[]>("/settings/embedding-profiles"),
  });

  const { data: rerankProfiles = [] } = useQuery({
    queryKey: ["rerank-profiles"],
    queryFn: () => apiFetch<RerankProfile[]>("/settings/rerank-profiles"),
  });

  const { data: llmCatalog = [] } = useQuery({
    queryKey: ["model-catalog"],
    queryFn: () => apiFetch<ModelCatalogEntry[]>("/settings/model-catalog"),
  });

  const { data: embCatalog = [] } = useQuery({
    queryKey: ["embedding-catalog"],
    queryFn: () => apiFetch<EmbeddingCatalogEntry[]>("/settings/model-catalog/embedding"),
  });

  // Form state — populated from config
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ruleSetName, setRuleSetName] = useState("");
  const [defaultLlmName, setDefaultLlmName] = useState("");
  const [rulesLlmName, setRulesLlmName] = useState("");
  const [embeddingName, setEmbeddingName] = useState("");
  const [rerankName, setRerankName] = useState("");
  const [rerankEnabled, setRerankEnabled] = useState(false);
  const [rerankTopN, setRerankTopN] = useState(5);
  const [rerankTopK, setRerankTopK] = useState(20);

  // Populate form from config
  useEffect(() => {
    if (config) {
      setName(config.name ?? "");
      setDescription(config.description ?? "");
      setRuleSetName(config.rule_set ?? "");
      setDefaultLlmName(config.models?.default_llm ?? "");
      setRulesLlmName(config.models?.rules_llm ?? "");
      setEmbeddingName(config.models?.embedding ?? "");
      setRerankName(config.models?.rerank ?? "");
      setRerankEnabled(config.rerank?.enabled ?? false);
      setRerankTopN(config.rerank?.top_n ?? 5);
      setRerankTopK(config.rerank?.top_k ?? 20);
    }
  }, [config?.name, id]); // re-init when workspace changes

  // Save config via PATCH /workspaces/:id/config
  const configMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      apiFetch<WorkspaceConfigResponse>(`/workspaces/${id}/config`, {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", id, "config"] });
    },
  });

  // Also update the registry name if changed
  const nameMutation = useMutation({
    mutationFn: (newName: string) =>
      apiFetch<Workspace>(`/workspaces/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: newName }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", id] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();

    // Update config.yaml
    configMutation.mutate({
      name: trimmedName,
      description: description.trim(),
      rule_set: ruleSetName,
      models: {
        default_llm: defaultLlmName,
        rules_llm: rulesLlmName,
        embedding: embeddingName,
        rerank: rerankName,
      },
      rerank: {
        enabled: rerankEnabled,
        top_n: rerankTopN,
        top_k: rerankTopK,
      },
    });

    // Sync registry name if changed
    if (workspace && trimmedName !== workspace.name) {
      nameMutation.mutate(trimmedName);
    }
  }

  const isSaving = configMutation.isPending || nameMutation.isPending;
  const isSaved = configMutation.isSuccess;
  const saveError = configMutation.error || nameMutation.error;

  if (!workspace || !config) return <div className={styles.loading}>加载中...</div>;

  // Resolve name-based references to profiles for catalog hints
  const selectedDefaultLlm = llmProfiles.find((p) => p.name === defaultLlmName);
  const selectedRulesLlm = llmProfiles.find((p) => p.name === rulesLlmName);
  const selectedEmbedding = embeddingProfiles.find((p) => p.name === embeddingName);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate(`/workspace/${id}`)}>← 返回</button>
        <h1 className={styles.title}>工作空间设置</h1>
        <HelpButton doc="getting-started" />
      </header>
      <main className={styles.main}>
        <form onSubmit={handleSave} className={styles.form}>
          <label className={styles.label}>
            名称 *
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={styles.label}>
            描述
            <textarea className={styles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <label className={styles.label}>
            规则体系
            <select className={styles.select} value={ruleSetName} onChange={(e) => setRuleSetName(e.target.value)}>
              <option value="">未指定</option>
              {ruleSets.map((rs) => <option key={rs.id} value={rs.name}>{rs.name}</option>)}
            </select>
          </label>
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: 14 }}>模型路由</div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4, marginBottom: 8 }}>
            模型引用按名称存储，可跨设备移植。选择下拉中的配置名即可。
          </p>
          <label className={styles.label}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              默认 LLM（用于创建模组、修改资产等所有 AI 任务）
              {!defaultLlmName && (
                <span title="未指定 LLM 时，所有 AI 功能将无法运行" style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "rgba(230,160,30,0.15)", color: "#d4a020", border: "1px solid rgba(230,160,30,0.3)", cursor: "default" }}>
                  未指定
                </span>
              )}
              <CatalogHint profile={selectedDefaultLlm} catalog={llmCatalog} />
            </span>
            <select className={styles.select} value={defaultLlmName} onChange={(e) => setDefaultLlmName(e.target.value)}>
              <option value="">不指定</option>
              {llmProfiles.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>
          <label className={styles.label}>
            <span>
              规则审查 LLM（留空则使用默认 LLM）
              <CatalogHint profile={selectedRulesLlm} catalog={llmCatalog} />
            </span>
            <select className={styles.select} value={rulesLlmName} onChange={(e) => setRulesLlmName(e.target.value)}>
              <option value="">使用默认 LLM</option>
              {llmProfiles.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>
          <label className={styles.label}>
            <span>
              Embedding 向量化（用于知识库索引和检索）
              <CatalogHint profile={selectedEmbedding} catalog={embCatalog} />
            </span>
            <select className={styles.select} value={embeddingName} onChange={(e) => setEmbeddingName(e.target.value)}>
              <option value="">不指定</option>
              {embeddingProfiles.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>

          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Rerank 重排序（可选）</div>
          <label className={styles.label}>
            Rerank 配置（留空则不使用 Rerank）
            <select className={styles.select} value={rerankName} onChange={(e) => setRerankName(e.target.value)}>
              <option value="">不使用 Rerank</option>
              {rerankProfiles.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.model})</option>)}
            </select>
          </label>
          {rerankName && (
            <>
              <label className={styles.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={rerankEnabled} onChange={(e) => setRerankEnabled(e.target.checked)} />
                启用 Rerank（开启后知识库检索将自动 Rerank）
              </label>
              <div style={{ display: "flex", gap: 16 }}>
                <label className={styles.label} style={{ flex: 1 }}>
                  top_k（初始候选数）
                  <input className={styles.input} type="number" min={1} max={100} value={rerankTopK} onChange={(e) => setRerankTopK(Math.max(1, parseInt(e.target.value) || 20))} />
                </label>
                <label className={styles.label} style={{ flex: 1 }}>
                  top_n（Rerank 后保留数）
                  <input className={styles.input} type="number" min={1} max={50} value={rerankTopN} onChange={(e) => setRerankTopN(Math.max(1, parseInt(e.target.value) || 5))} />
                </label>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8 }}>
                先检索 top_k 个候选，Rerank 后保留 top_n 个。top_n 须小于等于 top_k。
              </p>
            </>
          )}
          <div className={styles.actions}>
            <button type="submit" className={styles.btnPrimary} disabled={!name.trim() || isSaving}>
              {isSaving ? "保存中..." : "保存"}
            </button>
            {isSaved && <span className={styles.saved}>已保存</span>}
            {saveError && <span className={styles.error}>{(saveError as Error).message}</span>}
          </div>
        </form>

        {/* Skills section */}
        <SkillsSection workspaceId={id!} />

        {/* Workspace directory section (replaces export) */}
        <div style={{
          marginTop: 32, padding: 20,
          border: "1px solid var(--border, #333)", borderRadius: 8,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <FolderOpen size={15} /> 工作空间目录
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted, #888)", marginBottom: 12 }}>
            工作空间即文件夹 — 所有资产和配置直接存储在磁盘上，可直接复制、备份或用其他工具编辑。
          </div>
          <div style={{
            padding: "8px 12px", background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 6, fontSize: 12, fontFamily: "monospace", wordBreak: "break-all",
          }}>
            {workspace.workspace_path}
          </div>
        </div>
      </main>
    </div>
  );
}
