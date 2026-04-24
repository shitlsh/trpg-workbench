import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { LLMProfile, CreateLLMProfileRequest } from "@trpg-workbench/shared-schema";

const LLM_PROVIDERS = ["openai", "anthropic", "google", "openrouter", "openai_compatible"] as const;
type LLMProviderType = typeof LLM_PROVIDERS[number];

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google",
  openrouter: "OpenRouter", openai_compatible: "OpenAI Compatible（含本地模型）",
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
  const [showLocalGuide, setShowLocalGuide] = useState(false);

  const isLocalProvider = form.provider_type === "openai_compatible";

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
    setShowLocalGuide(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...form };
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    // 本地模型 api_key 为空时发送占位字符，后端 openai_compatible 路径可接受
    if (!body.api_key) body.api_key = "local";
    createMutation.mutate(body);
  }

  const showBaseUrl = form.provider_type === "openrouter" || form.provider_type === "openai_compatible";
  // api_key 对 openai_compatible 为可选
  const apiKeyRequired = form.provider_type !== "openai_compatible";
  const canSubmit = !!form.name && !!form.model_name && (!apiKeyRequired || !!form.api_key) && !createMutation.isPending;

  return (
    <div>
      {/* 云端推荐：Gemini */}
      <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Google Gemini，长上下文，适合 TRPG 创作</span>
        <button
          type="button"
          style={presetBtnStyle}
          onClick={() => setForm((f) => ({ ...f, provider_type: "google", model_name: "gemini-2.0-flash", base_url: "", supports_json_mode: true, supports_tools: true, name: f.name || "Gemini 2.0 Flash", api_key: f.provider_type === "google" ? f.api_key : "" }))}
        >
          填入 Gemini 推荐值
        </button>
      </div>

      {/* 本地模型 preset 区域 */}
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            推荐本地（≥16GB 内存）：数据不离本机，无需 API Key
          </span>
          <button
            type="button"
            style={{ ...presetBtnStyle, background: "rgba(34,197,94,0.12)", color: "#22c55e", borderColor: "rgba(34,197,94,0.3)" }}
            onClick={() => setShowLocalGuide((v) => !v)}
          >
            {showLocalGuide ? "收起" : "本地模型选项"}
          </button>
        </div>

        {showLocalGuide && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {/* 硬件门槛提示 */}
            <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 10px", background: "rgba(0,0,0,0.15)", borderRadius: 4, lineHeight: 1.6 }}>
              内存 ≥ 20GB → 可运行 27B 模型（Gemma3-27B / Qwen2.5-32B）<br />
              内存 ≥ 16GB → 推荐 14B 模型（Qwen2.5-14B / Qwen3-30B-A3B MoE）<br />
              内存 ≥ 10GB → 可运行 12B 模型（Gemma3-12B）<br />
              内存 ≥ 6GB &nbsp;&nbsp;→ 可运行 7B 模型（能用，创作质量受限）
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={localPresetBtnStyle}
                onClick={() => setForm((f) => ({
                  ...f,
                  ...LLM_DEFAULTS["openai_compatible"],
                  provider_type: "openai_compatible",
                  base_url: "http://localhost:1234/v1",
                  model_name: "lmstudio-community/Qwen2.5-14B-Instruct-GGUF",
                  api_key: "lm-studio",
                  name: "LM Studio - Qwen2.5-14B",
                  supports_json_mode: true,   // LM Studio 支持 JSON mode
                  supports_tools: false,
                }))}
              >
                LM Studio（推荐）
              </button>
              <button
                type="button"
                style={localPresetBtnStyle}
                onClick={() => setForm((f) => ({
                  ...f,
                  ...LLM_DEFAULTS["openai_compatible"],
                  provider_type: "openai_compatible",
                  base_url: "http://localhost:11434/v1",
                  model_name: "qwen2.5:14b",
                  api_key: "ollama",
                  name: "Ollama - qwen2.5:14b",
                }))}
              >
                Ollama
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              点击后会自动填入下方表单，你可以修改模型名称。
              详见 <a href="/help/model-setup" style={{ color: "var(--accent)" }}>本地模型配置指南</a>。
            </p>
          </div>
        )}
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
          <input style={inputStyle} value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder={isLocalProvider ? "例：qwen2.5:14b 或 lmstudio-community/..." : "例：gemini-2.0-flash"} />
        </label>
        {showBaseUrl && (
          <label style={labelStyle}>
            Base URL {isLocalProvider && <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: "normal" }}>（LM Studio: localhost:1234/v1，Ollama: localhost:11434/v1）</span>}
            <input style={inputStyle} value={form.base_url ?? ""} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder={isLocalProvider ? "http://localhost:1234/v1" : "https://..."} />
          </label>
        )}
        <label style={labelStyle}>
          API Key {isLocalProvider ? <span style={{ fontSize: 11, color: "#22c55e", fontWeight: "normal" }}>（本地模型可选，填任意字符即可）</span> : "*"}
          <input
            style={inputStyle}
            type="password"
            value={form.api_key ?? ""}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            placeholder={isLocalProvider ? "留空或填 'ollama' / 'lm-studio'" : "AIza..."}
          />
        </label>
        {createMutation.isError && (
          <p style={{ fontSize: 12, color: "var(--error, #f55)" }}>{(createMutation.error as Error).message}</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" style={btnSecondaryStyle} onClick={onSkip}>稍后配置</button>
          <button type="submit" style={btnPrimaryStyle} disabled={!canSubmit}>
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
const presetBtnStyle: React.CSSProperties = { fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" };
const localPresetBtnStyle: React.CSSProperties = { fontSize: 12, padding: "5px 12px", borderRadius: 5, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", cursor: "pointer" };
