import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { Workspace, RuleSet, ModelProfile } from "@trpg-workbench/shared-schema";
import styles from "./WorkspaceSettingsPage.module.css";

export default function WorkspaceSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: workspace } = useQuery({
    queryKey: ["workspace", id],
    queryFn: () => apiFetch<Workspace>(`/workspaces/${id}`),
    enabled: !!id,
  });

  const { data: ruleSets = [] } = useQuery({
    queryKey: ["rule-sets"],
    queryFn: () => apiFetch<RuleSet[]>("/rule-sets"),
  });

  const { data: modelProfiles = [] } = useQuery({
    queryKey: ["model-profiles"],
    queryFn: () => apiFetch<ModelProfile[]>("/settings/model-profiles"),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ruleSetId, setRuleSetId] = useState("");
  const [defaultModelId, setDefaultModelId] = useState("");
  const [initialized, setInitialized] = useState(false);

  if (workspace && !initialized) {
    setName(workspace.name);
    setDescription(workspace.description ?? "");
    setRuleSetId(workspace.rule_set_id);
    setDefaultModelId(workspace.default_model_profile_id ?? "");
    setInitialized(true);
  }

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
      default_model_profile_id: defaultModelId || null,
    });
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
          <label className={styles.label}>
            默认模型
            <select className={styles.select} value={defaultModelId} onChange={(e) => setDefaultModelId(e.target.value)}>
              <option value="">不指定</option>
              {modelProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>)}
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
      </main>
    </div>
  );
}
