"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/dashboard" },
  { name: "Compliance", href: "/compliance" },
  { name: "Scanners", href: "/scanners" },
  { name: "WAF", href: "/waf" },
  { name: "SIEM", href: "/siem" },
  { name: "API Keys", href: "/api-keys" },
  { name: "API Docs", href: "/docs/reference" },
  { name: "Playground", href: "/playground" },
  { name: "Onboarding", href: "/onboarding" },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <div className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200">
      <div className="flex flex-col h-full">
        <div className="flex items-center h-16 px-6 border-b border-gray-200">
          <span className="text-xl font-bold text-indigo-600">Compliance Engine</span>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navigation.map((item) => (
            <Link
              key={item.name}
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
        <div className="p-4 border-t border-gray-200">
          <UserButton />
        </div>
      </div>
    </div>
  );
}
