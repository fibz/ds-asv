import { redirect } from "next/navigation";
import { legacyCustomerPath } from "@/lib/customer/redirects";

export default function LegacyAccessPage() {
  redirect(legacyCustomerPath("/access"));
}
