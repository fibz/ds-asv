const legacyPrefixes: Array<[string, string]> = [
  ["/dashboard", "/customer"],
  ["/assets", "/customer/assets"],
  ["/scope", "/customer/scope"],
  ["/scanners", "/customer/scans"],
  ["/reports", "/customer/reports"],
  ["/team", "/customer/team"],
  ["/access", "/customer/access"],
  ["/audit", "/customer/audit"],
  ["/settings", "/customer/settings"],
];

export function legacyCustomerPath(pathname: string, search = ""): string {
  const match = legacyPrefixes.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!match) return `${pathname}${search}`;
  const [, canonical] = match;
  const suffix = pathname.slice(match[0].length);
  return `${canonical}${suffix}${search}`;
}
