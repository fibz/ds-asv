"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export const customerNavigation = [
  { name: "Home", href: "/customer" },
  { name: "Assets", href: "/customer/assets" },
  { name: "Scope", href: "/customer/scope" },
  { name: "Scans", href: "/customer/scans" },
  { name: "Reports", href: "/customer/reports" },
  { name: "Team", href: "/customer/team" },
  { name: "Access", href: "/customer/access" },
  { name: "Audit", href: "/customer/audit" },
  { name: "Settings", href: "/customer/settings" },
] as const;

export function CustomerSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200">
      <div className="flex flex-col h-full">
        <div className="flex items-center h-16 px-6 border-b border-gray-200">
          <span className="text-xl font-bold text-indigo-600">Customer Center</span>
        </div>
        <nav aria-label="Customer navigation" className="flex-1 px-4 py-6 space-y-1">
          {customerNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center px-3 py-2 text-sm font-medium rounded-md",
                pathname === item.href
                  ? "bg-indigo-50 text-indigo-600"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              {item.name}
            </Link>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => {
              void fetch("/api/auth/logout", { method: "POST" }).then(() => {
                router.push("/sign-in");
              });
            }}
            className="w-full px-3 py-2 text-sm font-medium rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
