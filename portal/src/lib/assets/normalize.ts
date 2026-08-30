import { isIP } from "net";

export type AssetType = "ipv4" | "ipv6" | "cidr" | "fqdn";

export const ASSET_TYPES: readonly AssetType[] = ["ipv4", "ipv6", "cidr", "fqdn"];

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === "string" && (ASSET_TYPES as readonly string[]).includes(value);
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function normalizeIpv4(raw: string): string {
  const trimmed = raw.trim();
  const m = IPV4_RE.exec(trimmed);
  if (!m) throw new Error(`Invalid IPv4 address: ${raw}`);
  const octets = m.slice(1).map((o) => {
    const n = Number(o);
    if (n > 255) throw new Error(`IPv4 octet out of range: ${raw}`);
    return n;
  });
  return octets.join(".");
}

const IPV6_RE = /^[0-9a-f:]+$/i;

/** Expands an IPv6 string (with optional ::) into 8 lowercase hex groups. */
function expandIpv6(raw: string): string[] {
  const lower = raw.toLowerCase();
  const dc = lower.indexOf("::");
  let groups: string[];
  if (dc !== -1) {
    const left = lower.slice(0, dc).split(":").filter(Boolean);
    const right = lower.slice(dc + 2).split(":").filter(Boolean);
    const missing = 8 - left.length - right.length;
    if (missing < 1) throw new Error(`Invalid IPv6 address: ${raw}`);
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = lower.split(":").filter(Boolean);
  }
  if (groups.length !== 8) throw new Error(`Invalid IPv6 address: ${raw}`);
  return groups.map((g) => {
    if (!/^[0-9a-f]{1,4}$/.test(g)) throw new Error(`Invalid IPv6 address: ${raw}`);
    return g.padStart(4, "0");
  });
}

/** Compresses 8 groups per RFC 5952 (leftmost-longest zero run → ::). */
function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === "0000") {
      if (curStart === -1) curStart = i;
    } else {
      if (curStart !== -1) {
        const len = i - curStart;
        if (len > bestLen) { bestStart = curStart; bestLen = len; }
        curStart = -1;
      }
    }
  }
  const strip = (g: string) => g.replace(/^0+(?=[0-9a-f])/, "");
  if (bestLen >= 2) {
    const head = groups.slice(0, bestStart).map(strip).join(":");
    const tail = groups.slice(bestStart + bestLen).map(strip).join(":");
    return `${head}::${tail}`;
  }
  return groups.map(strip).join(":");
}

export function normalizeIpv6(raw: string): string {
  const trimmed = raw.trim();
  if (!IPV6_RE.test(trimmed) || isIP(trimmed, 6) !== 6) {
    throw new Error(`Invalid IPv6 address: ${raw}`);
  }
  return compressIpv6(expandIpv6(trimmed));
}

function ipv6ToBigInt(groups: string[]): bigint {
  let n = 0n;
  for (const g of groups) n = (n << 16n) | BigInt(parseInt(g, 16));
  return n;
}

function bigIntToIpv6Groups(n: bigint): string[] {
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(((n >> BigInt(i * 16)) & 0xffffn).toString(16).padStart(4, "0"));
  }
  return groups;
}

export function normalizeCidr(raw: string): string {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) throw new Error(`Invalid CIDR (missing prefix): ${raw}`);
  const ip = trimmed.slice(0, slash);
  const prefixStr = trimmed.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixStr)) throw new Error(`Invalid CIDR prefix: ${raw}`);
  const prefix = Number(prefixStr);
  const isV4 = isIP(ip, 4) === 4;
  const isV6 = isIP(ip, 6) === 6;
  if (!isV4 && !isV6) throw new Error(`Invalid CIDR address: ${raw}`);
  const maxPrefix = isV4 ? 32 : 128;
  if (prefix > maxPrefix) throw new Error(`CIDR prefix out of range: ${raw}`);

  if (isV4) {
    const octets = ip.split(".").map(Number);
    let bits = prefix;
    const masked = octets.map((o, i) => {
      const keep = Math.max(0, Math.min(8, bits));
      bits -= keep;
      if (keep === 0) return 0;
      const mask = ((0xff << (8 - keep)) & 0xff);
      return o & mask;
    });
    return `${masked.join(".")}/${prefix}`;
  }

  const groups = expandIpv6(ip);
  const addr = ipv6ToBigInt(groups);
  const mask = prefix === 0 ? 0n : (0xffffffffffffffffffffffffffffffffn << BigInt(128 - prefix)) & 0xffffffffffffffffffffffffffffffffn;
  const masked = bigIntToIpv6Groups(addr & mask);
  return `${compressIpv6(masked)}/${prefix}`;
}

const FQDN_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function normalizeFqdn(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\.+$/, "");
  if (trimmed.length === 0 || trimmed.length > 253) {
    throw new Error(`Invalid FQDN: ${raw}`);
  }
  const labels = trimmed.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63 || !FQDN_LABEL_RE.test(label)) {
      throw new Error(`Invalid FQDN label in: ${raw}`);
    }
  }
  return trimmed;
}

export function normalizeIdentifier(type: AssetType, raw: string): string {
  switch (type) {
    case "ipv4": return normalizeIpv4(raw);
    case "ipv6": return normalizeIpv6(raw);
    case "cidr": return normalizeCidr(raw);
    case "fqdn": return normalizeFqdn(raw);
  }
}
