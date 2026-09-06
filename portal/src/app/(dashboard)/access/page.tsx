import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { hashToken, listActiveSessions } from "@/lib/org/sessions";
import { sessionTokenFromRequest } from "@/lib/auth/session-cookie";
import { SessionTable } from "@/components/dashboard/SessionTable";

export default async function AccessPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "team.view")) redirect("/dashboard");
  // The request's own credential (Bearer or the portal session cookie) is the
  // session shown as "you".
  const requestToken = sessionTokenFromRequest({ headers: await headers() });
  const currentHash = requestToken ? hashToken(requestToken) : null;
  const sessions = (await listActiveSessions(ctx)).map((s) => ({
    id: s.id,
    userId: s.userId,
    userAgent: s.userAgent ?? "unknown",
    lastSeenAt: s.lastSeenAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    isCurrent: currentHash !== null && s.tokenHash === currentHash,
  }));
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Access</h1>
          <p className="text-gray-600">Active sessions. Revoking a session forces a fresh login.</p>
        </div>
        <Link href="/api-keys" className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Manage API keys</Link>
      </div>
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <SessionTable sessions={sessions} currentUserId={ctx.userId} />
      </div>
    </div>
  );
}
