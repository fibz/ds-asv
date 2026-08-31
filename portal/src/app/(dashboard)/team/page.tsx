import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listTeamMembers } from "@/lib/org/team";
import { TeamTable } from "@/components/dashboard/TeamTable";
import { MemberInviteForm } from "@/components/dashboard/MemberInviteForm";

export default async function TeamPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const canManage = can(ctx, "team.manage");
  const members = (await listTeamMembers(ctx)).map((m) => ({ ...m, joinedAt: m.joinedAt?.toISOString() ?? null }));
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="text-gray-600">Members, roles, and invitations for this organization.</p>
        </div>
        {canManage && <MemberInviteForm />}
      </div>
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <TeamTable members={members} canManage={canManage} currentUserId={ctx.userId} />
      </div>
    </div>
  );
}
