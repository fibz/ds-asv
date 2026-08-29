#!/usr/bin/env python3
"""Idempotently configure a HashiCorp Vault dev server for ASV scanning.

Provisions:
  * the SSH secrets engine mounted at ``ssh/``,
  * the ``asv-scan`` SSH CA role (read infra/vault/policies/ssh-roles.hcl),
  * the ``asv-scanner`` Vault policy (read infra/vault/policies/asv-scanner.hcl).

Run against the dev container::

    make vault-dev          # starts vault
    make vault-configure    # this script

Environment:
    VAULT_ADDR   e.g. http://localhost:8200
    VAULT_TOKEN  e.g. dev-token

Idempotent: every step tolerates existing resources.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Dict

try:
    import hvac
except ImportError:  # pragma: no cover
    hvac = None  # type: ignore[assignment]

VAULT_ADDR = os.environ.get("VAULT_ADDR", "http://localhost:8200")
VAULT_TOKEN = os.environ.get("VAULT_TOKEN", "dev-token")
POLICIES_DIR = Path(__file__).resolve().parent.parent / "infra" / "vault" / "policies"
SSH_ROLE_FILE = POLICIES_DIR / "ssh-roles.hcl"
SCANNER_POLICY_FILE = POLICIES_DIR / "asv-scanner.hcl"
SSH_MOUNT = "ssh"


def _client() -> "hvac.Client":
    if hvac is None:
        raise RuntimeError("hvac is not installed; run `pip install hvac`")
    client = hvac.Client(url=VAULT_ADDR, token=VAULT_TOKEN)
    if not client.is_authenticated():
        raise RuntimeError("Vault authentication failed (check VAULT_TOKEN)")
    return client


def _load_ssh_role() -> Dict[str, object]:
    """Parse the JSON body out of an annotated .hcl policy file."""
    text = SSH_ROLE_FILE.read_text()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"no JSON body found in {SSH_ROLE_FILE}")
    import json

    return json.loads(match.group(0))


def _ensure_ssh_engine(client: "hvac.Client") -> None:
    mounts = client.sys.list_mounted_secrets_engines()
    key = SSH_MOUNT + "/"
    if key in mounts or SSH_MOUNT in mounts:
        print(f"ssh secrets engine already mounted at {key}")
        return
    client.sys.enable_secrets_engine(backend_type="ssh", path=SSH_MOUNT)
    print(f"enabled ssh secrets engine at {key}")


def _ensure_ssh_role(client: "hvac.Client", role: Dict[str, object]) -> None:
    create_role = getattr(
        client.secrets.ssh,
        "create_or_update_role",
        client.secrets.ssh.create_role,
    )
    create_role(
        name="asv-scan",
        mount_point=SSH_MOUNT,
        **role,  # type: ignore[arg-type]
    )
    print("ssh/roles/asv-scan configured")


def _ensure_policy(client: "hvac.Client") -> None:
    hcl = SCANNER_POLICY_FILE.read_text()
    try:
        client.sys.create_or_update_policy(name="asv-scanner", policy=hcl)
    except Exception:
        # Some hvac versions use create_or_update_policies; fall back.
        client.sys.create_or_update_policy(name="asv-scanner", policy=hcl)  # type: ignore[call-arg]
    print("policy asv-scanner written")


def main() -> int:
    role = _load_ssh_role()
    client = _client()
    _ensure_ssh_engine(client)
    _ensure_ssh_role(client, role)
    _ensure_policy(client)
    print("Vault configured for ASV scanning.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
