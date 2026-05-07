import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { attachConsole, error as logError } from "@tauri-apps/plugin-log";
import App from "./App";
import "./index.css";

// Whether Tauri runtime is available (false in plain browser / Playwright headless)
const isTauri = typeof window !== "undefined" &&
  !!(window as Record<string, unknown>)["__TAURI_INTERNALS__"];

async function bootstrap() {
  // Wait for console→tauri-plugin-log bridge before mounting React,
  // so all console.info/warn/error calls are captured in app.log.
  // Guard against non-Tauri environments (browser dev mode, Playwright smoke tests).
  if (isTauri) {
    try {
      await attachConsole();
    } catch {
      // attachConsole failing is non-fatal; logging falls back to browser console
    }
  }

  // Capture unhandled JS errors
  window.addEventListener("error", (event) => {
    if (isTauri) {
      logError(`[unhandled error] ${event.message} at ${event.filename}:${event.lineno}`).catch(() => {});
    }
  });

  // Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    if (isTauri) {
      const reason = event.reason instanceof Error
        ? `${event.reason.message}\n${event.reason.stack ?? ""}`
        : String(event.reason);
      logError(`[unhandled rejection] ${reason}`).catch(() => {});
    }
  });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
      },
    },
  });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

bootstrap();
