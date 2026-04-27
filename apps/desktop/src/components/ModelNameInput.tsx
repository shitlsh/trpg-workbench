/**
 * ModelNameInput
 *
 * A unified input for model names that:
 * - Shows a <select> when `fetchedModels` is non-empty (dynamic probe result)
 * - Shows an <input> with a <datalist> for known providers (static suggestions)
 * - Falls back to a plain <input> for unknown providers (e.g., openai_compatible
 *   where the user hasn't probed yet)
 *
 * Usage:
 *   <ModelNameInput
 *     catalog="llm"
 *     providerType={form.provider_type}
 *     value={form.model_name}
 *     onChange={(v) => setForm({ ...form, model_name: v })}
 *     fetchedModels={fetchedModels}
 *     placeholder="例：gpt-4o"
 *     className={styles.input}
 *   />
 */

import { useId } from "react";
import { KNOWN_LLM_MODELS, KNOWN_EMBEDDING_MODELS } from "../lib/modelCatalog";

export type ModelCatalogType = "llm" | "embedding";

interface ModelNameInputProps {
  /** Which static catalog to use for datalist suggestions */
  catalog: ModelCatalogType;
  /** Current provider type string (e.g., "anthropic", "openai_compatible") */
  providerType: string;
  value: string;
  onChange: (value: string) => void;
  /** Dynamic models fetched via probe endpoint; overrides static list */
  fetchedModels?: string[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

export function ModelNameInput({
  catalog,
  providerType,
  value,
  onChange,
  fetchedModels = [],
  placeholder,
  className,
  style,
  disabled,
}: ModelNameInputProps) {
  const listId = useId();
  const knownMap = catalog === "llm" ? KNOWN_LLM_MODELS : KNOWN_EMBEDDING_MODELS;
  const knownModels = knownMap[providerType] ?? [];

  // Dynamic probe results → dropdown select
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
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    );
  }

  // Known static list → input + datalist
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

  // No suggestions → plain input
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
