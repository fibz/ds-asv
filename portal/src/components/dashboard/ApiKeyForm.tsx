"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ALL_SCOPES = [
  { id: "read:scans", label: "Read Scans", desc: "View scan results & status" },
  { id: "write:scans", label: "Write Scans", desc: "Start & stop scans" },
  { id: "read:waf", label: "Read WAF", desc: "View rules & traffic" },
  { id: "manage:waf", label: "Manage WAF", desc: "Create/update/delete rules" },
  { id: "read:siem", label: "Read SIEM", desc: "View alerts & agents" },
  { id: "write:siem", label: "Write SIEM", desc: "Resolve alerts, response" },
  { id: "read:compliance", label: "Read Compliance", desc: "View frameworks" },
  { id: "admin", label: "Admin", desc: "Full access (all scopes)" },
] as const;

export function ApiKeyForm({
  onCreated,
}: {
  onCreated?: (data: {
    id: string;
    name: string;
    key: string;
    scopes: string[];
    expiresAt: string | null;
  }) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read:scans"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggleScope(s: string) {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/v1/auth/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          scopes: scopes.includes("admin") ? ["admin"] : scopes,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Failed to create key");
      }
      const data = await res.json();
      onCreated?.(data);
      setOpen(false);
      setName("");
      setScopes(["read:scans"]);
      setExpiresAt("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium"
      >
        + Create API Key
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900">
              Create API Key
            </h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Integration Key"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Scopes
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_SCOPES.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-start gap-2 p-2 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(s.id)}
                        onChange={() => toggleScope(s.id)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-800">
                          {s.label}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {s.desc}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Expires At (optional)
                </label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !name}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}