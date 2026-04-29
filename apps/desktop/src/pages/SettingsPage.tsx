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
  ProbeModelsResponse,
} from "@trpg-workbench/shared-schema";
import styles from "./SettingsPage.module.css";
import { ModelNameInput } from "../components/ModelNameInput";
import { HelpButton } from "../components/HelpButton";
import { useModelList } from "../hooks/useModelList";

// ─── Constants ────────────────────────────────────────────────────────────────

const LLM_PROVIDERS = ["openai", "anthropic", "google", "openrouter", "openai_compatible"] as const;
const EMBEDDING_PROVIDERS = ["openai", "openai_compatible"] as const;

type LLMProviderType = typeof LLM_PROVIDERS[number];
type EmbeddingProviderType = typeof EMBEDDING_PROVIDERS[number];

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI Compatible",
};

const EMPTY_LLM: CreateLLMProfileRequest = {
  name: "", provider_type: "openai",
  base_url: "", api_key: "", strict_compatible: false,
};

const EMPTY_EMBEDDING: CreateEmbeddingProfileRequest = {
  name: "", provider_type: "openai", model_name: "",
  base_url: "", api_key: "", dimensions: undefined,
};

const GEMINI_PRESET: Partial<CreateLLMProfileRequest> = {
  provider_type: "google",
  base_url: "",
};

const JINA_EMBEDDING_PRESET: Partial<CreateEmbeddingProfileRequest> = {
  provider_type: "openai_compatible",
  model_name: "jina-embeddings-v3",
  base_url: "https://api.jina.ai/v1",
};


// ─── LLM Section ──────────────────────────────────────────────────────────────

function LLMSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<LLMProfile | null>(null);
  const [form, setForm] = useState<CreateLLMProfileRequest>(EMPTY_LLM);
  const [deleteTarget, setDeleteTarget] = useState<LLMProfile | null>(null);
  const [testResult, setTestResult] = useState<LLMTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [testModelName, setTestModelName] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  /** 云端供应商（OpenAI / Anthropic / Google / OpenRouter）新建时必须填 API Key；本地兼容可留空或随意字符 */
  const apiKeyRequiredForCreate =
    !editTarget && form.provider_type !== "openai_compatible";

  // When editing an existing profile, auto-fetch its available models (works for all providers)
  const { models: profileModels, isLoading: fetchingProfileModels } = useModelList(editTarget?.id ?? null);

  // 供应商只返回一个模型时自动填入测试框，避免首次点「测试」时 state 仍为空
  useEffect(() => {
    if (!editTarget) return;
    if (profileModels.length !== 1) return;
    if (testModelName.trim() !== "") return;
    setTestModelName(profileModels[0]!);
  }, [editTarget?.id, profileModels, testModelName]);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
  });



  const createMutation = useMutation({
    mutationFn: (body: CreateLLMProfileRequest) =>
      apiFetch<LLMProfile>("/settings/llm-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["llm-profiles"] }); closeForm(); },
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
    setEditTarget(null); setForm(EMPTY_LLM); setTestResult(null); setFetchedModels([]); setFetchModelsError(null); setTestModelName(""); setFormError(null); setShowForm(true);
  }
  function openEdit(p: LLMProfile) {
    setEditTarget(p);
    setForm({
      name: p.name, provider_type: p.provider_type as LLMProviderType,
      base_url: p.base_url ?? "", api_key: "", strict_compatible: p.strict_compatible ?? false,
    });
    setTestResult(null); setFetchedModels([]); setFetchModelsError(null); setTestModelName(""); setFormError(null); setShowForm(true);
  }
  function closeForm() {
    setShowForm(false); setEditTarget(null); setForm(EMPTY_LLM); setTestResult(null); setFetchedModels([]); setFetchModelsError(null); setTestModelName(""); setFormError(null);
  }
  function handleProviderChange(prov: LLMProviderType) {
    setForm((f) => ({ ...f, provider_type: prov, strict_compatible: prov === "openai_compatible" ? (f.strict_compatible ?? false) : false }));
    setFetchedModels([]); setFetchModelsError(null);
  }

  async function handleFetchModels() {
    if (!form.base_url) return;
    setFetchingModels(true); setFetchModelsError(null);
    try {
      const params = new URLSearchParams({ base_url: form.base_url });
      if (form.api_key) params.set("api_key", form.api_key);
      const result = await apiFetch<ProbeModelsResponse>(
        `/settings/model-catalog/probe-models?${params.toString()}`
      );
      if (result.error) {
        setFetchModelsError(result.error);
      } else {
        setFetchedModels(result.models);
      }
    } catch (e) {
      setFetchModelsError((e as Error).message);
    } finally {
      setFetchingModels(false);
    }
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (apiKeyRequiredForCreate && !form.api_key?.trim()) {
      setFormError("请填写 API Key（OpenAI / Anthropic / Google / OpenRouter 新建时必填）");
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
  function handleRefreshModelList() {
    if (!editTarget) return;
    void queryClient.invalidateQueries({ queryKey: ["model-list", editTarget.id] });
  }

  async function handleTest() {
    if (!editTarget) return;
    const model = testModelName.trim();
    if (!model) {
      setTestResult({ success: false, error: "请先在「测试用模型名称」中输入或从下拉选择模型（含内置建议），再点测试" });
      return;
    }
    setTesting(true); setTestResult(null);
    try {
      const result = await apiFetch<LLMTestResult>(
        `/settings/llm-profiles/${editTarget.id}/test?model_name=${encodeURIComponent(model)}`,
        { method: "POST" }
      );
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const showBaseUrl = form.provider_type === "openrouter" || form.provider_type === "openai_compatible";
  const saveDisabled =
    isPending ||
    !form.name.trim() ||
    (apiKeyRequiredForCreate && !form.api_key?.trim());

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
              <span className={styles.tag}>{PROVIDER_LABELS[p.provider_type] ?? p.provider_type}</span>
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
            {!editTarget && (
              <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐：Google Gemini，支持长上下文，适合 TRPG 创作场景</span>
                <button
                  type="button"
                  style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
                  onClick={() => {
                    setForm((f) => ({ ...f, ...GEMINI_PRESET, name: f.name || "Gemini 2.0 Flash" }));
                  }}
                >
                  一键填入 Gemini 推荐值
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                配置名称 *
                <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：GPT-4o 主力" autoFocus />
              </label>
              <label className={styles.label}>
                供应商 *
                <select className={styles.select} value={form.provider_type} onChange={(e) => handleProviderChange(e.target.value as LLMProviderType)}>
                  {LLM_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                </select>
              </label>
              {showBaseUrl && (
                <label className={styles.label}>
                  Base URL {form.provider_type === "openai_compatible" ? "*" : ""}
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      className={styles.input}
                      style={{ flex: 1 }}
                      value={form.base_url ?? ""}
                      onChange={(e) => { setForm({ ...form, base_url: e.target.value }); setFetchedModels([]); }}
                      placeholder="https://..."
                    />
                    {form.base_url && (
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        style={{ whiteSpace: "nowrap", fontSize: 11 }}
                        onClick={handleFetchModels}
                        disabled={fetchingModels}
                      >
                        {fetchingModels ? "获取中..." : "获取模型列表"}
                      </button>
                    )}
                  </div>
                  {fetchModelsError && <span style={{ fontSize: 11, color: "var(--error, #f55)" }}>{fetchModelsError}</span>}
                  {fetchedModels.length > 0 && <span style={{ fontSize: 11, color: "#52c97e" }}>✓ 获取到 {fetchedModels.length} 个模型</span>}
                </label>
              )}
              {form.provider_type === "openai_compatible" && (
                <label className={styles.label} style={{ gap: 8 }}>
                  角色兼容模式
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={!!form.strict_compatible}
                      onChange={(e) => setForm((f) => ({ ...f, strict_compatible: e.target.checked }))}
                    />
                    strict_compatible（将 `developer` / `latest_reminder` 映射为 `system`）
                  </label>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    默认关闭（native_roles）。仅当供应商不接受 `developer` 角色（如部分 DeepSeek/OpenAI-Compatible 网关）时再开启。
                  </span>
                </label>
              )}
              <label className={styles.label}>
                API Key{" "}
                {apiKeyRequiredForCreate ? <span style={{ color: "var(--error, #e05252)" }}>*</span> : null}
                {editTarget ? `（留空保留，当前：${editTarget.has_api_key ? "已配置" : "未配置"}）` : ""}
                <input className={styles.input} type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." />
                {apiKeyRequiredForCreate && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>OpenAI / Anthropic / Google / OpenRouter 新建时必须填写；OpenAI 兼容可留空（本地服务）</span>
                )}
              </label>
              {editTarget && (
                <label className={styles.label}>
                  测试用模型名称
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <ModelNameInput
                        catalog="llm"
                        providerType={form.provider_type}
                        value={testModelName}
                        onChange={setTestModelName}
                        catalogEntries={[]}
                        fetchedModels={profileModels.length > 0 ? profileModels : fetchedModels}
                        placeholder="例：claude-sonnet-4-20250514 / gemini-2.0-flash"
                        className={styles.input}
                      />
                    </div>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      style={{ whiteSpace: "nowrap", fontSize: 11, marginTop: 2 }}
                      onClick={handleRefreshModelList}
                      disabled={fetchingProfileModels}
                    >
                      {fetchingProfileModels ? "刷新中…" : "刷新模型列表"}
                    </button>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginTop: 4 }}>
                    {fetchingProfileModels
                      ? "正在从供应商拉取模型列表（需已保存本配置且 API Key 有效）…"
                      : profileModels.length > 0
                        ? `✓ 已从供应商获取 ${profileModels.length} 个模型`
                        : "若列表为空，多为 Key 未配置或保存后尚未刷新；可点「刷新模型列表」或直接从下拉中的内置建议选择，再点「测试连接」"}
                  </span>
                </label>
              )}
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={closeForm}>取消</button>
                {editTarget && (
                  <button type="button" className={styles.btnSecondary} onClick={handleTest} disabled={testing}>
                    {testing ? "测试中..." : "测试连接"}
                  </button>
                )}
                <button type="submit" className={styles.btnPrimary} disabled={saveDisabled}>
                  {isPending ? "保存中..." : "保存"}
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
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);

  // When editing an existing profile, auto-fetch its available models
  const { models: profileModels, isLoading: fetchingProfileModels } = useModelList(editTarget?.id ?? null);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: () => apiFetch<EmbeddingProfile[]>("/settings/embedding-profiles"),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateEmbeddingProfileRequest) =>
      apiFetch<EmbeddingProfile>("/settings/embedding-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["embedding-profiles"] }); closeForm(); },
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

  function openNew() { setEditTarget(null); setForm(EMPTY_EMBEDDING); setTestResult(null); setFetchedModels([]); setFetchModelsError(null); setShowForm(true); }
  function openEdit(p: EmbeddingProfile) {
    setEditTarget(p);
    setForm({ name: p.name, provider_type: p.provider_type as EmbeddingProviderType, model_name: p.model_name, base_url: p.base_url ?? "", api_key: "", dimensions: p.dimensions ?? undefined });
    setTestResult(null); setFetchedModels([]); setFetchModelsError(null); setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditTarget(null); setForm(EMPTY_EMBEDDING); setTestResult(null); setFetchedModels([]); setFetchModelsError(null); }

  async function handleFetchEmbeddingModels() {
    if (!form.base_url) return;
    setFetchingModels(true); setFetchModelsError(null);
    try {
      const params = new URLSearchParams({ base_url: form.base_url });
      if (form.api_key) params.set("api_key", form.api_key);
      const result = await apiFetch<ProbeModelsResponse>(
        `/settings/model-catalog/probe-models?${params.toString()}`
      );
      if (result.error) {
        setFetchModelsError(result.error);
      } else {
        const names = result.models;
        setFetchedModels(names);
        if (names.length > 0 && !form.model_name) {
          setForm((f) => ({ ...f, model_name: names[0] }));
        }
      }
    } catch (e) {
      setFetchModelsError((e as Error).message);
    } finally {
      setFetchingModels(false);
    }
  }
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

  const isPending = createMutation.isPending || updateMutation.isPending;
  const showBaseUrl = form.provider_type === "openai_compatible";

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
              <span className={styles.tag}>{PROVIDER_LABELS[p.provider_type] ?? p.provider_type}</span>
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
              <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ padding: "8px 12px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐本地：LM Studio + jina-embeddings-v5，数据不离本机，无需 API Key</span>
                  <button
                    type="button"
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
                    onClick={() => setForm((f) => ({ ...f, provider_type: "openai_compatible", model_name: "jina-embeddings-v5-text-small-retrieval", base_url: "http://localhost:1234/v1", api_key: "lm-studio", name: f.name || "LM Studio Jina v5" }))}
                  >
                    LM Studio 本地推荐
                  </button>
                </div>
                <div style={{ padding: "8px 12px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Jina Embeddings v3，多语言支持，适合中文规则书检索</span>
                  <button
                    type="button"
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
                    onClick={() => {
                      setForm((f) => ({ ...f, ...JINA_EMBEDDING_PRESET, name: f.name || "Jina Embeddings v3" }));
                    }}
                  >
                    一键填入 Jina 推荐值
                  </button>
                </div>
              </div>
            )}
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                配置名称 *
                <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：OpenAI text-embedding-3-small" autoFocus />
              </label>
              <label className={styles.label}>
                供应商 *
                <select className={styles.select} value={form.provider_type} onChange={(e) => setForm({ ...form, provider_type: e.target.value as EmbeddingProviderType })}>
                  {EMBEDDING_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                </select>
              </label>
               <label className={styles.label}>
                 模型名称 *
                 <ModelNameInput
                   catalog="embedding"
                   providerType={form.provider_type}
                   value={form.model_name}
                   onChange={(v) => setForm({ ...form, model_name: v })}
                   fetchedModels={profileModels.length > 0 ? profileModels : (form.provider_type === "openai_compatible" ? fetchedModels : [])}
                   placeholder="例：jina-embeddings-v3"
                   className={styles.input}
                 />
                 {fetchingProfileModels && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>正在获取模型列表...</span>}
                 {!fetchingProfileModels && profileModels.length > 0 && <span style={{ fontSize: 11, color: "#52c97e" }}>✓ 已获取 {profileModels.length} 个模型</span>}
               </label>
              {showBaseUrl && (
                <label className={styles.label}>
                  Base URL *
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      className={styles.input}
                      style={{ flex: 1 }}
                      value={form.base_url ?? ""}
                      onChange={(e) => { setForm({ ...form, base_url: e.target.value }); setFetchedModels([]); }}
                      placeholder="https://api.jina.ai/v1"
                    />
                    {form.base_url && (
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        style={{ whiteSpace: "nowrap", fontSize: 11 }}
                        onClick={handleFetchEmbeddingModels}
                        disabled={fetchingModels}
                      >
                        {fetchingModels ? "获取中..." : "获取模型列表"}
                      </button>
                    )}
                  </div>
                  {fetchModelsError && <span style={{ fontSize: 11, color: "var(--error, #f55)" }}>{fetchModelsError}</span>}
                  {fetchedModels.length > 0 && <span style={{ fontSize: 11, color: "#52c97e" }}>✓ 获取到 {fetchedModels.length} 个模型</span>}
                </label>
              )}
              <label className={styles.label}>
                API Key {editTarget ? `（留空保留，当前：${editTarget.has_api_key ? "已配置" : "未配置"}）` : ""}
                <input className={styles.input} type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." />
              </label>
              <label className={styles.label}>
                向量维度（可选，留空自动）
                <input className={styles.input} type="number" min="64" max="65536" value={form.dimensions ?? ""} onChange={(e) => setForm({ ...form, dimensions: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="例：1536" />
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={closeForm}>取消</button>
                {editTarget && (
                  <button type="button" className={styles.btnSecondary} onClick={handleTest} disabled={testing}>
                    {testing ? "测试中..." : "测试连接"}
                  </button>
                )}
                <button type="submit" className={styles.btnPrimary} disabled={isPending || !form.name || !form.model_name}>
                  {isPending ? "保存中..." : "保存"}
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
  jina: "jina-reranker-v2-base-multilingual",
  cohere: "rerank-multilingual-v3.0",
  openai_compatible: "",
};

const EMPTY_RERANK: CreateRerankProfileRequest = {
  name: "", provider_type: "jina", model: "jina-reranker-v2-base-multilingual",
  api_key: "", base_url: "",
};

function RerankSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<RerankProfile | null>(null);
  const [form, setForm] = useState<CreateRerankProfileRequest>(EMPTY_RERANK);
  const [deleteTarget, setDeleteTarget] = useState<RerankProfile | null>(null);
  const [testResult, setTestResult] = useState<RerankTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["rerank-profiles"],
    queryFn: () => apiFetch<RerankProfile[]>("/settings/rerank-profiles"),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateRerankProfileRequest) =>
      apiFetch<RerankProfile>("/settings/rerank-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["rerank-profiles"] }); closeForm(); },
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
    setEditTarget(null);
    setForm({ ...EMPTY_RERANK });
    setTestResult(null);
    setShowForm(true);
  }

  function openEdit(p: RerankProfile) {
    setEditTarget(p);
    setForm({ name: p.name, provider_type: p.provider_type, model: p.model, api_key: "", base_url: p.base_url ?? "" });
    setTestResult(null);
    setShowForm(true);
  }

  function closeForm() { setShowForm(false); setEditTarget(null); setTestResult(null); }

  function handleProviderChange(provider: RerankProviderType) {
    setForm((f) => ({ ...f, provider_type: provider, model: RERANK_DEFAULT_MODELS[provider] }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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

  const isPending = createMutation.isPending || updateMutation.isPending;
  const showBaseUrl = form.provider_type === "openai_compatible";

  return (
    <div>
      <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(255,200,50,0.06)", border: "1px solid rgba(255,200,50,0.2)", borderRadius: 6, fontSize: 12, color: "var(--text-muted)" }}>
        Rerank 为<strong style={{ color: "var(--text)" }}>可选功能，默认不启用</strong>。仅在需要更精准的知识库检索时配置，不影响基础 AI 功能。
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
          配置 Rerank 重排序供应商（默认推荐：Jina jina-reranker-v2-base-multilingual）
        </span>
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
              <span className={styles.tag}>{RERANK_PROVIDERS.find((r) => r.value === p.provider_type)?.label ?? p.provider_type}</span>
              <span className={styles.itemModel}>{p.model}</span>
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
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                配置名称 *
                <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：Jina Reranker" autoFocus />
              </label>
              <label className={styles.label}>
                供应商 *
                <select className={styles.select} value={form.provider_type} onChange={(e) => handleProviderChange(e.target.value as RerankProviderType)}>
                  {RERANK_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </label>
              <label className={styles.label}>
                模型名称 *
                <input className={styles.input} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="例：jina-reranker-v2-base-multilingual" />
              </label>
              {showBaseUrl && (
                <label className={styles.label}>
                  Base URL *
                  <input className={styles.input} value={form.base_url ?? ""} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://..." />
                </label>
              )}
              <label className={styles.label}>
                API Key {editTarget ? `（留空保留，当前：${editTarget.has_api_key ? "已配置" : "未配置"}）` : ""}
                <input className={styles.input} type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="jina_..." />
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={closeForm}>取消</button>
                {editTarget && (
                  <button type="button" className={styles.btnSecondary} onClick={handleTest} disabled={testing}>
                    {testing ? "测试中..." : "测试连接"}
                  </button>
                )}
                <button type="submit" className={styles.btnPrimary} disabled={isPending || !form.name || !form.model}>
                  {isPending ? "保存中..." : "保存"}
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
