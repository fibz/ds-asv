import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getOrgProfile } from "@/lib/org/profile";
import { OrgProfileForm } from "@/components/dashboard/OrgProfileForm";

export default async function SettingsPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const profile = await getOrgProfile(ctx);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600">Organization profile and security contacts.</p>
      </div>
      {profile.parentName && (
        <p className="text-sm text-gray-500">Parent organization: <strong>{profile.parentName}</strong></p>
      )}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <OrgProfileForm
          name={profile.name}
          contacts={profile.contacts.map((c) => ({ id: c.id, type: c.type, name: c.name, email: c.email, phone: c.phone, escalationOrder: c.escalationOrder }))}
          canManage={can(ctx, "org.manage")}
        />
      </div>
    </div>
  );
}
