#!/usr/bin/env python3
"""Download/refresh the NVD CVE cache used by the ASV scoring engine.

By default downloads the NVD "recent" CVE feed, parses it with
``app.scoring.nvd_loader.build_cache_from_feed``, and writes the resulting
cache to ``$NVD_FEED_PATH`` (or ``./data/nvd_cache.json``).

Usage::

    python scripts/update_nvd.py                    # download recent feed
    python scripts/update_nvd.py --feed local.json # parse a local feed file
    python scripts/update_nvd.py --out /path/cache.json

Set ``NVD_API_KEY`` to use the NVD API higher rate limit (optional).
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parent.parent

try:
    from app.scoring.nvd_loader import build_cache_from_feed
except ImportError:
    sys.path.insert(0, str(REPO_ROOT))
    from app.scoring.nvd_loader import \
        build_cache_from_feed  # type: ignore[no-redef]

DEFAULT_FEED_URL = "https://nvd.nist.gov/feeds/json/cve/1.1/nvdcve-1.1-recent.json.gz"


def _load_json(path: str) -> Any:
    data = Path(path).read_bytes()
    if path.endswith(".gz"):
        data = gzip.decompress(data)
    return json.loads(data)


def _download(url: str, timeout: int = 60) -> Any:
    headers = {}
    if os.environ.get("NVD_API_KEY"):
        headers["apiKey"] = os.environ["NVD_API_KEY"]
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 - controlled URL
        raw = resp.read()
    if url.endswith(".gz"):
        raw = gzip.decompress(raw)
    return json.loads(raw)


def _resolve_output(out: str | None) -> Path:
    target = out or os.environ.get("NVD_FEED_PATH")
    if not target:
        target_path = REPO_ROOT / "data" / "nvd_cache.json"
    else:
        target_path = Path(target)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    return target_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh the NVD CVE cache.")
    parser.add_argument(
        "--feed", help="Local feed JSON(.gz) path instead of downloading."
    )
    parser.add_argument(
        "--url", default=DEFAULT_FEED_URL, help="NVD feed URL to download."
    )
    parser.add_argument("--out", help="Output cache path (defaults to $NVD_FEED_PATH).")
    args = parser.parse_args()

    if args.feed:
        print(f"loading local feed: {args.feed}")
        doc = _load_json(args.feed)
    else:
        print(f"downloading: {args.url}")
        doc = _download(args.url)

    cache = build_cache_from_feed(doc)
    target = _resolve_output(args.out)
    target.write_text(json.dumps(cache, indent=2))
    print(f"wrote NVD cache -> {target}")
    print(
        "  exact-version entries: {0}, range entries: {1}".format(
            len(cache["versioned"]), sum(len(v) for v in cache["ranges"].values())
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
