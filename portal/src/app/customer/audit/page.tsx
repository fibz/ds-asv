import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/rbac";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listAuditEvents } from "@/lib/audit";
import { AuditTable } from "@/components/dashboard/AuditTable";

export default async function CustomerAuditPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "audit.view")) redirect("/customer");
  const { events } = await listAuditEvents(ctx, { limit: 50 });
  return <div className="space-y-8"><div><h1 className="text-2xl font-bold text-gray-900">Audit trail</h1><p className="text-gray-600">Append-only record of security-relevant actions.</p></div><div className="bg-white rounded-lg shadow border border-gray-200 p-6"><AuditTable events={events.map((event) => ({ id: event.id, action: event.action, resourceType: event.resourceType, resourceId: event.resourceId, actorUserId: event.actorUserId, reason: event.reason, createdAt: event.createdAt.toISOString() }))} /></div></div>;
}
