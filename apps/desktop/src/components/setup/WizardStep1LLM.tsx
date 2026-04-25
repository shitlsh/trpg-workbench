import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { LLMProfile, CreateLLMProfileRequest } from "@trpg-workbench/shared-schema";

// ── Hardware tier detection ───────────────────────────────────────────────────

interface MemoryTier {
  label: string;
  minGb: number;
  models: string;
  description: string;
  lmStudioDefault: string;  // fallback model name when service offline
  ollamaDefault: string;
}

const MEMORY_TIERS: MemoryTier[] = [
  { label: "高端",   minGb: 20, models: "Qwen3-27B / Qwen3-30B-A3B / Gemma3-27B", description: "最高本地质量，推荐 qwen3-27b-q4_k_m",        lmStudioDefault: "qwen3-27b-q4_k_m",  ollamaDefault: "qwen3:27b" },
  { label: "高质量", minGb: 12, models: "Qwen3-14B / Gemma3-12B",                  description: "创作主力，综合性价比高", lmStudioDefault: "lmstudio-community/Qwen3-14B-GGUF",       ollamaDefault: "qwen3:14b" },
  { label: "平衡",   minGb: 8,  models: "Qwen3-8B",                                description: "推荐入门首选",        lmStudioDefault: "lmstudio-community/Qwen3-8B-GGUF",        ollamaDefault: "qwen3:8b" },
  { label: "轻量",   minGb: 4,  models: "Qwen3-4B / Gemma3-4B",                    description: "设备受限时的可用选项", lmStudioDefault: "lmstudio-community/Qwen3-4B-GGUF",        ollamaDefault: "qwen3:4b" },
];

const FALLBACK_TIER: MemoryTier = {
  label: "极轻量", minGb: 0, models: "Qwen3-4B（仅限尝试）", description: "内存不足 4GB，创作质量受限",
  lmStudioDefault: "lmstudio-community/Qwen3-4B-GGUF", ollamaDefault: "qwen3:4b",
};

function getTierForMemory(gb: number): MemoryTier {
  for (const tier of MEMORY_TIERS) {
    if (gb >= tier.minGb) return tier;
  }
  return FALLBACK_TIER;
}

async function fetchSystemMemoryGb(): Promise<number | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<number>("get_system_memory_gb");
  } catch {
    return null;
  }
}

// ── Local service detection ───────────────────────────────────────────────────

type ProbeStatus = "idle" | "detecting" | "found" | "offline";

async function probeModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).filter(Boolean);
  } catch {
    return [];
  }
}

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
  const [memoryGb, setMemoryGb] = useState<number | null>(null);
  const [lmStudioStatus, setLmStudioStatus] = useState<ProbeStatus>("idle");
  const [ollamaStatus, setOllamaStatus] = useState<ProbeStatus>("idle");
  const [lmStudioModels, setLmStudioModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  // unified list of probed models for the current local preset
  const [probedModels, setProbedModels] = useState<string[]>([]);

  useEffect(() => {
    fetchSystemMemoryGb().then(setMemoryGb);
  }, []);

  const recommendedTier = memoryGb !== null ? getTierForMemory(memoryGb) : MEMORY_TIERS[2]; // fallback: 平衡

  async function handleLmStudioPreset() {
    setLmStudioStatus("detecting");
    setOllamaStatus("idle");
    const detected = await probeModels("http://localhost:1234/v1");
    // Pick first qwen3 model if available, else first model, else tier default
    const preferred = detected.find((m) => m.toLowerCase().includes("qwen3"));
    const modelName = preferred ?? detected[0] ?? recommendedTier.lmStudioDefault;
    const displayName = detected.length > 0
      ? `LM Studio - ${modelName.split("/").pop()?.replace(/-GGUF$/i, "") ?? modelName}`
      : `LM Studio - ${recommendedTier.label}档推荐`;
    setLmStudioModels(detected);
    setProbedModels(detected);
    setLmStudioStatus(detected.length > 0 ? "found" : "offline");
    setForm((f) => ({
      ...f,
      ...LLM_DEFAULTS["openai_compatible"],
      provider_type: "openai_compatible",
      base_url: "http://localhost:1234/v1",
      model_name: modelName,
      api_key: "lm-studio",
      name: displayName,
      supports_json_mode: true,
      supports_tools: false,
    }));
  }

  async function handleOllamaPreset() {
    setOllamaStatus("detecting");
    setLmStudioStatus("idle");
    const detected = await probeModels("http://localhost:11434/v1");
    const modelName = detected[0] ?? recommendedTier.ollamaDefault;
    const displayName = detected.length > 0 ? `Ollama - ${modelName}` : `Ollama - ${recommendedTier.label}档推荐`;
    setOllamaModels(detected);
    setProbedModels(detected);
    setOllamaStatus(detected.length > 0 ? "found" : "offline");
    setForm((f) => ({
      ...f,
      ...LLM_DEFAULTS["openai_compatible"],
      provider_type: "openai_compatible",
      base_url: "http://localhost:11434/v1",
      model_name: modelName,
      api_key: "ollama",
      name: displayName,
    }));
  }

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
            {memoryGb !== null
              ? `检测到内存 ${memoryGb} GB → 推荐${recommendedTier.label}档（${recommendedTier.models}）`
              : "推荐本地（≥8GB 内存即可起步）：数据不离本机，无需 API Key"}
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
            <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 10px", background: "rgba(0,0,0,0.15)", borderRadius: 4, lineHeight: 1.8 }}>
              {memoryGb !== null ? (
                <>
                  <span style={{ color: "#22c55e", fontWeight: 600 }}>
                    你的内存：{memoryGb} GB → 推荐{recommendedTier.label}档
                  </span>
                  <br />
                  推荐模型：{recommendedTier.models}<br />
                  <span style={{ opacity: 0.7 }}>{recommendedTier.description}</span>
                  <br />
                  <span style={{ opacity: 0.7 }}>
                    全部档位：≥20GB 高端 / ≥12GB 高质量 / ≥8GB 平衡 / ≥4GB 轻量
                  </span>
                </>
              ) : (
                <>
                  内存 ≥ 20GB → 高端：Gemma3-27B / Qwen3-32B / Qwen3-30B-A3B<br />
                  内存 ≥ 12GB → 高质量：Qwen3-14B / Gemma3-12B<br />
                  内存 ≥ 8GB &nbsp;→ 平衡：Qwen3-8B（推荐入门首选）<br />
                  内存 ≥ 4GB &nbsp;→ 轻量：Qwen3-4B / Gemma3-4B
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <button
                  type="button"
                  style={localPresetBtnStyle}
                  disabled={lmStudioStatus === "detecting"}
                  onClick={handleLmStudioPreset}
                >
                  {lmStudioStatus === "detecting" ? "检测中…" : "LM Studio（推荐）"}
                </button>
                {lmStudioStatus === "found" && (
                  <span style={{ fontSize: 10, color: "#22c55e" }}>✓ 已检测到 {lmStudioModels.length} 个模型</span>
                )}
                {lmStudioStatus === "offline" && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>服务未运行，已填入推荐默认值</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <button
                  type="button"
                  style={localPresetBtnStyle}
                  disabled={ollamaStatus === "detecting"}
                  onClick={handleOllamaPreset}
                >
                  {ollamaStatus === "detecting" ? "检测中…" : "Ollama"}
                </button>
                {ollamaStatus === "found" && (
                  <span style={{ fontSize: 10, color: "#22c55e" }}>✓ 已检测到 {ollamaModels.length} 个模型</span>
                )}
                {ollamaStatus === "offline" && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>服务未运行，已填入推荐默认值</span>
                )}
              </div>
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
          {probedModels.length > 0 ? (
            <select
              style={inputStyle}
              value={form.model_name}
              onChange={(e) => setForm({ ...form, model_name: e.target.value })}
            >
              {probedModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input style={inputStyle} value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder={isLocalProvider ? "例：qwen3-27b-q4_k_m（在 LM Studio 中加载后点击上方检测）" : "例：gemini-2.0-flash"} />
          )}
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
