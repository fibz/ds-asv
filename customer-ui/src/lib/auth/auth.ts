/**
 * The only module that knows the session topology (spec section 7): same-origin
 * behind a reverse proxy, reusing the portal's Keycloak code flow.
 *
 * Verified against portal/src/app/api/auth/{login,logout}/route.ts:
 * - login takes NO query parameters (no returnTo); it redirects to Keycloak.
 * - logout: POST only. It revokes the session registry row, clears the
 *   `asv_session` cookie, and redirects to `/sign-in` (it does not return
 *   JSON), so the caller must submit a POST navigation — a plain GET on this
 *   URL is not a valid logout.
 */
export function signInUrl(): string {
  return "/api/auth/login";
}

export function signOutUrl(): string {
  return "/api/auth/logout";
}
