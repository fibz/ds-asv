"""Banner service/product → cache-product alias resolution.

The black-box banner path feeds CVE lookups with what nmap reports on the
wire: a *service* name (``https``, ``ssh``, ``http``) and a free-text
product string (``nginx``, ``OpenSSH``, ``Apache httpd``). The Greenbone
cache is keyed by the CPE product part (``nginx``, ``openssh``,
``apache_http_server``, ...). Looking a banner up by its service name alone
always misses the cache — this module bridges the two vocabularies.

Resolution order (first hit wins, never guesses):

1. A ``product`` banner key carrying an nmap product string (most precise).
2. The nmap service name mapped through :data:`SERVICE_ALIASES` when the
   service label itself is product-like (e.g. nmap's ``openssh``/``nginx``
   on odd service registrations).
3. ``None`` — the caller keeps its previous lookup semantics (never invent
   a product, per the CVESource contract).
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

# Key = the NORMALIZED spelling a banner string maps to (_normalize: lower,
# runs of non-alphanumerics → single underscore). Value = the cache product
# key (CPE product part). Only well-known equivalences are listed — unknown
# spellings fall through to their normalized form rather than being guessed.
SERVICE_ALIASES: Dict[str, str] = {
    "openssh": "openssh",
    "openssl": "openssl",
    "nginx": "nginx",
    "apache": "apache_http_server",
    "apache_httpd": "apache_http_server",
    "httpd": "apache_http_server",
    "exim": "exim",
    "postfix": "postfix",
    "proftpd": "proftpd",
    "vsftpd": "vsftpd",
    "pure_ftpd": "pure-ftpd",
    "lighttpd": "lighttpd",
    "caddy": "caddy",
    "sendmail": "sendmail",
    "microsoft_iis": "microsoft-iis",
    "microsoft_httpd": "microsoft-iis",
}


def _normalize(raw: str) -> str:
    """Cache-key spelling: lowercase, runs of non-alnum → single underscore."""
    out: list[str] = []
    prev_sep = False
    for ch in raw.strip().lower():
        if ch.isalnum():
            out.append(ch)
            prev_sep = False
        elif not prev_sep:
            out.append("_")
            prev_sep = True
    return "".join(out).strip("_")


def canonical_product(product: str) -> str:
    """Map an nmap product/service string to the cache product key.

    Returns the normalized string when no alias matches — the cache may
    legitimately hold the normalized product verbatim (e.g. ``nginx``).
    """
    normalized = _normalize(product)
    if not normalized:
        return ""
    return SERVICE_ALIASES.get(normalized, normalized)


def product_from_banner(banner: Dict[str, Any]) -> Optional[str]:
    """Resolve the cache product key from a banner, or ``None``.

    Prefers an explicit ``product`` field (nmap's product detection); else
    the service name when it is product-like via the alias table.
    """
    raw_product = str(banner.get("product") or "").strip()
    if raw_product and raw_product.lower() not in ("unknown", ""):
        key = canonical_product(raw_product)
        if key:
            return key
    service = str(banner.get("service") or "").strip()
    if service and service.lower() not in ("unknown", ""):
        key = _normalize(service)
        if key in SERVICE_ALIASES:
            return SERVICE_ALIASES[key]
    return None


def banner_lookup(banner: Dict[str, Any], fallback_service: str) -> Tuple[str, str]:
    """Return ``(product, version)`` to hand to a CVESource lookup.

    Uses the banner's product alias when resolvable; otherwise the caller's
    current semantics (the group service label as product). Version is the
    banner's version text (nmap product+version display) trimmed of a
    leading product token when the product key equals that token, so a
    banner ``"nginx 1.18.0"`` becomes ``(nginx, 1.18.0)``.
    """
    resolved = product_from_banner(banner)
    product = resolved or fallback_service
    version = str(banner.get("version") or "").strip()
    if resolved and version:
        # Display version strings lead with the product ("nginx 1.18.0",
        # "OpenSSH_8.9p1"); drop the product token and its separator so only
        # the version reaches the range matcher. Only done when the product
        # came from the banner (explicit field or product-like service) — a
        # bare fallback label must not mangle the version.
        for prefix in (resolved, resolved.replace("_", " ")):
            if version.lower().startswith(prefix.lower()):
                version = version[len(prefix) :].lstrip(" _-")
                break
    return product, version
