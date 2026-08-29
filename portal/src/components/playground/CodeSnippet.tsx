"use client";

import { useState } from "react";

export function CodeSnippet({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between bg-gray-800 px-3 py-1.5">
        <span className="text-xs text-gray-400 uppercase">{language}</span>
        <button
          onClick={copy}
          className="text-xs text-gray-300 hover:text-white"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 text-xs overflow-x-auto p-3">
        <code>{code}</code>
      </pre>
    </div>
  );
}