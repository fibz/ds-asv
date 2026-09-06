import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/store";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const OPERATOR_NAV: NavItem[] = [
  { to: "/", label: "Watch", end: true },
  { to: "/scans", label: "Scans" },
  { to: "/customers", label: "Customers" },
];

const QSA_NAV: NavItem[] = [{ to: "/scans", label: "Scans" }];

/** Left navigation rail (spec §3.1). Operator sees Watch/Scans/Customers; a
 * QSA customer-security user sees only their own scan list (spec §2). */
export function Rail() {
  const role = useAuth((s) => s.role);
  const items = role === "qsa" ? QSA_NAV : OPERATOR_NAV;
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="flex h-14 items-center px-5">
        <span className="font-display text-lg font-semibold text-primary">
          ASV Scanner
        </span>
      </div>
      <nav className="flex-1 px-3 py-4" aria-label="Primary">
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    "block rounded px-3 py-2 text-sm",
                    isActive
                      ? "bg-raised font-medium text-primary"
                      : "text-muted hover:bg-raised/50 hover:text-primary",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
