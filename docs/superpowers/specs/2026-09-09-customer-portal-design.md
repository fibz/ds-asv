# Customer Portal — Design Spec

**Date:** 2026-09-09  
**Module:** ds-asv customer portal  
**Status:** Draft, awaiting user review

## 1. Purpose

Create the customer-facing half of the two-portal product. This milestone gives merchant users a clear customer center for managing their organization, approved scan scope, scanner operations, reports, team access, sessions, audit history, and organization settings.

The QSA portal is explicitly deferred. Its review queue, cross-customer assignment model, attestation workspace, and dispute moderation UI are not part of this milestone.

## 2. URL and deployment boundary

The first release keeps both portals in the existing Next.js deployment while separating their route trees and layouts:

```text
/customer                 customer home
/customer/assets          asset inventory
/customer/scope           approved scope sets and versions
/customer/scans           scanner operations
/customer/reports         customer reports and downloads
/customer/team            organization members and invitations
/customer/access          active sessions and API-key entry point
/customer/audit           organization audit trail
/customer/settings        organization profile and contacts
```

Existing routes remain compatible through redirects, including `/dashboard`, `/assets`, `/scope`, `/scanners`, `/reports`, `/team`, `/access`, `/audit`, and `/settings`. API routes remain under `/api/v1/*`; the portal boundary does not move server contracts.

The route structure must remain portable to separate customer and QSA hostnames later. No customer page may rely on the QSA layout or vice versa.

## 3. Customer capabilities

### Customer home

`/customer` replaces the current placeholder dashboard with data-backed organization status:

- organization name and current user context;
- active asset count and verification summary;
- latest scan state and recent scan count;
- report count, latest report status, and finalization gate state;
- recent organization audit activity;
- quick links to add assets, build scope, start a scan, and review reports.

Empty, loading, and unavailable states are explicit. No fabricated compliance, scan, or activity values may be shown as live evidence.

### Existing customer workflows

The customer portal reuses the existing server-authorized services and API contracts for assets, scope versions, scans, findings, reports, team management, sessions, audit, and organization profile. The UI may hide actions that the current membership cannot perform, but every read and mutation remains guarded in the server route or service layer.

Reports must expose the recorded scope version, scope approval state, attestation state, finalization gate, findings summary, and an available download/detail action. A report is labeled `FINAL` only when the existing service rule confirms both QA attestation and approved scope.

## 4. Authentication and authorization

The customer layout requires the verified Keycloak cookie/header session and redirects unauthenticated users to `/sign-in`. Customer data continues to resolve organization context from the authenticated membership; organization IDs are never accepted from client-controlled route state as an authorization decision.

The customer portal does not introduce a staff bypass. The existing role matrix (`org.manage`, `team.view`, `scan.view`, `scan.run`, `report.view`, and related permissions) remains the source of truth for actions. QSA cross-organization access will be designed separately.

RLS transaction context must be set before every tenant query, including dashboard aggregation and report detail reads. Tests must prove that a user from organization A cannot read organization B through the new customer pages or their backing APIs.

## 5. Components and boundaries

- `customer` route layout: authentication, customer navigation, and common page chrome only;
- customer sidebar: customer capabilities only; deferred QSA navigation must not leak into it;
- customer dashboard data loader: read-only aggregation over existing tenant-scoped services;
- report detail/download surface: read-only customer view over existing report APIs and finalization semantics;
- compatibility redirects: preserve existing bookmarks while making `/customer/*` canonical;
- existing API/service modules: unchanged contracts unless a narrowly scoped data query is required for real dashboard values.

The layout must not contain database queries or permission rules that belong in services. Dashboard and report loaders should return serializable view models, not Prisma objects.

## 6. Error and empty-state behavior

- unauthenticated: redirect to `/sign-in`;
- authenticated without page permission: show a clear permission message or redirect to `/customer` according to the existing page convention;
- missing resource: render a not-found state without exposing another tenant's existence;
- scanner unavailable: show the existing health/unavailable state and keep customer navigation usable;
- no assets/scopes/scans/reports: show a next-action empty state, never sample data;
- API/service failure: display a sanitized error and preserve the server log boundary.

## 7. Verification and acceptance

The milestone is complete when:

1. `/customer` and every listed customer route render behind the real session guard.
2. Legacy routes redirect to their canonical `/customer/*` paths.
3. Dashboard values come from tenant-scoped data and have tested empty/error states.
4. Customer reports show scope, attestation, finalization, findings summary, and detail/download behavior without weakening report gates.
5. Customer actions remain role-gated in server code, not only hidden in the UI.
6. Cross-tenant isolation tests cover dashboard, reports, and at least one customer-management page.
7. Portal TypeScript, focused tests, full tests, and a browser smoke path for sign-in → customer home → reports all pass.

## 8. Out of scope

- QSA portal routes, assignment UI, cross-customer review, attestation workspace, and dispute moderation UI;
- separate deployment or hostname provisioning;
- new WAF/SIEM product workflows;
- PCI qualification or compliance claims;
- replacing the existing API authentication or RLS model.
