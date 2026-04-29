/**
 * ModelNameInput — LLM or embedding model picker.
 *
 * Model list = probe results from the provider API (via useModelList / fetchedModels).
 * catalogEntries is kept for backward compatibility but is always passed as [] now that
 * the local model catalog DB has been removed (M7 cleanup). Capability filters
 * (requireTools / requireJsonMode) have no effect when catalogEntries is empty.
 */
import { useId, useMemo, useState, useEffect, useRef } from "react";
import type { ModelCatalogEntry } from "@trpg-workbench/shared-schema";
import { KNOWN_EMBEDDING_MODELS } from "../lib/modelCatalog";
import styles from "./ModelNameInput.module.css";

export type ModelCatalogType = "llm" | "embedding";

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
  /** catalog=模型发现库；probe_only=供应商返回 id，本地目录尚无对应条目 */
  source: "catalog" | "probe_only";
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
  const listId = useId();
  const knownModels = catalog === "embedding" ? (KNOWN_EMBEDDING_MODELS[providerType] ?? []) : [];

  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyTools, setOnlyTools] = useState(!!requireTools);
  const [onlyJson, setOnlyJson] = useState(!!requireJsonMode);

  useEffect(() => {
    setOnlyTools(!!requireTools);
    setOnlyJson(!!requireJsonMode);
  }, [requireTools, requireJsonMode]);

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

  const merged = useMemo(
    () => buildMergedRows(providerType, catalogEntries, fetchedModels),
    [providerType, catalogEntries, fetchedModels],
  );

  const filtered = useMemo(
    () => merged.filter((r) => rowPassesFilters(r, search, onlyTools, onlyJson)),
    [merged, search, onlyTools, onlyJson],
  );

  const canLlmRich = catalog === "llm" && !!providerType && merged.length > 0;

  // ─── Embedding: simple select / datalist / input ───
  if (catalog === "embedding") {
    if (fetchedModels.length > 0) {
      return (
        <select
          className={className}
          style={style}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">选择模型...</option>
          {fetchedModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      );
    }
    if (knownModels.length > 0) {
      return (
        <>
          <datalist id={listId}>
            {knownModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <input
            list={listId}
            className={className}
            style={style}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
          />
        </>
      );
    }
    return (
      <input
        className={className}
        style={style}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }

  // ─── LLM: 无目录且未 probe 到任何 id 时，仅用纯输入（不混静态型号表）───
  if (!canLlmRich) {
    if (fetchedModels.length > 0) {
      return (
        <select
          className={className}
          style={style}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">选择模型...</option>
          {fetchedModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        className={className}
        style={style}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }

  // ─── LLM rich picker (catalog and/or probe) ───
  const hiddenCount = merged.length - filtered.length;

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
            {hiddenCount > 0 && (
              <span className={styles.warn}>
                已隐藏 {hiddenCount} 个与筛选不符的项；可关闭上方勾选或去「模型发现」同步能力数据。
              </span>
            )}
          </div>
          <div className={styles.list}>
            {filtered.length === 0 ? (
              <div className={styles.emptyHint}>无匹配项。尝试清空搜索或关闭上述筛选。</div>
            ) : (
              filtered.map((row) => {
                const active = row.model_name === value;
                const isProbeOnly = row.source === "probe_only";
                return (
                  <div
                    key={row.model_name}
                    className={`${styles.row} ${active ? styles.rowActive : ""} ${
                      row.supports_tools === false || row.supports_json_mode === false ? styles.rowMuted : ""
                    }`}
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
                      </span>
                    </div>
                    <div className={styles.metaCol}>
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
                            ? "供应商已返回此 id；本地「模型发现」中尚无该条。同步目录后可看精确能力。"
                            : "Tool calling（来自「模型发现」）"
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
                            ? "能力未知，同步「模型发现」后可见目录内标注。"
                            : "JSON 输出能力（来自「模型发现」）"
                        }
                      >
                        JSON
                      </span>
                      <span className={styles.tokenLine} title="Context / 最大输出（来自「模型发现」；probe-only 为 —）">
                        {formatTokens(row.context_window)} ctx / {formatTokens(row.max_output_tokens)} out
                      </span>
                    </div>
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
