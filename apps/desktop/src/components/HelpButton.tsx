import { HelpCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface HelpButtonProps {
  size?: number;
  style?: React.CSSProperties;
}

export function HelpButton({ size = 15, style }: HelpButtonProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/help/getting-started")}
      title="帮助文档"
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
      <HelpCircle size={size} />
    </button>
  );
}
