import { describe, it, expect } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  maskApiKey,
  splitKeyHash,
} from "@/lib/auth/api-keys";

describe("api-keys hashing", () => {
  it("generates keys with the live prefix and sufficient entropy", () => {
    const key = generateApiKey();
    expect(key.startsWith("sk_live_")).toBe(true);
    expect(key.length).toBeGreaterThan(40);
  });

  it("stores per-key salted hashes in salt$hash format", async () => {
    const stored = await hashApiKey("sk_live_abc123");
    expect(stored).toMatch(/^[A-Za-z0-9_-]+\$[0-9a-f]{64}$/);
  });

  it("uses a fresh random salt on every hashing call", async () => {
    const a = await hashApiKey("sk_live_same");
    const b = await hashApiKey("sk_live_same");
    expect(a).not.toBe(b);
    expect(splitKeyHash(a)?.salt).not.toBe(splitKeyHash(b)?.salt);
  });

  it("recomputes the same stored value when given the stored salt", async () => {
    const rawKey = "sk_live_verify-me";
    const stored = await hashApiKey(rawKey);
    const { salt } = splitKeyHash(stored)!;
    const recomputed = await hashApiKey(rawKey, salt);
    expect(recomputed).toBe(stored);
  });

  it("computes a different stored value for a different key under the same salt", async () => {
    const stored = await hashApiKey("sk_live_right-key");
    const { salt } = splitKeyHash(stored)!;
    const wrong = await hashApiKey("sk_live_wrong-key", salt);
    expect(wrong).not.toBe(stored);
  });

  it("masks only the digest portion of a salted stored hash", async () => {
    const stored = await hashApiKey("sk_live_whatever");
    const digest = splitKeyHash(stored)!.hash;
    const masked = maskApiKey(stored);
    expect(masked).toBe(`sk_live_••••••••${digest.slice(-4)}`);
  });
});
