import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { listQsaAssignments } from "@/lib/qsa/assignment";
import { tenantContextFromRequest } from "@/lib/tenant";

export default async function QsaReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!ctx.isStaff) redirect("/customer");
  const { reportId } = await params;
  const assignment = (await listQsaAssignments(ctx)).find((row) => row.reportId === reportId && ["queued", "assigned", "in_review"].includes(row.status));
  if (!assignment) notFound();
  redirect(`/qsa/assignments/${assignment.id}`);
}
