import { redirect } from "next/navigation";
import { legacyCustomerPath } from "@/lib/customer/redirects";

export default function LegacySettingsPage() {
  redirect(legacyCustomerPath("/settings"));
}
