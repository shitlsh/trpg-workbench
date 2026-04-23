import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, Loader2 } from "lucide-react";
import type { AssetWithContent, AssetStatus } from "@trpg-workbench/shared-schema";
import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { apiFetch } from "@/lib/api";

const STATUS_OPTIONS: { value: AssetStatus; label: string; color: string }[] = [
  { value: "draft", label: "草稿", color: "#888" },
  { value: "review", label: "审查中", color: "#f0a500" },
  { value: "final", label: "定稿", color: "#52c97e" },
];

// ─── Image Generation Section ─────────────────────────────────────────────────

function ImageSection({ assetId, contentJson }: { assetId: string; contentJson: string }) {
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPath, setGeneratedPath] = useState<string | null>(null);

  // Try to parse image_brief from asset JSON
  let imageBrief: Record<string, unknown> | null = null;
  let existingImagePath: string | null = null;
  try {
    const data = JSON.parse(contentJson);
    imageBrief = data.image_brief ?? null;
    existingImagePath = (data.image_brief?.generated_image_path as string) ?? null;
  } catch {}

  const handleStartGenerate = async () => {
    try {
      const result = await apiFetch<{ workflow_id: string; status: string; step_results: string }>(
        `/assets/${assetId}/generate-image`,
        { method: "POST", body: JSON.stringify({ provider: "dalle3" }) },
      );
      setWorkflowId(result.workflow_id);

      // Parse the generated prompt from step 2
      const steps = JSON.parse(result.step_results) as Array<{ step: number; summary: string | null }>;
      const step2 = steps.find((s) => s.step === 2);
      const prompt = step2?.summary ?? "";
      setEditedPrompt(prompt);
      setShowPromptDialog(true);
    } catch (err) {
      console.error("Failed to start image generation", err);
    }
  };

  const handleConfirmGenerate = async () => {
    if (!workflowId) return;
    setIsGenerating(true);
    setShowPromptDialog(false);
    try {
      const result = await apiFetch<{ status: string; result_summary: string | null }>(
        `/assets/${assetId}/generate-image/confirm?workflow_id=${workflowId}`,
        { method: "POST", body: JSON.stringify({ confirmed_prompt: editedPrompt }) },
      );
      if (result.status === "completed" && result.result_summary) {
        setGeneratedPath(result.result_summary.replace("图像已保存：", ""));
      }
    } catch {}
    setIsGenerating(false);
  };

  const displayPath = generatedPath ?? existingImagePath;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>图像</div>

      {displayPath ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{
            width: "100%", aspectRatio: "1/1", background: "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <img
              src={`file://${displayPath}`}
              alt="生成图像"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, wordBreak: "break-all" }}>
            {displayPath.split("/").pop()}
          </div>
        </div>
      ) : null}

      {imageBrief ? (
        <button
          onClick={handleStartGenerate}
          disabled={isGenerating}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            width: "100%", padding: "6px 10px", borderRadius: 5,
            background: "var(--bg-surface)", border: "1px solid var(--border)",
            color: "var(--text)", cursor: isGenerating ? "default" : "pointer", fontSize: 12,
          }}
        >
          {isGenerating ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Image size={13} />}
          {isGenerating ? "生成中..." : displayPath ? "重新生成图像" : "生成图像"}
        </button>
      ) : (
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
          资产 JSON 中无 image_brief 字段，暂不支持图像生成
        </div>
      )}

      {/* Prompt confirm dialog */}
      {showPromptDialog && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div style={{
            background: "var(--bg-surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: 20, width: 460, maxWidth: "90vw",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>确认图像 Prompt</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              可在下方编辑 prompt，然后点击生成
            </div>
            <textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              rows={5}
              style={{
                width: "100%", padding: 8, background: "var(--bg)",
                border: "1px solid var(--border)", borderRadius: 5,
                color: "var(--text)", fontSize: 13, resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowPromptDialog(false)}
                style={{
                  padding: "6px 14px", borderRadius: 5, fontSize: 13,
                  background: "var(--bg)", border: "1px solid var(--border)", cursor: "pointer",
                }}
              >取消</button>
              <button
                onClick={handleConfirmGenerate}
                disabled={!editedPrompt.trim()}
                style={{
                  padding: "6px 14px", borderRadius: 5, fontSize: 13,
                  background: "var(--accent)", color: "#fff",
                  border: "none", cursor: editedPrompt.trim() ? "pointer" : "default",
                }}
              >生成图像</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function AssetMetaPanel() {
  const qc = useQueryClient();
  const { tabs, activeTabId, markSaved } = useEditorStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const tab = tabs.find((t) => t.assetId === activeTabId);

  const statusMutation = useMutation({
    mutationFn: async (status: AssetStatus) => {
      return apiFetch<AssetWithContent>(`/assets/${tab!.assetId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: (updated) => {
      markSaved(tab!.assetId, updated);
      qc.invalidateQueries({ queryKey: ["assets", activeWorkspaceId] });
    },
  });

  if (!tab) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-muted)", fontSize: 12, padding: 16, textAlign: "center",
      }}>
        选中资产后在此查看元信息
      </div>
    );
  }

  const asset = tab.asset;

  return (
    <div style={{ padding: 16, overflowY: "auto" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{asset.name}</div>

      <Field label="类型" value={asset.type} />
      <Field label="Slug" value={asset.slug} mono />
      <Field label="路径" value={asset.path} mono small />

      {/* Status selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>状态</div>
        <div style={{ display: "flex", gap: 6 }}>
          {STATUS_OPTIONS.map(({ value, label, color }) => (
            <button
              key={value}
              onClick={() => statusMutation.mutate(value)}
              style={{
                padding: "3px 10px", borderRadius: 4, fontSize: 12,
                background: asset.status === value ? color + "33" : "var(--bg)",
                border: `1px solid ${asset.status === value ? color : "var(--border)"}`,
                color: asset.status === value ? color : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {asset.summary && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>摘要</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>{asset.summary}</div>
        </div>
      )}

      <Field label="当前版本" value={`v${asset.version}`} />
      <Field label="创建时间" value={new Date(asset.created_at).toLocaleString("zh-CN")} small />
      <Field label="最后更新" value={new Date(asset.updated_at).toLocaleString("zh-CN")} small />

      {/* Image generation section */}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <ImageSection assetId={asset.id} contentJson={asset.content_json} />
      </div>
    </div>
  );
}

function Field({ label, value, mono = false, small = false }: {
  label: string; value: string | number; mono?: boolean; small?: boolean;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: small ? 11 : 13,
        fontFamily: mono ? "monospace" : undefined,
        color: "var(--text)",
        wordBreak: "break-all",
      }}>{value}</div>
    </div>
  );
}
