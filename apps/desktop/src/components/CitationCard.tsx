import { useState } from "react";
import type { Citation } from "@trpg-workbench/shared-schema";
import styles from "./CitationCard.module.css";

interface Props {
  citation: Citation;
}

export default function CitationCard({ citation }: Props) {
  const [expanded, setExpanded] = useState(false);
  const preview = citation.content.slice(0, 160);
  const hasMore = citation.content.length > 160;

  const pageLabel =
    citation.page_from === -1
      ? "扫描版"
      : citation.page_from === citation.page_to
      ? `第 ${citation.page_from} 页`
      : `第 ${citation.page_from}–${citation.page_to} 页`;

  return (
    <div className={styles.card}>
      <div className={styles.meta}>
        <span className={styles.filename}>{citation.document_filename || "未知文档"}</span>
        <span className={styles.page}>{pageLabel}</span>
        {citation.section_title && (
          <span className={styles.section}>{citation.section_title}</span>
        )}
        <span className={styles.score}>{(citation.relevance_score * 100).toFixed(0)}%</span>
      </div>
      <p className={styles.content}>
        {expanded ? citation.content : preview}
        {hasMore && !expanded && "…"}
      </p>
      {hasMore && (
        <button className={styles.toggle} onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : "展开全文"}
        </button>
      )}
    </div>
  );
}
