import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { EmbeddingProfile, CreateEmbeddingProfileRequest, ProbeModelsResponse } from "@trpg-workbench/shared-schema";
import { ModelNameInput } from "../ModelNameInput";

type EmbeddingProviderType = "openai" | "openai_compatible";

const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI",
  openai_compatible: "OpenAI Compatible（含 LM Studio / Ollama）",
};

const EMPTY_FORM: CreateEmbeddingProfileRequest = {
  name: "",
  provider_type: "openai_compatible",
  model_name: "jina-embeddings-v3",
  base_url: "https://api.jina.ai/v1",
  api_key: "",
};

interface Props {
  onComplete: (profile: EmbeddingProfile) => void;
  onSkip: () => void;
}

export function WizardStep2Embedding({ onComplete, onSkip }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateEmbeddingProfileRequest>(EMPTY_FORM);

  // Verify state — same pattern as LLM wizard step 1
  type VerifyState = "idle" | "verifying" | "ok" | "error";
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifiedModels, setVerifiedModels] = useState<string[]>([]);

  const createMutation = useMutation({
    mutationFn: (body: CreateEmbeddingProfileRequest) =>
      apiFetch<EmbeddingProfile>("/settings/embedding-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["embedding-profiles"] });
      onComplete(profile);
    },
  });

  function resetVerify() {
    setVerifyState("idle"); setVerifyError(null); setVerifiedModels([]);
  }

  async function handleVerify() {
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
        // Auto-select an embedding model if current model_name is still the default
        if (result.models.length > 0) {
          const preferred =
            result.models.find((m) => m.toLowerCase().includes("jina-embeddings-v5")) ??
            result.models.find((m) => m.toLowerCase().includes("embedding")) ??
            result.models[0];
          if (preferred && (form.model_name === "" || form.model_name === EMPTY_FORM.model_name)) {
            setForm(f => ({ ...f, model_name: preferred }));
          }
        }
      }
    } catch (e) {
      setVerifyState("error"); setVerifyError((e as Error).message);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...form };
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    if (!body.api_key) delete (body as Record<string, unknown>).api_key;
    createMutation.mutate(body);
  }

  const showBaseUrl = form.provider_type === "openai_compatible";
  const canVerify = form.provider_type === "openai_compatible"
    ? !!form.base_url
    : !!form.api_key?.trim();

  return (
    <div>
      {/* Preset hints */}
      <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐本地：LM Studio + jina-embeddings-v5，数据不离本机，无需 API Key</span>
        <button
          type="button"
          style={presetBtnGreen}
          onClick={() => {
            setForm(f => ({
              ...f,
              provider_type: "openai_compatible",
              base_url: "http://localhost:1234/v1",
              model_name: "jina-embeddings-v5-text-small-retrieval",
              api_key: "lm-studio",
              name: f.name || "LM Studio Embedding",
            }));
            resetVerify();
          }}
        >
          LM Studio 本地推荐
        </button>
      </div>

      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Jina Embeddings v3，支持多语言，适合中文 TRPG 场景</span>
        <button
          type="button"
          style={presetBtnPurple}
          onClick={() => {
            setForm({ name: "Jina Embeddings v3", provider_type: "openai_compatible", model_name: "jina-embeddings-v3", base_url: "https://api.jina.ai/v1", api_key: "" });
            resetVerify();
          }}
        >
          填入 Jina 推荐值
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Provider first */}
        <label style={labelStyle}>
          供应商 *
          <select style={inputStyle} value={form.provider_type} onChange={(e) => {
            setForm({ ...form, provider_type: e.target.value as EmbeddingProviderType, model_name: "" });
            resetVerify();
          }}>
            <option value="openai">{PROVIDER_DISPLAY.openai}</option>
            <option value="openai_compatible">{PROVIDER_DISPLAY.openai_compatible}</option>
          </select>
        </label>

        {showBaseUrl && (
          <label style={labelStyle}>
            Base URL
            <input
              style={inputStyle}
              value={form.base_url ?? ""}
              onChange={(e) => { setForm({ ...form, base_url: e.target.value }); resetVerify(); }}
              placeholder="http://localhost:1234/v1"
            />
          </label>
        )}

        {/* API Key + verify button */}
        <label style={labelStyle}>
          API Key {form.provider_type === "openai_compatible"
            ? <span style={{ fontSize: 11, color: "#22c55e", fontWeight: "normal" }}>（本地模型可选）</span>
            : ""}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              type="password"
              value={form.api_key ?? ""}
              onChange={(e) => { setForm({ ...form, api_key: e.target.value }); resetVerify(); }}
              placeholder={form.provider_type === "openai_compatible" ? "留空或填 'lm-studio'" : "jina_..."}
            />
            <button
              type="button"
              style={{
                ...presetBtnPurple,
                minWidth: 72,
                ...(verifyState === "ok" ? { background: "rgba(82,201,126,0.12)", color: "#52c97e", borderColor: "rgba(82,201,126,0.4)" } : {}),
                ...(verifyState === "error" ? { background: "rgba(224,82,82,0.1)", color: "#e05252", borderColor: "rgba(224,82,82,0.3)" } : {}),
              }}
              onClick={handleVerify}
              disabled={!canVerify || verifyState === "verifying"}
            >
              {verifyState === "verifying" ? "验证中…" : verifyState === "ok" ? "✓ 已验证" : "验证"}
            </button>
          </div>
          {verifyState === "error" && verifyError && (
            <span style={{ fontSize: 11, color: "#e05252" }}>✗ {verifyError}</span>
          )}
        </label>

        {/* Model name — always visible, verify populates candidates */}
        <label style={labelStyle}>
          模型名称 *
          <ModelNameInput
            catalog="embedding"
            providerType={form.provider_type}
            value={form.model_name}
            onChange={(v) => setForm({ ...form, model_name: v })}
            fetchedModels={verifyState === "ok" ? verifiedModels : []}
            placeholder="例：jina-embeddings-v3"
            style={inputStyle}
          />
          {verifyState === "ok" && verifiedModels.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>已获取 {verifiedModels.length} 个模型 · 可从下拉选择</span>
          )}
          {verifyState === "idle" && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>可直接输入，或点「验证」后从下拉选择</span>
          )}
        </label>

        {/* Profile name at bottom */}
        <label style={labelStyle}>
          配置名称 *
          <input
            style={inputStyle}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例：Jina Embeddings v3"
          />
        </label>

        {createMutation.isError && (
          <p style={{ fontSize: 12, color: "var(--error, #f55)" }}>{(createMutation.error as Error).message}</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" style={btnSecondaryStyle} onClick={onSkip}>稍后配置</button>
          <button type="submit" style={btnPrimaryStyle} disabled={!form.name || !form.model_name || createMutation.isPending}>
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
const presetBtnPurple: React.CSSProperties = { fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" };
const presetBtnGreen: React.CSSProperties = { fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", cursor: "pointer", whiteSpace: "nowrap" };
