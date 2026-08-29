"use client";

export function SandboxBadge({
  active,
  onReset,
}: {
  active: boolean;
  onReset: () => void;
}) {
  if (!active) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
        Sandbox Mode
      </span>
      <button
        onClick={onReset}
        className="px-2 py-1 text-xs text-yellow-700 hover:text-yellow-900 hover:underline"
      >
        Reset
      </button>
    </div>
  );
}