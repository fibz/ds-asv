"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ApiKey {
  id: string;
  name: string;
  maskedKey: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function ApiKeyTable({ keys }: { keys: ApiKey[] }) {
  const router = useRouter();
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotateResult, setRotateResult] = useState<{
    open: boolean;
    key: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleRotate(id: string) {
    setRotating(id);
    try {
      const res = await fetch(`/api/v1/auth/api-keys/${id}/rotate`, {
        method: "POST",
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Failed to rotate");
      }
      const data = await res.json();
      setRotateResult({ open: true, key: data.key, name: data.name });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setRotating(null);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/v1/auth/api-keys/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Failed to revoke");
      }
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    try {
      const date = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSecs < 60) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return iso;
    }
  }

  if (keys.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No API keys yet. Create one to get started.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Key</th>
              <th className="pb-2 font-medium">Scopes</th>
              <th className="pb-2 font-medium">Last Used</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {keys.map((k) => (
              <tr key={k.id} className="hover:bg-gray-50">
                <td className="py-3 font-medium text-gray-900">{k.name}</td>
                <td className="py-3 font-mono text-gray-600">{k.maskedKey}</td>
                <td className="py-3">
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <span
                        key={s}
                        className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3 text-gray-500">{formatDate(k.lastUsedAt)}</td>
                <td className="py-3">
                  {k.revokedAt ? (
                    <span className="px-2 py-0.5 text-xs bg-red-50 text-red-700 rounded">
                      Revoked
                    </span>
                  ) : k.expiresAt && new Date(k.expiresAt) < new Date() ? (
                    <span className="px-2 py-0.5 text-xs bg-yellow-50 text-yellow-700 rounded">
                      Expired
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded">
                      Active
                    </span>
                  )}
                </td>
                <td className="py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRotate(k.id)}
                      disabled={rotating === k.id || Boolean(k.revokedAt)}
                      className="px-2 py-1 text-xs text-indigo-600 hover:text-indigo-800 hover:underline disabled:opacity-50"
                    >
                      Rotate
                    </button>
                    <button
                      onClick={() => handleRevoke(k.id)}
                      disabled={deleting === k.id || Boolean(k.revokedAt)}
                      className="px-2 py-1 text-xs text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rotateResult && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900">
              Key Rotated: {rotateResult.name}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Copy this key now — it will not be shown again.
            </p>
            <div className="mt-4 p-3 bg-gray-50 rounded font-mono text-sm break-all">
              {rotateResult.key}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setRotateResult(null)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}