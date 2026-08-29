"use client";

import { useState, useEffect, useMemo } from "react";
import { getOperationsByTag } from "@/lib/openapi/client";

interface Operation {
  method: string;
  path: string;
  summary: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: { type: string; example?: unknown };
  }>;
  requestBody?: {
    content: {
      "application/json": { schema?: { example?: unknown } };
    };
  };
  responses?: Record<string, { description: string }>;
}

export function ApiReference() {
  const [spec, setSpec] = useState<any>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedOp, setSelectedOp] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSpec() {
      try {
        const res = await fetch("/api/v1/openapi");
        if (!res.ok) throw new Error("Failed to load spec");
        const data = await res.json();
        setSpec(data);
        setLoading(false);
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    }
    fetchSpec();
  }, []);

  const tags = useMemo(() => {
    if (!spec) return [];
    const byTag = getOperationsByTag(spec);
    return Object.keys(byTag).sort();
  }, [spec]);

  const operationsByTag = useMemo(() => {
    if (!spec || !selectedTag) return [];
    const byTag = getOperationsByTag(spec);
    return byTag[selectedTag] || [];
  }, [spec, selectedTag]);

  const currentOp = selectedOp || operationsByTag[0]?.operation || null;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading API reference...</div>
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-red-500">Failed to load OpenAPI specification</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-3xl font-bold text-gray-900">{spec.info.title}</h1>
          <p className="text-gray-600 mt-1">Version {spec.info.version}</p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <aside className="lg:col-span-1">
            <nav className="bg-white rounded-lg shadow p-4 sticky top-24 h-fit">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Endpoints</h3>
              <div className="space-y-1">
                {tags.map((tag) => (
                  <div key={tag}>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-1">
                      {tag}
                    </h4>
                    <div className="space-y-0.5 pl-2">
                      {(getOperationsByTag(spec)[tag] || []).map(({ operation, method, path }) => (
                        <button
                          key={operation.operationId}
                          onClick={() => {
                            setSelectedTag(tag);
                            setSelectedOp(operation);
                          }}
                          className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                            selectedTag === tag && selectedOp?.operationId === operation.operationId
                              ? "bg-indigo-50 text-indigo-700 font-medium"
                              : "text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          <span
                            className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 text-xs font-mono rounded ${
                              {
                                GET: "bg-green-100 text-green-700",
                                POST: "bg-blue-100 text-blue-700",
                                PATCH: "bg-yellow-100 text-yellow-700",
                                PUT: "bg-orange-100 text-orange-700",
                                DELETE: "bg-red-100 text-red-700",
                              }[method] || "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {method}
                          </span>
                          <span className="truncate font-mono text-xs">/api/v1{path}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </nav>
          </aside>

          <main className="lg:col-span-3 space-y-8">
            {currentOp && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-3 py-1 text-sm font-mono rounded ${
                        ({
                          GET: "bg-green-100 text-green-800",
                          POST: "bg-blue-100 text-blue-800",
                          PATCH: "bg-yellow-100 text-yellow-800",
                          PUT: "bg-orange-100 text-orange-800",
                          DELETE: "bg-red-100 text-red-800",
                        } as Record<string, string>)[currentOp.method] || "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {currentOp.method}
                    </span>
                    <code className="text-base font-mono text-gray-700">/api/v1{currentOp.path}</code>
                  </div>
                </div>

                <p className="text-gray-600 mb-6">{currentOp.summary}</p>

                {currentOp.parameters?.length && (
                  <section className="mb-6">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Parameters</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 border-b border-gray-200">
                            <th className="pb-2 font-medium w-1/4">Name</th>
                            <th className="pb-2 font-medium w-1/6">In</th>
                            <th className="pb-2 font-medium w-1/6">Required</th>
                            <th className="pb-2 font-medium w-1/6">Type</th>
                            <th className="pb-2 font-medium">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {currentOp.parameters.map((p: any) => (
                            <tr key={p.name} className="hover:bg-gray-50">
                              <td className="py-2 font-mono text-gray-900">{p.name}</td>
                              <td className="py-2 text-gray-600 capitalize">{p.in}</td>
                              <td className="py-2">
                                {p.required ? (
                                  <span className="px-2 py-0.5 text-xs bg-red-50 text-red-700 rounded">Yes</span>
                                ) : (
                                  <span className="px-2 py-0.5 text-xs bg-gray-50 text-gray-500 rounded">No</span>
                                )}
                              </td>
                              <td className="py-2 text-gray-600 font-mono">{p.schema?.type || "string"}</td>
                              <td className="py-2 text-gray-600">{p.description || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {currentOp.requestBody && (
                  <section className="mb-6">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Request Body</h4>
                    <pre className="bg-gray-900 text-gray-100 text-sm p-4 rounded overflow-x-auto">
                      {JSON.stringify(
                        currentOp.requestBody.content["application/json"].schema?.example || {},
                        null,
                        2
                      )}
                    </pre>
                  </section>
                )}

                <section>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Responses</h4>
                  <div className="space-y-4">
                    {Object.entries(currentOp.responses || {}).map(([code, resp]) => (
                      <div key={code} className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center gap-3">
                          <span
                            className={`px-2 py-0.5 text-xs font-mono rounded ${
                              code.startsWith("2")
                                ? "bg-green-100 text-green-700"
                                : code.startsWith("4")
                                ? "bg-red-100 text-red-700"
                                : code.startsWith("5")
                                ? "bg-orange-100 text-orange-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {code}
                          </span>
                          <span className="text-sm text-gray-600">{String((resp as { description: string }).description)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}