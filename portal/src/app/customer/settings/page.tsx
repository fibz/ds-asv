import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/rbac";
import { tenantContextFromRequest } from "@/lib/tenant";
import { getOrgProfile } from "@/lib/org/profile";
import { OrgProfileForm } from "@/components/dashboard/OrgProfileForm";

export default async function CustomerSettingsPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const profile = await getOrgProfile(ctx);
  return <div className="space-y-8"><div><h1 className="text-2xl font-bold text-gray-900">Settings</h1><p className="text-gray-600">Organization profile and security contacts.</p></div>{profile.parentName && <p className="text-sm text-gray-500">Parent organization: <strong>{profile.parentName}</strong></p>}<div className="bg-white rounded-lg shadow border border-gray-200 p-6"><OrgProfileForm name={profile.name} contacts={profile.contacts.map((contact) => ({ id: contact.id, type: contact.type, name: contact.name, email: contact.email, phone: contact.phone, escalationOrder: contact.escalationOrder }))} canManage={can(ctx, "org.manage")} /></div></div>;
}
