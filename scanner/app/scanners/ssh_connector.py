"""PCI ASV-compliant SSH authenticated scanner connector.

Strict security: no password auth, no ssh-agent, no host key auto-add.
"""

import base64
import binascii
import hashlib
import hmac
import io
import logging
import socket
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import paramiko

logger = logging.getLogger("asv.ssh")


def _parse_sha256_fingerprint(value: str) -> bytes:
    """Parse an OpenSSH SHA256 fingerprint or a legacy hexadecimal digest."""
    fingerprint = value.strip()
    if fingerprint.startswith("SHA256:"):
        fingerprint = fingerprint[len("SHA256:") :]

    if len(fingerprint) == 64:
        try:
            return bytes.fromhex(fingerprint)
        except ValueError:
            pass

    try:
        decoded = base64.b64decode(
            fingerprint + "=" * (-len(fingerprint) % 4), validate=True
        )
    except (ValueError, binascii.Error) as exc:
        raise ValueError(
            "SSH host-key fingerprint must be SHA256 base64 or hex"
        ) from exc
    if len(decoded) != hashlib.sha256().digest_size:
        raise ValueError("SSH host-key fingerprint must contain a SHA256 digest")
    return decoded


class _PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    """Accept an unknown host only when its key matches the configured pin."""

    def __init__(self, expected_digest: bytes):
        self.expected_digest = expected_digest

    def missing_host_key(self, client, hostname, key):  # type: ignore[no-untyped-def]
        actual_digest = hashlib.sha256(key.asbytes()).digest()
        if not hmac.compare_digest(actual_digest, self.expected_digest):
            actual = base64.b64encode(actual_digest).decode().rstrip("=")
            raise paramiko.SSHException(
                f"SSH host key mismatch for {hostname}; received SHA256:{actual}"
            )


@dataclass(frozen=True)
class SSHCredentials:
    username: str
    private_key: str
    signed_cert: Optional[str] = None
    known_hosts_fingerprint: Optional[str] = None


class SSHAuthScanner:
    """Authenticated SSH scanner with privilege validation."""

    def __init__(
        self,
        target_host: str,
        target_port: int = 22,
        timeout: int = 30,
        command_timeout: int = 60,
    ):
        self.target_host = target_host
        self.target_port = target_port
        self.timeout = timeout
        self.command_timeout = command_timeout
        self._client: Optional[paramiko.SSHClient] = None

    def _verify_host_key(self, expected_digest: bytes) -> None:
        """Re-check the established transport key against the required pin."""
        if self._client is None:
            raise ConnectionError("SSH client not initialized")
        transport = self._client.get_transport()
        if transport is None:
            raise ConnectionError("Transport not established")
        server_key = transport.get_remote_server_key()
        actual_digest = hashlib.sha256(server_key.asbytes()).digest()
        fingerprint = base64.b64encode(actual_digest).decode().rstrip("=")
        if not hmac.compare_digest(actual_digest, expected_digest):
            raise ConnectionError(
                f"SSH host key changed during connection to {self.target_host}"
            )
        logger.info(f"Host key SHA256:{fingerprint} verified for {self.target_host}")

    def connect(self, creds: SSHCredentials) -> None:
        """Establish authenticated SSH session with hardened settings."""
        if not creds.known_hosts_fingerprint:
            raise ValueError("An expected SSH host-key fingerprint is required")
        expected_digest = _parse_sha256_fingerprint(creds.known_hosts_fingerprint)

        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(_PinnedHostKeyPolicy(expected_digest))

        try:
            pkey = paramiko.Ed25519Key.from_private_key(
                file_obj=io.StringIO(creds.private_key)
            )
        except paramiko.SSHException:
            pkey = paramiko.RSAKey.from_private_key(  # type: ignore
                file_obj=io.StringIO(creds.private_key)
            )

        if creds.signed_cert:
            pkey.load_certificate(creds.signed_cert)

        try:
            self._client.connect(
                hostname=self.target_host,
                port=self.target_port,
                username=creds.username,
                pkey=pkey,
                look_for_keys=False,
                allow_agent=False,
                timeout=self.timeout,
                banner_timeout=self.timeout,
                auth_timeout=self.timeout,
            )
            self._verify_host_key(expected_digest)
        except Exception:
            self.disconnect()
            raise
        logger.info(f"Authenticated to {self.target_host} as {creds.username}")

    def validate_privilege_level(self) -> dict:
        """Verify account is NOT root and ideally read-only."""
        _, stdout, _ = self._client.exec_command("id -u")
        uid = int(stdout.read().decode().strip())

        if uid == 0:
            raise PermissionError(
                f"ASV policy violation: scan account is root (uid={uid})"
            )

        _, stdout, _ = self._client.exec_command("sudo -n -l 2>&1")
        sudo_output = stdout.read().decode().strip()
        has_sudo = "may run the following" in sudo_output.lower()

        _, stdout, _ = self._client.exec_command(
            "touch /tmp/asv_write_test_$$ 2>&1; echo $?"
        )
        can_write_tmp = int(stdout.read().decode().strip()) == 0

        return {
            "uid": uid,
            "has_sudo": has_sudo,
            "can_write_tmp": can_write_tmp,
            "validated": True,
        }

    def collect_inventory(self) -> dict:
        """Gather ground-truth system data via whitelisted commands."""
        commands = {
            "os_release": "cat /etc/os-release",
            "kernel": "uname -a",
            "packages_deb": "dpkg -l 2>/dev/null",
            "packages_rpm": "rpm -qa 2>/dev/null",
            "packages_pacman": "pacman -Q 2>/dev/null",
            "services": "systemctl list-units --type=service --state=running --no-pager 2>/dev/null",  # noqa: E501
            "listeners": "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null",
            "processes": "ps aux",
            "users": "cat /etc/passwd",
            "shadow_perms": "stat -c '%a' /etc/shadow 2>/dev/null",
            "suid_bins": "find / -perm -4000 -type f 2>/dev/null",
            "iptables": "iptables -L -n 2>/dev/null",
        }

        results = {}
        for key, cmd in commands.items():
            try:
                _, stdout, stderr = self._client.exec_command(
                    cmd, timeout=self.command_timeout
                )
                err = stderr.read().decode().strip()
                results[key] = {
                    "output": stdout.read().decode(),
                    "error": err if err else None,
                    "retrieved_at": datetime.utcnow().isoformat(),
                }
            except socket.timeout:
                logger.error(f"Timeout on {self.target_host} for command: {cmd}")
                results[key] = {"error": "TIMEOUT", "output": None}
        return results

    def disconnect(self) -> None:
        if self._client:
            self._client.close()
            self._client = None
            logger.info(f"Closed SSH connection to {self.target_host}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
        return False
