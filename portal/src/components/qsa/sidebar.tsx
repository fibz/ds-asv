"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export const qsaNavigation = [
  { name: "Home", href: "/qsa" },
  { name: "Shared queue", href: "/qsa/queue" },
  { name: "Assignments", href: "/qsa/assignments" },
] as const;

export function QsaSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-slate-950 text-white">
      <div className="flex flex-col h-full">
        <div className="flex items-center h-16 px-6 border-b border-slate-800">
          <span className="text-xl font-bold text-cyan-300">QSA Review</span>
        </div>
        <nav aria-label="QSA navigation" className="flex-1 px-4 py-6 space-y-1">
          {qsaNavigation.map((item) => (
            <Link key={item.href} href={item.href} className={cn("flex items-center px-3 py-2 text-sm font-medium rounded-md", pathname === item.href ? "bg-cyan-400/15 text-cyan-200" : "text-slate-300 hover:bg-slate-900 hover:text-white")}>
              {item.name}
            </Link>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-slate-800">
          <button type="button" onClick={() => { void fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/sign-in")); }} className="w-full px-3 py-2 text-sm font-medium rounded-md text-slate-300 hover:bg-slate-900 hover:text-white">Sign out</button>
        </div>
      </div>
    </aside>
  );
}
