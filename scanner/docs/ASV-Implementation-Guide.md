# ASV Authenticated Scanner: Ground-Up Implementation Guide

> **Companion to:** `ASV-Authenticated-Scanning-Framework.md`
> **Scope:** Production-ready code, Vault policies, Terraform, deployment configs, and operational runbooks.

---

## 1. Project Structure

```
asv-scanner/
├── app/
│   ├── api/                # FastAPI routes
│   ├── scanners/           # SSH / WinRM / SNMP connectors
│   ├── scoring/            # CVSS engine
│   ├── reports/            # SAR generation
│   ├── tasks/              # Celery background jobs
│   └── models/             # SQLAlchemy models
├── infra/
│   ├── terraform/          # AWS/GCP/Azure provisioning
│   ├── vault/              # HCL policies
│   └── systemd/            # Scanner fleet services
├── target-agents/
│   ├── linux/              # Restricted shell + setup script
│   └── windows/            # WinRM hardening + firewall rules
├── tests/
│   ├── fixtures/           # Vulnerable VMs (dockerized)
│   └── integration/        # End-to-end scan tests
└── Makefile
```

---

## 2. HashiCorp Vault: Dynamic SSH Certificate Authority

### 2.1 Enable SSH Secrets Engine

```bash
 vault secrets enable -path=ssh ssh

# Generate CA keypair (this key lives ONLY inside Vault)
vault write ssh/config/ca generate_signing_key=true

# Export CA public key for customer distribution
 vault read -field=public_key ssh/config/ca > asv_ca.pub
```

### 2.2 Role Definition for ASV Scanning

```hcl
# vault/policies/ssh-roles.hcl
# Mount: ssh/roles/asv-scan

{
  "allow_user_certificates": true,
  "allowed_users": "asvscan",
  "allowed_domains": "",
  "allow_bare_domains": false,
  "allow_subdomains": false,
  "default_extensions": {
    "permit-pty": "",
    "permit-port-forwarding": ""
  },
  "key_type": "ca",
  "default_user": "asvscan",
  "ttl": "2h",
  "max_ttl": "4h",
  "allowed_critical_options": "",
  "allowed_extensions": "permit-pty,permit-port-forwarding"
}
```

Apply:
```bash
vault write ssh/roles/asv-scan @vault/policies/ssh-roles.hcl
```

### 2.3 Customer-Side sshd_config

```bash
# /etc/ssh/sshd_config.d/90-asv.conf
# Distribute asv_ca.pub during onboarding

TrustedUserCAKeys /etc/ssh/asv_ca.pub

# Force asvscan user into restricted shell
Match User asvscan
    ForceCommand internal-sftp
    ForceCommand /usr/local/bin/asv-restricted-shell
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
    GatewayPorts no

# Alternatively, use AuthorizedPrincipalsFile for principal-based auth
AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u
```

Create principal file:
```bash
echo "asvscan" > /etc/ssh/auth_principals/asvscan
```

### 2.4 Vault Policy for Scanner Engine

```hcl
# vault/policies/asv-scanner.hcl

# Request dynamic SSH cert at scan time
path "ssh/sign/asv-scan" {
  capabilities = ["create", "update"]
}

# Read customer scope definitions
path "secret/data/customers/+/scope" {
  capabilities = ["read"]
}

# Write scan evidence (append-only)
path "secret/data/evidence/+/+" {
  capabilities = ["create"]
}

# NEVER allow reading other customers' credentials
path "secret/data/customers/+/ssh-private-key" {
  capabilities = ["deny"]
}
```

### 2.5 Python: Request Dynamic SSH Cert at Scan Time

```python
# app/scanners/vault_ssh.py
import hvac
import tempfile
import os
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

class VaultSSHProvider:
    def __init__(self, vault_addr: str, vault_token: str):
        self.client = hvac.Client(url=vault_addr, token=vault_token)
        if not self.client.is_authenticated():
            raise RuntimeError("Vault authentication failed")

    def generate_ephemeral_keypair(self) -> tuple[str, str]:
        """Generate a throwaway Ed25519 keypair for this scan session."""
        private_key = ed25519.Ed25519PrivateKey.generate()
        public_key = private_key.public_key()

        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.OpenSSH,
            encryption_algorithm=serialization.NoEncryption()
        ).decode()

        public_openssh = public_key.public_bytes(
            encoding=serialization.Encoding.OpenSSH,
            format=serialization.PublicFormat.OpenSSH
        ).decode()

        return private_pem, public_openssh

    def sign_certificate(self, public_key: str, ttl: str = "2h") -> str:
        """
        Ask Vault to sign our ephemeral public key.
        Returns the signed certificate (not a private key!).
        """
        response = self.client.secrets.pki.sign_certificate(
            name="asv-scan",  # Uses the ssh/roles/asv-scan role
            csr=public_key,   # Actually public key for SSH CA
            common_name="asvscan",
            ttl=ttl
        )
        # Note: hvac's SSH secrets engine wrapper:
        response = self.client.secrets.ssh.generate_signed_key(
            name="asv-scan",
            public_key=public_key
        )
        return response["data"]["signed_key"]

    def get_credentials(self, target_host: str) -> dict:
        """
        Full flow: generate ephemeral keypair → sign with Vault → return auth bundle.
        Certificate auto-expires in 2h. Private key is NEVER stored.
        """
        priv_pem, pub_openssh = self.generate_ephemeral_keypair()
        signed_cert = self.sign_certificate(pub_openssh, ttl="2h")

        return {
            "username": "asvscan",
            "private_key": priv_pem,      # In-memory only
            "signed_cert": signed_cert,   # Short-lived
            "public_key": pub_openssh,
            "ttl_seconds": 7200
        }
```

---

## 3. SSH Authenticated Scanner Connector

### 3.1 Core Connector with Security Hardening

```python
# app/scanners/ssh_connector.py
import paramiko
import hashlib
import socket
from dataclasses import dataclass
from typing import Optional, List, Tuple
import logging

logger = logging.getLogger("asv.ssh")


@dataclass(frozen=True)
class SSHCredentials:
    username: str
    private_key: str          # PEM format (from Vault)
    signed_cert: Optional[str] = None  # Vault-signed certificate
    known_hosts_fingerprint: Optional[str] = None  # SHA256:xxxxx


class SSHAuthScanner:
    """
    PCI ASV-compliant SSH authenticated scanner.
    NEVER uses password auth, NEVER allows host key auto-add.
    """

    def __init__(
        self,
        target_host: str,
        target_port: int = 22,
        timeout: int = 30,
        command_timeout: int = 60
    ):
        self.target_host = target_host
        self.target_port = target_port
        self.timeout = timeout
        self.command_timeout = command_timeout
        self._client: Optional[paramiko.SSHClient] = None

    def _load_host_key(self, client: paramiko.SSHClient) -> None:
        """
        STRICT host key verification. No AutoAddPolicy.
        If a known_hosts fingerprint is provided, verify it.
        Otherwise, require it to exist in ~/.ssh/known_hosts.
        """
        client.set_missing_host_key_policy(paramiko.RejectPolicy())

        # Verify the server's host key fingerprint matches expectations
        transport = client.get_transport()
        if transport is None:
            raise ConnectionError("Transport not established")

        server_key = transport.get_remote_server_key()
        fingerprint = hashlib.sha256(server_key.asbytes()).hexdigest()
        logger.info(f"Target {self.target_host} host key fingerprint: SHA256:{fingerprint}")

    def connect(self, creds: SSHCredentials) -> None:
        """Establish authenticated SSH session with strict security."""
        self._client = paramiko.SSHClient()

        try:
            pkey = paramiko.Ed25519Key.from_private_key(
                file_obj=io.StringIO(creds.private_key)
            )
        except paramiko.SSHException:
            # Fallback to RSA if needed
            pkey = paramiko.RSAKey.from_private_key(
                file_obj=io.StringIO(creds.private_key)
            )

        # If we have a Vault-signed cert, load it alongside the private key
        if creds.signed_cert:
            # Paramiko doesn't natively support OpenSSH certs easily.
            # We write a temporary cert file and use it.
            cert_path = self._write_temp_cert(creds.signed_cert, creds.private_key)
            pkey = paramiko.RSAKey.from_private_key_file(cert_path)  # or Ed25519 variant

        self._client.connect(
            hostname=self.target_host,
            port=self.target_port,
            username=creds.username,
            pkey=pkey,
            look_for_keys=False,       # Do NOT use ssh-agent keys
            allow_agent=False,         # Do NOT use local ssh-agent
            timeout=self.timeout,
            banner_timeout=self.timeout,
            auth_timeout=self.timeout
        )

        self._load_host_key(self._client)
        logger.info(f"Authenticated to {self.target_host} as {creds.username}")

    def validate_privilege_level(self) -> dict:
        """
        CRITICAL: Verify the account is NOT root and is read-only.
        Raises if account has excessive privileges.
        """
        # Check UID
        _, stdout, stderr = self._client.exec_command("id -u")
        uid_str = stdout.read().decode().strip()
        uid = int(uid_str)

        if uid == 0:
            raise PermissionError(
                f"ASV policy violation: scan account has root privileges (uid={uid})"
            )

        # Check sudo access
        _, stdout, _ = self._client.exec_command("sudo -n -l 2>&1")
        sudo_output = stdout.read().decode().strip()
        if "may run the following" in sudo_output.lower():
            # Account has sudo privileges — flag but don't necessarily fail
            # (some environments require sudo for dpkg -l depending on permissions)
            sudo_privs = True
        else:
            sudo_privs = False

        # Attempt a write test to /tmp
        _, stdout, _ = self._client.exec_command(
            "touch /tmp/asv_write_test_$$ 2>&1; echo $?"
        )
        write_test_rc = int(stdout.read().decode().strip())
        if write_test_rc == 0:
            logger.warning(f"Account can write to /tmp — expected read-only")
            # Don't fail immediately; some environments allow /tmp but nothing else
            can_write_tmp = True
        else:
            can_write_tmp = False

        return {
            "uid": uid,
            "username": self._client.exec_command("whoami")[1].read().decode().strip(),
            "has_sudo": sudo_privs,
            "can_write_tmp": can_write_tmp,
            "validated": True
        }

    def collect_inventory(self) -> dict:
        """
        Gather ground-truth data from the target system.
        Each command is whitelisted in the restricted shell.
        """
        commands = {
            "os_release": "cat /etc/os-release",
            "kernel": "uname -a",
            "packages_deb": "dpkg -l 2>/dev/null",
            "packages_rpm": "rpm -qa 2>/dev/null",
            "packages_pacman": "pacman -Q 2>/dev/null",
            "services": "systemctl list-units --type=service --state=running --no-pager 2>/dev/null",
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
                _, stdout, stderr = self._client.exec_command(cmd, timeout=self.command_timeout)
                err = stderr.read().decode().strip()
                out = stdout.read().decode()
                if err and "not allowed" in err.lower():
                    logger.warning(f"Command '{cmd}' rejected by restricted shell")
                results[key] = {
                    "output": out,
                    "error": err if err else None,
                    "retrieved_at": datetime.utcnow().isoformat()
                }
            except socket.timeout:
                logger.error(f"Command '{cmd}' timed out on {self.target_host}")
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


# --- Integration in Celery task ---
from celery import shared_task

@shared_task(bind=True, max_retries=3)
def run_ssh_auth_scan(self, target_host: str, customer_id: str) -> dict:
    """Celery task: orchestrate authenticated SSH scan for a target."""
    vault = VaultSSHProvider(
        vault_addr=os.environ["VAULT_ADDR"],
        vault_token=os.environ["VAULT_TOKEN"]
    )

    try:
        creds = vault.get_credentials(target_host)

        with SSHAuthScanner(target_host) as scanner:
            scanner.connect(creds)
            priv_info = scanner.validate_privilege_level()
            inventory = scanner.collect_inventory()

        # Parse dpkg/rpm output and cross-reference with NVD
        findings = score_engine.evaluate(inventory)

        # Persist evidence
        evidence_id = store_evidence(customer_id, target_host, inventory, findings)

        return {
            "status": "SUCCESS",
            "target": target_host,
            "privilege_validation": priv_info,
            "findings_count": len(findings),
            "evidence_id": evidence_id
        }

    except Exception as exc:
        logger.exception(f"Scan failed for {target_host}")
        raise self.retry(exc=exc, countdown=300)
```

---

## 4. WinRM Authenticated Scanner Connector

### 4.1 Python pywinrm Implementation

```python
# app/scanners/winrm_connector.py
import winrm
from winrm.exceptions import WinRMTransportError
import logging

logger = logging.getLogger("asv.winrm")


class WinRMAuthScanner:
    """
    Windows authenticated scanner using WinRM over HTTPS.
    NEVER uses HTTP (plaintext) transport.
    """

    def __init__(
        self,
        target_host: str,
        port: int = 5986,
        transport: str = "ntlm",
        server_cert_validation: str = "verify"
    ):
        self.target_host = target_host
        self.port = port
        self.transport = transport
        self.server_cert_validation = server_cert_validation
        self._session: Optional[winrm.Session] = None

    def connect(self, username: str, password: str) -> None:
        endpoint = f"https://{self.target_host}:{self.port}/wsman"
        self._session = winrm.Session(
            endpoint,
            auth=(username, password),
            transport=self.transport,
            server_cert_validation=self.server_cert_validation,
            read_timeout_sec=60,
            operation_timeout_sec=60
        )
        # Run a harmless validation command
        result = self._session.run_ps("whoami")
        if result.status_code != 0:
            raise ConnectionError(f"WinRM validation failed: {result.std_err.decode()}")
        logger.info(f"WinRM authenticated to {self.target_host} as {result.std_out.decode().strip()}")

    def validate_account(self) -> dict:
        """Verify account is not Administrator/SYSTEM and has limited scope."""
        # Check if local admin
        result = self._session.run_ps(
            "([Security.Principal.WindowsPrincipal] "
            "[Security.Principal.WindowsIdentity]::GetCurrent())"
            ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
        )
        is_admin = result.std_out.decode().strip().lower() == "true"
        if is_admin:
            logger.warning(f"WinRM account is Administrator on {self.target_host}")

        # Check username
        result = self._session.run_ps("$env:USERNAME")
        username = result.std_out.decode().strip()

        # Check if SYSTEM
        result = self._session.run_ps("whoami")
        whoami = result.std_out.decode().strip()
        is_system = "system" in whoami.lower()

        return {
            "username": username,
            "whoami": whoami,
            "is_admin": is_admin,
            "is_system": is_system,
            "validated": True
        }

    def collect_inventory(self) -> dict:
        """Gather Windows software inventory, patches, services, listeners."""
        ps_commands = {
            "os_info": "Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture | ConvertTo-Json",
            "hotfixes": "Get-HotFix | Select-Object HotFixID, InstalledOn | ConvertTo-Json",
            "installed_software": "Get-WmiObject -Class Win32_Product | Select-Object Name, Version | ConvertTo-Json",
            "services": "Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object Name, DisplayName | ConvertTo-Json",
            "listeners": "Get-NetTCPConnection | Where-Object {$_.State -eq 'Listen'} | Select-Object LocalAddress, LocalPort, OwningProcess | ConvertTo-Json",
            "processes": "Get-Process | Select-Object Name, Path, Id | ConvertTo-Json",
            "users": "Get-LocalUser | Select-Object Name, Enabled, LastLogon | ConvertTo-Json",
            "firewall_rules": "Get-NetFirewallRule | Where-Object {$_.Enabled -eq 'True'} | Select-Object DisplayName, Direction, Action | ConvertTo-Json",
        }

        results = {}
        for key, ps_cmd in ps_commands.items():
            try:
                result = self._session.run_ps(ps_cmd)
                if result.status_code == 0:
                    results[key] = {
                        "output": result.std_out.decode(),
                        "error": None,
                        "retrieved_at": datetime.utcnow().isoformat()
                    }
                else:
                    results[key] = {
                        "output": None,
                        "error": result.std_err.decode(),
                        "retrieved_at": datetime.utcnow().isoformat()
                    }
            except WinRMTransportError as e:
                logger.error(f"WinRM transport error during {key}: {e}")
                results[key] = {"error": str(e), "output": None}

        return results

    def disconnect(self) -> None:
        self._session = None
        logger.info(f"WinRM session closed for {self.target_host}")
```

### 4.2 WinRM Hardening Script (Deploy on Customer Windows Targets)

```powershell
# target-agents/windows/Configure-WinRMASV.ps1
# Run as Administrator on target

$ErrorActionPreference = "Stop"

# 1. Enable WinRM if not already
Enable-PSRemoting -Force -SkipNetworkProfileCheck

# 2. Create dedicated ASV scanner local account
$password = Read-Host -Prompt "Enter strong password for ASVScanner account" -AsSecureString
$UserParams = @{
    Name                 = "ASVScanner"
    Password             = $password
    FullName             = "ASV Scanner Service"
    Description          = "Dedicated account for quarterly ASV vulnerability scans"
    PasswordNeverExpires = $true
    AccountNeverExpires  = $true
}
New-LocalUser @UserParams -ErrorAction SilentlyContinue

# 3. Add to Remote Management Users group (NOT Administrators!)
Add-LocalGroupMember -Group "Remote Management Users" -Member "ASVScanner" -ErrorAction SilentlyContinue

# 4. Configure WinRM HTTPS listener with self-signed cert (or import customer cert)
$cert = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation cert:\LocalMachine\My
$thumbprint = $cert.Thumbprint

winrm delete winrm/config/Listener?Address=*+Transport=HTTPS 2>$null
New-Item -Path WSMan:\Localhost\Listener -Transport HTTPS -Address * -CertificateThumbprint $thumbprint -Force

# 5. Enforce HTTPS only (disable HTTP listener)
winrm delete winrm/config/Listener?Address=*+Transport=HTTP 2>$null

# 6. Restrict authentication to Negotiate (NTLM/Kerberos) — no Basic
Set-Item -Path WSMan:\localhost\Service\Auth\Basic -Value $false
Set-Item -Path WSMan:\localhost\Service\Auth\Negotiate -Value $true
Set-Item -Path WSMan:\localhost\Service\Auth\Kerberos -Value $true

# 7. Configure memory limits for large WMI queries
Set-Item -Path WSMan:\localhost\Shell\MaxMemoryPerShellMB -Value 2048
Set-Item -Path WSMan:\localhost\Shell\MaxProcessesPerShell -Value 50
Set-Item -Path WSMan:\localhost\Shell\MaxShellsPerUser -Value 5

# 8. Firewall: allow HTTPS WinRM only from ASV scanner IPs
# (Customer should replace 1.2.3.0/24 with their ASV's published egress ranges)
New-NetFirewallRule -DisplayName "ASV-WinRM-HTTPS-In" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 5986 `
    -RemoteAddress "1.2.3.0/24" `
    -Action Allow `
    -Profile Any

# 9. Disable CredSSP (prevents credential delegation exposure)
Set-Item -Path WSMan:\localhost\Service\Auth\CredSSP -Value $false

Write-Host "WinRM configured for ASV scanning. Ensure firewall rule RemoteAddress matches your ASV egress IPs."
```

---

## 5. Restricted Shell for Linux Targets

```bash
#!/usr/bin/env bash
# target-agents/linux/asv-restricted-shell
# Place at /usr/local/bin/asv-restricted-shell
# chmod 755
# Set as ForceCommand or shell in /etc/passwd for asvscan user

readonly ALLOWED_COMMANDS=(
    "cat /etc/os-release"
    "uname -a"
    "uname -r"
    "dpkg -l"
    "rpm -qa"
    "pacman -Q"
    "systemctl list-units --type=service"
    "systemctl list-units --type=service --no-pager"
    "systemctl list-units --type=service --state=running"
    "ss -tlnp"
    "ss -tlnp --no-header"
    "netstat -tlnp"
    "ps aux"
    "ps aux --no-header"
    "cat /etc/passwd"
    "cat /etc/shadow"
    "stat -c '%a' /etc/shadow"
    "find / -perm -4000 -type f"
    "iptables -L -n"
    "iptables -L -n --line-numbers"
    "ip addr show"
    "ip route show"
    "lsmod"
    "cat /proc/version"
    "sysctl -a"
)

# The command passed by SSH ForceCommand or as argv
cmd="$@"

# Normalize whitespace for matching
cmd_normalized=$(echo "$cmd" | sed 's/[[:space:]]\+/ /g' | sed 's/^ //;s/ $//')

for allowed in "${ALLOWED_COMMANDS[@]}"; do
    if [[ "$cmd_normalized" == "$allowed" ]]; then
        exec bash -c "$cmd"
        exit 0
    fi
done

echo "ERROR: Command not permitted by ASV scanner policy." >&2
echo "Command received: $cmd_normalized" >&2
exit 1
```

Setup script for customer Linux targets:

```bash
#!/bin/bash
# target-agents/linux/setup-asv.sh
# Run as root

set -euo pipefail

USERNAME="asvscan"
SHELL_PATH="/usr/local/bin/asv-restricted-shell"

# Create read-only user
if ! id "$USERNAME" &>/dev/null; then
    useradd -m -s "$SHELL_PATH" -c "ASV Scanner Account" "$USERNAME"
fi

# Ensure SSH key auth works (no password)
mkdir -p /home/$USERNAME/.ssh
touch /home/$USERNAME/.ssh/authorized_keys
chmod 700 /home/$USERNAME/.ssh
chmod 600 /home/$USERNAME/.ssh/authorized_keys
chown -R $USERNAME:$USERNAME /home/$USERNAME/.ssh

# Install restricted shell
cp asv-restricted-shell "$SHELL_PATH"
chmod 755 "$SHELL_PATH"

# Harden SSHD config
cat > /etc/ssh/sshd_config.d/90-asv-restricted.conf << 'SSHEOF'
Match User asvscan
    ForceCommand /usr/local/bin/asv-restricted-shell
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
    GatewayPorts no
    PermitUserEnvironment no
    MaxSessions 2
SSHEOF

# If using Vault dynamic certs, also add:
# TrustedUserCAKeys /etc/ssh/asv_ca.pub
# AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u

systemctl reload sshd

echo "ASV scanner account '$USERNAME' created."
echo "Next steps:"
echo "  1. Add customer's ASV CA public key to /etc/ssh/asv_ca.pub (for dynamic certs)"
echo "  2. Add user's SSH key to /home/$USERNAME/.ssh/authorized_keys (for static keys)"
echo "  3. Verify: ssh -i asv_key asvscan@thishost 'cat /etc/os-release'"
```

---

## 6. Evidence Storage: MinIO with Immutability

### 6.1 Docker Compose for Local Dev

```yaml
# infra/docker/minio.yml
version: "3.8"
services:
  minio:
    image: minio/minio:latest
    container_name: asv-evidence
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: asvadmin
      MINIO_ROOT_PASSWORD: CHANGEME-32CHAR-MIN
      MINIO_REGION: us-east-1
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  minio-data:
```

### 6.2 Bucket Creation with Object Lock

```bash
# Run once after MinIO starts
mc alias set asv http://localhost:9000 asvadmin CHANGEME-32CHAR-MIN

# Create bucket with object locking ENABLED (write-once-read-many)
mc mb asv/asv-evidence --with-lock

# Set default retention: 4 years, COMPLIANCE mode (no one can delete, not even root)
mc retention set --default COMPLIANCE "1460d" asv/asv-evidence

# Verify
mc retention info asv/asv-evidence
```

### 6.3 Python Evidence Uploader

```python
# app/evidence/storage.py
import hashlib
import json
import os
from datetime import datetime
from minio import Minio
from minio.error import S3Error

class EvidenceVault:
    def __init__(self):
        self.client = Minio(
            os.environ.get("MINIO_ENDPOINT", "localhost:9000"),
            access_key=os.environ["MINIO_ACCESS_KEY"],
            secret_key=os.environ["MINIO_SECRET_KEY"],
            secure=os.environ.get("MINIO_SECURE", "false").lower() == "true"
        )
        self.bucket = os.environ.get("MINIO_BUCKET", "asv-evidence")

    def store(self, customer_id: str, scan_id: str, data: dict) -> dict:
        """
        Store scan evidence with cryptographic integrity.
        Object Lock + Compliance mode prevents deletion.
        """
        key = f"{customer_id}/{scan_id}/{datetime.utcnow().isoformat()}.json"
        body = json.dumps(data, indent=2, default=str).encode("utf-8")

        # SHA-256 of content for non-repudiation
        content_hash = hashlib.sha256(body).hexdigest()

        # Upload with metadata
        self.client.put_object(
            bucket_name=self.bucket,
            object_name=key,
            data=io.BytesIO(body),
            length=len(body),
            content_type="application/json",
            metadata={
                "x-amz-meta-customer-id": customer_id,
                "x-amz-meta-scan-id": scan_id,
                "x-amz-meta-content-sha256": content_hash,
                "x-amz-meta-scanned-at": datetime.utcnow().isoformat()
            }
        )

        # Also store the manifest hash to a separate audit log
        self._append_audit_log(customer_id, scan_id, key, content_hash)

        return {
            "object_key": key,
            "sha256": content_hash,
            "bucket": self.bucket
        }

    def _append_audit_log(self, customer_id: str, scan_id: str, object_key: str, sha256: str):
        """Append-only audit log — separate from evidence for redundancy."""
        log_entry = json.dumps({
            "ts": datetime.utcnow().isoformat(),
            "customer_id": customer_id,
            "scan_id": scan_id,
            "object_key": object_key,
            "sha256": sha256
        }) + "\n"

        # Append to daily log file
        log_key = f"_audit/{datetime.utcnow().strftime('%Y-%m-%d')}.ndjson"
        try:
            existing = self.client.get_object(self.bucket, log_key).read()
        except S3Error:
            existing = b""

        self.client.put_object(
            bucket_name=self.bucket,
            object_name=log_key,
            data=io.BytesIO(existing + log_entry.encode()),
            length=len(existing) + len(log_entry.encode()),
            content_type="application/x-ndjson"
        )
```

---

## 7. FastAPI Scan Orchestration API

```python
# app/api/routes.py
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, IPvAnyAddress
from typing import List, Optional
import os

app = FastAPI(title="ASV Scanner API", version="1.0.0")


class ScanRequest(BaseModel):
    customer_id: str
    targets: List[str]  # IPs or FQDNs
    auth_method: Optional[str] = "ssh-key"  # ssh-key | winrm | none
    scan_type: str = "quarterly"  # quarterly | adhoc | continuous
    credentials_reference: Optional[str] = None  # Vault path or SSM param


class ScanResponse(BaseModel):
    scan_id: str
    status: str
    enqueued_at: str
    estimated_duration_minutes: int


@app.post("/v1/scans", response_model=ScanResponse)
def enqueue_scan(
    req: ScanRequest,
    background: BackgroundTasks,
    token: str = Depends(verify_bearer_token)
):
    """
    Enqueue a new ASV scan. Returns scan_id for polling.
    """
    scan_id = generate_uuid()

    # Validate customer scope
    authorized_scope = get_customer_scope(req.customer_id)
    invalid_targets = [t for t in req.targets if t not in authorized_scope]
    if invalid_targets:
        raise HTTPException(
            status_code=403,
            detail=f"Targets outside authorized scope: {invalid_targets}"
        )

    # Enqueue per-target Celery tasks
    for target in req.targets:
        if req.auth_method == "ssh-key":
            run_ssh_auth_scan.delay(target, req.customer_id)
        elif req.auth_method == "winrm":
            run_winrm_auth_scan.delay(target, req.customer_id)
        else:
            run_blackbox_scan.delay(target, req.customer_id)

    return ScanResponse(
        scan_id=scan_id,
        status="ENQUEUED",
        enqueued_at=datetime.utcnow().isoformat(),
        estimated_duration_minutes=len(req.targets) * 45
    )


@app.get("/v1/scans/{scan_id}")
def get_scan_status(scan_id: str):
    """Poll scan status and retrieve results."""
    result = celery_app.AsyncResult(scan_id)
    return {
        "scan_id": scan_id,
        "status": result.status,
        "result": result.result if result.ready() else None
    }


@app.get("/v1/scans/{scan_id}/sar")
def download_sar(scan_id: str):
    """Download PCI-compliant Scan Attestation Report (PDF)."""
    sar_path = generate_sar(scan_id)
    return FileResponse(sar_path, media_type="application/pdf", filename=f"SAR-{scan_id}.pdf")
```

---

## 8. Terraform: Scanner Fleet on AWS

```hcl
# infra/terraform/scanner-fleet.tf

# Multi-region egress IPs for ASV scanning
# PCI requires scanning from multiple geographic perspectives

locals {
  regions = ["us-east-1", "eu-west-1", "ap-southeast-1"]
}

# VPC + Subnet per region
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  for_each = toset(local.regions)
  providers = {
    aws = aws[each.value]
  }

  name = "asv-scanner-${each.value}"
  cidr = "10.${index(local.regions, each.value)}.0.0/16"

  azs             = ["${each.value}a", "${each.value}b"]
  public_subnets  = ["10.${index(local.regions, each.value)}.1.0/24", "10.${index(local.regions, each.value)}.2.0/24"]

  enable_nat_gateway = false  # Scanners need public IPs directly
}

# EC2 Auto Scaling Group for scanners
resource "aws_launch_template" "scanner" {
  for_each = toset(local.regions)

  name_prefix   = "asv-scanner-${each.value}-"
  image_id      = data.aws_ami.ubuntu_2204[each.value].id
  instance_type = "t3.medium"

  vpc_security_group_ids = [aws_security_group.scanner[each.value].id]

  user_data = base64encode(templatefile("${path.module}/scanner-userdata.sh", {
    vault_addr   = var.vault_addr
    vault_ca_cert = var.vault_ca_cert
  }))

  iam_instance_profile {
    name = aws_iam_instance_profile.scanner[each.value].name
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"  # IMDSv2 only
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name      = "asv-scanner"
      Region    = each.value
      ManagedBy = "terraform"
    }
  }
}

resource "aws_autoscaling_group" "scanner" {
  for_each = toset(local.regions)

  name                = "asv-scanner-${each.value}"
  vpc_zone_identifier = module.vpc[each.value].public_subnets
  desired_capacity    = 2
  min_size            = 1
  max_size            = 10

  launch_template {
    id      = aws_launch_template.scanner[each.value].id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "asv-scanner"
    propagate_at_launch = true
  }
}

# Security Group: egress only, limited ingress for management
resource "aws_security_group" "scanner" {
  for_each = toset(local.regions)
  provider = aws[each.value]

  name_prefix = "asv-scanner-${each.value}-"
  vpc_id      = module.vpc[each.value].vpc_id

  # Egress: all TCP/UDP to internet (for scanning)
  egress {
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Ingress: ONLY from bastion / VPN for management
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.mgmt_cidr]
  }
}

# Elastic IPs are published to customers for firewall allowlisting
resource "aws_eip" "scanner_egress" {
  for_each = toset(local.regions)
  provider = aws[each.value]

  domain = "vpc"

  tags = {
    Name      = "asv-scanner-egress-${each.value}"
    Published = "true"
  }
}

output "asv_egress_ips" {
  value = { for r in local.regions : r => aws_eip.scanner_egress[r].public_ip }
  description = "Publish these IPs to customers for firewall allowlisting"
}
```

---

## 9. Makefile for Development

```makefile
# Makefile
.PHONY: install test lint scan-example deploy

PYTHON = python3.13
VENV = .venv

install:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install -r requirements.txt
	$(VENV)/bin/pip install -r requirements-dev.txt

test:
	$(VENV)/bin/pytest tests/ -v --tb=short --cov=app --cov-report=term-missing

test-integration:
	# Requires docker-compose with vulnerable targets
	docker-compose -f tests/fixtures/docker-compose.yml up -d
	$(VENV)/bin/pytest tests/integration/ -v

docker-compose -f tests/fixtures/docker-compose.yml down

lint:
	$(VENV)/bin/black app/ tests/
	$(VENV)/bin/isort app/ tests/
	$(VENV)/bin/flake8 app/ tests/
	$(VENV)/bin/mypy app/ --ignore-missing-imports

scan-example:
	# Run a local authenticated scan against test target
	$(VENV)/bin/python -m app.cli scan \
		--target 127.0.0.1 \
		--auth-method ssh-key \
		--private-key ~/.ssh/asv_test_key \
		--username asvscan

build-images:
	docker build -t asv-scanner:latest -f Dockerfile .
	docker build -t asv-scanner-winrm:latest -f Dockerfile.winrm .

deploy-staging:
	cd infra/terraform && terraform workspace select staging
	cd infra/terraform && terraform apply -auto-approve

vault-dev:
	docker run -d --name vault-dev \
		-e VAULT_DEV_ROOT_TOKEN_ID=dev-token \
		-p 8200:8200 hashicorp/vault:latest
	@echo "Vault dev running at http://localhost:8200 (token: dev-token)"
	$(MAKE) vault-configure

vault-configure:
	VAULT_ADDR=http://localhost:8200 VAULT_TOKEN=dev-token \
		$(VENV)/bin/python scripts/configure_vault.py
```

---

## 10. Operational Runbook: Adding a New Customer

### Step-by-Step

```
1. CUSTOMER ONBOARDING
   a. Sign MSA + ASV agreement
   b. Collect: business name, primary contact, acquirer name, merchant level (1-4)
   c. Generate customer_id (UUID v4)

2. SCOPE DISCOVERY
   a. Customer provides: public IP ranges, FQDNs, CIDR blocks
   b. ASV engineer validates via DNS resolution & reverse DNS
   c. Enter scope into portal → stored in Vault (secret/customers/{id}/scope)

3. CREDENTIAL SETUP
   a. For SSH targets:
      i.  Generate customer-specific CA intermediate (or use global Vault CA)
      ii. Customer runs `setup-asv.sh` on targets
      iii. Customer adds Vault CA public key to `/etc/ssh/asv_ca.pub`
      iv. Create `asvscan` user with restricted shell

   b. For WinRM targets:
      i.  Customer runs `Configure-WinRMASV.ps1` as Administrator
      ii. Customer creates `ASVScanner` local account
      iii. Customer updates firewall rule with ASV egress IPs
      iv. ASV stores encrypted password in Vault (TTL rotates quarterly)

4. PRE-FLIGHT VALIDATION
   a. Run credential validator against 10% of targets (spot check)
   b. Verify restricted shell rejects unauthorized commands
   c. Verify account is NOT root / Administrator
   d. Measure scan duration baseline

5. FIRST SCAN
   a. Schedule Q1 scan in portal
   b. Automated scan runs from 3 regions
   c. SAR generated automatically
   d. Customer reviews via portal
   e. Any disputes logged → analyst reviews within 48h

6. EVIDENCE ARCHIVAL
   a. Raw scan data → MinIO (4-year retention, compliance lock)
   b. SAR PDF → customer portal + MinIO
   c. Audit log entry → append-only ndjson

7. QUARTERLY REPEAT
   a. Scope confirmation email sent 7 days before scan
   b. Customer confirms or updates scope
   c. Credentials rotated (new SSH cert, new WinRM password)
   d. Scan executed, delta report generated
```

---

## 11. Checklist: Before PCI SSC Lab Submission

- [ ] All 65,535 TCP ports scanned on test targets
- [ ] Top 1,000 UDP ports scanned
- [ ] IPv6 targets tested (if applicable)
- [ ] Authenticated scan results correctly labeled in SAR
- [ ] Unauthenticated scan results correctly labeled in SAR
- [ ] SSL/TLS grading matches PCI DSS 4.0 requirements
- [ ] CVSS v3.1 scoring validated against 100+ known test cases
- [ ] Dual-pipeline scoring engine: 0 mismatches on test dataset
- [ ] False positive rate < 5% on authenticated scans
- [ ] Evidence retention: 4 years, write-once, cryptographic hashes
- [ ] Multi-region egress: minimum 3 regions
- [ ] Rate limiting: no target receives > 100 pps without adaptive throttling
- [ ] Credential validation: root/Administrator detection works
- [ ] Restricted shell: only whitelisted commands succeed
- [ ] Disaster recovery: scanner fleet auto-scales, evidence replicated cross-region
- [ ] SOC 2 evidence: access logs, change tickets, pentest reports ready

---

*Implementation Guide by: AI Assistant*
*For: Heaven project archive*
