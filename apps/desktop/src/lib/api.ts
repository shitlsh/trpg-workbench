import { invoke } from "@tauri-apps/api/core";

let BASE_URL = "http://127.0.0.1:7821";
export const getBackendUrl = () => BASE_URL;
/** @deprecated use getBackendUrl() for dynamic port */
export const BACKEND_URL = BASE_URL;

/**
 * Initialize the backend base URL by querying Tauri for the allocated port.
 * Must be called before any API requests are made.
 */
export async function initBackendUrl(): Promise<void> {
  // In browser dev mode (no Tauri), invoke will throw — keep default port.
  // In production, invoke may fail transiently if the webview is not yet fully
  // initialised when this is called. Retry until it succeeds so we always use
  // the correct randomly-allocated port rather than the hardcoded fallback.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const port = await invoke<number>("get_backend_port");
      BASE_URL = `http://127.0.0.1:${port}`;
      return;
    } catch {
      if (attempt === 0) {
        // First failure — likely running in browser dev mode, keep default port.
        // But we still try a few more times in case it's a timing issue.
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  // All retries exhausted — keep whatever BASE_URL is (default or last success).
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  let res: Response;
  const url = BASE_URL;
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    res = await fetch(`${url}${path}`, {
      headers: { "Content-Type": "application/json", ...fetchOptions.headers },
      signal,
      ...fetchOptions,
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("请求超时：模型响应时间过长，请稍后重试");
    }
    throw new Error(`网络错误：无法连接到后端服务（${url}）`);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? body.message ?? JSON.stringify(body);
    } catch {
      detail = (await res.text().catch(() => "")) || detail;
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Same as JSON GET, but also returns `X-Total-Count` when the backend sends it (e.g. chunk list). */
export async function apiFetchWithTotalCount<T>(path: string): Promise<{ data: T; total: number | null }> {
  const url = BASE_URL;
  const res = await fetch(`${url}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? body.message ?? JSON.stringify(body);
    } catch {
      detail = (await res.text().catch(() => "")) || detail;
    }
    throw new Error(detail);
  }
  const raw = res.headers.get("X-Total-Count");
  const total = raw != null && raw !== "" ? parseInt(raw, 10) : null;
  const data = (await res.json()) as T;
  return { data, total: Number.isFinite(total) ? total : null };
}

export type SSEProgressPayload = {
  phase: string;
  message?: string;
  detail?: Record<string, unknown>;
};

export type SSEHandlers = {
  onProgress?: (p: SSEProgressPayload) => void;
  onPartial?: (data: unknown) => void;
};

/**
 * POST to an SSE endpoint and return the first `event: result` payload.
 * Ignores `: keepalive` comments. Invokes optional handlers for `progress` / `partial`.
 * Throws on `event: error`.
 */
export async function apiPostSSEWithHandlers<T>(
  path: string,
  body: unknown,
  handlers?: SSEHandlers,
): Promise<T> {
  const url = BASE_URL;
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`网络错误：无法连接到后端服务（${url}）`);
  }
  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      detail = b.detail ?? b.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("SSE stream ended without result");

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (line === "") {
        currentEvent = "";
      } else if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6).trim()) as unknown;
        if (currentEvent === "result") return data as T;
        if (currentEvent === "error") {
          const msg = (data as { message?: string }).message ?? "Unknown error";
          throw new Error(msg);
        }
        if (currentEvent === "progress" && handlers?.onProgress) {
          handlers.onProgress(data as SSEProgressPayload);
        }
        if (currentEvent === "partial" && handlers?.onPartial) {
          handlers.onPartial(data);
        }
      }
      // `: keepalive` lines (starting with ":") are silently ignored
    }
  }
}

export async function apiPostSSE<T>(path: string, body: unknown): Promise<T> {
  return apiPostSSEWithHandlers<T>(path, body, undefined);
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
