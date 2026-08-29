import { NextRequest } from "next/server";
import { requireScope } from "@/lib/auth/requireScope";

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";
const SCOPE_BY_PREFIX: Record<string, Parameters<typeof requireScope>[1]> = {
  "scans": "read:scans",
  "waf": "read:waf",
  "siem": "read:siem",
  "compliance": "read:compliance",
  "auth": "admin",
  "payments": "admin",
};

function maskSecrets(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/sk_live_[A-Za-z0-9_-]{10,}/g, "sk_live_••••");
  }
  if (Array.isArray(obj)) {
    return obj.map(maskSecrets);
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/key|secret|token|password/i.test(k) && typeof v === "string") {
        out[k] = v.replace(/.{4}$/, "••••");
      } else {
        out[k] = maskSecrets(v);
      }
    }
    return out;
  }
  return obj;
}

export async function handler(request: NextRequest) {
  const url = new URL(request.url);
  const pathParts = url.pathname.replace(/^\/api\/proxy\/?/, "").split("/");
  const prefix = pathParts[0] || "";

  const required =
    SCOPE_BY_PREFIX[prefix] || ("read:scans" as Parameters<typeof requireScope>[1]);
  const scopeCheck = await requireScope(request, required);

  if (!scopeCheck.ok) {
    return scopeCheck.response;
  }

  // Build upstream URL, preserving query string
  const upstream = new URL(API_BASE);
  upstream.pathname = "/api/v1/" + pathParts.join("/");
  upstream.search = url.search;

  const headers = new Headers(request.headers);
  headers.set("X-Org-Id", scopeCheck.key.orgId);
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // duplex needed for streaming body in Node 18+
    (init as Record<string, unknown>).duplex = "half";
  }

  const upstreamRes = await fetch(upstream.toString(), init);

  // Clone + mask body for logging (do not leak secrets)
  const cloned = upstreamRes.clone();
  try {
    const text = await cloned.text();
    try {
      const json = maskSecrets(JSON.parse(text));
      console.log("[proxy] response", upstream.toString(), json);
    } catch {
      console.log("[proxy] response (non-json)", upstream.toString());
    }
  } catch {
    // ignore log failures
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
}

export const POST = handler;
export const GET = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;