"use client";

import { useState } from "react";
import { Stepper } from "@/components/onboarding/Stepper";
import { SandboxBadge } from "@/components/onboarding/SandboxBadge";
import { DashboardSidebar } from "@/components/dashboard/sidebar";

const STEPS = [
  { id: "key", label: "Create API Key" },
  { id: "first-call", label: "Make First Call" },
  { id: "webhook", label: "Test Webhook" },
  { id: "production", label: "Go to Production" },
] as const;

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(true);

  function markComplete(stepId: string) {
    setCompleted((prev) => new Set([...prev, stepId]));
    const next = Math.min(currentStep + 1, STEPS.length - 1);
    setCurrentStep(next);
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <DashboardSidebar />
      <main className="ml-64 p-8">
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Onboarding</h1>
              <p className="text-gray-600">
                Get started with the Compliance Engine API in 4 steps.
              </p>
            </div>
            <SandboxBadge active={sandbox} onReset={() => { setApiKey(null); setCompleted(new Set()); setCurrentStep(0); }} />
          </div>

          <Stepper steps={STEPS} current={currentStep} completed={completed} />

          <div className="mt-8 bg-white rounded-lg shadow p-6">
            {STEPS[currentStep].id === "key" && (
              <CreateKeyStep onComplete={(key) => { setApiKey(key); markComplete("key"); }} />
            )}
            {STEPS[currentStep].id === "first-call" && (
              <FirstCallStep apiKey={apiKey} onComplete={() => markComplete("first-call")} />
            )}
            {STEPS[currentStep].id === "webhook" && (
              <WebhookStep onComplete={() => markComplete("webhook")} />
            )}
            {STEPS[currentStep].id === "production" && (
              <ProductionStep onComplete={() => markComplete("production")} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function CreateKeyStep({ onComplete }: { onComplete: (key: string) => void }) {
  const [name, setName] = useState("My First Key");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/auth/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes: ["read:scans", "read:waf", "read:siem", "read:compliance"] }),
      });
      if (!res.ok) throw new Error("Failed to create key");
      const data = await res.json();
      setCreatedKey(data.key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (createdKey) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">✓ API Key Created</h2>
        <p className="text-sm text-gray-600 mb-4">
          Copy this key now — it will not be shown again.
        </p>
        <div className="p-3 bg-gray-50 rounded font-mono text-sm break-all mb-4">
          {createdKey}
        </div>
        <button
          onClick={() => onComplete(createdKey)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
        >
          Continue to First Call
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Step 1: Create API Key</h2>
      <p className="text-sm text-gray-600 mb-4">
        Create a scoped key with read access to get started.
      </p>
      <label className="block text-sm font-medium text-gray-700 mb-1">Key Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-4"
      />
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      <button
        onClick={create}
        disabled={creating || !name}
        className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {creating ? "Creating..." : "Create Key"}
      </button>
    </div>
  );
}

function FirstCallStep({ apiKey, onComplete }: { apiKey: string | null; onComplete: () => void }) {
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const curlExample = `curl -X GET https://sandbox.compliance-engine.example/v1/scans \\
  -H "X-API-Key: ${apiKey || "YOUR_API_KEY"}"`;

  async function test() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/proxy/scans", {
        method: "GET",
        headers: { "X-API-Key": apiKey || "" },
      });
      const data = await res.json();
      setResponse(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Step 2: Make First Call</h2>
      <p className="text-sm text-gray-600 mb-4">
        List your scans to verify your API key works.
      </p>
      <pre className="bg-gray-900 text-gray-100 text-sm p-4 rounded overflow-x-auto mb-4">
        {curlExample}
      </pre>
      <button
        onClick={test}
        disabled={loading}
        className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? "Sending..." : "Send Test Request"}
      </button>
      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
      {response && (
        <div className="mt-4">
          <p className="text-sm text-green-600 mb-2">✓ Success! Response:</p>
          <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
            {JSON.stringify(response, null, 2)}
          </pre>
          <button
            onClick={onComplete}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
          >
            Continue to Webhook Test
          </button>
        </div>
      )}
    </div>
  );
}

function WebhookStep({ onComplete }: { onComplete: () => void }) {
  const [url, setUrl] = useState("https://webhook.site/your-unique-id");
  const [events, setEvents] = useState(["scan.completed", "siem.alert"]);

  const curlExample = `curl -X POST https://sandbox.compliance-engine.example/v1/payments/webhooks \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "${url}",
    "events": ${JSON.stringify(events)}
  }'`;

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Step 3: Test Webhook</h2>
      <p className="text-sm text-gray-600 mb-4">
        Register a webhook endpoint to receive event notifications.
      </p>
      <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-4"
      />
      <pre className="bg-gray-900 text-gray-100 text-sm p-4 rounded overflow-x-auto mb-4">
        {curlExample}
      </pre>
      <button
        onClick={onComplete}
        className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
      >
        Continue to Production
      </button>
    </div>
  );
}

function ProductionStep({ onComplete }: { onComplete: () => void }) {
  const checklist = [
    { id: "rotate", label: "Rotate your key periodically", done: false },
    { id: "expiry", label: "Set key expiration", done: false },
    { id: "ip", label: "Configure IP allowlist", done: false },
    { id: "monitor", label: "Set up webhook monitoring", done: false },
  ];
  const [items, setItems] = useState(checklist);

  function toggle(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Step 4: Go to Production</h2>
      <p className="text-sm text-gray-600 mb-4">
        Complete these production readiness checks before going live.
      </p>
      <div className="space-y-2">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
            <span className="text-sm text-gray-700">{item.label}</span>
          </label>
        ))}
      </div>
      <button
        onClick={onComplete}
        className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
      >
        Finish Onboarding
      </button>
    </div>
  );
}

