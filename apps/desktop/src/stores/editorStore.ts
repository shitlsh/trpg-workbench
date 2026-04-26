import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import type { AssetWithContent } from "@trpg-workbench/shared-schema";

export type EditorView = "markdown" | "json" | "diff" | "preview";

export interface EditorTab {
  assetId: string;
  asset: AssetWithContent;
  /** Current in-editor content (may differ from saved) */
  draftMd: string;
  draftJson: string;
  isDirty: boolean;
  view: EditorView;
  showHistory: boolean;
}

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  /** Left panel width in px */
  leftWidth: number;
  leftCollapsed: boolean;
  /** Right panel width in px */
  rightWidth: number;
  rightCollapsed: boolean;

  // Tab actions
  openTab: (asset: AssetWithContent) => void;
  closeTab: (assetId: string) => boolean; // returns false if dirty (caller should confirm)
  forceCloseTab: (assetId: string) => void;
  setActiveTab: (assetId: string) => void;
  updateDraft: (assetId: string, draftMd?: string, draftJson?: string) => void;
  markSaved: (assetId: string, updatedAsset: AssetWithContent) => void;
  setView: (assetId: string, view: EditorView) => void;
  toggleHistory: (assetId: string) => void;

  // Layout actions
  setLeftWidth: (w: number) => void;
  setLeftCollapsed: (v: boolean) => void;
  setRightWidth: (w: number) => void;
  setRightCollapsed: (v: boolean) => void;
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
  tabs: [],
  activeTabId: null,
  leftWidth: 280,
  leftCollapsed: false,
  rightWidth: 320,
  rightCollapsed: false,

  openTab: (asset) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.assetId === asset.id);
    if (existing) {
      set({ activeTabId: asset.id });
      return;
    }
    if (tabs.length >= 10) {
      toast.warning("最多同时打开 10 个标签页，请先关闭部分标签。");
      return;
    }
    const tab: EditorTab = {
      assetId: asset.id,
      asset,
      draftMd: asset.content_md ?? "",
      draftJson: asset.content_json ?? "{}",
      isDirty: false,
      view: "markdown",
      showHistory: false,
    };
    set({ tabs: [...tabs, tab], activeTabId: asset.id });
  },

  closeTab: (assetId) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.assetId === assetId);
    if (tab?.isDirty) return false;
    get().forceCloseTab(assetId);
    return true;
  },

  forceCloseTab: (assetId) => {
    const { tabs, activeTabId } = get();
    const newTabs = tabs.filter((t) => t.assetId !== assetId);
    let newActive = activeTabId;
    if (activeTabId === assetId) {
      const idx = tabs.findIndex((t) => t.assetId === assetId);
      newActive = newTabs[Math.max(0, idx - 1)]?.assetId ?? null;
    }
    set({ tabs: newTabs, activeTabId: newActive });
  },

  setActiveTab: (assetId) => set({ activeTabId: assetId }),

  updateDraft: (assetId, draftMd, draftJson) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.assetId !== assetId) return t;
        const newMd = draftMd !== undefined ? draftMd : t.draftMd;
        const newJson = draftJson !== undefined ? draftJson : t.draftJson;
        const dirty = newMd !== t.asset.content_md || newJson !== t.asset.content_json;
        return { ...t, draftMd: newMd, draftJson: newJson, isDirty: dirty };
      }),
    }));
  },

  markSaved: (assetId, updatedAsset) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.assetId !== assetId) return t;
        return {
          ...t,
          asset: updatedAsset,
          draftMd: updatedAsset.content_md,
          draftJson: updatedAsset.content_json,
          isDirty: false,
        };
      }),
    }));
  },

  setView: (assetId, view) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.assetId === assetId ? { ...t, view } : t)),
    }));
  },

  toggleHistory: (assetId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.assetId === assetId ? { ...t, showHistory: !t.showHistory } : t
      ),
    }));
  },

  setLeftWidth: (w) => set({ leftWidth: Math.max(280, Math.min(480, w)) }),
  setLeftCollapsed: (v) => set({ leftCollapsed: v }),
  setRightWidth: (w) => set({ rightWidth: Math.max(180, Math.min(480, w)) }),
  setRightCollapsed: (v) => set({ rightCollapsed: v }),
}),
{
  name: "trpg-editor-layout",
  partialize: (s) => ({
    leftWidth: s.leftWidth,
    leftCollapsed: s.leftCollapsed,
    rightWidth: s.rightWidth,
    rightCollapsed: s.rightCollapsed,
  }),
}
));
