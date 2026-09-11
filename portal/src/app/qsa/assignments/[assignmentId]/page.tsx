import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AssignmentTable } from "@/components/qsa/AssignmentTable";
import { ReviewWorkspace } from "@/components/qsa/ReviewWorkspace";
import { getQsaReview } from "@/lib/qsa/review";
import { listQsaAssignments } from "@/lib/qsa/assignment";
import { tenantContextFromRequest } from "@/lib/tenant";

export default async function QsaAssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!ctx.isStaff) redirect("/customer");
  const { assignmentId } = await params;
  const assignment = (await listQsaAssignments(ctx)).find((row) => row.id === assignmentId);
  if (!assignment) notFound();
  const review = await getQsaReview(ctx, assignmentId);
  if (!review) return <div className="space-y-6"><div><p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">Assignment detail</p><h1 className="mt-1 text-2xl font-bold text-slate-950">{assignment.reportId}</h1><p className="mt-1 text-slate-600">This job is {assignment.status.replace("_", " ")}. A reviewer must claim or receive it before evidence is available.</p></div><AssignmentTable assignments={[assignment]} currentUserId={ctx.userId} /></div>;
  return <ReviewWorkspace view={review} />;
}
