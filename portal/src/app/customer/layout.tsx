import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerSidebar } from "@/components/customer/sidebar";
import { getKeycloakUser } from "@/lib/auth/keycloak";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const keycloakUser = await getKeycloakUser({ headers: await headers() });
  if (!keycloakUser) redirect("/sign-in");

  return (
    <div className="min-h-screen bg-gray-100">
      <CustomerSidebar />
      <main className="ml-64 p-8">{children}</main>
    </div>
  );
}
