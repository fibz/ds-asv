import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listApiKeys } from "@/lib/auth/api-keys";
import { ApiKeyForm } from "@/components/dashboard/ApiKeyForm";
import { ApiKeyTable } from "@/components/dashboard/ApiKeyTable";

export default async function CustomerApiKeysPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const keys = await listApiKeys(ctx);
  return <div className="space-y-8"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-900">API Keys</h1><p className="text-gray-600">Manage programmatic access to the Compliance Engine API.</p></div><ApiKeyForm /></div><div className="bg-white rounded-lg shadow border border-gray-200 p-6"><ApiKeyTable keys={keys.map((key) => ({ id: key.id, name: key.name, maskedKey: key.maskedKey, scopes: key.scopes, lastUsedAt: key.lastUsedAt?.toISOString() || null, expiresAt: key.expiresAt?.toISOString() || null, revokedAt: key.revokedAt?.toISOString() || null, createdAt: key.createdAt.toISOString() }))} /></div></div>;
}
