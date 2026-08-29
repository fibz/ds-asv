# ASV Authenticated Scanning Deep Dive & Implementation Framework

> **Research Date:** 2026-08-03
> **Scope:** Authenticated scanning internals, credential architecture, and ground-up implementation proposal for an ASV scanner.

---

## 1. Why Authenticated Scanning is Non-Negotiable for ASV

### 1.1 The Problem with Black-Box Scanning

Unauthenticated (black-box) scanning examines the surface — open ports, service banners, protocol handshakes. It misses the **internal patch state** of the system:

| Vulnerability | Unauthenticated Detects? | Authenticated Detects? |
|---------------|--------------------------|------------------------|
| OpenSSH 8.2 banner → patched 8.2p1 backport | ✅ Yes (banner mismatch) | ✅ Yes |
| OpenSSH 8.2 banner → actually unpatched CVE-2023-28531 | ❌ No (banner looks fine) | ✅ Yes (reads `dpkg -l output`) |
| Kernel CVE-2024-1086 via uname | ❌ No | ✅ Yes (`uname -a`) |
| Adobe Reader 21.x internal vulnerability | ❌ No | ✅ Yes (registry/file system) |
| Misconfigured local firewall exposing 5432 internally | ❌ No | ✅ Yes (`iptables -L`) |
| Shadow file permissions 644 (world-readable) | ❌ No | ✅ Yes (`ls -la /etc/shadow`) |

**Core Thesis:** Authenticated scanning is the difference between a noisy port scanner and a credible compliance tool. PCI SSC does not *require* authenticated scanning for ASV certification, but ASVs that support it have:
- **< 5% false positive rate** vs. **30-50% for pure black-box**
- **Faster customer remediation** (know exact patch missing, not just "maybe")
- **Higher customer retention** (merchants hate false positive fatigue)

### 1.2 PCI ASV Position on Authentication

PCI ASV Program Guide v3.0 (Section 4.2.3):

> "ASV scanning solutions may offer the use of credentials to authenticate to the target system. When authenticated scanning is performed, the ASV must clearly distinguish between vulnerabilities identified via authenticated and unauthenticated methods in the scan report."

Key implication: **Authenticated findings must be labeled separately** in the SAR (Scan Attestation Report). You cannot blend them into a single "score" without annotation.

---

## 2. Authenticated Scanning: Technical Taxonomy

### 2.1 Agent-Based vs. Agentless

| Dimension | Agent-Based | Agentless |
|-----------|-------------|-----------|
| **Deployment** | Binary/script pushed to target | Uses native remote management protocols |
| **Protocols** | Custom (gRPC over mTLS, AMQP, etc.) | SSH, WinRM, SNMP, cloud APIs |
| **Performance** | Continuous, lightweight | On-demand, heavier per-scan |
| **Privilege Needs** | Runs as SYSTEM/root (always) | Requires dedicated service account |
| **Network** | Egress only (beacon back to C2/scanner) | Ingress must be allowed (scanner → target) |
| **Cloud Native** | Container sidecar, daemonset | Platform API (AWS SSM, Azure ARC, GCP OS Config) |
| **Maintenance** | Update agents periodically | No persistent footprint |

**ASV Recommendation:** Offer both. Agentless for quarterly compliance scans (low friction). Agent-based for continuous monitoring between quarters.

### 2.2 Protocol Deep Dive

#### SSH (Linux/macOS/Network Devices)

```bash
# What a scanner actually does post-auth
cat /etc/os-release                  # OS version for CPE mapping
dpkg -l | grep openssl               # Debian/Ubuntu package listing
rpm -qa | grep openssl               # RHEL/CentOS/Fedora
pacman -Q | grep openssl             # Arch
uname -a                             # Kernel version
ss -tlnp                             # Bound ports from inside
ps aux                               # Running processes
systemctl list-units --type=service  # Service enumeration
cat /etc/passwd | wc -l              # Account enumeration (if privileged)
find / -perm -4000 2>/dev/null       # SUID binaries
```

**Key Implementation Detail:** SSH authenticated scanning requires:
- A **read-only** service account (ideally `asvscan` user)
- `NOPASSWD: /usr/bin/dpkg -l, /bin/rpm -qa, /usr/bin/pacman -Q` in sudoers (or equivalent)
- **chroot jail**? No — too complex. Use command whitelisting via sshd `Command=` restriction

**SSH Authentication Options:**
| Method | Security | Practicality |
|--------|----------|--------------|
| Password | ❌ Weak, brute-forceable | ✅ Easy |
| SSH key (RSA 4096 / Ed25519) | ✅ Strong | ✅ Standard |
| SSH key + FIDO2/U2F hardware | ✅⭐ Best | ❌ Rarely supported by ASV tools |
| Kerberos / GSSAPI | ✅ Strong | ❌ Complex in multi-tenant scanner |
| Short-lived SSH certificates (HashiCorp Vault, Teleport) | ✅⭐ Best for scale | ⚠️ Requires infrastructure |

**Recommendation for ASV:** Ed25519 SSH keys per-customer with a TTL rotation mechanism. Store private keys in a KMS (HashiCorp Vault / AWS KMS / Azure Key Vault) — never on scanner disk unencrypted.

#### WinRM (Windows)

Windows doesn't have SSH natively (OpenSSH is optional). The standard protocol is **WinRM** over HTTP(S) with **NTLM/Kerberos** authentication.

```powershell
# What the scanner executes via WinRM
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber
Get-HotFix | Select-Object HotFixID, InstalledOn  # Patches
Get-WmiObject -Class Win32_Product | Select-Object Name, Version  # Installed software
Get-NetTCPConnection | Select-Object LocalPort, OwningProcess  # Internal ports
Get-Process | Select-Object Name, Path  # Running binaries
Get-Acl C:\Windows\System32\drivers\etc\hosts  # Permission checks
```

**WinRM Authentication Options:**

| Method | Security | Notes |
|--------|----------|-------|
| Basic (username/password) | ❌ Transmits plaintext over HTTP unless HTTPS | Avoid |
| NTLM | ⚠️ Legacy, vulnerable to relay attacks if not hardened | Common but risky |
| Kerberos | ✅ Strong | Requires domain integration (complex for ASV) |
| Negotiate (SPNEGO) | ✅ Tries Kerberos, falls back to NTLM | Standard |
| CredSSP | ⚠️ Sends creds to target — avoids double-hop, but credential exposure risk | Convenient but evaluate |
| Certificate | ✅ Strong (mutual TLS) | Best for agentless scanning |

**Critical WinRM Pitfall:** WinRM **Memory Limits**. Default `MaxMemoryPerShellMB` is 1024. Large software inventories (`Get-WmiObject Win32_Product`) can exhaust this. Scanner must detect and retry with chunked queries.

**Recommendation:** HTTPS WinRM (port 5986) + Negotiate auth with a dedicated `ASVScanner` service account. Local account, not domain, to limit blast radius. Password rotated per scan via LAPS (Local Administrator Password Solution) or custom vault integration.

#### SNMP (Network Devices, Printers, IoT)

```bash
# What SNMP reveals
snmpwalk -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0   # sysDescr (OS version)
snmpwalk -v2c -c public 192.168.1.1 1.3.6.1.2.1.25.6.3.1.2  # hrSWInstalledName (software inventory)
```

SNMP v2c is plaintext community strings — **insecure**. SNMP v3 offers:
- `noAuthNoPriv` (username only)
- `authNoPriv` (HMAC-MD5/HMAC-SHA)
- `authPriv` (encryption + authentication — AES + SHA)

**ASV Recommendation:** Only support SNMP v3 `authPriv` with per-customer credentials. SNMP v2c should be flagged as a **finding itself** during unauthenticated scan, but the authenticated path must use v3.

#### Cloud Platform APIs (The Modern Stack)

For AWS/Azure/GCP workloads, the ASV scanner shouldn't SSH into every EC2 instance. Instead:

**AWS:**
- **AWS SSM Session Manager** — agentless shell access without open ports or SSH keys
- **AWS Inspector** — native vuln scanner; ASV can call Inspector API and cross-reference findings with PCI requirements
- **AWS Systems Manager Inventory** — API-driven software inventory

**Azure:**
- **Azure ARC** — hybrid management for on-prem + cloud VMs
- **Azure Automanage** — OS patch inventory

**GCP:**
- **OS Config API** — agent-based patch / inventory
- **Cloud Asset Inventory** → export to ASV scoring engine

**Multi-Cloud Orchestration:** Use **OpenSCAP** (Security Content Automation Protocol) for Linux, **Microsoft Security Compliance Toolkit** for Windows. Both produce standardized XML that the ASV scoring engine can ingest regardless of cloud provider.

### 2.3 What Data Gets Collected

Authenticated scanning captures **ground truth** about the target:

```json
{
  "target": "10.0.1.50",
  "auth_method": "ssh-ed25519",
  "collected_at": "2026-08-03T09:30:00Z",
  "artifacts": {
    "os": {
      "name": "Ubuntu",
      "version": "22.04.4",
      "kernel": "5.15.0-113-generic"
    },
    "packages": [
      {"name": "openssh-server", "version": "1:8.9p1-3ubuntu0.10", "source": "dpkg -l"},
      {"name": "openssl", "version": "3.0.2-0ubuntu1.17", "source": "dpkg -l"},
      {"name": "nginx", "version": "1.18.0-0ubuntu1.6", "source": "dpkg -l"}
    ],
    "services": [
      {"name": "nginx", "ports": [80, 443], "pid": 1234, "path": "/usr/sbin/nginx"},
      {"name": "sshd", "ports": [22], "pid": 567, "path": "/usr/sbin/sshd"}
    ],
    "listeners": [
      {"proto": "tcp", "local": "0.0.0.0:80", "foreign": "0.0.0.0:*", "pid": 1234},
      {"proto": "tcp", "local": "0.0.0.0:22", "foreign": "0.0.0.0:*", "pid": 567}
    ],
    "kernel_params": {
      "net.ipv4.ip_forward": "0",
      "kernel.randomize_va_space": "2"
    },
    "users": [
      {"name": "root", "uid": 0},
      {"name": "asvscan", "uid": 1001}
    ],
    "shadow_perms": "640"
  }
}
```

---

## 3. Credential Architecture: The Hardest Part

Credential management is the **number one barrier** to implementing authenticated scanning. Get it wrong, and you become the attack vector.

### 3.1 Threat Model

| Threat | Risk | Mitigation |
|--------|------|------------|
| Cred theft from scanner DB | 🔴 Critical | HashiCorp Vault integration, creds never at rest |
| Man-in-the-middle on SSH/WinRM | 🔴 Critical | Strict host key verification, cert pinning, TLS 1.3 |
| Replay attack | 🔴 Critical | Temporal creds (ephemeral, per-scan) |
| Scanner compromise → lateral movement | 🔴 Critical | Network segmentation, dedicated scanner VPC, no cred persistence |
| Customer accidentally gives admin/root | 🟡 High | Credential validation: attempt `useradd dummy` → expect failure |
| Credential rotation failure | 🟡 High | Pre-flight auth check; fail scan if rotation breaks |

### 3.2 Zero-Knowledge Credential Flow

The ASV scanner should **never hold plaintext credentials longer than the duration of a single scan session**.

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────┐     ┌─────────┐
│  CUSTOMER   │────▶│   ASV PORTAL (UI)    │────▶│  HASHICORP   │────▶│   KMS   │
│  (Merchant) │     │  (Receives ephemeral │     │    VAULT     │     │(encrypts│
│             │     │   cred via HTTPS)    │     │              │     │  creds) │
└─────────────┘     └──────────────────────┘     └──────┬───────┘     └─────────┘
                                                        │
                                                        │ Wrapping Token (TTL=1h)
                                                        ▼
                                               ┌──────────────────┐
                                               │  ASV SCAN ENGINE │
                                               │  (reads wrapped  │
                                               │   token at scan  │
                                               │   time only)     │
                                               └────────┬─────────┘
                                                        │
                                                        │ Unwrap token → get cred
                                                        │ Spawn SSH/WinRM session
                                                        │ Auto-revoke cred after scan
                                                        ▼
                                               ┌──────────────────┐
                                               │ ASV CRED VAULT:  │
                                               │ Token destroyed   │
                                               │ Session key zeroed│
                                               │ Memory wiped      │
                                               └──────────────────┘
```

**Implementation: HashiCorp Vault KV v2 + Dynamic Secrets**

```hcl
# Vault policy: asv-scanner
path "secret/data/customers/{{customer_id}}/scan-creds" {
  capabilities = ["read"]
}

path "secret/data/customers/{{customer_id}}/scan-creds" {
  capabilities = ["create", "update"]
  allowed_parameters = {
    "ssh_public_key" = []
    "ssh_private_key" = []
    "winrm_username" = []
    "winrm_password" = []
  }
}

# Dynamic SSH key signing (better than static keys!)
path "ssh/sign/asv-scan" {
  capabilities = ["create", "update"]
}
```

**Dynamic SSH Certificates (Best Practice):**
```bash
# Customer configures CA public key in /etc/ssh/sshd_config
# ASV scanner requests a signed certificate at scan time
vault write ssh/sign/asv-scan \
  public_key=@/tmp/asv_scanner.pub \
  valid_principals="asvscan" \
  ttl="2h"

# Returns a short-lived SSH cert valid only for 2 hours
# No persistent private key to steal!
```

### 3.3 Credential Validation Engine

Before a scan starts, the scanner performs a **credential pre-flight check**:

```python
class CredentialValidator:
    def validate_ssh(self, host, cred):
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.RejectPolicy())  # STRICT!
            client.connect(host, username=cred.username,
                         pkey=cred.private_key,
                         look_for_keys=False,
                         allow_agent=False,  # Prevent ssh-agent hijacking
                         timeout=10)
            
            # CRITICAL: Verify it's NOT root
            _, stdout, _ = client.exec_command("id -u")
            uid = int(stdout.read().strip())
            if uid == 0:
                raise ValueError("Account has root privileges — ASV policy prohibits root scans")
            
            # Verify read-only access
            _, stdout, _ = client.exec_command("touch /tmp/asv_wrire_test_$$ 2>&1")
            err = stdout.read().decode()
            if "Permission denied" not in err:
                raise ValueError("Account has write access — restrict to read-only")
            
            return ValidationResult(valid=True, uid=uid, method="ssh-key")
        except Exception as e:
            return ValidationResult(valid=False, error=str(e))
```

### 3.4 Secure Execution Environment for Scripts

When running commands on the target, use a **restricted shell wrapper**:

```bash
#!/bin/bash
# /usr/local/bin/asv-restricted-shell
# Assigned as shell for asvscan user in /etc/passwd

ALLOWED_COMMANDS=(
  "/usr/bin/dpkg -l"
  "/bin/rpm -qa"
  "/usr/bin/uname -a"
  "/bin/ss -tlnp"
  "/usr/bin/ps aux"
  "/bin/cat /etc/os-release"
  "/usr/bin/systemctl list-units --type=service"
  "/usr/sbin/iptables -L"
)

# Allow ONLY exact commands from the list
cmd="$@"
for allowed in "${ALLOWED_COMMANDS[@]}"; do
  if [[ "$cmd" == "$allowed" ]]; then
    exec $cmd
  fi
done

echo "Command not allowed by ASV scanner policy: $cmd" >&2
exit 1
```

---

## 4. Scoring Engine: Merging Auth + Unauth Findings

### 4.1 Scoring Rules

```python
class ASVScoringEngine:
    def score(self, finding):
        """
        Priority order for evidence quality:
        1. Authenticated package manager output (ground truth)
        2. Authenticated file system / registry check
        3. Unauthenticated version banner
        4. Unauthenticated CVE-to-banner matching (least reliable)
        """
        
        if finding.source == "authenticated_dpkg" or finding.source == "authenticated_rpm":
            # Ground truth — exact version from package manager
            cvss = self.lookup_cve_by_version(finding.package, finding.version)
            confidence = 1.0  # 100%
        elif finding.source == "authenticated_registry":
            # Windows registry — very reliable
            cvss = self.lookup_cve_by_version(finding.program, finding.version)
            confidence = 0.95
        elif finding.source == "unauthenticated_banner":
            # Banner could be lying (backported patches)
            cvss = self.lookup_cve_by_banner(finding.service, finding.banner)
            confidence = 0.60  # 60% — lots of false positives
        
        return ScoredFinding(
            cvss=cvss,
            confidence=confidence,
            requires_dispute=finding.source.startswith("unauthenticated") and cvss >= 7.0
        )
```

### 4.2 Dispute Workflow

Authenticated scanning nearly eliminates the need for disputes. But when they happen:

```
Customer submits dispute → ASV analyst opens scan raw data →
If authenticated finding: Check package version cross-reference →
If disputed correctly (e.g., backported patch without version bump): 
  - Update CPE mapping in vulnerability DB
  - Auto-suppress for this customer next quarter (hash: package_name+patch_id)
If unauthenticated finding: 
  - Require customer to run authenticated scan for re-verification
  - Downgrade confidence to 0.0 if auth scan shows clean
```

---

## 5. Ground-Up Implementation Framework

### Phase 1: MVP (Months 1-3)

**Goal:** Internal prototype proving the authenticated scan loop.

**Stack:**
- **Orchestrator:** Python 3.13 + Celery + Redis
- **Scanner Core:** OpenVAS/GVM (open source) fork + custom authenticated plugin framework
- **Auth Connector:** Python `paramiko` (SSH) + `pywinrm` (WinRM)
- **Credential Vault:** HashiCorp Vault (dev mode → prod mode)
- **DB:** PostgreSQL 16
- **Report Engine:** Jinja2 → HTML + PDF (weasyprint)
- **Evidence Storage:** Local filesystem (migrated to MinIO in Phase 2)

**Key Deliverables:**
1. SSH authenticated scanning on Ubuntu 22.04 (dpkg inventory → CVE lookup)
2. WinRM authenticated scanning on Windows Server 2022 (WMI inventory → CVE lookup)
3. Basic SAR generation with auth/unauth separation
4. Customer portal: submit creds → receive scan result

### Phase 2: Hardening (Months 4-6)

**Goal:** Credential architecture, zero-knowledge flows, and PCI compliance prep.

**Deliverables:**
1. Vault integration with dynamic SSH cert signing
2. Credential validation engine (root prevention, read-only enforcement)
3. Restricted shell wrapper deployed on target templates
4. Evidence storage migration to MinIO with Object Lock (4-year retention)
5. Implement full PCI ASV Scanning Procedures test cases (PCI SSC lab dataset)
6. Scoring engine dual-pipeline (two independent scorers, flag mismatches)

### Phase 3: Scale & Certification (Months 7-12)

**Goal:** Production-grade multi-tenancy and PCI SSC submission.

**Deliverables:**
1. Cloud-native agentless path: AWS SSM + Azure ARC + GCP OS Config APIs
2. Multi-tenant architecture with strict data isolation (per-customer Vault namespace)
3. Rate-limited, geographically distributed scanning fleet (5 egress regions minimum)
4. SOC 2 Type II audit preparation (policies, evidence, controls mapping)
5. PCI SSC ASV lab testing submission
6. Fix lab findings (typically 20-50 iterations)

### Phase 4: Continuous Improvement (Months 13-18)

**Goal:** Maintain certification and add differentiators.

**Deliverables:**
1. Automated quarterly PCI re-certification pipeline
2. ML-based false positive classifier (trained on dispute history)
3. Continuous agent-based scanning between quarters (subscription upsell)
4. Bug bounty program for ASV platform itself

---

## 6. System Architecture (Ground-Up)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ASV AUTHENTICATED SCANNER                   │
│                              v1.0                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────┐    ┌───────────────────┐    ┌─────────────┐ │
│  │   CUSTOMER PORTAL │    │   SCAN API        │    │  ADMIN DASH │ │
│  │   (Next.js)       │    │   (FastAPI)       │    │  (Grafana)  │ │
│  │                   │    │                   │    │             │ │
│  │  • Submit scope   │    │  • /enqueue       │    │  • Metrics  │ │
│  │  • Upload creds   │    │  • /status        │    │  • Audit    │ │
│  │  • View SAR       │    │  • /results       │    │  • Alerts   │ │
│  └─────────┬─────────┘    └─────────┬─────────┘    └─────────────┘ │
│            │                        │                               │
│            └──────────┬─────────────┘                               │
│                       │                                             │
│            ┌──────────▼──────────┐                                 │
│            │   TASK QUEUE        │                                 │
│            │   (Celery + Redis)  │                                 │
│            └──────────┬──────────┘                                 │
│                       │                                             │
│         ┌─────────────┼─────────────┐                               │
│         │             │             │                               │
│  ┌──────▼──────┐ ┌────▼──────┐ ┌───▼───────┐                       │
│  │ BLACK-BOX   │ │ AUTH SSH  │ │ AUTH WINRM│                       │
│  │ SCANNER     │ │ CONNECTOR │ │ CONNECTOR │                       │
│  │             │ │           │ │           │                       │
│  │ masscan     │ │ paramiko  │ │ pywinrm   │                       │
│  │ nmap NSE    │ │ nmap NSE  │ │ winexe    │                       │
│  │ testssl.sh  │ │ OpenSCAP  │ │ SecCompK  │                       │
│  └──────┬──────┘ └─────┬─────┘ └─────┬─────┘                       │
│         │              │             │                              │
│         └──────────────┼─────────────┘                              │
│                        │                                            │
│            ┌───────────▼────────────┐                              │
│            │   FINDINGS AGGREGATOR  │                              │
│            │                        │                              │
│            │  ┌──────────────────┐  │                              │
│            │  │ DUAL-SCORE       │  │  CVSS v3.1 + PCI pass/fail   │
│            │  │ ENGINE           │  │  Confidence scoring          │
│            │  │                  │  │  Evidence tagging            │
│            │  │ Engine A         │  │  Anomaly detection           │
│            │  │ Engine B (audit) │  │                              │
│            │  └──────────────────┘  │                              │
│            └───────────┬────────────┘                              │
│                        │                                            │
│            ┌───────────▼────────────┐                              │
│            │   EVIDENCE VAULT       │                              │
│            │   (MinIO / S3)         │                              │
│            │   • Write-once         │                              │
│            │   • 4-year retention   │                              │
│            │   • SHA-256 manifests  │                              │
│            └───────────┬────────────┘                              │
│                        │                                            │
│            ┌───────────▼────────────┐                              │
│            │   REPORT GENERATOR     │                              │
│            │   • SAR PDF (PCI)      │                              │
│            │   • JSON API           │                              │
│            │   • Delta reports      │                              │
│            └────────────────────────┘                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  CREDENTIAL VAULT (HashiCorp Vault)                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │   │
│  │  │ Static KV   │  │ Dynamic SSH │  │ Dynamic WinRM       │  │   │
│  │  │ (deprecated)│  │ CA Signing  │  │ Password Rotation   │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Key Metrics to Track

| Metric | Target | Why |
|--------|--------|-----|
| **False Positive Rate** | < 5% | Customer retention |
| **Auth Scan Adoption** | > 70% of customers | Accuracy |
| **Cred Validation Pass Rate** | > 95% pre-scan | Efficiency |
| **Scan Duration** | < 4 hours per /24 | SLA |
| **Evidence Retention** | 100% for 4 years | Compliance |
| **Dual-Engine Agreement** | > 99.9% | Scoring correctness |
| **MTTR for Lab Findings** | < 72 hours | Certification velocity |

---

## 8. Summary & Next Steps

1. **Authenticated scanning is the differentiator** that separates commodity ASVs from platforms merchants trust. Black-box scanning is table stakes; auth scanning is the moat.

2. **Credentials are the hardest part.** Not the scanner, not the scoring — managing secrets safely at scale. Zero-knowledge design with HashiCorp Vault (dynamic SSH certs, ephemeral WinRM passwords) is non-negotiable.

3. **PCI certification is a 12-18 month journey.** The technology is the easy part. The audit, evidence, lab testing, and remediation cycles are where projects live or die.

4. **SOC 2 is a parallel track.** Don't treat it as an afterthought. Every engineering decision (evidence storage, access controls, change management) should satisfy both PCI and SOC 2 auditors.

5. **Start with Phase 1 MVP.** Prove the authenticated loop end-to-end on one Linux + one Windows target. Iterate on the credential flow before scaling.

---

*Research by: AI Assistant*
*For: Heaven project archive*
