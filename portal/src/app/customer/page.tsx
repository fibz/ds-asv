import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerHome } from "@/components/customer/CustomerHome";
import { getCustomerHome } from "@/lib/customer/home";
import { tenantContextFromRequest } from "@/lib/tenant";

export default async function CustomerHomePage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  let view: Awaited<ReturnType<typeof getCustomerHome>>;
  try {
    view = await getCustomerHome(ctx);
  } catch {
    return <div className="space-y-8"><h1 className="text-2xl font-bold text-gray-900">Customer Center</h1><div className="bg-white rounded-lg shadow border border-red-200 p-6"><p className="text-sm text-red-700">Organization status is temporarily unavailable. Your customer workflows remain available from the navigation.</p></div></div>;
  }
  return <CustomerHome view={view} />;
}
