"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AssetImportForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<null | { rows: { row: Record<string, unknown>; status: string; errors?: string[] }[] }>(null);
  const [result, setResult] = useState<null | { summary: Record<string, number>; invalidRows: unknown[] }>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/v1/assets/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview(data.preview);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/v1/assets/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
      setPreview(null);
      setCsv("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium">+ Import CSV</button>
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900">Import assets</h3>
            <p className="text-sm text-gray-500 mb-3">Columns: type (ipv4|ipv6|cidr|fqdn), identifier, display_name, owner, environment, criticality</p>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} className="w-full px-3 py-2 border rounded-md text-sm font-mono" placeholder={"type,identifier,display_name\nipv4,10.0.0.1,web"} />
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

            {preview && (
              <div className="mt-3 max-h-60 overflow-auto border rounded-md p-3 text-sm">
                {preview.rows.map((r, i) => (
                  <div key={i} className={r.status === "invalid" ? "text-red-600" : r.status === "duplicate" ? "text-amber-600" : "text-green-700"}>
                    {r.status.toUpperCase()} — {String(r.row.identifier)} {r.errors?.length ? `(${r.errors.join("; ")})` : ""}
                  </div>
                ))}
              </div>
            )}

            {result && (
              <div className="mt-3 text-sm">
                <p>Created {result.summary.created}, duplicates {result.summary.duplicates}, invalid {result.summary.invalid}</p>
                {result.invalidRows.length > 0 && (
                  <pre className="mt-2 p-2 bg-gray-50 border rounded text-xs overflow-auto">{JSON.stringify(result.invalidRows, null, 2)}</pre>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} className="px-4 py-2 border rounded-md text-sm">Close</button>
              {!preview && !result && (
                <button onClick={runPreview} disabled={busy || !csv.trim()} className="px-4 py-2 bg-gray-700 text-white rounded-md text-sm disabled:opacity-50">Preview</button>
              )}
              {preview && (
                <button onClick={apply} disabled={busy} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm">Import valid rows</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
