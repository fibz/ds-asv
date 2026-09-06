/** Top bar: brand context, customer scope, and (Phase 2) role pill + logout.
 * Rendered within the app layout. */
export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-edge bg-panel px-6">
      <div className="text-sm text-muted">Compliance control room</div>
      {/* Role pill + sign-out arrive with the auth store (Phase 2). */}
      <div />
    </header>
  );
}
