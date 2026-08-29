"use client";

import { useState, useEffect } from "react";

interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: { type: string; example?: unknown };
}

interface Operation {
  method: string;
  path: string;
  summary?: string;
  parameters?: Parameter[];
  requestBody?: {
    content: {
      "application/json": { schema?: { example?: unknown } };
    };
  };
}

export function RequestBuilder({
  operation,
  onExecute,
}: {
  operation: Operation;
  onExecute: (request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }) => void;
}) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [query, setQuery] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<Record<string, string>>({
    "Content-Type": "application/json",
  });
  const [body, setBody] = useState("");
  const [showBody, setShowBody] = useState(false);

  useEffect(() => {
    if (operation.requestBody?.content?.["application/json"]?.schema?.example) {
      setBody(JSON.stringify(operation.requestBody.content["application/json"].schema.example, null, 2));
      setShowBody(true);
    }
  }, [operation]);

  const pathWithParams = operation.path.replace(
    /\{([^}]+)\}/g,
    (_, key) => params[key] || `{${key}}`
  );

  function handlePathChange(name: string, value: string) {
    setParams((prev) => ({ ...prev, [name]: value }));
  }

  function handleQueryChange(name: string, value: string) {
    setQuery((prev) => ({ ...prev, [name]: value }));
  }

  function execute() {
    const searchParams = new URLSearchParams(query).toString();
    const fullUrl = `/api/proxy${pathWithParams}${searchParams ? "?" + searchParams : ""}`;
    onExecute({ method: operation.method.toUpperCase(), url: fullUrl, headers, body: body ? JSON.parse(body) : undefined });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span
          className={`px-2 py-1 text-xs font-mono rounded ${
            {
              GET: "bg-green-100 text-green-800",
              POST: "bg-blue-100 text-blue-800",
              PATCH: "bg-yellow-100 text-yellow-800",
              PUT: "bg-orange-100 text-orange-800",
              DELETE: "bg-red-100 text-red-800",
            }[operation.method.toUpperCase()] || "bg-gray-100 text-gray-800"
          }`}
        >
          {operation.method.toUpperCase()}
        </span>
        <code className="text-sm font-mono text-gray-700">/api/v1{pathWithParams}</code>
      </div>

      {operation.parameters?.some((p) => p.in === "path") && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Path Parameters</h4>
          <div className="space-y-2">
            {operation.parameters
              ?.filter((p) => p.in === "path")
              .map((p) => (
                <div key={p.name} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-600">
                    {p.name} {p.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    value={params[p.name] || ""}
                    onChange={(e) => handlePathChange(p.name, e.target.value)}
                    placeholder={p.schema?.example?.toString() || ""}
                    className="px-3 py-1.5 border border-gray-300 rounded text-sm"
                  />
                </div>
              ))}
          </div>
        </div>
      )}

      {operation.parameters?.some((p) => p.in === "query") && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Query Parameters</h4>
          <div className="space-y-2">
            {operation.parameters
              ?.filter((p) => p.in === "query")
              .map((p) => (
                <div key={p.name} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-600">
                    {p.name} {p.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    value={query[p.name] || ""}
                    onChange={(e) => handleQueryChange(p.name, e.target.value)}
                    placeholder={p.schema?.example?.toString() || ""}
                    className="px-3 py-1.5 border border-gray-300 rounded text-sm"
                  />
                </div>
              ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700">Headers</h4>
          <label className="flex items-center gap-1 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showBody}
              onChange={(e) => setShowBody(e.target.checked)}
            />
            Show Request Body
          </label>
        </div>
        <div className="space-y-2">
          {Object.entries(headers).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <input
                value={k}
                onChange={(e) =>
                  setHeaders((prev) => {
                    const { [k]: _, ...rest } = prev;
                    return { ...rest, [e.target.value]: v };
                  })
                }
                className="px-3 py-1.5 border border-gray-300 rounded text-sm flex-1"
              />
              <input
                value={v}
                onChange={(e) =>
                  setHeaders((prev) => ({ ...prev, [k]: e.target.value }))
                }
                className="px-3 py-1.5 border border-gray-300 rounded text-sm flex-1"
              />
            </div>
          ))}
        </div>
      </div>

      {showBody && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Request Body (JSON)
          </h4>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono bg-gray-50"
            placeholder='{"key": "value"}'
          />
        </div>
      )}

      <button
        onClick={execute}
        className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
      >
        Send Request
      </button>
    </div>
  );
}