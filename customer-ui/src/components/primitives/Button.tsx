// customer-ui/src/components/primitives/Button.tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-[var(--accent)] text-white hover:opacity-90",
  secondary: "border border-[var(--border)] text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--canvas)]",
  ghost: "text-[var(--ink-muted)] hover:text-[var(--ink)]",
};

export function Button({
  variant = "primary", disabled, disabledReason, children, className = "", ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; disabledReason?: string; children: ReactNode }) {
  const reasonId = useId();
  return (
    <>
      <button
        {...rest}
        disabled={disabled}
        aria-describedby={disabled && disabledReason ? reasonId : undefined}
        className={`rounded-[var(--radius)] px-3.5 py-2 text-[14px] font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASS[variant]} ${className}`}
      >
        {children}
      </button>
      {disabled && disabledReason ? (
        <span id={reasonId} className="sr-only">{disabledReason}</span>
      ) : null}
    </>
  );
}
