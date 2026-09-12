import { redirect } from "next/navigation";
import { legacyCustomerPath } from "@/lib/customer/redirects";

export default function LegacyAssetsPage() {
  redirect(legacyCustomerPath("/assets"));
}
