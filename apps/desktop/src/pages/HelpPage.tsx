import { useParams, useNavigate, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThemeToggle } from "../components/ThemeToggle";
import styles from "./HelpPage.module.css";

// Vite ?raw imports for dev mode
import gettingStarted from "../help/getting-started.md?raw";
import modelSetup from "../help/model-setup.md?raw";
import knowledgeImport from "../help/knowledge-import.md?raw";
import startCreating from "../help/start-creating.md?raw";
import ruleSetManagement from "../help/rule-set-management.md?raw";

// ── Docs registry ─────────────────────────────────────────────────────────────

const DOCS: Record<string, { title: string; content: string }> = {
  "getting-started":    { title: "快速入门",       content: gettingStarted },
  "model-setup":        { title: "模型配置指南",   content: modelSetup },
  "knowledge-import":   { title: "知识库导入指南", content: knowledgeImport },
  "rule-set-management":{ title: "规则集管理",     content: ruleSetManagement },
  "start-creating":     { title: "开始创作",       content: startCreating },
};

const NAV_ITEMS = [
  { id: "getting-started",     label: "快速入门" },
  { id: "model-setup",         label: "模型配置" },
  { id: "knowledge-import",    label: "知识库导入" },
  { id: "rule-set-management", label: "规则集管理" },
  { id: "start-creating",      label: "开始创作" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const { doc } = useParams<{ doc: string }>();
  const navigate = useNavigate();

  const currentDoc = (doc && DOCS[doc]) ? doc : "getting-started";
  const { title, content } = DOCS[currentDoc];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate(-1)}>← 返回</button>
        <span className={styles.title}>帮助文档 — {title}</span>
        <ThemeToggle />
      </header>

      <div className={styles.body}>
        {/* Sidebar */}
        <nav className={styles.sidebar}>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.id}
              to={`/help/${item.id}`}
              className={
                styles.sidebarItem +
                (currentDoc === item.id ? " " + styles.sidebarItemActive : "")
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Content */}
        <main className={styles.content}>
          <div className={styles.prose}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </main>
      </div>
    </div>
  );
}
