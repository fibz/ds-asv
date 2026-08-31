import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listActiveSessions } from "@/lib/org/sessions";
import { SessionTable } from "@/components/dashboard/SessionTable";

export default async function AccessPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const sessions = (await listActiveSessions(ctx)).map((s) => ({
    id: s.id,
    userId: s.userId,
    userAgent: s.userAgent ?? "unknown",
    lastSeenAt: s.lastSeenAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    isCurrent: false,
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
