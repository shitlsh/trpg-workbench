import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownPreview.module.css";

interface MarkdownPreviewProps {
  content: string;
  assetName?: string;
}

export function MarkdownPreview({ content, assetName }: MarkdownPreviewProps) {
  return (
    <div className={styles.wrapper}>
      {assetName && <div className={styles.assetName}>{assetName}</div>}
      <div className={styles.prose}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
