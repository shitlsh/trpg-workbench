import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Library, Upload, Search, Plus, Trash2, ChevronDown, ChevronRight,
  FileText, AlertTriangle, X, Layers,
} from "lucide-react";
import { apiFetch, BACKEND_URL } from "../lib/api";
import { useTaskProgress } from "../hooks/useTaskProgress";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type {
  KnowledgeLibrary,
  KnowledgeDocument,
  CreateKnowledgeLibraryRequest,
  LibraryType,
  KnowledgeDocumentSummary,
  ChunkListItem,
  PageTextPreview,
  SearchTestRequest,
  SearchTestResponse,
} from "@trpg-workbench/shared-schema";
import styles from "./KnowledgePage.module.css";

const LIBRARY_TYPES: { value: LibraryType; label: string }[] = [
  { value: "core_rules", label: "核心规则" },
  { value: "expansion", label: "扩展规则" },
  { value: "module_reference", label: "参考模组" },
  { value: "monster_manual", label: "怪物手册" },
  { value: "lore", label: "世界观资料" },
  { value: "house_rules", label: "房规补充" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "等待中",
  running: "处理中",
  success: "成功",
  partial: "部分成功",
  scanned_fallback: "扫描版",
  failed: "失败",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--text-muted)",
  running: "var(--accent)",
  success: "var(--success)",
  partial: "#f0a500",
  scanned_fallback: "#f0a500",
  failed: "var(--danger)",
};

const WARNING_LABEL: Record<string, string> = {
  scanned_fallback: "扫描版 PDF（文字质量较差）",
  partial: "部分页面解析失败",
  has_table: "包含表格（可能格式异常）",
  has_multi_column: "包含多列排版",
  page_range_anomaly: "页码范围异常",
  empty_page: "存在空白页",
};

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
    padding: "6px 16px",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    background: "transparent",
    cursor: "pointer",
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
        <button style={tabStyle(previewTab === "chunks")} onClick={() => setPreviewTab("chunks")}>
          Chunks ({chunks.length})
        </button>
        <button style={tabStyle(previewTab === "pages")} onClick={() => setPreviewTab("pages")}>
          页面文本
        </button>
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
        query: query.trim(),
        library_ids: [libraryId],
        top_k: topK,
        use_rerank: useRerank,
        workspace_id: workspaceId ?? undefined,
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            autoFocus
          />
          <input
            type="number" min={1} max={20} value={topK}
            onChange={(e) => setTopK(Math.max(1, parseInt(e.target.value) || 5))}
            title="top_k"
            style={{ width: 60, padding: "8px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 13 }}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            style={{
              padding: "8px 16px", borderRadius: 6, background: "var(--accent, #7c6aff)",
              color: "#fff", fontSize: 13, cursor: "pointer",
            }}
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
              {result.warnings.length > 0 && ` · ⚠ ${result.warnings.join("; ")}`}
            </div>
            {result.error && (
              <div style={{ fontSize: 12, color: "#f0a500", marginBottom: 8 }}>⚠ {result.error}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.results.map((r, i) => (
                <div key={r.chunk_id} style={{
                  padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12,
                }}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>#{i + 1} {r.document_filename}</span>
                    <span style={{ color: "var(--text-muted)" }}>p{r.page_from}–{r.page_to}</span>
                    <span style={{ color: "var(--text-muted)" }}>vec: {r.vector_score.toFixed(3)}</span>
                    {r.rerank_score != null && (
                      <span style={{ color: "var(--accent)" }}>rerank: {r.rerank_score.toFixed(3)}</span>
                    )}
                  </div>
                  {r.section_title && (
                    <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>{r.section_title}</div>
                  )}
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

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspaceStore();

  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);
  const [showNewLib, setShowNewLib] = useState(false);
  const [newLibName, setNewLibName] = useState("");
  const [newLibType, setNewLibType] = useState<LibraryType>("core_rules");
  const [newLibDesc, setNewLibDesc] = useState("");
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null);
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [showSearchTest, setShowSearchTest] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: libraries = [] } = useQuery({
    queryKey: ["knowledge", "libraries"],
    queryFn: () => apiFetch<KnowledgeLibrary[]>("/knowledge/libraries"),
  });

  const selectedLib = libraries.find((l) => l.id === selectedLibId) ?? null;

  const { data: documents = [] } = useQuery({
    queryKey: ["knowledge", "documents", selectedLibId],
    queryFn: () => apiFetch<KnowledgeDocument[]>(`/knowledge/libraries/${selectedLibId}/documents`),
    enabled: !!selectedLibId,
    refetchInterval: uploadingTaskId ? 3000 : false,
  });

  // Poll active ingest task
  const activeTask = useTaskProgress(uploadingTaskId);
  if (activeTask?.status === "completed" || activeTask?.status === "failed") {
    if (uploadingTaskId) {
      setTimeout(() => setUploadingTaskId(null), 2000);
    }
  }

  const createLibMutation = useMutation({
    mutationFn: (body: CreateKnowledgeLibraryRequest) =>
      apiFetch<KnowledgeLibrary>("/knowledge/libraries", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (lib) => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "libraries"] });
      setShowNewLib(false);
      setNewLibName("");
      setNewLibDesc("");
      setSelectedLibId(lib.id);
    },
  });

  const deleteLibMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/knowledge/libraries/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "libraries"] });
      setSelectedLibId(null);
    },
  });

  async function handleUpload(file: File) {
    if (!selectedLibId) return;
    const form = new FormData();
    form.append("file", file);
    const url = new URL(`${BACKEND_URL}/knowledge/libraries/${selectedLibId}/documents`);
    if (activeWorkspaceId) url.searchParams.set("workspace_id", activeWorkspaceId);
    const res = await fetch(url.toString(), { method: "POST", body: form });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    setUploadingTaskId(data.task_id);
    queryClient.invalidateQueries({ queryKey: ["knowledge", "documents", selectedLibId] });
  }

  function toggleDocExpand(docId: string) {
    setExpandedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }

  const previewDoc = documents.find((d) => d.id === previewDocId) ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/")}>← 返回</button>
        <h1 className={styles.title}>
          <Library size={16} />
          知识库管理
        </h1>
        <button className={styles.btnPrimary} onClick={() => setShowNewLib(true)}>
          <Plus size={14} /> 新建知识库
        </button>
      </header>

      <div className={styles.layout}>
        {/* Left: Library list */}
        <aside className={styles.sidebar}>
          <p className={styles.sidebarTitle}>知识库列表</p>
          {libraries.length === 0 && (
            <p className={styles.empty}>还没有知识库</p>
          )}
          {libraries.map((lib) => (
            <button
              key={lib.id}
              className={`${styles.libItem} ${lib.id === selectedLibId ? styles.libItemActive : ""}`}
              onClick={() => { setSelectedLibId(lib.id); setPreviewDocId(null); }}
            >
              <span className={styles.libName}>{lib.name}</span>
              <span className={styles.libType}>{LIBRARY_TYPES.find(t => t.value === lib.type)?.label ?? lib.type}</span>
              <span className={styles.libDocCount}>{lib.document_count} 篇</span>
            </button>
          ))}
        </aside>

        {/* Right: Library detail */}
        <main className={styles.detail} style={{ paddingRight: previewDocId ? 496 : undefined }}>
          {!selectedLib ? (
            <div className={styles.placeholder}>
              <Library size={40} color="var(--border)" />
              <p>选择左侧知识库查看详情</p>
            </div>
          ) : (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <h2 className={styles.libDetailName}>{selectedLib.name}</h2>
                  <span className={styles.tag}>{LIBRARY_TYPES.find(t => t.value === selectedLib.type)?.label}</span>
                  {selectedLib.description && <p className={styles.libDesc}>{selectedLib.description}</p>}
                </div>
                <div className={styles.detailActions}>
                  <button
                    className={styles.btnSecondary}
                    onClick={() => setShowSearchTest(true)}
                  >
                    <Search size={14} /> 检索测试
                  </button>
                  <button
                    className={styles.btnDanger}
                    onClick={() => { if (confirm(`确认删除「${selectedLib.name}」？`)) deleteLibMutation.mutate(selectedLib.id); }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

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
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                    e.target.value = "";
                  }}
                />
              </div>

              {/* Active task progress */}
              {activeTask && (activeTask.status === "running" || activeTask.status === "pending") && (
                <div className={styles.progressBox}>
                  <div className={styles.progressHeader}>
                    <span>{activeTask.step_label ?? "准备中..."}</span>
                    <span>{activeTask.current_step} / {activeTask.total_steps}</span>
                  </div>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${(activeTask.current_step / activeTask.total_steps) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              {activeTask?.status === "failed" && (
                <div className={styles.errorBox}>{activeTask.error_message ?? "处理失败"}</div>
              )}

              {/* Document list */}
              <div className={styles.docList}>
                <p className={styles.sectionLabel}>文档列表（{documents.length} 篇）</p>
                {documents.length === 0 && (
                  <p className={styles.empty}>还没有上传文档</p>
                )}
                {documents.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    expanded={expandedDocIds.has(doc.id)}
                    onToggle={() => toggleDocExpand(doc.id)}
                    onPreview={() => setPreviewDocId(previewDocId === doc.id ? null : doc.id)}
                    isPreviewing={previewDocId === doc.id}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Document Preview Panel */}
      {previewDocId && previewDoc && (
        <DocumentPreviewPanel
          docId={previewDocId}
          filename={previewDoc.filename}
          onClose={() => setPreviewDocId(null)}
        />
      )}

      {/* Search Test Dialog */}
      {showSearchTest && selectedLibId && (
        <SearchTestDialog
          libraryId={selectedLibId}
          workspaceId={activeWorkspaceId}
          onClose={() => setShowSearchTest(false)}
        />
      )}

      {/* New Library Modal */}
      {showNewLib && (
        <div className={styles.overlay} onClick={() => setShowNewLib(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>新建知识库</h2>
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                if (!newLibName.trim()) return;
                createLibMutation.mutate({ name: newLibName.trim(), type: newLibType, description: newLibDesc.trim() || undefined });
              }}
            >
              <label className={styles.label}>
                名称 *
                <input className={styles.input} value={newLibName} onChange={(e) => setNewLibName(e.target.value)} placeholder="例：COC7 核心规则书" autoFocus />
              </label>
              <label className={styles.label}>
                类型 *
                <select className={styles.select} value={newLibType} onChange={(e) => setNewLibType(e.target.value as LibraryType)}>
                  {LIBRARY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className={styles.label}>
                描述
                <textarea className={styles.textarea} value={newLibDesc} onChange={(e) => setNewLibDesc(e.target.value)} rows={2} />
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowNewLib(false)}>取消</button>
                <button type="submit" className={styles.btnPrimary} disabled={!newLibName.trim() || createLibMutation.isPending}>
                  {createLibMutation.isPending ? "创建中..." : "创建"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Document Row ──────────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  expanded,
  onToggle,
  onPreview,
  isPreviewing,
}: {
  doc: KnowledgeDocument;
  expanded: boolean;
  onToggle: () => void;
  onPreview: () => void;
  isPreviewing: boolean;
}) {
  const { data: summary } = useQuery({
    queryKey: ["knowledge", "doc", doc.id, "summary"],
    queryFn: () => apiFetch<KnowledgeDocumentSummary>(`/knowledge/documents/${doc.id}/summary`),
    enabled: expanded && doc.parse_status === "success",
  });

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, marginBottom: 6 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {doc.filename}
        </span>
        <span style={{ fontSize: 12, color: STATUS_COLOR[doc.parse_status] ?? "var(--text-muted)" }}>
          {STATUS_LABEL[doc.parse_status] ?? doc.parse_status}
        </span>
        {doc.page_count != null && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{doc.page_count} 页</span>
        )}
        {doc.chunk_count != null && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{doc.chunk_count} 块</span>
        )}
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
                    <div
                      key={i}
                      style={{
                        display: "flex", gap: 6, alignItems: "flex-start",
                        padding: "4px 8px", borderRadius: 4, marginBottom: 3,
                        background: "rgba(240,165,0,0.08)", color: "#f0a500",
                      }}
                    >
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
