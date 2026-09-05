"""Integration test fixtures (real postgres via tests/fixtures/docker-compose.yml).

All tests in this package run against the postgres spun up by the
`test-integration` make target. When that postgres is unreachable (docker
absent, compose not started), every test here skips cleanly so the gate
exits 0 — the scanner's unit suite never depends on it.
"""

import os
import time

import pytest
from sqlalchemy import create_engine, text

# The URL the fixture postgres is published on. Overridable for a shared DB.
IT_DATABASE_URL = os.environ.get(
    "ASV_IT_DATABASE_URL",
    "postgresql+psycopg2://asv_it:CHANGE_ME@127.0.0.1:54329/asv_scanner_it",
)


def _db_reachable(
    url: str = IT_DATABASE_URL, attempts: int = 15, delay: float = 1.0
) -> bool:
    """True when the integration postgres answers `SELECT 1`.

    Retries briefly because `docker compose up -d` returns before postgres is
    ready to accept connections; a single probe would false-negative on the
    gate even though the fixture is healthy a second later.
    """
    for _ in range(attempts):
        try:
            engine = create_engine(url, connect_args={"connect_timeout": 2})
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            engine.dispose()
            return True
        except Exception as err:
            # Connection refused = nothing listening (docker absent) — fail
            # fast instead of burning the retry budget. Timeouts / other
            # errors = postgres still booting — wait and retry.
            if "Connection refused" in str(err):
                return False
            time.sleep(delay)
    return False


@pytest.fixture(scope="session", autouse=True)
def _integration_db():
    """Point the scanner's engine at the integration postgres and create the schema.

    Skips the whole package when the DB is unreachable (docker absent), so the
    gate exits 0 instead of failing. When reachable, tables are created once
    per session and dropped again at teardown — each run starts from a clean
    schema, matching the `down -v` of the make target.
    """
    if not _db_reachable():
        pytest.skip("integration postgres not reachable (docker absent?); skip cleanly")

    os.environ["DATABASE_URL"] = IT_DATABASE_URL

    from app.models.database import Base, _get_engine, init_db, reset_engine

    reset_engine()
    engine = _get_engine()
    init_db()
    yield
    # Teardown: drop schema + release engine so a later suite re-inits.
    try:
        Base.metadata.drop_all(bind=engine)
    finally:
        reset_engine()
