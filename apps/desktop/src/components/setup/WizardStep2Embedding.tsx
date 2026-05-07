import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { EmbeddingProfile, CreateEmbeddingProfileRequest } from "@trpg-workbench/shared-schema";
import { ModelNameInput } from "../ModelNameInput";
import { useModelList } from "../../hooks/useModelList";
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
  const [phase, setPhase] = useState<"new" | "pick">("new");
  const [savedProfile, setSavedProfile] = useState<EmbeddingProfile | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: CreateEmbeddingProfileRequest) =>
      apiFetch<EmbeddingProfile>("/settings/embedding-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["embedding-profiles"] });
      setSavedProfile(profile);
      setPhase("pick");
    },
    onError: (e) => setFormError((e as Error).message),
  });

  // Probe models once profile is saved
  const { models: probedModels, isLoading: probingModels, error: probeError } =
    useModelList(savedProfile ? { embeddingProfileId: savedProfile.id } : {});

  // Auto-select first probed model if model_name is still the default/empty
  useEffect(() => {
    if (probedModels.length > 0 && (!form.model_name)) {
      const preferred =
        probedModels.find(m => m.toLowerCase().includes("jina-embeddings-v5")) ??
        probedModels.find(m => m.toLowerCase().includes("embedding")) ??
        probedModels[0];
      if (preferred) setForm(f => ({ ...f, model_name: preferred }));
    }
  }, [probedModels, form.model_name]);

  function refreshModels() {
    if (!savedProfile) return;
    queryClient.invalidateQueries({ queryKey: ["model-list", "embedding", savedProfile.id] });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const body = { ...form };
    if (!body.base_url) delete (body as Record<string, unknown>).base_url;
    if (!body.api_key) delete (body as Record<string, unknown>).api_key;
    createMutation.mutate(body);
  }

  function handleConfirm() {
    if (savedProfile) onComplete({ ...savedProfile, model_name: form.model_name });
  }

  // Static hints before saving
  const staticHints = KNOWN_EMBEDDING_MODELS[form.provider_type] ?? [];
  const showBaseUrl = form.provider_type === "openai_compatible";

  // ── Phase: fill credentials ───────────────────────────────────────────────
  if (phase === "new") {
    return (
      <div>
        {/* Preset hints */}
        <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐本地：LM Studio + jina-embeddings-v5，数据不离本机</span>
          <button type="button" style={presetBtnGreen}
            onClick={() => setForm({ name: "LM Studio Embedding", provider_type: "openai_compatible", model_name: "", base_url: "http://localhost:1234/v1", api_key: "lm-studio" })}>
            LM Studio 本地推荐
          </button>
        </div>
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(124,106,247,0.06)", border: "1px solid rgba(124,106,247,0.2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>推荐云端：Jina Embeddings v3，多语言，适合中文规则书检索</span>
          <button type="button" style={presetBtnPurple}
            onClick={() => setForm({ name: "Jina Embeddings v3", provider_type: "openai_compatible", model_name: "jina-embeddings-v3", base_url: "https://api.jina.ai/v1", api_key: "" })}>
            填入 Jina 推荐值
          </button>
        </div>

        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, marginTop: -4 }}>
          保存后将自动获取可用模型列表，然后确认模型名称。
        </p>

        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 1. Provider */}
          <label style={labelStyle}>
            供应商 *
            <select style={inputStyle} value={form.provider_type}
              onChange={(e) => setForm({ ...form, provider_type: e.target.value as EmbeddingProviderType, model_name: "" })}>
              <option value="openai">{PROVIDER_DISPLAY.openai}</option>
              <option value="openai_compatible">{PROVIDER_DISPLAY.openai_compatible}</option>
            </select>
          </label>

          {/* 2. Base URL */}
          {showBaseUrl && (
            <label style={labelStyle}>
              Base URL
              <input style={inputStyle} value={form.base_url ?? ""}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder="http://localhost:1234/v1" />
            </label>
          )}

          {/* 3. API Key */}
          <label style={labelStyle}>
            API Key {form.provider_type === "openai_compatible" && <span style={{ fontSize: 11, color: "#22c55e", fontWeight: "normal" }}>（本地模型可选）</span>}
            <input style={inputStyle} type="password" value={form.api_key ?? ""}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              placeholder={form.provider_type === "openai_compatible" ? "留空或填 'lm-studio'" : "jina_..."} />
          </label>

          {/* 4. Profile name */}
          <label style={labelStyle}>
            配置名称 *
            <input style={inputStyle} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例：Jina Embeddings v3" />
          </label>

          {formError && <p style={{ fontSize: 12, color: "var(--error, #f55)", margin: 0 }}>{formError}</p>}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" style={btnSecondaryStyle} onClick={onSkip}>稍后配置</button>
            <button type="submit" style={btnPrimaryStyle} disabled={!form.name || createMutation.isPending}>
              {createMutation.isPending ? "保存中..." : "保存并选择模型 →"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── Phase: confirm / pick model ───────────────────────────────────────────
  const effectiveModels = probedModels.length > 0 ? probedModels : staticHints;

  return (
    <div>
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(82,201,126,0.08)", border: "1px solid rgba(82,201,126,0.25)", borderRadius: 6 }}>
        <p style={{ fontSize: 13, color: "#52c97e", margin: 0, fontWeight: 500 }}>
          ✓ 供应商配置「{savedProfile?.name}」已保存
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
          确认模型名称（已自动选择推荐模型，也可从列表选择其他）
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={labelStyle}>
          模型名称 *
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <ModelNameInput
                catalog="embedding"
                providerType={savedProfile?.provider_type ?? ""}
                value={form.model_name}
                onChange={(v) => setForm(f => ({ ...f, model_name: v }))}
                fetchedModels={effectiveModels}
                placeholder="例：jina-embeddings-v3"
                style={inputStyle}
              />
            </div>
            <button type="button" style={{ ...btnSecondaryStyle, fontSize: 11, whiteSpace: "nowrap", marginTop: 2 }}
              onClick={refreshModels} disabled={probingModels}>
              {probingModels ? "获取中…" : "刷新列表"}
            </button>
          </div>
          {probingModels && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>正在获取模型列表…</span>}
          {!probingModels && probeError && <span style={{ fontSize: 11, color: "var(--error, #f55)" }}>✗ {probeError}</span>}
          {!probingModels && !probeError && probedModels.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>✓ 已获取 {probedModels.length} 个模型</span>
          )}
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" style={btnSecondaryStyle}
            onClick={() => { if (savedProfile) onComplete(savedProfile); }}>
            跳过，稍后选择
          </button>
          <button type="button" style={btnPrimaryStyle}
            onClick={handleConfirm}
            disabled={!form.model_name}>
            确认并继续 →
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 };
const inputStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 13, color: "var(--text)" };
const btnPrimaryStyle: React.CSSProperties = { padding: "8px 20px", borderRadius: 6, background: "var(--accent, #7c6aff)", color: "#fff", fontSize: 13, cursor: "pointer", border: "none" };
const btnSecondaryStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", border: "1px solid var(--border)" };
const presetBtnPurple: React.CSSProperties = { fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(124,106,247,0.15)", color: "var(--accent)", border: "1px solid rgba(124,106,247,0.3)", cursor: "pointer", whiteSpace: "nowrap" };
const presetBtnGreen: React.CSSProperties = { fontSize: 12, padding: "4px 10px", borderRadius: 5, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", cursor: "pointer", whiteSpace: "nowrap" };
