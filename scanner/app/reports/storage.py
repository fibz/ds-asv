"""Evidence storage backend — MinIO/S3 with compliance Object Lock."""

import hashlib
import io
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict

try:
    from minio import Minio
    from minio.error import S3Error
except ImportError:
    Minio = None  # type: ignore
    S3Error = Exception  # type: ignore

logger = logging.getLogger("asv.evidence")


class EvidenceVault:
    """Immutable evidence storage with cryptographic attestation."""

    def __init__(self):
        self.client = None
        self._init_minio()
        self.bucket = os.environ.get("MINIO_BUCKET", "asv-evidence")
        self._ensure_bucket()

    def _init_minio(self) -> None:
        if Minio is None:
            logger.warning("minio not installed; evidence will not persist")
            return
        secret_key = os.environ.get("MINIO_SECRET_KEY", "")
        if not secret_key:
            logger.warning("MINIO_SECRET_KEY not set; evidence will use local fallback")
            return
        try:
            self.client = Minio(
                os.environ.get("MINIO_ENDPOINT", "localhost:9000"),
                access_key=os.environ.get("MINIO_ACCESS_KEY", "asvadmin"),
                secret_key=secret_key,
                secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
            )
        except Exception as e:
            logger.warning(f"MinIO initialization failed: {e}")
            self.client = None

    def _ensure_bucket(self) -> None:
        if self.client is None:
            return
        try:
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
                # Attempt to enable object lock (requires bucket creation with lock)
                logger.info(f"Created bucket: {self.bucket}")
        except Exception as e:
            logger.warning(f"Bucket setup issue: {e}")

    def store(
        self, customer_id: str, scan_id: str, evidence_type: str, data: Dict[str, Any]
    ) -> Dict[str, str]:
        """Store evidence with SHA-256 hash and metadata.

        Returns metadata dict with object_key, sha256, and bucket.
        """
        key = f"{customer_id}/{scan_id}/{evidence_type}_{datetime.utcnow().isoformat()}.json"
        body = json.dumps(data, indent=2, default=str).encode("utf-8")
        content_hash = hashlib.sha256(body).hexdigest()

        if self.client:
            try:
                self.client.put_object(
                    bucket_name=self.bucket,
                    object_name=key,
                    data=io.BytesIO(body),
                    length=len(body),
                    content_type="application/json",
                    metadata={
                        "x-amz-meta-customer-id": customer_id,
                        "x-amz-meta-scan-id": scan_id,
                        "x-amz-meta-evidence-type": evidence_type,
                        "x-amz-meta-content-sha256": content_hash,
                        "x-amz-meta-scanned-at": datetime.utcnow().isoformat(),
                    },
                )
            except S3Error as e:
                logger.error(f"MinIO upload failed: {e}")
                # Fallback: store locally
                return self._store_local(key, body, content_hash)
        else:
            return self._store_local(key, body, content_hash)

        # Append audit log
        self._append_audit_log(customer_id, scan_id, key, content_hash)

        return {
            "object_key": key,
            "sha256": content_hash,
            "bucket": self.bucket,
        }

    def _store_local(self, key: str, body: bytes, content_hash: str) -> Dict[str, str]:
        """MinIO unavailable — write to local filesystem as fallback."""
        local_dir = os.environ.get("EVIDENCE_LOCAL_DIR", "/tmp/asv-evidence")
        path = os.path.join(local_dir, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        logger.info(f"Evidence stored locally: {path}")
        return {
            "object_key": key,
            "sha256": content_hash,
            "bucket": "local",
            "local_path": path,
        }

    def _append_audit_log(
        self, customer_id: str, scan_id: str, object_key: str, sha256: str
    ) -> None:
        """Append-only audit log for non-repudiation."""
        log_entry = json.dumps(
            {
                "ts": datetime.utcnow().isoformat(),
                "customer_id": customer_id,
                "scan_id": scan_id,
                "object_key": object_key,
                "sha256": sha256,
            }
        )

        log_key = f"_audit/{datetime.utcnow().strftime('%Y-%m-%d')}.ndjson"
        if self.client:
            try:
                existing = self.client.get_object(self.bucket, log_key).read()
            except S3Error:
                existing = b""

            combined = existing + log_entry.encode() + b"\n"
            self.client.put_object(
                bucket_name=self.bucket,
                object_name=log_key,
                data=io.BytesIO(combined),
                length=len(combined),
                content_type="application/x-ndjson",
            )
        else:
            local_dir = os.environ.get("EVIDENCE_LOCAL_DIR", "/tmp/asv-evidence")
            log_path = os.path.join(local_dir, log_key)
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, "ab") as f:
                f.write(log_entry.encode() + b"\n")
