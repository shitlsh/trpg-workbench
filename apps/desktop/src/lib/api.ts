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
    if (err instanceof DOMException && err.name === "TimeoutError") {
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

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
