const BASE_URL = "http://127.0.0.1:7821";
export const BACKEND_URL = BASE_URL;

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  let res: Response;
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json", ...fetchOptions.headers },
      signal,
      ...fetchOptions,
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("请求超时：模型响应时间过长，请稍后重试");
    }
    throw new Error(`网络错误：无法连接到后端服务（${BASE_URL}）`);
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
  const res = await fetch(`${BASE_URL}${path}`, {
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

/**
 * POST to an SSE endpoint and return the first `event: result` payload.
 * Ignores `: keepalive` comments. Throws on `event: error`.
 */
export async function apiPostSSE<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`网络错误：无法连接到后端服务（${BASE_URL}）`);
  }
  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try { const b = await res.json(); detail = b.detail ?? b.message ?? detail; } catch {}
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
        const data = JSON.parse(line.slice(6).trim());
        if (currentEvent === "result") return data as T;
        if (currentEvent === "error") throw new Error(data.message ?? "Unknown error");
      }
      // `: keepalive` lines (starting with ":") are silently ignored
    }
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

