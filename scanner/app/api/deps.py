"""Dependency injection for FastAPI routes."""

import os
from typing import Generator

from fastapi import Header, HTTPException
from sqlalchemy.orm import Session

from app.models.database import SessionLocal


def get_db_session() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_bearer_token(authorization: str | None = Header(None)) -> str:
    """Simple bearer token auth. Production: replace with OAuth2/OIDC."""
    expected = os.environ.get("API_BEARER_TOKEN", "dev-token")

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or token != expected:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return token
