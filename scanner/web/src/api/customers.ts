import { apiRequest } from "./client";
import type { Customer, ScopeAuditEvent, ScanHistoryItem } from "./types";

/** `GET /v1/customers` — operator: all customers (spec §6.4). */
export function listCustomers(options?: { signal?: AbortSignal }) {
  return apiRequest<Customer[]>("/v1/customers", { signal: options?.signal });
}

/** `GET /v1/customers/{id}` — one customer. */
export function getCustomer(id: string, options?: { signal?: AbortSignal }) {
  return apiRequest<Customer>(`/v1/customers/${encodeURIComponent(id)}`, {
    signal: options?.signal,
  });
}

/** `GET /v1/customers/{id}/scope-audit` — operator only (spec §6.3). */
export function getScopeAudit(id: string, options?: { signal?: AbortSignal }) {
  return apiRequest<ScopeAuditEvent[]>(
    `/v1/customers/${encodeURIComponent(id)}/scope-audit`,
    { signal: options?.signal }
  );
}

/** `GET /v1/customers/{id}/scans` — persisted scan history for a customer. */
export function listCustomerScans(
  id: string,
  options?: { limit?: number; signal?: AbortSignal }
) {
  return apiRequest<ScanHistoryItem[]>(
    `/v1/customers/${encodeURIComponent(id)}/scans`,
    { query: { limit: options?.limit ?? 50 }, signal: options?.signal }
  );
}
