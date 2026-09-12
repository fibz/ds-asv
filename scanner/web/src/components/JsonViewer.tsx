import { useMemo, useState } from "react";

/**
 * Collapsible raw-JSON viewer for finding evidence (spec §3.5). Parses a JSON
 * string defensively; falls back to showing the raw text when it is not JSON.
 */
export function JsonViewer({ raw }: { raw?: string | null }) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => {
    if (!raw) return null;
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }, [raw]);

  if (!parsed) {
    return <p className="font-mono text-xs text-muted">no raw evidence</p>;
  }

  return (
    <div className="rounded border border-edge">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium text-muted transition hover:text-primary"
      >
        <span>Raw evidence</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre className="max-h-56 overflow-auto border-t border-edge px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
          {parsed}
        </pre>
      )}
    </div>
  );
}
