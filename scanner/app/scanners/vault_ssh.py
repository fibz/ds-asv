"""Vault SSH Provider — dynamic certificate signing for ASV authenticated scanning.

Never stores private keys on disk. Generates ephemeral Ed25519 keypair per scan,
signs with Vault SSH CA, returns in-memory credentials only.
"""

from typing import Tuple

import hvac
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


class VaultSSHProvider:
    """Fetch short-lived SSH certificates from HashiCorp Vault."""

    def __init__(self, vault_addr: str, vault_token: str):
        self.client = hvac.Client(url=vault_addr, token=vault_token)
        if not self.client.is_authenticated():
            raise RuntimeError("Vault authentication failed")

    def generate_ephemeral_keypair(self) -> Tuple[str, str]:
        """Generate a throwaway Ed25519 keypair for this scan session only."""
        private_key = Ed25519PrivateKey.generate()
        public_key = private_key.public_key()

        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.OpenSSH,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()

        public_openssh = public_key.public_bytes(
            encoding=serialization.Encoding.OpenSSH,
            format=serialization.PublicFormat.OpenSSH,
        ).decode()

        return private_pem, public_openssh

    def sign_certificate(self, public_key: str, ttl: str = "2h") -> str:
        """Ask Vault to sign our ephemeral public key. Returns signed certificate."""
        response = self.client.secrets.ssh.generate_signed_key(
            name="asv-scan",
            public_key=public_key,
            valid_principals=["asvscan"],
            ttl=ttl,
        )
        return response["data"]["signed_key"]

    def get_credentials(self, target_host: str) -> dict:
        """Full flow: ephemeral keypair → Vault-signed cert → auth bundle.

        Certificate auto-expires. Private key is NEVER persisted to disk.
        """
        priv_pem, pub_openssh = self.generate_ephemeral_keypair()
        signed_cert = self.sign_certificate(pub_openssh, ttl="2h")

        return {
            "username": "asvscan",
            "private_key": priv_pem,
            "signed_cert": signed_cert,
            "public_key": pub_openssh,
            "ttl_seconds": 7200,
        }
