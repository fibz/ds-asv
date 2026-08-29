"""Windows WinRM authenticated scanner connector.

HTTPS-only, Negotiate auth, Administrator detection.
"""

import logging
from typing import Optional

import winrm
from winrm.exceptions import WinRMTransportError

logger = logging.getLogger("asv.winrm")


class WinRMAuthScanner:
    """Windows authenticated scanner via WinRM over HTTPS."""

    def __init__(
        self,
        target_host: str,
        port: int = 5986,
        transport: str = "ntlm",
        server_cert_validation: str = "verify",
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
            operation_timeout_sec=60,
        )
        result = self._session.run_ps("whoami")
        if result.status_code != 0:
            raise ConnectionError(f"WinRM validation failed: {result.std_err.decode()}")
        logger.info(f"WinRM authenticated to {self.target_host}")

    def validate_account(self) -> dict:
        """Check if account is Administrator or SYSTEM."""
        result = self._session.run_ps(
            "([Security.Principal.WindowsPrincipal] "
            "[Security.Principal.WindowsIdentity]::GetCurrent())"
            ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
        )
        is_admin = result.std_out.decode().strip().lower() == "true"

        result = self._session.run_ps("whoami")
        whoami = result.std_out.decode().strip()
        is_system = "system" in whoami.lower()

        return {
            "whoami": whoami,
            "is_admin": is_admin,
            "is_system": is_system,
            "validated": True,
        }

    def collect_inventory(self) -> dict:
        """Gather Windows software inventory, patches, services, listeners."""
        ps_commands = {
            "os_info": "Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture | ConvertTo-Json",  # noqa: E501
            "hotfixes": "Get-HotFix | Select-Object HotFixID, InstalledOn | ConvertTo-Json",
            "installed_software": "Get-WmiObject -Class Win32_Product | Select-Object Name, Version | ConvertTo-Json",  # noqa: E501
            "services": "Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object Name, DisplayName | ConvertTo-Json",  # noqa: E501
            "listeners": "Get-NetTCPConnection | Where-Object {$_.State -eq 'Listen'} | Select-Object LocalAddress, LocalPort, OwningProcess | ConvertTo-Json",  # noqa: E501
            "processes": "Get-Process | Select-Object Name, Path, Id | ConvertTo-Json",
            "users": "Get-LocalUser | Select-Object Name, Enabled, LastLogon | ConvertTo-Json",
            "firewall_rules": "Get-NetFirewallRule | Where-Object {$_.Enabled -eq 'True'} | Select-Object DisplayName, Direction, Action | ConvertTo-Json",  # noqa: E501
        }

        results = {}
        for key, ps_cmd in ps_commands.items():
            try:
                result = self._session.run_ps(ps_cmd)
                results[key] = {
                    "output": (
                        result.std_out.decode() if result.status_code == 0 else None
                    ),
                    "error": (
                        result.std_err.decode() if result.status_code != 0 else None
                    ),
                }
            except WinRMTransportError as e:
                logger.error(f"WinRM transport error during {key}: {e}")
                results[key] = {"error": str(e), "output": None}
        return results

    def disconnect(self) -> None:
        self._session = None
        logger.info(f"WinRM session closed for {self.target_host}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
        return False
