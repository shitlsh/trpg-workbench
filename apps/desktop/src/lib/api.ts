const BASE_URL = "http://127.0.0.1:7821";
export const BACKEND_URL = BASE_URL;

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json", ...options?.headers },
      ...options,
    });
  } catch (err) {
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
