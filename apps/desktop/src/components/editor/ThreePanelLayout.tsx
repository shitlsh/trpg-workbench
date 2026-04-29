import { useRef, useCallback, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";

const HANDLE_WIDTH = 12;

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
  const [hovered, setHovered] = useState(false);
  const hasMoved = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  // Single mousedown handler: distinguishes click (collapse) from drag (resize)
  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      hasMoved.current = false;
      startX.current = e.clientX;
      startW.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const delta =
          direction === "left"
            ? ev.clientX - startX.current
            : startX.current - ev.clientX;
        if (Math.abs(delta) > 4) {
          hasMoved.current = true;
          onWidthChange(Math.max(minWidth, Math.min(maxWidth, startW.current + delta)));
        }
      };

      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // No significant drag → treat as click → toggle collapse
        if (!hasMoved.current) {
          onCollapse(!collapsed);
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [direction, width, onWidthChange, onCollapse, collapsed, minWidth, maxWidth]
  );

  return (
    <div
      style={{
        width: collapsed ? HANDLE_WIDTH : width,
        minWidth: collapsed ? HANDLE_WIDTH : minWidth,
        maxWidth: collapsed ? HANDLE_WIDTH : maxWidth,
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        position: "relative",
        transition: "width 150ms ease",
        overflow: "hidden",
        background: "var(--bg-surface)",
        borderRight: direction === "left" ? "1px solid var(--border)" : "none",
        borderLeft: direction === "right" ? "1px solid var(--border)" : "none",
      }}
    >
      {/* Content — hidden when collapsed; leaves room for handle */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            // Shrink content so the handle doesn't overlap it
            [direction === "left" ? "marginRight" : "marginLeft"]: HANDLE_WIDTH,
          }}
        >
          {children}
        </div>
      )}

      {/* Resize / collapse handle strip */}
      <div
        onMouseDown={onHandleMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={collapsed ? "展开" : "拖拽调整宽度 · 单击折叠"}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          [direction === "left" ? "right" : "left"]: 0,
          width: HANDLE_WIDTH,
          cursor: "col-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: hovered
            ? "color-mix(in srgb, var(--border) 80%, transparent)"
            : "transparent",
          transition: "background 120ms ease",
          zIndex: 1,
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        {/* Visual indicator: thin pill on hover; arrow when collapsed */}
        {collapsed ? (
          <span style={{ fontSize: 8, color: "var(--text-muted)", pointerEvents: "none" }}>
            {direction === "left" ? "▶" : "◀"}
          </span>
        ) : (
          <div
            style={{
              width: 3,
              height: 20,
              borderRadius: 2,
              background: hovered ? "var(--text-muted)" : "transparent",
              transition: "background 120ms ease",
              pointerEvents: "none",
            }}
          />
        )}
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
        maxWidth={680}
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
