import { redirect } from "next/navigation";
import { legacyCustomerPath } from "@/lib/customer/redirects";

export default function LegacyDashboardPage() {
  redirect(legacyCustomerPath("/dashboard"));
}
