"""Banner → cache-product alias resolution (Greenbone follow-up #3)."""

from app.scoring.banner_aliases import (
    SERVICE_ALIASES,
    banner_lookup,
    canonical_product,
    product_from_banner,
)


def test_canonical_product_normalizes_spelling():
    assert canonical_product("nginx") == "nginx"
    assert canonical_product("OpenSSH") == "openssh"
    assert canonical_product("openssh") == "openssh"
    assert canonical_product("Apache httpd") == "apache_http_server"
    assert canonical_product("Apache") == "apache_http_server"
    assert canonical_product("Microsoft IIS") == "microsoft-iis"
    assert canonical_product("  Pure-FTPd  ") == "pure-ftpd"


def test_product_from_banner_prefers_explicit_product_field():
    # nmap reports product="nginx" alongside service="https"; the alias
    # resolver must use the product, never the transport service name.
    assert (
        product_from_banner(
            {
                "service": "https",
                "product": "nginx",
                "version": "nginx 1.18.0",
                "port": 443,
            }
        )
        == "nginx"
    )


def test_product_from_banner_uses_service_alias_when_product_like():
    assert (
        product_from_banner({"service": "openssh", "version": "8.9p1", "port": 22})
        == "openssh"
    )


def test_product_from_banner_returns_none_for_transport_only_service():
    # A pure TLS banner (no product detection) must NOT invent a product.
    assert (
        product_from_banner({"service": "https", "version": "unknown", "port": 443})
        is None
    )


def test_banner_lookup_splits_product_from_display_version():
    product, version = banner_lookup(
        {
            "service": "https",
            "product": "nginx",
            "version": "nginx 1.18.0",
            "port": 443,
        },
        "https",
    )
    assert product == "nginx"
    assert version == "1.18.0"


def test_banner_lookup_falls_back_to_service_group():
    # No product, transport-only service → caller semantics preserved
    # (product = service label, version untouched).
    product, version = banner_lookup(
        {"service": "https", "version": "TLSv1.2", "port": 443}, "https"
    )
    assert product == "https"
    assert version == "TLSv1.2"


def test_banner_lookup_resolves_service_to_cache_product():
    product, version = banner_lookup(
        {"service": "openssh", "version": "OpenSSH_8.9p1", "port": 22}, "openssh"
    )
    assert product == "openssh"
    assert version == "8.9p1"  # product token stripped for range matching


def test_alias_table_is_populated_for_common_servers():
    for svc in (
        "openssh",
        "openssl",
        "nginx",
        "apache",
        "exim",
        "postfix",
        "proftpd",
        "vsftpd",
        "pure-ftpd",
        "lighttpd",
        "caddy",
        "sendmail",
        "microsoft-iis",
    ):
        assert SERVICE_ALIASES.get(svc) or svc in SERVICE_ALIASES.values()
