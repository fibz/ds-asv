import { assertProdLock } from "@/lib/prod-lock";
import { assertSecretsBootstrapped } from "@/lib/secret-bootstrap";
import { getAppMode } from "@/lib/tenant";

/**
 * Server-startup guards (Next.js instrumentation). Spec §6 prod-lock + the
 * secret-bootstrap follow-up:
 *
 * - assertProdLock: a production box started with APP_MODE=dev/unset would
 *   silently run with every RBAC gate relaxed — refuse to start.
 * - assertSecretsBootstrapped: a non-dev run still wired with the hardcoded
 *   local dev DB password / CHANGE_ME placeholders / dev manifest or Keycloak
 *   secrets must refuse to start — secrets come from env/Vault in non-dev.
 *
 * register() runs when a Next server instance bootstraps (both `next start`
 * and `next build`), so these throw before the server serves a single request
 * under the misconfiguration. Dev/test/local runs are unaffected.
 */
export async function register() {
  const appMode = getAppMode();
  assertProdLock(process.env.NODE_ENV, appMode);
  assertSecretsBootstrapped(appMode, {
    DATABASE_URL: process.env.DATABASE_URL,
    ADMIN_DATABASE_URL: process.env.ADMIN_DATABASE_URL,
    MANIFEST_SECRET: process.env.MANIFEST_SECRET,
    KEYCLOAK_CLIENT_SECRET: process.env.KEYCLOAK_CLIENT_SECRET,
  });
}
