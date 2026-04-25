import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  BookOpen, Plus, Trash2, Edit2, Library, MessageSquare, X,
  Upload, Search, ChevronDown, ChevronRight, FileText, AlertTriangle, Layers, Tag, Sparkles, Pencil,
} from "lucide-react";
import { apiFetch, BACKEND_URL } from "../lib/api";
import { useTaskProgress } from "../hooks/useTaskProgress";
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
  LibraryType,
  KnowledgeDocument,
  KnowledgeDocumentSummary,
  ChunkListItem,
  PageTextPreview,
  SearchTestRequest,
  SearchTestResponse,
  PromptProfile,
  LLMProfile,
  EmbeddingProfile,
  CustomAssetTypeConfig,
  CreateCustomAssetTypeRequest,
} from "@trpg-workbench/shared-schema";
import styles from "./RuleSetPage.module.css";
import { HelpButton } from "../components/HelpButton";


const LIBRARY_TYPES: { value: LibraryType; label: string }[] = [
  { value: "core_rules", label: "核心规则" },
  { value: "expansion", label: "扩展规则" },
  { value: "module_reference", label: "参考模组" },
  { value: "monster_manual", label: "怪物手册" },
  { value: "lore", label: "世界观资料" },
  { value: "house_rules", label: "房规补充" },
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
  const [type, setType] = useState<LibraryType>("core_rules");
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
              type,
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
            类型 *
            <select className={styles.select} value={type} onChange={(e) => setType(e.target.value as LibraryType)}>
              {LIBRARY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
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
  onClose,
}: {
  ruleSetId: string;
  currentProfileId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  type Tab = "select" | "manual" | "ai";
  const [tab, setTab] = useState<Tab>("select");

  // select tab
  const { data: profiles = [] } = useQuery({
    queryKey: ["prompt-profiles"],
    queryFn: () => apiFetch<PromptProfile[]>("/prompt-profiles"),
  });
  const { data: llmProfiles = [] } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
  });

  const selectMutation = useMutation({
    mutationFn: (profileId: string) =>
      apiFetch<PromptProfile>(`/prompt-profiles/${profileId}`, {
        method: "PATCH",
        body: JSON.stringify({ rule_set_id: ruleSetId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles"] });
      onClose();
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
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles"] });
      onClose();
    },
  });

  // ai tab
  const [selectedLlmId, setSelectedLlmId] = useState("");
  const [aiName, setAiName] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);

  async function handleGenerate() {
    if (!selectedLlmId) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      const res = await apiFetch<{ name: string; system_prompt: string; style_notes: string }>(
        "/prompt-profiles/generate",
        {
          method: "POST",
          body: JSON.stringify({ rule_set_id: ruleSetId, llm_profile_id: selectedLlmId }),
        }
      );
      setAiName(res.name);
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
      queryClient.invalidateQueries({ queryKey: ["prompt-profiles"] });
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

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} style={{ width: 540, maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className={styles.modalTitle} style={{ margin: 0 }}>创作风格提示词</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
          <button style={tabStyle(tab === "select")} onClick={() => setTab("select")}>
            <MessageSquare size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            选择已有
          </button>
          <button style={tabStyle(tab === "manual")} onClick={() => setTab("manual")}>
            <Pencil size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            手动创建
          </button>
          <button style={tabStyle(tab === "ai")} onClick={() => setTab("ai")}>
            <Sparkles size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            AI 生成
          </button>
        </div>

        {/* Select tab */}
        {tab === "select" && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
              选择一个已有的提示词关联到此规则集。
            </p>
            <div className={styles.selectList}>
              {profiles.length === 0 && (
                <p className={styles.empty}>暂无提示词——请使用「手动创建」或「AI 生成」新建一个</p>
              )}
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className={`${styles.selectListItem} ${p.id === currentProfileId ? styles.selected : ""}`}
                  onClick={() => selectMutation.mutate(p.id)}
                >
                  <MessageSquare size={14} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                    {p.style_notes && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {p.style_notes.slice(0, 80)}{p.style_notes.length > 80 ? "..." : ""}
                      </div>
                    )}
                  </div>
                  {p.id === currentProfileId && (
                    <span style={{ fontSize: 11, color: "var(--accent)" }}>当前</span>
                  )}
                </div>
              ))}
            </div>
            {selectMutation.isError && (
              <p className={styles.error}>{(selectMutation.error as Error).message}</p>
            )}
          </>
        )}

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
              使用模型 *
              {llmProfiles.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6 }}>
                  暂无可用 LLM——请先在「模型配置」页面添加
                </div>
              ) : (
                <select className={styles.select} value={selectedLlmId} onChange={(e) => setSelectedLlmId(e.target.value)}>
                  <option value="">请选择模型...</option>
                  {llmProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
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
            {chunks.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>尚无 Chunk 数据</p>}
            {chunks.map((chunk) => (
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
  const [result, setResult] = useState<SearchTestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true); setError(null);
    try {
      const body: SearchTestRequest = {
        query: query.trim(), library_ids: [libraryId], top_k: topK,
        use_rerank: useRerank, workspace_id: workspaceId ?? undefined,
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
  doc, expanded, onToggle, onPreview, isPreviewing,
}: {
  doc: KnowledgeDocument; expanded: boolean; onToggle: () => void;
  onPreview: () => void; isPreviewing: boolean;
}) {
  const { data: summary } = useQuery({
    queryKey: ["knowledge", "doc", doc.id, "summary"],
    queryFn: () => apiFetch<KnowledgeDocumentSummary>(`/knowledge/documents/${doc.id}/summary`),
    enabled: expanded && doc.parse_status === "success",
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
        {doc.parse_status === "success" && (
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
          ) : doc.parse_status === "success" ? (
            <span style={{ color: "var(--text-muted)" }}>加载摘要中...</span>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>文档尚未完成解析</span>
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: embeddingProfiles = [] } = useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: () => apiFetch<EmbeddingProfile[]>("/settings/embedding-profiles"),
  });
  const [selectedEmbeddingId, setSelectedEmbeddingId] = useState<string>("");

  const { data: documents = [] } = useQuery({
    queryKey: ["knowledge", "documents", library.id],
    queryFn: () => apiFetch<KnowledgeDocument[]>(`/knowledge/libraries/${library.id}/documents`),
    refetchInterval: uploadingTaskId ? 3000 : false,
  });

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

  async function handleUpload(file: File) {
    setUploadError(null);
    const profileId = selectedEmbeddingId || embeddingProfiles[0]?.id;
    if (!profileId) {
      setUploadError("请先在模型配置中添加 Embedding 模型");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const url = new URL(`${BACKEND_URL}/knowledge/libraries/${library.id}/documents`);
    url.searchParams.set("embedding_profile_id", profileId);
    try {
      const res = await fetch(url.toString(), { method: "POST", body: form });
      if (!res.ok) {
        let detail = "Upload failed";
        try { const body = await res.json(); detail = body?.detail ?? detail; } catch {}
        throw new Error(detail);
      }
      const data = await res.json();
      setUploadingTaskId(data.task_id);
      queryClient.invalidateQueries({ queryKey: ["knowledge", "documents", library.id] });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
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
            <Library size={15} /> {library.name}
          </h2>
          <span className={styles.badge}>
            {LIBRARY_TYPES.find((t) => t.value === library.type)?.label ?? library.type}
          </span>
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
      <div
        className={styles.dropzone}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleUpload(file);
        }}
      >
        <Upload size={20} color="var(--text-muted)" />
        <span>拖拽 PDF 到此处，或点击选择文件</span>
        <input
          ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUpload(file); e.target.value = ""; }}
        />
      </div>

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
    queryKey: ["prompt-profiles"],
    queryFn: () => apiFetch<PromptProfile[]>("/prompt-profiles"),
    enabled: !!selectedId,
  });

  const { data: embeddingProfiles = [] } = useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: () => apiFetch<EmbeddingProfile[]>("/settings/embedding-profiles"),
  });
  const hasEmbedding = embeddingProfiles.length > 0;

  const currentPrompt = selectedId
    ? allProfiles.find((p) => p.rule_set_id === selectedId) ?? null
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
                  <button className={styles.btnSecondary} style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setShowSetPrompt(true)}>
                    {currentPrompt ? "更换" : "指定提示词"}
                  </button>
                </div>
                {currentPrompt ? (
                  <div className={styles.promptCard}>
                    <div className={styles.promptName}>{currentPrompt.name}</div>
                    {currentPrompt.style_notes && (
                      <div className={styles.promptNotes}>{currentPrompt.style_notes.slice(0, 200)}{currentPrompt.style_notes.length > 200 ? "..." : ""}</div>
                    )}
                    <div className={styles.promptActions}>
                      <button className={styles.btnGhost} onClick={() => navigate("/settings/prompts")}>查看/编辑 →</button>
                    </div>
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
                      <span className={styles.bindingType}>
                        {LIBRARY_TYPES.find((t) => t.value === lib.type)?.label ?? lib.type}
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
        <SetPromptModal ruleSetId={selectedId} currentProfileId={currentPrompt?.id ?? null} onClose={() => setShowSetPrompt(false)} />
      )}
    </div>
  );
}
