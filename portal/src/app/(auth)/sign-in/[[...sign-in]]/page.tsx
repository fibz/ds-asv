import Link from "next/link";

// Keycloak is the session IdP (design §7.1 — Clerk was replaced). The
// "Sign in" button starts the real Keycloak authorization-code flow
// (/api/auth/login → Keycloak → /api/auth/callback), which sets the httpOnly
// `asv_session` cookie; every dashboard request then verifies that token and
// records the access in the Session registry (revocable in /access).
export default function SignInPage() {
  const issuer = process.env.KEYCLOAK_ISSUER ?? "";
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
