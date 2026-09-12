/** Parse a customer's scope_ips JSON string into a CIDR/FQDN list. */
export function parseScope(scopeIps: string | null | undefined): string[] {
  if (!scopeIps) return [];
  try {
    const parsed: unknown = JSON.parse(scopeIps);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
