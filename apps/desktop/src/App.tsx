import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { checkHealth } from "./lib/api";
import { useBackendStore } from "./stores/backendStore";
import StartingScreen from "./pages/StartingScreen";
import FailedScreen from "./pages/FailedScreen";
import HomePage from "./pages/HomePage";
import ModelProfilesPage from "./pages/ModelProfilesPage";
import WorkspaceSettingsPage from "./pages/WorkspaceSettingsPage";
import DisconnectedBanner from "./components/DisconnectedBanner";

const POLL_INTERVAL = 500;
const STARTUP_TIMEOUT = 30_000;

export default function App() {
  const { status, setStatus } = useBackendStore();
  const startTimeRef = useRef(Date.now());
  const reconnectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  if (status === "failed") return <FailedScreen onRetry={() => { startTimeRef.current = Date.now(); setStatus("starting"); }} />;

  return (
    <BrowserRouter>
      {status === "disconnected" && <DisconnectedBanner />}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings/models" element={<ModelProfilesPage />} />
        <Route path="/workspace/:id/settings" element={<WorkspaceSettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
