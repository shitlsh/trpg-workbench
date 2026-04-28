import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ModelNameInput } from "../components/ModelNameInput";
import {
  BookOpen, Plus, Trash2, Edit2, Library, MessageSquare, X,
  Upload, Search, ChevronDown, ChevronRight, FileText, AlertTriangle, Layers, Tag, Sparkles, Pencil, Check,
} from "lucide-react";
import { apiFetch, apiPostSSE, BACKEND_URL } from "../lib/api";
import { useTaskProgress } from "../hooks/useTaskProgress";
import { useModelList } from "../hooks/useModelList";
import { useCustomAssetTypes } from "../hooks/useCustomAssetTypes";
import { getAssetTypeIcon, getAssetTypeLabel, getAssetTypeColor } from "../lib/assetTypeVisual";
import { BUILTIN_ASSET_TYPES } from "@trpg-workbench/shared-schema";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type {
  RuleSet,
  CreateRuleSetRequest,
  UpdateRuleSetRequest,
  KnowledgeLibrary,
  CreateKnowledgeLibraryRequest,
  ChunkType,
  KnowledgeDocument,
  KnowledgeDocumentSummary,
  ChunkListItem,
  PageTextPreview,
  SearchTestRequest,
  SearchTestResponse,
  PromptProfile,
  LLMProfile,
  ModelCatalogEntry,
  EmbeddingProfile,
  CustomAssetTypeConfig,
  CreateCustomAssetTypeRequest,
} from "@trpg-workbench/shared-schema";
import styles from "./RuleSetPage.module.css";
import { HelpButton } from "../components/HelpButton";


const CHUNK_TYPES: { value: ChunkType; label: string; description: string }[] = [
  { value: "rule", label: "规则说明", description: "规则机制、技能定义、判定方式" },
  { value: "table", label: "数值表格", description: "技能列表、装备清单、数值表" },
  { value: "procedure", label: "程序步骤", description: "战斗流程、行动顺序等程序性内容" },
  { value: "lore", label: "世界设定", description: "背景叙述、世界观资料" },
  { value: "example", label: "举例说明", description: "规则示例、示范场景" },
  { value: "flavor", label: "氛围文字", description: "纯叙事文字，无规则信息" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "等待中", running: "处理中", success: "成功",
  partial: "部分成功", scanned_fallback: "扫描版", failed: "失败",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--text-muted)", running: "var(--accent)", success: "var(--success)",
  partial: "#f0a500", scanned_fallback: "#f0a500", failed: "var(--danger)",
};

const WARNING_LABEL: Record<string, string> = {
  scanned_fallback: "扫描版 PDF（文字质量较差）", partial: "部分页面解析失败",
  has_table: "包含表格（可能格式异常）", has_multi_column: "包含多列排版",
  page_range_anomaly: "页码范围异常", empty_page: "存在空白页",
};

// ─── Create Library Modal ─────────────────────────────────────────────────────

function CreateLibraryModal({
  ruleSetId,
  onClose,
}: {
  ruleSetId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const createMutation = useMutation({
    mutationFn: (body: CreateKnowledgeLibraryRequest) =>
      apiFetch<KnowledgeLibrary>("/knowledge/libraries", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "libraries"] });
      onClose();
    },
  });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>新建知识库</h2>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            createMutation.mutate({
              name: name.trim(),
              description: desc.trim() || undefined,
              rule_set_id: ruleSetId,
            });
          }}
        >
          <label className={styles.label}>
            名称 *
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：COC7 核心规则书" autoFocus />
          </label>
          <label className={styles.label}>
            描述
            <textarea className={styles.textarea} value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
          </label>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>取消</button>
            <button type="submit" className={styles.btnPrimary} disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending ? "创建中..." : "创建"}
            </button>
          </div>
          {createMutation.isError && <p className={styles.error}>{(createMutation.error as Error).message}</p>}
        </form>
      </div>
    </div>
  );
}

// ─── Set Prompt Modal ─────────────────────────────────────────────────────────

function SetPromptModal({
  ruleSetId,
  currentProfileId,
  initialTab = "select",
  onClose,
  onSetDefault,
}: {
  ruleSetId: string;
  currentProfileId: string | null;
  initialTab?: "select" | "manual" | "ai";
  onClose: () => void;
  onSetDefault?: (profileId: string) => void;
}) {
  const queryClient = useQueryClient();
  type Tab = "select" | "manual" | "ai";
  const [tab, setTab] = useState<Tab>(initialTab);

  // existing profiles for this rule set (shown in "已有" tab)
  const { data: profiles = [] } = useQuery({
    queryKey: ["prompt-profiles", ruleSetId],
    queryFn: () => apiFetch<PromptProfile[]>(`/prompt-profiles?rule_set_id=${ruleSetId}`),
  });
  const { data: llmProfiles = [] } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
  });

  const deleteMutation = useMutation({
    mutationFn: (profileId: string) =>
      apiFetch(`/prompt-profiles/${profileId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles", ruleSetId] });
    },
  });

  // manual tab
  const [manualName, setManualName] = useState("");
  const [manualPrompt, setManualPrompt] = useState("");
  const [manualNotes, setManualNotes] = useState("");

  const createManualMutation = useMutation({
    mutationFn: () =>
      apiFetch<PromptProfile>("/prompt-profiles", {
        method: "POST",
        body: JSON.stringify({
          name: manualName.trim(),
          system_prompt: manualPrompt.trim(),
          style_notes: manualNotes.trim() || undefined,
          rule_set_id: ruleSetId,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles", ruleSetId] });
      onClose();
    },
  });

  // ai tab
  const [selectedLlmId, setSelectedLlmId] = useState("");
  const [aiModelName, setAiModelName] = useState("");
  const [aiStyleDesc, setAiStyleDesc] = useState("");

  // Fetch available models for the selected LLM profile (works for all provider types)
  const selectedLlmProfile = llmProfiles.find((p) => p.id === selectedLlmId);
  const { models: probedModels } = useModelList(selectedLlmId ?? null);
  const { data: aiLlmCatalog = [] } = useQuery({
    queryKey: ["model-catalog", selectedLlmProfile?.provider_type, "ai-prompt"],
    queryFn: () =>
      apiFetch<ModelCatalogEntry[]>(
        `/settings/model-catalog?provider_type=${encodeURIComponent(selectedLlmProfile!.provider_type)}`,
      ),
    enabled: tab === "ai" && !!selectedLlmProfile?.provider_type,
  });
  // Auto-select when only one model is returned
  useEffect(() => {
    if (probedModels.length === 1 && !aiModelName) setAiModelName(probedModels[0]);
  }, [probedModels]);
  const [aiName, setAiName] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);

  async function handleGenerate() {
    if (!selectedLlmId || !aiModelName.trim()) {
      setGenError("请选择 LLM 供应商并填写模型名称");
      return;
    }
    setIsGenerating(true);
    setGenError(null);
    try {
      const res = await apiPostSSE<{ name: string; system_prompt: string; style_notes: string }>(
        "/prompt-profiles/generate",
        {
          rule_set_id: ruleSetId,
          llm_profile_id: selectedLlmId,
          model_name: aiModelName.trim(),
          style_description: aiStyleDesc.trim() || undefined,
        },
      );
      setAiName(res.name || `创作风格`);
      setAiPrompt(res.system_prompt);
      setAiNotes(res.style_notes);
      setGenerated(true);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setIsGenerating(false);
    }
  }

  const createAiMutation = useMutation({
    mutationFn: () =>
      apiFetch<PromptProfile>("/prompt-profiles", {
        method: "POST",
        body: JSON.stringify({
          name: aiName.trim(),
          system_prompt: aiPrompt.trim(),
          style_notes: aiNotes.trim() || undefined,
          rule_set_id: ruleSetId,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles", ruleSetId] });
      onClose();
    },
  });

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", fontSize: 13, fontWeight: active ? 600 : 400,
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    background: "transparent", cursor: "pointer", border: "none",
    borderBottomStyle: "solid",
  });

  // "select" mode = pick-from-list only; "manual"/"ai" = create new (two tabs)
  const isSelectMode = initialTab === "select";

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} style={{ width: 540, maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className={styles.modalTitle} style={{ margin: 0 }}>
            {isSelectMode ? "设置默认提示词" : "新建提示词"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={16} /></button>
        </div>

        {/* Select mode: no tabs, just the list */}
        {isSelectMode && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
              点击提示词将其设为此规则集的默认创作风格。
            </p>
            <div className={styles.selectList}>
              {profiles.length === 0 && (
                <p className={styles.empty}>暂无提示词——请先使用「新建」按钮创建提示词</p>
              )}
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className={`${styles.selectListItem} ${p.id === currentProfileId ? styles.selected : ""}`}
                  style={{ cursor: onSetDefault ? "pointer" : "default" }}
                  onClick={() => {
                    if (onSetDefault && p.id !== currentProfileId) {
                      onSetDefault(p.id);
                      onClose();
                    }
                  }}
                >
                  <MessageSquare size={14} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                    {p.style_notes && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {p.style_notes.slice(0, 80)}{p.style_notes.length > 80 ? "..." : ""}
                      </div>
                    )}
                  </div>
                  {p.id === currentProfileId && (
                    <span style={{ fontSize: 11, color: "var(--accent)", flexShrink: 0 }}>当前默认</span>
                  )}
                  <button
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px 4px", flexShrink: 0 }}
                    title="删除"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`确认删除「${p.name}」？`)) deleteMutation.mutate(p.id); }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Create mode: manual + AI tabs */}
        {!isSelectMode && (
          <>
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
              <button style={tabStyle(tab === "manual")} onClick={() => setTab("manual")}>
                <Pencil size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                手动填写
              </button>
              <button style={tabStyle(tab === "ai")} onClick={() => setTab("ai")}>
                <Sparkles size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                AI 生成
              </button>
            </div>

            {/* Manual tab */}
            {tab === "manual" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              手动填写提示词内容，创建后自动关联到此规则集。
            </p>
            <label className={styles.label}>
              名称 *
              <input className={styles.input} value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="例：恐怖调查标准风格" autoFocus />
            </label>
            <label className={styles.label}>
              系统提示词 *
              <textarea
                className={styles.textarea}
                value={manualPrompt}
                onChange={(e) => setManualPrompt(e.target.value)}
                rows={6}
                placeholder="你是一位擅长...的 TRPG 创作助手。&#10;&#10;创作风格约束：&#10;- ..."
              />
            </label>
            <label className={styles.label}>
              风格摘要（用于界面展示）
              <input className={styles.input} value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} placeholder="简短描述风格要点（30-60字）" />
            </label>
            {createManualMutation.isError && (
              <p className={styles.error}>{(createManualMutation.error as Error).message}</p>
            )}
            <div className={styles.formActions}>
              <button className={styles.btnSecondary} onClick={onClose}>取消</button>
              <button
                className={styles.btnPrimary}
                disabled={!manualName.trim() || !manualPrompt.trim() || createManualMutation.isPending}
                onClick={() => createManualMutation.mutate()}
              >
                {createManualMutation.isPending ? "保存中..." : "保存并关联"}
              </button>
            </div>
          </div>
            )}

            {/* AI tab */}
            {tab === "ai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              选择 LLM 模型，自动为此规则集生成创作提示词，生成后可编辑调整。
            </p>
            <label className={styles.label}>
              LLM 供应商 *
              {llmProfiles.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6 }}>
                  暂无可用 LLM——请先在「模型配置」页面添加
                </div>
              ) : (
                <select className={styles.select} value={selectedLlmId} onChange={(e) => setSelectedLlmId(e.target.value)}>
                  <option value="">请选择供应商...</option>
                  {llmProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </label>
            <label className={styles.label}>
              模型名称 *
              <ModelNameInput
                catalog="llm"
                providerType={selectedLlmProfile?.provider_type ?? ""}
                value={aiModelName}
                onChange={setAiModelName}
                catalogEntries={aiLlmCatalog}
                fetchedModels={probedModels}
                requireJsonMode
                placeholder="例：gemini-2.0-flash / llama-3.1-8b"
                className={styles.input}
              />
            </label>
            <label className={styles.label}>
              风格描述（可选）
              <textarea
                className={styles.textarea}
                value={aiStyleDesc}
                onChange={(e) => setAiStyleDesc(e.target.value)}
                rows={2}
                placeholder="例：克苏鲁恐怖风格，强调氛围压迫感，避免轻松幽默的语气"
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>描述你希望的风格方向，AI 生成时会作为参考</span>
            </label>
            {!generated && (
              <>
                {genError && <p className={styles.error}>{genError}</p>}
                <div className={styles.formActions}>
                  <button className={styles.btnSecondary} onClick={onClose}>取消</button>
                  <button
                    className={styles.btnPrimary}
                    disabled={!selectedLlmId || isGenerating}
                    onClick={handleGenerate}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Sparkles size={13} />
                    {isGenerating ? "生成中..." : "生成提示词"}
                  </button>
                </div>
              </>
            )}
            {generated && (
              <>
                <label className={styles.label}>
                  名称
                  <input className={styles.input} value={aiName} onChange={(e) => setAiName(e.target.value)} />
                </label>
                <label className={styles.label}>
                  系统提示词
                  <textarea className={styles.textarea} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={6} />
                </label>
                <label className={styles.label}>
                  风格摘要
                  <input className={styles.input} value={aiNotes} onChange={(e) => setAiNotes(e.target.value)} />
                </label>
                {createAiMutation.isError && (
                  <p className={styles.error}>{(createAiMutation.error as Error).message}</p>
                )}
                <div className={styles.formActions}>
                  <button className={styles.btnSecondary} onClick={() => { setGenerated(false); setGenError(null); }}>重新生成</button>
                  <button
                    className={styles.btnPrimary}
                    disabled={!aiName.trim() || !aiPrompt.trim() || createAiMutation.isPending}
                    onClick={() => createAiMutation.mutate()}
                  >
                     {createAiMutation.isPending ? "保存中..." : "保存并关联"}
                  </button>
                </div>
              </>
            )}
          </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Document Preview Panel ───────────────────────────────────────────────────

function DocumentPreviewPanel({
  docId,
  filename,
  onClose,
}: {
  docId: string;
  filename: string;
  onClose: () => void;
}) {
  const [previewTab, setPreviewTab] = useState<"chunks" | "pages">("chunks");
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [filterChunkType, setFilterChunkType] = useState<ChunkType | "">("");

  const { data: chunks = [] } = useQuery({
    queryKey: ["knowledge", "doc", docId, "chunks"],
    queryFn: () => apiFetch<ChunkListItem[]>(`/knowledge/documents/${docId}/chunks`),
  });

  const { data: pagePreview } = useQuery({
    queryKey: ["knowledge", "doc", docId, "page", pageNumber],
    queryFn: () => apiFetch<PageTextPreview>(`/knowledge/documents/${docId}/pages/${pageNumber}`),
    enabled: previewTab === "pages",
  });

  const { data: chunkDetail } = useQuery({
    queryKey: ["knowledge", "doc", docId, "chunk", selectedChunkId],
    queryFn: () => apiFetch<ChunkListItem>(`/knowledge/documents/${docId}/chunks/${selectedChunkId}`),
    enabled: !!selectedChunkId,
  });

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 16px", fontSize: 13, fontWeight: active ? 600 : 400,
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    background: "transparent", cursor: "pointer",
  });

  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: 480,
      background: "var(--surface, #1a1a1a)", borderLeft: "1px solid var(--border)",
      zIndex: 100, display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          <FileText size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          {filename}
        </div>
        <button onClick={onClose} style={{ background: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ borderBottom: "1px solid var(--border)", display: "flex", paddingLeft: 8 }}>
        <button style={tabStyle(previewTab === "chunks")} onClick={() => setPreviewTab("chunks")}>Chunks ({chunks.length})</button>
        <button style={tabStyle(previewTab === "pages")} onClick={() => setPreviewTab("pages")}>页面文本</button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {previewTab === "chunks" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* chunk_type filter */}
            <select
              value={filterChunkType}
              onChange={(e) => setFilterChunkType(e.target.value as ChunkType | "")}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", marginBottom: 4 }}
            >
              <option value="">全部类型 ({chunks.length})</option>
              {CHUNK_TYPES.map((ct) => {
                const count = chunks.filter((c) => c.chunk_type === ct.value).length;
                return count > 0 ? <option key={ct.value} value={ct.value}>{ct.label} ({count})</option> : null;
              })}
            </select>
            {chunks.filter((c) => !filterChunkType || c.chunk_type === filterChunkType).length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>尚无 Chunk 数据</p>
            )}
            {chunks.filter((c) => !filterChunkType || c.chunk_type === filterChunkType).map((chunk) => (
              <div
                key={chunk.chunk_id}
                onClick={() => setSelectedChunkId(selectedChunkId === chunk.chunk_id ? null : chunk.chunk_id)}
                style={{
                  padding: "8px 10px", borderRadius: 6,
                  border: `1px solid ${selectedChunkId === chunk.chunk_id ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer", fontSize: 12,
                }}
              >
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600 }}>#{chunk.chunk_index}</span>
                  <span style={{ color: "var(--text-muted)" }}>p{chunk.page_from}–{chunk.page_to}</span>
                  <span style={{ color: "var(--text-muted)" }}>{chunk.char_count} 字</span>
                  {chunk.chunk_type && (
                    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "var(--accent-muted, rgba(99,102,241,0.15))", color: "var(--accent)" }}>
                      {CHUNK_TYPES.find((ct) => ct.value === chunk.chunk_type)?.label ?? chunk.chunk_type}
                    </span>
                  )}
                  {chunk.has_table && <span style={{ color: "#f0a500", fontSize: 11 }}>表格</span>}
                  {chunk.has_multi_column && <span style={{ color: "#f0a500", fontSize: 11 }}>多列</span>}
                </div>
                {chunk.section_title && (
                  <div style={{ color: "var(--text-muted)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {chunk.section_title}
                  </div>
                )}
                {selectedChunkId === chunk.chunk_id && chunkDetail?.content && (
                  <div style={{
                    marginTop: 8, padding: "6px 8px", background: "var(--bg, #111)",
                    borderRadius: 4, fontSize: 12, lineHeight: 1.5,
                    whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto",
                  }}>
                    {chunkDetail.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {previewTab === "pages" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
              <span style={{ fontSize: 13 }}>页码：</span>
              <input
                type="number" min={1} value={pageNumber}
                onChange={(e) => setPageNumber(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ width: 60, padding: "4px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}
              />
            </div>
            {pagePreview ? (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                  Chunks: {pagePreview.chunk_ids.length} 个
                </div>
                <div style={{
                  padding: "8px 10px", background: "var(--bg, #111)", borderRadius: 6,
                  fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 500, overflow: "auto",
                }}>
                  {pagePreview.cleaned_text || pagePreview.raw_text || "（无文本内容）"}
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>加载中...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Search Test Dialog ────────────────────────────────────────────────────────

function SearchTestDialog({
  libraryId,
  workspaceId,
  onClose,
}: {
  libraryId: string;
  workspaceId: string | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [useRerank, setUseRerank] = useState(false);
  /** 空 = 不按类型过滤 */
  const [chunkTypeFilter, setChunkTypeFilter] = useState<ChunkType[]>([]);
  const [result, setResult] = useState<SearchTestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleChunkType(ct: ChunkType) {
    setChunkTypeFilter((prev) => (prev.includes(ct) ? prev.filter((x) => x !== ct) : [...prev, ct]));
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true); setError(null);
    try {
      const body: SearchTestRequest = {
        query: query.trim(), library_ids: [libraryId], top_k: topK,
        use_rerank: useRerank, workspace_id: workspaceId ?? undefined,
        chunk_type_filter: chunkTypeFilter.length > 0 ? chunkTypeFilter : undefined,
      };
      const res = await apiFetch<SearchTestResponse>(
        `/knowledge/libraries/${libraryId}/search/test`,
        { method: "POST", body: JSON.stringify(body) }
      );
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div
        style={{
          background: "var(--surface, #1a1a1a)", borderRadius: 10, padding: 24,
          width: 640, maxWidth: "95vw", maxHeight: "85vh", overflow: "auto",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            <Layers size={15} style={{ marginRight: 8, verticalAlign: "middle" }} />
            检索测试
          </h2>
          <button onClick={onClose} style={{ background: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}
            placeholder="输入查询词（如：理智值检定）"
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()} autoFocus
          />
          <input
            type="number" min={1} max={20} value={topK}
            onChange={(e) => setTopK(Math.max(1, parseInt(e.target.value) || 5))}
            title="top_k"
            style={{ width: 60, padding: "8px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}
          />
          <button
            onClick={handleSearch} disabled={loading || !query.trim()}
            style={{ padding: "8px 16px", borderRadius: 6, background: "var(--accent, #7c6aff)", color: "#fff", fontSize: 13, cursor: "pointer" }}
          >
            {loading ? "搜索中..." : <><Search size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />搜索</>}
          </button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={useRerank} onChange={(e) => setUseRerank(e.target.checked)} />
          使用 Rerank（需 Workspace 已配置 Rerank Profile 且已启用）
        </label>

        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          按内容类型筛选（可选，不选则不过滤）：
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {CHUNK_TYPES.map((ct) => (
            <label
              key={ct.value}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={chunkTypeFilter.includes(ct.value)}
                onChange={() => toggleChunkType(ct.value)}
              />
              {ct.label}
            </label>
          ))}
        </div>

        {error && <p style={{ color: "var(--danger, #e05252)", fontSize: 13 }}>{error}</p>}

        {result && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              命中 {result.results.length} 条
              {result.reranked && " · 已 Rerank"}
              {result.warnings.length > 0 && ` · ${result.warnings.join("; ")}`}
            </div>
            {result.error && <div style={{ fontSize: 12, color: "#f0a500", marginBottom: 8 }}>{result.error}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.results.map((r, i) => (
                <div key={r.chunk_id} style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>#{i + 1} {r.document_filename}</span>
                    <span style={{ color: "var(--text-muted)" }}>p{r.page_from}–{r.page_to}</span>
                    <span style={{ color: "var(--text-muted)" }}>vec: {r.vector_score.toFixed(3)}</span>
                    {r.rerank_score != null && <span style={{ color: "var(--accent)" }}>rerank: {r.rerank_score.toFixed(3)}</span>}
                    {r.chunk_type ? (
                      <span style={{ color: "var(--text-muted)" }} title={CHUNK_TYPES.find((c) => c.value === r.chunk_type)?.description}>
                        类型: {CHUNK_TYPES.find((c) => c.value === r.chunk_type)?.label ?? r.chunk_type}
                      </span>
                    ) : null}
                  </div>
                  {r.section_title && <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>{r.section_title}</div>}
                  <div style={{ lineHeight: 1.5, color: "var(--text)", whiteSpace: "pre-wrap" }}>
                    {r.content.length > 400 ? r.content.slice(0, 400) + "..." : r.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Document Row ──────────────────────────────────────────────────────────────

function DocumentRow({
  doc, expanded, onToggle, onPreview, isPreviewing, onDelete,
}: {
  doc: KnowledgeDocument; expanded: boolean; onToggle: () => void;
  onPreview: () => void; isPreviewing: boolean; onDelete: () => void;
}) {
  const summaryEnabled =
    expanded && doc.parse_status !== "pending" && doc.parse_status !== "running";
  const canPreview =
    ["success", "partial", "scanned_fallback"].includes(doc.parse_status) && (doc.chunk_count ?? 0) > 0;

  const { data: summary } = useQuery({
    queryKey: ["knowledge", "doc", doc.id, "summary"],
    queryFn: () => apiFetch<KnowledgeDocumentSummary>(`/knowledge/documents/${doc.id}/summary`),
    enabled: summaryEnabled,
  });

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, marginBottom: 6 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" }}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {doc.filename}
        </span>
        <span style={{ fontSize: 12, color: STATUS_COLOR[doc.parse_status] ?? "var(--text-muted)" }}>
          {STATUS_LABEL[doc.parse_status] ?? doc.parse_status}
        </span>
        {doc.page_count != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{doc.page_count} 页</span>}
        {doc.chunk_count != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{doc.chunk_count} 块</span>}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {new Date(doc.created_at).toLocaleDateString("zh-CN")}
        </span>
        {canPreview && (
          <button
            style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 4,
              border: "1px solid var(--border)", background: isPreviewing ? "var(--accent)" : "transparent",
              color: isPreviewing ? "#fff" : "var(--text-muted)", cursor: "pointer",
            }}
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
          >
            预览
          </button>
        )}
        <button
          style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "var(--text-muted)" }}
          onClick={(e) => { e.stopPropagation(); if (confirm(`确认删除文档「${doc.filename}」？`)) onDelete(); }}
          title="删除文档"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {expanded && (
        <div style={{ padding: "0 12px 10px 34px", fontSize: 12 }}>
          {summary ? (
            <>
              {summary.embedding_model && (
                <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
                  Embedding: {summary.embedding_provider} / {summary.embedding_model}
                  {summary.indexed_at && ` · 索引于 ${new Date(summary.indexed_at).toLocaleString("zh-CN")}`}
                </div>
              )}
              {summary.parse_quality_notes && (
                <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
                  解析备注：{summary.parse_quality_notes}
                </div>
              )}
              {summary.quality_warnings.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {summary.quality_warnings.map((w, i) => (
                    <div key={i} style={{
                      display: "flex", gap: 6, alignItems: "flex-start",
                      padding: "4px 8px", borderRadius: 4, marginBottom: 3,
                      background: "rgba(240,165,0,0.08)", color: "#f0a500",
                    }}>
                      <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
                      <span>{WARNING_LABEL[w.type] ?? w.type}{w.detail ? `：${w.detail}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : summaryEnabled ? (
            <span style={{ color: "var(--text-muted)" }}>加载摘要中...</span>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>文档尚未完成解析</span>
          )}
          {summary && doc.parse_status === "partial" && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              仍可点「预览」查看已成功解析的分块；未命中页可能为扫描页或版面复杂导致。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Library Detail Panel ─────────────────────────────────────────────────────

function LibraryDetailPanel({
  library,
  onBack,
}: {
  library: KnowledgeLibrary;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspaceStore();
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [showSearchTest, setShowSearchTest] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(library.name);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── TOC-driven ingest wizard state ────────────────────────────────────────
  type TocSectionState = {
    title: string; page_from: number; page_to: number;
    depth: number; chunk_type: ChunkType | "";
  };
  type WizardState =
    | { step: "idle" }
    | { step: "uploading" }
    | { step: "detecting_toc"; fileId: string; filename: string; fileExt: string }
    | { step: "toc_preview"; fileId: string; filename: string; fileExt: string;
        tocText: string; pageStart: number; pageEnd: number;
        /** 页码范围手动输入，用字符串便于清空后再输入（不使用 number 控件避免强留最小值） */
        customStart: string; customEnd: string; redetecting: boolean; redetectError: string }
    | { step: "select_llm"; fileId: string; filename: string; fileExt: string;
        tocText: string; llmProfileId: string; llmModelName: string }
    | { step: "analyzing_toc"; fileId: string; filename: string; fileExt: string;
        tocText: string }
    | { step: "section_confirm"; fileId: string; filename: string; fileExt: string;
        sections: TocSectionState[]; pageOffset: number; analyzeError: string }
    | { step: "ingesting" };

  const [wizard, setWizard] = useState<WizardState>({ step: "idle" });
  const [chmLlm, setChmLlm] = useState({ profileId: "", model: "" });
  const [chmClassifying, setChmClassifying] = useState(false);

  const { data: embeddingProfiles = [] } = useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: () => apiFetch<EmbeddingProfile[]>("/settings/embedding-profiles"),
  });
  const { data: llmProfilesForUpload = [] } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
  });
  const { data: fullLlmCatalog = [] } = useQuery({
    queryKey: ["model-catalog"],
    queryFn: () => apiFetch<ModelCatalogEntry[]>("/settings/model-catalog"),
  });
  const [selectedEmbeddingId, setSelectedEmbeddingId] = useState<string>("");

  // Probe models for whichever LLM profile is selected in the wizard's select_llm step
  const wizardLlmProfileId = wizard.step === "select_llm" ? wizard.llmProfileId : null;
  const { models: wizardProbedModels } = useModelList(wizardLlmProfileId);
  const wizardLlmProfile = llmProfilesForUpload.find((p) => p.id === wizardLlmProfileId);
  const chmSectionLlmId = wizard.step === "section_confirm" && wizard.fileExt.toLowerCase().endsWith("chm")
    ? chmLlm.profileId
    : null;
  const { models: chmProbedModels } = useModelList(chmSectionLlmId);
  const chmSectionLlmProfile = llmProfilesForUpload.find((p) => p.id === chmLlm.profileId);

  const wizardCatalog = useMemo(
    () => fullLlmCatalog.filter((c) => c.provider_type === wizardLlmProfile?.provider_type),
    [fullLlmCatalog, wizardLlmProfile?.provider_type],
  );
  const chmModelCatalog = useMemo(
    () => fullLlmCatalog.filter((c) => c.provider_type === chmSectionLlmProfile?.provider_type),
    [fullLlmCatalog, chmSectionLlmProfile?.provider_type],
  );

  const { data: documents = [] } = useQuery({
    queryKey: ["knowledge", "documents", library.id],
    queryFn: () => apiFetch<KnowledgeDocument[]>(`/knowledge/libraries/${library.id}/documents`),
    refetchInterval: uploadingTaskId ? 3000 : false,
  });

  useEffect(() => {
    if (wizard.step === "section_confirm" && wizard.fileExt.toLowerCase().endsWith("chm") && llmProfilesForUpload.length) {
      setChmLlm((prev) => (prev.profileId ? prev : { profileId: llmProfilesForUpload[0]!.id, model: "" }));
    }
  }, [wizard, llmProfilesForUpload]);

  const activeTask = useTaskProgress(uploadingTaskId);
  if (activeTask?.status === "completed" || activeTask?.status === "failed") {
    if (uploadingTaskId) {
      setTimeout(() => setUploadingTaskId(null), 2000);
    }
  }

  const deleteLibMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/knowledge/libraries/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "libraries"] });
      onBack();
    },
  });

  const renameLibMutation = useMutation({
    mutationFn: (name: string) => apiFetch(`/knowledge/libraries/${library.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "libraries"] });
      setIsRenaming(false);
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: (docId: string) => apiFetch(`/knowledge/documents/${docId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "documents", library.id] });
    },
  });

  // ── Wizard step functions ─────────────────────────────────────────────────

  async function startWizard(file: File) {
    setUploadError(null);
    setChmLlm({ profileId: "", model: "" });
    setChmClassifying(false);
    setWizard({ step: "uploading" });
    try {
      // Step 1: upload to preview endpoint
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch(`${BACKEND_URL}/knowledge/documents/upload-preview`, { method: "POST", body: form });
      if (!uploadRes.ok) {
        let detail = "上传失败";
        try { const b = await uploadRes.json(); detail = b?.detail ?? detail; } catch {}
        throw new Error(detail);
      }
      const { file_id, filename, file_ext } = await uploadRes.json();

      // Step 2: detect TOC
      setWizard({ step: "detecting_toc", fileId: file_id, filename, fileExt: file_ext });
      const detectRes = await apiFetch<{ toc_text: string; page_start: number; page_end: number; is_structural: boolean; sections?: TocSectionState[] }>(
        `/knowledge/documents/preview/${file_id}/detect-toc`,
        { method: "POST", body: JSON.stringify({}) },
      );

      if (detectRes.is_structural && detectRes.sections) {
        // CHM: skip toc_preview, go straight to section_confirm
        setWizard({
          step: "section_confirm",
          fileId: file_id, filename, fileExt: file_ext,
          sections: detectRes.sections.map((s) => ({ ...s, chunk_type: s.chunk_type ?? "" })),
          pageOffset: 0,
          analyzeError: "",
        });
      } else {
        setWizard({
          step: "toc_preview",
          fileId: file_id, filename, fileExt: file_ext,
          tocText: detectRes.toc_text,
          pageStart: detectRes.page_start,
          pageEnd: detectRes.page_end,
          customStart: String(detectRes.page_start),
          customEnd: String(detectRes.page_end),
          redetecting: false,
          redetectError: "",
        });
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
      setWizard({ step: "idle" });
    }
  }

  async function redetectToc(fileId: string, filename: string, fileExt: string, start: number, end: number) {
    setWizard((prev) => prev.step === "toc_preview" ? { ...prev, redetecting: true, redetectError: "" } : prev);
    try {
      const res = await apiFetch<{ toc_text: string; page_start: number; page_end: number }>(
        `/knowledge/documents/preview/${fileId}/detect-toc`,
        { method: "POST", body: JSON.stringify({ toc_page_start: start, toc_page_end: end }) },
      );
      setWizard({
        step: "toc_preview",
        fileId, filename, fileExt,
        tocText: res.toc_text,
        pageStart: res.page_start,
        pageEnd: res.page_end,
        customStart: String(start),
        customEnd: String(end),
        redetecting: false,
        redetectError: "",
      });
    } catch (e) {
      setWizard((prev) => prev.step === "toc_preview"
        ? { ...prev, redetecting: false, redetectError: e instanceof Error ? e.message : String(e) }
        : prev);
    }
  }

  async function analyzeToc(fileId: string, filename: string, fileExt: string, tocText: string, llmProfileId: string, llmModelName: string) {
    setWizard({ step: "analyzing_toc", fileId, filename, fileExt, tocText });
    try {
      const res = await apiPostSSE<{ sections: TocSectionState[] }>(
        `/knowledge/documents/preview/${fileId}/analyze-toc`,
        { toc_text: tocText, llm_profile_id: llmProfileId, llm_model_name: llmModelName || undefined },
      );
      setWizard({
        step: "section_confirm",
        fileId, filename, fileExt,
        sections: res.sections.map((s) => {
          const raw = s as unknown as Record<string, unknown>;
          const ct = (raw.suggested_chunk_type ?? raw.chunk_type ?? "") as ChunkType | "";
          return { title: String(raw.title ?? ""), page_from: Number(raw.page_from ?? 0), page_to: Number(raw.page_to ?? 0), depth: Number(raw.depth ?? 1), chunk_type: ct };
        }),
        pageOffset: 0,
        analyzeError: "",
      });
    } catch (e) {
      setWizard({
        step: "section_confirm",
        fileId, filename, fileExt,
        sections: [],
        pageOffset: 0,
        analyzeError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function classifyChmToc(fileId: string) {
    if (wizard.step !== "section_confirm") return;
    const w = wizard;
    const profileId = chmLlm.profileId || llmProfilesForUpload[0]?.id;
    if (!profileId) {
      setUploadError("请先在模型配置中添加 LLM 模型");
      return;
    }
    setChmClassifying(true);
    setUploadError(null);
    try {
      const res = await apiPostSSE<{ sections: TocSectionState[] }>(
        `/knowledge/documents/preview/${fileId}/classify-chm-sections`,
        { llm_profile_id: profileId, llm_model_name: chmLlm.model || undefined },
      );
      const rows = (res as { sections?: unknown[] }).sections ?? [];
      setWizard({
        step: "section_confirm",
        fileId: w.fileId,
        filename: w.filename,
        fileExt: w.fileExt,
        sections: rows.map((s) => {
          const r = s as Record<string, unknown>;
          const rawCt = (r.suggested_chunk_type ?? r.chunk_type ?? "") as string;
          const ct = rawCt && CHUNK_TYPES.some((c) => c.value === rawCt) ? (rawCt as ChunkType) : ("" as const);
          return {
            title: String(r.title ?? ""),
            page_from: Number(r.page_from ?? 0),
            page_to: Number(r.page_to ?? 0),
            depth: Number(r.depth ?? 1),
            chunk_type: ct,
          };
        }),
        pageOffset: w.pageOffset,
        analyzeError: "",
      });
    } catch (e) {
      setWizard({ ...w, analyzeError: e instanceof Error ? e.message : String(e) });
    } finally {
      setChmClassifying(false);
    }
  }

  async function startIngest(fileId: string, sections: TocSectionState[], pageOffset: number) {
    const profileId = selectedEmbeddingId || embeddingProfiles[0]?.id;
    if (!profileId) {
      setUploadError("请先在模型配置中添加 Embedding 模型");
      return;
    }
    setWizard({ step: "ingesting" });
    try {
      const res = await apiFetch<{ document_id: string; task_id: string }>(
        `/knowledge/libraries/${library.id}/documents/ingest-confirmed`,
        {
          method: "POST",
          body: JSON.stringify({
            file_id: fileId,
            embedding_profile_id: profileId,
            page_offset: pageOffset,
            toc_mapping: sections.map((s) => ({
              title: s.title,
              page_from: s.page_from,
              page_to: s.page_to,
              chunk_type: s.chunk_type ? String(s.chunk_type) : "",
            })),
          }),
        },
      );
      setUploadingTaskId(res.task_id);
      queryClient.invalidateQueries({ queryKey: ["knowledge", "documents", library.id] });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setWizard({ step: "idle" });
    }
  }

  function toggleDocExpand(docId: string) {
    setExpandedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId); else next.add(docId);
      return next;
    });
  }

  const previewDoc = documents.find((d) => d.id === previewDocId) ?? null;

  return (
    <>
      <div className={styles.detailHeader}>
        <div>
          <button className={styles.btnGhost} onClick={onBack} style={{ marginBottom: 8 }}>
            ← 返回知识库列表
          </button>
          <h2 className={styles.detailName} style={{ fontSize: 16 }}>
            <Library size={15} />
            {isRenaming ? (
              <>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renameValue.trim()) renameLibMutation.mutate(renameValue.trim());
                    if (e.key === "Escape") { setIsRenaming(false); setRenameValue(library.name); }
                  }}
                  style={{ fontSize: 15, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", marginLeft: 6 }}
                />
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px", color: "var(--text-muted)" }}
                  onClick={() => { if (renameValue.trim()) renameLibMutation.mutate(renameValue.trim()); }}
                  title="确认"
                ><Check size={14} /></button>
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px", color: "var(--text-muted)" }}
                  onClick={() => { setIsRenaming(false); setRenameValue(library.name); }}
                  title="取消"
                ><X size={14} /></button>
              </>
            ) : (
              <>
                {library.name}
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px", color: "var(--text-muted)", marginLeft: 4 }}
                  onClick={() => { setRenameValue(library.name); setIsRenaming(true); }}
                  title="重命名"
                ><Pencil size={12} /></button>
              </>
            )}
          </h2>
          {library.description && <p className={styles.detailDesc}>{library.description}</p>}
        </div>
        <div className={styles.detailActions}>
          <button className={styles.btnSecondary} onClick={() => setShowSearchTest(true)}>
            <Search size={14} /> 检索测试
          </button>
          <button
            className={styles.btnDanger}
            onClick={() => { if (confirm(`确认删除「${library.name}」？`)) deleteLibMutation.mutate(library.id); }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Embedding profile selector (show only if multiple profiles) */}
      {embeddingProfiles.length > 1 && (
        <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>Embedding 模型：</span>
          <select
            style={{ flex: 1, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}
            value={selectedEmbeddingId || embeddingProfiles[0]?.id}
            onChange={(e) => setSelectedEmbeddingId(e.target.value)}
          >
            {embeddingProfiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>
            ))}
          </select>
        </div>
      )}

      {/* Upload area */}
      {(() => {
        const wizardActive = wizard.step !== "idle";
        const uploadDisabled = wizardActive || !!uploadingTaskId || documents.length > 0;
        const overlayMsg = wizardActive ? null : uploadingTaskId ? "处理中，请稍候..." : documents.length > 0 ? "已有文档，请先点击文档右侧删除按钮删除后再上传" : null;
        return (
          <div
            className={styles.dropzone}
            style={uploadDisabled ? { opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" } : undefined}
            onClick={() => !uploadDisabled && fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (uploadDisabled) return;
              const file = e.dataTransfer.files[0];
              if (file) startWizard(file);
            }}
          >
            <Upload size={20} color="var(--text-muted)" />
            <span>{overlayMsg ?? "拖拽 PDF / CHM 到此处，或点击选择文件"}</span>
            <input
              ref={fileInputRef} type="file" accept=".pdf,.chm" style={{ display: "none" }}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) startWizard(file); e.target.value = ""; }}
            />
          </div>
        );
      })()}

      {/* TOC-driven import wizard modal */}
      {wizard.step !== "idle" && wizard.step !== "ingesting" && (
        <div className={styles.overlay} onClick={() => setWizard({ step: "idle" })}>
          <div className={styles.modal} style={{ width: 560, maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 className={styles.modalTitle} style={{ margin: 0 }}>
                {wizard.step === "uploading" && "上传文件"}
                {wizard.step === "detecting_toc" && "检测目录页"}
                {wizard.step === "toc_preview" && "确认目录页范围"}
                {wizard.step === "select_llm" && "选择分析模型"}
                {wizard.step === "analyzing_toc" && "AI 分析目录"}
                {wizard.step === "section_confirm" && "章节分类确认"}
              </h2>
              <button onClick={() => setWizard({ step: "idle" })} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={16} /></button>
            </div>

            {/* File info row (shown for most steps) */}
            {"filename" in wizard && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 14 }}>
                <FileText size={15} color="var(--text-muted)" />
                <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wizard.filename}</span>
              </div>
            )}

            {/* uploading / detecting_toc / analyzing_toc / chm classifying: spinner */}
            {(wizard.step === "uploading" || wizard.step === "detecting_toc" || wizard.step === "analyzing_toc" || (chmClassifying && wizard.step === "section_confirm")) && (
              <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                <div style={{ marginBottom: 10, fontSize: 20 }}>⏳</div>
                {wizard.step === "uploading" && "正在上传文件..."}
                {wizard.step === "detecting_toc" && "正在自动检测目录页..."}
                {wizard.step === "analyzing_toc" && "AI 正在解析目录结构，请稍候..."}
                {chmClassifying && wizard.step === "section_confirm" && "CHM：AI 正在为浅层目录建议内容类型，大文件可能需数分钟…"}
              </div>
            )}

            {/* toc_preview */}
            {wizard.step === "toc_preview" && (() => {
              const w = wizard;
              return (
                <>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                    检测到目录在第 {w.pageStart}–{w.pageEnd} 页。如果不对，可手动调整后重新扫描。
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>页码范围：</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label="目录起始页"
                      value={w.customStart}
                      onChange={(e) => setWizard({ ...w, customStart: e.target.value.replace(/[^\d]/g, "") })}
                      placeholder="起始"
                      style={{ width: 72, fontSize: 13, padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
                    />
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label="目录结束页"
                      value={w.customEnd}
                      onChange={(e) => setWizard({ ...w, customEnd: e.target.value.replace(/[^\d]/g, "") })}
                      placeholder="结束"
                      style={{ width: 72, fontSize: 13, padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
                    />
                    <button className={styles.btnSecondary} disabled={w.redetecting}
                      onClick={() => {
                        const a = parseInt(w.customStart.trim(), 10);
                        const b = parseInt(w.customEnd.trim(), 10);
                        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1) {
                          setWizard({ ...w, redetectError: "请填写有效的起止页码（正整数）" });
                          return;
                        }
                        if (a > b) {
                          setWizard({ ...w, redetectError: "起始页不能大于结束页" });
                          return;
                        }
                        void redetectToc(w.fileId, w.filename, w.fileExt, a, b);
                      }}
                      style={{ fontSize: 12, padding: "4px 10px" }}>
                      {w.redetecting ? "扫描中..." : "重新扫描"}
                    </button>
                  </div>
                  {w.redetectError && (
                    <div style={{ marginBottom: 8, padding: "5px 8px", borderRadius: 4, background: "#2a0a0a", color: "#e05252", fontSize: 12 }}>{w.redetectError}</div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>目录原文预览：</label>
                    <pre style={{ maxHeight: 200, overflow: "auto", fontSize: 11, lineHeight: 1.6, padding: "8px 10px", borderRadius: 5, background: "var(--bg)", border: "1px solid var(--border)", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                      {w.tocText || "（未检测到目录文字）"}
                    </pre>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button className={styles.btnSecondary} onClick={() => setWizard({ step: "idle" })}>取消</button>
                    <button className={styles.btnPrimary} disabled={!w.tocText}
                      onClick={() => {
                        if (!llmProfilesForUpload.length) { setUploadError("请先在模型配置中添加 LLM 模型"); return; }
                        setWizard({
                          step: "select_llm",
                          fileId: w.fileId, filename: w.filename, fileExt: w.fileExt,
                          tocText: w.tocText,
                          llmProfileId: llmProfilesForUpload[0].id,
                          llmModelName: "",
                        });
                      }}>
                      用 AI 分析目录 →
                    </button>
                  </div>
                </>
              );
            })()}

            {/* select_llm */}
            {wizard.step === "select_llm" && (() => {
              const w = wizard;
              const modelOk = w.llmModelName.trim().length > 0;
              return (
                <>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.6 }}>
                    用 LLM 将目录解析为章节结构。
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, color: "var(--text)", display: "block", marginBottom: 4, fontWeight: 600 }}>LLM 供应商 *</label>
                    <select
                      style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
                      value={w.llmProfileId}
                      onChange={(e) => setWizard({ ...w, llmProfileId: e.target.value, llmModelName: "" })}
                    >
                      {llmProfilesForUpload.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.provider_type})</option>
                      ))}
                    </select>
                  </div>
                  <div
                    style={{
                      marginBottom: 16,
                      padding: "12px 12px 14px",
                      borderRadius: 8,
                      border: "1px solid rgba(124,106,247,0.45)",
                      background: "rgba(124,106,247,0.06)",
                    }}
                  >
                    <label style={{ fontSize: 12, color: "var(--text)", display: "block", marginBottom: 6, fontWeight: 600 }}>
                      分析用模型 <span style={{ color: "var(--error, #e05252)" }}>*</span>
                    </label>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 8px", lineHeight: 1.5 }}>
                      必填，请从下拉选择或输入模型。
                    </p>
                    <ModelNameInput
                      className={styles.input}
                      catalog="llm"
                      providerType={wizardLlmProfile?.provider_type ?? ""}
                      value={w.llmModelName}
                      onChange={(v) => setWizard({ ...w, llmModelName: v })}
                      catalogEntries={wizardCatalog}
                      fetchedModels={wizardProbedModels}
                      requireJsonMode
                      placeholder="选择或输入模型 id（必填）"
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button className={styles.btnSecondary}
                      onClick={() => setWizard({
                        step: "toc_preview",
                        fileId: w.fileId, filename: w.filename, fileExt: w.fileExt, tocText: w.tocText,
                        pageStart: 1, pageEnd: 1, customStart: "1", customEnd: "1", redetecting: false, redetectError: "",
                      })}>
                      ← 返回
                    </button>
                    <button
                      className={styles.btnPrimary}
                      disabled={!w.llmProfileId || !modelOk}
                      onClick={() => analyzeToc(w.fileId, w.filename, w.fileExt, w.tocText, w.llmProfileId, w.llmModelName.trim())}
                    >
                      开始分析
                    </button>
                  </div>
                </>
              );
            })()}

            {/* section_confirm */}
            {wizard.step === "section_confirm" && !chmClassifying && (() => {
              const w = wizard;
              const isPdf = w.fileExt.toLowerCase() === "pdf";
              const isChm = w.fileExt.toLowerCase().endsWith("chm");
              return (
                <>
                  {w.analyzeError && (
                    <div style={{ marginBottom: 10, padding: "6px 10px", borderRadius: 4, background: "#2a0a0a", color: "#e05252", fontSize: 12 }}>
                      {w.analyzeError}
                    </div>
                  )}
                  {isChm && (
                    <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)" }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, marginBottom: 10 }}>
                        CHM 已内嵌完整目录，因此不会走「抽目录页 → AI 重解析」流程。你仍可用下方让 AI
                        为<strong>浅层</strong>目录项（默认 depth≤2，约一两百项）建议「内容类型」；更深层会按目录树
                        继承。不会合并或删减章节，仅填写类型。
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <select
                          value={chmLlm.profileId}
                          onChange={(e) => setChmLlm({ ...chmLlm, profileId: e.target.value })}
                          style={{ fontSize: 13, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", minWidth: 180 }}
                        >
                          {llmProfilesForUpload.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} ({p.provider_type})</option>
                          ))}
                        </select>
                        <ModelNameInput
                          catalog="llm"
                          providerType={chmSectionLlmProfile?.provider_type ?? ""}
                          value={chmLlm.model}
                          onChange={(v) => setChmLlm({ ...chmLlm, model: v })}
                          catalogEntries={chmModelCatalog}
                          fetchedModels={chmProbedModels}
                          requireJsonMode
                          placeholder="模型（可留空）"
                        />
                        <button
                          type="button"
                          className={styles.btnPrimary}
                          disabled={!chmLlm.profileId}
                          onClick={() => classifyChmToc(w.fileId)}
                          style={{ fontSize: 12, padding: "5px 12px" }}
                        >
                          AI 建议各节内容类型
                        </button>
                      </div>
                    </div>
                  )}
                  {w.sections.length === 0 && !w.analyzeError && (
                    <div style={{ marginBottom: 10, color: "var(--text-muted)", fontSize: 13 }}>未检测到章节，将按默认方式切块。</div>
                  )}
                  {w.sections.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>章节列表（共 {w.sections.length} 个）：</label>
                      <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid var(--border)", borderRadius: 5 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                              <th style={{ padding: "5px 8px", textAlign: "left", color: "var(--text-muted)", fontWeight: 500 }}>章节标题</th>
                              <th style={{ padding: "5px 8px", textAlign: "center", color: "var(--text-muted)", fontWeight: 500, whiteSpace: "nowrap" }}>页码</th>
                              <th style={{ padding: "5px 8px", textAlign: "left", color: "var(--text-muted)", fontWeight: 500 }}>内容类型</th>
                            </tr>
                          </thead>
                          <tbody>
                            {w.sections.map((s, i) => (
                              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "5px 8px", paddingLeft: `${8 + (s.depth ?? 0) * 12}px` }}>{s.title}</td>
                                <td style={{ padding: "5px 8px", textAlign: "center", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                                  {s.page_from}{s.page_to && s.page_to !== s.page_from ? `–${s.page_to}` : ""}
                                </td>
                                <td style={{ padding: "5px 4px" }}>
                                  <select
                                    style={{ fontSize: 12, padding: "2px 4px", borderRadius: 3, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", width: "100%" }}
                                    value={s.chunk_type}
                                    onChange={(e) => {
                                      const updated = [...w.sections];
                                      updated[i] = { ...s, chunk_type: e.target.value as ChunkType | "" };
                                      setWizard({ ...w, sections: updated });
                                    }}
                                  >
                                    <option value="">— 混合</option>
                                    {CHUNK_TYPES.map((ct) => (
                                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {isPdf && (
                    <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
                      <label style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>页码偏移：</label>
                      <input
                        type="number" min={0}
                        value={w.pageOffset}
                        onChange={(e) => setWizard({ ...w, pageOffset: Math.max(0, parseInt(e.target.value) || 0) })}
                        style={{ width: 72, fontSize: 13, padding: "5px 7px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
                      />
                      <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        正文从 PDF 第 N 页开始 → 填 N−1
                      </span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button className={styles.btnSecondary} onClick={() => setWizard({ step: "idle" })}>取消</button>
                    <button className={styles.btnPrimary}
                      onClick={() => startIngest(w.fileId, w.sections, w.pageOffset)}>
                      开始导入
                    </button>
                  </div>
                </>
              );
            })()}

          </div>
        </div>
      )}

      {uploadError && (
        <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 4, background: "#2a0a0a", color: "#e05252", fontSize: 12 }}>
          {uploadError}
        </div>
      )}

      {activeTask && (activeTask.status === "running" || activeTask.status === "pending") && (
        <div className={styles.progressBox}>
          <div className={styles.progressHeader}>
            <span>{activeTask.step_label ?? "准备中..."}</span>
            <span>{activeTask.current_step} / {activeTask.total_steps}</span>
          </div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${(activeTask.current_step / activeTask.total_steps) * 100}%` }} />
          </div>
        </div>
      )}
      {activeTask?.status === "failed" && (
        <div className={styles.errorBox}>{activeTask.error_message ?? "处理失败"}</div>
      )}

      {/* Document list */}
      <div className={styles.docList}>
        <p className={styles.sectionLabel} style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          文档列表（{documents.length} 篇）
        </p>
        {documents.length === 0 && <p className={styles.empty}>还没有上传文档</p>}
        {documents.map((doc) => (
          <DocumentRow
            key={doc.id} doc={doc}
            expanded={expandedDocIds.has(doc.id)}
            onToggle={() => toggleDocExpand(doc.id)}
            onPreview={() => setPreviewDocId(previewDocId === doc.id ? null : doc.id)}
            isPreviewing={previewDocId === doc.id}
            onDelete={() => deleteDocMutation.mutate(doc.id)}
          />
        ))}
      </div>

      {/* Document Preview Panel */}
      {previewDocId && previewDoc && (
        <DocumentPreviewPanel docId={previewDocId} filename={previewDoc.filename} onClose={() => setPreviewDocId(null)} />
      )}

      {/* Search Test Dialog */}
      {showSearchTest && (
        <SearchTestDialog libraryId={library.id} workspaceId={activeWorkspaceId} onClose={() => setShowSearchTest(false)} />
      )}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function RuleSetPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");


  // Edit modal
  const [editTarget, setEditTarget] = useState<RuleSet | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<RuleSet | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Library/prompt modals
  const [showCreateLib, setShowCreateLib] = useState(false);
  const [showSetPrompt, setShowSetPrompt] = useState(false);
  const [promptModalMode, setPromptModalMode] = useState<"select" | "manual" | "ai">("select");

  // Inline prompt editing
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptEditName, setPromptEditName] = useState("");
  const [promptEditNotes, setPromptEditNotes] = useState("");
  const [promptEditBody, setPromptEditBody] = useState("");

  // Library detail drill-down
  const [activeLibId, setActiveLibId] = useState<string | null>(null);

  // Custom asset type state (A5)
  const [showNewTypeForm, setShowNewTypeForm] = useState(false);
  const [newTypeKey, setNewTypeKey] = useState("");
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [newTypeIcon, setNewTypeIcon] = useState("");
  const [newTypeError, setNewTypeError] = useState<string | null>(null);

  const { data: ruleSets = [], isLoading } = useQuery({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  const selectedRuleSet = ruleSets.find((r) => r.id === selectedId) ?? null;

  const { data: libraries = [] } = useQuery({
    queryKey: ["knowledge", "libraries", { rule_set_id: selectedId }],
    queryFn: () => apiFetch<KnowledgeLibrary[]>(`/knowledge/libraries?rule_set_id=${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ["prompt-profiles", selectedId],
    queryFn: () => apiFetch<PromptProfile[]>(`/prompt-profiles?rule_set_id=${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: embeddingProfiles = [] } = useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: () => apiFetch<EmbeddingProfile[]>("/settings/embedding-profiles"),
  });
  const hasEmbedding = embeddingProfiles.length > 0;

  const currentPrompt = selectedId && selectedRuleSet
    ? allProfiles.find((p) => p.id === selectedRuleSet.default_prompt_profile_id)
      ?? allProfiles[0]  // fall back to first if no explicit default set yet
      ?? null
    : null;

  const activeLib = libraries.find((l) => l.id === activeLibId) ?? null;

  const createMutation = useMutation({
    mutationFn: (body: CreateRuleSetRequest) =>
      apiFetch<RuleSet>("/rule-sets", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (rs) => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      setShowCreate(false);
      setNewName(""); setNewDesc("");
      setSelectedId(rs.id);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRuleSetRequest }) =>
      apiFetch<RuleSet>(`/rule-sets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      setEditTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/rule-sets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      setDeleteTarget(null);
      setDeleteError(null);
      setSelectedId(null);
    },
    onError: async (err: unknown) => {
      const msg = (err as Error).message ?? "";
      setDeleteError(msg);
    },
  });

  const deleteLibMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/knowledge/libraries/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "libraries"] });
    },
  });

  const updatePromptMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; system_prompt?: string; style_notes?: string }) =>
      apiFetch<PromptProfile>(`/prompt-profiles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles", selectedId] });
      setEditingPrompt(false);
    },
  });

  const setDefaultPromptMutation = useMutation({
    mutationFn: (promptProfileId: string | null) =>
      apiFetch<RuleSet>(`/rule-sets/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ default_prompt_profile_id: promptProfileId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
    },
  });

  const deletePromptMutation = useMutation({
    mutationFn: (promptProfileId: string) =>
      apiFetch(`/prompt-profiles/${promptProfileId}`, { method: "DELETE" }),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles", selectedId] });
      // If the deleted profile was the default, clear the default reference
      if (selectedRuleSet?.default_prompt_profile_id === deletedId) {
        setDefaultPromptMutation.mutate(null);
      }
    },
  });

  // Custom asset type mutations (A5)
  const { data: customAssetTypes = [] } = useCustomAssetTypes(selectedId);

  const createTypeMutation = useMutation({
    mutationFn: (body: CreateCustomAssetTypeRequest) =>
      apiFetch<CustomAssetTypeConfig>(`/rule-sets/${selectedId}/asset-type-configs`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-asset-types", selectedId] });
      setShowNewTypeForm(false);
      setNewTypeKey(""); setNewTypeLabel(""); setNewTypeIcon(""); setNewTypeError(null);
    },
    onError: (err: unknown) => {
      setNewTypeError((err as Error).message ?? "创建失败");
    },
  });

  const deleteTypeMutation = useMutation({
    mutationFn: (configId: string) =>
      apiFetch(`/rule-sets/${selectedId}/asset-type-configs/${configId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-asset-types", selectedId] });
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const slug = newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 60) + "-" + Date.now();
    createMutation.mutate({ name: newName.trim(), slug, description: newDesc.trim() || undefined });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget || !editName.trim()) return;
    updateMutation.mutate({ id: editTarget.id, body: { name: editName.trim(), description: editDesc.trim() || undefined } });
  }

  // Reset library detail when switching rule sets
  function selectRuleSet(id: string) {
    setSelectedId(id);
    setActiveLibId(null);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/")}>← 返回</button>
        <h1 className={styles.title}>
          <BookOpen size={16} />
          规则集管理
        </h1>
        <HelpButton doc="rule-set-management" />
        <button className={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          <Plus size={14} /> 新建规则集
        </button>
      </header>

      <div className={styles.layout}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <p className={styles.sidebarTitle}>规则集列表</p>
          {isLoading && <p className={styles.empty} style={{ padding: "0 16px" }}>加载中...</p>}
          {ruleSets.map((rs) => (
            <button
              key={rs.id}
              className={`${styles.rsItem} ${rs.id === selectedId ? styles.rsItemActive : ""}`}
              onClick={() => selectRuleSet(rs.id)}
            >
              <span className={styles.rsName}>{rs.name}</span>
            </button>
          ))}
        </aside>

        {/* Detail */}
        <main className={styles.detail}>
          {!selectedRuleSet ? (
            <div className={styles.placeholder}>
              <BookOpen size={40} color="var(--border)" />
              <p>选择左侧规则集查看详情</p>
            </div>
          ) : activeLib ? (
            /* Library detail drill-down */
            <LibraryDetailPanel
              library={activeLib}
              onBack={() => setActiveLibId(null)}
            />
          ) : (
            <>
              {/* Rule set header */}
              <div className={styles.detailHeader}>
                <div>
                  <div className={styles.detailName}>
                    {selectedRuleSet.name}
                  </div>
                  {selectedRuleSet.description && <p className={styles.detailDesc}>{selectedRuleSet.description}</p>}
                </div>
                <div className={styles.detailActions}>
                  <>
                    <button
                      className={styles.btnSecondary}
                      onClick={() => { setEditTarget(selectedRuleSet); setEditName(selectedRuleSet.name); setEditDesc(selectedRuleSet.description ?? ""); }}
                    >
                      <Edit2 size={13} /> 编辑
                    </button>
                    <button
                      className={styles.btnDanger}
                      onClick={() => { setDeleteTarget(selectedRuleSet); setDeleteError(null); }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                </div>
              </div>

              {/* Prompt section */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionLabel}><MessageSquare size={12} /> 创作风格提示词</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {allProfiles.length > 0 && (
                      <button
                        className={styles.btnSecondary}
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => { setPromptModalMode("select"); setShowSetPrompt(true); }}
                      >
                        设为默认
                      </button>
                    )}
                    <button
                      className={styles.btnSecondary}
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      onClick={() => { setPromptModalMode("manual"); setShowSetPrompt(true); }}
                    >
                      <Plus size={12} /> 新建
                    </button>
                  </div>
                </div>
                {currentPrompt ? (
                  <div className={styles.promptCard}>
                    {editingPrompt ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                          名称 *
                          <input
                            className={styles.input}
                            value={promptEditName}
                            onChange={(e) => setPromptEditName(e.target.value)}
                            placeholder="名称"
                            style={{ fontWeight: 600 }}
                          />
                        </label>
                        <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                          风格摘要（选填）
                          <input
                            className={styles.input}
                            value={promptEditNotes}
                            onChange={(e) => setPromptEditNotes(e.target.value)}
                            placeholder="风格摘要（选填）"
                          />
                        </label>
                        <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                          System Prompt *
                          <textarea
                            className={styles.textarea}
                            value={promptEditBody}
                            onChange={(e) => setPromptEditBody(e.target.value)}
                            rows={8}
                            style={{ fontFamily: "monospace", fontSize: 12 }}
                            placeholder="System Prompt..."
                          />
                        </label>
                        {updatePromptMutation.isError && (
                          <p className={styles.error}>{(updatePromptMutation.error as Error).message}</p>
                        )}
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button className={styles.btnSecondary} onClick={() => setEditingPrompt(false)}>取消</button>
                          <button
                            className={styles.btnPrimary}
                            disabled={!promptEditName.trim() || !promptEditBody.trim() || updatePromptMutation.isPending}
                            onClick={() => updatePromptMutation.mutate({ id: currentPrompt.id, name: promptEditName.trim(), system_prompt: promptEditBody.trim(), style_notes: promptEditNotes.trim() || undefined })}
                          >
                            {updatePromptMutation.isPending ? "保存中..." : "保存"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <div className={styles.promptName} style={{ flex: 1 }}>{currentPrompt.name}</div>
                          <button
                            className={styles.btnGhost}
                            style={{ padding: "2px 6px", fontSize: 12 }}
                            title="编辑提示词"
                            onClick={() => {
                              setPromptEditName(currentPrompt.name);
                              setPromptEditNotes(currentPrompt.style_notes ?? "");
                              setPromptEditBody(currentPrompt.system_prompt);
                              setEditingPrompt(true);
                              setPromptExpanded(false);
                            }}
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            className={styles.btnGhost}
                            style={{ padding: "2px 6px", fontSize: 12, color: "var(--danger, #e05252)" }}
                            title="删除提示词"
                            onClick={() => deletePromptMutation.mutate(currentPrompt.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {currentPrompt.style_notes && (
                          <div className={styles.promptNotes}>{currentPrompt.style_notes.slice(0, 200)}{currentPrompt.style_notes.length > 200 ? "..." : ""}</div>
                        )}
                        <button
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "4px 0", display: "flex", alignItems: "center", gap: 4 }}
                          onClick={() => setPromptExpanded((v) => !v)}
                        >
                          {promptExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {promptExpanded ? "收起 System Prompt" : "查看 System Prompt"}
                        </button>
                        {promptExpanded && (
                          <pre style={{
                            margin: "4px 0 0", padding: 10,
                            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4,
                            fontSize: 11, whiteSpace: "pre-wrap", color: "var(--text)",
                            maxHeight: 300, overflowY: "auto",
                          }}>
                            {currentPrompt.system_prompt}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <p className={styles.empty}>暂未指定提示词——Agent 将使用默认创作风格</p>
                )}
              </div>

              {/* Knowledge libraries section */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionLabel}><Library size={12} /> 知识库（{libraries.length}）</span>
                  <button
                    className={styles.btnSecondary}
                    style={{ fontSize: 12, padding: "4px 10px", opacity: hasEmbedding ? 1 : 0.5 }}
                    onClick={() => hasEmbedding && setShowCreateLib(true)}
                    disabled={!hasEmbedding}
                    title={hasEmbedding ? undefined : "请先在模型配置中添加 Embedding 模型"}
                  >
                    <Plus size={12} /> 新建知识库
                  </button>
                </div>
                {!hasEmbedding && (
                  <p style={{ fontSize: 12, color: "var(--warning, #e8a838)", margin: "4px 0 8px", display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertTriangle size={12} /> 需要先配置 Embedding 模型才能创建知识库
                  </p>
                )}
                {libraries.length === 0 ? (
                  <p className={styles.empty}>暂无知识库——点击「新建知识库」导入规则书 PDF</p>
                ) : (
                  libraries.map((lib) => (
                    <div key={lib.id} className={styles.bindingItem}>
                      <Library size={14} color="var(--text-muted)" />
                      <span
                        className={styles.bindingName}
                        style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: "var(--border)" }}
                        onClick={() => setActiveLibId(lib.id)}
                      >
                        {lib.name}
                      </span>

                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {lib.document_count} 篇
                      </span>
                      <button
                        className={styles.btnGhost}
                        onClick={() => {
                          if (confirm(`确认删除知识库「${lib.name}」？`)) deleteLibMutation.mutate(lib.id);
                        }}
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Asset Types section (A5) */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionLabel}><Tag size={12} /> 资产类型（{BUILTIN_ASSET_TYPES.length + customAssetTypes.length}）</span>
                  <button
                    className={styles.btnSecondary}
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => { setShowNewTypeForm((v) => !v); setNewTypeError(null); }}
                  >
                    <Plus size={12} /> 添加类型
                  </button>
                </div>

                {/* New type form */}
                {showNewTypeForm && (
                  <div className={styles.promptCard} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          className={styles.input}
                          placeholder="类型键（英文，如 spell）"
                          value={newTypeKey}
                          onChange={(e) => setNewTypeKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                          style={{ flex: 2 }}
                        />
                        <input
                          className={styles.input}
                          placeholder="显示名称（如 法术）"
                          value={newTypeLabel}
                          onChange={(e) => setNewTypeLabel(e.target.value)}
                          style={{ flex: 2 }}
                        />
                        <input
                          className={styles.input}
                          placeholder="图标（emoji）"
                          value={newTypeIcon}
                          onChange={(e) => setNewTypeIcon(e.target.value)}
                          style={{ flex: 1, textAlign: "center", fontSize: 16 }}
                          maxLength={4}
                        />
                      </div>
                      {newTypeError && (
                        <p className={styles.error} style={{ margin: 0 }}>{newTypeError}</p>
                      )}
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className={styles.btnPrimary}
                          style={{ flex: 1, fontSize: 12 }}
                          disabled={!newTypeKey || !newTypeLabel || !newTypeIcon || createTypeMutation.isPending}
                          onClick={() => createTypeMutation.mutate({ type_key: newTypeKey, label: newTypeLabel, icon: newTypeIcon })}
                        >
                          {createTypeMutation.isPending ? "创建中..." : "创建"}
                        </button>
                        <button
                          className={styles.btnSecondary}
                          style={{ flex: 1, fontSize: 12 }}
                          onClick={() => { setShowNewTypeForm(false); setNewTypeError(null); }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Builtin types (read-only) */}
                <p style={{ fontSize: 11, color: "var(--text-subtle, var(--text-muted))", margin: "6px 0 4px", opacity: 0.7 }}>内置类型</p>
                {BUILTIN_ASSET_TYPES.map((typeKey) => {
                  const Icon = getAssetTypeIcon(typeKey);
                  const color = getAssetTypeColor(typeKey);
                  const label = getAssetTypeLabel(typeKey);
                  return (
                    <div key={typeKey} className={styles.bindingItem} style={{ opacity: 0.75 }}>
                      <Icon size={14} color={color} />
                      <span className={styles.bindingName}>{label}</span>
                      <span className={styles.bindingType} style={{ fontFamily: "monospace", fontSize: 11 }}>{typeKey}</span>
                    </div>
                  );
                })}

                {/* Custom types */}
                {customAssetTypes.length > 0 && (
                  <p style={{ fontSize: 11, color: "var(--text-subtle, var(--text-muted))", margin: "10px 0 4px", opacity: 0.7 }}>自定义类型</p>
                )}
                {customAssetTypes.length === 0 && (
                  <p className={styles.empty} style={{ marginTop: 8 }}>
                    暂无自定义类型——点击「添加类型」注册新的资产种类（如 spell、item、handout）
                  </p>
                )}
                {customAssetTypes.map((ct) => (
                    <div key={ct.id} className={styles.bindingItem}>
                      <span style={{ fontSize: 16 }}>{ct.icon}</span>
                      <span className={styles.bindingName}>{ct.label}</span>
                      <span className={styles.bindingType} style={{ fontFamily: "monospace", fontSize: 11 }}>
                        {ct.type_key}
                      </span>
                      <button
                        className={styles.btnGhost}
                        onClick={() => {
                          if (confirm(`确认删除类型「${ct.label}」？已有此类型的资产不受影响。`)) {
                            deleteTypeMutation.mutate(ct.id);
                          }
                        }}
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Create rule set modal */}
      {showCreate && (
        <div className={styles.overlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>新建规则集</h2>
            <form onSubmit={handleCreate} className={styles.form}>
              <label className={styles.label}>
                名称 *
                <input className={styles.input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例：我的奇幻世界" autoFocus />
              </label>
              <label className={styles.label}>
                描述
                <textarea className={styles.textarea} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} placeholder="可选" />
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowCreate(false)}>取消</button>
                <button type="submit" className={styles.btnPrimary} disabled={!newName.trim() || createMutation.isPending}>
                  {createMutation.isPending ? "创建中..." : "创建"}
                </button>
              </div>
              {createMutation.isError && <p className={styles.error}>{(createMutation.error as Error).message}</p>}
            </form>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div className={styles.overlay} onClick={() => setEditTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>编辑规则集</h2>
            <form onSubmit={handleEdit} className={styles.form}>
              <label className={styles.label}>
                名称 *
                <input className={styles.input} value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
              </label>
              <label className={styles.label}>
                描述
                <textarea className={styles.textarea} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setEditTarget(null)}>取消</button>
                <button type="submit" className={styles.btnPrimary} disabled={!editName.trim() || updateMutation.isPending}>
                  {updateMutation.isPending ? "保存中..." : "保存"}
                </button>
              </div>
              {updateMutation.isError && <p className={styles.error}>{(updateMutation.error as Error).message}</p>}
            </form>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <div className={styles.overlay} onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>确认删除</h2>
            <p className={styles.confirmText}>
              确定要删除规则集「<strong>{deleteTarget.name}</strong>」吗？其下的所有知识库也将一并删除。
            </p>
            {deleteError && (
              <p className={styles.error} style={{ marginBottom: 12 }}>
                {deleteError.includes("workspaces") ? "无法删除：仍有工作空间正在使用该规则集" : deleteError}
              </p>
            )}
            <div className={styles.formActions}>
              <button className={styles.btnSecondary} onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>取消</button>
              <button
                className={styles.btnDanger}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Library modal */}
      {showCreateLib && selectedId && (
        <CreateLibraryModal ruleSetId={selectedId} onClose={() => setShowCreateLib(false)} />
      )}

      {/* Set Prompt modal */}
      {showSetPrompt && selectedId && (
        <SetPromptModal
          ruleSetId={selectedId}
          currentProfileId={currentPrompt?.id ?? null}
          initialTab={promptModalMode}
          onClose={() => setShowSetPrompt(false)}
          onSetDefault={(profileId) => setDefaultPromptMutation.mutate(profileId)}
        />
      )}
    </div>
  );
}
