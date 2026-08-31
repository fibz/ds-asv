import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { getScan } from "@/lib/scan/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

export const MANIFEST_TTL_MS = 15 * 60 * 1000;

function manifestSecret(): string {
  return process.env.MANIFEST_SECRET || "dev-manifest-secret";
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function canonical(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

function sign(payload: Record<string, unknown>): string {
  return createHmac("sha256", manifestSecret()).update(canonical(payload)).digest("hex");
}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export async function issueScanManifest(
  ctx: TenantContext,
  scanId: string
): Promise<{ manifest: string; expiresAt: Date }> {
  const scan = await getScan(ctx, scanId);
  if (!scan) throw new Error("Scan not found");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + MANIFEST_TTL_MS);
  const payload = {
    scanId,
    organizationId: ctx.organizationId,
    targets: scan.targets.map((t) => ({ type: t.type, canonicalIdentifier: t.canonicalIdentifier })),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: randomBytes(16).toString("hex"),
  };
  const manifest = `${b64url(JSON.stringify(payload))}.${sign(payload)}`;
  await withTenant(ctx.organizationId, (tx) =>
    tx.scan.update({ where: { id: scanId }, data: { manifestIssuedAt: issuedAt, manifestExpiresAt: expiresAt } })
  );
  return { manifest, expiresAt };
}

export interface VerifiedManifest {
  scanId: string;
  organizationId: string;
  targets: { type: string; canonicalIdentifier: string }[];
}

export async function verifyScanManifest(token: string): Promise<VerifiedManifest | null> {
  try {
    const dot = token.indexOf(".");
    if (dot < 1) return null;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Record<string, unknown>;
    const expected = Buffer.from(sign(payload), "hex");
    const actual = Buffer.from(sig, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const expiresAt = new Date(payload.expiresAt as string);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;
    if (typeof payload.scanId !== "string" || typeof payload.organizationId !== "string" || !Array.isArray(payload.targets)) return null;
    return {
      scanId: payload.scanId,
      organizationId: payload.organizationId,
      targets: payload.targets as VerifiedManifest["targets"],
    };
  } catch {
    return null;
  }
}

export interface SimulatedFinding {
  assetId: string;
  qid: string;
  cveId: string | null;
  severity: string;
  pciSeverity: string;
  title: string;
  description: string;
  threat: string;
  impact: string;
  result: string;
}

export async function simulatedScanner(manifest: string): Promise<{ assetId: string; findings: SimulatedFinding[] }[]> {
  const verified = await verifyScanManifest(manifest);
  if (!verified) return [];
  // Test double: one target per scan, canned finding set. Mirrors what the
  // real scanner (Phase 3b) writes back via POST /scans/{id}/findings.
  return verified.targets.map((t, i) => ({
    assetId: t.canonicalIdentifier, // real scanner maps by assetId from the manifest
    findings: [
      {
        assetId: t.canonicalIdentifier,
        qid: `5000${i}`,
        cveId: null,
        severity: "4",
        pciSeverity: "High",
        title: "SSL/TLS uses weak cipher suites",
        description: "The service accepts weak ciphers.",
        threat: "An attacker may decrypt or modify traffic.",
        impact: "Confidentiality and integrity at risk.",
        result: "Verified by TLS handshake analysis.",
      },
      {
        assetId: t.canonicalIdentifier,
        qid: `1000${i}`,
        cveId: "CVE-2021-0000",
        severity: "2",
        pciSeverity: "Low",
        title: "Server banner disclosure",
        description: "The service discloses its version banner.",
        threat: "Assists targeted exploitation.",
        impact: "Low.",
        result: "Banner observed in handshake.",
      },
    ],
  }));
}
