# ASV Scanner Dashboard — Design Spec

**Date:** 2026-09-06
**Module:** ds-asv Module 1 — ASV Scanner
**Status:** Draft, awaiting user review

---

## 1. Purpose & Scope

Build a primary web surface for the ASV Scanner module: a React + Vite dashboard that operators and customer security teams use to triage scans, review findings, and download SARs. The dashboard is a **consumer** of the existing FastAPI API in `scanner/app/api/routes.py` and `scanner/app/api/portal.py`. The dependency-free `/portal` page stays as a fallback; this dashboard becomes the day-to-day tool.

**In scope:**
- New React + Vite + TypeScript app at `scanner/web/`
- Three small FastAPI additions to support role-based access (Section 6)
- Operator and QSA / customer-security role views
- Scan, finding, and SAR access flows
- Dark, dense, mono-heavy "compliance control room" visual identity (Section 4)

**Out of scope:**
- SIEM / Wazuh integration (Module 2)
- Threat detection / reporting (Module 3)
- Customer Management Center module (Module 4) — this dashboard only consumes customer data, does not own it
- Self-hosted CVE DB UI (Module 5)
- Real-time WebSocket push (polling is sufficient for v1)
- Auth server / token issuance (we consume the existing bearer token, do not mint it)
- Replacing `/portal` (kept as dependency-free fallback for restricted environments)

---

## 2. Roles & Access

Two roles, one app. Role is derived from a new `GET /v1/me` endpoint (Section 6) and stored in client-side session state.

| Capability                                | Operator | QSA / Customer Security |
|-------------------------------------------|:--------:|:-----------------------:|
| View all customers                        | ✓        | —                       |
| View own customer only                    | —        | ✓                       |
| Run a new scan                            | ✓        | —                       |
| Onboard a new customer                    | ✓        | —                       |
| View scope audit history                  | ✓        | —                       |
| View all scans                            | ✓        | —                       |
| View scans for own customer               | —        | ✓                       |
| View findings                             | ✓        | ✓ (own customer only)   |
| Download SAR                              | ✓        | ✓ (own customer only)   |
| Suppress / dispute finding                | —        | ✓ (own customer only)   |
| Active-scans Watch surface                | ✓        | —                       |

QSA / customer role is enforced both in the UI (route guards, query filters) and on the server (token claims). The UI is not the source of truth; it simply doesn't render what the API would refuse.

---

## 3. Information Architecture

Three primary surfaces, switched via a persistent left rail:

### 3.1 Watch (operator home)
- **Active scans strip** — fixed horizontal bar at the top, one block per in-flight scan showing target, elapsed time, and a pulsing amber dot. Auto-refreshes every 2.5s. The signature element of the design.
- **Severity histogram** — last 7 days, hand-rolled SVG bar chart. One bar per day, stacked by severity (critical / high / medium / low). Answers "how bad was the week?"
- **Recent activity feed** — last 20 scan state transitions across all customers, mono timestamps, one line per event.

### 3.2 Scans (both roles)
- Sortable, filterable table. Filters: customer (operator only), status, result, scan type, date range, severity floor.
- Columns: scan ID (mono, truncated with full ID on hover), customer, targets (truncated), status, result, severity tally (e.g. `▲2 ●5 ◆12`), started, duration.
- Click → scan detail page.

### 3.3 Customers (operator only)
- Table: name, contact, merchant level, active scope CIDR count, last scan, finding count.
- Click → customer detail page: scope CIDRs, scope audit timeline, recent scans, SARs.

### 3.4 Scan detail (both roles, role-gated)
- **Header strip:** scan ID, customer, scan type, auth method, status, overall result, started, finished, SAR download button (gated to `completed` status).
- **Targets panel:** per-target card — hostname / IP, status, duration, error if any, open-port table (mono, port / protocol / service / banner / TLS).
- **Findings panel:** dense table. Severity column uses single mono glyph (▲ critical, ● high, ◆ medium, ▪ low, — info). PCI pass/fail is a 3px left-edge vertical bar (amber for fail, muted for pass). Click a row → right inspector.

### 3.5 Right inspector (scan detail)
Opens when a finding is selected. Shows:
- Full description
- CVE link if `cve_id` present
- CVSS score + vector
- Source (authenticated_dpkg / authenticated_rpm / unauthenticated_banner)
- Confidence (authenticated / uncertain / suppressed)
- Raw evidence (collapsed JSON viewer)
- Suppression controls (QSA / customer only)

---

## 4. Visual Identity

### 4.1 Palette (locked)

| Role                | Hex       | Notes                                            |
|---------------------|-----------|--------------------------------------------------|
| Surface base        | `#0B0F1A` | Page background                                  |
| Panel               | `#111726` | Cards, sections                                  |
| Raised              | `#1A2236` | Hover, selected rows                             |
| Border              | `#3D4A66` | Dividers, table rules                            |
| Text primary        | `#E6ECF5` | Default text                                     |
| Text muted          | `#8A95AD` | Labels, secondary                                |
| Accent (alert)      | `#F5A524` | The one accent — in-flight, attention, FAIL      |
| Pass                | `#3DD68C` | Confirmed PASS only                              |
| Critical            | `#E5484D` | Active breach / failed auth only                 |

The design's restraint comes from the green/red pair being used almost never. If a page is mostly green and red, the design has failed.

### 4.2 Typography

| Role      | Family            | Usage                                     |
|-----------|-------------------|-------------------------------------------|
| Display   | Space Grotesk     | Page titles, customer names               |
| UI        | Inter             | Labels, body, buttons                     |
| Mono      | JetBrains Mono    | Scan IDs, IPs, CVSS, timestamps, ports    |

Loaded via Google Fonts in dev; self-hosted in prod (out of scope for v1 — call out as a deployment hardening item).

### 4.3 Layout primitives
- 8px spacing scale
- Border-radius: 4px on inputs, 8px on panels, 0 on table cells (the dense look comes from square tables)
- Single 1px borders, no shadows except a subtle 1px inset on raised surfaces
- No emoji, no decorative icons. Glyphs come from JetBrains Mono (severity) and a small set of inline SVGs (chevrons, download, external link)

### 4.4 Signature element
**The active scans strip** at the top of Watch. Each in-flight scan is a fixed-width block (160px) showing: pulsing amber dot, target (truncated), elapsed time (live-updating mono), status. As scans complete they slide off; new ones slide in. The pulse is the only animation in the entire app.

### 4.5 Accessibility
- Color is never the only signal: severity glyph + label always present, PCI bar always present alongside any text marker
- Visible keyboard focus rings (2px amber outline)
- `prefers-reduced-motion` disables the scan-strip pulse
- All interactive elements have accessible names
- Color contrast verified: text on surface ≥ 7:1, text on panel ≥ 7:1, muted text ≥ 4.5:1

---

## 5. Tech Stack & File Layout

### 5.1 Stack
- **Vite 5** + **React 18** + **TypeScript 5**
- **TanStack Query 5** for server state (cache, polling, retries)
- **React Router 6** for routing
- **Zustand 4** for auth/session state
- **Tailwind CSS 3** as utility only, plus a `tokens.css` that defines the palette and mono-display classes
- No component library. The dense-table aesthetic would fight Material / shadcn defaults.
- No chart library. The histogram is hand-rolled SVG (~40 lines).

### 5.2 File layout

```
scanner/web/
  index.html
  package.json
  tsconfig.json
  vite.config.ts           # dev proxy /v1 -> :8000, /portal -> :8000
  tailwind.config.js
  postcss.config.js
  src/
    main.tsx
    App.tsx
    tokens.css             # palette, type scale, mono display
    api/
      client.ts            # fetch wrapper, auth header, error normalization
      customers.ts         # list, get, scope-audit
      scans.ts             # list, get, get-details, get-findings, sar-url
      findings.ts          # list-by-scan, suppress (QSA only)
      me.ts                # /v1/me
    auth/
      store.ts             # zustand: token, role, customerId
      guard.tsx            # route guard component
    pages/
      Login.tsx
      Watch.tsx            # operator only
      Scans.tsx
      ScanDetail.tsx
      Customers.tsx        # operator only
      CustomerDetail.tsx   # operator only
      NotFound.tsx
    components/
      Rail.tsx             # left navigation
      TopBar.tsx           # role pill, customer scope, logout
      ScanStrip.tsx        # signature element
      SeverityHistogram.tsx
      ActivityFeed.tsx
      ScanTable.tsx
      FindingTable.tsx
      SeverityGlyph.tsx
      PciBar.tsx
      PortTable.tsx
      JsonViewer.tsx
      Inspector.tsx
      EmptyState.tsx
      ErrorState.tsx
    hooks/
      usePollingScan.ts    # poll /v1/scans/:id every 2.5s while not terminal
      useElapsed.ts        # live-updating elapsed timer
    lib/
      time.ts              # formatting helpers
      truncate.ts
  public/
    favicon.svg
```

### 5.3 Routing

```
/login                  Login
/                       Watch (operator) or Scans (QSA, filtered)
/scans                  Scans list
/scans/:id              Scan detail
/customers              Customers list (operator)
/customers/:id          Customer detail (operator)
*                       NotFound
```

Route guards check role from auth store and redirect to `/login` or `/` as appropriate.

### 5.4 Vite dev proxy

```ts
// vite.config.ts (sketch)
server: {
  proxy: {
    '/v1': 'http://localhost:8000',
    '/portal': 'http://localhost:8000',
  },
}
```

### 5.5 Production deployment

Out of scope for this spec, but the intended shape: Vite `build` outputs to `scanner/web/dist/`, FastAPI is updated to mount that directory as static assets at `/` and `/portal` continues to work. Flagged as a follow-up task.

---

## 6. API Additions

Three small additions to `scanner/app/api/routes.py`. No schema changes.

### 6.1 `GET /v1/me`
Returns the caller's identity and role from the bearer token.
```json
{ "role": "operator" }
{ "role": "qsa", "customer_id": "uuid", "customer_name": "Acme Co" }
```
- `operator` tokens are pre-shared long-lived tokens (current behavior)
- `qsa` tokens carry a `customer_id` claim (out of scope to implement the issuer; assumed)
- For v1, the existing `verify_bearer_token` is extended to parse role + customer_id from the token. If the token is the legacy shared token, role is `operator`.

### 6.2 `GET /v1/scans`
Top-level scan list. **Operator only.** Returns same shape as `list_customer_scans` but without the `customer_id` filter. Returns additional `customer_name` field. Paginated (`skip`, `limit`).

### 6.3 `GET /v1/customers/{id}/scope-audit`
Returns `ScopeAuditEvent` records for the customer, newest first. Operator only. The model already exists at `scanner/app/models/scope_audit.py`.

### 6.4 Existing endpoints used unchanged
- `GET /v1/customers` (operator)
- `GET /v1/customers/{id}`
- `GET /v1/customers/{id}/scans`
- `GET /v1/customers/{id}/scope/check`
- `POST /v1/customers/onboard`
- `POST /v1/scans`
- `GET /v1/scans/{id}`
- `GET /v1/scans/{id}/details`
- `GET /v1/scans/{id}/findings`
- `GET /v1/scans/{id}/sar` (FileResponse; linked, not embedded)

---

## 7. Data Flow & State

- **Auth state** (token, role, customerId): Zustand, persisted to `localStorage` so a page reload keeps the session. Token is held in memory and re-read from storage on app load.
- **Server state**: TanStack Query. Cache key per endpoint. Polling is opt-in per query (`refetchInterval`). Used for `/v1/scans/:id` while `status` is not terminal.
- **No global event bus.** Components subscribe via queries.
- **Polling intervals:**
  - Active scan detail: 2.5s (matches existing portal behavior)
  - Watch surface active scans: 2.5s
  - Watch surface activity feed: 10s
  - All other lists: manual refresh button + on-focus refetch

### 7.1 Error handling
- 401 → clear auth store, redirect to `/login` with a "session expired" message
- 403 → show an `ErrorState` explaining the role restriction, never a raw error
- 404 → empty state with "go back" affordance
- 5xx → retry once, then show `ErrorState` with the request id
- Network error → banner at top of affected panel; other panels continue working

---

## 8. Testing

V1 test surface, deliberately minimal:
- **Unit tests** (Vitest) for:
  - `time.ts` formatters
  - `SeverityGlyph` mapping (severity → glyph)
  - `PciBar` mapping
  - Auth store transitions
  - Polling hook: stops on terminal status
- **Component tests** (Vitest + React Testing Library) for:
  - `ScanStrip` rendering given fixtures
  - `FindingTable` filtering by severity
  - `Rail` role-gated nav items
- **No E2E in v1.** Flagged as a follow-up — Playwright tests for the run-scan flow are the natural next step.

No coverage target. The risk surface in v1 is small and the manual QA pass through the operator and QSA flows is acceptable.

---

## 9. Phased Delivery (for the implementation plan)

1. **Scaffold:** Vite project, tokens, Tailwind, routing shell, layout (Rail + TopBar + content slot)
2. **Auth:** `/v1/me` endpoint extension, login page, auth store, route guards
3. **API client:** typed fetchers for all 6.4 endpoints + 6.1/6.2/6.3
4. **Scans list + detail:** the highest-value surface
5. **Watch:** active scans strip, histogram, activity feed
6. **Customers list + detail + scope audit**
7. **Right inspector + suppression controls (QSA)**
8. **Polish:** empty states, error states, keyboard focus, reduced-motion

---

## 10. Open Items (flagged, not blockers)

- **Self-hosted fonts in prod:** call out in deployment docs; not blocking
- **WebSocket push:** future, not v1
- **SAR viewer page:** SAR is downloaded as PDF/HTML, not embedded. If the team wants an in-app preview, that's a follow-up.
- **Replacing `/portal`:** keep for now; deprecate after one release of the new dashboard
- **Auth issuer for QSA tokens:** outside the dashboard's scope; assume the API will return the right claims once a real auth server is added
- **Accessibility audit:** WCAG 2.1 AA target is the goal; a real audit is a follow-up
