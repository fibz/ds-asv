export function Placeholder({ title, pass }: { title: string; pass: string }) {
  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <h1 className="text-[18px] font-semibold">{title}</h1>
      <p className="text-[14px] text-[var(--ink-muted)] mt-2">
        This screen is not built yet — it is scheduled for the {pass} of the customer UI.
      </p>
    </div>
  );
}
