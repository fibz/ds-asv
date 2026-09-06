import { useState, type FormEvent } from "react";
import { enqueueScan } from "../api/scans";
import { ApiError } from "../api/client";
import type { Customer } from "../api/types";

const selectClass =
  "w-full rounded border border-edge bg-surface px-2 py-1.5 text-sm text-primary focus:border-accent";
const labelClass = "block text-xs text-muted";

/** Modal "New scan" (operator only, spec §2 "Run a new scan"). */
export function NewScanDialog({
  customers,
  onCreated,
  onClose,
}: {
  customers: Customer[];
  onCreated: (scanId: string) => void;
  onClose: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [targets, setTargets] = useState("");
  const [authMethod, setAuthMethod] = useState("none");
  const [credentialsRef, setCredentialsRef] = useState("");
  const [scanType, setScanType] = useState("quarterly");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targetList = targets
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!customerId) {
      setError("Choose a customer first.");
      return;
    }
    if (targetList.length === 0) {
      setError("Enter at least one target (IP or hostname).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await enqueueScan({
        customer_id: customerId,
        targets: targetList,
        auth_method: authMethod,
        scan_type: scanType,
        credentials_reference:
          authMethod === "none" ? null : credentialsRef.trim() || null,
      });
      onCreated(created.scan_id);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail ?? err.message);
      } else {
        setError(String(err));
      }
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New scan"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg border border-edge bg-panel p-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-primary">
            New scan
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-primary"
          >
            close
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className={labelClass} htmlFor="ns-customer">
              Customer
            </label>
            <select
              id="ns-customer"
              className={`${selectClass} mt-1`}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="ns-targets">
              Targets — one per line (must be inside the customer's approved
              scope)
            </label>
            <textarea
              id="ns-targets"
              rows={4}
              className="mt-1 w-full rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-primary focus:border-accent"
              placeholder={"10.0.0.15\npay.example.com"}
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="ns-auth">
                Auth method
              </label>
              <select
                id="ns-auth"
                className={`${selectClass} mt-1`}
                value={authMethod}
                onChange={(e) => setAuthMethod(e.target.value)}
              >
                <option value="none">none (black-box)</option>
                <option value="ssh-key">ssh-key</option>
                <option value="winrm">winrm</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="ns-type">
                Scan type
              </label>
              <select
                id="ns-type"
                className={`${selectClass} mt-1`}
                value={scanType}
                onChange={(e) => setScanType(e.target.value)}
              >
                <option value="quarterly">quarterly</option>
                <option value="adhoc">adhoc</option>
                <option value="continuous">continuous</option>
              </select>
            </div>
          </div>

          {authMethod !== "none" && (
            <div>
              <label className={labelClass} htmlFor="ns-creds">
                Credentials reference (Vault path / SSM parameter)
              </label>
              <input
                id="ns-creds"
                type="text"
                className="mt-1 w-full rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-primary focus:border-accent"
                placeholder="vault://scan/ssh/key"
                value={credentialsRef}
                onChange={(e) => setCredentialsRef(e.target.value)}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-edge px-3 py-1.5 text-sm text-muted hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-accent px-4 py-1.5 text-sm font-semibold text-surface transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Starting…" : "Start scan"}
          </button>
        </div>
      </form>
    </div>
  );
}
