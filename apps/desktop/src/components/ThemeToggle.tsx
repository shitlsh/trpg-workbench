import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "../stores/themeStore";

interface ThemeToggleProps {
  /** Size of the icon, default 15 */
  size?: number;
  /** Extra inline style */
  style?: React.CSSProperties;
}

export function ThemeToggle({ size = 15, style }: ThemeToggleProps) {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <button
      onClick={toggleTheme}
      title={theme === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "5px",
        borderRadius: "var(--radius)",
        background: "transparent",
        color: "var(--text-muted)",
        cursor: "pointer",
        transition: "color 0.15s, background 0.15s",
        ...style,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
        (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {theme === "dark" ? <Sun size={size} /> : <Moon size={size} />}
    </button>
  );
}
