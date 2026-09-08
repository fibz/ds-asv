import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listQsaAssignments, listQsaCandidateReports } from "@/lib/qsa/assignment";
import { AssignmentTable } from "@/components/qsa/AssignmentTable";

export default async function QsaHomePage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!ctx.isStaff) redirect("/customer");
  const [assignments, candidates] = await Promise.all([listQsaAssignments(ctx), listQsaCandidateReports(ctx)]);
  const active = assignments.filter((row) => ["queued", "assigned", "in_review"].includes(row.status));
  return <div className="space-y-8"><div><p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">QSA Review Portal</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Assignment control center</h1><p className="mt-2 text-slate-600">Manually assign submitted reports, review evidence, and close the audit trail.</p></div><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Link href="/qsa/queue" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Shared queue</p><p className="mt-2 text-3xl font-bold text-slate-950">{assignments.filter((row) => row.status === "queued").length}</p></Link><Link href="/qsa/assignments" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Active assignments</p><p className="mt-2 text-3xl font-bold text-slate-950">{active.length}</p></Link><div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Available reports</p><p className="mt-2 text-3xl font-bold text-slate-950">{candidates.length}</p></div></div><div className="flex gap-3"><Link href="/qsa/queue" className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white">Open shared queue</Link><Link href="/qsa/assignments" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">View assignments</Link></div><section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-950">Recent active work</h2><Link href="/qsa/assignments" className="text-sm font-semibold text-cyan-700 hover:underline">View all</Link></div><AssignmentTable assignments={active.slice(0, 8)} currentUserId={ctx.userId} /></section></div>;
}
