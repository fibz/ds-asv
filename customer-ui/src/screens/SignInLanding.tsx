// customer-ui/src/screens/SignInLanding.tsx
import { useSearchParams } from "react-router-dom";
import { signInUrl } from "../lib/auth/auth";
import { PRODUCT_NAME } from "../lib/brand";

const REASON: Record<string, string> = {
  expired: "Your session has expired. Sign in again to continue where you left off.",
  "signed-out": "You have signed out. Sign in to get back to your compliance dashboard.",
};

export function SignInLanding() {
  const [params] = useSearchParams();
  const reason = params.get("reason") ?? "";
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-[420px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] p-8">
        <div className="text-[18px] font-semibold">{PRODUCT_NAME}</div>
        <p className="text-[14px] text-[var(--ink-muted)] mt-2">
          Track your quarterly PCI ASV scans, scope approvals and compliance reports in one place.
        </p>
        {REASON[reason] ? (
          <p className="text-[13px] mt-4 border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--ink-muted)]">
            {REASON[reason]}
          </p>
        ) : null}
        <a
          href={signInUrl()}
          className="mt-6 inline-flex w-full items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2.5"
        >
          Continue with Keycloak
        </a>
      </div>
    </main>
  );
}
