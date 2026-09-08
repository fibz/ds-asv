import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { can } from "@/lib/auth/rbac";
import { tenantContextFromRequest } from "@/lib/tenant";
import { hashToken, listActiveSessions } from "@/lib/org/sessions";
import { sessionTokenFromRequest } from "@/lib/auth/session-cookie";
import { SessionTable } from "@/components/dashboard/SessionTable";

export default async function CustomerAccessPage() {
  const requestHeaders = await headers();
  const ctx = await tenantContextFromRequest({ headers: requestHeaders });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "team.view")) redirect("/customer");
  const requestToken = sessionTokenFromRequest({ headers: requestHeaders });
  const currentHash = requestToken ? hashToken(requestToken) : null;
  const sessions = (await listActiveSessions(ctx)).map((session) => ({ id: session.id, userId: session.userId, userAgent: session.userAgent ?? "unknown", lastSeenAt: session.lastSeenAt.toISOString(), createdAt: session.createdAt.toISOString(), isCurrent: currentHash !== null && session.tokenHash === currentHash }));
  return <div className="space-y-8"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-900">Access</h1><p className="text-gray-600">Active sessions. Revoking a session forces a fresh login.</p></div><Link href="/customer/api-keys" className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Manage API keys</Link></div><div className="bg-white rounded-lg shadow border border-gray-200 p-6"><SessionTable sessions={sessions} currentUserId={ctx.userId} /></div></div>;
}
