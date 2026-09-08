import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { can } from "@/lib/auth/rbac";
import { tenantContextFromRequest } from "@/lib/tenant";
import { getScopeVersion, listScopeSets } from "@/lib/scope/service";
import { listReports, isReportFinal } from "@/lib/scan/report";
import { listScans } from "@/lib/scan/service";

export default async function CustomerReportsPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "report.view")) return <div className="space-y-8"><h1 className="text-2xl font-bold text-gray-900">Reports</h1><p className="text-gray-600">Insufficient permissions — report.view is required to view reports.</p></div>;
  const [reports, scans, scopeSets] = await Promise.all([listReports(ctx), listScans(ctx), listScopeSets(ctx)]);
  const scanNames = new Map(scans.map((scan) => [scan.id, scan.name]));
  const scopeNames = new Map(scopeSets.map((set) => [set.id, set.name]));
  const rows = await Promise.all(reports.map(async (report) => {
    const scope = report.scopeVersionId ? await getScopeVersion(ctx, report.scopeVersionId) : null;
    const approvedScopeVersionId = scope?.status === "approved" ? scope.id : null;
    return { report, scope, scopeName: scope ? `${scopeNames.get(scope.scopeSetId) ?? "Scope"} — v${scope.versionNumber}` : null, isFinal: isReportFinal({ status: report.status, scopeVersionId: report.scopeVersionId, approvedScopeVersionId }), scanName: scanNames.get(report.scanId) ?? report.scanId.slice(0, 8) };
  }));
  return <div className="space-y-8"><div><h1 className="text-2xl font-bold text-gray-900">Reports</h1><p className="text-gray-600">Generated reports with scope authority, attestation, and finalization status.</p></div><div className="bg-white rounded-lg shadow border border-gray-200 p-6"><h2 className="text-lg font-semibold text-gray-900 mb-4">All Reports</h2>{rows.length === 0 ? <p className="text-sm text-gray-500">No reports yet — complete a scan and generate its report to see it here.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-gray-500 border-b"><th className="py-2 pr-4">Scan</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Scope</th><th className="py-2 pr-4">Attestation</th><th className="py-2 pr-4">Gate</th></tr></thead><tbody>{rows.map(({ report, scopeName, isFinal, scanName }) => <tr key={report.id} className="border-b border-gray-100"><td className="py-3 pr-4"><Link className="font-medium text-indigo-600 hover:underline" href={`/customer/reports/${report.id}`}>{scanName}</Link><p className="text-xs text-gray-500">{report.createdAt.toISOString().slice(0, 16).replace("T", " ")}</p></td><td className="py-3 pr-4">{report.status.toUpperCase()}</td><td className="py-3 pr-4">{scopeName ?? "none"}</td><td className="py-3 pr-4">{report.attestation?.status?.toUpperCase() ?? "NOT SUBMITTED"}</td><td className="py-3 pr-4">{isFinal ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-600 text-white">FINAL</span> : <span className="text-xs text-gray-400">Not final</span>}</td></tr>)}</tbody></table></div>}</div><p className="text-sm text-gray-500">Final means attested and backed by an approved scope version.</p></div>;
}
