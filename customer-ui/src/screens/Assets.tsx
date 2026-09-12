// customer-ui/src/screens/Assets.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAssets } from "../lib/api/queries";
import { Badge } from "../components/primitives/Badge";
import { EmptyState } from "../components/primitives/EmptyState";
import { Toolbar } from "../components/primitives/Toolbar";
import { RecordCard } from "../components/shell/RecordCard";
import { Skeleton } from "../components/shell/Skeleton";
import { ErrorState } from "../components/shell/states";
import type { AssetApi } from "../lib/api/types";

const isVerified = (a: AssetApi) => a.verificationState === "verified";

export function Assets() {
  const { data, isLoading, error, refetch } = useAssets();
  const [query, setQuery] = useState("");

  const { live, retired, unverified } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = (data ?? []).filter(
      (a) => a.canonicalIdentifier.toLowerCase().includes(q) || (a.displayName ?? "").toLowerCase().includes(q),
    );
    const liveRows = all.filter((a) => a.lifecycleState !== "retired");
    // Unverified first (they cannot be relied on in a report), then by identifier.
    const sorted = [...liveRows].sort(
      (a, b) =>
        Number(isVerified(a)) - Number(isVerified(b)) ||
        a.canonicalIdentifier.localeCompare(b.canonicalIdentifier),
    );
    return {
      live: sorted,
      retired: all.filter((a) => a.lifecycleState === "retired"),
      unverified: sorted.filter((a) => !isVerified(a)).length,
    };
  }, [data, query]);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <h1 className="text-[18px] font-semibold">Assets</h1>
      <p className="text-[14px] text-[var(--ink-muted)] mt-1">
        Everything that may be scanned. Unverified assets cannot be relied on in a report.
      </p>

      <div className="mt-5">
        <Toolbar>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            aria-label="Search assets"
            className="border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-[14px] w-64"
          />
          {unverified > 0 ? <Badge tone="warn">{unverified} unverified</Badge> : null}
        </Toolbar>
        <div className="flex gap-2">
          <Link
            to="/assets/new"
            className="rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2"
          >
            Add asset
          </Link>
          <Link
            to="/assets/import"
            className="rounded-[var(--radius)] border border-[var(--border)] text-[14px] font-medium px-3.5 py-2"
          >
            Import CSV
          </Link>
        </div>
      </div>

      <div className="mt-6">
        {error ? <ErrorState message="We couldn’t read your asset inventory." onRetry={() => void refetch()} /> : null}
        {isLoading ? <Skeleton lines={5} /> : null}

        {!isLoading && !error && live.length === 0 && retired.length === 0 ? (
          <EmptyState
            title="No assets yet"
            description="Add the hosts, IPs and directories the acquirer expects you to scan. CSV columns: type, identifier, displayName, owner, environment, criticality."
          />
        ) : null}

        {live.length > 0 ? (
          <ul className="space-y-2">
            {live.map((a) => (
              <RecordCard
                key={a.id}
                title={a.displayName ?? a.canonicalIdentifier}
                subtitle={`${a.type} · ${a.criticality}`}
                tone={isVerified(a) ? "idle" : "accent"}
                status={
                  <Badge tone={isVerified(a) ? "pass" : "warn"}>
                    {isVerified(a) ? "verified" : a.verificationState}
                  </Badge>
                }
                meta={`${a.canonicalIdentifier}${a.owner ? ` · owner ${a.owner}` : ""}${
                  a.environment ? ` · ${a.environment}` : ""
                }`}
                actions={
                  <Link to={`/assets/${a.id}`} className="text-[13px] font-medium">
                    Open
                  </Link>
                }
              />
            ))}
          </ul>
        ) : null}

        {retired.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-[15px] font-medium">Retired</h2>
            <p className="text-[12px] text-[var(--ink-muted)] mt-1">Kept for history — never scanned again.</p>
            <ul className="space-y-2 mt-3">
              {retired.map((a) => (
                <RecordCard
                  key={a.id}
                  title={a.displayName ?? a.canonicalIdentifier}
                  subtitle={a.type}
                  status={<Badge tone="idle">not scanned</Badge>}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
