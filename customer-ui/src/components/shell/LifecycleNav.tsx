import { Link, useLocation } from "react-router-dom";
import { TONE_CLASS, glyphFor, stageLabel, toneForStage } from "../../lib/status";
import { signOutUrl } from "../../lib/auth/auth";
import type { StageRow } from "../../lib/viewmodels/stages";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../../lib/brand";

const MANAGE = [
  { name: "Team", href: "/team" },
  { name: "Access", href: "/access" },
  { name: "Audit", href: "/audit" },
  { name: "Settings", href: "/settings" },
];

export function LifecycleNav({ stages }: { stages: StageRow[] }) {
  const { pathname } = useLocation();
  return (
    <aside className="hidden min-[900px]:block w-60 shrink-0 bg-[var(--surface)] border-r border-[var(--border)]">
      <div className="px-4 py-4 border-b border-[var(--hairline)]">
        <div className="text-[14px] font-semibold">{PRODUCT_NAME}</div>
        <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">{PRODUCT_TAGLINE}</div>
      </div>
      <nav aria-label="Scan cycle" className="px-2 py-3">
        {stages.map((s) => {
          const selected = pathname === s.href;
          return (
            <Link
              key={s.key}
              to={s.href}
              aria-current={selected ? "page" : undefined}
              className={`flex items-start gap-2.5 rounded-[var(--radius)] px-2.5 py-2 ${selected ? "bg-[var(--accent-weak)]" : "hover:bg-[var(--canvas)]"}`}
            >
              <span aria-hidden="true" className={`mt-0.5 text-[11px] ${TONE_CLASS[toneForStage(s.state)]} border rounded-[var(--radius-sm)] px-1`}>
                {glyphFor(s.state)}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{s.index} · {s.label}</span>
                <span className="block text-[11px] text-[var(--ink-muted)] truncate">{stageLabel(s.state)} · {s.detail}</span>
              </span>
            </Link>
          );
        })}
        <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)] px-2.5 pt-4 pb-1">Manage</div>
        {MANAGE.map((m) => (
          <Link key={m.href} to={m.href} className="block rounded-[var(--radius)] px-2.5 py-1.5 text-[13px] text-[var(--ink-muted)] hover:bg-[var(--canvas)]">
            {m.name}
          </Link>
        ))}
      </nav>
      {/* Sign-out MUST be a POST form: the portal's /api/auth/logout exports POST
          only and answers with a redirect, so a link would 405. */}
      <form method="post" action={signOutUrl()} className="px-2 pb-4">
        <button type="submit" className="w-full rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px] text-[var(--ink-muted)] hover:bg-[var(--canvas)]">
          Sign out
        </button>
      </form>
    </aside>
  );
}
