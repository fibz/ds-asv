/**
 * Secret bootstrap guard — "hardcoded dev DB passwords → env/Vault bootstrap
 * before any non-dev run" (tracked follow-up).
 *
 * Dev/test connect with hardcoded local credentials (portal/.env: `asv:asv` on
 * localhost, `dev-manifest-secret`, `dev-asv-client-secret-change-me`). Those
 * values must NEVER reach a non-dev run, where secrets are expected to be
 * injected from env / Vault. This pure guard hard-fails at startup when a
 * prod-mode run is still wired with a placeholder or dev credential — call it
 * from src/instrumentation.ts register() beside assertProdLock.
 *
 * Rules (checked only when appMode === "prod"; dev/test are unaffected):
 * - DATABASE_URL and ADMIN_DATABASE_URL must be set and carry a password that
 *   is not the local dev password (`:asv@`) nor a `CHANGE_ME` placeholder.
 * - MANIFEST_SECRET must be set and not the dev fallback.
 * - KEYCLOAK_CLIENT_SECRET must be set and not the dev realm secret.
 */

const DEV_DB_PASSWORD_MARKERS = [":asv@", ":CHANGE_ME@", "CHANGE_ME"];
const DEV_MANIFEST_SECRET = "dev-manifest-secret";
const DEV_KEYCLOAK_SECRETS = [
  "dev-asv-client-secret-change-me",
  "change-me",
  "CHANGE_ME",
];

function looksPlaceholderDb(url: string | undefined): boolean {
  if (!url) return true;
  return DEV_DB_PASSWORD_MARKERS.some((m) => url.includes(m));
}

function missingOrDev(value: string | undefined, devValues: string[]): boolean {
  if (!value) return true;
  const v = value.trim();
  return devValues.includes(v);
}

export function assertSecretsBootstrapped(
  appMode: string | undefined,
  env: {
    DATABASE_URL?: string;
    ADMIN_DATABASE_URL?: string;
    MANIFEST_SECRET?: string;
    KEYCLOAK_CLIENT_SECRET?: string;
  }
): void {
  const mode = appMode || "dev"; // mirrors getAppMode()'s default
  if (mode !== "prod") return;

  if (looksPlaceholderDb(env.DATABASE_URL)) {
    throw new Error(
      "Refusing to start in prod: DATABASE_URL is unset or still a dev/placeholder " +
        "credential — inject it from env/Vault before a non-dev run."
    );
  }
  if (looksPlaceholderDb(env.ADMIN_DATABASE_URL)) {
    throw new Error(
      "Refusing to start in prod: ADMIN_DATABASE_URL is unset or still a dev/placeholder " +
        "credential — inject it from env/Vault before a non-dev run."
    );
  }
  if (missingOrDev(env.MANIFEST_SECRET, [DEV_MANIFEST_SECRET])) {
    throw new Error(
      "Refusing to start in prod: MANIFEST_SECRET is unset or still the dev fallback " +
        "('dev-manifest-secret') — inject a real secret from env/Vault."
    );
  }
  if (missingOrDev(env.KEYCLOAK_CLIENT_SECRET, DEV_KEYCLOAK_SECRETS)) {
    throw new Error(
      "Refusing to start in prod: KEYCLOAK_CLIENT_SECRET is unset or still the dev " +
        "realm secret — inject the real confidential-client secret from env/Vault."
    );
  }
}
