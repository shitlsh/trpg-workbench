import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { EmbeddingProfile, CreateEmbeddingProfileRequest, ProbeModelsResponse } from "@trpg-workbench/shared-schema";
import { ModelNameInput } from "../ModelNameInput";
import { KNOWN_EMBEDDING_MODELS } from "../../lib/modelCatalog";

type EmbeddingProviderType = "openai" | "openai_compatible";

const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI",
  openai_compatible: "OpenAI Compatible（含 LM Studio / Ollama）",
};

const EMPTY_FORM: CreateEmbeddingProfileRequest = {
  name: "", provider_type: "openai_compatible",
  model_name: "", base_url: "", api_key: "",
};

interface Props {
  onComplete: (profile: EmbeddingProfile) => void;
  onSkip: () => void;
}

export function WizardStep2Embedding({ onComplete, onSkip }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateEmbeddingProfileRequest>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  // Probed model candidates (from inline probe before saving)
  const [probedModels, setProbedModels] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: CreateEmbeddingProfileRequest) =>
      apiFetch<EmbeddingProfile>("/settings/embedding-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["embedding-profiles"] });
      onComplete(profile);
    },
    onError: (e) => setFormError((e as Error).message),
  });

  // Probe models from current base_url + api_key without saving
  async function handleProbe() {
    if (!form.base_url) return;
    setProbing(true); setProbeError(null); setProbedModels([]);
    try {
      const params = new URLSearchParams({ base_url: form.base_url });
      if (form.api_key) params.set("api_key", form.api_key);
      const result = await apiFetch<ProbeModelsResponse>(
        `/settings/model-catalog/probe-models?${params.toString()}`
      );
      if (result.error) {
        setProbeError(result.error);
      } else {
        setProbedModels(result.models);
        // Auto-select a good embedding model if none chosen yet
        if (!form.model_name && result.models.length > 0) {
          const preferred =
            result.models.find(m => m.toLowerCase().includes("jina-embeddings-v5")) ??
            result.models.find(m => m.toLowerCase().includes("embedding")) ??
            result.models[0];
          if (preferred) setForm(f => ({ ...f, model_name: preferred }));
        }
      }
    } catch (e) {
      setProbeError((e as Error).message);
    } finally {
      setProbing(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) { setFormError("请填写配置名称"); return; }
    if (!form.model_name.trim()) { setFormError("请填写或选择模型名称"); return; }
    if (form.provider_type === "openai_compatible" && !form.base_url?.trim()) {
      setFormError("OpenAI Compatible 需要填写 Base URL"); return;
    }
    const body = { ...form };
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    if (!body.api_key) delete (body as Record<string, unknown>).api_key;
    createMutation.mutate(body);
  }

  const showBaseUrl = form.provider_type === "openai_compatible";
  // Candidates: probed results first, then static known models as fallback hints
  const staticHints = KNOWN_EMBEDDING_MODELS[form.provider_type] ?? [];
  const candidateModels = probedModels.length > 0 ? probedModels : staticHints;

  return (
    <div>
      {/* Preset hints */}
      <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐本地：LM Studio + jina-embeddings-v5，数据不离本机</span>
        <button type="button" style={presetBtnGreen}
          onClick={() => {
            setForm({ name: "LM Studio Embedding", provider_type: "openai_compatible", model_name: "jina-embeddings-v5-text-small-retrieval", base_url: "http://localhost:1234/v1", api_key: "lm-studio" });
            setProbedModels([]); setProbeError(null);
          }}>
          LM Studio 本地推荐
        </button>
      </div>
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Jina Embeddings v3，多语言，适合中文规则书检索</span>
        <button type="button" style={presetBtnPurple}
          onClick={() => {
            setForm({ name: "Jina Embeddings v3", provider_type: "openai_compatible", model_name: "jina-embeddings-v3", base_url: "https://api.jina.ai/v1", api_key: "" });
            setProbedModels([]); setProbeError(null);
          }}>
          填入 Jina 推荐值
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 1. Provider */}
        <label style={labelStyle}>
          供应商 *
          <select style={inputStyle} value={form.provider_type}
            onChange={(e) => {
              setForm({ ...form, provider_type: e.target.value as EmbeddingProviderType, model_name: "", base_url: "" });
              setProbedModels([]); setProbeError(null);
            }}>
            <option value="openai">{PROVIDER_DISPLAY.openai}</option>
            <option value="openai_compatible">{PROVIDER_DISPLAY.openai_compatible}</option>
          </select>
        </label>

        {/* 2. Base URL + probe button */}
        {showBaseUrl && (
          <label style={labelStyle}>
            Base URL
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input style={{ ...inputStyle, flex: 1 }} value={form.base_url ?? ""}
                onChange={(e) => { setForm({ ...form, base_url: e.target.value }); setProbedModels([]); setProbeError(null); }}
                placeholder="http://localhost:1234/v1" />
              <button type="button"
                style={{ ...presetBtnPurple, minWidth: 90 }}
                onClick={handleProbe}
                disabled={!form.base_url || probing}>
                {probing ? "获取中…" : "获取模型列表"}
              </button>
            </div>
            {probeError && <span style={{ fontSize: 11, color: "var(--error, #f55)" }}>✗ {probeError}</span>}
            {!probing && !probeError && probedModels.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>✓ 已获取 {probedModels.length} 个模型</span>
            )}
          </label>
        )}

        {/* 3. API Key */}
        <label style={labelStyle}>
          API Key {form.provider_type === "openai_compatible" && <span style={{ fontSize: 11, color: "#22c55e", fontWeight: "normal" }}>（本地模型可选）</span>}
          <input style={inputStyle} type="password" value={form.api_key ?? ""}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            placeholder={form.provider_type === "openai_compatible" ? "留空或填 'lm-studio'" : "jina_..."} />
        </label>

        {/* 4. Model name — always required */}
        <label style={labelStyle}>
          模型名称 *
          <ModelNameInput
            catalog="embedding"
            providerType={form.provider_type}
            value={form.model_name}
            onChange={(v) => setForm({ ...form, model_name: v })}
            fetchedModels={candidateModels}
            placeholder="例：jina-embeddings-v3"
            style={inputStyle}
          />
          {candidateModels.length > 0
            ? <span style={{ fontSize: 11, color: "var(--text-muted)" }}>可从下拉选择，或直接输入</span>
            : showBaseUrl
              ? <span style={{ fontSize: 11, color: "var(--text-muted)" }}>填写 Base URL 后点「获取模型列表」，或直接输入</span>
              : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>可直接输入模型名称</span>
          }
        </label>

        {/* 5. Profile name */}
        <label style={labelStyle}>
          配置名称 *
          <input style={inputStyle} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例：Jina Embeddings v3" />
        </label>

        {formError && <p style={{ fontSize: 12, color: "var(--error, #f55)", margin: 0 }}>{formError}</p>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" style={btnSecondaryStyle} onClick={onSkip}>稍后配置</button>
          <button type="submit" style={btnPrimaryStyle} disabled={createMutation.isPending}>
            {createMutation.isPending ? "保存并继续..." : "保存并继续 →"}
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
