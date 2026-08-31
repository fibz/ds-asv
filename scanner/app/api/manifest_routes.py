"""Inbound dispatch: receive a manifest and run it as a scan job."""
import logging

from fastapi import APIRouter, HTTPException

from app.executor import InvalidManifestError, execute_manifest

logger = logging.getLogger("asv.api.manifest")
router = APIRouter(prefix="/v1")


@router.post("/manifests", status_code=202)
def dispatch_manifest(body: dict):
    token = (body or {}).get("manifest")
    if not isinstance(token, str) or not token:
        raise HTTPException(status_code=400, detail="manifest is required")
    try:
        result = execute_manifest(token)
    except InvalidManifestError:
        raise HTTPException(status_code=401, detail="Invalid or expired manifest")
    except Exception as exc:
        logger.exception("manifest dispatch failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "accepted", "result": result}
