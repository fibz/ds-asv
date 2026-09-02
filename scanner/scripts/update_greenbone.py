#!/usr/bin/env python3
"""Build the Greenbone CVE cache used by the ASV scoring engine.

Two modes:

  --gmp-xml <file>   parse an existing GMP <get_nvts_response> XML document
                     (offline: use in CI/dev; capture one from a real gvmd
                     with the live mode below and keep it as a fixture)
  live (default)     fetch NVT metadata from gvmd over SSH (GMP) using
                     python-gvm — requires python-gvm + a reachable gvmd;
                     credentials come from GREENBONE_HOST / GREENBONE_PORT /
                     GREENBONE_USER / GREENBONE_PASSWORD

Writes the {versioned, ranges} cache to $GREENBONE_FEED_PATH
(default ./data/greenbone_cves.json, see GREENBONE_FEED_PATH) via a temp
file + atomic rename. A failed fetch, unparseable XML, or an empty export
EXITS NON-ZERO and NEVER clobbers the last good cache.

Usage::

    python scripts/update_greenbone.py --gmp-xml tests/fixtures/gmp_get_nvts.xml
    python scripts/update_greenbone.py --gmp-xml local.xml --out /path/cache.json
    python scripts/update_greenbone.py               # live GMP fetch
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # scanner/ — app/ lives under it
sys.path.insert(0, str(REPO_ROOT))

from app.scoring.greenbone_export import build_greenbone_cache  # noqa: E402

DEFAULT_FEED_PATH = "./data/greenbone_cves.json"


def _fetch_gmp_xml() -> str:
    """Fetch EVERY NVT from gvmd (GMP) and return ONE <get_nvts_response>
    document carrying all <nvt> elements (for build_greenbone_cache).

    get_nvts caps each response at 1000 rows, so we paginate with the
    ``rows=N first=M`` filter — the forum-verified pattern for gmp 22.x
    (forum.greenbone.net/t/getting-more-than-1000-results-with-python-gvm/8578)
    — instead of version-specific kwargs. python-gvm is imported lazily so
    offline paths (and tests) never require it.
    """
    import xml.etree.ElementTree as ET

    try:
        from gvm.connections import SSHConnection
        from gvm.protocols.gmp import GMP
    except ImportError as exc:  # pragma: no cover - manual/live path
        raise SystemExit(
            "python-gvm is not installed (pip install -r requirements.txt); "
            "use --gmp-xml <file> for offline cache builds"
        ) from exc

    host = os.environ.get("GREENBONE_HOST", "127.0.0.1")
    port = int(os.environ.get("GREENBONE_PORT", "22"))
    user = os.environ.get("GREENBONE_USER", "admin")
    password = os.environ.get("GREENBONE_PASSWORD", "")

    ROWS = 1000
    MAX_OFFSET = 1_000_000  # sanity guard against a runaway loop

    def page(filter_string: str):
        resp = gmp.get_nvts(details=True, filter_string=filter_string)
        text = resp if isinstance(resp, str) else resp.decode("utf-8")
        root = ET.fromstring(text)
        return root, list(root.iter("nvt"))

    connection = SSHConnection(hostname=host, port=port)
    with GMP(connection) as gmp:
        gmp.authenticate(user, password)
        first_root, first_nvts = page(f"rows={ROWS} first=0")
        total_el = first_root.find("filtered")
        try:
            total = (
                int(total_el.text)
                if total_el is not None and total_el.text
                else len(first_nvts)
            )
        except ValueError:
            total = len(first_nvts)

        nvts = list(first_nvts)
        offset = ROWS
        while len(nvts) < total and offset < MAX_OFFSET:
            _, more = page(f"rows={ROWS} first={offset}")
            if not more:
                break
            nvts.extend(more)
            offset += ROWS

    return (
        "<get_nvts_response>"
        + "".join(ET.tostring(n, encoding="unicode") for n in nvts)
        + "</get_nvts_response>"
    )


def _resolve_output(out: str | None) -> Path:
    target = out or os.environ.get("GREENBONE_FEED_PATH") or DEFAULT_FEED_PATH
    return Path(target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--gmp-xml", help="Local GMP get_nvts XML file instead of a live fetch."
    )
    parser.add_argument("--out", help="Output cache path (defaults to $GREENBONE_FEED_PATH).")
    args = parser.parse_args()

    try:
        xml_text = (
            Path(args.gmp_xml).read_text(encoding="utf-8")
            if args.gmp_xml
            else _fetch_gmp_xml()
        )
        cache = build_greenbone_cache(xml_text)
    except FileNotFoundError as exc:
        print(f"error: cannot read GMP XML file: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # network/auth/parse failures
        print(f"error: failed to build Greenbone cache: {exc}", file=sys.stderr)
        return 1

    if not cache["versioned"]:
        print("error: no CVE data parsed from the GMP export; leaving previous cache intact", file=sys.stderr)
        return 1

    target = _resolve_output(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".greenbone-cache-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, indent=2)
        os.replace(tmp, target)
    except Exception as exc:  # pragma: no cover - filesystem edge cases
        try:
            os.unlink(tmp)
        except OSError:
            pass
        print(f"error: failed to write cache: {exc}", file=sys.stderr)
        return 1

    count = sum(len(v) for v in cache["versioned"].values())
    print(f"wrote Greenbone cache with {count} CVE records to {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())