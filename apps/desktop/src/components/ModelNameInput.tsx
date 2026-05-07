/**
 * ModelNameInput — LLM or embedding model picker.
 *
 * Always renders as a custom combobox (rich floating panel) regardless of
 * whether fetchedModels are present. This ensures a consistent UI shape
 * at all times and eliminates the previous three-way render (select /
 * datalist / custom panel) that caused visual jumps.
 *
 * For LLM providers, probe results are split into two sections:
 *   ★ 推荐   — models from RECOMMENDED_LLM_MODELS[providerType]
 *   其他可用  — remaining probe results, collapsed by default
 *
 * catalogEntries is kept for backward compatibility but is always passed
 * as [] now that the local model catalog DB has been removed (M7 cleanup).
 */
import { useId, useMemo, useState, useEffect, useRef } from "react";
import type { ModelCatalogEntry } from "@trpg-workbench/shared-schema";
import { KNOWN_EMBEDDING_MODELS } from "../lib/modelCatalog";
import styles from "./ModelNameInput.module.css";

export type ModelCatalogType = "llm" | "embedding";

// ── Recommended models per LLM provider ──────────────────────────────────────
// These are always shown at the top of the picker (even before probing),
// greyed-out when not yet confirmed by a probe, normal when probe returns them.
const RECOMMENDED_LLM_MODELS: Record<string, string[]> = {
  google:            ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
  openai:            ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  anthropic:         ["claude-sonnet-4-5", "claude-3-5-haiku-20241022"],
  openrouter:        [],  // dynamic, no preset
  openai_compatible: [],  // local models, no preset
};

interface ModelNameInputProps {
  catalog: ModelCatalogType;
  providerType: string;
  value: string;
  onChange: (value: string) => void;
  /** Dynamic model ids from probe API (string names). */
  fetchedModels?: string[];
  /** Pre-filtered catalog rows for the current provider (from GET /settings/model-catalog). */
  catalogEntries?: ModelCatalogEntry[];
  /** When true, "only tools" filter defaults to on; user can turn off to see all (with warnings). */
  requireTools?: boolean;
  /** When true, "only JSON" filter defaults to on. */
  requireJsonMode?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

type MergedRow = {
  model_name: string;
  display_name: string | null;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_json_mode: boolean | null;
  supports_tools: boolean | null;
  source: "catalog" | "probe_only" | "recommended_only";
};

type Section = {
  label: string;
  rows: MergedRow[];
  collapsible: boolean;
};

function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function buildMergedRows(
  providerType: string,
  catalogEntries: ModelCatalogEntry[] | undefined,
  probedNames: string[],
): MergedRow[] {
  const byName = new Map<string, MergedRow>();
  for (const e of catalogEntries ?? []) {
    if (e.provider_type !== providerType) continue;
    byName.set(e.model_name, {
      model_name: e.model_name,
      display_name: e.display_name,
      context_window: e.context_window,
      max_output_tokens: e.max_output_tokens,
      supports_json_mode: e.supports_json_mode,
      supports_tools: e.supports_tools,
      source: "catalog",
    });
  }
  for (const name of probedNames) {
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      model_name: name,
      display_name: null,
      context_window: null,
      max_output_tokens: null,
      supports_json_mode: null,
      supports_tools: null,
      source: "probe_only",
    });
  }
  const rank = (s: MergedRow["source"]) => (s === "catalog" ? 0 : 1);
  const rows = Array.from(byName.values());
  rows.sort((a, b) => {
    const d = rank(a.source) - rank(b.source);
    if (d !== 0) return d;
    return a.model_name.localeCompare(b.model_name);
  });
  return rows;
}

/** Build merged rows that also include recommended models not yet probed. */
function buildMergedRowsWithRecommended(
  providerType: string,
  catalogEntries: ModelCatalogEntry[] | undefined,
  probedNames: string[],
): MergedRow[] {
  const base = buildMergedRows(providerType, catalogEntries, probedNames);
  const existing = new Set(base.map(r => r.model_name));
  const recommended = RECOMMENDED_LLM_MODELS[providerType] ?? [];
  const extra: MergedRow[] = [];
  for (const name of recommended) {
    if (!existing.has(name)) {
      extra.push({
        model_name: name,
        display_name: null,
        context_window: null,
        max_output_tokens: null,
        supports_json_mode: null,
        supports_tools: null,
        source: "recommended_only",
      });
    }
  }
  return [...extra, ...base];
}

function rowPassesFilters(
  row: MergedRow,
  q: string,
  onlyTools: boolean,
  onlyJson: boolean,
): boolean {
  const label = row.display_name ? `${row.model_name} ${row.display_name}` : row.model_name;
  if (q && !label.toLowerCase().includes(q.toLowerCase())) return false;
  if (onlyTools && row.supports_tools === false) return false;
  if (onlyJson && row.supports_json_mode === false) return false;
  return true;
}

function buildSections(
  catalog: ModelCatalogType,
  providerType: string,
  merged: MergedRow[],
  search: string,
  onlyTools: boolean,
  onlyJson: boolean,
): Section[] {
  if (catalog !== "llm") {
    // Embedding: no recommended grouping, just one flat section
    const rows = merged.filter(r => rowPassesFilters(r, search, false, false));
    if (rows.length === 0) return [];
    return [{ label: "", rows, collapsible: false }];
  }

  const recSet = new Set(RECOMMENDED_LLM_MODELS[providerType] ?? []);
  const recRows = merged.filter(
    r => recSet.has(r.model_name) && rowPassesFilters(r, search, onlyTools, onlyJson),
  );
  const otherRows = merged.filter(
    r => !recSet.has(r.model_name) && rowPassesFilters(r, search, onlyTools, onlyJson),
  );

  const sections: Section[] = [];
  if (recRows.length > 0) {
    sections.push({ label: "★ 推荐", rows: recRows, collapsible: false });
  }
  if (otherRows.length > 0) {
    sections.push({
      label: `其他可用（${otherRows.length} 个）`,
      rows: otherRows,
      collapsible: true,
    });
  }
  return sections;
}

export function ModelNameInput({
  catalog,
  providerType,
  value,
  onChange,
  fetchedModels = [],
  catalogEntries,
  requireTools = false,
  requireJsonMode = false,
  placeholder,
  className,
  style,
  disabled,
}: ModelNameInputProps) {
  useId(); // keep hook count stable (was used for datalist, now unused)
  const knownModels = catalog === "embedding" ? (KNOWN_EMBEDDING_MODELS[providerType] ?? []) : [];

  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyTools, setOnlyTools] = useState(!!requireTools);
  const [onlyJson, setOnlyJson] = useState(!!requireJsonMode);
  // Track which collapsible sections are expanded
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    setOnlyTools(!!requireTools);
    setOnlyJson(!!requireJsonMode);
  }, [requireTools, requireJsonMode]);

  // Reset expanded sections when provider changes
  useEffect(() => {
    setExpandedSections(new Set());
  }, [providerType]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Build candidate list:
  // - For LLM: merge probe results + recommended-only entries (not yet probed)
  // - For embedding: use fetchedModels first, fall back to knownModels
  const allCandidates = useMemo<string[]>(() => {
    if (catalog === "llm") return []; // handled via mergedRows below
    if (fetchedModels.length > 0) return fetchedModels;
    return knownModels;
  }, [catalog, fetchedModels, knownModels]);

  const merged = useMemo(() => {
    if (catalog === "llm") {
      return buildMergedRowsWithRecommended(providerType, catalogEntries, fetchedModels);
    }
    // Embedding: convert flat string list to MergedRow
    return allCandidates.map<MergedRow>(name => ({
      model_name: name,
      display_name: null,
      context_window: null,
      max_output_tokens: null,
      supports_json_mode: null,
      supports_tools: null,
      source: "probe_only",
    }));
  }, [catalog, providerType, catalogEntries, fetchedModels, allCandidates]);

  const sections = useMemo(
    () => buildSections(catalog, providerType, merged, search, onlyTools, onlyJson),
    [catalog, providerType, merged, search, onlyTools, onlyJson],
  );

  const totalFiltered = sections.reduce((s, sec) => s + sec.rows.length, 0);
  const totalMerged = merged.length;
  const hiddenCount = totalMerged - totalFiltered;

  function toggleSection(label: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const showFilters = catalog === "llm" && merged.length > 0;

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <div className={styles.inputRow}>
        <input
          className={className ? `${className} ${styles.input}` : styles.input}
          style={style}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
      </div>
      {open && !disabled && (
        <div className={styles.panel} role="listbox">
          <div className={styles.toolbar}>
            <input
              className={styles.search}
              placeholder="搜索模型名…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            {showFilters && (
              <div className={styles.filters}>
                <label>
                  <input
                    type="checkbox"
                    checked={onlyTools}
                    onChange={(e) => setOnlyTools(e.target.checked)}
                  />
                  仅支持 Tool calling
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={onlyJson}
                    onChange={(e) => setOnlyJson(e.target.checked)}
                  />
                  仅支持 JSON 输出
                </label>
              </div>
            )}
            {hiddenCount > 0 && showFilters && (
              <span className={styles.warn}>
                已隐藏 {hiddenCount} 个与筛选不符的项；可关闭上方勾选查看全部。
              </span>
            )}
          </div>
          <div className={styles.list}>
            {sections.length === 0 ? (
              <div className={styles.emptyHint}>
                {merged.length === 0
                  ? catalog === "embedding"
                    ? "填写 Base URL 后点「获取模型列表」可加载可用模型"
                    : "填写 API Key 后点「验证 Key」可加载可用模型"
                  : "无匹配项。尝试清空搜索或关闭上述筛选。"}
              </div>
            ) : (
              sections.map((section) => {
                const isExpanded = !section.collapsible || expandedSections.has(section.label);
                return (
                  <div key={section.label || "default"}>
                    {section.label && (
                      <div className={styles.sectionHeader}>
                        <span className={styles.sectionLabel}>{section.label}</span>
                        {section.collapsible && (
                          <button
                            type="button"
                            className={styles.sectionToggle}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleSection(section.label);
                            }}
                          >
                            {isExpanded ? "收起" : "展开"}
                          </button>
                        )}
                      </div>
                    )}
                    {isExpanded && section.rows.map((row) => {
                      const active = row.model_name === value;
                      const isRecommendedOnly = row.source === "recommended_only";
                      const isProbeOnly = row.source === "probe_only";
                      return (
                        <div
                          key={row.model_name}
                          className={`${styles.row} ${active ? styles.rowActive : ""} ${
                            (row.supports_tools === false || row.supports_json_mode === false) && !isRecommendedOnly
                              ? styles.rowMuted
                              : ""
                          } ${isRecommendedOnly ? styles.rowRecommendedOnly : ""}`}
                          role="option"
                          aria-selected={active}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onChange(row.model_name);
                            setOpen(false);
                          }}
                        >
                          <div className={styles.nameCol}>
                            <span className={styles.check}>{active ? "✓" : ""}</span>
                            <span title={row.display_name ?? row.model_name}>
                              {row.model_name}
                              {row.display_name && row.display_name !== row.model_name ? (
                                <span style={{ color: "var(--text-muted)", fontSize: 11 }}> — {row.display_name}</span>
                              ) : null}
                              {isRecommendedOnly && (
                                <span style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: 6 }}>(验证后可用)</span>
                              )}
                            </span>
                          </div>
                          {catalog === "llm" && (
                            <div className={styles.metaCol}>
                              {!isRecommendedOnly && (
                                <>
                                  <span
                                    className={`${styles.badge} ${
                                      row.supports_tools === true
                                        ? styles.badgeOk
                                        : row.supports_tools === false
                                          ? styles.badgeOff
                                          : styles.badgeUnknown
                                    }`}
                                    title={
                                      isProbeOnly
                                        ? "供应商已返回此 id；能力未知。"
                                        : "Tool calling"
                                    }
                                  >
                                    🛠
                                  </span>
                                  <span
                                    className={`${styles.badge} ${
                                      row.supports_json_mode === true
                                        ? styles.badgeOk
                                        : row.supports_json_mode === false
                                          ? styles.badgeOff
                                          : styles.badgeUnknown
                                    }`}
                                    title={
                                      isProbeOnly
                                        ? "能力未知。"
                                        : "JSON 输出能力"
                                    }
                                  >
                                    JSON
                                  </span>
                                  <span className={styles.tokenLine}>
                                    {formatTokens(row.context_window)} ctx / {formatTokens(row.max_output_tokens)} out
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
