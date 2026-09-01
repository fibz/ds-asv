"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Transport shapes — built server-side from the scope/scan services (see page.tsx).
// Explicit plain objects so the client never depends on Prisma relation
// presence at runtime.
export interface ApprovedScopeVersionRow {
  id: string;
  scopeSetId: string;
  scopeSetName: string;
  versionNumber: number;
  createdAt: string; // ISO
  assetIds: string[];
}

export interface ScanRow {
  id: string;
  name: string;
  status: string; // PENDING | RUNNING | COMPLETED | FAILED
  createdAt: string; // ISO
  targetCount: number;
}

const SCAN_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  RUNNING: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

function failureMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function ScannerClient({
  approvedScopeVersions,
  scans,
}: {
  approvedScopeVersions: ApprovedScopeVersionRow[];
  scans: ScanRow[];
}) {
  const router = useRouter();

  // Default to the newest approved version (the defensible current scope).
  const [selectedVersionId, setSelectedVersionId] = useState(
    approvedScopeVersions[0]?.id ?? ""
  );
  const [scanName, setScanName] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");

  const selected =
    approvedScopeVersions.find((v) => v.id === selectedVersionId) ?? null;

  async function runScan(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !scanName.trim()) return;
    setRunning(true);
    setRunError("");
    try {
      const res = await fetch("/api/v1/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: scanName, assetIds: selected.assetIds }),
      });
      if (res.ok) {
        setScanName("");
        router.refresh();
      } else {
        setRunError(await errorMessage(res, "Running scan failed"));
      }
    } catch (e) {
      setRunError(failureMessage(e, "Running scan failed"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Run new scan */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Run new scan</h2>
        {approvedScopeVersions.length === 0 ? (
          <p className="text-sm text-gray-500">
            No approved scope yet — define and approve scope under{" "}
            <Link href="/scope" className="font-medium text-indigo-600 hover:underline">
              Scope
            </Link>
            . Scans can only run against approved scope versions.
          </p>
        ) : (
          <form onSubmit={runScan} className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-52">
              <label htmlFor="scan-name" className="block text-sm font-medium text-gray-700 mb-1">
                Scan name
              </label>
              <input
                id="scan-name"
                required
                maxLength={200}
                value={scanName}
                onChange={(e) => setScanName(e.target.value)}
                placeholder="e.g. ASV re-scan — Q3"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="flex-1 min-w-52">
              <label htmlFor="scope-version" className="block text-sm font-medium text-gray-700 mb-1">
                Approved scope version
              </label>
              <select
                id="scope-version"
                value={selectedVersionId}
                onChange={(e) => setSelectedVersionId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                {approvedScopeVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.scopeSetName} — v{v.versionNumber} ({v.assetIds.length} assets)
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={running || !scanName.trim() || !selected || selected.assetIds.length === 0}
              className="mt-6 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium disabled:opacity-50"
            >
              {running ? "Running…" : "Run Scan"}
            </button>
          </form>
        )}
        {runError && <p className="text-sm text-red-600 mt-2">{runError}</p>}
      </div>

      {/* Recent scans */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Scans</h2>
        {scans.length === 0 ? (
          <p className="text-sm text-gray-500">
            No scans yet. Pick an approved scope version above and run your first scan.
          </p>
        ) : (
          <ul className="space-y-3">
            {scans.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{s.name}</p>
                  <p className="text-sm text-gray-500">
                    {s.targetCount} target{s.targetCount === 1 ? "" : "s"} ·{" "}
                    {s.createdAt.slice(0, 16).replace("T", " ")}
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    SCAN_STATUS_STYLES[s.status] ?? "bg-gray-100 text-gray-700"
                  }`}
                >
                  {s.status.toUpperCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}