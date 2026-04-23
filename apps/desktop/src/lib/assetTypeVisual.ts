import {
  BookOpen,
  Theater,
  Users,
  Skull,
  MapPin,
  Search,
  GitBranch,
  Clock,
  Map,
  Scroll,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AssetType } from "@trpg-workbench/shared-schema";

// ─── Per-type icon mapping ────────────────────────────────────────────────────

const ASSET_TYPE_ICONS: Record<AssetType, LucideIcon> = {
  outline:   BookOpen,
  stage:     Theater,
  npc:       Users,
  monster:   Skull,
  location:  MapPin,
  clue:      Search,
  branch:    GitBranch,
  timeline:  Clock,
  map_brief: Map,
  lore_note: Scroll,
};

// ─── Per-type CSS variable mapping ───────────────────────────────────────────

const ASSET_TYPE_COLOR_VARS: Record<AssetType, string> = {
  outline:   "var(--color-type-outline)",
  stage:     "var(--color-type-stage)",
  npc:       "var(--color-type-npc)",
  monster:   "var(--color-type-monster)",
  location:  "var(--color-type-location)",
  clue:      "var(--color-type-clue)",
  branch:    "var(--color-type-branch)",
  timeline:  "var(--color-type-timeline)",
  map_brief: "var(--color-type-map-brief)",
  lore_note: "var(--color-type-lore-note)",
};

// ─── Per-type Chinese labels ──────────────────────────────────────────────────

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  outline:   "大纲",
  stage:     "场景",
  npc:       "NPC",
  monster:   "怪物",
  location:  "地点",
  clue:      "线索",
  branch:    "分支",
  timeline:  "时间线",
  map_brief: "地图简报",
  lore_note: "世界设定",
};

// ─── Public helpers ───────────────────────────────────────────────────────────

export function getAssetTypeIcon(type: AssetType): LucideIcon {
  return ASSET_TYPE_ICONS[type] ?? BookOpen;
}

/** Returns a CSS variable string, e.g. "var(--color-type-npc)". Never hardcodes hex. */
export function getAssetTypeColor(type: AssetType): string {
  return ASSET_TYPE_COLOR_VARS[type] ?? "var(--text-muted)";
}

export function getAssetTypeLabel(type: AssetType): string {
  return ASSET_TYPE_LABELS[type] ?? type;
}

export const ALL_ASSET_TYPES: AssetType[] = Object.keys(ASSET_TYPE_LABELS) as AssetType[];
