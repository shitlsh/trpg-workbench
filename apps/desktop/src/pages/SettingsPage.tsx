import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type {
  LLMProfile, CreateLLMProfileRequest, UpdateLLMProfileRequest,
  EmbeddingProfile, CreateEmbeddingProfileRequest, UpdateEmbeddingProfileRequest,
  LLMTestResult, EmbeddingTestResult,
  RerankProfile, CreateRerankProfileRequest, UpdateRerankProfileRequest,
  RerankProviderType, RerankTestResult,
} from "@trpg-workbench/shared-schema";
import styles from "./SettingsPage.module.css";
import { ModelNameInput } from "../components/ModelNameInput";
import { HelpButton } from "../components/HelpButton";
import { useModelList } from "../hooks/useModelList";
import { KNOWN_EMBEDDING_MODELS, KNOWN_RERANK_MODELS } from "../lib/modelCatalog";

// ─── Constants ────────────────────────────────────────────────────────────────

const LLM_PROVIDERS = ["openai", "google", "openrouter", "openai_compatible"] as const;
const EMBEDDING_PROVIDERS = ["openai", "openai_compatible"] as const;

type LLMProviderType = typeof LLM_PROVIDERS[number];
type EmbeddingProviderType = typeof EMBEDDING_PROVIDERS[number];

const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI", google: "Google", anthropic: "Anthropic",
  openrouter: "OpenRouter", openai_compatible: "OpenAI Compatible（含本地）",
  jina: "Jina AI", cohere: "Cohere",
};

const EMPTY_LLM: CreateLLMProfileRequest = {
  name: "", provider_type: "openai", base_url: "", api_key: "", strict_compatible: false,
};
const EMPTY_EMBEDDING: CreateEmbeddingProfileRequest = {
  name: "", provider_type: "openai", model_name: "", base_url: "", api_key: "", dimensions: undefined,
};
const EMPTY_RERANK: CreateRerankProfileRequest = {
  name: "", provider_type: "jina", model_name: "jina-reranker-v3", api_key: "", base_url: "",
};

// ─── Shared UI helpers ────────────────────────────────────────────────────────

/** Small inline hint about model list status below the combobox */
function ModelListHint({ isLoading, count, error }: { isLoading: boolean; count: number; error: string | null }) {
  if (isLoading) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>正在获取模型列表…</span>;
  if (error) return <span style={{ fontSize: 11, color: "var(--danger, #e05252)" }}>✗ {error}</span>;
  if (count > 0) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>✓ 已获取 {count} 个可用模型 · 点击输入框选择</span>;
  return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>可直接输入模型名称</span>;
}

/** Refresh button next to model combobox in edit modals */
function RefreshBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      className={styles.btnSecondary}
      style={{ whiteSpace: "nowrap", fontSize: 11, marginTop: 2 }}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? "获取中…" : "刷新模型列表"}
    </button>
  );
}

// ─── LLM Section ──────────────────────────────────────────────────────────────

function LLMSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<LLMProfile | null>(null);
  const [form, setForm] = useState<CreateLLMProfileRequest>(EMPTY_LLM);
  const [deleteTarget, setDeleteTarget] = useState<LLMProfile | null>(null);
  const [testResult, setTestResult] = useState<LLMTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const apiKeyRequired = !editTarget && form.provider_type !== "openai_compatible";
  const showBaseUrl = form.provider_type === "openrouter" || form.provider_type === "openai_compatible";

  // Models for edit mode — probe via saved profile id
  const { models: profileModels, isLoading: loadingModels, error: modelError } =
    useModelList(editTarget ? { llmProfileId: editTarget.id } : {});

  // Auto-select sole model
  useEffect(() => {
    if (!editTarget || profileModels.length !== 1 || selectedModel) return;
    setSelectedModel(profileModels[0]!);
  }, [editTarget?.id, profileModels, selectedModel]);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateLLMProfileRequest) =>
      apiFetch<LLMProfile>("/settings/llm-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (newProfile) => {
      queryClient.invalidateQueries({ queryKey: ["llm-profiles"] });
      // After creating, immediately open edit so user can pick a model
      openEdit(newProfile);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLLMProfileRequest }) =>
      apiFetch<LLMProfile>(`/settings/llm-profiles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["llm-profiles"] }); closeForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/settings/llm-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["llm-profiles"] }); setDeleteTarget(null); },
  });

  function openNew() {
    setEditTarget(null); setForm(EMPTY_LLM); setSelectedModel(""); setTestResult(null); setFormError(null); setShowForm(true);
  }
  function openEdit(p: LLMProfile) {
    setEditTarget(p);
    setForm({ name: p.name, provider_type: p.provider_type as LLMProviderType, base_url: p.base_url ?? "", api_key: "", strict_compatible: p.strict_compatible ?? false });
    setSelectedModel(""); setTestResult(null); setFormError(null); setShowForm(true);
  }
  function closeForm() {
    setShowForm(false); setEditTarget(null); setForm(EMPTY_LLM); setSelectedModel(""); setTestResult(null); setFormError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (apiKeyRequired && !form.api_key?.trim()) {
      setFormError("请填写 API Key（OpenAI / Google / OpenRouter 必填）");
      return;
    }
    const body = { ...form };
    if (!body.api_key) delete (body as Record<string, unknown>).api_key;
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    if (editTarget) {
      const patch: UpdateLLMProfileRequest = { ...body };
      if (!body.api_key) delete patch.api_key;
      updateMutation.mutate({ id: editTarget.id, body: patch });
    } else {
      createMutation.mutate(body);
    }
  }

  async function handleTest() {
    if (!editTarget || !selectedModel.trim()) {
      setTestResult({ success: false, error: "请先选择或输入模型名称" });
      return;
    }
    setTesting(true); setTestResult(null);
    try {
      const result = await apiFetch<LLMTestResult>(
        `/settings/llm-profiles/${editTarget.id}/test?model_name=${encodeURIComponent(selectedModel.trim())}`,
        { method: "POST" }
      );
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  function refreshModels() {
    if (!editTarget) return;
    queryClient.invalidateQueries({ queryKey: ["model-list", "llm", editTarget.id] });
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const saveDisabled = isPending || !form.name.trim() || (apiKeyRequired && !form.api_key?.trim());

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>配置 LLM 语言模型供应商</span>
        <button className={styles.btnPrimary} onClick={openNew}>新增 LLM 配置</button>
      </div>
      {isLoading && <p className={styles.muted}>加载中...</p>}
      {!isLoading && profiles.length === 0 && (
        <div className={styles.empty}>
          <p>还没有 LLM 配置</p>
          <button className={styles.btnPrimary} onClick={openNew}>新增第一个</button>
        </div>
      )}
      <div className={styles.list}>
        {profiles.map((p) => (
          <div key={p.id} className={styles.item}>
            <div className={styles.itemInfo}>
              <span className={styles.itemName}>{p.name}</span>
              <span className={styles.tag}>{PROVIDER_DISPLAY[p.provider_type] ?? p.provider_type}</span>
              {p.has_api_key && <span style={{ fontSize: 11, color: "#52c97e" }}>● Key 已配置</span>}
            </div>
            <div className={styles.itemActions}>
              <button className={styles.btnSecondary} onClick={() => openEdit(p)}>编辑</button>
              <button className={styles.btnDanger} onClick={() => setDeleteTarget(p)}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className={styles.overlay} onClick={closeForm}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>{editTarget ? "编辑 LLM 配置" : "新增 LLM 配置"}</h2>

            {/* New-profile Gemini hint */}
            {!editTarget && (
              <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐：Google Gemini，长上下文，适合 TRPG 创作</span>
                <button
                  type="button"
                  style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
                  onClick={() => setForm(f => ({ ...f, provider_type: "google", base_url: "", name: f.name || "Gemini 2.5 Flash" }))}
                >
                  一键填入 Gemini
                </button>
              </div>
            )}

            {/* New-profile tip */}
            {!editTarget && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, marginTop: 0 }}>
                保存后将自动获取可用模型列表供选择。
              </p>
            )}

            <form onSubmit={handleSubmit} className={styles.form}>
              {/* 1. Provider */}
              <label className={styles.label}>
                供应商 *
                <select className={styles.select} value={form.provider_type}
                  onChange={(e) => setForm(f => ({ ...f, provider_type: e.target.value as LLMProviderType, strict_compatible: false }))}>
                  {LLM_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_DISPLAY[p] ?? p}</option>)}
                </select>
              </label>

              {/* 2. Base URL (compat/openrouter only) */}
              {showBaseUrl && (
                <label className={styles.label}>
                  Base URL {form.provider_type === "openai_compatible" ? "*" : ""}
                  <input className={styles.input} value={form.base_url ?? ""}
                    onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                    placeholder={form.provider_type === "openai_compatible" ? "http://localhost:1234/v1" : "https://openrouter.ai/api/v1"} />
                </label>
              )}

              {/* 3. strict_compatible (advanced, hidden by default) */}
              {form.provider_type === "openai_compatible" && (
                <details style={{ marginTop: -4 }}>
                  <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
                    高级设置（遇到角色兼容问题时展开）
                  </summary>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 400 }}>
                      <input type="checkbox" checked={!!form.strict_compatible}
                        onChange={(e) => setForm(f => ({ ...f, strict_compatible: e.target.checked }))} />
                      strict_compatible（将 developer / latest_reminder 映射为 system）
                    </label>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      默认关闭。仅当 DeepSeek 等端点报 role 错误时开启。
                    </span>
                  </div>
                </details>
              )}

              {/* 4. API Key */}
              <label className={styles.label}>
                API Key{" "}
                {apiKeyRequired ? <span style={{ color: "var(--error, #e05252)" }}>*</span> : null}
                {editTarget ? `（留空保留，当前：${editTarget.has_api_key ? "已配置" : "未配置"}）` : ""}
                <input className={styles.input} type="password" value={form.api_key ?? ""}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={form.provider_type === "openai_compatible" ? "留空或填 'ollama' / 'lm-studio'" : "sk-..."} />
                {apiKeyRequired && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    OpenAI / Google / OpenRouter 必填；OpenAI 兼容可留空
                  </span>
                )}
              </label>

              {/* 5. Model picker (edit only — probe result from saved profile) */}
              {editTarget && (
                <label className={styles.label}>
                  选择模型（用于测试 / 工作空间默认）
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <ModelNameInput
                        catalog="llm"
                        providerType={form.provider_type}
                        value={selectedModel}
                        onChange={setSelectedModel}
                        catalogEntries={[]}
                        fetchedModels={profileModels}
                        placeholder="例：gemini-2.5-flash / deepseek-v4-flash"
                        className={styles.input}
                      />
                    </div>
                    <RefreshBtn onClick={refreshModels} loading={loadingModels} />
                  </div>
                  <ModelListHint isLoading={loadingModels} count={profileModels.length} error={modelError} />
                </label>
              )}

              {/* 6. Profile name */}
              <label className={styles.label}>
                配置名称 *
                <input className={styles.input} value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例：Gemini 2.5 Flash"
                  autoFocus={!!editTarget} />
              </label>

              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={closeForm}>取消</button>
                {editTarget && (
                  <button type="button" className={styles.btnSecondary} onClick={handleTest} disabled={testing || !selectedModel.trim()}>
                    {testing ? "测试中..." : "测试连接"}
                  </button>
                )}
                <button type="submit" className={styles.btnPrimary} disabled={saveDisabled}>
                  {isPending ? "保存中..." : editTarget ? "保存" : "保存并选择模型 →"}
                </button>
              </div>

              {formError && <p className={styles.error}>{formError}</p>}
              {testResult && (
                <div style={{ fontSize: 12, padding: "8px 10px", borderRadius: 4, background: testResult.success ? "rgba(82,201,126,0.1)" : "rgba(224,82,82,0.1)", color: testResult.success ? "#52c97e" : "#e05252" }}>
                  {testResult.success ? `✓ 连接成功 (${testResult.latency_ms}ms)` : `✗ ${testResult.error}`}
                </div>
              )}
              {(createMutation.isError || updateMutation.isError) && (
                <p className={styles.error}>{((createMutation.error || updateMutation.error) as Error).message}</p>
              )}
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className={styles.overlay} onClick={() => setDeleteTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>确认删除</h2>
            <p className={styles.confirmText}>确定要删除「<strong>{deleteTarget.name}</strong>」？</p>
            <div className={styles.formActions}>
              <button className={styles.btnSecondary} onClick={() => setDeleteTarget(null)}>取消</button>
              <button className={styles.btnDanger} onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "删除中..." : "确认删除"}
              </button>
            </div>
            {deleteMutation.isError && <p className={styles.error}>{(deleteMutation.error as Error).message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Embedding Section ────────────────────────────────────────────────────────

function EmbeddingSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<EmbeddingProfile | null>(null);
  const [form, setForm] = useState<CreateEmbeddingProfileRequest>(EMPTY_EMBEDDING);
  const [deleteTarget, setDeleteTarget] = useState<EmbeddingProfile | null>(null);
  const [testResult, setTestResult] = useState<EmbeddingTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const showBaseUrl = form.provider_type === "openai_compatible";

  // Probe from saved profile (edit mode only)
  const { models: profileModels, isLoading: loadingModels, error: modelError } =
    useModelList(editTarget ? { embeddingProfileId: editTarget.id } : {});

  // Fallback static hints for pre-probe state
  const staticHints = KNOWN_EMBEDDING_MODELS[form.provider_type] ?? [];
  const effectiveModels = profileModels.length > 0 ? profileModels : (editTarget ? [] : staticHints);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: () => apiFetch<EmbeddingProfile[]>("/settings/embedding-profiles"),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateEmbeddingProfileRequest) =>
      apiFetch<EmbeddingProfile>("/settings/embedding-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (newProfile) => {
      queryClient.invalidateQueries({ queryKey: ["embedding-profiles"] });
      openEdit(newProfile);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateEmbeddingProfileRequest }) =>
      apiFetch<EmbeddingProfile>(`/settings/embedding-profiles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["embedding-profiles"] }); closeForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/settings/embedding-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["embedding-profiles"] }); setDeleteTarget(null); },
  });

  function openNew() {
    setEditTarget(null); setForm(EMPTY_EMBEDDING); setTestResult(null); setShowForm(true);
  }
  function openEdit(p: EmbeddingProfile) {
    setEditTarget(p);
    setForm({ name: p.name, provider_type: p.provider_type as EmbeddingProviderType, model_name: p.model_name, base_url: p.base_url ?? "", api_key: "", dimensions: p.dimensions ?? undefined });
    setTestResult(null); setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditTarget(null); setForm(EMPTY_EMBEDDING); setTestResult(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...form };
    if (!body.api_key) delete (body as Record<string, unknown>).api_key;
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    if (editTarget) {
      const patch: UpdateEmbeddingProfileRequest = { ...body };
      if (!body.api_key) delete patch.api_key;
      updateMutation.mutate({ id: editTarget.id, body: patch });
    } else {
      createMutation.mutate(body);
    }
  }

  async function handleTest() {
    if (!editTarget) return;
    setTesting(true); setTestResult(null);
    try {
      const result = await apiFetch<EmbeddingTestResult>(`/settings/embedding-profiles/${editTarget.id}/test`, { method: "POST" });
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  function refreshModels() {
    if (!editTarget) return;
    queryClient.invalidateQueries({ queryKey: ["model-list", "embedding", editTarget.id] });
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>配置文本向量化（Embedding）供应商</span>
        <button className={styles.btnPrimary} onClick={openNew}>新增 Embedding 配置</button>
      </div>
      {isLoading && <p className={styles.muted}>加载中...</p>}
      {!isLoading && profiles.length === 0 && (
        <div className={styles.empty}>
          <p>还没有 Embedding 配置</p>
          <button className={styles.btnPrimary} onClick={openNew}>新增第一个</button>
        </div>
      )}
      <div className={styles.list}>
        {profiles.map((p) => (
          <div key={p.id} className={styles.item}>
            <div className={styles.itemInfo}>
              <span className={styles.itemName}>{p.name}</span>
              <span className={styles.tag}>{PROVIDER_DISPLAY[p.provider_type] ?? p.provider_type}</span>
              <span className={styles.itemModel}>{p.model_name}</span>
              {p.dimensions && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.dimensions}d</span>}
              {p.has_api_key && <span style={{ fontSize: 11, color: "#52c97e" }}>● Key 已配置</span>}
            </div>
            <div className={styles.itemActions}>
              <button className={styles.btnSecondary} onClick={() => openEdit(p)}>编辑</button>
              <button className={styles.btnDanger} onClick={() => setDeleteTarget(p)}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className={styles.overlay} onClick={closeForm}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>{editTarget ? "编辑 Embedding 配置" : "新增 Embedding 配置"}</h2>

            {!editTarget && (
              <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ padding: "8px 12px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐本地：LM Studio + jina-embeddings-v5，数据不离本机</span>
                  <button type="button" style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
                    onClick={() => setForm(f => ({ ...f, provider_type: "openai_compatible", model_name: "jina-embeddings-v5-text-small-retrieval", base_url: "http://localhost:1234/v1", api_key: "lm-studio", name: f.name || "LM Studio Embedding" }))}>
                    LM Studio 本地推荐
                  </button>
                </div>
                <div style={{ padding: "8px 12px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Jina Embeddings v3，适合中文规则书检索</span>
                  <button type="button" style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
                    onClick={() => setForm(f => ({ ...f, provider_type: "openai_compatible", model_name: "jina-embeddings-v3", base_url: "https://api.jina.ai/v1", api_key: "", name: f.name || "Jina Embeddings v3" }))}>
                    一键填入 Jina 推荐值
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  保存后将自动获取可用模型列表。
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className={styles.form}>
              {/* 1. Provider */}
              <label className={styles.label}>
                供应商 *
                <select className={styles.select} value={form.provider_type}
                  onChange={(e) => setForm({ ...form, provider_type: e.target.value as EmbeddingProviderType, model_name: "" })}>
                  {EMBEDDING_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_DISPLAY[p] ?? p}</option>)}
                </select>
              </label>

              {/* 2. Base URL */}
              {showBaseUrl && (
                <label className={styles.label}>
                  Base URL *
                  <input className={styles.input} value={form.base_url ?? ""}
                    onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                    placeholder="http://localhost:1234/v1" />
                </label>
              )}

              {/* 3. API Key */}
              <label className={styles.label}>
                API Key {editTarget ? `（留空保留，当前：${editTarget.has_api_key ? "已配置" : "未配置"}）` : ""}
                <input className={styles.input} type="password" value={form.api_key ?? ""}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={form.provider_type === "openai_compatible" ? "留空或填任意字符" : "sk-..."} />
              </label>

              {/* 4. Model name — always visible */}
              <label className={styles.label}>
                模型名称 *
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <ModelNameInput
                      catalog="embedding"
                      providerType={form.provider_type}
                      value={form.model_name}
                      onChange={(v) => setForm({ ...form, model_name: v })}
                      fetchedModels={effectiveModels}
                      placeholder="例：jina-embeddings-v3"
                      className={styles.input}
                    />
                  </div>
                  {editTarget && <RefreshBtn onClick={refreshModels} loading={loadingModels} />}
                </div>
                {editTarget
                  ? <ModelListHint isLoading={loadingModels} count={profileModels.length} error={modelError} />
                  : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>可直接输入，或保存后自动拉取下拉列表</span>
                }
              </label>

              {/* 5. Dimensions */}
              <label className={styles.label}>
                向量维度（可选，留空自动）
                <input className={styles.input} type="number" min="64" max="65536" value={form.dimensions ?? ""}
                  onChange={(e) => setForm({ ...form, dimensions: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="例：1536" />
              </label>

              {/* 6. Profile name */}
              <label className={styles.label}>
                配置名称 *
                <input className={styles.input} value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例：Jina Embeddings v3"
                  autoFocus={!!editTarget} />
              </label>

              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={closeForm}>取消</button>
                {editTarget && (
                  <button type="button" className={styles.btnSecondary} onClick={handleTest} disabled={testing}>
                    {testing ? "测试中..." : "测试连接"}
                  </button>
                )}
                <button type="submit" className={styles.btnPrimary} disabled={isPending || !form.name || !form.model_name}>
                  {isPending ? "保存中..." : editTarget ? "保存" : "保存并选择模型 →"}
                </button>
              </div>
              {testResult && (
                <div style={{ fontSize: 12, padding: "8px 10px", borderRadius: 4, background: testResult.success ? "rgba(82,201,126,0.1)" : "rgba(224,82,82,0.1)", color: testResult.success ? "#52c97e" : "#e05252" }}>
                  {testResult.success ? `✓ 连接成功，向量维度 ${testResult.dimensions}d (${testResult.latency_ms}ms)` : `✗ ${testResult.error}`}
                </div>
              )}
              {(createMutation.isError || updateMutation.isError) && (
                <p className={styles.error}>{((createMutation.error || updateMutation.error) as Error).message}</p>
              )}
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className={styles.overlay} onClick={() => setDeleteTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>确认删除</h2>
            <p className={styles.confirmText}>确定要删除「<strong>{deleteTarget.name}</strong>」？</p>
            <div className={styles.formActions}>
              <button className={styles.btnSecondary} onClick={() => setDeleteTarget(null)}>取消</button>
              <button className={styles.btnDanger} onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "删除中..." : "确认删除"}
              </button>
            </div>
            {deleteMutation.isError && <p className={styles.error}>{(deleteMutation.error as Error).message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Rerank Section ───────────────────────────────────────────────────────────

const RERANK_PROVIDERS: { value: RerankProviderType; label: string }[] = [
  { value: "jina", label: "Jina AI" },
  { value: "cohere", label: "Cohere" },
  { value: "openai_compatible", label: "OpenAI Compatible" },
];

const RERANK_DEFAULT_MODELS: Record<RerankProviderType, string> = {
  jina: "jina-reranker-v3",
  cohere: "rerank-v4.0-pro",
  openai_compatible: "",
};

function RerankSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<RerankProfile | null>(null);
  const [form, setForm] = useState<CreateRerankProfileRequest>(EMPTY_RERANK);
  const [deleteTarget, setDeleteTarget] = useState<RerankProfile | null>(null);
  const [testResult, setTestResult] = useState<RerankTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // For new compat profiles: manually probed models via base_url
  const [newProbeModels, setNewProbeModels] = useState<string[]>([]);
  const [newProbing, setNewProbing] = useState(false);
  const [newProbeError, setNewProbeError] = useState<string | null>(null);
  // Track whether user changed provider during edit (affects which model list to show)
  const [providerChangedDuringEdit, setProviderChangedDuringEdit] = useState(false);

  const showBaseUrl = form.provider_type === "openai_compatible";

  // Probe from saved profile (edit mode only)
  const { models: profileModels, isLoading: loadingModels, error: modelError } =
    useModelList(editTarget ? { rerankProfileId: editTarget.id } : {});

  // effectiveModels logic:
  // - New profile: static hints (Jina/Cohere) or probed compat models
  // - Edit, provider unchanged: live probe results from saved profile
  // - Edit, provider changed: static hints for new provider (probe not yet re-run)
  const effectiveModels = editTarget
    ? (providerChangedDuringEdit
        ? (KNOWN_RERANK_MODELS[form.provider_type] ?? [])
        : (profileModels.length > 0 ? profileModels : KNOWN_RERANK_MODELS[form.provider_type] ?? []))
    : (form.provider_type !== "openai_compatible"
        ? (KNOWN_RERANK_MODELS[form.provider_type] ?? [])
        : newProbeModels);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["rerank-profiles"],
    queryFn: () => apiFetch<RerankProfile[]>("/settings/rerank-profiles"),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateRerankProfileRequest) =>
      apiFetch<RerankProfile>("/settings/rerank-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (newProfile) => {
      queryClient.invalidateQueries({ queryKey: ["rerank-profiles"] });
      openEdit(newProfile);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRerankProfileRequest }) =>
      apiFetch<RerankProfile>(`/settings/rerank-profiles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["rerank-profiles"] }); closeForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/settings/rerank-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["rerank-profiles"] }); setDeleteTarget(null); },
  });

  function openNew() {
    setEditTarget(null); setForm({ ...EMPTY_RERANK }); setTestResult(null);
    setFormError(null); setNewProbeModels([]); setNewProbeError(null); setShowForm(true);
  }
  function openEdit(p: RerankProfile) {
    setEditTarget(p);
    setForm({ name: p.name, provider_type: p.provider_type, model_name: p.model_name, api_key: "", base_url: p.base_url ?? "" });
    setTestResult(null); setFormError(null); setNewProbeModels([]); setNewProbeError(null);
    setProviderChangedDuringEdit(false); setShowForm(true);
  }
  function closeForm() {
    setShowForm(false); setEditTarget(null); setTestResult(null);
    setFormError(null); setNewProbeModels([]); setNewProbeError(null); setProviderChangedDuringEdit(false);
  }

  function handleProviderChange(provider: RerankProviderType) {
    setForm(f => ({ ...f, provider_type: provider, model_name: RERANK_DEFAULT_MODELS[provider], base_url: "" }));
    setNewProbeModels([]); setNewProbeError(null);
    if (editTarget) setProviderChangedDuringEdit(true);
  }

  // Probe base_url for new openai_compatible rerank (problem 4)
  async function handleProbeCompat() {
    if (!form.base_url) return;
    setNewProbing(true); setNewProbeError(null); setNewProbeModels([]);
    try {
      const params = new URLSearchParams({ base_url: form.base_url });
      if (form.api_key) params.set("api_key", form.api_key);
      const result = await apiFetch<{ models: string[]; error: string | null }>(
        `/settings/model-catalog/probe-models?${params.toString()}`
      );
      if (result.error) { setNewProbeError(result.error); }
      else {
        setNewProbeModels(result.models);
        if (result.models.length > 0 && !form.model_name) {
          setForm(f => ({ ...f, model_name: result.models[0]! }));
        }
      }
    } catch (e) { setNewProbeError((e as Error).message); }
    finally { setNewProbing(false); }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    // Problem 1: validate required fields with user-visible error
    if (!form.name.trim()) { setFormError("请填写配置名称"); return; }
    if (!form.model_name.trim()) { setFormError("请填写或选择模型名称"); return; }
    if (form.provider_type === "openai_compatible" && !form.base_url?.trim()) {
      setFormError("OpenAI Compatible 需要填写 Base URL"); return;
    }
    const body = { ...form };
    if (!body.api_key) delete (body as Record<string, unknown>).api_key;
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    if (editTarget) {
      const patch: UpdateRerankProfileRequest = { ...body };
      if (!body.api_key) delete patch.api_key;
      updateMutation.mutate({ id: editTarget.id, body: patch });
    } else {
      createMutation.mutate(body);
    }
  }

  async function handleTest() {
    if (!editTarget) return;
    setTesting(true); setTestResult(null);
    try {
      const result = await apiFetch<RerankTestResult>(`/settings/rerank-profiles/${editTarget.id}/test`, { method: "POST" });
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  function refreshModels() {
    if (!editTarget) return;
    queryClient.invalidateQueries({ queryKey: ["model-list", "rerank", editTarget.id] });
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  // Disable save only while pending — show formError for field validation instead
  const saveDisabled = isPending;

  return (
    <div>
      <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(255,200,50,0.06)", border: "1px solid rgba(255,200,50,0.2)", borderRadius: 6, fontSize: 12, color: "var(--text-muted)" }}>
        Rerank 为<strong style={{ color: "var(--text)" }}>可选功能，默认不启用</strong>。仅在需要更精准的知识库检索时配置。
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>配置 Rerank 重排序供应商</span>
        <button className={styles.btnPrimary} onClick={openNew}>新增 Rerank 配置</button>
      </div>
      {isLoading && <p className={styles.muted}>加载中...</p>}
      {!isLoading && profiles.length === 0 && (
        <div className={styles.empty}>
          <p>未配置 Rerank（不影响基础 AI 功能）</p>
          <button className={styles.btnSecondary} onClick={openNew}>可选：新增配置</button>
        </div>
      )}
      <div className={styles.list}>
        {profiles.map((p) => (
          <div key={p.id} className={styles.item}>
            <div className={styles.itemInfo}>
              <span className={styles.itemName}>{p.name}</span>
              <span className={styles.tag}>{RERANK_PROVIDERS.find(r => r.value === p.provider_type)?.label ?? p.provider_type}</span>
              <span className={styles.itemModel}>{p.model_name}</span>
              {p.has_api_key && <span style={{ fontSize: 11, color: "#52c97e" }}>● Key 已配置</span>}
            </div>
            <div className={styles.itemActions}>
              <button className={styles.btnSecondary} onClick={() => openEdit(p)}>编辑</button>
              <button className={styles.btnDanger} onClick={() => setDeleteTarget(p)}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className={styles.overlay} onClick={closeForm}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>{editTarget ? "编辑 Rerank 配置" : "新增 Rerank 配置"}</h2>

            {!editTarget && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, marginTop: 0 }}>
                推荐：Jina AI jina-reranker-v3（最新，多语言）。保存后自动获取可用模型列表。
              </p>
            )}

            <form onSubmit={handleSubmit} className={styles.form}>
              {/* 1. Provider */}
              <label className={styles.label}>
                供应商 *
                <select className={styles.select} value={form.provider_type}
                  onChange={(e) => handleProviderChange(e.target.value as RerankProviderType)}>
                  {RERANK_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </label>

              {/* 2. Base URL (openai_compatible only) + probe button for new profiles */}
              {showBaseUrl && (
                <label className={styles.label}>
                  Base URL *
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input className={styles.input} style={{ flex: 1 }} value={form.base_url ?? ""}
                      onChange={(e) => { setForm({ ...form, base_url: e.target.value }); setNewProbeModels([]); setNewProbeError(null); }}
                      placeholder="http://localhost:1234/v1" />
                    {!editTarget && (
                      <button type="button" className={styles.btnSecondary}
                        style={{ whiteSpace: "nowrap", fontSize: 11 }}
                        onClick={handleProbeCompat}
                        disabled={!form.base_url || newProbing}>
                        {newProbing ? "获取中…" : "获取模型列表"}
                      </button>
                    )}
                  </div>
                  {newProbeError && <span style={{ fontSize: 11, color: "var(--danger, #e05252)" }}>✗ {newProbeError}</span>}
                  {newProbeModels.length > 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>✓ 已获取 {newProbeModels.length} 个可用模型</span>}
                </label>
              )}

              {/* 3. API Key */}
              <label className={styles.label}>
                API Key {editTarget ? `（留空保留，当前：${editTarget.has_api_key ? "已配置" : "未配置"}）` : ""}
                <input className={styles.input} type="password" value={form.api_key ?? ""}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={form.provider_type === "jina" ? "jina_..." : "sk-..."} />
              </label>

              {/* 4. Model — combobox. Edit: live probe. New Jina/Cohere: static hints. New compat: probe result */}
              <label className={styles.label}>
                模型名称 *
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <ModelNameInput
                      catalog="embedding"
                      providerType={form.provider_type}
                      value={form.model_name}
                      onChange={(v) => setForm({ ...form, model_name: v })}
                      fetchedModels={effectiveModels}
                      placeholder="例：jina-reranker-v3"
                      className={styles.input}
                    />
                  </div>
                  {editTarget && <RefreshBtn onClick={refreshModels} loading={loadingModels} />}
                </div>
                {editTarget
                  ? <ModelListHint isLoading={loadingModels} count={profileModels.length} error={modelError} />
                  : form.provider_type === "openai_compatible"
                    ? <span style={{ fontSize: 11, color: "var(--text-muted)" }}>填写 Base URL 后点「获取模型列表」，或直接输入模型名称</span>
                    : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>可从下拉选择常用型号，或直接输入</span>
                }
              </label>

              {/* 5. Profile name */}
              <label className={styles.label}>
                配置名称 *
                <input className={styles.input} value={form.name}
                  onChange={(e) => { setForm({ ...form, name: e.target.value }); setFormError(null); }}
                  placeholder="例：Jina Reranker"
                  autoFocus={!!editTarget} />
              </label>

              {/* Problem 1: visible validation error */}
              {formError && <p className={styles.error}>{formError}</p>}

              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={closeForm}>取消</button>
                {editTarget && (
                  <button type="button" className={styles.btnSecondary} onClick={handleTest} disabled={testing}>
                    {testing ? "测试中..." : "测试连接"}
                  </button>
                )}
                <button type="submit" className={styles.btnPrimary} disabled={saveDisabled}>
                  {isPending ? "保存中..." : editTarget ? "保存" : "保存并选择模型 →"}
                </button>
              </div>
              {testResult && (
                <div style={{ fontSize: 12, padding: "8px 10px", borderRadius: 4, background: testResult.success ? "rgba(82,201,126,0.1)" : "rgba(224,82,82,0.1)", color: testResult.success ? "#52c97e" : "#e05252" }}>
                  {testResult.success ? `✓ 连接成功 (${testResult.latency_ms}ms)` : `✗ ${testResult.error}`}
                </div>
              )}
              {(createMutation.isError || updateMutation.isError) && (
                <p className={styles.error}>{((createMutation.error || updateMutation.error) as Error).message}</p>
              )}
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className={styles.overlay} onClick={() => setDeleteTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>确认删除</h2>
            <p className={styles.confirmText}>确定要删除「<strong>{deleteTarget.name}</strong>」？</p>
            <div className={styles.formActions}>
              <button className={styles.btnSecondary} onClick={() => setDeleteTarget(null)}>取消</button>
              <button className={styles.btnDanger} onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "删除中..." : "确认删除"}
              </button>
            </div>
            {deleteMutation.isError && <p className={styles.error}>{(deleteMutation.error as Error).message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type TabKey = "llm" | "embedding" | "rerank";

export default function SettingsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("llm");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 20px",
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    background: "transparent",
    cursor: "pointer",
    transition: "color 0.15s",
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/")}>← 返回</button>
        <h1 className={styles.title}>模型配置</h1>
        <HelpButton doc="model-setup" />
      </header>
      <div style={{ borderBottom: "1px solid var(--border)", display: "flex", gap: 0, paddingLeft: 32 }}>
        <button style={tabStyle(tab === "llm")} onClick={() => setTab("llm")}>LLM 语言模型</button>
        <button style={tabStyle(tab === "embedding")} onClick={() => setTab("embedding")}>Embedding 向量模型</button>
        <button style={tabStyle(tab === "rerank")} onClick={() => setTab("rerank")}>Rerank 重排序</button>
      </div>
      <main className={styles.main}>
        {tab === "llm" && <LLMSection />}
        {tab === "embedding" && <EmbeddingSection />}
        {tab === "rerank" && <RerankSection />}
      </main>
    </div>
  );
}
