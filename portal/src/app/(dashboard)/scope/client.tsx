"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Transport shapes — built server-side from the scope service (see page.tsx).
// Explicit plain objects so the client never depends on Prisma relation
// presence at runtime (listScopeSets does not include version items).
export interface ScopeAsset {
  id: string;
  type: string;
  canonicalIdentifier: string;
  displayName: string | null;
  lifecycleState: string;
}

export interface ScopeItemRow {
  id: string;
  type: string;
  canonicalIdentifier: string;
}

export interface ScopeVersionRow {
  id: string;
  versionNumber: number;
  status: "draft" | "submitted" | "approved";
  contentHash: string | null;
  createdAt: string; // ISO
  items: ScopeItemRow[];
}

export interface ScopeSetRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: string; // ISO
  versions: ScopeVersionRow[];
}

const STATUS_STYLES: Record<ScopeVersionRow["status"], string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function ScopeClient({
  scopeSets,
  assets,
}: {
  scopeSets: ScopeSetRow[];
  assets: ScopeAsset[];
}) {
  const router = useRouter();

  // "New scope set" form
  const [setName, setSetName] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [creatingSet, setCreatingSet] = useState(false);
  const [createSetError, setCreateSetError] = useState("");

  // Per-set "New version" asset picker
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [versionErrors, setVersionErrors] = useState<Record<string, string>>({});

  // Per-version submit/approve errors (RBAC/lifecycle failures surface here)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  // Only active assets are valid picks (the API rejects retired/other states downstream).
  const activeAssets = assets.filter((a) => a.lifecycleState === "active");

  async function createSet(e: React.FormEvent) {
    e.preventDefault();
    setCreatingSet(true);
    setCreateSetError("");
    try {
      const res = await fetch("/api/v1/scope-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: setName, description: setDescription.trim() || undefined }),
      });
      if (res.ok) {
        setSetName("");
        setSetDescription("");
        router.refresh();
      } else {
        setCreateSetError(await errorMessage(res, "Creating scope set failed"));
      }
    } finally {
      setCreatingSet(false);
    }
  }

  function togglePick(scopeSetId: string, assetId: string) {
    setPicks((prev) => {
      const current = prev[scopeSetId] ?? [];
      return {
        ...prev,
        [scopeSetId]: current.includes(assetId)
          ? current.filter((id) => id !== assetId)
          : [...current, assetId],
      };
    });
  }

  async function createVersion(scopeSetId: string) {
    const assetIds = picks[scopeSetId] ?? [];
    if (assetIds.length === 0) return;
    setVersionErrors((prev) => ({ ...prev, [scopeSetId]: "" }));
    const res = await fetch(`/api/v1/scope-sets/${scopeSetId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds }),
    });
    if (res.ok) {
      setPicks((prev) => ({ ...prev, [scopeSetId]: [] }));
      router.refresh();
    } else {
      const msg = await errorMessage(res, "Creating version failed");
      setVersionErrors((prev) => ({ ...prev, [scopeSetId]: msg }));
    }
  }

  async function transition(versionId: string, route: "submit" | "approve") {
    setActionErrors((prev) => ({ ...prev, [versionId]: "" }));
    const res = await fetch(`/api/v1/scope-versions/${versionId}/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      router.refresh();
    } else {
      const msg = await errorMessage(res, route === "submit" ? "Submit failed" : "Approve failed");
      setActionErrors((prev) => ({
        ...prev,
        [versionId]: msg,
      }));
    }
  }

  return (
    <div className="space-y-8">
      {/* New scope set */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">New scope set</h2>
        <form onSubmit={createSet} className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-52">
            <label htmlFor="scope-set-name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              id="scope-set-name"
              required
              maxLength={200}
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              placeholder="e.g. PCI DSS v4.0 — in-scope systems"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div className="flex-1 min-w-52">
            <label htmlFor="scope-set-description" className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
            <input
              id="scope-set-description"
              value={setDescription}
              onChange={(e) => setSetDescription(e.target.value)}
              placeholder="Why this scope set exists"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={creatingSet || !setName.trim()}
            className="mt-6 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium disabled:opacity-50"
          >
            Create scope set
          </button>
        </form>
        {createSetError && <p className="text-sm text-red-600 mt-2">{createSetError}</p>}
      </div>

      {/* Scope sets */}
      {scopeSets.length === 0 ? (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <p className="text-sm text-gray-500">
            No scope sets yet. Create one above, then add a version snapshot from your active assets. No scan
            runs without an approved scope version.
          </p>
        </div>
      ) : (
        scopeSets.map((set) => {
          const selected = picks[set.id] ?? [];
          return (
            <div key={set.id} className="bg-white rounded-lg shadow border border-gray-200 p-6">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{set.name}</h2>
                  {set.description && <p className="text-sm text-gray-600 mt-1">{set.description}</p>}
                </div>
                <span className="text-xs text-gray-400">created {set.createdAt.slice(0, 16).replace("T", " ")}</span>
              </div>

              {/* Versions */}
              {set.versions.length === 0 ? (
                <p className="text-sm text-gray-500 mt-4">No versions yet — create the first snapshot below.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {set.versions.map((v) => (
                    <li key={v.id} className="border border-gray-200 rounded-md p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-gray-900">v{v.versionNumber}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[v.status]}`}>
                            {v.status.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {v.status === "draft" && (
                            <button
                              onClick={() => transition(v.id, "submit")}
                              className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm disabled:opacity-50"
                            >
                              Submit
                            </button>
                          )}
                          {v.status === "submitted" && (
                            <button
                              onClick={() => transition(v.id, "approve")}
                              className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      </div>

                      {v.status === "approved" ? (
                        <>
                          <p className="text-sm text-gray-600 mt-2">
                            {v.items.length} asset{v.items.length === 1 ? "" : "s"} in scope
                          </p>
                          {v.items.length > 0 && (
                            <ul className="mt-2 flex flex-wrap gap-1.5">
                              {v.items.map((it) => (
                                <li key={it.id} className="px-2 py-0.5 bg-gray-50 border border-gray-200 rounded text-xs font-mono text-gray-700">
                                  {it.canonicalIdentifier}
                                </li>
                              ))}
                            </ul>
                          )}
                          {v.contentHash && (
                            <p className="mt-2 text-xs text-gray-500">
                              content hash: <span className="font-mono" title={v.contentHash}>{v.contentHash.slice(0, 16)}…</span>
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-gray-500 mt-2">
                          {v.items.length} asset{v.items.length === 1 ? "" : "s"} in snapshot v{v.versionNumber}
                        </p>
                      )}

                      {actionErrors[v.id] && <p className="text-sm text-red-600 mt-2">{actionErrors[v.id]}</p>}
                    </li>
                  ))}
                </ul>
              )}

              {/* New version picker */}
              <div className="mt-4 border-t border-gray-100 pt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">New version snapshot</h3>
                {activeAssets.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No active assets to add. Verify or activate assets on the Assets page first.
                  </p>
                ) : (
                  <>
                    <div className="max-h-48 overflow-auto border border-gray-200 rounded-md p-3 grid grid-cols-1 md:grid-cols-2 gap-1">
                      {activeAssets.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm text-gray-700 py-0.5 px-1 rounded hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selected.includes(a.id)}
                            onChange={() => togglePick(set.id, a.id)}
                            className="accent-indigo-600"
                          />
                          <span className="font-mono text-xs">{a.canonicalIdentifier}</span>
                          <span className="text-xs text-gray-400">{a.displayName ?? a.type}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={() => createVersion(set.id)}
                        disabled={selected.length === 0}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium disabled:opacity-50"
                      >
                        Create version ({selected.length})
                      </button>
                      {versionErrors[set.id] && <span className="text-sm text-red-600">{versionErrors[set.id]}</span>}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}