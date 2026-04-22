import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Library, Plus, X } from "lucide-react";
import { apiFetch, BACKEND_URL } from "../lib/api";
import type {
  Workspace, RuleSet, LLMProfile, EmbeddingProfile, ModelCatalogEntry,
  EmbeddingCatalogEntry, RerankProfile, WorkspaceLibraryBinding,
  CreateBindingRequest, KnowledgeLibrary, RuleSetLibraryBinding,
} from "@trpg-workbench/shared-schema";
import styles from "./WorkspaceSettingsPage.module.css";

// ─── Extra Libraries Section ───────────────────────────────────────────────────

function ExtraLibrariesSection({ workspaceId, ruleSetId }: { workspaceId: string; ruleSetId: string }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: allLibraries = [] } = useQuery({
    queryKey: ["knowledge", "libraries"],
    queryFn: () => apiFetch<KnowledgeLibrary[]>("/knowledge/libraries"),
  });

  const { data: rsBindings = [] } = useQuery({
    queryKey: ["rule-sets", ruleSetId, "library-bindings"],
    queryFn: () => apiFetch<RuleSetLibraryBinding[]>(`/rule-sets/${ruleSetId}/library-bindings`),
    enabled: !!ruleSetId,
  });

  const { data: wsBindings = [] } = useQuery({
    queryKey: ["workspace", workspaceId, "library-bindings"],
    queryFn: () => apiFetch<WorkspaceLibraryBinding[]>(`/workspaces/${workspaceId}/library-bindings`),
  });

  const addMutation = useMutation({
    mutationFn: (body: CreateBindingRequest) =>
      apiFetch<WorkspaceLibraryBinding>(`/workspaces/${workspaceId}/library-bindings`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId, "library-bindings"] });
      setShowAdd(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (bindingId: string) =>
      apiFetch(`/workspaces/${workspaceId}/library-bindings/${bindingId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId, "library-bindings"] });
    },
  });

  const rsLibIds = rsBindings.map((b) => b.library_id);
  const wsLibIds = wsBindings.map((b) => b.library_id);
  const rsLibs = allLibraries.filter((l) => rsLibIds.includes(l.id));

  return (
    <div style={{ marginTop: 32, padding: 20, border: "1px solid var(--border)", borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <Library size={15} /> 额外知识库（规则集之外的补充）
      </div>

      {ruleSetId && rsLibs.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
            当前规则集已关联 {rsLibs.length} 个知识库（继承，不可在此修改）：
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {rsLibs.map((l) => (
              <span key={l.id} style={{
                padding: "2px 10px", background: "rgba(124,106,247,0.12)",
                color: "var(--accent)", borderRadius: 100, fontSize: 12,
              }}>
                {l.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {wsBindings.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>暂无额外绑定的知识库</p>
        )}
        {wsBindings.map((b) => {
          const lib = allLibraries.find((l) => l.id === b.library_id);
          return (
            <div key={b.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13,
            }}>
              <Library size={13} color="var(--text-muted)" />
              <span style={{ flex: 1 }}>{lib?.name ?? b.library_id}</span>
              <button
                onClick={() => removeMutation.mutate(b.id)}
                style={{ background: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                title="移除"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 12px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", color: "var(--text)" }}
        >
          <Plus size={13} /> 添加额外知识库
        </button>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ padding: "6px 8px", background: "var(--bg-surface)", fontSize: 12, color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
            选择要添加的知识库：
          </div>
          {allLibraries.filter((l) => !wsLibIds.includes(l.id)).map((l) => (
            <div
              key={l.id}
              onClick={() => addMutation.mutate({ library_id: l.id })}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", fontSize: 13, cursor: "pointer",
                borderBottom: "1px solid var(--border)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            >
              <Library size={13} color="var(--text-muted)" />
              <span style={{ flex: 1 }}>{l.name}</span>
              {rsLibIds.includes(l.id) && (
                <span style={{ fontSize: 11, color: "var(--accent)" }}>规则集已含</span>
              )}
            </div>
          ))}
          {allLibraries.filter((l) => !wsLibIds.includes(l.id)).length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "10px 12px" }}>所有知识库已添加</p>
          )}
          <div style={{ padding: "8px 12px" }}>
            <button onClick={() => setShowAdd(false)} style={{ fontSize: 12, color: "var(--text-muted)", background: "none", cursor: "pointer" }}>关闭</button>
          </div>
        </div>
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
  const [exporting, setExporting] = useState(false);
  const [includeReview, setIncludeReview] = useState(false);

  const { data: workspace } = useQuery({
    queryKey: ["workspace", id],
    queryFn: () => apiFetch<Workspace>(`/workspaces/${id}`),
    enabled: !!id,
  });

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

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ruleSetId, setRuleSetId] = useState("");
  const [defaultLlmId, setDefaultLlmId] = useState("");
  const [rulesLlmId, setRulesLlmId] = useState("");
  const [embeddingId, setEmbeddingId] = useState("");
  const [rerankProfileId, setRerankProfileId] = useState<string>("");
  const [rerankEnabled, setRerankEnabled] = useState(false);
  const [rerankTopN, setRerankTopN] = useState(5);
  const [rerankTopK, setRerankTopK] = useState(20);
  const [rerankTaskTypes, setRerankTaskTypes] = useState<string[]>(["rules_review"]);

  // Populate form fields once workspace data is available
  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setDescription(workspace.description ?? "");
      setRuleSetId(workspace.rule_set_id);
      setDefaultLlmId(workspace.default_llm_profile_id ?? "");
      setRulesLlmId(workspace.rules_llm_profile_id ?? "");
      setEmbeddingId(workspace.embedding_profile_id ?? "");
      setRerankProfileId(workspace.rerank_profile_id ?? "");
      setRerankEnabled(workspace.rerank_enabled ?? false);
      setRerankTopN(workspace.rerank_top_n ?? 5);
      setRerankTopK(workspace.rerank_top_k ?? 20);
      setRerankTaskTypes(() => {
        try {
          const raw = workspace.rerank_apply_to_task_types;
          if (!raw) return ["rules_review"];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : ["rules_review"];
        } catch { return ["rules_review"]; }
      });
    }
  }, [workspace?.id]); // only re-init when workspace ID changes, not on every field update

  const updateMutation = useMutation({
    mutationFn: (body: Partial<Workspace>) =>
      apiFetch<Workspace>(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", id] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      rule_set_id: ruleSetId,
      default_llm_profile_id: defaultLlmId || null,
      rules_llm_profile_id: rulesLlmId || null,
      embedding_profile_id: embeddingId || null,
      rerank_profile_id: rerankProfileId || null,
      rerank_enabled: rerankEnabled,
      rerank_top_n: rerankTopN,
      rerank_top_k: rerankTopK,
      rerank_apply_to_task_types: JSON.stringify(rerankTaskTypes),
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const url = `${BACKEND_URL}/workspaces/${id}/export?include_review=${includeReview}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workspace?.name ?? "workspace"}_export.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setExporting(false);
    }
  }

  if (!workspace) return <div className={styles.loading}>加载中...</div>;

  const selectedDefaultLlm = llmProfiles.find((p) => p.id === defaultLlmId);
  const selectedRulesLlm = llmProfiles.find((p) => p.id === rulesLlmId);
  const selectedEmbedding = embeddingProfiles.find((p) => p.id === embeddingId);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/")}>← 返回</button>
        <h1 className={styles.title}>工作空间设置</h1>
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
            规则体系 *
            <select className={styles.select} value={ruleSetId} onChange={(e) => setRuleSetId(e.target.value)}>
              {ruleSets.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
            </select>
          </label>
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: 14 }}>模型路由</div>
          <label className={styles.label}>
            <span>
              默认 LLM（用于创建模组、修改资产等所有 AI 任务）
              <CatalogHint profile={selectedDefaultLlm} catalog={llmCatalog} />
            </span>
            <select className={styles.select} value={defaultLlmId} onChange={(e) => setDefaultLlmId(e.target.value)}>
              <option value="">不指定</option>
              {llmProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>
          <label className={styles.label}>
            <span>
              规则审查 LLM（留空则使用默认 LLM）
              <CatalogHint profile={selectedRulesLlm} catalog={llmCatalog} />
            </span>
            <select className={styles.select} value={rulesLlmId} onChange={(e) => setRulesLlmId(e.target.value)}>
              <option value="">使用默认 LLM</option>
              {llmProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>
          <label className={styles.label}>
            <span>
              Embedding 向量化（用于知识库索引和检索）
              <CatalogHint profile={selectedEmbedding} catalog={embCatalog} />
            </span>
            <select className={styles.select} value={embeddingId} onChange={(e) => setEmbeddingId(e.target.value)}>
              <option value="">不指定</option>
              {embeddingProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>

          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Rerank 重排序（可选）</div>
          <label className={styles.label}>
            Rerank 配置（留空则不使用 Rerank）
            <select className={styles.select} value={rerankProfileId} onChange={(e) => setRerankProfileId(e.target.value)}>
              <option value="">不使用 Rerank</option>
              {rerankProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model})</option>)}
            </select>
          </label>
          {rerankProfileId && (
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
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>应用任务类型：</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {(["rules_review", "plot_creation", "npc_creation", "monster_creation", "lore_creation", "consistency_check"] as const).map((t) => (
                    <label key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={rerankTaskTypes.includes(t)}
                        onChange={(e) => {
                          if (e.target.checked) setRerankTaskTypes((prev) => [...prev, t]);
                          else setRerankTaskTypes((prev) => prev.filter((x) => x !== t));
                        }}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className={styles.actions}>
            <button type="submit" className={styles.btnPrimary} disabled={!name.trim() || !ruleSetId || updateMutation.isPending}>
              {updateMutation.isPending ? "保存中..." : "保存"}
            </button>
            {updateMutation.isSuccess && <span className={styles.saved}>已保存</span>}
            {updateMutation.isError && <span className={styles.error}>{(updateMutation.error as Error).message}</span>}
          </div>
        </form>

        {/* Extra Knowledge Libraries section */}
        <ExtraLibrariesSection workspaceId={id!} ruleSetId={ruleSetId} />

        {/* Export section */}
        <div style={{
          marginTop: 32, padding: 20,
          border: "1px solid var(--border, #333)", borderRadius: 8,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>导出文档包</div>
          <div style={{ fontSize: 13, color: "var(--text-muted, #888)", marginBottom: 12 }}>
            将所有"定稿"状态的资产导出为 Markdown 文件 zip 包。
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={includeReview} onChange={(e) => setIncludeReview(e.target.checked)} />
            同时包含"审查中"状态的资产
          </label>
          <button
            onClick={handleExport}
            disabled={exporting}
            className={styles.btnPrimary}
          >
            {exporting ? "准备导出..." : "导出 ZIP"}
          </button>
        </div>
      </main>
    </div>
  );
}
