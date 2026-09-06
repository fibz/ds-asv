/** Small centered empty-state used when a list/table has no rows. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border border-edge bg-panel px-6 py-10 text-center text-sm text-muted"
      role="status"
    >
      {message}
    </div>
  );
}
