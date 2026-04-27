/**
 * ModelNameInput — LLM or embedding model picker with optional catalog + probe merge,
 * search, capability filters, and token hints (LLM catalog mode).
 */
import { useId, useMemo, useState, useEffect, useRef } from "react";
import type { ModelCatalogEntry } from "@trpg-workbench/shared-schema";
import { KNOWN_LLM_MODELS, KNOWN_EMBEDDING_MODELS } from "../lib/modelCatalog";
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
  const rows = Array.from(byName.values());
  rows.sort((a, b) => {
    if (a.source !== b.source) return a.source === "catalog" ? -1 : 1;
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
  const knownMap = catalog === "llm" ? KNOWN_LLM_MODELS : KNOWN_EMBEDDING_MODELS;
  const knownModels = knownMap[providerType] ?? [];

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

  // ─── LLM: legacy when no catalog/probe rows to merge ───
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
                const unknown = row.source === "probe_only";
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
                        title={unknown ? "未在模型目录中，请至「模型发现」同步" : "Tool calling"}
                      >
                        {unknown ? "?" : ""}🛠
                      </span>
                      <span
                        className={`${styles.badge} ${
                          row.supports_json_mode === true
                            ? styles.badgeOk
                            : row.supports_json_mode === false
                              ? styles.badgeOff
                              : styles.badgeUnknown
                        }`}
                        title="JSON 输出能力"
                      >
                        {unknown ? "?" : ""}JSON
                      </span>
                      <span className={styles.tokenLine} title="Context / 最大输出（来自目录）">
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
