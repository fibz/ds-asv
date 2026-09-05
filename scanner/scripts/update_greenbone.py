#!/usr/bin/env python3
"""Build the Greenbone CVE cache used by the ASV scoring engine.

Two modes:

  --gmp-xml <file>   parse an existing GMP <get_nvts_response> XML document
                     (offline: use in CI/dev; capture one from a real gvmd
                     with the live mode below and keep it as a fixture)
  live (default)     fetch NVT metadata from gvmd (GMP) using python-gvm —
                     requires python-gvm + a reachable gvmd. Connection
                     type from $GREENBONE_CONNECTION:
                       ssh   python-gvm SSHConnection (default): SSH login
                             via GREENBONE_HOST / GREENBONE_PORT /
                             GREENBONE_SSH_USER / GREENBONE_SSH_PASSWORD
                             (GREENBONE_SSH_AUTO_ACCEPT=1 accepts the host
                             key on first connect; note python-gvm only
                             supports password SSH auth — no key files)
                       tcp   plain GMP over TCP — point it at an OpenSSH
                             unix-socket forward of the remote gvmd socket:
                               ssh -L 127.0.0.1:9390:/run/gvmd/gvmd.sock user@host
                             then GREENBONE_CONNECTION=tcp GREENBONE_HOST=127.0.0.1
                             GREENBONE_PORT=9390
                       unix  local gvmd socket (GREENBONE_SOCKET, default
                             /run/gvmd/gvmd.sock) — use when this script
                             runs on the same host as gvmd
                     GMP credentials always come from GREENBONE_USER /
                     GREENBONE_PASSWORD

Writes the {versioned, ranges} cache to $GREENBONE_FEED_PATH
(default ./data/greenbone_cves.json, see GREENBONE_FEED_PATH) via a temp
file + atomic rename. A failed fetch, unparseable XML, or an empty export
EXITS NON-ZERO and NEVER clobbers the last good cache.

Usage::

    python scripts/update_greenbone.py --gmp-xml tests/fixtures/gmp_get_nvts.xml
    python scripts/update_greenbone.py --gmp-xml local.xml --out /path/cache.json
    python scripts/update_greenbone.py               # live GMP fetch

Configuration::

    All GREENBONE_* values can also live in scanner/greenbone.env
    (gitignored; copy scanner/greenbone.env.example and edit — one file
    to change the endpoint later). $GREENBONE_CONFIG points at a different
    file. Environment variables always take precedence over the file.
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

from app.scoring.greenbone_export import (  # noqa: E402
    build_greenbone_cache,
    build_greenbone_cache_from_tsv,
    build_greenbone_cache_ranges_from_tsv,
)

DEFAULT_FEED_PATH = "./data/greenbone_cves.json"
DEFAULT_UNIX_SOCKET = "/run/gvmd/gvmd.sock"
DEFAULT_TCP_PORT = 9390
CONFIG_FILE_NAME = "greenbone.env"


def _default_config_path() -> Path:
    """Default config file: scanner/greenbone.env (gitignored, real values)."""
    return Path(__file__).resolve().parent.parent / CONFIG_FILE_NAME


def _load_config() -> dict:
    """Load KEY=VALUE defaults into os.environ from the config file.

    The file is a plain .env-style text file (blank lines and ``#`` comment
    lines are ignored). $GREENBONE_CONFIG overrides the default location
    (``scanner/greenbone.env``, gitignored — copy ``greenbone.env.example``
    and fill in your values, so the endpoint is one editable file).
    Values ALREADY in the environment win, so shell exports still override
    the file. Returns the parsed mapping (already applied to os.environ).
    """
    path = (
        Path(os.environ["GREENBONE_CONFIG"])
        if os.environ.get("GREENBONE_CONFIG")
        else _default_config_path()
    )
    if not path.exists():
        return {}
    values: dict = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not key:
            continue
        values[key] = value
        os.environ.setdefault(key, value)
    return values


class TCPConnection:
    """Minimal GMP-over-TCP connection (python-gvm GmpConnection-compatible).

    Speaks plain GMP XML over a TCP stream. The typical use is talking to a
    remote gvmd through an OpenSSH forward of its unix socket::

        ssh -L 127.0.0.1:9390:/run/gvmd/gvmd.sock user@gvmd-host
        GREENBONE_CONNECTION=tcp GREENBONE_HOST=127.0.0.1 \
            GREENBONE_PORT=9390 python scripts/update_greenbone.py

    Exposes read/send/connect/disconnect/finish_send so python-gvm's GMP
    protocol object can drive it exactly like SSHConnection/UnixSocketConnection.
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = DEFAULT_TCP_PORT,
        timeout: int | float = 60,
    ):
        self.host = host
        self.port = port
        self.timeout = timeout
        self._sock: object = None  # socket.socket once connect()ed

    def connect(self) -> None:
        import socket

        self._sock = socket.create_connection(
            (self.host, self.port), timeout=self.timeout
        )

    def send(self, data: bytes) -> None:
        if self._sock is None:
            raise OSError("TCPConnection not connected")
        self._sock.sendall(data)  # type: ignore[attr-defined]

    def read(self) -> bytes:
        if self._sock is None:
            raise OSError("TCPConnection not connected")
        data = self._sock.recv(65536)  # type: ignore[attr-defined]
        if not data:
            raise OSError("Remote closed the connection")
        return data

    def finish_send(self) -> None:
        import socket

        if self._sock is not None:
            try:
                self._sock.shutdown(socket.SHUT_WR)  # type: ignore[attr-defined]
            except OSError:
                pass

    def disconnect(self) -> None:
        if self._sock is not None:
            self._sock.close()  # type: ignore[attr-defined]
            self._sock = None


def _connection_type() -> str:
    """GMP connection type: ssh (default) | tcp | unix (from GREENBONE_CONNECTION)."""
    ctype = os.environ.get("GREENBONE_CONNECTION", "ssh").strip().lower()
    if ctype not in ("ssh", "tcp", "unix"):
        raise SystemExit(
            f"GREENBONE_CONNECTION must be ssh, tcp, or unix (got {ctype!r})"
        )
    return ctype


def _connection():
    """Build the python-gvm connection object for the configured type."""
    ctype = _connection_type()
    if ctype == "ssh":
        try:
            from gvm.connections import SSHConnection
        except ImportError as exc:  # pragma: no cover - manual/live path
            raise SystemExit(
                "python-gvm is not installed (pip install -r requirements.txt); "
                "use --gmp-xml <file> for offline cache builds"
            ) from exc
        return SSHConnection(**_ssh_kwargs())
    if ctype == "unix":
        from gvm.connections import UnixSocketConnection

        return UnixSocketConnection(
            path=os.environ.get("GREENBONE_SOCKET", DEFAULT_UNIX_SOCKET)
        )
    return TCPConnection(
        host=os.environ.get("GREENBONE_HOST", "127.0.0.1"),
        port=int(os.environ.get("GREENBONE_PORT", str(DEFAULT_TCP_PORT))),
    )


def _nvts_page_request(first: int, rows: int = 1000) -> str:
    """Canonical GMP ``get_nvts`` request for one page of NVTs.

    gvmd 26.24 hangs/crashes when serving get_nvts with python-gvm's
    ``filter_string`` attribute; the canonical GMP attribute is ``filter``.
    Live-verified 2026-09-05 against gvmd 26.24 (container build): a
    ``filter_string`` request gets no response, the equivalent ``filter``
    request returns status 200 with NVTs.
    """
    return f'<get_nvts details="1" filter="rows={rows} first={first}"/>'


def _ssh_kwargs() -> dict:
    """kwargs for python-gvm's SSHConnection, from the environment.

    GREENBONE_HOST / GREENBONE_PORT select the reachable SSH target
    (defaults 127.0.0.1:22). python-gvm's SSHConnection defaults the SSH
    login to the ``gmp`` user with NO password — which cannot authenticate
    against a normal Kali box — so live fetches MUST set
    GREENBONE_SSH_USER / GREENBONE_SSH_PASSWORD. Setting
    GREENBONE_SSH_AUTO_ACCEPT=1 (or true/yes) accepts the remote host key
    on first connect (convenience for one-shot cache builds; you may
    instead pre-seed ~/.ssh/known_hosts).
    """
    kwargs: dict = {
        "hostname": os.environ.get("GREENBONE_HOST", "127.0.0.1"),
        "port": int(os.environ.get("GREENBONE_PORT", "22")),
    }
    user = os.environ.get("GREENBONE_SSH_USER")
    if user:
        kwargs["username"] = user
    ssh_password = os.environ.get("GREENBONE_SSH_PASSWORD")
    if ssh_password:
        kwargs["password"] = ssh_password
    auto = os.environ.get("GREENBONE_SSH_AUTO_ACCEPT")
    if auto and auto.strip().lower() in ("1", "true", "yes"):
        kwargs["auto_accept_host"] = True
    return kwargs


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
        from gvm.protocols.gmp import GMP
    except ImportError as exc:  # pragma: no cover - manual/live path
        raise SystemExit(
            "python-gvm is not installed (pip install -r requirements.txt); "
            "use --gmp-xml <file> for offline cache builds"
        ) from exc

    user = os.environ.get("GREENBONE_USER", "admin")
    password = os.environ.get("GREENBONE_PASSWORD", "")

    ROWS = 1000
    MAX_OFFSET = 1_000_000  # sanity guard against a runaway loop

    def page(first: int):
        resp = gmp.send_command(_nvts_page_request(first=first, rows=ROWS))
        text = resp if isinstance(resp, str) else resp.decode("utf-8")
        root = ET.fromstring(text)
        return root, list(root.iter("nvt"))

    connection = _connection()
    with GMP(connection) as gmp:
        gmp.authenticate(user, password)
        first_root, first_nvts = page(0)
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
            _, more = page(offset)
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
    _load_config()  # scanner/greenbone.env defaults (real env vars still win)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--gmp-xml", help="Local GMP get_nvts XML file instead of a live fetch."
    )
    parser.add_argument(
        "--cpe-tsv",
        help="gvmd postgres TSV dump (name<TAB>cve<TAB>cvss_base<TAB>cpe) "
        "instead of a live fetch — the reliable path against gvmd 26.24, "
        "which ignores get_nvts filters and stalls on details.",
    )
    parser.add_argument(
        "--ranges-tsv",
        help="gvmd SCAP version-range TSV (criteria<TAB>cve<TAB>start_incl"
        "<TAB>start_excl<TAB>end_incl<TAB>end_excl<TAB>severity) merged "
        "into the cache's ranges (NVD version-range semantics).",
    )
    parser.add_argument("--out", help="Output cache path (defaults to $GREENBONE_FEED_PATH).")
    args = parser.parse_args()

    try:
        if args.cpe_tsv:
            cache = build_greenbone_cache_from_tsv(
                Path(args.cpe_tsv).read_text(encoding="utf-8")
            )
        else:
            xml_text = (
                Path(args.gmp_xml).read_text(encoding="utf-8")
                if args.gmp_xml
                else _fetch_gmp_xml()
            )
            cache = build_greenbone_cache(xml_text)
        if args.ranges_tsv:
            cache["ranges"] = build_greenbone_cache_ranges_from_tsv(
                Path(args.ranges_tsv).read_text(encoding="utf-8")
            )
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