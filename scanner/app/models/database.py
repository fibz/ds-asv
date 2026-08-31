"""Database engine and session management with dynamic engine support."""

import os
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

_engine = None
_SessionLocal = None


def _get_engine():
    """Get or create engine from environment — safe for testing."""
    global _engine
    if _engine is None:
        db_url = os.environ.get(
            "DATABASE_URL",
            "postgresql+psycopg2://asv:CHANGE_ME@localhost:5432/asv_scanner",
        )
        _engine = create_engine(db_url, pool_pre_ping=True)
    return _engine


def _get_session_local():
    """Get or create session factory."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=_get_engine()
        )
    return _SessionLocal


def SessionLocal():
    """Callable that returns a session — dynamically resolves engine.

    Drop-in replacement for static SessionLocal; safe for import-time usage
    and testing with varied DATABASE_URL values.
    """
    Session = _get_session_local()
    return Session()


Base = declarative_base()


def reset_engine():
    """Reset engine — call between tests or when DATABASE_URL changes."""
    global _engine, _SessionLocal
    _engine = None
    _SessionLocal = None


def init_db() -> None:
    """Create all tables. Call once at startup."""
    Base.metadata.create_all(bind=_get_engine())


@contextmanager
def get_db():
    """Yield a database session with automatic commit/rollback."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# FastAPI depends on this name via app.api.deps
get_db_session = get_db
