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
