import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { attachConsole, error as logError } from "@tauri-apps/plugin-log";
import App from "./App";
import "./index.css";

async function bootstrap() {
  // Wait for console→tauri-plugin-log bridge before mounting React,
  // so all console.info/warn/error calls are captured in app.log.
  await attachConsole();

  // Capture unhandled JS errors
  window.addEventListener("error", (event) => {
    logError(`[unhandled error] ${event.message} at ${event.filename}:${event.lineno}`);
  });

  // Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error
      ? `${event.reason.message}\n${event.reason.stack ?? ""}`
      : String(event.reason);
    logError(`[unhandled rejection] ${reason}`);
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
