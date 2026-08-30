import { describe, it, expect } from "vitest";
import {
  normalizeIpv4, normalizeIpv6, normalizeCidr, normalizeFqdn,
  normalizeIdentifier, isAssetType,
} from "@/lib/assets/normalize";

describe("normalizeIpv4", () => {
  it("canonicalizes (strips leading zeros, trims)", () => {
    expect(normalizeIpv4(" 010.0.0.1 ")).toBe("10.0.0.1");
    expect(normalizeIpv4("192.168.001.010")).toBe("192.168.1.10");
  });
  it("rejects malformed input", () => {
    expect(() => normalizeIpv4("10.0.0")).toThrow();
    expect(() => normalizeIpv4("10.0.0.999")).toThrow();
    expect(() => normalizeIpv4("a.b.c.d")).toThrow();
  });
});

describe("normalizeIpv6", () => {
  it("lowercases and compresses", () => {
    expect(normalizeIpv6("2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeIpv6("::1")).toBe("::1");
    expect(normalizeIpv6("fe80::1")).toBe("fe80::1");
  });
  it("rejects malformed input", () => {
    expect(() => normalizeIpv6("2001:db8:::1")).toThrow();
    expect(() => normalizeIpv6("not-an-ip")).toThrow();
  });
});

describe("normalizeCidr", () => {
  it("masks to the network boundary", () => {
    expect(normalizeCidr("10.0.0.5/24")).toBe("10.0.0.0/24");
    expect(normalizeCidr("192.168.1.99/26")).toBe("192.168.1.64/26");
  });
  it("canonicalizes ipv6 cidr", () => {
    expect(normalizeCidr("2001:db8::1/64")).toBe("2001:db8::/64");
  });
  it("rejects bad prefixes", () => {
    expect(() => normalizeCidr("10.0.0.0/33")).toThrow();
    expect(() => normalizeCidr("10.0.0.0/ab")).toThrow();
    expect(() => normalizeCidr("10.0.0.0")).toThrow();
  });
});

describe("normalizeFqdn", () => {
  it("lowercases and strips the trailing dot", () => {
    expect(normalizeFqdn("WWW.Example.COM.")).toBe("www.example.com");
  });
  it("rejects invalid labels", () => {
    expect(() => normalizeFqdn("-bad.example.com")).toThrow();
    expect(() => normalizeFqdn("exa mple.com")).toThrow();
    expect(() => normalizeFqdn("")).toThrow();
  });
});

describe("normalizeIdentifier + isAssetType", () => {
  it("dispatches by type", () => {
    expect(normalizeIdentifier("ipv4", "010.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIdentifier("fqdn", "API.Example.COM.")).toBe("api.example.com");
  });
  it("isAssetType accepts exactly the four MVP types", () => {
    for (const t of ["ipv4", "ipv6", "cidr", "fqdn"]) expect(isAssetType(t)).toBe(true);
    expect(isAssetType("hostname")).toBe(false);
    expect(isAssetType(undefined)).toBe(false);
  });
});
