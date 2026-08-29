# Configure-WinRMASV.ps1
# Harden WinRM for ASV authenticated scanning.
# Run as Administrator on target Windows systems.

$ErrorActionPreference = "Stop"

# 1. Enable WinRM
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

# 3. Add to Remote Management Users (NOT Administrators)
Add-LocalGroupMember -Group "Remote Management Users" -Member "ASVScanner" -ErrorAction SilentlyContinue

# 4. HTTPS listener with self-signed cert
$cert = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation cert:\LocalMachine\My
$thumbprint = $cert.Thumbprint
winrm delete winrm/config/Listener?Address=*+Transport=HTTPS 2>$null
New-Item -Path WSMan:\Localhost\Listener -Transport HTTPS -Address * -CertificateThumbprint $thumbprint -Force

# 5. Disable HTTP listener
winrm delete winrm/config/Listener?Address=*+Transport=HTTP 2>$null

# 6. Auth: Negotiate yes, Basic no
Set-Item -Path WSMan:\localhost\Service\Auth\Basic -Value $false
Set-Item -Path WSMan:\localhost\Service\Auth\Negotiate -Value $true
Set-Item -Path WSMan:\localhost\Service\Auth\Kerberos -Value $true

# 7. Memory limits
Set-Item -Path WSMan:\localhost\Shell\MaxMemoryPerShellMB -Value 2048
Set-Item -Path WSMan:\localhost\Shell\MaxProcessesPerShell -Value 50
Set-Item -Path WSMan:\localhost\Shell\MaxShellsPerUser -Value 5

# 8. Firewall: HTTPS WinRM only from ASV egress (replace with your ASV IPs)
New-NetFirewallRule -DisplayName "ASV-WinRM-HTTPS-In" `
    -Direction Inbound -Protocol TCP -LocalPort 5986 `
    -RemoteAddress "1.2.3.0/24" -Action Allow -Profile Any

# 9. Disable CredSSP
Set-Item -Path WSMan:\localhost\Service\Auth\CredSSP -Value $false

Write-Host "WinRM configured for ASV scanning."
Write-Host "Update firewall rule RemoteAddress with your ASV egress IP ranges."
