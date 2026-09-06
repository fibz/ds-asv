"""Dependency injection for FastAPI routes."""

import os
from dataclasses import dataclass
from typing import Generator, Optional

from fastapi import Header, HTTPException
from sqlalchemy.orm import Session

from app.models.database import SessionLocal


def get_db_session() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@dataclass(frozen=True)
class Identity:
    """Resolved dashboard identity: role + optional QSA customer scope.

    v1 role derivation (design spec §6.1; QSA token issuer is a flagged
    follow-up, so QSA tokens are opt-in via env):
    - ``operator`` — bearer equals ``API_BEARER_TOKEN`` (the shared long-lived
      operator token, current behavior).
    - ``qsa`` — bearer equals ``API_QSA_TOKEN``. When ``API_QSA_CUSTOMER_ID``
      is also set, the identity carries that customer scope.
    """

    token: str
    role: str  # "operator" | "qsa"
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None


def _operator_token() -> str:
    return os.environ.get("API_BEARER_TOKEN", "dev-token")


def resolve_identity(authorization: str | None) -> Identity:
    """Resolve the caller's identity from a Bearer header. Raises 401 on
    missing/invalid credentials. The shared operator token always resolves to
    the operator role; an optional QSA token resolves to a customer scope."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if token == _operator_token():
        return Identity(token=token, role="operator")

    qsa_token = os.environ.get("API_QSA_TOKEN", "").strip()
    if qsa_token and token == qsa_token:
        customer_id = os.environ.get("API_QSA_CUSTOMER_ID", "").strip() or None
        customer_name = os.environ.get("API_QSA_CUSTOMER_NAME", "").strip() or None
        return Identity(
            token=token,
            role="qsa",
            customer_id=customer_id,
            customer_name=customer_name,
        )

    raise HTTPException(status_code=401, detail="Invalid or expired token")


def verify_bearer_token(authorization: str | None = Header(None)) -> str:
    """Legacy single-token auth. Production: replace with OAuth2/OIDC."""
    return resolve_identity(authorization).token


def get_identity(authorization: str | None = Header(None)) -> Identity:
    """Dashboard dependency: the caller's resolved role + scope."""
    return resolve_identity(authorization)
