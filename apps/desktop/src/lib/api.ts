import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Backend URL resolution
//
// BASE_URL_PROMISE resolves exactly once to the correct backend origin.
// Every fetch helper awaits it, so callers never need to worry about
// calling initBackendUrl() at the right time — the Promise memoises the
// result for free.
//
// In browser dev mode (no Tauri runtime) invoke throws and we fall back to
// the hardcoded port 7821 after retries are exhausted.
// ---------------------------------------------------------------------------

const BASE_URL_FALLBACK = "http://127.0.0.1:7821";

const BASE_URL_PROMISE: Promise<string> = (async () => {
  // Retry for up to 3 seconds to handle Tauri webview initialisation delay.
  // CORS is handled server-side; the port is typically available within 1s.
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const port = await invoke<number>("get_backend_port");
      return `http://127.0.0.1:${port}`;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  // All retries exhausted — running in browser dev mode or Tauri init failed.
  return BASE_URL_FALLBACK;
})();

/** @deprecated Use the async fetch helpers directly; they await the URL internally. */
export const getBackendUrl = () => BASE_URL_FALLBACK;
/** @deprecated legacy alias */
export const BACKEND_URL = BASE_URL_FALLBACK;

/**
 * Warm up the URL resolution Promise eagerly.
 * Safe to call multiple times — the Promise is shared and only runs once.
 */
export async function initBackendUrl(): Promise<void> {
  await BASE_URL_PROMISE;
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const url = await BASE_URL_PROMISE;
  let res: Response;
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
  const url = await BASE_URL_PROMISE;
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
  const url = await BASE_URL_PROMISE;
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
    const url = await BASE_URL_PROMISE;
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
