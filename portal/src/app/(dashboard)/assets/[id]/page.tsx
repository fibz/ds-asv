import { redirect } from "next/navigation";
import { legacyCustomerPath } from "@/lib/customer/redirects";

export default async function LegacyAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(legacyCustomerPath(`/assets/${encodeURIComponent(id)}`));
}
