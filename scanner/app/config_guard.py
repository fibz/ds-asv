"""Startup credential bootstrap guard (scanner).

Dev/test connect with hardcoded local credentials (``asv:CHANGE_ME@localhost``
URL defaults, ``dev-token`` bearer, ``dev-manifest-secret``). Those values must
never reach a non-dev run, where secrets come from env / Vault. Call
:func:`assert_secrets_bootstrapped` from the API startup path so a prod-mode
run still wired with placeholders refuses to start.
"""

from __future__ import annotations

import os

DEV_DB_PASSWORD_MARKERS = (":asv@", ":CHANGE_ME@", "CHANGE_ME")
DEV_MANIFEST_SECRET = "dev-manifest-secret"
DEV_BEARER_TOKEN = "dev-token"


def _looks_placeholder_db(url: str | None) -> bool:
    if not url:
        return True
    return any(marker in url for marker in DEV_DB_PASSWORD_MARKERS)


def _is_dev_value(value: str | None, dev_values: tuple[str, ...]) -> bool:
    if not value:
        return True
    return value.strip() in dev_values


def assert_secrets_bootstrapped(
    app_mode: str | None,
    env: dict[str, str | None] | None = None,
) -> None:
    """Refuse a non-dev run still wired with placeholder/dev credentials.

    Only enforced when ``APP_MODE`` is ``prod``; dev/test are unaffected.
    """
    mode = app_mode or os.environ.get("APP_MODE") or "dev"
    if mode != "prod":
        return
    data = env if env is not None else os.environ
    db_url = data.get("DATABASE_URL")
    if _looks_placeholder_db(db_url):
        raise RuntimeError(
            "Refusing to start in prod: DATABASE_URL is unset or still a "
            "dev/placeholder credential — inject it from env/Vault."
        )
    manifest = data.get("MANIFEST_SECRET")
    if _is_dev_value(manifest, (DEV_MANIFEST_SECRET,)):
        raise RuntimeError(
            "Refusing to start in prod: MANIFEST_SECRET is unset or still "
            "the dev fallback ('dev-manifest-secret') — inject from env/Vault."
        )
    bearer = data.get("API_BEARER_TOKEN")
    if _is_dev_value(bearer, (DEV_BEARER_TOKEN, "")):
        raise RuntimeError(
            "Refusing to start in prod: API_BEARER_TOKEN is unset or still "
            "the dev token — inject a real bearer secret from env/Vault."
        )
