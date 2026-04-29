import {
  BookOpen,
  Theater,
  Users,
  Skull,
  Map,
  Search,
  Folder,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CustomAssetTypeConfig } from "@trpg-workbench/shared-schema";
import { BUILTIN_ASSET_TYPES } from "@trpg-workbench/shared-schema";

// ─── Per-type icon mapping ────────────────────────────────────────────────────
// M30: 6 canonical built-in types. Legacy types (lore_note, branch, timeline,
// map_brief, location) still have fallback entries so existing assets continue
// to render with sensible icons rather than the generic Folder.

const ASSET_TYPE_ICONS: Partial<Record<string, LucideIcon>> = {
  // Current built-ins
  outline: BookOpen,
  stage:   Theater,
  npc:     Users,
  monster: Skull,
  map:     Map,
  clue:    Search,
  // Legacy fallbacks (deprecated in M30, kept for backward rendering only)
  location:  Map,
  map_brief: Map,
  lore_note: BookOpen,
  branch:    BookOpen,
  timeline:  Theater,
};

// ─── Per-type CSS variable mapping ───────────────────────────────────────────

const ASSET_TYPE_COLOR_VARS: Partial<Record<string, string>> = {
  outline: "var(--color-type-outline)",
  stage:   "var(--color-type-stage)",
  npc:     "var(--color-type-npc)",
  monster: "var(--color-type-monster)",
  map:     "var(--color-type-map)",
  clue:    "var(--color-type-clue)",
  // Legacy fallbacks
  location:  "var(--color-type-map)",
  map_brief: "var(--color-type-map)",
  lore_note: "var(--color-type-outline)",
  branch:    "var(--color-type-outline)",
  timeline:  "var(--color-type-stage)",
};

// ─── Per-type Chinese labels ──────────────────────────────────────────────────

const ASSET_TYPE_LABELS: Partial<Record<string, string>> = {
  outline: "大纲",
  stage:   "场景",
  npc:     "NPC",
  monster: "敌人",
  map:     "地图",
  clue:    "线索",
  // Legacy fallbacks
  location:  "地点（旧）",
  map_brief: "地图简报（旧）",
  lore_note: "世界设定（旧）",
  branch:    "分支（旧）",
  timeline:  "时间线（旧）",
};

// ─── Public helpers ───────────────────────────────────────────────────────────

/** Returns the Lucide icon for a type. For custom types (emoji-based), returns Folder as fallback. */
export function getAssetTypeIcon(type: string): LucideIcon {
  return ASSET_TYPE_ICONS[type] ?? Folder;
}

/**
 * For custom (non-builtin) types: returns the emoji icon string from the config if available.
 * Returns null for builtin types (which use Lucide icons instead).
 */
export function getCustomTypeEmoji(
  type: string,
  customConfigs: CustomAssetTypeConfig[],
): string | null {
  if (ASSET_TYPE_ICONS[type]) return null;
  const config = customConfigs.find((c) => c.type_key === type);
  return config?.icon ?? null;
}

/** Returns a CSS variable string, e.g. "var(--color-type-npc)". Never hardcodes hex. */
export function getAssetTypeColor(type: string): string {
  return ASSET_TYPE_COLOR_VARS[type] ?? "var(--text-muted)";
}

/**
 * Returns the display label for a type.
 * Custom types use their label from config; completely unregistered types show the raw type_key.
 */
export function getAssetTypeLabel(
  type: string,
  customConfigs?: CustomAssetTypeConfig[],
): string {
  if (ASSET_TYPE_LABELS[type]) return ASSET_TYPE_LABELS[type]!;
  const config = customConfigs?.find((c) => c.type_key === type);
  return config?.label ?? type;
}

export const ALL_ASSET_TYPES: string[] = [...BUILTIN_ASSET_TYPES];
