export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    // aria-hidden (it is decoration) plus a test id so the per-screen state
    // coverage can assert the skeleton itself, not merely the absence of content.
    <div aria-hidden="true" data-testid="skeleton" className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded-[var(--radius-sm)] bg-[var(--hairline)]" />
      ))}
    </div>
  );
}
