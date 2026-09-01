import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listReports, isReportFinal } from "@/lib/scan/report";
import { listScans } from "@/lib/scan/service";
import { getScopeVersion, listScopeSets } from "@/lib/scope/service";

// Transport rows — plain serializable objects, no Prisma relations crossing
// the server component boundary.
interface ReportRow {
  id: string;
  scanName: string;
  status: string;
  createdAt: string;
  scopeLabel: string | null; // null → no linkable scope version
  scopeApproved: boolean;
  attestationStatus: string | null;
  isFinal: boolean;
}

const REPORT_STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-amber-100 text-amber-800",
  attested: "bg-green-100 text-green-800",
};

const ATTESTATION_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-amber-100 text-amber-800",
  attested: "bg-green-100 text-green-800",
};

export default async function ReportsPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");

  // Read gate: server-component reads don't pass through the API role gates,
  // so gate here — can() relaxes in dev/test, but in prod only members with
  // report.view may see report data.
  if (!can(ctx, "report.view")) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600">
            Insufficient permissions — report.view is required to view reports.
          </p>
        </div>
      </div>
    );
  }

  const [reports, scans, scopeSets] = await Promise.all([
    listReports(ctx),
    listScans(ctx),
    listScopeSets(ctx),
  ]);

  const scanNameById = new Map(scans.map((s) => [s.id, s.name]));
  const scopeSetNameById = new Map(scopeSets.map((s) => [s.id, s.name]));

  const rows: ReportRow[] = await Promise.all(
    reports.map(async (r) => {
      // Resolve the report's recorded scope version (immutable snapshot; plain
      // column, no FK). The finalization gate reads its id as
      // approvedScopeVersionId ONLY when the version actually exists AND is
      // approved — a draft/submitted link (dev-forced) must never badge a
      // report FINAL, per "attested ✓ AND scope version approved ✓".
      const scope = r.scopeVersionId ? await getScopeVersion(ctx, r.scopeVersionId) : null;
      // scope.id IS r.scopeVersionId by construction (resolved FROM that id),
      // so the strict equality in isReportFinal is trivially true when this is
      // non-null — the meaningful check is the approval status. Don't "fix"
      // this into the literal formula.
      const approvedScopeVersionId = scope?.status === "approved" ? scope.id : null;
      const scopeLabel = scope
        ? `${scopeSetNameById.get(scope.scopeSetId) ?? "Scope"} — v${scope.versionNumber}`
        : null;

      return {
        id: r.id,
        scanName: scanNameById.get(r.scanId) ?? r.scanId.slice(0, 8),
        status: r.status,
        createdAt: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
        scopeLabel,
        scopeApproved: scope?.status === "approved",
        attestationStatus: r.attestation?.status ?? null,
        isFinal: isReportFinal({
          status: r.status,
          scopeVersionId: r.scopeVersionId,
          approvedScopeVersionId,
        }),
      };
    })
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-600">
          Generated PCI reports with their attestation and scope-version authority.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">All Reports</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">
            No reports yet — complete a scan and generate its report to see it here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4 font-medium">Scan</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Scope</th>
                  <th className="py-2 pr-4 font-medium">Attestation</th>
                  <th className="py-2 pr-4 font-medium">Gate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-gray-900">{r.scanName}</p>
                      <p className="text-xs text-gray-500">{r.createdAt}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          REPORT_STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {r.scopeLabel ? (
                        <Link
                          href="/scope"
                          className="text-indigo-600 hover:underline"
                          title={r.scopeApproved ? "Approved scope version" : "Scope version (not approved)"}
                        >
                          {r.scopeLabel}
                          {r.scopeApproved ? " ✓" : ""}
                        </Link>
                      ) : (
                        <span className="text-gray-400">none</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {r.attestationStatus ? (
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            ATTESTATION_STYLES[r.attestationStatus] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {r.attestationStatus.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-gray-400">not submitted</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {r.isFinal ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-600 text-white">
                          FINAL
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500">
        Report is final only when attested ✓ AND its scope version is approved ✓.
      </p>
    </div>
  );
}