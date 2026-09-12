import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getMe } from "../api/me";
import { WatchPage } from "../pages/Watch";
import { roleHome, useAuth, type Role } from "./store";

/**
 * Route guard (plan Phase 2). Renders children only with a valid session:
 * - no token → redirect to /login (remembering the attempted route)
 * - token present → re-validate identity against GET /v1/me once (role may
 *   have changed server-side, e.g. token rotation); a 401 clears the session
 *   and the redirect below fires.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  const role = useAuth((s) => s.role);
  const location = useLocation();

  useEffect(() => {
    if (!token) return;
    let active = true;
    getMe()
      .then((me) => {
        if (!active) return;
        useAuth
          .getState()
          .setSession({
            token,
            role: me.role,
            customerId: me.customer_id ?? null,
            customerName: me.customer_name ?? null,
          });
      })
      .catch(() => {
        // A 401 already cleared the session inside the API client; other
        // failures (network/5xx) leave the persisted session usable.
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (!token) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  // Persisted token without a resolved role (first visit after a manual
  // localStorage write): wait for the /v1/me validation to land.
  if (!role) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-muted">
        <p className="font-mono text-sm">checking session…</p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Restrict a route to one role; everyone else goes to the role home. */
export function RequireRole({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const current = useAuth((s) => s.role);
  if (!current) return <Navigate to="/login" replace />;
  if (current !== role) return <Navigate to={roleHome(current)} replace />;
  return <>{children}</>;
}

/**
 * The `/` route: Watch for operators (spec §3.1), Scans for QSA — whose home
 * is the filtered scan list (spec §2 "View scans for own customer").
 */
export function HomeGate() {
  const role = useAuth((s) => s.role);
  if (role === "qsa") return <Navigate to="/scans" replace />;
  return <WatchPage />;
}
