import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { LLMProfile, CreateLLMProfileRequest } from "@trpg-workbench/shared-schema";

const LLM_PROVIDERS = ["openai", "google", "openrouter", "openai_compatible"] as const;
type LLMProviderType = typeof LLM_PROVIDERS[number];

const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI Compatible（含本地模型）",
};

const EMPTY_FORM: CreateLLMProfileRequest = {
  name: "", provider_type: "google",
  base_url: "", api_key: "", strict_compatible: false,
};

interface Props {
  onComplete: (profile: LLMProfile) => void;
  onSkip: () => void;
}

export function WizardStep1LLM({ onComplete, onSkip }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateLLMProfileRequest>(EMPTY_FORM);
  const [memoryGb, setMemoryGb] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const gb = await invoke<number>("get_system_memory_gb");
        setMemoryGb(gb);
      } catch { /* browser mode */ }
    })();
  }, []);

  const createMutation = useMutation({
    mutationFn: (body: CreateLLMProfileRequest) =>
      apiFetch<LLMProfile>("/settings/llm-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["llm-profiles"] });
      onComplete(profile);
    },
    onError: (e) => setFormError((e as Error).message),
  });

  function handleProviderChange(prov: LLMProviderType) {
    setForm(f => ({ ...f, provider_type: prov, strict_compatible: false }));
    setFormError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) { setFormError("请填写配置名称"); return; }
    const isLocal = form.provider_type === "openai_compatible";
    if (!isLocal && !form.api_key?.trim()) {
      setFormError("请填写 API Key（云端供应商必填）"); return;
    }
    if (isLocal && showBaseUrl && !form.base_url?.trim()) {
      setFormError("OpenAI Compatible 需要填写 Base URL"); return;
    }
    const body = { ...form };
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    if (!body.api_key) body.api_key = "local";
    createMutation.mutate(body);
  }

  const isLocal = form.provider_type === "openai_compatible";
  const showBaseUrl = form.provider_type === "openrouter" || isLocal;

  return (
    <div>
      {/* Preset hints */}
      <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Google Gemini，长上下文，适合 TRPG 创作</span>
        <button type="button" style={presetBtnPurple}
          onClick={() => setForm(f => ({ ...f, provider_type: "google", base_url: "", name: f.name || "Gemini 2.5 Flash" }))}>
          填入 Gemini 推荐值
        </button>
      </div>
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {memoryGb !== null ? `检测到内存 ${memoryGb} GB — 推荐 LM Studio 本地模型` : "推荐本地：LM Studio，数据不离本机，无需 API Key"}
        </span>
        <button type="button" style={{ ...presetBtnPurple, background: "rgba(34,197,94,0.12)", color: "#22c55e", borderColor: "rgba(34,197,94,0.3)" }}
          onClick={() => setForm(f => ({ ...f, provider_type: "openai_compatible", base_url: "http://localhost:1234/v1", api_key: "lm-studio", name: f.name || "LM Studio" }))}>
          填入 LM Studio 推荐值
        </button>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, marginTop: -4 }}>
        此步骤配置供应商凭据。保存后可在工作空间设置中选择具体模型。
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 1. Provider */}
        <label style={labelStyle}>
          供应商 *
          <select style={inputStyle} value={form.provider_type} onChange={(e) => handleProviderChange(e.target.value as LLMProviderType)}>
            {LLM_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_DISPLAY[p]}</option>)}
          </select>
        </label>

        {/* 2. Base URL */}
        {showBaseUrl && (
          <label style={labelStyle}>
            Base URL {isLocal && <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: "normal" }}>（LM Studio: localhost:1234/v1 · Ollama: localhost:11434/v1）</span>}
            <input style={inputStyle} value={form.base_url ?? ""}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder={isLocal ? "http://localhost:1234/v1" : "https://..."} />
          </label>
        )}

        {/* 3. strict_compatible (advanced, hidden) */}
        {isLocal && (
          <details style={{ marginTop: -4 }}>
            <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
              高级设置（遇到角色兼容问题时展开）
            </summary>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 400 }}>
                <input type="checkbox" checked={!!form.strict_compatible}
                  onChange={(e) => setForm(f => ({ ...f, strict_compatible: e.target.checked }))} />
                strict_compatible（将 developer / latest_reminder 映射为 system）
              </label>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                默认关闭。遇到 DeepSeek 等端点报 role 不支持时再开启。
              </span>
            </div>
          </details>
        )}

        {/* 4. API Key */}
        <label style={labelStyle}>
          API Key {isLocal ? <span style={{ fontSize: 11, color: "#22c55e", fontWeight: "normal" }}>（本地模型可选）</span> : "*"}
          <input style={inputStyle} type="password" value={form.api_key ?? ""}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            placeholder={isLocal ? "留空或填 'ollama' / 'lm-studio'" : "AIza... / sk-..."} />
        </label>

        {/* 5. Profile name */}
        <label style={labelStyle}>
          配置名称 *
          <input style={inputStyle} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例：Gemini 2.5 Flash" />
        </label>

        {formError && <p style={{ fontSize: 12, color: "var(--error, #f55)", margin: 0 }}>{formError}</p>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" style={btnSecondaryStyle} onClick={onSkip}>稍后配置</button>
          <button type="submit" style={btnPrimaryStyle} disabled={createMutation.isPending}>
            {createMutation.isPending ? "保存中..." : "保存并继续 →"}
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
const presetBtnPurple: React.CSSProperties = { fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" };
