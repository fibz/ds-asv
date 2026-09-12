// customer-ui/src/lib/auth/session-expiry.ts
import { ApiError } from "../api/client";

/**
 * The one URL an expired session lands on. Kept here, not spelled out at the
 * call site, so the redirect and the sign-in landing agree on one reason token.
 */
export const SESSION_EXPIRED_PATH = "sign-in?reason=expired";

/**
 * The single decision: which URL (if any) a failed request should send the
 * browser to. Only 401 qualifies - a 403 is a permission problem that belongs
 * on the screen it happened on, not a redirect.
 *
 * Pure by design: the base is passed in (the app supplies Vite's BASE_URL,
 * `/app/`), so the policy never hardcodes a prefix and is trivially testable.
 */
export function sessionExpiryRedirect(error: unknown, baseUrl: string): string | null {
  if (error instanceof ApiError && error.status === 401) {
    return `${baseUrl}${SESSION_EXPIRED_PATH}`;
  }
  return null;
}
