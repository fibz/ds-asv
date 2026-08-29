import { DashboardSidebar } from "@/components/dashboard/sidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-100">
      <DashboardSidebar />
      <main className="ml-64 p-8">{children}</main>
    </div>
  );
}