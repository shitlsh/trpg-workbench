import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { EmbeddingProfile, CreateEmbeddingProfileRequest } from "@trpg-workbench/shared-schema";
import { ModelNameInput } from "../ModelNameInput";

type EmbeddingProviderType = "openai" | "openai_compatible";

const EMPTY_FORM: CreateEmbeddingProfileRequest = {
  name: "Jina Embeddings v3",
  provider_type: "openai_compatible",
  model_name: "jina-embeddings-v3",
  base_url: "https://api.jina.ai/v1",
  api_key: "",
};

// Probe a local endpoint via backend proxy (avoids CORS preflight issues)
async function probeLocalModels(baseUrl: string): Promise<string[]> {
  try {
    const params = new URLSearchParams({ base_url: baseUrl });
    const result = await apiFetch<{ models: string[]; error: string | null }>(
      `/settings/model-catalog/probe-models?${params.toString()}`
    );
    return result.models ?? [];
  } catch {
    return [];
  }
}

interface Props {
  onComplete: (profile: EmbeddingProfile) => void;
  onSkip: () => void;
}

export function WizardStep2Embedding({ onComplete, onSkip }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateEmbeddingProfileRequest>(EMPTY_FORM);
  const [lmStudioStatus, setLmStudioStatus] = useState<"idle" | "detecting" | "found" | "offline">("idle");
  const [lmStudioModels, setLmStudioModels] = useState<string[]>([]);

  const createMutation = useMutation({
    mutationFn: (body: CreateEmbeddingProfileRequest) =>
      apiFetch<EmbeddingProfile>("/settings/embedding-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["embedding-profiles"] });
      onComplete(profile);
    },
  });

  async function handleLmStudioPreset() {
    setLmStudioStatus("detecting");
    const detected = await probeLocalModels("http://localhost:1234/v1");
    // Prefer jina embedding models, then any embedding model, then first available
    const preferred =
      detected.find((m) => m.toLowerCase().includes("jina-embeddings-v5")) ??
      detected.find((m) => m.toLowerCase().includes("embedding")) ??
      detected[0];
    const modelName = preferred ?? "jina-embeddings-v5-text-small-retrieval";
    setLmStudioModels(detected);
    setLmStudioStatus(detected.length > 0 ? "found" : "offline");
    setForm((f) => ({
      ...f,
      provider_type: "openai_compatible",
      base_url: "http://localhost:1234/v1",
      model_name: modelName,
      api_key: "lm-studio",
      name: f.name === EMPTY_FORM.name ? "LM Studio Embedding" : f.name,
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...form };
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    createMutation.mutate(body);
  }

  const showBaseUrl = form.provider_type === "openai_compatible";

  return (
    <div>
      {/* LM Studio local preset (primary recommendation) */}
      <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐本地：LM Studio + jina-embeddings-v5，数据不离本机，无需 API Key</span>
          <button
            type="button"
            style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
            disabled={lmStudioStatus === "detecting"}
            onClick={handleLmStudioPreset}
          >
            {lmStudioStatus === "detecting" ? "检测中…" : "LM Studio 本地推荐"}
          </button>
        </div>
        {lmStudioStatus === "found" && (
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "#22c55e" }}>✓ 已检测到 {lmStudioModels.length} 个模型，已自动选择 embedding 模型</p>
        )}
        {lmStudioStatus === "offline" && (
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
            服务未运行。已填入推荐值（jina-embeddings-v5-text-small-retrieval），请先在 LM Studio 中下载并加载该模型。
          </p>
        )}
      </div>

      {/* Jina cloud preset */}
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Jina Embeddings v3，支持多语言，适合中文 TRPG 场景</span>
        <button
          type="button"
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" }}
          onClick={() => setForm({ name: "Jina Embeddings v3", provider_type: "openai_compatible", model_name: "jina-embeddings-v3", base_url: "https://api.jina.ai/v1", api_key: form.api_key ?? "" })}
        >
          填入 Jina 推荐值
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={labelStyle}>
          配置名称 *
          <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：Jina Embeddings v3" autoFocus />
        </label>
        <label style={labelStyle}>
          供应商 *
          <select style={inputStyle} value={form.provider_type} onChange={(e) => setForm({ ...form, provider_type: e.target.value as EmbeddingProviderType })}>
            <option value="openai">OpenAI</option>
            <option value="openai_compatible">OpenAI Compatible（含 LM Studio / Ollama）</option>
          </select>
        </label>
        <label style={labelStyle}>
          模型名称 *
          <ModelNameInput
            catalog="embedding"
            providerType={form.provider_type}
            value={form.model_name}
            onChange={(v) => setForm({ ...form, model_name: v })}
            fetchedModels={lmStudioModels.length > 1 ? lmStudioModels : []}
            placeholder="例：jina-embeddings-v5-text-small-retrieval"
            style={inputStyle}
          />
        </label>
        {showBaseUrl && (
          <label style={labelStyle}>
            Base URL
            <input style={inputStyle} value={form.base_url ?? ""} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="http://localhost:1234/v1" />
          </label>
        )}
        <label style={labelStyle}>
          API Key {form.provider_type === "openai_compatible" ? <span style={{ fontSize: 11, color: "#22c55e", fontWeight: "normal" }}>（本地模型可选）</span> : ""}
          <input style={inputStyle} type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder={form.provider_type === "openai_compatible" ? "留空或填 'lm-studio'" : "jina_..."} />
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
