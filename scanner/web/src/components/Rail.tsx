import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/", label: "Watch" },
  { to: "/scans", label: "Scans" },
  { to: "/customers", label: "Customers" },
];

/** Left navigation rail (spec §3.1). Items are role-filtered by callers; the
 * base rail lists all three nav destinations. */
export function Rail() {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="flex h-14 items-center px-5">
        <span className="font-display text-lg font-semibold text-primary">
          ASV Scanner
        </span>
      </div>
      <nav className="flex-1 px-3 py-4" aria-label="Primary">
        <ul className="space-y-1">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
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
