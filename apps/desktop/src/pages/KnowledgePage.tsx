import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Library, Upload, Search, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTaskProgress } from "../hooks/useTaskProgress";
import CitationCard from "../components/CitationCard";
import type {
  KnowledgeLibrary,
  KnowledgeDocument,
  Citation,
  CreateKnowledgeLibraryRequest,
  LibraryType,
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

export default function KnowledgePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);
  const [showNewLib, setShowNewLib] = useState(false);
  const [newLibName, setNewLibName] = useState("");
  const [newLibType, setNewLibType] = useState<LibraryType>("core_rules");
  const [newLibDesc, setNewLibDesc] = useState("");
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Citation[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
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
    const res = await fetch(`http://127.0.0.1:7821/knowledge/libraries/${selectedLibId}/documents`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    setUploadingTaskId(data.task_id);
    queryClient.invalidateQueries({ queryKey: ["knowledge", "documents", selectedLibId] });
  }

  async function handleSearch() {
    if (!selectedLibId || !searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await apiFetch<Citation[]>("/knowledge/search", {
        method: "POST",
        body: JSON.stringify({ query: searchQuery, library_ids: [selectedLibId], top_k: 5 }),
      });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

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
              onClick={() => { setSelectedLibId(lib.id); setSearchResults([]); }}
            >
              <span className={styles.libName}>{lib.name}</span>
              <span className={styles.libType}>{LIBRARY_TYPES.find(t => t.value === lib.type)?.label ?? lib.type}</span>
              <span className={styles.libDocCount}>{lib.document_count} 篇</span>
            </button>
          ))}
        </aside>

        {/* Right: Library detail */}
        <main className={styles.detail}>
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
                    onClick={() => setShowSearch(!showSearch)}
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

              {/* Search test panel */}
              {showSearch && (
                <div className={styles.searchPanel}>
                  <div className={styles.searchRow}>
                    <input
                      className={styles.searchInput}
                      placeholder="输入查询词（如：理智值检定）"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                    <button className={styles.btnPrimary} onClick={handleSearch} disabled={searching}>
                      {searching ? "搜索中..." : <><Search size={14} /> 搜索</>}
                    </button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className={styles.searchResults}>
                      <p className={styles.resultsLabel}>命中 {searchResults.length} 条结果</p>
                      {searchResults.map((c) => <CitationCard key={c.chunk_id} citation={c} />)}
                    </div>
                  )}
                  {searchResults.length === 0 && !searching && searchQuery && (
                    <p className={styles.noResults}>无命中结果</p>
                  )}
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
                  <div key={doc.id} className={styles.docItem}>
                    <div className={styles.docInfo}>
                      <span className={styles.docName}>{doc.filename}</span>
                      <span
                        className={styles.docStatus}
                        style={{ color: STATUS_COLOR[doc.parse_status] ?? "var(--text-muted)" }}
                      >
                        {STATUS_LABEL[doc.parse_status] ?? doc.parse_status}
                      </span>
                      {doc.page_count != null && (
                        <span className={styles.docMeta}>{doc.page_count} 页</span>
                      )}
                      {doc.chunk_count != null && (
                        <span className={styles.docMeta}>{doc.chunk_count} 块</span>
                      )}
                    </div>
                    <span className={styles.docDate}>
                      {new Date(doc.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

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
