"""FastAPI application factory."""

import os

from fastapi import FastAPI

from app.api.manifest_routes import router as manifest_router
from app.api.portal import router as portal_router
from app.api.routes import router as v1_router
from app.config_guard import assert_secrets_bootstrapped
from app.models.database import init_db


def create_app() -> FastAPI:
    """Application factory pattern."""
    # Fail-fast: a prod-mode run still wired with hardcoded dev credentials
    # (CHANGE_ME DB URL / dev-manifest-secret / dev-token) refuses to start.
    assert_secrets_bootstrapped(os.environ.get("APP_MODE"))
    app = FastAPI(
        title="ASV Scanner API",
        description="PCI SSC Approved Scanning Vendor platform with authenticated scanning",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    @app.on_event("startup")
    def startup() -> None:
        init_db()

    app.include_router(manifest_router)
    app.include_router(portal_router)
    app.include_router(v1_router)
    return app


# Default ASGI app for uvicorn
app = create_app()
