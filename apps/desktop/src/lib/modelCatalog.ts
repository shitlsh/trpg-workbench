/**
 * 嵌入模型：无 probe 结果时仍可用 `<datalist>` 给常见 id 做补全。
 *
 * LLM 模型名由「模型发现」目录 + 供应商 probe 提供，不再维护静态 LLM 列表，
 * 避免与线上一致性冲突、出现已废弃型号。
 *
 * Last updated: 2026-04
 */

export const KNOWN_EMBEDDING_MODELS: Record<string, string[]> = {
  openai: [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
  ],
  google: [
    "text-embedding-004",
    "text-multilingual-embedding-002",
    "embedding-001",
  ],
  openai_compatible: [], // probe via base_url
};
