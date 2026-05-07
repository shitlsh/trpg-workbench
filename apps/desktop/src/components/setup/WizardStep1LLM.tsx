import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { LLMProfile, CreateLLMProfileRequest, ProbeModelsResponse } from "@trpg-workbench/shared-schema";
import { ModelNameInput } from "../ModelNameInput";

const LLM_PROVIDERS = ["openai", "google", "openrouter", "openai_compatible"] as const;
type LLMProviderType = typeof LLM_PROVIDERS[number];

const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI", google: "Google",
  openrouter: "OpenRouter", openai_compatible: "OpenAI Compatible（含本地模型）",
};

function suggestProfileName(provider: string, model: string): string {
  const labels: Record<string, string> = {
    google: "Gemini", openai: "OpenAI", anthropic: "Claude",
    openrouter: "OpenRouter", openai_compatible: "本地",
  };
  const shortModel = model.split("/").pop() ?? model;
  return `${labels[provider] ?? provider} ${shortModel}`;
}

const EMPTY_FORM: CreateLLMProfileRequest = {
  name: "", provider_type: "google",
  base_url: "", api_key: "", strict_compatible: false,
};

interface Props {
  // A7: onComplete now optionally passes back the selected model name
  onComplete: (profile: LLMProfile, suggestedModel?: string) => void;
  onSkip: () => void;
}

export function WizardStep1LLM({ onComplete, onSkip }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateLLMProfileRequest>(EMPTY_FORM);
  const [memoryGb, setMemoryGb] = useState<number | null>(null);

  // A4/A7: inline verify state
  type VerifyState = "idle" | "verifying" | "ok" | "error";
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifiedModels, setVerifiedModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const gb = await invoke<number>("get_system_memory_gb");
        setMemoryGb(gb);
      } catch { /* not in Tauri context */ }
    })();
  }, []);

  const createMutation = useMutation({
    mutationFn: (body: CreateLLMProfileRequest) =>
      apiFetch<LLMProfile>("/settings/llm-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["llm-profiles"] });
      onComplete(profile, selectedModel || undefined);
    },
  });

  function handleProviderChange(prov: LLMProviderType) {
    setForm((f) => ({
      ...f,
      provider_type: prov,
      strict_compatible: prov === "openai_compatible" ? (f.strict_compatible ?? false) : false,
    }));
    resetVerify();
  }

  function resetVerify() {
    setVerifyState("idle"); setVerifyError(null); setVerifiedModels([]); setSelectedModel("");
  }

  // A4: inline key verify (no save required)
  async function handleVerifyKey() {
    setVerifyState("verifying"); setVerifyError(null); setVerifiedModels([]);
    try {
      const params = new URLSearchParams();
      if (form.base_url) params.set("base_url", form.base_url);
      if (form.api_key) params.set("api_key", form.api_key);
      const result = await apiFetch<ProbeModelsResponse>(
        `/settings/model-catalog/probe-models?${params.toString()}`
      );
      if (result.error) {
        setVerifyState("error"); setVerifyError(result.error);
      } else {
        setVerifiedModels(result.models);
        setVerifyState("ok");
      }
    } catch (e) {
      setVerifyState("error"); setVerifyError((e as Error).message);
    }
  }

  // Auto-suggest name when model is chosen
  function handleModelChange(model: string) {
    setSelectedModel(model);
    if (model && !form.name) {
      setForm(f => ({ ...f, name: suggestProfileName(f.provider_type, model) }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...form };
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    if (!body.api_key) body.api_key = "local";
    createMutation.mutate(body);
  }

  const isLocalProvider = form.provider_type === "openai_compatible";
  const showBaseUrl = form.provider_type === "openrouter" || isLocalProvider;
  const apiKeyRequired = !isLocalProvider;
  const canVerify = isLocalProvider ? !!form.base_url : !!form.api_key?.trim();
  const canSubmit = !!form.name && (!apiKeyRequired || !!form.api_key) && !createMutation.isPending;

  return (
    <div>
      {/* Preset hints */}
      <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Google Gemini，长上下文，适合 TRPG 创作</span>
        <button
          type="button"
          style={presetBtnStyle}
          onClick={() => { setForm((f) => ({ ...f, provider_type: "google", base_url: "" })); resetVerify(); }}
        >
          填入 Gemini 推荐值
        </button>
      </div>

      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {memoryGb !== null
            ? `检测到内存 ${memoryGb} GB — 本地推荐使用 LM Studio，数据不离本机`
            : "推荐本地：LM Studio + 本地大模型，数据不离本机，无需 API Key"}
        </span>
        <button
          type="button"
          style={{ ...presetBtnStyle, background: "rgba(34,197,94,0.12)", color: "#22c55e", borderColor: "rgba(34,197,94,0.3)" }}
          onClick={() => {
            setForm((f) => ({
              ...f,
              provider_type: "openai_compatible",
              base_url: "http://localhost:1234/v1",
              api_key: "lm-studio",
              strict_compatible: false,
            }));
            resetVerify();
          }}
        >
          填入 LM Studio 推荐值
        </button>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, marginTop: -4 }}>
        此步骤只配置供应商凭据。<strong>模型名称在工作空间设置中单独选择</strong>，支持随时切换。
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* A3: provider first */}
        <label style={labelStyle}>
          供应商 *
          <select style={inputStyle} value={form.provider_type} onChange={(e) => handleProviderChange(e.target.value as LLMProviderType)}>
            {LLM_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_DISPLAY[p]}</option>)}
          </select>
        </label>
        {showBaseUrl && (
          <label style={labelStyle}>
            Base URL {isLocalProvider && <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: "normal" }}>（LM Studio: localhost:1234/v1 · Ollama: localhost:11434/v1）</span>}
            <input
              style={inputStyle}
              value={form.base_url ?? ""}
              onChange={(e) => { setForm({ ...form, base_url: e.target.value }); resetVerify(); }}
              placeholder={isLocalProvider ? "http://localhost:1234/v1" : "https://..."}
            />
          </label>
        )}
        {/* A5: strict_compatible collapsed */}
        {isLocalProvider && (
          <details style={{ marginTop: -4 }}>
            <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
              高级设置（遇到角色兼容问题时展开）
            </summary>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={!!form.strict_compatible}
                  onChange={(e) => setForm((f) => ({ ...f, strict_compatible: e.target.checked }))}
                />
                strict_compatible（将 `developer` / `latest_reminder` 映射为 `system`）
              </label>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                默认关闭（native_roles）。遇到 DeepSeek 等端点报 role 不支持时再开启。
              </span>
            </div>
          </details>
        )}
        {/* A4: API Key + inline verify */}
        <label style={labelStyle}>
          API Key {isLocalProvider ? <span style={{ fontSize: 11, color: "#22c55e", fontWeight: "normal" }}>（本地模型可选，填任意字符即可）</span> : "*"}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              type="password"
              value={form.api_key ?? ""}
              onChange={(e) => { setForm({ ...form, api_key: e.target.value }); resetVerify(); }}
              placeholder={isLocalProvider ? "留空或填 'ollama' / 'lm-studio'" : "AIza..."}
            />
            <button
              type="button"
              style={{
                ...presetBtnStyle, minWidth: 72,
                ...(verifyState === "ok" ? { background: "rgba(82,201,126,0.12)", color: "#52c97e", borderColor: "rgba(82,201,126,0.4)" } : {}),
                ...(verifyState === "error" ? { background: "rgba(224,82,82,0.1)", color: "#e05252", borderColor: "rgba(224,82,82,0.3)" } : {}),
              }}
              onClick={handleVerifyKey}
              disabled={!canVerify || verifyState === "verifying"}
            >
              {verifyState === "verifying" ? "验证中…" : verifyState === "ok" ? "✓ 已验证" : "验证 Key"}
            </button>
          </div>
          {verifyState === "error" && verifyError && (
            <span style={{ fontSize: 11, color: "#e05252" }}>✗ {verifyError}</span>
          )}
        </label>
        {/* A7: model picker shown after successful verify */}
        {verifyState === "ok" && (
          <label style={labelStyle}>
            选择默认模型（可选，将预填到工作空间配置）
            <ModelNameInput
              catalog="llm"
              providerType={form.provider_type}
              value={selectedModel}
              onChange={handleModelChange}
              catalogEntries={[]}
              fetchedModels={verifiedModels}
              placeholder="例：gemini-2.0-flash"
              className=""
              style={inputStyle}
            />
            {verifiedModels.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                已从供应商获取 {verifiedModels.length} 个模型 · 选择后将在工作空间中预填
              </span>
            )}
          </label>
        )}
        {/* A3: name at bottom, auto-suggested */}
        <label style={labelStyle}>
          配置名称 *
          <input
            style={inputStyle}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={selectedModel ? suggestProfileName(form.provider_type, selectedModel) : "例：Gemini 2.0 Flash"}
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
