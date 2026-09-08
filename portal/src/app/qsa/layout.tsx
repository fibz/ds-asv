import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { QsaSidebar } from "@/components/qsa/sidebar";
import { tenantContextFromRequest } from "@/lib/tenant";

export default async function QsaLayout({ children }: { children: React.ReactNode }) {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!ctx.isStaff) redirect("/customer");
  return <div className="min-h-screen bg-slate-100"><QsaSidebar /><main className="ml-64 p-8">{children}</main></div>;
}
