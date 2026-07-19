// Thin fetch wrapper. All pages call the backend through `api`.
// Requests go to /api/* and are proxied to the backend by Vite (see vite.config.ts).

const TOKEN_KEY = "hris_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(
  method: string,
  path: string,
  body?: unknown,
  opts: { raw?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // An expired/invalid token is unrecoverable for every page — clear it and
  // send the user back to sign in, instead of leaving a generic error banner.
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    setToken(null);
    window.location.href = "/login";
  }

  if (opts.raw) {
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    return (await res.blob()) as unknown as T;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>("GET", path),
  post: <T = any>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T = any>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T = any>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T = any>(path: string) => request<T>("DELETE", path),
  blob: (path: string) => request<Blob>("GET", path, undefined, { raw: true }),
};

// Trigger a browser download from a backend export endpoint (xlsx / csv).
export async function download(path: string, filename: string) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
