"use client";

import { CodeSnippet } from "./CodeSnippet";

export function ResponseViewer({
  response,
}: {
  response: {
    status: number;
    statusText: string;
    headers: Headers;
    body: unknown;
    duration: number;
    curl: string;
    url: string;
    method: string;
  } | null;
}) {
  if (!response) return null;

  const statusColor =
    response.status >= 200 && response.status < 300
      ? "text-green-600"
      : response.status >= 400 && response.status < 500
      ? "text-red-600"
      : "text-yellow-600";

  const headersObj: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    headersObj[k] = v;
  });

  return (
    <div className="space-y-6 border-t border-gray-200 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`px-2 py-1 text-xs font-mono rounded ${statusColor} bg-opacity-10`}
          >
            {response.status} {response.statusText}
          </span>
          <span className="text-sm text-gray-500">{response.duration}ms</span>
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(response.curl)}
          className="px-3 py-1 text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
        >
          Copy as cURL
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Response Headers</h4>
          <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto max-h-48 overflow-y-auto">
            {JSON.stringify(headersObj, null, 2)}
          </pre>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Response Body</h4>
          <div className="bg-gray-900 rounded overflow-hidden">
            <CodeSnippet
              language="json"
              code={JSON.stringify(response.body, null, 2)}
            />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">Code Samples</h4>
        <div className="space-y-4">
          <CodeSnippet language="curl" code={response.curl} />
          <CodeSnippet
            language="python"
            code={generatePython(response)}
          />
          <CodeSnippet
            language="javascript"
            code={generateJavaScript(response)}
          />
          <CodeSnippet language="go" code={generateGo(response)} />
        </div>
      </div>
    </div>
  );
}

interface CodeSampleInput {
  status: number;
  statusText: string;
  headers: Headers;
  body: unknown;
  duration: number;
  curl: string;
  url: string;
  method: string;
}

function generatePython(r: CodeSampleInput): string {
  if (!r) return "";
  const url = r.url.replace("/api/proxy", process.env.NEXT_PUBLIC_API_BASE || "https://api.example.com");
  return `import requests

url = "${url}"
headers = ${JSON.stringify(r.headers, null, 12)}
${r.body ? `data = ${JSON.stringify(r.body, null, 12)}` : ""}

response = requests.${r.method.toLowerCase()}(url, headers=headers${r.body ? ", json=data" : ""})
print(response.status_code)
print(response.json())`;
}

function generateJavaScript(r: CodeSampleInput): string {
  if (!r) return "";
  const url = r.url.replace("/api/proxy", process.env.NEXT_PUBLIC_API_BASE || "https://api.example.com");
  return `const url = "${url}";
const headers = ${JSON.stringify(Object.fromEntries(r.headers), null, 12)};
${r.body ? `const data = ${JSON.stringify(r.body, null, 12)};` : ""}

const response = await fetch(url, {
  method: "${r.method}",
  headers,
${r.body ? "  body: JSON.stringify(data)," : ""}
});

console.log(response.status);
console.log(await response.json());`;
}

function generateGo(r: CodeSampleInput): string {
  if (!r) return "";
  const url = r.url.replace("/api/proxy", process.env.NEXT_PUBLIC_API_BASE || "https://api.example.com");
  return `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

func main() {
	url := "${url}"
${r.body ? `
	data := map[string]interface{}{} // TODO: fill from ${JSON.stringify(r.body)}
	jsonData, _ := json.Marshal(data)
	req, _ := http.NewRequest("${r.method}", url, bytes.NewBuffer(jsonData))
` : `	req, _ := http.NewRequest("${r.method}", url, nil)
`}
	req.Header.Set("Content-Type", "application/json")
${Object.entries(r.headers)
  .filter(([k]) => k.toLowerCase() !== "content-type")
  .map(([k, v]) => `	req.Header.Set("${k}", "${v}")`)
  .join("\n")}

	client := &http.Client{}
	resp, _ := client.Do(req)
	defer resp.Body.Close()

	fmt.Println("Status:", resp.Status)
	// Parse response...
}`;
}