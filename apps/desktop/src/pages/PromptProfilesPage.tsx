import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Edit2, Check, X } from "lucide-react";
import type { PromptProfile } from "@trpg-workbench/shared-schema";
import { apiFetch } from "@/lib/api";

export default function PromptProfilesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", system_prompt: "", style_notes: "" });

  const { data: profiles = [] } = useQuery<PromptProfile[]>({
    queryKey: ["prompt-profiles"],
    queryFn: () => apiFetch("/prompt-profiles"),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; system_prompt: string; style_notes: string }) =>
      apiFetch("/prompt-profiles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["prompt-profiles"] }); setCreating(false); setForm({ name: "", system_prompt: "", style_notes: "" }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; system_prompt?: string; style_notes?: string }) =>
      apiFetch(`/prompt-profiles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["prompt-profiles"] }); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/prompt-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompt-profiles"] }),
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <Link to="/settings/rule-sets" style={{ color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
            <ArrowLeft size={16} />
          </Link>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Prompt 配置</h1>
          <button
            onClick={() => { setCreating(true); setForm({ name: "", system_prompt: "", style_notes: "" }); }}
            style={{
              marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 6, background: "var(--accent)",
              color: "#fff", border: "none", cursor: "pointer", fontSize: 13,
            }}
          >
            <Plus size={14} /> 新建
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <div style={{
            padding: 16, marginBottom: 16,
            background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>新建 Prompt 配置</div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={inputStyle}
                placeholder="例：我的恐怖调查风格"
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>风格备注</label>
              <input
                value={form.style_notes}
                onChange={(e) => setForm({ ...form, style_notes: e.target.value })}
                style={inputStyle}
                placeholder="简短描述风格特点"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>System Prompt</label>
              <textarea
                value={form.system_prompt}
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                rows={8}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                placeholder="输入 system prompt..."
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setCreating(false)} style={cancelBtn}>取消</button>
              <button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.name || !form.system_prompt}
                style={saveBtn}
              >保存</button>
            </div>
          </div>
        )}

        {/* Profile list */}
        {profiles.map((p) => (
          <ProfileCard
            key={p.id}
            profile={p}
            isEditing={editing === p.id}
            onEdit={() => setEditing(p.id)}
            onCancelEdit={() => setEditing(null)}
            onSave={(updates) => updateMutation.mutate({ id: p.id, ...updates })}
            onDelete={() => deleteMutation.mutate(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileCard({
  profile, isEditing, onEdit, onCancelEdit, onSave, onDelete,
}: {
  profile: PromptProfile;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updates: { name?: string; system_prompt?: string; style_notes?: string }) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState({
    name: profile.name,
    system_prompt: profile.system_prompt,
    style_notes: profile.style_notes ?? "",
  });

  return (
    <div style={{
      padding: 16, marginBottom: 12,
      background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8,
    }}>
      {isEditing ? (
        <>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={{ ...inputStyle, marginBottom: 8, fontWeight: 600 }}
          />
          <input
            value={form.style_notes}
            onChange={(e) => setForm({ ...form, style_notes: e.target.value })}
            style={{ ...inputStyle, marginBottom: 8 }}
            placeholder="风格备注"
          />
          <textarea
            value={form.system_prompt}
            onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
            rows={10}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12, marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onCancelEdit} style={cancelBtn}><X size={13} /> 取消</button>
            <button onClick={() => onSave(form)} style={saveBtn}><Check size={13} /> 保存</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 600, flex: 1 }}>{profile.name}</div>
            {profile.is_builtin && (
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 3,
                background: "#1a3a2a", color: "#52c97e", border: "1px solid #52c97e44",
              }}>内置</span>
            )}
            {!profile.is_builtin && (
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={onEdit} style={iconBtn} title="编辑"><Edit2 size={13} /></button>
                <button onClick={onDelete} style={{ ...iconBtn, color: "#e05252" }} title="删除"><Trash2 size={13} /></button>
              </div>
            )}
          </div>
          {profile.style_notes && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{profile.style_notes}</div>
          )}
          <details>
            <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
              查看 System Prompt
            </summary>
            <pre style={{
              marginTop: 8, padding: 10, background: "var(--bg)",
              border: "1px solid var(--border)", borderRadius: 4,
              fontSize: 11, whiteSpace: "pre-wrap", color: "var(--text)",
              maxHeight: 300, overflowY: "auto",
            }}>
              {profile.system_prompt}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px",
  background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: 5, color: "var(--text)", fontSize: 13,
  boxSizing: "border-box",
};

const saveBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  padding: "6px 14px", borderRadius: 5, fontSize: 13,
  background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer",
};

const cancelBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  padding: "6px 14px", borderRadius: 5, fontSize: 13,
  background: "var(--bg)", border: "1px solid var(--border)",
  color: "var(--text)", cursor: "pointer",
};

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--text-muted)", padding: 3, display: "flex", alignItems: "center",
};
