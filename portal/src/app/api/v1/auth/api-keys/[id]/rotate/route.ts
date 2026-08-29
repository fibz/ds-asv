import { NextRequest, NextResponse } from "next/server";
import { API_KEYS_NOT_IMPLEMENTED } from "@/lib/auth/api-keys";
import { provisionKeycloakUser } from "@/lib/auth/keycloak";

/**
 * ApiKey RLS policies + grants are deliberately deferred to Phase 2 (first
 * task). asv_app has NO grants on "ApiKey" (fail-closed by design), so the
 * old rotation flow here would 500 with permission-denied the moment it
 * touched the table. Until Phase 2 revives the surface, authentication is
 * still enforced (401), then the route answers an explicit, self-documenting
 * 501 instead of an opaque 500.
 */
export async function POST(request: NextRequest) {
  const keycloakUser = await provisionKeycloakUser(request);
  if (!keycloakUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: API_KEYS_NOT_IMPLEMENTED },
    { status: 501 }
  );
}
