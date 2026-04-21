import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { LLMProfile, CreateLLMProfileRequest } from "@trpg-workbench/shared-schema";
import styles from "./ModelProfilesPage.module.css";

// Legacy page - kept for backwards compatibility route
// New settings UI is in SettingsPage.tsx

const PROVIDERS = ["openai", "anthropic", "google", "openrouter", "openai_compatible"] as const;

const EMPTY_FORM: CreateLLMProfileRequest = {
  name: "",
  provider_type: "openai",
  model_name: "",
  base_url: "",
  api_key: "",
  temperature: 0.7,
  max_tokens: 4096,
  supports_json_mode: true,
  supports_tools: true,
  timeout_seconds: 60,
};

export default function ModelProfilesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<LLMProfile | null>(null);
  const [form, setForm] = useState<CreateLLMProfileRequest>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<LLMProfile | null>(null);

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
    mutationFn: ({ id, body }: { id: string; body: Partial<CreateLLMProfileRequest> }) =>
      apiFetch<LLMProfile>(`/settings/llm-profiles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["llm-profiles"] }); closeForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/settings/llm-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["llm-profiles"] }); setDeleteTarget(null); },
  });

  function openNew() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(p: LLMProfile) {
    setEditTarget(p);
    setForm({ name: p.name, provider_type: p.provider_type as typeof PROVIDERS[number], model_name: p.model_name, base_url: p.base_url ?? "", api_key: "", temperature: p.temperature, max_tokens: p.max_tokens, supports_json_mode: p.supports_json_mode, supports_tools: p.supports_tools, timeout_seconds: p.timeout_seconds });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, body: form });
    } else {
      createMutation.mutate(form);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/settings/models")}>← 返回新版设置</button>
        <h1 className={styles.title}>模型配置（Legacy）</h1>
        <button className={styles.btnPrimary} onClick={openNew}>新增配置</button>
      </header>

      <main className={styles.main}>
        {isLoading && <p className={styles.muted}>加载中...</p>}
        {!isLoading && profiles.length === 0 && (
          <div className={styles.empty}>
            <p>还没有模型配置</p>
            <button className={styles.btnPrimary} onClick={openNew}>新增第一个</button>
          </div>
        )}
        <div className={styles.list}>
          {profiles.map((p) => (
            <div key={p.id} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{p.name}</span>
                <span className={styles.tag}>{p.provider_type}</span>
                <span className={styles.itemModel}>{p.model_name}</span>
              </div>
              <div className={styles.itemActions}>
                <button className={styles.btnSecondary} onClick={() => openEdit(p)}>编辑</button>
                <button className={styles.btnDanger} onClick={() => setDeleteTarget(p)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </main>

      {showForm && (
        <div className={styles.overlay} onClick={closeForm}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>{editTarget ? "编辑模型配置" : "新增模型配置"}</h2>
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                配置名称 *
                <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：GPT-4o 主力" autoFocus />
              </label>
              <label className={styles.label}>
                供应商 *
                <select className={styles.select} value={form.provider_type} onChange={(e) => setForm({ ...form, provider_type: e.target.value as typeof PROVIDERS[number] })}>
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className={styles.label}>
                模型名称 *
                <input className={styles.input} value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="例：gpt-4o" />
              </label>
              <label className={styles.label}>
                API Key {editTarget ? "(留空表示不修改)" : "*"}
                <input className={styles.input} type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." />
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={closeForm}>取消</button>
                <button type="submit" className={styles.btnPrimary} disabled={isPending || !form.name || !form.model_name}>
                  {isPending ? "保存中..." : "保存"}
                </button>
              </div>
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
          </div>
        </div>
      )}
    </div>
  );
}
