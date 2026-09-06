#!/usr/bin/env bash
# Refresh the Greenbone CVE cache from gvmd's own postgres (scheduled path).
#
# The cache is normally (re)built with:
#   scripts/update_greenbone.py --cpe-tsv <tsv> --ranges-tsv <tsv>
# where the two TSVs come from gvmd's postgres. The exact SQL for both dumps
# is documented in app/scoring/greenbone_export.py docstrings
# (build_greenbone_cache_from_tsv / build_greenbone_cache_ranges_from_tsv).
#
# This script wraps that end-to-end so it can run unattended (cron / CI):
#   1. pulls the two dumps from the configured postgres into temp files,
#   2. rebuilds the cache atomically via update_greenbone.py (a failed
#      rebuild never clobbers the last good cache),
#   3. exits non-zero on any failure so a scheduler can alert.
#
# Configuration (real env vars always win over scanner/greenbone.env):
#   GREENBONE_PG_*  postgres connection the dumps are pulled from
#   GREENBONE_FEED_PATH   cache output (default ./data/greenbone_cves.json)
#
# Examples:
#   # Local dockerized gvmd (the greenbone-community-container stack):
#   GREENBONE_PG_HOST=127.0.0.1 GREENBONE_PG_PORT=5432 \
#     GREENBONE_PG_DB=gvmd GREENBONE_PG_USER=gvmd GREENBONE_PG_PASSWORD=... \
#     scripts/refresh_greenbone_cache.sh
#
#   # SSH tunnel to a remote gvmd postgres:
#   ssh -fN -L 127.0.0.1:5433:localhost:5432 user@gvmd-host
#   ... same env as above with GREENBONE_PG_PORT=5433
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

# Load scanner/greenbone.env as defaults if present (real env still wins).
CONFIG_FILE="${GREENBONE_CONFIG:-$HERE/greenbone.env}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$CONFIG_FILE"; set +a
fi

PG_HOST="${GREENBONE_PG_HOST:-}"
PG_PORT="${GREENBONE_PG_PORT:-5432}"
PG_DB="${GREENBONE_PG_DB:-gvmd}"
PG_USER="${GREENBONE_PG_USER:-gvmd}"
PG_PASSWORD="${GREENBONE_PG_PASSWORD:-}"
FEED_PATH="${GREENBONE_FEED_PATH:-./data/greenbone_cves.json}"

if [[ -z "$PG_HOST" ]]; then
  echo "error: GREENBONE_PG_HOST not set — cannot pull gvmd dumps. See scripts/refresh_greenbone_cache.sh" >&2
  exit 1
fi

command -v psql >/dev/null 2>&1 || { echo "error: psql not installed" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "error: python3 not installed" >&2; exit 1; }

export PGPASSWORD="$PG_PASSWORD"
PSQL=(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -At -F $'\t')

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# CPE dump — exact SQL in app/scoring/greenbone_export.py (build_greenbone_cache_from_tsv docstring).
"${PSQL[@]}" -c "SELECT n.name, n.cve, n.cvss_base, r.ref_id FROM nvts n JOIN vt_refs r ON r.vt_uuid = n.uuid AND r.ref_type='cpe' WHERE n.cve <> ''" > "$TMPDIR/cpes.tsv" \
  || { echo "error: CPE dump query failed" >&2; exit 1; }

# Version-range dump — SQL in build_greenbone_cache_ranges_from_tsv docstring.
"${PSQL[@]}" -c "SELECT DISTINCT m.criteria, cv.name, m.version_start_incl, m.version_start_excl, m.version_end_incl, m.version_end_excl, cv.severity FROM scap.cpe_match_strings m JOIN scap.cpe_nodes_match_criteria nc ON nc.match_criteria_id = m.match_criteria_id JOIN scap.cpe_match_nodes n ON n.id = nc.node_id AND n.negate = 0 JOIN scap.cves cv ON cv.id = n.cve_id WHERE m.criteria <> ''" > "$TMPDIR/ranges.tsv" \
  || { echo "error: version-range dump query failed" >&2; exit 1; }

python3 scripts/update_greenbone.py \
  --cpe-tsv "$TMPDIR/cpes.tsv" \
  --ranges-tsv "$TMPDIR/ranges.tsv" \
  --out "$FEED_PATH"
