import { useRef, useCallback } from "react";
import { useEditorStore } from "@/stores/editorStore";

interface ResizablePanelProps {
  direction: "left" | "right";
  width: number;
  collapsed: boolean;
  onWidthChange: (w: number) => void;
  onCollapse: (v: boolean) => void;
  children: React.ReactNode;
  minWidth?: number;
  maxWidth?: number;
}

export function ResizablePanel({
  direction,
  width,
  collapsed,
  onWidthChange,
  onCollapse,
  children,
  minWidth = 180,
  maxWidth = 480,
}: ResizablePanelProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = direction === "left" ? ev.clientX - startX.current : startX.current - ev.clientX;
        onWidthChange(Math.max(minWidth, Math.min(maxWidth, startW.current + delta)));
      };
      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [direction, width, onWidthChange, minWidth, maxWidth]
  );

  return (
    <div
      style={{
        width: collapsed ? 28 : width,
        minWidth: collapsed ? 28 : minWidth,
        maxWidth: collapsed ? 28 : maxWidth,
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        position: "relative",
        overflow: "hidden",
        background: "var(--bg-surface)",
        borderRight: direction === "left" ? "1px solid var(--border)" : "none",
        borderLeft: direction === "right" ? "1px solid var(--border)" : "none",
      }}
    >
      {/* Content */}
      {!collapsed && (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      )}

      {/* Collapse strip */}
      <div
        onClick={() => onCollapse(!collapsed)}
        style={{
          width: collapsed ? "100%" : 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: collapsed ? "var(--bg-hover)" : "transparent",
          borderLeft: direction === "left" && !collapsed ? "1px solid var(--border)" : "none",
          borderRight: direction === "right" && !collapsed ? "1px solid var(--border)" : "none",
          flexShrink: 0,
          userSelect: "none",
          color: "var(--text-muted)",
          fontSize: 10,
          writingMode: "vertical-lr",
        }}
        onMouseDown={collapsed ? undefined : onMouseDown}
        title={collapsed ? "展开" : "折叠/拖拽调整"}
      >
        {collapsed ? (direction === "left" ? "▶" : "◀") : ""}
      </div>
    </div>
  );
}

/** Three-panel layout: Left | Center | Right */
export function ThreePanelLayout({
  left,
  center,
  right,
}: {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}) {
  const {
    leftWidth, leftCollapsed, rightWidth, rightCollapsed,
    setLeftWidth, setLeftCollapsed, setRightWidth, setRightCollapsed,
  } = useEditorStore();

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      <ResizablePanel
        direction="left"
        width={leftWidth}
        collapsed={leftCollapsed}
        onWidthChange={setLeftWidth}
        onCollapse={setLeftCollapsed}
        minWidth={280}
        maxWidth={480}
      >
        {left}
      </ResizablePanel>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {center}
      </div>

      <ResizablePanel
        direction="right"
        width={rightWidth}
        collapsed={rightCollapsed}
        onWidthChange={setRightWidth}
        onCollapse={setRightCollapsed}
        minWidth={180}
        maxWidth={360}
      >
        {right}
      </ResizablePanel>
    </div>
  );
}
