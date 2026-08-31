import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listAuditEvents } from "@/lib/audit";
import { AuditTable } from "@/components/dashboard/AuditTable";

export default async function AuditPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "audit.view")) redirect("/dashboard");
  const { events } = await listAuditEvents(ctx, { limit: 50 });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit trail</h1>
        <p className="text-gray-600">Append-only record of security-relevant actions.</p>
      </div>
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <AuditTable
          events={events.map((e) => ({
            id: e.id, action: e.action, resourceType: e.resourceType,
            resourceId: e.resourceId, actorUserId: e.actorUserId, reason: e.reason,
            createdAt: e.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
