import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/store";

/** Top bar: brand context, role pill, customer scope (QSA), sign-out. */
export function TopBar() {
  const role = useAuth((s) => s.role);
  const customerName = useAuth((s) => s.customerName);
  const clearSession = useAuth((s) => s.clearSession);
  const navigate = useNavigate();

  function signOut() {
    clearSession();
    navigate("/login", { replace: true });
  }

  const isQsa = role === "qsa";
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-edge bg-panel px-6">
      <div className="text-sm text-muted">Compliance control room</div>
      <div className="flex items-center gap-3">
        <span
          className={
            isQsa
              ? "rounded border border-pass/40 px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-pass"
              : "rounded border border-accent/40 px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-accent"
          }
        >
          {role ?? "—"}
        </span>
        {isQsa && customerName && (
          <span className="max-w-48 truncate text-sm text-muted">
            {customerName}
          </span>
        )}
        <button
          type="button"
          onClick={signOut}
          className="rounded border border-edge px-3 py-1 text-sm text-muted transition hover:border-accent/60 hover:text-primary"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
