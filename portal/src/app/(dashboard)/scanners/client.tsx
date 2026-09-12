"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export interface ApprovedScopeVersionRow {
  id: string;
  scopeSetId: string;
  scopeSetName: string;
  versionNumber: number;
  createdAt: string;
  assetIds: string[];
}

export interface ScanRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  targetCount: number;
}

interface ScannerHealth {
  available: boolean;
  service?: string;
  version?: string;
  error?: string;
}

interface ScanDetail {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  targets: Array<{ id: string; canonicalIdentifier: string; type: string; status: string }>;
}

interface Finding {
  id: string;
  cveId?: string | null;
  severity: string;
  pciSeverity?: string | null;
  title: string;
  status: string;
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

function formatDate(value?: string | null): string {
  return value ? value.slice(0, 16).replace("T", " ") : "Not recorded";
}

async function readScannerHealth(): Promise<{ health: ScannerHealth | null; error: string }> {
  try {
    const res = await fetch("/api/v1/scanner/health", { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as ScannerHealth | { error?: string } | null;
    if (!res.ok) {
      return {
        health: null,
        error: body && "error" in body && body.error ? body.error : "Scanner health check failed",
      };
    }
    return { health: body as ScannerHealth, error: "" };
  } catch (e) {
    return { health: null, error: failureMessage(e, "Scanner health check failed") };
  }
}

export function ScannerClient({
  approvedScopeVersions,
  scans,
  canRun,
}: {
  approvedScopeVersions: ApprovedScopeVersionRow[];
  scans: ScanRow[];
  canRun: boolean;
}) {
  const router = useRouter();
  const [selectedVersionId, setSelectedVersionId] = useState(approvedScopeVersions[0]?.id ?? "");
  const [scanName, setScanName] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [health, setHealth] = useState<ScannerHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState("");
  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState("");
  const [operationMessage, setOperationMessage] = useState("");

  const selected = approvedScopeVersions.find((v) => v.id === selectedVersionId) ?? null;

  async function refreshHealth() {
    setHealthLoading(true);
    const result = await readScannerHealth();
    setHealth(result.health);
    setHealthError(result.error);
    setHealthLoading(false);
  }

  useEffect(() => {
    let active = true;
    void readScannerHealth().then((result) => {
      if (!active) return;
      setHealth(result.health);
      setHealthError(result.error);
      setHealthLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function inspectScan(scanId: string) {
    setInspectLoading(true);
    setInspectError("");
    setDispatchError("");
    try {
      const scanResponse = await fetch(`/api/v1/scans/${scanId}`, { cache: "no-store" });
      if (!scanResponse.ok) throw new Error(await errorMessage(scanResponse, "Unable to load scan details"));
      const findingsResponse = await fetch(`/api/v1/scans/${scanId}/findings`, { cache: "no-store" });
      if (!findingsResponse.ok) throw new Error(await errorMessage(findingsResponse, "Unable to load scan findings"));
      const scan = (await scanResponse.json()) as ScanDetail;
      const findingBody = (await findingsResponse.json()) as { findings?: Finding[] };
      setDetail(scan);
      setFindings(findingBody.findings ?? []);
    } catch (e) {
      setDetail(null);
      setFindings([]);
      setInspectError(failureMessage(e, "Unable to load scan details"));
    } finally {
      setInspectLoading(false);
    }
  }

  async function runScan(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !scanName.trim()) return;
    setRunning(true);
    setRunError("");
    setOperationMessage("");
    try {
      const res = await fetch("/api/v1/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: scanName, assetIds: selected.assetIds }),
      });
      if (!res.ok) {
        setRunError(await errorMessage(res, "Creating scan failed"));
        return;
      }
      const scan = (await res.json()) as { id: string };
      setScanName("");
      setOperationMessage("Scan created. Dispatch it when you are ready to begin.");
      router.refresh();
      await inspectScan(scan.id);
    } catch (e) {
      setRunError(failureMessage(e, "Creating scan failed"));
    } finally {
      setRunning(false);
    }
  }

  async function dispatchScan(scanId: string) {
    setDispatchingId(scanId);
    setDispatchError("");
    setOperationMessage("");
    try {
      const res = await fetch(`/api/v1/scans/${scanId}/dispatch`, { method: "POST" });
      if (!res.ok) {
        setDispatchError(await errorMessage(res, "Scanner dispatch failed"));
        return;
      }
      setOperationMessage("Scan manifest accepted by the scanner. Status and findings were refreshed.");
      router.refresh();
      await inspectScan(scanId);
    } catch (e) {
      setDispatchError(failureMessage(e, "Scanner dispatch failed"));
    } finally {
      setDispatchingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="bg-white rounded-lg shadow border border-gray-200 p-6" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Scanner operations</h2>
            <p className="mt-1 text-sm text-gray-500">The portal issues an expiring signed manifest; the configured scanner executes only its approved targets.</p>
          </div>
          <button type="button" onClick={() => void refreshHealth()} disabled={healthLoading} className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {healthLoading ? "Checking health…" : "Refresh health"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-900">Scanner API health</p>
            {healthLoading ? <p className="mt-1 text-sm text-gray-500">Checking configured scanner…</p> : health ? <p className="mt-1 text-sm text-green-700">Reachable: {health.service} v{health.version}</p> : <p className="mt-1 text-sm text-red-700">Unavailable: {healthError || "No health response"}</p>}
          </div>
          <div className="rounded-md border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-900">Available operation</p>
            <p className="mt-1 text-sm text-gray-500">{canRun ? "Create, inspect, and dispatch scans in an approved scope." : "Inspect scans and findings. Scan dispatch requires scan.run permission."}</p>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Run new scan</h2>
        {!canRun ? <p className="text-sm text-gray-500">Your role can inspect scans but cannot create or dispatch one.</p> : approvedScopeVersions.length === 0 ? <p className="text-sm text-gray-500">No approved scope yet — define and approve scope under <Link href="/customer/scope" className="font-medium text-indigo-600 hover:underline">Scope</Link>. Scans can only run against approved scope versions.</p> : (
          <form onSubmit={runScan} className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-52"><label htmlFor="scan-name" className="block text-sm font-medium text-gray-700 mb-1">Scan name</label><input id="scan-name" required maxLength={200} value={scanName} onChange={(e) => setScanName(e.target.value)} placeholder="e.g. ASV re-scan — Q3" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" /></div>
            <div className="flex-1 min-w-52"><label htmlFor="scope-version" className="block text-sm font-medium text-gray-700 mb-1">Approved scope version</label><select id="scope-version" value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">{approvedScopeVersions.map((v) => <option key={v.id} value={v.id}>{v.scopeSetName} — v{v.versionNumber} ({v.assetIds.length} assets)</option>)}</select></div>
            <button type="submit" disabled={running || !scanName.trim() || !selected || selected.assetIds.length === 0} className="mt-6 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium disabled:opacity-50">{running ? "Creating…" : "Create scan"}</button>
          </form>
        )}
        {runError && <p className="text-sm text-red-600 mt-2">{runError}</p>}
        {operationMessage && <p className="text-sm text-green-700 mt-2">{operationMessage}</p>}
      </section>

      <section className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent scans</h2>
        {scans.length === 0 ? <p className="text-sm text-gray-500">No scans yet. Create one from an approved scope to begin.</p> : (
          <ul className="space-y-3">{scans.map((scan) => <li key={scan.id} className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg"><div><p className="font-medium text-gray-900">{scan.name}</p><p className="text-sm text-gray-500">{scan.targetCount} target{scan.targetCount === 1 ? "" : "s"} · {formatDate(scan.createdAt)}</p></div><div className="flex items-center gap-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SCAN_STATUS_STYLES[scan.status] ?? "bg-gray-100 text-gray-700"}`}>{scan.status.toUpperCase()}</span><button type="button" onClick={() => void inspectScan(scan.id)} className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-white">Inspect</button>{canRun && scan.status === "PENDING" && <button type="button" onClick={() => void dispatchScan(scan.id)} disabled={dispatchingId === scan.id} className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium disabled:opacity-50">{dispatchingId === scan.id ? "Dispatching…" : "Dispatch"}</button>}</div></li>)}</ul>
        )}
        {dispatchError && <p className="text-sm text-red-600 mt-3">{dispatchError}</p>}
      </section>

      {(inspectLoading || inspectError || detail) && <section className="bg-white rounded-lg shadow border border-gray-200 p-6" aria-live="polite"><h2 className="text-lg font-semibold text-gray-900">Scan inspection</h2>{inspectLoading ? <p className="mt-3 text-sm text-gray-500">Loading scan status, targets, and findings…</p> : inspectError ? <p className="mt-3 text-sm text-red-600">{inspectError}</p> : detail ? <div className="mt-4 space-y-5"><div className="flex flex-wrap items-center gap-3"><div><p className="font-medium text-gray-900">{detail.name}</p><p className="text-sm text-gray-500">Created {formatDate(detail.createdAt)} · Started {formatDate(detail.startedAt)} · Completed {formatDate(detail.completedAt)}</p></div><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SCAN_STATUS_STYLES[detail.status] ?? "bg-gray-100 text-gray-700"}`}>{detail.status.toUpperCase()}</span>{canRun && detail.status === "PENDING" && <button type="button" onClick={() => void dispatchScan(detail.id)} disabled={dispatchingId === detail.id} className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium disabled:opacity-50">{dispatchingId === detail.id ? "Dispatching…" : "Dispatch scan"}</button>}</div><div><h3 className="text-sm font-semibold text-gray-900">Approved targets ({detail.targets.length})</h3>{detail.targets.length === 0 ? <p className="mt-2 text-sm text-gray-500">No targets were recorded for this scan.</p> : <ul className="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-md">{detail.targets.map((target) => <li key={target.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span className="font-mono text-gray-800">{target.canonicalIdentifier}</span><span className="text-gray-500">{target.type} · {target.status}</span></li>)}</ul>}</div><div><h3 className="text-sm font-semibold text-gray-900">Findings ({findings.length})</h3>{findings.length === 0 ? <p className="mt-2 text-sm text-gray-500">No findings have been recorded for this scan.</p> : <ul className="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-md">{findings.map((finding) => <li key={finding.id} className="px-3 py-2 text-sm"><p className="font-medium text-gray-900">{finding.title}</p><p className="text-gray-500">Severity {finding.severity}{finding.pciSeverity ? ` · PCI ${finding.pciSeverity}` : ""}{finding.cveId ? ` · ${finding.cveId}` : ""} · {finding.status}</p></li>)}</ul>}</div></div> : null}</section>}
    </div>
  );
}
