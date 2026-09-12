# ds-asv Customer UI — Design Spec (new frontend)

**Date:** 2026-09-12
**Status:** Draft, awaiting user review
**Scope of this doc:** the design of a new, independent customer-facing frontend for ds-asv.
**Author:** Hermes session with cchock

---

## 1. Purpose

Design a **new customer UI built from scratch**, independent of the existing `portal/` UI, that gives merchant users a calm, guided view of their PCI ASV scan cycle.

The existing customer UI in `portal/src/app/customer/*` is **reference only**. Nothing is inherited from it — not layout, not styling, not components. It stays live and untouched while the new frontend is designed and built beside it.

Success looks like: a merchant lands on the app, immediately knows whether they are on track this quarter, and always knows the single next thing to do.

## 2. What we are building, and what we are not

**Building**

- A standalone frontend application (`React + Vite + TypeScript + Tailwind v4`).
- Its own app shell, routing, design tokens, and primitive components.
- Six surfaces: **Home, Assets, Scope, Scans, Reports, Report detail** — plus a **sign-in landing** screen.
- Explicit loading, empty, and error states on every surface.

**Not building (this pass)**

- Team / Access / Audit / Settings screens. They appear in the nav; their screens are a second pass.
- The QSA portal, and the scanner dashboard (`scanner/web/`). Separate surfaces, separate milestones.
- Any change to the backend contracts. See §8 — two small list endpoints are the only exception, and they are additive.
- Dark mode. Light only for v1. Tokens are structured so a dark set can be added later without touching components.

## 3. Design language

Chosen direction: **calm modern SaaS, typography-led, colour reserved for meaning.**

### Colour

Chrome is neutral; colour is a signal, not decoration.

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#18181b` | primary text |
| `--ink-muted` | `#71717a` | secondary text, metadata |
| `--ink-subtle` | `#a1a1aa` | labels, disabled, placeholders |
| `--border` | `#e4e4e7` | card and input borders |
| `--hairline` | `#f4f4f5` | row separators, inner dividers |
| `--surface` | `#ffffff` | cards, panels |
| `--canvas` | `#fafafa` | page background, table headers |
| `--accent` | `#6d28d9` | interactive only: primary buttons, links, focus, progress |
| `--accent-weak` | `#faf5ff` / border `#ddd6fe` | selected rows, informational callouts |
| `--pass` | `#15803d` on `#f0fdf4`, border `#bbf7d0` | passed, verified, met, FINAL |
| `--warn` | `#a16207` on `#fffbeb`, border `#fde68a` | running, pending, due soon, unmet condition |
| `--fail` | `#b91c1c` on `#fef2f2`, border `#fecaca` | failed, high findings, blocked |

**Rule:** green / amber / red appear *only* to describe state. They are never used for branding, section headings, or emphasis. If something is red, it means something is wrong.

### Type

System sans stack (Inter/Geist if available), no webfont dependency in v1.

| Role | Size / weight / tracking |
|---|---|
| Hero metric | 30px / 600 / −0.01em |
| Page title | 18px / 600 / −0.01em |
| Section title | 15px / 500 |
| Body | 14px / 400 |
| Meta | 12px / 400, `--ink-muted` |
| Label | 11px / 500 / 0.07em / uppercase, `--ink-subtle` |

### Shape, space, motion

- Radius: **6px** standard, **4px** badges, pill for inline status chips.
- Spacing on a 4px grid; section rhythm 12 / 16 / 24 / 32.
- Content max-width **1100px**.
- Motion: 120ms ease-out on hover/selection/expand only. Honour `prefers-reduced-motion`.
- Focus: 2px accent ring, 2px offset, on every interactive element.

### Non-negotiable rules

1. **One primary action per screen.** Everything else is secondary or tertiary.
2. **Status is never carried by colour alone** — every coloured state also has an icon or a word.
3. **No fabricated values.** Empty means empty, unavailable means unavailable. Never seed a screen with sample data and present it as live.
4. No emoji in chrome. Directional/typographic glyphs only (`✓ ◐ ○ → ↓ ·`).

## 4. Shell

Three parts, fixed for every screen.

**`LifecycleNav`** (left, 240px)

The navigation *is* the scan cycle, numbered, with live status per stage. This is the load-bearing idea of the whole design: the sidebar answers "where am I?" without the user reading anything else.

```
1 · Assets     ✔   4 verified
2 · Scope      ✔   v4 approved
3 · Scans      ◐   1 running
4 · Reports    ○   needs attestation
── Manage ──
Team · Access · Audit · Settings
```

- Stage glyphs: `✔` pass · `◐` in progress · `○` not started · `⚠` blocked.
- The label group above the stages carries org name + current quarter.
- Below 900px the nav collapses to a horizontal 4-step stepper across the top; the Manage group moves into an overflow menu.

**Responsive.** One breakpoint for v1: 900px. Below it the nav becomes a top stepper, card lists stay single-column, the ContextBar stacks its countdown above the action, and content padding drops to 16px. No tablet-specific layout.

**`ContextBar`** (top of content)

Org context and the deadline, always present: org name, quarter, days remaining, and the primary action for the current stage. When the deadline is inside 14 days the countdown takes the `--warn` treatment.

**Who owns the primary action.** The ContextBar owns the *stage's* primary action (submit scope, attest report, start scan). A screen owns only screen-specific actions (add asset, raise dispute) and **must not duplicate** the stage action already in the bar. Two violet buttons on one screen is a defect.

**`Content`**

One screen at a time, 1100px max, 32px padding. No nested sidebars, no tabs inside tabs.

**Nav destinations that aren't built yet.** Team / Access / Audit / Settings appear in the nav and route to a shared placeholder screen stating which pass builds them — never a 404, never a dead link.

## 5. Screens

### 5.1 Home — the quarter checklist

Answers "am I okay, and what next?" in one glance.

- **Quarter progress bar** — 5 steps, filled to the number complete.
- **Task rows**, in lifecycle order, each with: state glyph, title, one line of why/meta, due date, and a single action.
  - Completed rows are muted and struck through, with their completion evidence ("Scope v4 · approved 2 Aug").
  - The active row is the only one with an accent-bordered treatment and a primary button.
  - Future rows are visibly locked rather than hidden — the merchant should see what's coming.
- **Empty state (no assets yet):** the checklist collapses to step 1 with a single "Add your first asset" action.
- Every row's state is derived from real data. A row whose data can't be read shows "unavailable", not a guess.

### 5.2 Assets

- Card list (one card per asset): canonical identifier, type, lifecycle state, verification state and method, last verified date.
- Toolbar: search, filter by state/type, primary "Add asset", secondary "Import CSV".
- Unverified assets sort first and carry the `--warn` treatment — verification is the merchant's most common loose end.
- Retired assets collapse into a muted section at the bottom; they are never hidden, because history matters for disputes.
- Empty state: import or add, with the CSV format explained inline.

### 5.3 Scope

- **Approved scope hero**: `v4 · 4 assets`, approver, approval date, fingerprint (short form, full on hover/copy), and how many scans it backs.
- Actions on the hero: view assets, download the signed authorization.
- **Draft banner** when one exists: what's in it, how it differs from the approved version, and "Submit for approval" as the primary action. A draft is visibly *not* in force.
- **Version history** as compact rows: version, approved date, asset count, and whether it is in force or superseded.
- Immutability is communicated in the copy: a change to the approved set requires a new version and a new approval.

### 5.4 Scans

- Card list, newest first. Each card carries status, scope version, target count, start time, and severity counts once complete.
- A running scan shows a progress bar, percentage, and elapsed/estimated time — this is the one screen where live progress is legitimate and expected.
- Primary action: "New scan", disabled with a reason when no approved scope exists (never silently disabled — say *why*).
- Failed scans link straight to their findings and carry the `--fail` treatment.

### 5.5 Reports

- Report cards, newest first: report title, period, backing scope version, attestation state, finalisation state, findings summary, download.
- Per-report **stepper across the header**: Scan complete → Findings in → Attested → Final. Completed steps are filled, the current step is accented, future steps are hollow.
- Below the stepper, a **gate callout** that explains the current position in one sentence:
  - Final: "Attested by QA on 3 Sep against approved scope v4."
  - Not final: "Scope v4 approved · attestation pending. The report stays in draft until both are met."
- Download is only offered when the service says the report is final. A disabled download always states why.

### 5.6 Report detail

- Same stepper and gate callout, expanded.
- Findings grouped by severity, each row: host/target, title, severity, CVE reference, and a dispute entry point where the customer may raise one.
- The scope version behind the report is always visible — this is what makes the report defensible.
- Download PDF as the single primary action.

### 5.7 Sign-in landing

Because the frontend reuses the portal's Keycloak session (§7), this is **not** a credentials form.

- Branded page: product mark, one line about what the product is, and a single "Continue with Keycloak" action that hands off to the portal's login route.
- Where a session already exists, it goes straight to Home.
- An expired/revoked session returns here with a plain explanation — not a raw 401.

## 6. Data flow

- The app is a client-side SPA. All data comes from the portal's existing `/api/v1/*` endpoints.
- Fetching is centralised in a typed API client module; screens never call `fetch` directly.
- **TanStack Query** for caching, retries, and stale-while-revalidate. No hand-rolled caching.
- Requests are same-origin and send the session cookie (`credentials: "include"`).
- Query keys are tenant-scoped by construction; a 401 anywhere routes to the sign-in landing, a 403 renders the permission state for that screen rather than an error page.
- Mutations (create scan, submit scope, attest, raise dispute) invalidate the queries they affect; no optimistic writes on compliance-affecting actions — the server is the authority and the UI waits for it.

### Screens → endpoints

| Screen | Endpoints |
|---|---|
| Home | `assets`, `scope-sets`, `scans`, `reports` (list — see §8), `audit` |
| Assets | `assets`, `assets/[id]`, `assets/imports`, `assets/[id]/verify`, `assets/[id]/retire` |
| Scope | `scope-sets`, `scope-sets/[id]/versions`, `scope-versions/[id]/submit`, `…/approve`, `…/authorization` |
| Scans | `scans`, `scans/[id]`, `scans/[id]/dispatch`, `scans/[id]/findings`, `scanner/health` |
| Reports | `reports` (list — §8), `reports/[id]`, `reports/[id]/download`, `reports/[id]/attest` |
| Report detail | `reports/[id]`, `scans/[id]/findings`, `findings/[id]/disputes` |

## 7. Auth and deployment topology

**Decision: same-origin behind a reverse proxy. The portal's Keycloak login is reused. No backend auth change.**

- The new frontend is served on the portal's origin under a base path (`/app`), with `/api/*` proxied to the existing portal. Same registrable origin ⇒ the `asv_session` httpOnly cookie is sent with API calls, and there is no CORS surface to open.
- Sign-in hands off to the portal's existing `/api/auth/login` route, which runs the Keycloak authorization-code flow and sets the cookie. There is **no second Keycloak client**, no public client, no PKCE in the SPA, and no realm change.
- Sign-out calls the portal's existing logout route (which revokes the session registry row) and returns to the sign-in landing.
- Vite is configured with `base: '/app/'` and history-fallback routing so deep links work under the base path.

**In front of all of this sits an Azure load balancer.** The public entry point for the finished product is the load balancer's address, which forwards to `purple:8443` — not `8443` directly. Consequences that must be handled at deploy time:

- **Keycloak redirect URIs must list the load balancer's hostname.** The portal's login route derives the callback from the request's own origin (`request.nextUrl.origin`), so the URI Keycloak sees depends on the hostname the browser used. An unlisted hostname is a hard failure at the callback, not a warning.
- **The original `Host` and `X-Forwarded-Proto` must survive the hop.** nginx already forwards both to the portal; the load balancer must too, or the derived callback will name the wrong scheme or host.
- **TLS is terminated twice** (load balancer, then nginx on 8443). Whether the load balancer re-encrypts or passes through decides whether the nginx certificate is ever seen by a browser.
- The app itself needs no change for this: `/app` and `/api` are relative paths, so they follow whatever host the user arrives on.

*Alternative considered and rejected for now:* a separate origin with its own Keycloak public client and Bearer tokens. It is the cleanest separation and gives the frontend its own login screen, but it requires CORS headers on every portal route plus a realm client and audience mapper. Parked, not dismissed — the design keeps the cookie behind a single `auth` module so switching later touches one file.

## 8. Backend prerequisites (additive only)

The current UI reads two lists server-side through Prisma services, so no list endpoint exists for a standalone client:

1. **`GET /api/v1/reports`** — tenant-scoped report list with scope version, attestation and finalisation state. Required by Home and Reports.
2. **`GET /api/v1/findings`** — optional cross-scan findings list (severity, host, CVE). Required only if Home shows an "open findings" total; otherwise Home composes from scan findings.

Both are additive read endpoints, guarded by the existing session/role/RLS path. Neither changes an existing contract. Any other missing value is rendered as unavailable rather than approximated.

## 9. States and error handling

Every screen defines all five:

| State | Behaviour |
|---|---|
| Loading | Skeleton in the shape of the real content. Never a spinner on a blank page. |
| Empty | Explains what the screen is for and gives one action to fill it. No sample data. |
| Partial | Renders what loaded; the unread part reads "unavailable" with a retry. Never silently zero. |
| Error | Sanitised message, retry action, and a reference for support. No stack traces, no raw server text. |
| Permission | Explains which role is needed and who to ask. Not a blank screen or a redirect loop. |

Cross-cutting: `scanner/health` failing must not break navigation — the Scans screen shows the health banner and stays usable.

## 10. Components and boundaries

Each unit has one purpose and a stated dependency surface.

| Component | Does | Depends on |
|---|---|---|
| `LifecycleNav` | Renders stages + live status, routes | route config, stage-status view model |
| `ContextBar` | Org/quarter/deadline + primary action slot | org view model |
| `StageProgress` | 4-step stepper, filled/current/hollow | step states |
| `GateCallout` | Explains the report gate in one sentence | report gate view model |
| `TaskRow` | One checklist row on Home | task view model |
| `RecordCard` | One card in any card list | record view model + children |
| `StatusChip` | Status word + glyph + colour, from one state enum | state enum |
| `Stat` | Label + value + caption | primitives |
| `EmptyState` | Copy + single action | primitives |
| `Toolbar` | Search/filter/actions for a list | primitives |
| `Field`, `Button`, `Card`, `Badge` | Primitives | tokens only |

Rules:

- **View models, not raw API objects.** The portal sends Prisma-shaped JSON; each screen maps it to a serialisable view model (`StageStatus`, `ReportGate`, `TaskView`) before rendering. No screen reads `prisma` field names.
- Status logic lives in one module (`status.ts`): one enum, one mapping to glyph + colour + label. Nothing else decides what green means.
- The API client is the only module that knows URLs or the cookie.
- Auth is the only module that knows how a session is obtained — so the topology in §7 can change without touching screens.

## 11. Verification and acceptance

The milestone is complete when:

1. The app builds and runs standalone under a base path, behind the proxy, with the real session cookie.
2. All seven surfaces render from real tenant data with the session guard, and no surface shows fabricated values.
3. Every screen has demonstrable loading, empty, partial, error and permission states.
4. The report gate is correct in both directions: a report is shown final **only** when the service says so, and a non-final report states precisely which condition is missing.
5. `status.ts` is the only place state → colour/glyph/label is decided (enforced by a test that greps for stray colour literals in components).
6. Unit tests cover the primitives and each screen's states; one Playwright smoke path covers sign-in → home → scope → reports.
7. Keyboard-only traversal of the nav, the checklist, and the report gate callout works, with visible focus.
8. Contrast meets WCAG AA on all text and status pairs.

## 12. Out of scope

- Team / Access / Audit / Settings screens (nav only, second pass).
- QSA portal and scanner dashboard.
- Dark mode.
- Any redesign of the portal's own UI — it stays as-is.
- Changing authentication, RLS, or any existing API contract beyond the two additive endpoints in §8.
- Compliance claims of any kind.

## 13. Decision log

Mockups for each decision are in `specs/2026-09-12-ui-mockups/` (see its README for the option→choice map).

| # | Decision | Chosen | Alternatives considered |
|---|---|---|---|
| 1 | Target surface | Customer portal; QSA deferred | QSA first; both; scanner dashboard |
| 2 | Relationship to existing UI | Start over; nothing inherited | Restyle the existing UI in place |
| 3 | Feel | Calm modern SaaS, status carries meaning | Guided journey; dark ops console; two modes |
| 4 | First-pass coverage | Shell + the 5 lifecycle screens | Home only; all 10 pages; home + reports |
| 5 | Where it lives | Independent frontend, existing API | Stay in Next.js; BFF; headless-API split |
| 6 | Shell | Lifecycle nav with status per stage | Grouped sidebar; rail + top bar |
| 7 | Look | Graphite + violet, 6px, light weights | Ink + blue; monochrome |
| 8 | Home | Quarter checklist | Status hero; metric dashboard |
| 9 | Reports | Stepper + gate callout | Gate checklist; table-first |
| 10 | Lists | Card lists | Dense table; master–detail |
| 11 | Scope | Approved-scope hero + history | Version cards; version chain |
| 12 | Auth/deploy | Same-origin proxy, reuse portal login | Own Keycloak client + Bearer; mock API for now |

## 14. Open items

1. **Proxy configuration** — the rule that serves `/app` and forwards `/api/*` to the portal is not written yet; it belongs in the deployment doc for the heaven → purple push.
2. **`GET /api/v1/reports`** — needed before Home and Reports can read real data (§8).
3. **Home "open findings" total** — decide whether it composes from scan findings or needs the optional list endpoint.
4. **Product naming** — settled for now as a deliberate neutral placeholder: `PRODUCT_NAME = "ASV Portal"` in `customer-ui/src/lib/brand.ts`. The real customer-facing brand is still undecided. The wordmark and tagline are single constants, and `brand.test.ts` fails if either is hardcoded in a component — the previous build hardcoded "T3MP3ST" in three files, which made an undecided guess look like a decision.
5. **Base-path cookie scope** — confirm the session cookie path/domain allows `/app` and `/api` on the same origin in the target deployment.
6. **Load balancer hostname and Keycloak redirect URIs** — the product's public address is an Azure load balancer in front of `purple:8443`. Its hostname must be registered as a valid redirect URI on the Keycloak client before first use, and it must forward the original `Host` and `X-Forwarded-Proto`. Confirm both against the real load balancer when it is in place; neither can be guessed from this repo.
