// customer-ui/src/components/primitives/Toolbar.tsx
import type { ReactNode } from "react";

export function Toolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">
      {children}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}
