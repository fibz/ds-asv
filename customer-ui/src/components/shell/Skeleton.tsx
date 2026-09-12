export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded-[var(--radius-sm)] bg-[var(--hairline)]" />
      ))}
    </div>
  );
}
