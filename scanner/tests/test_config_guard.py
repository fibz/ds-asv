"""Startup credential-bootstrap guard tests (non-dev refuses dev creds)."""

import pytest

from app.config_guard import assert_secrets_bootstrapped

PROD_ENV = {
    "DATABASE_URL": "postgresql+psycopg2://asv:real-prod-pw@db.internal:5432/asv_scanner",
    "MANIFEST_SECRET": "real-manifest-secret",
    "API_BEARER_TOKEN": "real-bearer",
}


def test_passes_fully_injected_prod_env():
    assert_secrets_bootstrapped("prod", PROD_ENV)


def test_dev_mode_ignores_placeholder_values():
    # Dev/test keep the hardcoded local credentials — never enforced.
    assert_secrets_bootstrapped(
        "dev",
        {
            "DATABASE_URL": "postgresql+psycopg2://asv:CHANGE_ME@localhost:5432/asv_scanner",
            "MANIFEST_SECRET": "dev-manifest-secret",
            "API_BEARER_TOKEN": "dev-token",
        },
    )
    assert_secrets_bootstrapped("", {})


def test_prod_refuses_placeholder_db_url():
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        assert_secrets_bootstrapped(
            "prod",
            {
                **PROD_ENV,
                "DATABASE_URL": "postgresql+psycopg2://asv:CHANGE_ME@localhost:5432/asv_scanner",
            },
        )


def test_prod_refuses_unset_db_url():
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        assert_secrets_bootstrapped("prod", {**PROD_ENV, "DATABASE_URL": None})


def test_prod_refuses_dev_manifest_secret():
    with pytest.raises(RuntimeError, match="MANIFEST_SECRET"):
        assert_secrets_bootstrapped(
            "prod", {**PROD_ENV, "MANIFEST_SECRET": "dev-manifest-secret"}
        )


def test_prod_refuses_dev_bearer_token():
    with pytest.raises(RuntimeError, match="API_BEARER_TOKEN"):
        assert_secrets_bootstrapped(
            "prod", {**PROD_ENV, "API_BEARER_TOKEN": "dev-token"}
        )
