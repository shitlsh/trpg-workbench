import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type {
  LLMProfile, CreateLLMProfileRequest, UpdateLLMProfileRequest,
  EmbeddingProfile, CreateEmbeddingProfileRequest, UpdateEmbeddingProfileRequest,
  LLMTestResult, EmbeddingTestResult,
} from "@trpg-workbench/shared-schema";
import styles from "./ModelProfilesPage.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const LLM_PROVIDERS = ["openai", "anthropic", "google", "openrouter", "openai_compatible"] as const;
const EMBEDDING_PROVIDERS = ["openai", "openai_compatible"] as const;

type LLMProviderType = typeof LLM_PROVIDERS[number];
type EmbeddingProviderType = typeof EMBEDDING_PROVIDERS[number];

const LLM_DEFAULTS: Record<LLMProviderType, { supports_json_mode: boolean; supports_tools: boolean }> = {
  openai: { supports_json_mode: true, supports_tools: true },
  anthropic: { supports_json_mode: false, supports_tools: true },
  google: { supports_json_mode: true, supports_tools: true },
  openrouter: { supports_json_mode: false, supports_tools: false },
  openai_compatible: { supports_json_mode: false, supports_tools: false },
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI Compatible",
};

const EMPTY_LLM: CreateLLMProfileRequest = {
  name: "", provider_type: "openai", model_name: "",
  base_url: "", api_key: "", temperature: 0.7, max_tokens: 4096,
  supports_json_mode: true, supports_tools: true, timeout_seconds: 60,
};

const EMPTY_EMBEDDING: CreateEmbeddingProfileRequest = {
  name: "", provider_type: "openai", model_name: "",
  base_url: "", api_key: "", dimensions: undefined,
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
    setEditTarget(null); setForm(EMPTY_LLM); setTestResult(null); setShowForm(true);
  }
  function openEdit(p: LLMProfile) {
    setEditTarget(p);
    setForm({
      name: p.name, provider_type: p.provider_type as LLMProviderType, model_name: p.model_name,
      base_url: p.base_url ?? "", api_key: "", temperature: p.temperature, max_tokens: p.max_tokens,
      supports_json_mode: p.supports_json_mode, supports_tools: p.supports_tools,
      timeout_seconds: p.timeout_seconds,
    });
    setTestResult(null); setShowForm(true);
  }
  function closeForm() {
    setShowForm(false); setEditTarget(null); setForm(EMPTY_LLM); setTestResult(null);
  }
  function handleProviderChange(prov: LLMProviderType) {
    const defaults = LLM_DEFAULTS[prov];
    setForm((f) => ({ ...f, provider_type: prov, ...defaults }));
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    if (!editTarget) return;
    setTesting(true); setTestResult(null);
    try {
      const result = await apiFetch<LLMTestResult>(`/settings/llm-profiles/${editTarget.id}/test`, { method: "POST" });
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const showBaseUrl = form.provider_type === "openrouter" || form.provider_type === "openai_compatible";

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
            <h2 className={styles.modalTitle}>{editTarget ? "编辑 LLM 配置" : "新增 LLM 配置"}</h2>
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
              <label className={styles.label}>
                模型名称 *
                <input className={styles.input} value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="例：gpt-4o" />
              </label>
              {showBaseUrl && (
                <label className={styles.label}>
                  Base URL {form.provider_type === "openai_compatible" ? "*" : ""}
                  <input className={styles.input} value={form.base_url ?? ""} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://..." />
                </label>
              )}
              <label className={styles.label}>
                API Key {editTarget ? `（留空保留，当前：${editTarget.has_api_key ? "已配置" : "未配置"}）` : ""}
                <input className={styles.input} type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." />
              </label>
              <div className={styles.row}>
                <label className={styles.label}>
                  支持 JSON Mode
                  <select className={styles.select} value={form.supports_json_mode ? "1" : "0"} onChange={(e) => setForm({ ...form, supports_json_mode: e.target.value === "1" })}>
                    <option value="1">是</option><option value="0">否</option>
                  </select>
                </label>
                <label className={styles.label}>
                  支持 Tool Calls
                  <select className={styles.select} value={form.supports_tools ? "1" : "0"} onChange={(e) => setForm({ ...form, supports_tools: e.target.value === "1" })}>
                    <option value="1">是</option><option value="0">否</option>
                  </select>
                </label>
              </div>
              <div className={styles.row}>
                <label className={styles.label}>
                  Temperature
                  <input className={styles.input} type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })} />
                </label>
                <label className={styles.label}>
                  Timeout (秒)
                  <input className={styles.input} type="number" min="10" max="600" value={form.timeout_seconds} onChange={(e) => setForm({ ...form, timeout_seconds: parseInt(e.target.value) })} />
                </label>
              </div>
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

  function openNew() { setEditTarget(null); setForm(EMPTY_EMBEDDING); setTestResult(null); setShowForm(true); }
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
                <input className={styles.input} value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="例：text-embedding-3-small" />
              </label>
              {showBaseUrl && (
                <label className={styles.label}>
                  Base URL *
                  <input className={styles.input} value={form.base_url ?? ""} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://..." />
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

// ─── Main Page ─────────────────────────────────────────────────────────────────

type TabKey = "llm" | "embedding";

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
      </header>
      <div style={{ borderBottom: "1px solid var(--border)", display: "flex", gap: 0, paddingLeft: 32 }}>
        <button style={tabStyle(tab === "llm")} onClick={() => setTab("llm")}>LLM 语言模型</button>
        <button style={tabStyle(tab === "embedding")} onClick={() => setTab("embedding")}>Embedding 向量模型</button>
      </div>
      <main className={styles.main}>
        {tab === "llm" ? <LLMSection /> : <EmbeddingSection />}
      </main>
    </div>
  );
}
