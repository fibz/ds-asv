import { useAuth } from "../auth/store";

/** Typed error from a normalized API response (spec §7.1). */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, detail?: string) {
    super(detail || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Explicit bearer token (login flow). Defaults to the session token. */
  token?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: string | undefined;
  try {
    const data = (await res.json()) as { detail?: unknown };
    if (typeof data.detail === "string") detail = data.detail;
    else if (data.detail !== undefined) detail = JSON.stringify(data.detail);
  } catch {
    // non-JSON body — fall back to status text
  }
  return new ApiError(res.status, detail ?? res.statusText);
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Typed fetch wrapper (plan Phase 3): attaches `Authorization: Bearer`,
 * normalizes non-2xx responses to {@link ApiError}, and clears the session on
 * a 401 that came from an authenticated request (spec §7.1 — redirect handled
 * by the route guard watching the store).
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const explicitToken = options.token;
  const sessionToken = useAuth.getState().token;
  const token = explicitToken ?? sessionToken;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    signal: options.signal,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const error = await parseError(res);
    // A session-bearing request that comes back 401 means the token expired:
    // clear the store (guard redirects to /login). Explicit-token calls (the
    // login page) keep their token out of the store and surface the error.
    if (error.status === 401 && !explicitToken && sessionToken) {
      useAuth.getState().clearSession("Session expired — please sign in again.");
    }
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
