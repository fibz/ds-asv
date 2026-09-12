import type { ScopeSetApi, ScopeVersionApi } from "../api/types";

export interface ScopeView {
  inForce: ScopeVersionApi | null;
  draft: ScopeVersionApi | null;
  history: ScopeVersionApi[];
  labelFor(v: ScopeVersionApi): string;
}

/**
 * Scope versions are not a top-level resource on the wire: there is no
 * `/scope-versions` GET, and a version only arrives nested inside its set
 * (`/scope-sets` → set.versions → `_count.items`). So this takes the sets, never
 * a version id — anything else would have to invent data the API does not send.
 *
 * `inForce` is the newest approved version across all sets (a later approval
 * supersedes an earlier one). `draft` is the newest version still moving through
 * the workflow (`draft` or `submitted`) — it is NOT in force. Everything else is
 * history, newest first, so superseded approvals stay visible.
 */
export function scopeView(input: { sets: ScopeSetApi[] }): ScopeView {
  const nameOf = (setId: string) => input.sets.find((s) => s.id === setId)?.name ?? "Scope";
  const versions = input.sets.flatMap((s) => s.versions ?? []);
  const byNewest = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
  const inForce = byNewest.find((v) => v.status === "approved") ?? null;
  const draft = byNewest.find((v) => v.status === "draft" || v.status === "submitted") ?? null;
  const history = byNewest.filter((v) => v !== inForce && v !== draft);
  return { inForce, draft, history, labelFor: (v) => `${nameOf(v.scopeSetId)} — v${v.versionNumber}` };
}
