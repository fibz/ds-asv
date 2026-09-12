import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AssignmentTable } from "@/components/qsa/AssignmentTable";
import { listQsaAssignments } from "@/lib/qsa/assignment";
import { tenantContextFromRequest } from "@/lib/tenant";

export default async function QsaAssignmentsPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!ctx.isStaff) redirect("/customer");
  const assignments = await listQsaAssignments(ctx);
  return <div className="space-y-6"><div><h1 className="text-2xl font-bold text-slate-950">Assignments</h1><p className="mt-1 text-slate-600">Active work and immutable assignment history for this QSA organization.</p></div><AssignmentTable assignments={assignments} currentUserId={ctx.userId} /></div>;
}
