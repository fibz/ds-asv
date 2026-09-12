import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { getMe } from "../api/me";
import { ApiError } from "../api/client";
import { roleHome, useAuth } from "../auth/store";

/**
 * Login (spec §2 / plan Phase 2): single API-token form. On success the token
 * is exchanged for identity via GET /v1/me and stored; the router guard then
 * admits the caller. A notice (e.g. "session expired") set by a 401 surfaces
 * here.
 */
export function LoginPage() {
  const token = useAuth((s) => s.token);
  const role = useAuth((s) => s.role);
  const notice = useAuth((s) => s.notice);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (token && role) {
    return <Navigate to={roleHome(role)} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const candidate = value.trim();
    if (!candidate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const me = await getMe({ token: candidate });
      setSession({
        token: candidate,
        role: me.role,
        customerId: me.customer_id ?? null,
        customerName: me.customer_name ?? null,
      });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : roleHome(me.role), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Invalid or expired token.");
      } else {
        setError("Could not reach the scanner API. Is the backend running on :8000?");
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <p className="font-display text-xl font-semibold text-primary">
          ASV Scanner
        </p>
        <p className="mt-1 text-sm text-muted">
          Compliance control room · sign in with your scanner API token
        </p>

        {notice && (
          <div
            role="status"
            className="mt-6 rounded border border-accent/40 bg-raised px-3 py-2 text-sm text-accent"
          >
            {notice}
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className="mt-6 rounded-lg border border-edge bg-panel p-5"
        >
          <label
            htmlFor="api-token"
            className="block text-xs font-medium uppercase tracking-wide text-muted"
          >
            API token
          </label>
          <input
            id="api-token"
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Bearer token"
            className="mt-2 w-full rounded border border-edge bg-surface px-3 py-2 font-mono text-sm text-primary placeholder:text-muted/60 focus:border-accent"
            autoFocus
          />
          {error && (
            <p role="alert" className="mt-3 text-sm text-critical">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="mt-5 w-full rounded bg-accent px-4 py-2 text-sm font-semibold text-surface transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-muted">
          Tokens are issued by the scanner operator. The dashboard only reads
          them; it never mints them (spec §2, open item: QSA token issuer).
        </p>
      </div>
    </div>
  );
}
