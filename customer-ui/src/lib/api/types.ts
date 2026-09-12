// Field names copied from portal/prisma/schema.prisma.
export interface AssetApi {
  id: string; type: string; canonicalIdentifier: string; displayName: string | null;
  owner: string | null; environment: string | null; criticality: string;
  lifecycleState: string; verificationState: string; source: string;
  lastSeenAt: string | null; createdAt: string; updatedAt: string;
}

export interface ScanApi {
  id: string; name: string; status: string;
  startedAt: string; completedAt: string | null; createdAt: string;
  manifestIssuedAt: string | null; manifestExpiresAt: string | null;
  targets?: { id: string; status: string; canonicalIdentifier: string }[];
}

export interface FindingApi {
  id: string; scanId: string; assetId: string; qid: string; cveId: string | null;
  severity: string; pciSeverity: string | null; title: string;
  description: string | null; status: string;
}

export interface AttestationApi { id: string; status: string; reason: string | null; reviewedAt: string | null }

export interface ReportApi {
  id: string; scanId: string; status: string; scopeVersionId: string | null;
  attestationId: string | null; attestation: AttestationApi | null;
  summary: { hosts: number; vulnerabilities: number; averageRisk: number; bySeverity: Record<string, number>; compliance: string } | null;
  createdAt: string; updatedAt: string;
}

export interface ScopeVersionApi {
  id: string; scopeSetId: string; versionNumber: number; status: string;
  contentHash: string | null; submittedAt: string | null; approvedAt: string | null;
  items?: { id: string; type: string; canonicalIdentifier: string }[];
  /** Prisma nested count, present on versions returned inside /scope-sets. */
  _count?: { items: number };
}

export interface ScopeSetApi { id: string; name: string; description: string | null; createdAt: string; versions?: ScopeVersionApi[] }

export interface AuditEventApi { id: string; action: string; entity: string; entityId: string | null; createdAt: string }

/** Field names copied from portal/prisma/schema.prisma → model Dispute. */
export interface DisputeApi {
  id: string; findingId: string; organizationId: string; status: string;
  justification: string; resolutionNote: string | null;
  raisedById: string; raisedAt: string;
  moderatedById: string | null; moderatedAt: string | null;
  createdAt: string; updatedAt: string;
}

/** Field names copied from portal/prisma/schema.prisma → model Authorization. */
export interface AuthorizationApi {
  id: string; organizationId: string; scopeVersionId: string;
  statementHash: string; scopeVersionHash: string; signature: string;
  status: string; issuedById: string | null; issuedAt: string; createdAt: string;
}
