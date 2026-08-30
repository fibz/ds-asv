import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listApiKeys } from "@/lib/auth/api-keys";
import { ApiKeyForm } from "@/components/dashboard/ApiKeyForm";
import { ApiKeyTable } from "@/components/dashboard/ApiKeyTable";

export default async function ApiKeysPage() {
  // Keycloak session identity (header-based; cookie-session UI is a known
  // follow-up). organizationId is derived from the membership — never from
  // the URL or client input.
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");

  const keys = await listApiKeys(ctx);

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
        <ApiKeyTable
          keys={keys.map((k) => ({
            id: k.id,
            name: k.name,
            maskedKey: k.maskedKey,
            scopes: k.scopes,
            lastUsedAt: k.lastUsedAt?.toISOString() || null,
            expiresAt: k.expiresAt?.toISOString() || null,
            revokedAt: k.revokedAt?.toISOString() || null,
            createdAt: k.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
