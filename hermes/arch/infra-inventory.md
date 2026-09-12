# ds-asv infrastructure inventory — read-back for correction

Source: dictated by user 2026-09-12, in their own words (raw capture: `infra-notes-raw.md`), plus live checks run from heaven.
Status: **partially confirmed.** Hosts, roles and segments below are user-confirmed. Items marked OPEN are still unverified.

## Hosts described

| # | Name | Role | Address | OS | Exposed ports | Services stated | Extra |
|---|---|---|---|---|---|---|---|
| 1 | **heaven** | Development machine | `192.168.1.4/24` | not stated | not stated | docker, hermes, "original codes linked to github" | this machine |
| 2 | **purple** | Deployment server (production) | `74.156.0.13` (Azure VPS) | Kali Linux | `8443`, `22` | docker, greenbone DB | has an extra internal NIC, `172.16.0.4/24` |
| 3 | **blue** | **Failover — PLANNED / NOT BUILT** | `172.197.208.78` (public) | Kali Linux | not stated | — | no ds-asv code deployed; internal NIC `172.16.0.5/24` |

*User correction, 2026-09-12: "i have not done anything on blue yet no code there and the server needs to be redone."*

## Cross-checks against repo/known state

| Claim | Independent evidence | Verdict |
|---|---|---|
| purple = `74.156.0.13` | `scanner/AGENTS.md` records purple as the dockerized GVM endpoint; `/etc/hosts` on heaven maps `purple → 74.156.0.13` | consistent |
| purple runs "docker, greenbone DB" | AGENTS.md: purple runs the **greenbone-community-container 22.4 stack**, GMP `admin` verified, 186,323 NVTs imported, all docker+containerd storage on the 1 TB `/home` mount (`~/projects/gvm`) | consistent, more detail available |
| port `8443` | AGENTS.md records a scanner smoke test against `127.0.0.1:8443` (nmap banner + testssl.sh TLS grading) | likely the same listener — **not confirmed which service owns it** |

## Application tier placement (user, 2026-09-12)

| Host | Role | Runs |
|---|---|---|
| **heaven** `192.168.1.4/24` | **Dev** | a **dev copy of the same stack**, plus docker, hermes, source code linked to GitHub |
| **purple** `74.156.0.13` | **Production** (Azure VPS, Kali) | the **production app tier** — `api`, `worker`, `beat`, `db`, `minio`, `redis`, `keycloak` — plus docker, greenbone DB. Exposed: `8443`, `22`, extra internal NIC |
| **blue** `172.197.208.78` | **Failover — NOT BUILT** | nothing. No ds-asv code. **No failover exists today; purple is a single point of failure.** |

### Consequences worth flagging

1. **Production is on a publicly-addressed host.** purple is `74.156.0.13` with `8443` and `22` exposed, and it holds the production portal, database, MinIO evidence store, Redis and Keycloak. That is the CDE candidate for your own AOC, and the diagram must show every inbound path to it.
2. **No failover exists.** blue is unbuilt, so purple is a single point of failure carrying the whole production stack.
3. **Keycloak is in the production stack.** The identity provider sits on the same host as the portal it authenticates. Single point of failure, shared blast radius, and failover has to cover it too once blue is built.
4. **`vault` still unaccounted for** — `asv-worker`/`asv-beat` reference `http://vault:8200` with no such service in the compose. If prod runs it, it is a fifth prod service not in the description.

## Contradiction found — which host is actually the live Greenbone endpoint?

**RESOLVED by user (2026-09-12): purple is the primary CVE source. `greenbone.env` is stale and needs re-pointing at purple.**

| Source | Says the live GVM/CVE endpoint is | Verdict |
|---|---|---|
| **User (2026-09-12)** | purple = *deployment server* / primary; blue = *failover host* | **authoritative** |
| **`scanner/AGENTS.md` line 64** | "DONE — live Greenbone verify (2026-09-05). **Endpoint = purple** (74.156.0.13): dockerized GVM (greenbone-community-container **22.4** stack)" | correct |
| **`scanner/greenbone.env`** (the scanner's real, gitignored config) | **blue** — header comment: *"Connection: tcp via an OpenSSH forward of **blue's** gvmd socket: `ssh -fN -L 127.0.0.1:19390:/run/gvmd/gvmd.sock cchock@172.197.208.78`"* | **STALE — defect** |

### Defect: cache refresh points at blue instead of purple
`scanner/greenbone.env` drives `scripts/update_greenbone.py` (via `make refresh-greenbone`). As it sits on disk, that refresh targets **blue**, not the verified primary purple (AGENTS.md records purple holding 186,323 NVTs).

Not yet acted on — flagging only. Status: **OPEN**.

### Note on blue's GVM version
AGENTS.md records blue running GVM **25.04 / gvmd 26.24** (native) while purple runs dockerized **22.4**. Not currently a failover-pair concern because blue holds no ds-asv code — but it becomes one the moment blue is built as a standby.

## Deployment workflow (user, 2026-09-12)

> *"i do the coding on heaven then get the AI to push it to purple"*

- **Coding happens on heaven** (dev). Source is linked to GitHub.
- **Deploy to purple is manual and AI-assisted** — no CI/CD pipeline exists (confirmed: no `.github/workflows`, no hooks).
- Therefore **the deploy step is the only place a change-control hook can attach.** This is exactly where the PCI docs want documentation updates as a trailing requirement, and right now nothing enforces it.
- Correlation edges implied but unverified: `heaven → GitHub`, and `heaven → purple` (or `GitHub → purple`). **Mechanism still OPEN** — `git pull` on purple, a direct copy, or a registry pull?

## Network interfaces

### purple (user-provided, 2026-09-12)
```
eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    link/ether 38:33:c5:fc:1e:6d brd ff:ff:ff:ff:ff:ff
    inet 172.16.0.4/24
```

### blue (user-provided, 2026-09-12)
```
eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    link/ether 38:33:c5:fc:a9:50 brd ff:ff:ff:ff:ff:ff
    inet 172.16.0.5/24 metric 100 brd 172.16.0.255 scope global eth0
```

### heaven (verified live, 2026-09-12)
```
lo               127.0.0.1/8
enp5s0  UP       192.168.1.4/24  + fd00::2144:d94:539e:5a1d/64, fd00::36c2:a37f:6d3:5060/64
wlp4s0  DOWN     (wifi, unused)
```
Plus six live Docker bridges: `10.0.1.0/24`, `10.0.2.0/24`, `10.0.3.0/24`, `10.0.4.0/24`, `10.0.5.0/24`, `10.0.7.0/24`.

## Network segments discovered

| Segment | Members | Reachability | Notes |
|---|---|---|---|
| `172.16.0.0/24` | purple `172.16.0.4`, blue `172.16.0.5` | RFC1918, internal | **purple and blue are L2-adjacent on this segment.** Natural replication/sync path once blue is built |
| `192.168.1.0/24` | heaven `192.168.1.4` | RFC1918, LAN | Dev machine; **not adjacent** to `172.16.0.0/24` |
| Public | purple `74.156.0.13`, blue `172.197.208.78` | Internet | Neither appears on the `eth0`s shown — carried on other interfaces |
| Docker bridges (heaven) | `10.0.1.0/24` … `10.0.7.0/24` | Host-local | Includes the ds-asv segments `portal_default`, `asv-keycloak_default` |

### Observations

1. **Both VPS hosts share one internal `/24`.** "The extra internal NIC" is a single shared segment containing both purple and blue — one PCI segment with one boundary and one permitted-traffic rule set.
2. **Neither shown `eth0` carries the public address.** purple's is `172.16.0.4`, blue's is `172.16.0.5`, yet their public IPs are `74.156.0.13` and `172.197.208.78`. So each host has at least one further interface not yet shown. (`172.16.0.0/12` is RFC1918; `172.197.x` is **not** — blue's address is internet-routable.)
3. **blue's `eth0` has `metric 100`** while purple's has no metric — implying blue has another route/interface at different priority. Consistent with a second NIC, not proof.
4. **MAC prefixes match:** purple `38:33:c5:fc:1e:6d`, blue `38:33:c5:fc:a9:50` — same OUI and first four octets. Likely the same host platform. *Observation only.*
5. **heaven cannot reach `172.16.0.0/24` directly** (unconnected private range), so all heaven↔purple/blue traffic is routed across the public internet.

## Verified from heaven (2026-09-12, live checks)

### Name resolution — names are local aliases, not DNS
`/etc/hosts` on heaven:
```
127.0.1.1  HEAVEN
74.156.0.13      purple
172.197.208.78   blue
```
- **`blue` resolves to the PUBLIC address** `172.197.208.78`, not the internal `172.16.0.5`. By your convention the name = public address.
- Reverse lookup of `172.197.208.78` returns `blue` — consistent.
- Routing: `172.197.208.78 via 192.168.1.1 dev enp5s0` — **routed over the LAN gateway**, i.e. reached across the internet, not directly connected.

### Management path (material for the trust boundary)
- heaven reaches purple and blue by SSH over the **public internet** via `192.168.1.1`. There is no private overlay in play.
- purple exposes `22` publicly; blue's management access is via `ssh -L` forwards to `cchock@172.197.208.78` using `~/.ssh/ASV_key.pem`.
- **This is a public-internet management path to a production host holding the CDE candidate.** It belongs on the diagram and in the scope discussion.

### Docker networks on heaven (additional segments)
```
asv-keycloak_default   bridge   ← ds-asv
portal_default         bridge   ← ds-asv
honcho_default         bridge
omniroute_default      bridge
searxng_default        bridge
dockage_default        bridge
bridge / host / none
```
`portal_default` and `asv-keycloak_default` are the ds-asv segments on the dev host.

## Not yet captured (needed for PCI 1.1.2 / 1.1.4 / ROC)

- **OPEN:** full interface list on purple and blue (the ones carrying `74.156.0.13` / `172.197.208.78`)
- **OPEN:** whether `172.16.0.0/24` crosses any cloud boundary (VNet peering, VPN, or plain Azure VNet)
- **OPEN:** does heaven's dev copy hold real production data? (asked, not answered)
- **OPEN:** how code gets from heaven to purple
- CDE boundary: which hosts/services store, process, or transmit cardholder data
- Data flows and direction (not just "port open")
- Owner / responsible role per host and service
- Environment classification (prod / staging / dev)
- Whether heaven (dev, RFC1918) sits in scope by connectivity to production
