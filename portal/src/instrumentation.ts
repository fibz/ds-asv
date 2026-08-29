import { assertProdLock } from "@/lib/prod-lock";
import { getAppMode } from "@/lib/tenant";

/**
 * Server-startup guard (Next.js instrumentation). Spec §6: "Prod is locked:
 * refuse to start (or hard-fail) if gates are disabled in prod."
 *
 * rbac.can() relaxes every gate when appMode !== "prod", so a production box
 * started with APP_MODE=dev/unset would silently run with no RBAC enforcement.
 * register() runs when a Next server instance bootstraps (both `next start`
 * and `next build`), so this throws before the server serves a single request
 * under the misconfiguration. Dev/test/local runs are unaffected.
 */
export async function register() {
  assertProdLock(process.env.NODE_ENV, getAppMode());
}
