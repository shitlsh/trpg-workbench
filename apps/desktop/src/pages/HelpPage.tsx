import { useParams, useNavigate, Link } from "react-router-dom";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThemeToggle } from "../components/ThemeToggle";
import styles from "./HelpPage.module.css";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

// Open external URLs in the system browser.
// Tauri v2: window.open() opens a new webview, NOT the system browser.
// Must use tauri-plugin-shell's open(). Falls back to window.open only in web mode.
async function openExternal(url: string) {
  try {
    await shellOpen(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// Vite ?raw imports for dev mode
import gettingStarted from "../help/getting-started.md?raw";
import modelSetup from "../help/model-setup.md?raw";
import knowledgeImport from "../help/knowledge-import.md?raw";
import startCreating from "../help/start-creating.md?raw";
import ruleSetManagement from "../help/rule-set-management.md?raw";
import skillsHelp from "../help/skills.md?raw";

// ── Docs registry ─────────────────────────────────────────────────────────────

const DOCS: Record<string, { title: string; content: string }> = {
  "getting-started":    { title: "快速入门",       content: gettingStarted },
  "model-setup":        { title: "模型配置指南",   content: modelSetup },
  "knowledge-import":   { title: "知识库导入指南", content: knowledgeImport },
  "rule-set-management":{ title: "规则集管理",     content: ruleSetManagement },
  "start-creating":     { title: "开始创作",       content: startCreating },
  "skills":             { title: "Skill 使用指南", content: skillsHelp },
};

const NAV_ITEMS = [
  { id: "getting-started",     label: "快速入门" },
  { id: "model-setup",         label: "模型配置" },
  { id: "knowledge-import",    label: "知识库导入" },
  { id: "rule-set-management", label: "规则集管理" },
  { id: "start-creating",      label: "开始创作" },
  { id: "skills",              label: "Skill" },
];

// ── Custom renderers for in-app navigation ──────────────────────────────────

const mdComponents: Components = {
  a: ({ href, children }) => {
    if (href?.startsWith("/")) {
      // Help-to-help links replace history to avoid back-button stack pollution
      const isHelpLink = href.startsWith("/help/");
      return <Link to={href} replace={isHelpLink}>{children}</Link>;
    }
    return (
      <a
        href={href}
        onClick={(e) => { e.preventDefault(); openExternal(href!); }}
        style={{ cursor: "pointer" }}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    // Images in public/help-images/ are served at /help-images/
    return (
      <img
        src={src}
        alt={alt ?? ""}
        style={{ maxWidth: "100%", borderRadius: "var(--radius)", margin: "12px 0" }}
        loading="lazy"
      />
    );
  },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const { doc } = useParams<{ doc: string }>();
  const navigate = useNavigate();

  const currentDoc = (doc && DOCS[doc]) ? doc : "getting-started";
  const { title, content } = DOCS[currentDoc];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/")}>← 返回</button>
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
              replace
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
            <ReactMarkdown components={mdComponents} remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </main>
      </div>
    </div>
  );
}
