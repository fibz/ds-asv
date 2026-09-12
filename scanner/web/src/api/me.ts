import type { Role } from "../auth/store";
import { apiRequest } from "./client";

export interface MeResponse {
  role: Role;
  customer_id?: string | null;
  customer_name?: string | null;
}

/** `GET /v1/me` — caller identity + role from the bearer token (spec §6.1). */
export function getMe(options?: { token?: string; signal?: AbortSignal }) {
  return apiRequest<MeResponse>("/v1/me", { token: options?.token, signal: options?.signal });
}
