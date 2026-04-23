import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { LLMProfile, CreateLLMProfileRequest } from "@trpg-workbench/shared-schema";

const LLM_PROVIDERS = ["openai", "anthropic", "google", "openrouter", "openai_compatible"] as const;
type LLMProviderType = typeof LLM_PROVIDERS[number];

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google",
  openrouter: "OpenRouter", openai_compatible: "OpenAI Compatible",
};

const LLM_DEFAULTS: Record<LLMProviderType, { supports_json_mode: boolean; supports_tools: boolean }> = {
  openai: { supports_json_mode: true, supports_tools: true },
  anthropic: { supports_json_mode: false, supports_tools: true },
  google: { supports_json_mode: true, supports_tools: true },
  openrouter: { supports_json_mode: false, supports_tools: false },
  openai_compatible: { supports_json_mode: false, supports_tools: false },
};

const EMPTY_FORM: CreateLLMProfileRequest = {
  name: "Gemini 2.0 Flash", provider_type: "google", model_name: "gemini-2.0-flash",
  base_url: "", api_key: "", temperature: 0.7, max_tokens: 4096,
  supports_json_mode: true, supports_tools: true, timeout_seconds: 60,
};

interface Props {
  onComplete: (profile: LLMProfile) => void;
  onSkip: () => void;
}

export function WizardStep1LLM({ onComplete, onSkip }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateLLMProfileRequest>(EMPTY_FORM);

  const createMutation = useMutation({
    mutationFn: (body: CreateLLMProfileRequest) =>
      apiFetch<LLMProfile>("/settings/llm-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["llm-profiles"] });
      onComplete(profile);
    },
  });

  function handleProviderChange(prov: LLMProviderType) {
    setForm((f) => ({ ...f, provider_type: prov, ...LLM_DEFAULTS[prov] }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...form };
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    createMutation.mutate(body);
  }

  const showBaseUrl = form.provider_type === "openrouter" || form.provider_type === "openai_compatible";

  return (
    <div>
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐：Google Gemini，支持长上下文，适合 TRPG 创作场景</span>
        <button
          type="button"
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
          onClick={() => setForm((f) => ({ ...f, provider_type: "google", model_name: "gemini-2.0-flash", base_url: "", supports_json_mode: true, supports_tools: true, name: f.name || "Gemini 2.0 Flash" }))}
        >
          填入 Gemini 推荐值
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={labelStyle}>
          配置名称 *
          <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：Gemini 2.0 Flash" autoFocus />
        </label>
        <label style={labelStyle}>
          供应商 *
          <select style={inputStyle} value={form.provider_type} onChange={(e) => handleProviderChange(e.target.value as LLMProviderType)}>
            {LLM_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          模型名称 *
          <input style={inputStyle} value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="例：gemini-2.0-flash" />
        </label>
        {showBaseUrl && (
          <label style={labelStyle}>
            Base URL
            <input style={inputStyle} value={form.base_url ?? ""} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://..." />
          </label>
        )}
        <label style={labelStyle}>
          API Key *
          <input style={inputStyle} type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="AIza..." />
        </label>
        {createMutation.isError && (
          <p style={{ fontSize: 12, color: "var(--error, #f55)" }}>{(createMutation.error as Error).message}</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" style={btnSecondaryStyle} onClick={onSkip}>稍后配置</button>
          <button type="submit" style={btnPrimaryStyle} disabled={!form.name || !form.model_name || !form.api_key || createMutation.isPending}>
            {createMutation.isPending ? "保存中..." : "保存并继续"}
          </button>
        </div>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 };
const inputStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 13, color: "var(--text)" };
const btnPrimaryStyle: React.CSSProperties = { padding: "8px 20px", borderRadius: 6, background: "var(--accent, #7c6aff)", color: "#fff", fontSize: 13, cursor: "pointer", border: "none" };
const btnSecondaryStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", border: "1px solid var(--border)" };
