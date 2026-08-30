import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { normalizeIdentifier, isAssetType, type AssetType } from "@/lib/assets/normalize";
import { createAsset, DuplicateAssetError } from "@/lib/assets/service";
import type { TenantContext } from "@/lib/tenant";

export interface AssetImportRow {
  type: string;
  identifier: string;
  displayName?: string;
  owner?: string;
  environment?: string;
  criticality?: string;
}

const KNOWN_COLUMNS = new Set(["type", "identifier", "display_name", "owner", "environment", "criticality"]);

/** Minimal RFC-4180-ish CSV parser: quoted fields, embedded commas/quotes. */
export function parseCsv(text: string): AssetImportRow[] {
  if (!text.trim()) throw new Error("CSV is empty");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const [header, ...body] = rows;
  if (!header) throw new Error("CSV is missing a header row");
  for (const col of header) {
    if (!KNOWN_COLUMNS.has(col.trim())) throw new Error(`Unknown column: ${col.trim()}`);
  }
  return body.map((cells) => {
    const obj: AssetImportRow = { type: "", identifier: "" };
    header.forEach((col, idx) => {
      const value = (cells[idx] ?? "").trim();
      switch (col.trim()) {
        case "type": obj.type = value; break;
        case "identifier": obj.identifier = value; break;
        case "display_name": obj.displayName = value || undefined; break;
        case "owner": obj.owner = value || undefined; break;
        case "environment": obj.environment = value || undefined; break;
        case "criticality": obj.criticality = value || undefined; break;
      }
    });
    return obj;
  });
}

function validateRow(row: AssetImportRow): { canonical?: string; errors: string[] } {
  const errors: string[] = [];
  if (!isAssetType(row.type)) errors.push(`invalid type "${row.type}"`);
  if (!row.identifier) errors.push("missing identifier");
  let canonical: string | undefined;
  if (errors.length === 0) {
    try {
      canonical = normalizeIdentifier(row.type as AssetType, row.identifier);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { canonical, errors };
}

/** Classifies each row without writing: new | duplicate | invalid. */
export async function previewImport(ctx: TenantContext, rows: AssetImportRow[]) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const results = [];
    for (const row of rows) {
      const { canonical, errors } = validateRow(row);
      if (errors.length > 0) { results.push({ row, status: "invalid", errors }); continue; }
      const existing = await tx.asset.findFirst({
        where: { organizationId: ctx.organizationId, type: row.type, canonicalIdentifier: canonical, lifecycleState: { not: "retired" } },
      });
      results.push(existing ? { row, status: "duplicate", errors: [], existingAssetId: existing.id } : { row, status: "new", errors: [] });
    }
    return { rows: results };
  });
}

/** Applies an import idempotently. Replaying idempotencyKey returns the stored
 * AssetImport result instead of re-applying. Invalid rows are recorded and
 * retrievable via getImportResult (downloadable error report). */
export async function applyImport(ctx: TenantContext, rows: AssetImportRow[], idempotencyKey: string) {
  if (!idempotencyKey) throw new Error("Idempotency-Key header is required for imports");

  // Idempotency short-circuit FIRST: a replay of an existing key returns the
  // stored AssetImport result immediately — no asset creation, no audit. This
  // must run before the creation loop so replays never re-apply (e.g. after an
  // asset was retired between replays) and never race to re-create assets.
  const existingRecord = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.assetImport.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: ctx.organizationId, idempotencyKey } },
    });
  });
  if (existingRecord) {
    return {
      importId: existingRecord.id,
      summary: existingRecord.summary as { total: number; created: number; duplicates: number; invalid: number },
      invalidRows: existingRecord.invalidRows as unknown as { row: AssetImportRow; errors: string[] }[],
    };
  }

  const created: string[] = [];
  const duplicates: string[] = [];
  const invalidRows: { row: AssetImportRow; errors: string[] }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const { canonical, errors } = validateRow(row);
    if (errors.length > 0) { invalidRows.push({ row, errors }); continue; }
    const dedupeKey = `${row.type}|${canonical}`;
    if (seen.has(dedupeKey)) { duplicates.push(canonical!); continue; }
    seen.add(dedupeKey);
    try {
      const asset = await createAsset(ctx, {
        type: row.type, identifier: canonical!, displayName: row.displayName,
        owner: row.owner, environment: row.environment, criticality: row.criticality,
      });
      created.push(asset.id);
    } catch (e) {
      if (e instanceof DuplicateAssetError) { duplicates.push(canonical!); continue; }
      invalidRows.push({ row, errors: [(e as Error).message] });
    }
  }

  const summary = { total: rows.length, created: created.length, duplicates: duplicates.length, invalid: invalidRows.length };

  const record = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const existing = await tx.assetImport.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: ctx.organizationId, idempotencyKey } },
    });
    if (existing) return existing; // lost a concurrent same-key apply; return its record
    const createdRecord = await tx.assetImport.create({
      data: {
        organizationId: ctx.organizationId,
        idempotencyKey,
        status: "completed",
        summary: summary as object,
        invalidRows: invalidRows as object,
        createdBy: ctx.userId,
      },
    });
    await recordAudit(ctx, "asset.import", "AssetImport", createdRecord.id, undefined, summary, undefined, tx);
    return createdRecord;
  });

  return { importId: record.id, summary: record.summary as typeof summary, invalidRows: record.invalidRows as unknown as typeof invalidRows };
}

export async function getImportResult(ctx: TenantContext, importId: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.assetImport.findFirst({ where: { id: importId, organizationId: ctx.organizationId } });
  });
}
