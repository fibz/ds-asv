"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QsaAssignmentRow } from "@/lib/qsa/types";

export function AssignmentTable({ assignments, currentUserId }: { assignments: QsaAssignmentRow[]; currentUserId: string }) {
  const router = useRouter();
  async function claim(id: string) {
    const response = await fetch(`/api/v1/qsa/assignments/${id}/claim`, { method: "POST" });
    if (response.ok) router.refresh();
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="p-3">Report</th><th className="p-3">Status</th><th className="p-3">Reviewer</th><th className="p-3">Due</th><th className="p-3" /></tr></thead>
        <tbody>
          {assignments.map((assignment) => (
            <tr key={assignment.id} className="border-b border-slate-100 last:border-0">
              <td className="p-3"><Link href={`/qsa/assignments/${assignment.id}`} className="font-medium text-cyan-700 hover:underline">{assignment.reportId}</Link><p className="text-xs text-slate-500">Customer {assignment.customerOrganizationId}</p></td>
              <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-700">{assignment.status.replace("_", " ")}</span></td>
              <td className="p-3 text-slate-600">{assignment.assigneeUserId ?? "Shared queue"}{assignment.assigneeUserId === currentUserId ? " (you)" : ""}</td>
              <td className="p-3 text-slate-600">{assignment.dueAt ? new Date(assignment.dueAt).toLocaleDateString() : "—"}</td>
              <td className="p-3 text-right">{assignment.status === "queued" ? <button type="button" onClick={() => { void claim(assignment.id); }} className="rounded-md bg-cyan-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-800">Claim</button> : <Link href={`/qsa/assignments/${assignment.id}`} className="text-xs font-semibold text-cyan-700 hover:underline">Open</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {assignments.length === 0 && <p className="p-6 text-sm text-slate-500">No assignments match this view.</p>}
    </div>
  );
}
