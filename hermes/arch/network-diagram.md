# ds-asv network — diagram source

Status: **partial.** Only user-confirmed facts and verifiable config are drawn. Unknowns are listed, not guessed.
Companion: `network-diagram.html` (rendered sketch), `infra-inventory.md` (full inventory).

## Mermaid

```mermaid
flowchart TB
  subgraph NET["Internet"]
    INET(("public"))
  end

  subgraph LAN["Home LAN · 192.168.1.0/24 · gw 192.168.1.1"]
    GW["192.168.1.1"]
    subgraph HEAVEN["heaven — DEV · enp5s0 192.168.1.4/24"]
      H1["docker · hermes · source → GitHub"]
      H2["docker bridges 10.0.1–10.0.7.0/24<br/>portal_default · asv-keycloak_default"]
      H3["scanner + dev copy of prod stack<br/>only ds-asv-pg running today"]
    end
  end

  subgraph AZ["Azure"]
    SEG["172.16.0.0/24 — shared internal segment"]
    subgraph PURPLE["purple — PRODUCTION · Kali · eth0 172.16.0.4/24 · public 74.156.0.13"]
      P1["app tier: api :8000 · worker · beat"]
      P2["db :8880 · minio :9000/:9001 · redis :6379"]
      P3["keycloak :8080 · docker"]
      P4["greenbone DB · gvmd · GVM 22.4<br/>CVE source · 186,323 NVTs"]
      P5["vault :8200 — referenced, nothing serves it"]
    end
    subgraph BLUE["blue — FAILOVER NOT BUILT · Kali · eth0 172.16.0.5/24 · public 172.197.208.78"]
      B1["no ds-asv code · host needs rebuild"]
    end
  end

  HEAVEN -->|LAN| GW
  GW -->|routed| INET
  INET -->|":22 SSH · :8443 public inbound"| PURPLE
  HEAVEN -.->|"SSH → purple :22 over public internet"| PURPLE
  HEAVEN -.->|"SSH → blue :22 · ssh -L gvmd.sock"| BLUE
  PURPLE <-->|"same /24 — L2 adjacent"| BLUE
  HEAVEN -->|git| GH["GitHub"]
  GH -.->|"deploy — mechanism UNVERIFIED"| PURPLE
  HEAVEN -.->|"GREENBONE config → blue (STALE, should be purple)"| BLUE

  classDef bad stroke-width:2px,stroke-dasharray:3 3;
  class P5 bad;
```

## Edge table

| Edge | Transport | Status |
|---|---|---|
| heaven → gateway | `enp5s0` 192.168.1.4 → 192.168.1.1 | confirmed — routing table |
| gateway → internet | LAN uplink, routed | confirmed |
| internet → purple :22 | SSH, public inbound | confirmed — user description |
| internet → purple :8443 | TLS, public inbound | open — owning service unknown |
| heaven → purple :22 | SSH over public internet | confirmed — route + `/etc/hosts` |
| heaven → blue :22 | SSH + `-L` gvmd unix-socket forward | confirmed — `greenbone.env` |
| purple ↔ blue | `172.16.0.0/24` L2 adjacency | adjacent — no traffic yet |
| heaven → GitHub | git over HTTPS/SSH | confirmed |
| GitHub / heaven → purple | deploy | **mechanism unverified** |
| scanner → gvmd | `GREENBONE_*` | **points at blue — should be purple** |

## Segments

| Segment | Members | Reachability |
|---|---|---|
| `192.168.1.0/24` | heaven `192.168.1.4` | RFC1918 LAN · gw 192.168.1.1 |
| `172.16.0.0/24` | purple `172.16.0.4`, blue `172.16.0.5` | RFC1918 internal · shared by both VPS hosts |
| `10.0.1.0/24` … `10.0.7.0/24` | heaven's Docker bridges | host-local |
| public | purple `74.156.0.13`, blue `172.197.208.78` | internet — interfaces not yet identified |

## Deliberately not drawn

- The interfaces carrying each public IP — neither appears on the `eth0`s provided.
- Whether `172.16.0.0/24` crosses a cloud boundary (VNet peering / VPN) or is a plain Azure VNet.
- CDE boundary, data-flow direction, per-host owners, environment classification.
- Any assumption that heaven and the Azure hosts are reachable except across the internet.
