"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import type { QsaReviewView } from "@/lib/qsa/review";

export function reviewWorkspaceSections(view: QsaReviewView): string[] {
  return [
    `Customer: ${view.customer.name}`,
    `Report: ${view.report.status}`,
    `Scope: ${view.scope ? "attached" : "not attached"}`,
    `Findings: ${view.findings.length}`,
    `Disputes: ${view.disputes.length}`,
    `Final: ${view.isFinal ? "yes" : "no"}`,
  ];
}

function statusClass(status: string): string {
  if (status === "resolved" || status === "rejected" || status === "attested") return "bg-emerald-100 text-emerald-800";
  return "bg-amber-100 text-amber-800";
}

export function ReviewWorkspace({ view }: { view: QsaReviewView }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { assignment } = view;
  async function action(path: string, options?: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, options);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : "Request failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const openDisputes = view.disputes.filter((item) => typeof item === "object" && item !== null && "status" in item && (item as { status?: unknown }).status === "open");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">Assignment review</p><h1 className="mt-1 text-2xl font-bold text-slate-950">{view.customer.name}</h1><p className="mt-1 text-sm text-slate-600">Report {view.report.id} · Scan {view.scan.name}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${statusClass(view.report.status)}`}>{view.report.status}</span></div>
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">{reviewWorkspaceSections(view).slice(2).map((section) => <div key={section} className="rounded-lg border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">{section}</div>)}</div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3"><section className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2"><h2 className="text-lg font-semibold text-slate-950">Evidence</h2><p className="mt-1 text-sm text-slate-500">Approved-scope evidence, scan targets, and observed findings for this assignment.</p><div className="mt-4 space-y-3"><div><h3 className="text-sm font-semibold text-slate-700">Targets</h3><ul className="mt-1 list-disc pl-5 text-sm text-slate-600">{view.scan.targets.map((target, index) => <li key={index}>{String((target as { canonicalIdentifier?: unknown }).canonicalIdentifier ?? "Target")}</li>)}</ul></div><div><h3 className="text-sm font-semibold text-slate-700">Findings</h3>{view.findings.length === 0 ? <p className="mt-1 text-sm text-slate-500">No findings recorded.</p> : <ul className="mt-1 space-y-2">{view.findings.map((finding, index) => <li key={index} className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{String((finding as { title?: unknown }).title ?? "Finding")} <span className="text-xs text-slate-500">(severity {String((finding as { severity?: unknown }).severity ?? "—")})</span></li>)}</ul>}</div></div></section><aside className="space-y-6"><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold text-slate-950">Review controls</h2><p className="mt-1 text-sm text-slate-500">Assignment status: {assignment.status.replace("_", " ")}</p><div className="mt-4 flex flex-wrap gap-2">{assignment.status === "assigned" && <button disabled={busy} type="button" onClick={() => { void action(`/api/v1/qsa/assignments/${assignment.id}/start`, { method: "POST" }); }} className="rounded-md bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Start review</button>}{!view.isFinal && view.report.status === "submitted" && <button disabled={busy} type="button" onClick={() => { void action(`/api/v1/qsa/assignments/${assignment.id}/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }); }} className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Attest report</button>}{assignment.status === "in_review" && <button disabled={busy} type="button" onClick={() => { void action(`/api/v1/qsa/assignments/${assignment.id}/complete`, { method: "POST" }); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Complete assignment</button>}</div></section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold text-slate-950">Internal notes</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{assignment.notes ?? "No internal notes."}</p></section></aside></div>
      <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold text-slate-950">Disputes</h2>{openDisputes.length === 0 ? <p className="mt-2 text-sm text-slate-500">No open disputes.</p> : <ul className="mt-3 space-y-3">{openDisputes.map((dispute, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3"><span className="text-sm text-slate-700">{String((dispute as { justification?: unknown }).justification ?? "Dispute")}</span><div className="flex gap-2"><button disabled={busy} type="button" onClick={() => { void action(`/api/v1/qsa/assignments/${assignment.id}/disputes/${String((dispute as { id?: unknown }).id)}/moderate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "resolved" }) }); }} className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Resolve</button><button disabled={busy} type="button" onClick={() => { void action(`/api/v1/qsa/assignments/${assignment.id}/disputes/${String((dispute as { id?: unknown }).id)}/moderate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "rejected" }) }); }} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50">Reject</button></div></li>)}</ul>}</section>
    </div>
  );
}
