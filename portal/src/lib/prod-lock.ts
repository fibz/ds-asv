/**
 * Spec §6 prod-lock: "Prod is locked: refuse to start (or hard-fail) if gates
 * are disabled in prod."
 *
 * rbac.can() (see @/lib/auth/rbac) relaxes EVERY compliance/RBAC gate when
 * appMode !== "prod", so a production deployment accidentally started with
 * APP_MODE=dev (or unset) would run with every gate off — silently. This pure
 * guard hard-fails exactly that misconfiguration. It is called from
 * src/instrumentation.ts register() at server startup; keeping the check pure
 * (no env access, no imports) makes it trivially unit-testable.
 *
 * Rules:
 * - NODE_ENV === "production"  AND  appMode !== "prod"  -> throw (refuse to start)
 * - everything else passes (dev/test/local builds are unaffected).
 */
export function assertProdLock(
  nodeEnv: string | undefined,
  appMode: string | undefined
): void {
  const env = nodeEnv ?? "development";
  const mode = appMode || "dev"; // mirrors getAppMode()'s default in @/lib/tenant
  if (env === "production" && mode !== "prod") {
    throw new Error(
      "Refusing to start: APP_MODE must be 'prod' in production (gates disabled)."
    );
  }
}
