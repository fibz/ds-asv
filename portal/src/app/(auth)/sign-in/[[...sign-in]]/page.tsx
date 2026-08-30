import Link from "next/link";

// Keycloak is the session IdP (design §7.1 — Clerk was replaced). The
// Keycloak hosted-login / cookie-session wiring is a known follow-up; until
// it lands, the dashboard relies on header-based identity (Authorization:
// Bearer) and this page documents the intended login path.
export default function SignInPage() {
  const issuer = process.env.KEYCLOAK_ISSUER ?? "";
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow p-8 max-w-md w-full text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Sign in</h1>
        <p className="text-sm text-gray-600 mb-6">
          Authentication is provided by your self-hosted Keycloak realm.
          Cookie-session login is a known follow-up; until it lands, API
          requests authenticate via an <code className="font-mono">Authorization: Bearer</code> header.
        </p>
        {issuer ? (
          <a
            href={`${issuer.replace(/\/+$/, "")}/account/`}
            className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
          >
            Open Keycloak account
          </a>
        ) : (
          <p className="text-sm text-amber-600">
            KEYCLOAK_ISSUER is not set — token verification is unavailable.
          </p>
        )}
        <p className="mt-6 text-sm text-gray-500">
          <Link href="/dashboard" className="text-indigo-600 hover:underline">
            Continue to the dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
