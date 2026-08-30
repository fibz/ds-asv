import Link from "next/link";

// Keycloak is the session IdP (design §7.1 — Clerk was replaced). Account
// creation happens in the Keycloak realm; this page points there.
export default function SignUpPage() {
  const issuer = process.env.KEYCLOAK_ISSUER ?? "";
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow p-8 max-w-md w-full text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Create an account</h1>
        <p className="text-sm text-gray-600 mb-6">
          Accounts are provisioned in your self-hosted Keycloak realm, then
          invited into an organization from the portal.
        </p>
        {issuer ? (
          <a
            href={`${issuer.replace(/\/+$/, "")}/registrations/`}
            className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
          >
            Register in Keycloak
          </a>
        ) : (
          <p className="text-sm text-amber-600">
            KEYCLOAK_ISSUER is not set — token verification is unavailable.
          </p>
        )}
        <p className="mt-6 text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
