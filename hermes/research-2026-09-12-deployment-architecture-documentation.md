# Research: documenting server deployment architecture + inter-server correlation

Date: 2026-09-12
Asked: "a way for me to document deployment architecture of servers and its co-relational within all servers"

## The core distinction most tools blur

Search consensus splits into three layers. Naming them separately is what makes the tool choice obvious:

| Layer | What it is | Failure mode if you skip it |
|---|---|---|
| **Model** | Structured data: servers, services, ports, dependencies | You have pictures, not a system. Nothing queries it. |
| **View** | Rendered diagram(s) derived from the model | Model stays invisible to stakeholders/auditors |
| **Correlation** | The *edges* — what talks to what, over which port, in which direction | This is the part you actually asked about, and it's the layer most people never write down |

"Searches show the same thing repeatedly: teams buy a diagram tool and get pretty pictures; the correlation data lives in someone's head." Key quote from repowise: *"If you only buy a diagramming tool, you get pretty pictures. If you pair it with source-aware docs, you get system design documentation that survives the next refactor."*

## Diagram-as-code options (the View layer)

| Tool | Syntax | Git-friendly | C4 support | Learning curve | Best for |
|---|---|---|---|---|---|
| **Mermaid** | Markdown-like | Yes | Partial | Low | Docs that render natively in GitHub/GitLab |
| **D2** | Declarative DSL | Yes | No | Low-Med | Polish + real cloud icons, needs CI render |
| **PlantUML** | Keyword-based | Yes | Via C4-PlantUML | Medium | Formal UML; needs Java |
| **Structurizr DSL** | C4 DSL | Yes | **Full** | Med-High | Model-once-render-many; ADRs alongside |
| **Python `diagrams`** | Python | Yes | No | Low | AWS/GCP/Azure infra with provider icons |
| **Graphviz/DOT** | Graph desc | Yes | No | Medium | Auto-generated graphs (e.g. from Terraform) |
| **Draw.io / Excalidraw** | GUI | File yes, diff no | No | None | Hand-drawn, stakeholder-facing, no review process |

## Source-of-truth options (the Model + Correlation layers)

**NetBox** — the strongest fit for "servers and their relationships".
- Curated network data model: sites, racks, devices, interfaces, cables, VMs, clusters, IPs/prefixes, VLANs, VRFs, circuits.
- Explicitly positions itself as source of truth for *intended* state; **automated import of live state is strongly discouraged** — data must be human-vetted. That's a feature for audit purposes, not a bug.
- **NetBox 4.6 Custom Objects v0.5** adds exactly the correlation piece: *"From a service, see every component it runs on. From an interface, see every service that depends on it"* — polymorphic 1:1 and 1:many across object types, definable via version-controlled YAML.
- Hard requirement: Django + PostgreSQL + Redis.
- Caveat: overkill if you're not running real network hardware.

**Backstage catalog / CMDB** — software-catalog first (services, owners, APIs), weaker on physical/network layer.

**C4 model (Simon Brown)** — the notation, not a tool. Deployment diagrams are a *supporting* diagram type: one per environment (prod/staging/dev), nesting deployment nodes (server → container runtime → app), with infrastructure nodes (LB, DNS, firewall) included. Notation- and tooling-independent. Container diagrams deliberately exclude clustering/failover detail — that belongs in the deployment diagram.

## The PCI constraint — this is the part that should drive the design

Requirement-level, from PCI SSC primary sources:

- **PCI DSS 1.1.2** — "Current diagram that identifies all connections between the CDE and other networks, including any wireless networks." Testing requires *examining* the diagram **and interviewing personnel to verify the diagram is kept current**.
- **PCI DSS 1.1.3 (v3.x)** — a data-flow diagram showing how cardholder data flows across systems and networks.
- **ROC template** wants both: a **high-level network diagram** (in the executive summary, overall architecture) *and* **detailed network diagram(s)** illustrating each communication/connection point, with all CDE boundaries marked.
- **PCI DSS for Large Organizations** lists the useful records: network diagrams, CDE diagrams, business-process mappings, **asset registers/technology inventories**.
- **Scoping & Segmentation guidance**: entity retains documentation showing how scope was determined; scope must be kept accurate on an ongoing basis.

**The assessor's actual complaint** (KirkpatrickPrice, an ASV-adjacent assessor):
> *"This doesn't mean just changing the date. As an assessor, we often come into your environment and we'll look at the documentation and see that the date is current. But understand that just because you changed the data doesn't necessarily mean that the network diagram is current."*

And the fix they want, in both sources: **tie documentation updates into the Change Control Program** — PCI DSS for Large Orgs says *"Include documentation updates as a trailing requirement to change control."*

**Design consequence:** a manually-drawn diagram is an audit liability the day after it's drawn. The defensible design is model-driven: one validated data file → rendered diagrams, with a CI check that fails when the model and the IaC/config disagree.

## What this repo already has to build from

| Asset | Location | Relevance |
|---|---|---|
| Terraform (scanner fleet) | `scanner/infra/terraform/{main,scanner-fleet,outputs,variables,versions}.tf` | `terraform graph` emits DOT → auto-generatable topology for the cloud portion |
| Docker Compose | `scanner/docker-compose.yml`, `scanner/tests/fixtures/docker-compose.yml`, `portal/docker/keycloak/docker-compose.yml` | Compose files *are* a dependency graph (`depends_on`, ports) |
| systemd units | `scanner/infra/systemd/asv-{api,worker,beat}.service` | Service→host→port correlation for the on-prem side |
| MinIO infra | `scanner/infra/docker/minio.yml` | Evidence bucket topology |
| Existing narrative docs | `docs/compendium/01-architecture.md` etc. | Prose only — **zero diagrams in repo today** (no .drawio/.mmd/.puml/.d2, no mermaid) |
| `drawio-skill` | `~/.agents/skills/drawio-skill/` (incl. styles, references, scripts) | Already installed; produces .drawio JSON |

**Noted gap:** no diagram tooling is in use at all yet — so this is greenfield, no migration cost.

## Candidate approaches

**A. Draw.io only (manual)** — fastest to a first picture; matches the installed skill. Dies on: no diff/review, no queryable correlation, breaks PCI 1.1.2 currency on the first change. Not recommended as the system of record.

**B. Mermaid-in-markdown + a YAML/TOML facts file** — model lives in a small versioned data file (hosts, services, ports, edges); a script renders Mermaid deployment + data-flow diagrams into `docs/`; CI fails on drift vs compose/Terraform. Git-reviewable, zero new infra, renders in GitHub. Weakness: no GUI for auditors, hand-rolled drift checks.

**C. NetBox as source of truth + rendered views** — purpose-built for exactly "servers and their correlation"; Custom Objects models the app→infra dependency edges; API means diagrams and asset registers generate from it. Cost: a service to run and keep fed; disproportionate unless network hardware is in play.

**D. Structurizr DSL** — single model, all C4 views including per-environment deployment + data-flow, ADRs colocated. Strong C4 discipline. Cost: steep DSL, opinionated, another render pipeline.

**Recommended composition (B as spine, C later if hardware grows):**
1. One versioned correlation file — every server: role, environment, IPs, listeners (port/proto), dependencies (who it calls + direction), owner, CDE flag.
2. Script renders from it: high-level network diagram, per-environment deployment diagram, cardholder-data flow diagram.
3. CI gate: model vs live (compose/systemd/terraform) drift check → fails the build. This is the artefact that satisfies "kept current."
4. Change-control hook: model edit is a trailing item on every infra change; the git log *is* the currency evidence for 1.1.2.b.
5. Keep Draw.io for the polished stakeholder/auditor hand-off version, generated or checked against the model — never hand-maintained independently.

## Open questions for the design

- Does this cover the ds-asv fleet only, or T3MP3ST + kilo-asv + the two Kali VPS hosts too?
- Is a real CMDB wanted, or is a repo-native model + CI gate enough?
- Must the output satisfy a specific assessor's template (AOC/ROC), or internal ops clarity?
- Who edits the model — only you, or should it survive other operators?

## Sources

- c4model.com/diagrams/deployment · /diagrams/container · /diagrams/notation
- github.com/netbox-community/netbox · netbox.readthedocs.io · netboxlabs.com/docs/netbox/introduction
- netboxlabs.com/blog/netbox-4-6-ga-custom-objects-branching-foundations
- listings.pcisecuritystandards.org — *PCI DSS for Large Organizations v1*, *ROC Reporting Template*, *Guidance for PCI DSS Scoping and Network Segmentation v1.1*
- kirkpatrickprice.com — PCI DSS Requirement 1.1.2 and 1.1.3: Network Documentation
- pcidssguide.com — PCI DSS Network and Data Flow Diagrams
- infrasketch.net — Best Diagram-as-Code Tools 2026 · Top 7 Architecture Diagram Tools
- repowise.dev — Best Architecture Documentation Tools
- blobstreaming.org — Open-Source Diagramming Tools for Developers
- jamesm.blog — Diagrams as Code: A Practitioner's Guide
- onuml.com — Mermaid vs PlantUML
