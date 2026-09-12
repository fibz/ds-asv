export class ApiError extends Error {
  // Explicitly declared + assigned rather than a constructor parameter property:
  // tsconfig sets `erasableSyntaxOnly`, which forbids parameter properties.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const SAFE_MESSAGES: Record<number, string> = {
  400: "That request was rejected. Check the values and try again.",
  401: "Your session has expired. Sign in again to continue.",
  403: "Your role does not allow this action. Ask an organisation owner if you need access.",
  404: "Not found in this organisation.",
  409: "That conflicts with something that already exists.",
  500: "The service could not complete that request. Try again, and contact support if it persists.",
};

// T defaults to `unknown`, never `any`: an unannotated call site must not
// silently acquire an untyped value. Every real caller in queries.ts passes an
// explicit response shape.
export async function apiGet<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) {
    throw new ApiError(SAFE_MESSAGES[res.status] ?? "That request failed.", res.status);
  }
  return (await res.json()) as T;
}

/**
 * The one write primitive. Same prefix, same cookie, same sanitising as
 * `apiGet`: a failed status becomes an `ApiError` carrying the SAFE_MESSAGES
 * copy, never the server's raw text (which can leak internals).
 *
 * The body is serialised ONLY when one is given. A submit POST carries no
 * body, and `JSON.stringify(undefined)` is the literal string "undefined" —
 * a payload the route never asked for and would parse as garbage.
 */
export async function apiPost<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  if (!res.ok) {
    throw new ApiError(SAFE_MESSAGES[res.status] ?? "That request failed.", res.status);
  }
  return (await res.json()) as T;
}
