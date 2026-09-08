import Link from "next/link";

// Keycloak is the session IdP (design §7.1 — Clerk was replaced). The
// "Sign in" button starts the real Keycloak authorization-code flow
// (/api/auth/login → Keycloak → /api/auth/callback), which sets the httpOnly
// `asv_session` cookie; every dashboard request then verifies that token and
// records the access in the Session registry (revocable in /access).
export default function SignInPage() {
  const issuer = process.env.KEYCLOAK_ISSUER ?? "";
  const devLoginEnabled = process.env.APP_MODE !== "prod";
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow p-8 max-w-md w-full text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Sign in</h1>
        <p className="text-sm text-gray-600 mb-6">
          Authentication is provided by your self-hosted Keycloak realm.
        </p>
        {issuer ? (
          <a
            href="/api/auth/login"
            className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
          >
            Sign in with Keycloak
          </a>
        ) : (
          <p className="text-sm text-amber-600">
            KEYCLOAK_ISSUER is not set — token verification is unavailable.
          </p>
        )}
        {devLoginEnabled && issuer && (
          <div className="mt-6 border-t border-gray-200 pt-5 space-y-2">
            <p className="text-xs uppercase tracking-wide text-gray-400">Local development</p>
            <div className="flex gap-2 justify-center">
              <a href="/api/auth/dev-login?role=customer" className="px-3 py-2 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50">Demo customer</a>
              <a href="/api/auth/dev-login?role=qsa" className="px-3 py-2 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50">Demo QSA</a>
            </div>
          </div>
        )}
        <p className="mt-6 text-sm text-gray-500">
          API access stays header-based: mint a token from your realm and send
          it as <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          <Link href="/customer" className="text-indigo-600 hover:underline">
            Continue to the dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
