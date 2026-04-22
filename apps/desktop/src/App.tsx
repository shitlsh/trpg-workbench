import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { checkHealth } from "./lib/api";
import { useBackendStore } from "./stores/backendStore";
import { useThemeStore, applyTheme } from "./stores/themeStore";
import StartingScreen from "./pages/StartingScreen";
import FailedScreen from "./pages/FailedScreen";
import HomePage from "./pages/HomePage";
import WorkspaceSettingsPage from "./pages/WorkspaceSettingsPage";
import SettingsPage from "./pages/SettingsPage";
import KnowledgePage from "./pages/KnowledgePage";
import PromptProfilesPage from "./pages/PromptProfilesPage";
import UsagePage from "./pages/UsagePage";
import { WorkspacePage } from "./pages/WorkspacePage";
import HelpPage from "./pages/HelpPage";
import RuleSetPage from "./pages/RuleSetPage";
import DisconnectedBanner from "./components/DisconnectedBanner";

const POLL_INTERVAL = 500;
const STARTUP_TIMEOUT = 30_000;

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const { status, setStatus } = useBackendStore();
  const { theme } = useThemeStore();
  const startTimeRef = useRef(Date.now());
  const reconnectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Apply persisted theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Startup polling
  useEffect(() => {
    if (status !== "starting") return;

    const interval = setInterval(async () => {
      const ok = await checkHealth();
      if (ok) {
        clearInterval(interval);
        setStatus("ready");
      } else if (Date.now() - startTimeRef.current > STARTUP_TIMEOUT) {
        clearInterval(interval);
        setStatus("failed", "后端服务启动超时（30秒），请检查环境或重试。");
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [status, setStatus]);

  // Disconnection monitoring while ready
  useEffect(() => {
    if (status !== "ready") return;

    const interval = setInterval(async () => {
      const ok = await checkHealth();
      if (!ok) {
        setStatus("disconnected");
      }
    }, 3000);

    reconnectIntervalRef.current = interval;
    return () => clearInterval(interval);
  }, [status, setStatus]);

  // Auto-reconnect when disconnected
  useEffect(() => {
    if (status !== "disconnected") return;

    const interval = setInterval(async () => {
      const ok = await checkHealth();
      if (ok) {
        clearInterval(interval);
        setStatus("ready");
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [status, setStatus]);

  if (status === "starting") return <StartingScreen />;
  if (status === "failed") return (
    <FailedScreen onRetry={() => { startTimeRef.current = Date.now(); setStatus("starting"); }} />
  );

  return (
    <BrowserRouter>
      {status === "disconnected" && <DisconnectedBanner />}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings/rule-sets" element={<RuleSetPage />} />
        <Route path="/settings/models" element={<SettingsPage />} />
        <Route path="/settings/prompts" element={<PromptProfilesPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/workspace/:id/settings" element={<WorkspaceSettingsPage />} />
        <Route path="/workspace/:id" element={<WorkspacePage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/help/:doc" element={<HelpPage />} />
        <Route path="/help" element={<Navigate to="/help/getting-started" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
