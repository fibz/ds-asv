import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "operator" | "qsa";

export interface Session {
  token: string;
  role: Role;
  customerId?: string | null;
  customerName?: string | null;
}

/** The home route for a role: operator Watch (`/`), QSA Scans (`/scans`). */
export function roleHome(role: Role): string {
  return role === "operator" ? "/" : "/scans";
}

interface AuthState {
  token: string | null;
  role: Role | null;
  customerId: string | null;
  customerName: string | null;
  /** One-shot notice surfaced on the login page (e.g. "session expired"). */
  notice: string | null;
  setSession: (session: Session) => void;
  clearSession: (notice?: string) => void;
}

interface PersistedAuth {
  token: string | null;
  role: Role | null;
  customerId: string | null;
  customerName: string | null;
}

/**
 * Auth/session state (spec §7): token + role derived from `GET /v1/me`,
 * persisted to localStorage so a page reload keeps the session. The token is
 * the scanner bearer token; role is operator (shared token) or qsa (scoped
 * token). 401s clear the session and set a notice for the login page.
 */
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      customerId: null,
      customerName: null,
      notice: null,
      setSession: ({ token, role, customerId, customerName }) =>
        set({
          token,
          role,
          customerId: customerId ?? null,
          customerName: customerName ?? null,
          notice: null,
        }),
      clearSession: (notice) =>
        set({
          token: null,
          role: null,
          customerId: null,
          customerName: null,
          notice: notice ?? null,
        }),
    }),
    {
      name: "asv-scanner-auth",
      partialize: (s): PersistedAuth => ({
        token: s.token,
        role: s.role,
        customerId: s.customerId,
        customerName: s.customerName,
      }),
    }
  )
);
