import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { checkHealth, initBackendUrl } from "./lib/api";
import { useBackendStore } from "./stores/backendStore";
import { useThemeStore, applyTheme } from "./stores/themeStore";
import StartingScreen from "./pages/StartingScreen";
import FailedScreen from "./pages/FailedScreen";
import HomePage from "./pages/HomePage";
import WorkspaceSettingsPage from "./pages/WorkspaceSettingsPage";
import SettingsPage from "./pages/SettingsPage";
import PromptProfilesPage from "./pages/PromptProfilesPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import HelpPage from "./pages/HelpPage";
import RuleSetPage from "./pages/RuleSetPage";
import SetupWizardPage from "./pages/SetupWizardPage";
import DisconnectedBanner from "./components/DisconnectedBanner";
import { useSettingsStore } from "./stores/settingsStore";
import { Toaster } from "sonner";

const POLL_INTERVAL = 500;
const STARTUP_TIMEOUT = 30_000;

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const { status, setStatus } = useBackendStore();
  const { theme } = useThemeStore();
  const { hasCompletedSetup, resetSetup } = useSettingsStore();
  const startTimeRef = useRef(Date.now());
  const reconnectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failedHealthChecksRef = useRef(0);

  // Apply persisted theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Dev: reset setup wizard if VITE_RESET_WIZARD=1
  useEffect(() => {
    if (import.meta.env.VITE_RESET_WIZARD === "1") {
      resetSetup();
      console.info("[dev] Setup wizard reset via VITE_RESET_WIZARD");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Startup polling: first resolve dynamic port, then poll /health
  useEffect(() => {
    if (status !== "starting") return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      await initBackendUrl();
      if (cancelled) return;

      interval = setInterval(async () => {
        const ok = await checkHealth();
        if (ok) {
          clearInterval(interval!);
          setStatus("ready");
        } else if (Date.now() - startTimeRef.current > STARTUP_TIMEOUT) {
          clearInterval(interval!);
          setStatus("failed", "后端服务启动超时（30秒），请检查环境或重试。");
        }
      }, POLL_INTERVAL);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [status, setStatus]);

  // Disconnection monitoring while ready
  useEffect(() => {
    if (status !== "ready") return;

    const interval = setInterval(async () => {
      const ok = await checkHealth();
      if (ok) {
        failedHealthChecksRef.current = 0;
      } else {
        failedHealthChecksRef.current += 1;
      }
      // Avoid false-positive disconnect banners during long file upload/index calls.
      if (failedHealthChecksRef.current >= 3) {
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
        failedHealthChecksRef.current = 0;
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
      <Toaster position="bottom-right" theme="dark" richColors />
      {status === "disconnected" && <DisconnectedBanner />}
      <Routes>
        <Route path="/setup" element={<SetupWizardPage />} />
        <Route path="/" element={hasCompletedSetup ? <HomePage /> : <Navigate to="/setup" replace />} />
        <Route path="/settings/rule-sets" element={<RuleSetPage />} />
        <Route path="/settings/models" element={<SettingsPage />} />
        <Route path="/settings/prompts" element={<PromptProfilesPage />} />
        <Route path="/workspace/:id/settings" element={<WorkspaceSettingsPage />} />
        <Route path="/workspace/:id" element={<WorkspacePage />} />
        <Route path="/help/:doc" element={<HelpPage />} />
        <Route path="/help" element={<Navigate to="/help/getting-started" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
