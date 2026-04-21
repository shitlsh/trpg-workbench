import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, BACKEND_URL } from "../lib/api";
import type { Workspace, RuleSet, LLMProfile, EmbeddingProfile } from "@trpg-workbench/shared-schema";
import styles from "./WorkspaceSettingsPage.module.css";

export default function WorkspaceSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [includeReview, setIncludeReview] = useState(false);

  const { data: workspace } = useQuery({
    queryKey: ["workspace", id],
    queryFn: () => apiFetch<Workspace>(`/workspaces/${id}`),
    enabled: !!id,
  });

  const { data: ruleSets = [] } = useQuery({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  const { data: llmProfiles = [] } = useQuery({
    queryKey: ["llm-profiles"],
    queryFn: () => apiFetch<LLMProfile[]>("/settings/llm-profiles"),
  });

  const { data: embeddingProfiles = [] } = useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: () => apiFetch<EmbeddingProfile[]>("/settings/embedding-profiles"),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ruleSetId, setRuleSetId] = useState("");
  const [defaultLlmId, setDefaultLlmId] = useState("");
  const [rulesLlmId, setRulesLlmId] = useState("");
  const [embeddingId, setEmbeddingId] = useState("");

  // Populate form fields once workspace data is available
  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setDescription(workspace.description ?? "");
      setRuleSetId(workspace.rule_set_id);
      setDefaultLlmId(workspace.default_llm_profile_id ?? "");
      setRulesLlmId(workspace.rules_llm_profile_id ?? "");
      setEmbeddingId(workspace.embedding_profile_id ?? "");
    }
  }, [workspace?.id]); // only re-init when workspace ID changes, not on every field update

  const updateMutation = useMutation({
    mutationFn: (body: Partial<Workspace>) =>
      apiFetch<Workspace>(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", id] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      rule_set_id: ruleSetId,
      default_llm_profile_id: defaultLlmId || null,
      rules_llm_profile_id: rulesLlmId || null,
      embedding_profile_id: embeddingId || null,
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const url = `${BACKEND_URL}/workspaces/${id}/export?include_review=${includeReview}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workspace?.name ?? "workspace"}_export.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setExporting(false);
    }
  }

  if (!workspace) return <div className={styles.loading}>加载中...</div>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/")}>← 返回</button>
        <h1 className={styles.title}>工作空间设置</h1>
      </header>
      <main className={styles.main}>
        <form onSubmit={handleSave} className={styles.form}>
          <label className={styles.label}>
            名称 *
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={styles.label}>
            描述
            <textarea className={styles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <label className={styles.label}>
            规则体系 *
            <select className={styles.select} value={ruleSetId} onChange={(e) => setRuleSetId(e.target.value)}>
              {ruleSets.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
            </select>
          </label>
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: 14 }}>模型路由</div>
          <label className={styles.label}>
            默认 LLM（用于创建模组、修改资产等所有 AI 任务）
            <select className={styles.select} value={defaultLlmId} onChange={(e) => setDefaultLlmId(e.target.value)}>
              <option value="">不指定</option>
              {llmProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>
          <label className={styles.label}>
            规则审查 LLM（留空则使用默认 LLM）
            <select className={styles.select} value={rulesLlmId} onChange={(e) => setRulesLlmId(e.target.value)}>
              <option value="">使用默认 LLM</option>
              {llmProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>
          <label className={styles.label}>
            Embedding 向量化（用于知识库索引和检索）
            <select className={styles.select} value={embeddingId} onChange={(e) => setEmbeddingId(e.target.value)}>
              <option value="">不指定</option>
              {embeddingProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>)}
            </select>
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.btnPrimary} disabled={!name.trim() || !ruleSetId || updateMutation.isPending}>
              {updateMutation.isPending ? "保存中..." : "保存"}
            </button>
            {updateMutation.isSuccess && <span className={styles.saved}>已保存</span>}
            {updateMutation.isError && <span className={styles.error}>{(updateMutation.error as Error).message}</span>}
          </div>
        </form>

        {/* Export section */}
        <div style={{
          marginTop: 32, padding: 20,
          border: "1px solid var(--border, #333)", borderRadius: 8,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>导出文档包</div>
          <div style={{ fontSize: 13, color: "var(--text-muted, #888)", marginBottom: 12 }}>
            将所有"定稿"状态的资产导出为 Markdown 文件 zip 包。
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={includeReview} onChange={(e) => setIncludeReview(e.target.checked)} />
            同时包含"审查中"状态的资产
          </label>
          <button
            onClick={handleExport}
            disabled={exporting}
            className={styles.btnPrimary}
          >
            {exporting ? "准备导出..." : "导出 ZIP"}
          </button>
        </div>
      </main>
    </div>
  );
}
