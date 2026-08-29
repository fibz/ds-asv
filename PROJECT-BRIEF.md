# ds-asv — Project Brief

> **Purpose:** This file gives a new agent session full context without re-explanation.
> Read this first, then interview the user to fill in the gaps.

## Project Name
ds-asv

## One-Line Vision
A commercial PCI DSS compliance portal — a one-stop platform built around PCI DSS methodology that organizations purchase to achieve and maintain compliance.

## Business Model
**Commercial product (SaaS or similar).** The user is building a product to sell to organizations that need PCI DSS compliance. The "Customer Management" module manages the user's paying customers (not internal teams).

## Planned Modules

| # | Module | Description |
|---|--------|-------------|
| 1 | ASV Scanner | Vulnerability scanner — either custom-built using API calls, or integrating an existing ASV solution |
| 2 | Wazuh SIEM | SIEM deployment with complete log stash |
| 3 | Threat Detection & Reporting | Analysis of offline logs from Wazuh, or live log streams from Wazuh agents |
| 4 | Customer Management Center | Multi-tenant portal for managing the user's customers |
| 5 | Self-hosted CVE DB | NIST NVD mirror or similar vulnerability database |

## What's Been Decided So Far
- This is a **commercial product** (confirmed by user)
- Project folder: `/home/cchock/projects/ds-asv`
- The brainstorming skill classified this as an **architectural** project (new, multi-subsystem, greenfield)
- The project is **too large for a single spec** — it needs to be decomposed into sub-projects, each with its own spec → plan → implementation cycle

## What's NOT Been Decided Yet
- Delivery model: SaaS hosted vs. on-premise vs. hybrid
- Who the target customers are (small merchants? enterprises? QSAs?)
- What the user already has (existing Wazuh deployment? scanner code? a portal? infrastructure?)
- What resources are available (team size, budget, infrastructure, existing tooling)
- Timeline and scope (MVP vs. full platform)
- Tech stack preferences
- Which module to build first

## Next Steps for a New Session
1. Read this file
2. Interview the user to fill in the "NOT Been Decided" section above
3. Once enough is known, propose a decomposition into sub-projects
4. Begin brainstorming the first sub-project through the full architectural design process
