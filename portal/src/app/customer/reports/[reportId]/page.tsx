import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { can } from "@/lib/auth/rbac";
import { tenantContextFromRequest } from "@/lib/tenant";
import { getScopeVersion } from "@/lib/scope/service";
import { listFindings } from "@/lib/scan/findings";
import { getReport, isReportFinal } from "@/lib/scan/report";
import { getScan } from "@/lib/scan/service";

export default async function CustomerReportDetailPage({ params }: { params: Promise<{ reportId: string }> }) {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "report.view")) return <p className="text-gray-600">Insufficient permissions — report.view is required to view reports.</p>;
  const { reportId } = await params;
  const report = await getReport(ctx, reportId);
  if (!report) notFound();
  const scan = await getScan(ctx, report.scanId);
  if (!scan) notFound();
  const findings = await listFindings(ctx, report.scanId);
  const scope = report.scopeVersionId ? await getScopeVersion(ctx, report.scopeVersionId) : null;
  const approvedScopeVersionId = scope?.status === "approved" ? scope.id : null;
  const final = isReportFinal({ status: report.status, scopeVersionId: report.scopeVersionId, approvedScopeVersionId });
  const summary = (report.summary ?? {}) as { vulnerabilities?: number; averageRisk?: number; compliance?: string };
  const attestation = report.attestation as { status?: string } | null;
  return <div className="space-y-8 max-w-5xl"><div className="flex items-start justify-between gap-4"><div><Link href="/customer/reports" className="text-sm text-indigo-600 hover:underline">← All reports</Link><h1 className="mt-2 text-2xl font-bold text-gray-900">{scan.name}</h1><p className="text-sm text-gray-500">Created {report.createdAt.toISOString().slice(0, 16).replace("T", " ")}</p></div><a href={`/api/v1/reports/${report.id}/download`} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm">Download report</a></div><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><div className="bg-white rounded-lg border p-4"><p className="text-xs text-gray-500">Status</p><p className="mt-1 font-semibold">{report.status.toUpperCase()}</p></div><div className="bg-white rounded-lg border p-4"><p className="text-xs text-gray-500">Findings</p><p className="mt-1 font-semibold">{summary.vulnerabilities ?? findings.length}</p></div><div className="bg-white rounded-lg border p-4"><p className="text-xs text-gray-500">Scope</p><p className="mt-1 font-semibold">{scope?.status?.toUpperCase() ?? "NONE"}</p></div><div className="bg-white rounded-lg border p-4"><p className="text-xs text-gray-500">Finalization</p><p className="mt-1 font-semibold">{final ? "FINAL" : "NOT FINAL"}</p></div></div><div className="bg-white rounded-lg border p-6"><h2 className="text-lg font-semibold text-gray-900">Authority and attestation</h2><dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-gray-500">Scope version</dt><dd>{scope ? `v${scope.versionNumber} — ${scope.status}` : "No linked scope version"}</dd></div><div><dt className="text-gray-500">Attestation</dt><dd>{attestation?.status ?? "Not submitted"}</dd></div><div><dt className="text-gray-500">Compliance result</dt><dd>{summary.compliance ?? "Observed result unavailable"}</dd></div><div><dt className="text-gray-500">Average risk</dt><dd>{summary.averageRisk ?? "—"}</dd></div></dl></div><div className="bg-white rounded-lg border p-6"><h2 className="text-lg font-semibold text-gray-900 mb-4">Findings</h2>{findings.length === 0 ? <p className="text-sm text-gray-500">No findings recorded for this scan.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-gray-500 border-b"><th className="py-2 pr-4">Severity</th><th className="py-2 pr-4">Title</th><th className="py-2 pr-4">QID</th><th className="py-2 pr-4">CVE</th></tr></thead><tbody>{findings.map((finding) => <tr key={finding.id} className="border-b border-gray-100"><td className="py-3 pr-4">{finding.severity}</td><td className="py-3 pr-4">{finding.title}</td><td className="py-3 pr-4 font-mono">{finding.qid}</td><td className="py-3 pr-4">{finding.cveId ?? "—"}</td></tr>)}</tbody></table></div>}</div></div>;
}
