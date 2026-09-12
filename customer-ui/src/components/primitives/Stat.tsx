// customer-ui/src/components/primitives/Stat.tsx
export function Stat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)]">{label}</div>
      <div className="text-[18px] font-semibold mt-1">{value}</div>
      {caption ? <div className="text-[12px] text-[var(--ink-muted)] mt-1">{caption}</div> : null}
    </div>
  );
}
