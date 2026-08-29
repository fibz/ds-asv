import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { getKeycloakUser } from "@/lib/auth/keycloak";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Header-based session check (Authorization: Bearer). Real cookie-session
  // integration is a later deployment concern; fail closed to /sign-in until
  // a verified identity is present.
  const keycloakUser = await getKeycloakUser({ headers: await headers() });

  if (!keycloakUser) {
    redirect("/sign-in");
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <DashboardSidebar />
      <main className="ml-64 p-8">
        {children}
      </main>
    </div>
  );
}
