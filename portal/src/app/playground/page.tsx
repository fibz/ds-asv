"use client";

"use client";

import { useState, useEffect } from "react";
import { getAllOperations } from "@/lib/openapi/client";
import { RequestBuilder } from "@/components/playground/RequestBuilder";
import { ResponseViewer } from "@/components/playground/ResponseViewer";

export default function PlaygroundPage() {
  const [operations, setOperations] = useState<Array<{ path: string; method: string; operation: any }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    headers: Headers;
    body: unknown;
    duration: number;
    curl: string;
    url: string;
    method: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchSpec() {
    try {
      const res = await fetch("/api/v1/openapi");
      if (!res.ok) throw new Error("Failed to load spec");
      const spec = await res.json();
      const ops = getAllOperations(spec);
      setOperations(ops);
      if (ops.length > 0) setSelected(ops[0].operation.operationId);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function execute(request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }) {
    const start = Date.now();
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      const duration = Date.now() - start;
      const body = await res.json().catch(() => null);

      // Build curl command
      const headerStr = Object.entries(request.headers)
        .map(([k, v]) => `-H "${k}: ${v}"`)
        .join(" \\\n  ");
      const bodyStr = request.body ? `-d '${JSON.stringify(request.body)}'` : "";
      const curl = `curl -X ${request.method} ${request.url} \\\n  ${headerStr}${bodyStr ? ` \\\n  ${bodyStr}` : ""}`;

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        body,
        duration,
        curl,
        url: request.url,
        method: request.method,
      });
    } catch (e) {
      console.error(e);
      setResponse({
        status: 0,
        statusText: "Error",
        headers: new Headers(),
        body: { error: (e as Error).message },
        duration: Date.now() - start,
        curl: "",
        url: request.url,
        method: request.method,
      });
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">API Playground</h1>
          <p className="text-gray-600">
            Interactive console for the Compliance Engine API. Select an endpoint, fill
            parameters, and send real requests using your API key.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            {loading ? (
              <div className="bg-white rounded-lg shadow p-4 text-gray-500">
                Loading OpenAPI spec...
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Endpoints
                </h3>
                <div className="space-y-1 max-h-[600px] overflow-y-auto">
                  {operations.map((op) => (
                    <button
                      key={op.operation.operationId}
                      onClick={() => {
                        setSelected(op.operation.operationId);
                        setResponse(null);
                      }}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${
                        selected === op.operation.operationId
                          ? "bg-indigo-50 text-indigo-700 font-medium"
                          : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 text-xs font-mono rounded ${
                            {
                              GET: "bg-green-100 text-green-700",
                              POST: "bg-blue-100 text-blue-700",
                              PATCH: "bg-yellow-100 text-yellow-700",
                              PUT: "bg-orange-100 text-orange-700",
                              DELETE: "bg-red-100 text-red-700",
                            }[op.method] || "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {op.method}
                        </span>
                        <span className="truncate font-mono text-xs">
                          /api/v1{op.path}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {op.operation.summary}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-6">
            {selected ? (
              <>
                {operations
                  .find((op) => op.operation.operationId === selected)
                  ?.operation.operationId &&
                  (() => {
                    const op = operations.find(
                      (o) => o.operation.operationId === selected
                    )!;
                    return (
                      <RequestBuilder
                        operation={{
                          method: op.method,
                          path: op.path,
                          summary: op.operation.summary,
                          parameters: op.operation.parameters,
                          requestBody: op.operation.requestBody,
                        }}
                        onExecute={execute}
                      />
                    );
                  })()}
                <ResponseViewer response={response} />
              </>
            ) : (
              <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
                Select an endpoint from the list to get started.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}