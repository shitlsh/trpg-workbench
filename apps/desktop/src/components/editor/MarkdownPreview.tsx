import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Asset } from "@trpg-workbench/shared-schema";
import { preprocessWikilinks } from "@/lib/wikilinks";
import styles from "./MarkdownPreview.module.css";

interface MarkdownPreviewProps {
  content: string;
  assetName?: string;
  /** All workspace assets, used to resolve [[slug]] links. */
  allAssets?: Asset[];
  /** Called when user clicks a [[slug]] wikilink. */
  onOpenAsset?: (assetId: string) => void;
}

export function MarkdownPreview({ content, assetName, allAssets = [], onOpenAsset }: MarkdownPreviewProps) {
  const processed = preprocessWikilinks(content);

  // Build slug → asset lookup
  const slugMap = new Map<string, Asset>();
  for (const a of allAssets) {
    slugMap.set(a.slug, a);
  }

  return (
    <div className={styles.wrapper}>
      {assetName && <div className={styles.assetName}>{assetName}</div>}
      <div className={styles.prose}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a({ href, children }) {
              if (href?.startsWith("wiki://")) {
                const slug = href.slice(7);
                const target = slugMap.get(slug);
                const exists = !!target;
                return (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (target && onOpenAsset) onOpenAsset(target.id);
                    }}
                    title={exists ? `跳转到：${target!.name}` : `找不到资产：${slug}`}
                    style={{
                      color: exists ? "var(--accent)" : "var(--danger)",
                      textDecoration: exists ? "underline" : "underline dotted",
                      cursor: exists ? "pointer" : "not-allowed",
                    }}
                  >
                    {children}
                  </a>
                );
              }
              // Normal link — open in browser via Tauri shell or plain href
              return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
            },
          }}
        >
          {processed}
        </ReactMarkdown>
      </div>
    </div>
  );
}
