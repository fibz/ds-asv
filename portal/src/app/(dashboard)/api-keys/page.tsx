import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { maskApiKey } from "@/lib/auth/api-keys";
import { ApiKeyForm } from "@/components/dashboard/ApiKeyForm";
import { ApiKeyTable, type ApiKey } from "@/components/dashboard/ApiKeyTable";

async function getKeys(orgId: string): Promise<ApiKey[]> {
  const keys = await prisma.apiKey.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });

  return keys.map((k: { id: string; name: string; keyHash: string; scopes: string[]; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) => ({
    id: k.id,
    name: k.name,
    maskedKey: maskApiKey(k.keyHash),
    scopes: k.scopes,
    lastUsedAt: k.lastUsedAt?.toISOString() || null,
    expiresAt: k.expiresAt?.toISOString() || null,
    revokedAt: k.revokedAt?.toISOString() || null,
    createdAt: k.createdAt.toISOString(),
  }));
}

export default async function ApiKeysPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!user?.orgId) redirect("/dashboard");

  const keys = await getKeys(user.orgId);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
          <p className="text-gray-600">
            Manage API keys for programmatic access to the Compliance Engine API.
          </p>
        </div>
        <ApiKeyForm />
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <ApiKeyTable keys={keys} />
      </div>
    </div>
  );
}