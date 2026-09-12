# ds-asv Customer UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new, independent customer-facing frontend for ds-asv — a React SPA that shows merchant users their PCI ASV scan cycle as a guided quarterly journey, reading the portal's existing `/api/v1` with the portal's existing session cookie.

**Architecture:** A standalone Vite + React + TypeScript app at `customer-ui/`, mounted under the portal's origin at base path `/app/` so its API calls are same-origin and the existing `asv_session` httpOnly cookie authenticates them. Data access is one typed API client behind TanStack Query; every screen maps API JSON into a view model before rendering, so no screen touches Prisma-shaped fields. All state→colour/glyph/label decisions live in exactly one module (`src/lib/status.ts`).

**Tech Stack:** Vite, React, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), React Router, TanStack Query v5, Vitest + Testing Library + jsdom, Playwright (smoke only).

**Spec:** `hermes/customer/specs/2026-09-12-customer-ui-design.md` (mockups: `hermes/customer/specs/2026-09-12-ui-mockups/`)

## Global Constraints

Every task's requirements implicitly include this section.

- **App location:** `customer-ui/` at the repo root. It is a separate application; do not put any of its files under `portal/`.
- **Base path:** `/app/` — set `base: "/app/"` in `vite.config.ts` and `basename` on the router.
- **Package manager:** `npm`, never `pnpm` (pnpm is broken in this sandbox). If the npm cache is read-only, use `npm install --cache /home/cchock/projects/.npm-cache`.
- **Light mode only.** No `prefers-color-scheme` block, no dark tokens. Tokens are CSS custom properties so a dark set can be added later.
- **Colour rules:** interactive = `--accent` (`#6d28d9`) only. Green/amber/red appear only as state. **No colour literal (`#rrggbb`, `rgb(`, `hsl(`) may appear in any file under `src/components/` or `src/screens/`** — only in `src/styles/*.css` and `src/lib/status.ts`. A test enforces this (Task 15).
- **Status is never carried by colour alone** — every state chip pairs a tone with a glyph and a word.
- **One primary action per screen.** The `ContextBar` owns the stage action; screens must not duplicate it.
- **No fabricated values.** Missing data renders as "unavailable" with a retry, never as `0`, `—`, or sample content.
- **No emoji in chrome.** Only `✔ ◐ ○ ⚠ → ↓ ·` are permitted glyphs.
- **Radius:** 6px standard (`--radius`), 4px badges (`--radius-sm`). **Content max-width:** 1100px. **Single breakpoint:** 900px.
- **Type scale:** hero 30/600, page title 18/600, section 15/500, body 14/400, meta 12/400, label 11/500 uppercase with 0.07em tracking.
- **Accessibility floor:** 2px `--accent` focus ring with 2px offset on every interactive element; WCAG AA contrast on all text and status pairs.
- **Never change portal behaviour** except in Task 1, which adds one additive read route.
- **Commit at the end of every task.** Do not push — the branch stays local until the human asks.

---

## File Structure

```
customer-ui/
├── index.html                       # Vite entry, mounted at /app/
├── package.json
├── vite.config.ts                   # base /app/, dev proxy /api → portal :3000
├── vitest.config.ts                 # jsdom environment
├── vitest.setup.ts                  # @testing-library/jest-dom
├── src/
│   ├── main.tsx                     # provider stack + router mount
│   ├── App.tsx                      # route table
│   ├── routes.tsx                   # route config consumed by nav and tests
│   ├── styles/
│   │   ├── tokens.css               # the only file with colour literals
│   │   └── app.css                  # tone classes, focus ring, base type
│   ├── lib/
│   │   ├── status.ts                # state → tone + glyph + label. Single source of truth.
│   │   ├── api/
│   │   │   ├── client.ts            # fetch wrapper: /api/v1 prefix, credentials, ApiError
│   │   │   └── queries.ts           # TanStack Query hooks per resource
│   │   ├── auth/
│   │   │   └── auth.ts              # sign-in / sign-out URLs. Only module that knows the topology.
│   │   └── viewmodels/
│   │       ├── stages.ts            # API data → 4 stage statuses (the sidebar)
│   │       ├── tasks.ts             # API data → home checklist
│   │       └── gate.ts              # report row → gate view (final only when the rule says so)
│   ├── components/
│   │   ├── primitives/
│   │   │   ├── Button.tsx  Card.tsx  Badge.tsx  StatusChip.tsx
│   │   │   ├── Field.tsx   Stat.tsx  EmptyState.tsx  Toolbar.tsx
│   │   └── shell/
│   │       ├── LifecycleNav.tsx     # stage nav + Manage group
│   │       ├── ContextBar.tsx       # org, quarter, deadline, stage action
│   │       ├── StageProgress.tsx    # 4-step stepper (reports header + narrow nav)
│   │       ├── Skeleton.tsx         # loading shape
│   │       └── states.tsx           # ErrorState, PartialState, PermissionState
│   └── screens/
│       ├── SignInLanding.tsx  Home.tsx  Assets.tsx
│       ├── Scope.tsx  Scans.tsx  Reports.tsx  ReportDetail.tsx
│       └── Placeholder.tsx          # second-pass destinations
```

---

### Task 1: Additive `GET /api/v1/reports` list route (portal)

Home and Reports cannot read a report list from a standalone client: `listReports` exists in the service layer (`portal/src/lib/scan/report.ts:70`) but only `reports/[reportId]` is exposed as a route.

**Files:**
- Create: `portal/src/app/api/v1/reports/route.ts`
- Test: `portal/src/app/api/v1/reports/route.test.ts`

**Interfaces:**
- Consumes: `tenantContextFromRequest` (`@/lib/tenant`), `can` (`@/lib/auth/rbac`), `listReports` (`@/lib/scan/report`)
- Produces: `GET /api/v1/reports` → `200 { reports: ReportRow[] }` where `ReportRow` is `Report & { attestation: ReportAttestation | null }`, ordered `createdAt desc`; `401 { error: "Unauthorized" }`; `403 { error: "Forbidden" }`. No other shape — the frontend's `ReportRow` type (Task 7) matches this exactly.

- [ ] **Step 1: Write the failing test**

Mirror the conventions in `portal/src/app/api/v1/scans/route.test.ts` (mock `jose`, mock `@/lib/prisma-client` with a `txMock`, drive a real `NextRequest` with a Bearer header).

```ts
// portal/src/app/api/v1/reports/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET } from "./route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    report: { findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-reports-route", email: "op@x.com" };
const reportRow = { id: "rep_1", scanId: "scan_1", organizationId: "org_1", status: "draft", summary: {}, attestationId: null, scopeVersionId: null, createdAt: new Date(), updatedAt: new Date(), attestation: null };

function req(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: "GET", headers: { Authorization: "Bearer a.b.c" } });
}

function setup(role: string) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  vi.mocked(prisma.report.findMany).mockResolvedValue([reportRow] as never);
}

describe("reports list route", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test"); vi.stubEnv("KEYCLOAK_CLIENT_ID", "test"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("401 without a verified session", async () => {
    expect((await GET(req("/api/v1/reports"))).status).toBe(401);
  });

  it("403 when the role lacks report.view", async () => {
    setup("asset_manager");
    expect((await GET(req("/api/v1/reports"))).status).toBe(403);
  });

  it("200 with reports that include their attestation, for report.view roles", async () => {
    setup("report_viewer");
    const res = await GET(req("/api/v1/reports"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].id).toBe("rep_1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd portal && npx vitest run src/app/api/v1/reports/route.test.ts
```
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```ts
// portal/src/app/api/v1/reports/route.ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listReports } from "@/lib/scan/report";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "report.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const reports = await listReports(ctx);
  return NextResponse.json({ reports });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd portal && npx vitest run src/app/api/v1/reports/route.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full portal suite (no regressions)**

```bash
cd portal && npx vitest run
```
Expected: previous total + 3, all passing. (Baseline measured on 2026-09-12: `Test Files 69 passed (69)`, `Tests 413 passed | 3 skipped (416)`; after this task, 416 passed + 3 skipped. The 3 skips are the live Keycloak suite (`exit.live.test.ts`) which skips cleanly without docker.)

- [ ] **Step 6: Commit**

```bash
git add portal/src/app/api/v1/reports
git commit -m "feat(api): add read-only GET /api/v1/reports list route"
```

---

### Task 2: Scaffold `customer-ui` with the base path and dev proxy

**Files:**
- Create: `customer-ui/` (whole scaffold), `customer-ui/vite.config.ts`, `customer-ui/index.html`, `customer-ui/src/main.tsx`, `customer-ui/src/App.tsx`, `customer-ui/src/styles/app.css`
- Modify: `.gitignore` (add `customer-ui/node_modules/`, `customer-ui/dist/`)

**Interfaces:**
- Produces: a running app at `http://localhost:5173/app/` whose `/api/*` requests reach the portal on `127.0.0.1:3000`; `main.tsx` exports nothing but mounts the router; the dev server must proxy, because the session cookie is set for host `localhost` and cookies ignore port — same-origin in dev is what makes cookie auth work without CORS.

- [ ] **Step 1: Scaffold the Vite app**

```bash
cd /home/cchock/projects/ds-asv
npm create vite@latest customer-ui -- --template react-ts
cd customer-ui && npm install
```

- [ ] **Step 2: Install the runtime and test dependencies**

```bash
cd /home/cchock/projects/ds-asv/customer-ui
npm install react-router-dom @tanstack/react-query
npm install -D tailwindcss @tailwindcss/vite vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 3: Configure Vite with the base path and the API proxy**

```ts
// customer-ui/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/app/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev so the portal's httpOnly session cookie is sent.
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
});
```

- [ ] **Step 4: Add the vitest config and setup file**

```ts
// customer-ui/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

```ts
// customer-ui/vitest.setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Set the app CSS entry to Tailwind v4**

```css
/* customer-ui/src/styles/app.css */
@import "tailwindcss";
@import "./tokens.css";

body {
  background: var(--canvas);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

(references `tokens.css`, created in Task 3 — create an empty `tokens.css` here so the build runs, then fill it in Task 3.)

- [ ] **Step 6: Minimal mount, with the router in place**

```tsx
// customer-ui/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

```tsx
// customer-ui/src/App.tsx
import { Routes, Route } from "react-router-dom";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<div className="p-8">shell pending</div>} />
    </Routes>
  );
}
```

- [ ] **Step 7: Add the ignore rules and the test script**

Add to `.gitignore` (root):

```
customer-ui/node_modules/
customer-ui/dist/
```

Add to `customer-ui/package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 8: Verify it builds and runs**

```bash
cd /home/cchock/projects/ds-asv/customer-ui && npm run build
```
Expected: build succeeds, output in `dist/` with asset URLs prefixed `/app/`.

- [ ] **Step 9: Commit**

```bash
git add customer-ui .gitignore
git commit -m "chore(customer-ui): scaffold vite app with /app base path and api proxy"
```

---

### Task 3: Design tokens and tone classes

**Files:**
- Create: `customer-ui/src/styles/tokens.css`
- Modify: `customer-ui/src/styles/app.css` (add the tone classes)
- Test: `customer-ui/src/styles/tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--ink --ink-muted --ink-subtle --border --hairline --surface --canvas --accent --accent-weak --accent-border --pass --pass-bg --pass-border --warn --warn-bg --warn-border --fail --fail-bg --fail-border --radius --radius-sm`; tone classes `.tone-pass .tone-warn .tone-fail .tone-idle .tone-accent` each setting `color`, `background-color`, `border-color` from those variables.

- [ ] **Step 1: Write the failing test**

```ts
// customer-ui/src/styles/tokens.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tokens = readFileSync(resolve(__dirname, "tokens.css"), "utf8");
const app = readFileSync(resolve(__dirname, "app.css"), "utf8");

const REQUIRED = [
  "--ink", "--ink-muted", "--ink-subtle", "--border", "--hairline",
  "--surface", "--canvas", "--accent", "--accent-weak", "--accent-border",
  "--pass", "--pass-bg", "--pass-border",
  "--warn", "--warn-bg", "--warn-border",
  "--fail", "--fail-bg", "--fail-border",
  "--radius", "--radius-sm",
];

describe("design tokens", () => {
  it.each(REQUIRED)("defines %s", (name) => {
    expect(tokens).toContain(`${name}:`);
  });

  it("defines all five tone classes", () => {
    for (const tone of ["pass", "warn", "fail", "idle", "accent"]) {
      expect(app).toContain(`.tone-${tone}`);
    }
  });

  it("uses the generic radius token for the standard radius", () => {
    expect(tokens).toContain("--radius: 6px");
    expect(tokens).toContain("--radius-sm: 4px");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/styles/tokens.test.ts
```
Expected: FAIL — tokens missing.

- [ ] **Step 3: Write the tokens**

```css
/* customer-ui/src/styles/tokens.css — the ONLY file allowed to contain colour literals */
:root {
  --ink: #18181b;
  --ink-muted: #71717a;
  --ink-subtle: #a1a1aa;
  --border: #e4e4e7;
  --hairline: #f4f4f5;
  --surface: #ffffff;
  --canvas: #fafafa;

  --accent: #6d28d9;
  --accent-weak: #faf5ff;
  --accent-border: #ddd6fe;

  --pass: #15803d;
  --pass-bg: #f0fdf4;
  --pass-border: #bbf7d0;

  --warn: #a16207;
  --warn-bg: #fffbeb;
  --warn-border: #fde68a;

  --fail: #b91c1c;
  --fail-bg: #fef2f2;
  --fail-border: #fecaca;

  --radius: 6px;
  --radius-sm: 4px;
}
```

- [ ] **Step 4: Add tone classes to `app.css`**

Append to `customer-ui/src/styles/app.css`:

```css
/* Tone classes — the only place a state colour is applied. */
.tone-pass   { color: var(--pass); background-color: var(--pass-bg); border-color: var(--pass-border); }
.tone-warn   { color: var(--warn); background-color: var(--warn-bg); border-color: var(--warn-border); }
.tone-fail   { color: var(--fail); background-color: var(--fail-bg); border-color: var(--fail-border); }
.tone-idle   { color: var(--ink-muted); background-color: var(--canvas); border-color: var(--border); }
.tone-accent { color: var(--accent); background-color: var(--accent-weak); border-color: var(--accent-border); }
.tone-dot    { color: inherit; }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/styles/tokens.test.ts
```
Expected: PASS, 23 tests.

- [ ] **Step 6: Commit**

```bash
git add customer-ui/src/styles customer-ui/src
git commit -m "feat(customer-ui): design tokens and tone classes"
```

---

### Task 4: `status.ts` — the single source of state → tone/glyph/label

**Files:**
- Create: `customer-ui/src/lib/status.ts`
- Test: `customer-ui/src/lib/status.test.ts`

**Interfaces:**
- Produces:
  - `type Tone = "pass" | "warn" | "fail" | "idle" | "accent"`
  - `type StageState = "complete" | "active" | "pending" | "blocked"`
  - `type RecordState = "passed" | "running" | "failed" | "draft" | "submitted" | "attested" | "final" | "pending" | "unknown"`
  - `toneForStage(state: StageState): Tone`, `glyphFor(state: StageState): string`, `stageLabel(state: StageState): string`
  - `toneForRecord(state: RecordState): Tone`, `recordLabel(state: RecordState): string`
  - `recordStateFromScan(status: string): RecordState`, `recordStateFromReport(status: string, isFinal: boolean): RecordState`
  - `TONE_CLASS: Record<Tone, string>` — maps a tone to its `tone-*` class name

- [ ] **Step 1: Write the failing test**

```ts
// customer-ui/src/lib/status.test.ts
import { describe, it, expect } from "vitest";
import {
  toneForStage, glyphFor, stageLabel, toneForRecord, recordLabel,
  recordStateFromScan, recordStateFromReport, TONE_CLASS,
} from "./status";

describe("stage status", () => {
  it("maps each stage state to a tone", () => {
    expect(toneForStage("complete")).toBe("pass");
    expect(toneForStage("active")).toBe("warn");
    expect(toneForStage("blocked")).toBe("fail");
    expect(toneForStage("pending")).toBe("idle");
  });

  it("gives every stage state a distinguishing glyph", () => {
    const glyphs = (["complete", "active", "blocked", "pending"] as const).map(glyphFor);
    expect(new Set(glyphs).size).toBe(4);
    expect(glyphFor("complete")).toBe("✔");
    expect(glyphFor("active")).toBe("◐");
    expect(glyphFor("blocked")).toBe("⚠");
    expect(glyphFor("pending")).toBe("○");
  });

  it("gives every stage state a word, so colour is never the only signal", () => {
    for (const s of ["complete", "active", "blocked", "pending"] as const) {
      expect(stageLabel(s).length).toBeGreaterThan(0);
    }
  });
});

describe("record status", () => {
  it("treats attestation-pending as a warning, not a pass", () => {
    expect(toneForRecord("submitted")).toBe("warn");
    expect(toneForRecord("attested")).toBe("pass");
  });

  it("only calls a report final when the caller says it is final", () => {
    expect(recordStateFromReport("attested", true)).toBe("final");
    expect(recordStateFromReport("attested", false)).toBe("attested");
    expect(recordStateFromReport("draft", false)).toBe("draft");
  });

  it("maps scan statuses case-insensitively and never throws on the unknown", () => {
    expect(recordStateFromScan("RUNNING")).toBe("running");
    expect(recordStateFromScan("completed")).toBe("passed");
    expect(recordStateFromScan("FAILED")).toBe("failed");
    expect(recordStateFromScan("SOMETHING_NEW")).toBe("unknown");
  });

  it("exposes a tone class for every tone", () => {
    for (const tone of ["pass", "warn", "fail", "idle", "accent"] as const) {
      expect(TONE_CLASS[tone]).toBe(`tone-${tone}`);
    }
    expect(recordLabel("final")).toBe("Final");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/lib/status.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// customer-ui/src/lib/status.ts
export type Tone = "pass" | "warn" | "fail" | "idle" | "accent";
export type StageState = "complete" | "active" | "pending" | "blocked";
export type RecordState =
  | "passed" | "running" | "failed"
  | "draft" | "submitted" | "attested" | "final"
  | "pending" | "unknown";

export const TONE_CLASS: Record<Tone, string> = {
  pass: "tone-pass", warn: "tone-warn", fail: "tone-fail", idle: "tone-idle", accent: "tone-accent",
};

const STAGE_TONE: Record<StageState, Tone> = {
  complete: "pass", active: "warn", blocked: "fail", pending: "idle",
};
export const toneForStage = (s: StageState): Tone => STAGE_TONE[s];

const STAGE_GLYPH: Record<StageState, string> = {
  complete: "✔", active: "◐", blocked: "⚠", pending: "○",
};
export const glyphFor = (s: StageState): string => STAGE_GLYPH[s];

const STAGE_LABEL: Record<StageState, string> = {
  complete: "Done", active: "In progress", blocked: "Blocked", pending: "Not started",
};
export const stageLabel = (s: StageState): string => STAGE_LABEL[s];

const RECORD_TONE: Record<RecordState, Tone> = {
  passed: "pass", final: "pass", attested: "pass",
  running: "warn", submitted: "warn", pending: "warn",
  failed: "fail",
  draft: "idle", unknown: "idle",
};
export const toneForRecord = (s: RecordState): Tone => RECORD_TONE[s];

const RECORD_LABEL: Record<RecordState, string> = {
  passed: "Passed", running: "Running", failed: "Failed",
  draft: "Draft", submitted: "Awaiting attestation", attested: "Attested", final: "Final",
  pending: "Pending", unknown: "Unavailable",
};
export const recordLabel = (s: RecordState): string => RECORD_LABEL[s];

export function recordStateFromScan(status: string): RecordState {
  switch (status.toUpperCase()) {
    case "RUNNING": return "running";
    case "COMPLETED": return "passed";
    case "FAILED": return "failed";
    case "PENDING": return "pending";
    default: return "unknown";
  }
}

export function recordStateFromReport(status: string, isFinal: boolean): RecordState {
  if (status === "attested") return isFinal ? "final" : "attested";
  if (status === "submitted") return "submitted";
  if (status === "draft") return "draft";
  return "unknown";
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/lib/status.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/lib/status.ts customer-ui/src/lib/status.test.ts
git commit -m "feat(customer-ui): single source of state to tone/glyph/label"
```

---

### Task 5: Primitives

**Files:**
- Create: `customer-ui/src/components/primitives/{Button,Card,Badge,StatusChip,Stat,EmptyState,Toolbar,Field}.tsx`
- Test: `customer-ui/src/components/primitives/primitives.test.tsx`

**Interfaces:**
- Produces:
  - `<Button variant="primary"|"secondary"|"ghost" disabledReason?: string>` — renders `<button>`; when disabled and `disabledReason` is set, the reason is exposed via `aria-describedby` to a visually-hidden node (never a silent disabled control)
  - `<Card>` — bordered surface, `--radius`, optional `title` + `action` slot
  - `<Badge tone>` — small pill, 4px radius
  - `<StatusChip state={StageState} detail?: string>` — glyph + word + tone class, all via `status.ts`
  - `<Stat label value caption? />`
  - `<EmptyState title description action? />`
  - `<Toolbar>` — flex row: `children` (filters) + `actions` slot
  - `<Field label htmlFor error?>` — label + children + error text

- [ ] **Step 1: Write the failing test**

```tsx
// customer-ui/src/components/primitives/primitives.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";
import { StatusChip } from "./StatusChip";
import { Card } from "./Card";
import { Stat } from "./Stat";
import { EmptyState } from "./EmptyState";

describe("Button", () => {
  it("calls onClick when enabled", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run scan</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Run scan" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("states why it is disabled instead of failing silently", () => {
    render(<Button disabled disabledReason="An approved scope is required first">New scan</Button>);
    const btn = screen.getByRole("button", { name: "New scan" });
    expect(btn).toBeDisabled();
    expect(screen.getByText("An approved scope is required first")).toBeInTheDocument();
  });
});

describe("StatusChip", () => {
  it("pairs the tone class with a glyph and a word", () => {
    render(<StatusChip state="complete" detail="4 verified" />);
    const chip = screen.getByText(/Done/).closest(".tone-pass")!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("✔");
    expect(chip.textContent).toContain("4 verified");
  });
});

describe("Card / Stat / EmptyState", () => {
  it("renders a title and an action", () => {
    render(<Card title="Approved scope" action={<Button>View</Button>}>body</Card>);
    expect(screen.getByText("Approved scope")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders a stat with its caption", () => {
    render(<Stat label="Open findings" value="9" caption="2 high severity" />);
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("2 high severity")).toBeInTheDocument();
  });

  it("empty state offers exactly one action", () => {
    render(<EmptyState title="No assets yet" description="Import a CSV or add one by hand." action={<Button>Add asset</Button>} />);
    expect(screen.getByText("No assets yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/components/primitives/primitives.test.tsx
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the primitives**

```tsx
// customer-ui/src/components/primitives/Button.tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-[var(--accent)] text-white hover:opacity-90",
  secondary: "border border-[var(--border)] text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--canvas)]",
  ghost: "text-[var(--ink-muted)] hover:text-[var(--ink)]",
};

export function Button({
  variant = "primary", disabled, disabledReason, children, className = "", ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; disabledReason?: string; children: ReactNode }) {
  const reasonId = useId();
  return (
    <>
      <button
        {...rest}
        disabled={disabled}
        aria-describedby={disabled && disabledReason ? reasonId : undefined}
        className={`rounded-[var(--radius)] px-3.5 py-2 text-[14px] font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASS[variant]} ${className}`}
      >
        {children}
      </button>
      {disabled && disabledReason ? (
        <span id={reasonId} className="sr-only">{disabledReason}</span>
      ) : null}
    </>
  );
}
```

```tsx
// customer-ui/src/components/primitives/Card.tsx
import type { ReactNode } from "react";

export function Card({ title, action, children, className = "" }: {
  title?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] ${className}`}>
      {title || action ? (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--hairline)]">
          {title ? <h3 className="text-[15px] font-medium">{title}</h3> : <span />}
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
```

```tsx
// customer-ui/src/components/primitives/Badge.tsx
import type { ReactNode } from "react";
import { TONE_CLASS, type Tone } from "../../lib/status";

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 border rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
```

```tsx
// customer-ui/src/components/primitives/StatusChip.tsx
import { TONE_CLASS, glyphFor, stageLabel, toneForStage, type StageState } from "../../lib/status";

export function StatusChip({ state, detail }: { state: StageState; detail?: string }) {
  const tone = toneForStage(state);
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}>
      <span aria-hidden="true">{glyphFor(state)}</span>
      <span>{stageLabel(state)}</span>
      {detail ? <span className="text-[var(--ink-muted)]">· {detail}</span> : null}
    </span>
  );
}
```

```tsx
// customer-ui/src/components/primitives/Stat.tsx
export function Stat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)]">{label}</div>
      <div className="text-[18px] font-semibold mt-1">{value}</div>
      {caption ? <div className="text-[12px] text-[var(--ink-muted)] mt-1">{caption}</div> : null}
    </div>
  );
}
```

```tsx
// customer-ui/src/components/primitives/EmptyState.tsx
import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-[var(--border)] rounded-[var(--radius)] p-8 text-center">
      <h3 className="text-[15px] font-medium">{title}</h3>
      <p className="text-[14px] text-[var(--ink-muted)] mt-2">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
```

```tsx
// customer-ui/src/components/primitives/Toolbar.tsx
import type { ReactNode } from "react";

export function Toolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">
      {children}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}
```

```tsx
// customer-ui/src/components/primitives/Field.tsx
import type { ReactNode } from "react";

export function Field({ label, htmlFor, error, children }: {
  label: string; htmlFor: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)]">{label}</label>
      {children}
      {error ? <p className="text-[12px] text-[var(--fail)]">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/components/primitives/primitives.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/components/primitives
git commit -m "feat(customer-ui): primitive components"
```

---

### Task 6: API client, auth module, query hooks

**Files:**
- Create: `customer-ui/src/lib/api/client.ts`, `customer-ui/src/lib/api/types.ts`, `customer-ui/src/lib/api/queries.ts`, `customer-ui/src/lib/auth/auth.ts`
- Test: `customer-ui/src/lib/api/client.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number }`
  - `apiGet<T>(path: string, signal?: AbortSignal): Promise<T>` — path is relative to `/api/v1`, always `credentials: "include"`
  - Types mirroring the real API: `AssetApi`, `ScanApi`, `FindingApi`, `ReportApi`, `ScopeSetApi`, `ScopeVersionApi`, `AuditEventApi` (field names copied from `portal/prisma/schema.prisma`)
  - Query hooks: `useAssets`, `useScans`, `useReports`, `useScopeSets`, `useScopeVersion`, `useScanFindings`, `useAudit`
  - `auth.ts`: `signInUrl(returnTo: string): string`, `signOutUrl(): string`
- Consumed by: every view model (Task 7) and screen (Tasks 10–14)

- [ ] **Step 1: Confirm the portal's login/logout redirect contract before coding auth**

```bash
sed -n '1,60p' portal/src/app/api/auth/login/route.ts
sed -n '1,60p' portal/src/app/api/auth/logout/route.ts
```
Record in `auth.ts` as a comment: whether `/api/auth/login` accepts a `returnTo` (or similarly named) query parameter, and what `/api/auth/logout` requires (method, and whether it redirects or returns JSON). If `/api/auth/login` takes no return target, `signInUrl` returns `"/api/auth/login"` and the app redirects to `/` after the callback.

- [ ] **Step 2: Write the failing test**

```ts
// customer-ui/src/lib/api/client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet, ApiError } from "./client";

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}), ...response,
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("apiGet", () => {
  it("prefixes /api/v1 and always sends the session cookie", async () => {
    const fetchMock = stubFetch({ json: async () => ({ assets: [] }) });
    await apiGet("/assets");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/assets",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("returns the parsed body", async () => {
    stubFetch({ json: async () => ({ assets: [{ id: "a1" }] }) });
    await expect(apiGet("/assets")).resolves.toEqual({ assets: [{ id: "a1" }] });
  });

  it("throws ApiError with the status for 401 so the caller can route to sign-in", async () => {
    stubFetch({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) });
    await expect(apiGet("/assets")).rejects.toMatchObject(new ApiError("Unauthorized", 401));
  });

  it("never leaks raw server text as the message", async () => {
    stubFetch({ ok: false, status: 500, json: async () => ({ error: "prisma.asset.findMany() failed" }) });
    const err = await apiGet("/assets").catch((e) => e as ApiError);
    expect(err.message).not.toContain("prisma");
    expect(err.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/lib/api/client.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client, types, auth, and query hooks**

```ts
// customer-ui/src/lib/api/client.ts
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const SAFE_MESSAGES: Record<number, string> = {
  400: "That request was rejected. Check the values and try again.",
  401: "Your session has expired. Sign in again to continue.",
  403: "Your role does not allow this action. Ask an organisation owner if you need access.",
  404: "Not found in this organisation.",
  409: "That conflicts with something that already exists.",
  500: "The service could not complete that request. Try again, and contact support if it persists.",
};

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) {
    throw new ApiError(SAFE_MESSAGES[res.status] ?? "That request failed.", res.status);
  }
  return (await res.json()) as T;
}
```

```ts
// customer-ui/src/lib/api/types.ts — field names copied from portal/prisma/schema.prisma
export interface AssetApi {
  id: string; type: string; canonicalIdentifier: string; displayName: string | null;
  owner: string | null; environment: string | null; criticality: string;
  lifecycleState: string; verificationState: string; source: string;
  lastSeenAt: string | null; createdAt: string; updatedAt: string;
}

export interface ScanApi {
  id: string; name: string; status: string;
  startedAt: string; completedAt: string | null; createdAt: string;
  manifestIssuedAt: string | null; manifestExpiresAt: string | null;
  targets?: { id: string; status: string; canonicalIdentifier: string }[];
}

export interface FindingApi {
  id: string; scanId: string; assetId: string; qid: string; cveId: string | null;
  severity: string; pciSeverity: string | null; title: string;
  description: string | null; status: string;
}

export interface AttestationApi { id: string; status: string; reason: string | null; reviewedAt: string | null }

export interface ReportApi {
  id: string; scanId: string; status: string; scopeVersionId: string | null;
  attestationId: string | null; attestation: AttestationApi | null;
  summary: { hosts: number; vulnerabilities: number; averageRisk: number; bySeverity: Record<string, number>; compliance: string } | null;
  createdAt: string; updatedAt: string;
}

export interface ScopeVersionApi {
  id: string; scopeSetId: string; versionNumber: number; status: string;
  contentHash: string | null; submittedAt: string | null; approvedAt: string | null;
  items?: { id: string; type: string; canonicalIdentifier: string }[];
}

export interface ScopeSetApi { id: string; name: string; description: string | null; createdAt: string }

export interface AuditEventApi { id: string; action: string; entity: string; entityId: string | null; createdAt: string }
```

```ts
// customer-ui/src/lib/auth/auth.ts
/**
 * Only module that knows the session topology (spec §7): same-origin behind a
 * reverse proxy, reusing the portal's Keycloak code flow. Changing to Bearer
 * tokens later touches this file and apiGet's headers — nothing else.
 *
 * Verified against portal/src/app/api/auth/{login,logout}/route.ts (Task 6 Step 1).
 */
export function signInUrl(returnTo = "/"): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function signOutUrl(): string {
  return "/api/auth/logout";
}
```

```ts
// customer-ui/src/lib/api/queries.ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGet, ApiError } from "./client";
import type { AssetApi, AuditEventApi, FindingApi, ReportApi, ScanApi, ScopeSetApi, ScopeVersionApi } from "./types";

export const keys = {
  assets: ["assets"] as const,
  scans: ["scans"] as const,
  reports: ["reports"] as const,
  scopeSets: ["scope-sets"] as const,
  scopeVersion: (id: string) => ["scope-version", id] as const,
  findings: (scanId: string) => ["findings", scanId] as const,
  audit: ["audit"] as const,
};

export const useAssets = (): UseQueryResult<AssetApi[]> =>
  useQuery({ queryKey: keys.assets, queryFn: async () => (await apiGet<{ assets: AssetApi[] }>("/assets")).assets });

export const useScans = (): UseQueryResult<ScanApi[]> =>
  useQuery({ queryKey: keys.scans, queryFn: async () => (await apiGet<{ scans: ScanApi[] }>("/scans")).scans });

export const useReports = (): UseQueryResult<ReportApi[]> =>
  useQuery({ queryKey: keys.reports, queryFn: async () => (await apiGet<{ reports: ReportApi[] }>("/reports")).reports });

export const useScopeSets = (): UseQueryResult<ScopeSetApi[]> =>
  useQuery({ queryKey: keys.scopeSets, queryFn: async () => (await apiGet<{ scopeSets: ScopeSetApi[] }>("/scope-sets")).scopeSets });

export const useScopeVersion = (id: string | null): UseQueryResult<ScopeVersionApi> =>
  useQuery({
    queryKey: keys.scopeVersion(id ?? "none"),
    enabled: Boolean(id),
    queryFn: () => apiGet<ScopeVersionApi>(`/scope-versions/${id}`),
  });

export const useScanFindings = (scanId: string | null): UseQueryResult<FindingApi[]> =>
  useQuery({
    queryKey: keys.findings(scanId ?? "none"),
    enabled: Boolean(scanId),
    queryFn: async () => (await apiGet<{ findings: FindingApi[] }>(`/scans/${scanId}/findings`)).findings,
  });

export const useAudit = (): UseQueryResult<AuditEventApi[]> =>
  useQuery({ queryKey: keys.audit, queryFn: async () => (await apiGet<{ events: AuditEventApi[] }>("/audit")).events });

export { ApiError };
```

**Note on `useScopeVersion`:** confirm the shape of `GET /api/v1/scope-versions/[versionId]` before relying on it — if no such route exists, add the read to the reports-scope path or extend `GET /api/v1/reports` to include each report's scope version status (which is the smaller change and keeps the client to one call).

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/lib/api/client.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/lib/api customer-ui/src/lib/auth
git commit -m "feat(customer-ui): api client, domain types, auth module, query hooks"
```

---

### Task 7: View models — the domain logic, pure and tested

Every screen renders a view model, never API JSON. This is where the compliance rules live, so it is the most heavily tested part of the app.

**Files:**
- Create: `customer-ui/src/lib/viewmodels/gate.ts`, `stages.ts`, `tasks.ts`
- Test: `customer-ui/src/lib/viewmodels/{gate,stages,tasks}.test.ts`

**Interfaces:**
- Produces:
  - `reportGate(input: GateInput): GateView` with `GateView = { isFinal, conditions: GateCondition[], sentence, blockReason, canDownload }` and `GateCondition = { key: "attestation" | "scope", label, met, evidence }`
  - `stageRows(input: StageInput): StageRow[]` with `StageRow = { key: StageKey, index, label, href, state: StageState, detail }`, `StageKey = "assets" | "scope" | "scans" | "reports"`
  - `quarterTasks(input: TaskInput): TaskView[]` and `quarterInfo(now: Date): { label, endsAt, daysRemaining }`
- Consumes: `status.ts` types (Task 4), `api/types.ts` (Task 6)

- [ ] **Step 1: Write the failing tests**

```ts
// customer-ui/src/lib/viewmodels/gate.test.ts
import { describe, it, expect } from "vitest";
import { reportGate } from "./gate";

const base = {
  status: "attested", scopeVersionId: "v4", approvedScopeVersionId: "v4",
  attestationStatus: "attested", scopeLabel: "v4", attestedAt: "2026-09-03",
};

describe("reportGate", () => {
  it("is final only when attested AND backed by the approved scope version", () => {
    expect(reportGate(base).isFinal).toBe(true);
    expect(reportGate({ ...base, approvedScopeVersionId: "v5" }).isFinal).toBe(false);
    expect(reportGate({ ...base, status: "submitted" }).isFinal).toBe(false);
    expect(reportGate({ ...base, scopeVersionId: null, approvedScopeVersionId: null }).isFinal).toBe(false);
  });

  it("names the missing condition rather than just saying not final", () => {
    const g = reportGate({ ...base, status: "submitted", attestationStatus: "submitted" });
    expect(g.blockReason).toBe("Attestation pending");
    expect(g.conditions.find((c) => c.key === "attestation")!.met).toBe(false);
    expect(g.conditions.find((c) => c.key === "scope")!.met).toBe(true);
  });

  it("explains a missing approved scope in its own words", () => {
    const g = reportGate({ ...base, scopeVersionId: null, approvedScopeVersionId: null });
    expect(g.blockReason).toBe("No approved scope version backs this report");
  });

  it("allows download only when final", () => {
    expect(reportGate(base).canDownload).toBe(true);
    expect(reportGate({ ...base, status: "draft" }).canDownload).toBe(false);
  });

  it("states the gate position in one sentence, with evidence", () => {
    expect(reportGate(base).sentence).toContain("Attested");
    expect(reportGate(base).conditions[1].evidence).toBe("v4");
  });
});
```

```ts
// customer-ui/src/lib/viewmodels/stages.test.ts
import { describe, it, expect } from "vitest";
import { stageRows } from "./stages";

const asset = (over = {}) => ({ id: "a", type: "fqdn", canonicalIdentifier: "shop.example.com", displayName: null, owner: null, environment: null, criticality: "medium", lifecycleState: "active", verificationState: "verified", source: "manual", lastSeenAt: null, createdAt: "", updatedAt: "", ...over });
const scan = (over = {}) => ({ id: "s", name: "Q3", status: "COMPLETED", startedAt: "", completedAt: null, createdAt: "", manifestIssuedAt: null, manifestExpiresAt: null, ...over });
const report = (over = {}) => ({ id: "r", scanId: "s", status: "draft", scopeVersionId: null, attestationId: null, attestation: null, summary: null, createdAt: "", updatedAt: "", ...over });

describe("stageRows", () => {
  it("marks everything pending for an empty organisation", () => {
    const rows = stageRows({ assets: [], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [] });
    expect(rows.map((r) => r.state)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("marks assets active while any are unverified", () => {
    const rows = stageRows({ assets: [asset({ verificationState: "unverified" })], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [] });
    expect(rows[0].state).toBe("active");
    expect(rows[0].detail).toContain("1");
  });

  it("completes assets and scope when verification and approval exist", () => {
    const rows = stageRows({
      assets: [asset()],
      approved: { id: "v4", scopeSetId: "set", versionNumber: 4, status: "approved", contentHash: null, submittedAt: null, approvedAt: "2026-08-02", items: [] },
      hasDraftScope: false, scans: [], reports: [], finalReportIds: [],
    });
    expect(rows[0].state).toBe("complete");
    expect(rows[1].state).toBe("complete");
    expect(rows[1].detail).toContain("v4");
  });

  it("marks scans active while a scan is running and reports active until a report is final", () => {
    const rows = stageRows({
      assets: [asset()],
      approved: { id: "v4", scopeSetId: "set", versionNumber: 4, status: "approved", contentHash: null, submittedAt: null, approvedAt: null, items: [] },
      hasDraftScope: false,
      scans: [scan({ status: "RUNNING" }), scan()],
      reports: [report({ status: "submitted" })],
      finalReportIds: [],
    });
    expect(rows[2].state).toBe("active");
    expect(rows[3].state).toBe("active");
    expect(rows[3].detail).toContain("attestation");
  });

  it("completes reports when one is final", () => {
    const rows = stageRows({
      assets: [asset()],
      approved: { id: "v4", scopeSetId: "set", versionNumber: 4, status: "approved", contentHash: null, submittedAt: null, approvedAt: null, items: [] },
      hasDraftScope: false, scans: [scan()],
      reports: [report({ status: "attested" })], finalReportIds: ["r"],
    });
    expect(rows[3].state).toBe("complete");
  });
});
```

```ts
// customer-ui/src/lib/viewmodels/tasks.test.ts
import { describe, it, expect } from "vitest";
import { quarterInfo, quarterTasks } from "./tasks";

describe("quarterInfo", () => {
  it("labels the quarter and counts down to its end", () => {
    const q = quarterInfo(new Date("2026-09-12T00:00:00Z"));
    expect(q.label).toBe("Q3 2026");
    expect(q.endsAt.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(q.daysRemaining).toBe(18);
  });
});

describe("quarterTasks", () => {
  it("returns the five lifecycle steps in order, with exactly one current", () => {
    const tasks = quarterTasks({ assets: [], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [], now: new Date("2026-09-12T00:00:00Z") });
    expect(tasks.map((t) => t.index)).toEqual([1, 2, 3, 4, 5]);
    expect(tasks.filter((t) => t.current)).toHaveLength(1);
    expect(tasks[0].current).toBe(true);
    expect(tasks[0].state).toBe("pending");
    expect(tasks[1].state).toBe("pending");
  });

  it("locks later steps instead of hiding them, and strikes completed ones", () => {
    const tasks = quarterTasks({
      assets: [{ id: "a", type: "fqdn", canonicalIdentifier: "shop.example.com", displayName: null, owner: null, environment: null, criticality: "medium", lifecycleState: "active", verificationState: "verified", source: "manual", lastSeenAt: null, createdAt: "", updatedAt: "" }],
      approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [],
      now: new Date("2026-09-12T00:00:00Z"),
    });
    expect(tasks[0].state).toBe("complete");
    expect(tasks[1].state).not.toBe("complete");
    expect(tasks[4].state).toBe("pending");
    expect(tasks[4].title).toContain("report");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd customer-ui && npx vitest run src/lib/viewmodels
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the view models**

```ts
// customer-ui/src/lib/viewmodels/gate.ts
export interface GateInput {
  status: string;
  scopeVersionId: string | null;
  approvedScopeVersionId: string | null;
  attestationStatus: string | null;
  scopeLabel: string | null;
  attestedAt: string | null;
}

export interface GateCondition { key: "attestation" | "scope"; label: string; met: boolean; evidence: string | null }

export interface GateView {
  isFinal: boolean;
  conditions: GateCondition[];
  sentence: string;
  blockReason: string | null;
  canDownload: boolean;
}

/**
 * Mirrors the service rule in portal/src/lib/scan/report.ts (isReportFinal):
 * final == attested AND a recorded scope version that is the approved one.
 * The UI must never invent a weaker version of this test.
 */
export function reportGate(input: GateInput): GateView {
  const attestationMet = input.status === "attested";
  const scopeMet = Boolean(input.scopeVersionId) && input.scopeVersionId === input.approvedScopeVersionId;
  const isFinal = attestationMet && scopeMet;

  const conditions: GateCondition[] = [
    {
      key: "attestation",
      label: "QA attestation",
      met: attestationMet,
      evidence: attestationMet ? (input.attestedAt ? `attested ${input.attestedAt}` : "attested") : input.attestationStatus === "submitted" ? "pending review" : "not submitted",
    },
    {
      key: "scope",
      label: "Scope version approved",
      met: scopeMet,
      evidence: scopeMet ? input.scopeLabel : input.scopeVersionId ? `${input.scopeLabel ?? "recorded version"} not approved` : "no version recorded",
    },
  ];

  let blockReason: string | null = null;
  if (!scopeMet) blockReason = "No approved scope version backs this report";
  else if (!attestationMet) blockReason = "Attestation pending";

  const sentence = isFinal
    ? `Attested${input.attestedAt ? ` on ${input.attestedAt}` : ""} against approved scope ${input.scopeLabel ?? ""}.`.replace("  ", " ")
    : `${conditions.filter((c) => c.met).length} of 2 conditions met — ${blockReason}. The report stays in draft until both are met.`;

  return { isFinal, conditions, sentence, blockReason, canDownload: isFinal };
}
```

```ts
// customer-ui/src/lib/viewmodels/stages.ts
import type { StageState } from "../status";
import type { AssetApi, ReportApi, ScanApi, ScopeVersionApi } from "../api/types";

export type StageKey = "assets" | "scope" | "scans" | "reports";
export interface StageRow { key: StageKey; index: number; label: string; href: string; state: StageState; detail: string }

export interface StageInput {
  assets: AssetApi[];
  approved: ScopeVersionApi | null;
  hasDraftScope: boolean;
  scans: ScanApi[];
  reports: ReportApi[];
  finalReportIds: string[];
}

export function stageRows(input: StageInput): StageRow[] {
  const active = input.assets.filter((a) => a.lifecycleState !== "retired");
  const verified = active.filter((a) => a.verificationState === "verified");
  const running = input.scans.filter((s) => s.status.toUpperCase() === "RUNNING");
  const finals = input.reports.filter((r) => input.finalReportIds.includes(r.id));

  const assetsState: StageState = active.length === 0 ? "pending" : verified.length === active.length ? "complete" : "active";
  const scopeState: StageState = input.approved ? "complete" : input.hasDraftScope ? "active" : "pending";
  const scansState: StageState = running.length > 0 ? "active" : input.scans.length === 0 ? "pending" : "complete";
  const reportsState: StageState = finals.length > 0 ? "complete" : input.reports.length === 0 ? "pending" : "active";

  return [
    { key: "assets", index: 1, label: "Assets", href: "/assets", state: assetsState,
      detail: active.length === 0 ? "none yet" : `${verified.length} of ${active.length} verified` },
    { key: "scope", index: 2, label: "Scope", href: "/scope", state: scopeState,
      detail: input.approved ? `v${input.approved.versionNumber} approved` : input.hasDraftScope ? "draft in progress" : "not created" },
    { key: "scans", index: 3, label: "Scans", href: "/scans", state: scansState,
      detail: running.length > 0 ? `${running.length} running` : input.scans.length === 0 ? "none yet" : `${input.scans.length} this quarter` },
    { key: "reports", index: 4, label: "Reports", href: "/reports", state: reportsState,
      detail: finals.length > 0 ? `${finals.length} final` : input.reports.length > 0 ? "needs attestation" : "none yet" },
  ];
}
```

```ts
// customer-ui/src/lib/viewmodels/tasks.ts
import type { StageState } from "../status";
import type { AssetApi, ReportApi, ScanApi, ScopeVersionApi } from "../api/types";

export interface QuarterInfo { label: string; endsAt: Date; daysRemaining: number }

export function quarterInfo(now: Date): QuarterInfo {
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 0, 23, 59, 59));
  const daysRemaining = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
  return { label: `Q${q} ${now.getUTCFullYear()}`, endsAt, daysRemaining };
}

export interface TaskView {
  id: string; index: number; title: string; meta: string;
  dueLabel: string | null; state: StageState; href: string;
  actionLabel: string | null; current: boolean;
}

export interface TaskInput {
  assets: AssetApi[]; approved: ScopeVersionApi | null; hasDraftScope: boolean;
  scans: ScanApi[]; reports: ReportApi[]; finalReportIds: string[]; now: Date;
}

export function quarterTasks(input: TaskInput): TaskView[] {
  const active = input.assets.filter((a) => a.lifecycleState !== "retired");
  const verified = active.filter((a) => a.verificationState === "verified").length;
  const running = input.scans.filter((s) => s.status.toUpperCase() === "RUNNING").length;
  const finals = input.reports.filter((r) => input.finalReportIds.includes(r.id)).length;
  const { daysRemaining } = quarterInfo(input.now);
  const due = `${daysRemaining} days left`;

  const steps: Omit<TaskView, "current">[] = [
    {
      id: "assets", index: 1, title: "Confirm your asset inventory",
      meta: active.length === 0 ? "Nothing to scan yet" : `${verified} of ${active.length} verified`,
      dueLabel: null, href: "/assets",
      state: active.length === 0 ? "pending" : verified === active.length ? "complete" : "active",
      actionLabel: active.length === 0 ? "Add your first asset" : verified === active.length ? null : "Verify assets",
    },
    {
      id: "scope", index: 2, title: "Get your scope approved",
      meta: input.approved ? `v${input.approved.versionNumber} approved` : input.hasDraftScope ? "Draft awaiting submission" : "No scope yet",
      dueLabel: null, href: "/scope",
      state: input.approved ? "complete" : input.hasDraftScope ? "active" : "pending",
      actionLabel: input.approved ? null : "Build scope",
    },
    {
      id: "scans", index: 3, title: "Run this quarter's scans",
      meta: running > 0 ? `${running} running now` : input.scans.length > 0 ? `${input.scans.length} run this quarter` : "No scans yet",
      dueLabel: due, href: "/scans",
      state: running > 0 ? "active" : input.scans.length === 0 ? "pending" : "complete",
      actionLabel: running > 0 ? null : "Start a scan",
    },
    {
      id: "findings", index: 4, title: "Review findings and dispute anything wrong",
      meta: input.scans.length === 0 ? "Available once a scan completes" : "Open findings are listed per scan",
      dueLabel: null, href: "/reports",
      state: input.scans.length === 0 ? "pending" : "active",
      actionLabel: input.scans.length === 0 ? null : "Review findings",
    },
    {
      id: "reports", index: 5, title: "Finalise this quarter's report",
      meta: finals > 0 ? `${finals} final` : input.reports.length > 0 ? "Attestation pending" : "No report generated yet",
      dueLabel: due, href: "/reports",
      state: finals > 0 ? "complete" : input.reports.length > 0 ? "active" : "pending",
      actionLabel: finals > 0 ? null : "Open reports",
    },
  ];

  const firstUnfinished = steps.find((s) => s.state !== "complete")?.id;
  return steps.map((s) => ({ ...s, current: s.id === firstUnfinished }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd customer-ui && npx vitest run src/lib/viewmodels
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/lib/viewmodels
git commit -m "feat(customer-ui): view models for stages, quarter tasks and the report gate"
```

---

### Task 8: App shell — lifecycle nav, context bar, stepper, route table

**Files:**
- Create: `customer-ui/src/routes.tsx`, `customer-ui/src/components/shell/{LifecycleNav,ContextBar,StageProgress,Skeleton}.tsx`, `customer-ui/src/components/shell/states.tsx`, `customer-ui/src/screens/Placeholder.tsx`
- Modify: `customer-ui/src/App.tsx`
- Test: `customer-ui/src/components/shell/shell.test.tsx`

**Interfaces:**
- Produces:
  - `<AppShell stages={StageRow[]} orgName={string} quarter={string} daysRemaining={number} stageAction?={ReactNode}>{children}</AppShell>` (exported from `App.tsx`) — renders nav + context bar + content
  - `<LifecycleNav stages={StageRow[]} />` — Manage group links to `/team /access /audit /settings`
  - `<ContextBar orgName quarter daysRemaining action? />`
  - `<StageProgress steps: { label: string; state: StageState }[] />`
  - `<Skeleton lines={number} />`, `<ErrorState message onRetry />`, `<PartialState message onRetry />`, `<PermissionState permission />`
  - `export const routes: { path: string; element: ReactNode }[]` in `routes.tsx` — single list consumed by both the router and the nav (the nav must never invent a path)

- [ ] **Step 1: Write the failing test**

```tsx
// customer-ui/src/components/shell/shell.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LifecycleNav } from "./LifecycleNav";
import { StageProgress } from "./StageProgress";
import { ContextBar } from "./ContextBar";
import { stageRows } from "../../lib/viewmodels/stages";

const stages = stageRows({ assets: [], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [] });

const renderInRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("LifecycleNav", () => {
  it("numbers the four stages and shows each one's state word", () => {
    renderInRouter(<LifecycleNav stages={stages} />);
    expect(screen.getByRole("navigation", { name: /scan cycle/i })).toBeInTheDocument();
    for (const label of ["Assets", "Scope", "Scans", "Reports"]) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Not started/)).toHaveLength(4);
  });

  it("links the Manage group to the second-pass destinations", () => {
    renderInRouter(<LifecycleNav stages={stages} />);
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("href", "/team");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});

describe("StageProgress", () => {
  it("marks each step as filled, current or hollow", () => {
    renderInRouter(<StageProgress steps={[{ label: "Scan", state: "complete" }, { label: "Findings", state: "complete" }, { label: "Attested", state: "active" }, { label: "Final", state: "pending" }]} />);
    expect(screen.getByTestId("step-Attested")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("step-Final")).toHaveAttribute("data-state", "pending");
  });
});

describe("ContextBar", () => {
  it("warns once the window is inside 14 days", () => {
    renderInRouter(<ContextBar orgName="Northwind Retail" quarter="Q3 2026" daysRemaining={12} />);
    const countdown = screen.getByText(/12 days/);
    expect(countdown.className).toContain("tone-warn");
  });

  it("stays neutral outside the warning window", () => {
    renderInRouter(<ContextBar orgName="Northwind Retail" quarter="Q3 2026" daysRemaining={40} />);
    expect(screen.getByText(/40 days/).className).not.toContain("tone-warn");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/components/shell
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the shell**

```tsx
// customer-ui/src/components/shell/LifecycleNav.tsx
import { Link, useLocation } from "react-router-dom";
import { TONE_CLASS, glyphFor, stageLabel, toneForStage } from "../../lib/status";
import type { StageRow } from "../../lib/viewmodels/stages";

const MANAGE = [
  { name: "Team", href: "/team" },
  { name: "Access", href: "/access" },
  { name: "Audit", href: "/audit" },
  { name: "Settings", href: "/settings" },
];

export function LifecycleNav({ stages }: { stages: StageRow[] }) {
  const { pathname } = useLocation();
  return (
    <aside className="hidden min-[900px]:block w-60 shrink-0 bg-[var(--surface)] border-r border-[var(--border)]">
      <div className="px-4 py-4 border-b border-[var(--hairline)]">
        <div className="text-[14px] font-semibold">T3MP3ST</div>
        <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">Payment security portal</div>
      </div>
      <nav aria-label="Scan cycle" className="px-2 py-3">
        {stages.map((s) => {
          const selected = pathname === s.href;
          return (
            <Link
              key={s.key}
              to={s.href}
              aria-current={selected ? "page" : undefined}
              className={`flex items-start gap-2.5 rounded-[var(--radius)] px-2.5 py-2 ${selected ? "bg-[var(--accent-weak)]" : "hover:bg-[var(--canvas)]"}`}
            >
              <span aria-hidden="true" className={`mt-0.5 text-[11px] ${TONE_CLASS[toneForStage(s.state)]} border rounded-[var(--radius-sm)] px-1`}>
                {glyphFor(s.state)}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{s.index} · {s.label}</span>
                <span className="block text-[11px] text-[var(--ink-muted)] truncate">{stageLabel(s.state)} · {s.detail}</span>
              </span>
            </Link>
          );
        })}
        <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)] px-2.5 pt-4 pb-1">Manage</div>
        {MANAGE.map((m) => (
          <Link key={m.href} to={m.href} className="block rounded-[var(--radius)] px-2.5 py-1.5 text-[13px] text-[var(--ink-muted)] hover:bg-[var(--canvas)]">
            {m.name}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

```tsx
// customer-ui/src/components/shell/ContextBar.tsx
import type { ReactNode } from "react";
import { TONE_CLASS } from "../../lib/status";

export function ContextBar({ orgName, quarter, daysRemaining, action }: {
  orgName: string; quarter: string; daysRemaining: number; action?: ReactNode;
}) {
  const urgent = daysRemaining <= 14;
  return (
    <header className="flex items-center gap-4 flex-wrap px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold truncate">{orgName}</div>
        <div className="text-[12px] text-[var(--ink-muted)]">{quarter} · PCI ASV scan window</div>
      </div>
      <div className={`border rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium ${urgent ? TONE_CLASS.warn : TONE_CLASS.idle}`}>
        {daysRemaining} days left
      </div>
      {action ? <div className="ml-auto">{action}</div> : null}
    </header>
  );
}
```

```tsx
// customer-ui/src/components/shell/StageProgress.tsx
import { TONE_CLASS, glyphFor, toneForStage, type StageState } from "../../lib/status";

export function StageProgress({ steps }: { steps: { label: string; state: StageState }[] }) {
  return (
    <ol className="flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span
            data-testid={`step-${s.label}`}
            data-state={s.state}
            className={`inline-flex items-center gap-1.5 border rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium ${TONE_CLASS[toneForStage(s.state)]}`}
          >
            <span aria-hidden="true">{glyphFor(s.state)}</span>
            {s.label}
          </span>
          {i < steps.length - 1 ? <span aria-hidden="true" className="text-[var(--ink-subtle)]">→</span> : null}
        </li>
      ))}
    </ol>
  );
}
```

```tsx
// customer-ui/src/components/shell/Skeleton.tsx
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded-[var(--radius-sm)] bg-[var(--hairline)]" />
      ))}
    </div>
  );
}
```

```tsx
// customer-ui/src/components/shell/states.tsx
import { Button } from "../primitives/Button";

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="border border-[var(--fail-border)] bg-[var(--fail-bg)] text-[var(--fail)] rounded-[var(--radius)] p-4">
      <p className="text-[14px]">{message}</p>
      {onRetry ? <div className="mt-3"><Button variant="secondary" onClick={onRetry}>Try again</Button></div> : null}
      <p className="text-[12px] mt-2">Reference: check the portal logs with this screen name and the time shown.</p>
    </div>
  );
}

export function PartialState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] p-4 text-[var(--ink-muted)]">
      <p className="text-[14px]">{message}</p>
      {onRetry ? <div className="mt-3"><Button variant="secondary" onClick={onRetry}>Retry</Button></div> : null}
    </div>
  );
}

export function PermissionState({ permission }: { permission: string }) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] p-6">
      <h2 className="text-[15px] font-medium">You don’t have access to this screen</h2>
      <p className="text-[14px] text-[var(--ink-muted)] mt-2">
        It needs the <code className="text-[12px]">{permission}</code> permission. Ask an organisation owner to grant it.
      </p>
    </div>
  );
}
```

```tsx
// customer-ui/src/screens/Placeholder.tsx
export function Placeholder({ title, pass }: { title: string; pass: string }) {
  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <h1 className="text-[18px] font-semibold">{title}</h1>
      <p className="text-[14px] text-[var(--ink-muted)] mt-2">
        This screen is not built yet — it is scheduled for the {pass} of the customer UI.
      </p>
    </div>
  );
}
```

```tsx
// customer-ui/src/routes.tsx
import { Home } from "./screens/Home";
import { Assets } from "./screens/Assets";
import { Scope } from "./screens/Scope";
import { Scans } from "./screens/Scans";
import { Reports } from "./screens/Reports";
import { ReportDetail } from "./screens/ReportDetail";
import { SignInLanding } from "./screens/SignInLanding";
import { Placeholder } from "./screens/Placeholder";

export const routes = [
  { path: "/sign-in", element: <SignInLanding />, chrome: false },
  { path: "/", element: <Home />, chrome: true },
  { path: "/assets", element: <Assets />, chrome: true },
  { path: "/scope", element: <Scope />, chrome: true },
  { path: "/scans", element: <Scans />, chrome: true },
  { path: "/reports", element: <Reports />, chrome: true },
  { path: "/reports/:reportId", element: <ReportDetail />, chrome: true },
  { path: "/team", element: <Placeholder title="Team" pass="second pass" />, chrome: true },
  { path: "/access", element: <Placeholder title="Access" pass="second pass" />, chrome: true },
  { path: "/audit", element: <Placeholder title="Audit" pass="second pass" />, chrome: true },
  { path: "/settings", element: <Placeholder title="Settings" pass="second pass" />, chrome: true },
];
```

`App.tsx` renders the chrome-less routes on their own, and everything else inside `AppShell`. `AppShell` computes `orgName`, `quarter` and `daysRemaining` from the org query and `quarterInfo(new Date())`; it renders `<Skeleton />` in the org slot while the org query is loading and never blocks the shell on it.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/components/shell
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/components/shell customer-ui/src/routes.tsx customer-ui/src/screens/Placeholder.tsx customer-ui/src/App.tsx
git commit -m "feat(customer-ui): app shell with lifecycle nav, context bar and route table"
```

---

### Task 9: Sign-in landing

**Files:**
- Create: `customer-ui/src/screens/SignInLanding.tsx`
- Test: `customer-ui/src/screens/SignInLanding.test.tsx`

**Interfaces:**
- Consumes: `signInUrl` (Task 6)
- Produces: `<SignInLanding reason?="expired" | "signed-out" />` — reads `?reason=` from the URL; renders no credentials form (the portal's Keycloak flow owns that)

- [ ] **Step 1: Write the failing test**

```tsx
// customer-ui/src/screens/SignInLanding.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SignInLanding } from "./SignInLanding";

const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><SignInLanding /></MemoryRouter>);

describe("SignInLanding", () => {
  it("offers exactly one action: continue with Keycloak", () => {
    renderAt("/sign-in");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/api/auth/login?returnTo=%2F");
  });

  it("has no password field", () => {
    renderAt("/sign-in");
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("explains an expired session instead of showing a raw 401", () => {
    renderAt("/sign-in?reason=expired");
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });

  it("explains a signed-out state plainly", () => {
    renderAt("/sign-in?reason=signed-out");
    expect(screen.getByText(/signed out/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/screens/SignInLanding.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the screen**

```tsx
// customer-ui/src/screens/SignInLanding.tsx
import { useSearchParams } from "react-router-dom";
import { signInUrl } from "../lib/auth/auth";

const REASON: Record<string, string> = {
  expired: "Your session has expired. Sign in again to continue where you left off.",
  "signed-out": "You have signed out. Sign in to get back to your compliance dashboard.",
};

export function SignInLanding() {
  const [params] = useSearchParams();
  const reason = params.get("reason") ?? "";
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-[420px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] p-8">
        <div className="text-[18px] font-semibold">T3MP3ST</div>
        <p className="text-[14px] text-[var(--ink-muted)] mt-2">
          Track your quarterly PCI ASV scans, scope approvals and compliance reports in one place.
        </p>
        {REASON[reason] ? (
          <p className="text-[13px] mt-4 border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--ink-muted)]">
            {REASON[reason]}
          </p>
        ) : null}
        <a
          href={signInUrl("/")}
          className="mt-6 inline-flex w-full items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2.5"
        >
          Continue with Keycloak
        </a>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/screens/SignInLanding.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/screens/SignInLanding.tsx customer-ui/src/screens/SignInLanding.test.tsx
git commit -m "feat(customer-ui): sign-in landing that hands off to the portal's Keycloak flow"
```

---

### Task 10: Home — the quarter checklist

**Files:**
- Create: `customer-ui/src/screens/Home.tsx`, `customer-ui/src/components/shell/TaskRow.tsx`
- Test: `customer-ui/src/screens/Home.test.tsx`

**Interfaces:**
- Consumes: `useAssets`, `useScans`, `useReports`, `useScopeSets` (Task 6); `quarterTasks`, `quarterInfo` (Task 7); `reportGate` for the final-report set
- Produces: `<Home />` rendering the progress bar, five `TaskRow`s, and the three `Stat`s; `<TaskRow task={TaskView} />`

- [ ] **Step 1: Write the failing test**

Mock the four query hooks with `vi.mock("@/lib/api/queries")`-style module mocking (path-relative in this app: `../../lib/api/queries`).

```tsx
// customer-ui/src/screens/Home.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/api/queries", () => ({
  useAssets: vi.fn(), useScans: vi.fn(), useReports: vi.fn(), useScopeSets: vi.fn(),
  useScopeVersion: vi.fn(() => ({ data: null, isLoading: false, error: null })), useAudit: vi.fn(),
}));

import { useAssets, useReports, useScans } from "../lib/api/queries";
import { Home } from "./Home";

const ok = (data: unknown[]) => ({ data, isLoading: false, error: null, refetch: vi.fn() } as never);
const empty = { data: [], isLoading: false, error: null, refetch: vi.fn() } as never;

const setup = (assets: unknown[], scans: unknown[], reports: unknown[]) => {
  vi.mocked(useAssets).mockReturnValue(ok(assets));
  vi.mocked(useScans).mockReturnValue(ok(scans));
  vi.mocked(useReports).mockReturnValue(ok(reports));
};

const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>);

describe("Home", () => {
  it("shows one actionable step and no fabricated numbers for an empty organisation", () => {
    setup([], [], []);
    renderHome();
    expect(screen.getByText(/Confirm your asset inventory/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add your first asset/ })).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).toBeNull();
  });

  it("shows a skeleton while loading rather than an empty checklist", () => {
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue(empty);
    vi.mocked(useReports).mockReturnValue(empty);
    renderHome();
    expect(screen.queryByText(/Confirm your asset inventory/)).toBeNull();
  });

  it("renders an error state with a retry when a query fails", () => {
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue(empty);
    vi.mocked(useReports).mockReturnValue(empty);
    renderHome();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/screens/Home.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TaskRow` and `Home`**

```tsx
// customer-ui/src/components/shell/TaskRow.tsx
import { Link } from "react-router-dom";
import { TONE_CLASS, glyphFor, toneForStage } from "../../lib/status";
import type { TaskView } from "../../lib/viewmodels/tasks";

export function TaskRow({ task }: { task: TaskView }) {
  const tone = toneForStage(task.state);
  const completed = task.state === "complete";
  const locked = task.state === "pending" && !task.current;

  return (
    <li
      data-state={task.state}
      className={`flex items-center gap-3 border rounded-[var(--radius)] px-4 py-3 ${task.current ? "border-[var(--accent-border)]" : "border-[var(--border)]"} ${completed ? "bg-[var(--canvas)]" : ""}`}
    >
      <span aria-hidden="true" className={`border rounded-[var(--radius-sm)] px-1.5 text-[12px] ${TONE_CLASS[tone]}`}>
        {glyphFor(task.state)}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] ${completed ? "line-through text-[var(--ink-muted)]" : "font-medium"}`}>
          {task.index}. {task.title}
        </div>
        <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">
          {task.meta}
          {task.dueLabel ? ` · ${task.dueLabel}` : ""}
        </div>
      </div>
      {task.actionLabel ? (
        locked ? (
          <span className="text-[12px] text-[var(--ink-subtle)] border border-[var(--hairline)] rounded-[var(--radius)] px-3 py-1.5">Locked</span>
        ) : (
          <Link
            to={task.href}
            className={`text-[13px] font-medium rounded-[var(--radius)] px-3 py-1.5 ${task.current ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
          >
            {task.actionLabel}
          </Link>
        )
      ) : null}
    </li>
  );
}
```

```tsx
// customer-ui/src/screens/Home.tsx
import { useAssets, useReports, useScans, useScopeSets } from "../lib/api/queries";
import { quarterInfo, quarterTasks } from "../lib/viewmodels/tasks";
import { reportGate } from "../lib/viewmodels/gate";
import { TaskRow } from "../components/shell/TaskRow";
import { Skeleton, } from "../components/shell/Skeleton";
import { ErrorState } from "../components/shell/states";
import { Stat } from "../components/primitives/Stat";

export function Home() {
  const assets = useAssets();
  const scans = useScans();
  const reports = useReports();
  const scopeSets = useScopeSets();

  const loading = assets.isLoading || scans.isLoading || reports.isLoading;
  const failure = assets.error ?? scans.error ?? reports.error;

  if (failure) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <ErrorState message="We couldn’t read your compliance data just now." onRetry={() => { void assets.refetch(); void scans.refetch(); void reports.refetch(); }} />
      </div>
    );
  }

  const quarter = quarterInfo(new Date());
  // A report is final only when the gate says so — one call, one rule.
  const finalReportIds = (reports.data ?? [])
    .filter((r) => reportGate({
      status: r.status,
      scopeVersionId: r.scopeVersionId,
      approvedScopeVersionId: null, // FAIL CLOSED until Task 14 wires the approved-scope lookup
      attestationStatus: r.attestation?.status ?? null,
      scopeLabel: null,
      attestedAt: r.attestation?.reviewedAt ?? null,
    }).isFinal)
    .map((r) => r.id);

  const tasks = quarterTasks({
    assets: assets.data ?? [], approved: null, hasDraftScope: false,
    scans: scans.data ?? [], reports: reports.data ?? [], finalReportIds, now: new Date(),
  });

  const openFindings = (scans.data ?? []).reduce((n, s) => n + (s.targets?.length ?? 0), 0);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[18px] font-semibold">Q{quarter.label.slice(1)} checklist</h1>
        <span className="text-[12px] text-[var(--ink-muted)]">{tasks.filter((t) => t.state === "complete").length} of {tasks.length} done</span>
      </div>

      {loading ? <div className="mt-4"><Skeleton lines={6} /></div> : (
        <ol className="mt-4 space-y-2">{tasks.map((t) => <TaskRow key={t.id} task={t} />)}</ol>
      )}

      <div className="grid grid-cols-3 gap-3 mt-6">
        <Stat label="Assets" value={loading ? "…" : String((assets.data ?? []).filter((a) => a.lifecycleState !== "retired").length)} caption={`${(assets.data ?? []).filter((a) => a.verificationState === "verified").length} verified`} />
        <Stat label="Scans this quarter" value={loading ? "…" : String((scans.data ?? []).length)} caption={`${(scans.data ?? []).filter((s) => s.status === "RUNNING").length} running`} />
        <Stat label="Reports final" value={loading ? "…" : String(finalReportIds.length)} caption={`${(reports.data ?? []).length} generated`} />
      </div>

      <p className="text-[12px] text-[var(--ink-subtle)] mt-4">
        Findings total is unavailable until per-scan findings are loaded on the Scans screen.  {/* openFindings is intentionally not shown as a number */}
      </p>
    </div>
  );
}
```

**Note:** `approvedScopeVersionId: null` here is deliberate and must be `null`, not the report's own `scopeVersionId`. The gate in this app asserts "attested AND backed by the *approved* scope version"; passing the report's own value would make the gate pass whenever a report merely records any version, which is weaker than `isReportFinal` in `portal/src/lib/scan/report.ts` and would show merchants a report as FINAL that the server would not call final. Home therefore shows nothing as final until Task 14 wires the real approved-scope lookup. Fail closed.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/screens/Home.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/screens/Home.tsx customer-ui/src/components/shell/TaskRow.tsx customer-ui/src/screens/Home.test.tsx
git commit -m "feat(customer-ui): home quarter checklist"
```

---

### Task 11: Assets screen

**Files:**
- Create: `customer-ui/src/screens/Assets.tsx`, `customer-ui/src/components/shell/RecordCard.tsx`
- Test: `customer-ui/src/screens/Assets.test.tsx`

**Interfaces:**
- Consumes: `useAssets` (Task 6), `Card`, `Toolbar`, `EmptyState`, `Badge`, `Stat`
- Produces: `<Assets />`; `<RecordCard title subtitle status? meta? actions?>`

- [ ] **Step 1: Write the failing test**

```tsx
// customer-ui/src/screens/Assets.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api/queries", () => ({
  useAssets: vi.fn(), useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useReports: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeSets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeVersion: vi.fn(() => ({ data: null, isLoading: false, error: null })), useAudit: vi.fn(),
}));

import { useAssets } from "../lib/api/queries";
import { Assets } from "./Assets";

const asset = (over = {}) => ({ id: "a1", type: "fqdn", canonicalIdentifier: "shop.example.com", displayName: null, owner: null, environment: null, criticality: "medium", lifecycleState: "active", verificationState: "verified", source: "manual", lastSeenAt: null, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z", ...over });

const renderAssets = () => render(<MemoryRouter><Assets /></MemoryRouter>);

describe("Assets", () => {
  it("offers an import path when there are none", () => {
    vi.mocked(useAssets).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderAssets();
    expect(screen.getByText(/No assets yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Import CSV/i })).toBeInTheDocument();
  });

  it("sorts unverified assets first", () => {
    vi.mocked(useAssets).mockReturnValue({ data: [asset({ id: "v" }), asset({ id: "u", canonicalIdentifier: "api.example.com", verificationState: "unverified" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderAssets();
    const cards = screen.getAllByTestId("record-card");
    expect(cards[0]).toHaveTextContent("api.example.com");
  });

  it("filters by identifier", async () => {
    vi.mocked(useAssets).mockReturnValue({ data: [asset(), asset({ id: "b", canonicalIdentifier: "pay.example.com" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderAssets();
    await userEvent.type(screen.getByRole("searchbox"), "pay");
    expect(screen.getAllByTestId("record-card")).toHaveLength(1);
  });

  it("keeps retired assets visible in their own section", () => {
    vi.mocked(useAssets).mockReturnValue({ data: [asset(), asset({ id: "r", canonicalIdentifier: "old.example.com", lifecycleState: "retired" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderAssets();
    expect(screen.getByText(/Retired/i)).toBeInTheDocument();
    expect(screen.getByText("old.example.com")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/screens/Assets.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement `RecordCard` and `Assets`**

```tsx
// customer-ui/src/components/shell/RecordCard.tsx
import type { ReactNode } from "react";

export function RecordCard({ title, subtitle, status, meta, actions, tone = "idle" }: {
  title: string; subtitle?: string; status?: ReactNode; meta?: ReactNode; actions?: ReactNode; tone?: "idle" | "accent";
}) {
  return (
    <li
      data-testid="record-card"
      className={`border rounded-[var(--radius)] px-4 py-3 ${tone === "accent" ? "border-[var(--accent-border)]" : "border-[var(--border)]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium truncate">{title}</div>
          {subtitle ? <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">{subtitle}</div> : null}
        </div>
        {status}
      </div>
      {meta ? <div className="text-[12px] text-[var(--ink-muted)] mt-2">{meta}</div> : null}
      {actions ? <div className="flex gap-2 mt-3 flex-wrap">{actions}</div> : null}
    </li>
  );
}
```

```tsx
// customer-ui/src/screens/Assets.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAssets } from "../lib/api/queries";
import { Badge } from "../components/primitives/Badge";
import { Button } from "../components/primitives/Button";
import { EmptyState } from "../components/primitives/EmptyState";
import { Toolbar } from "../components/primitives/Toolbar";
import { RecordCard } from "../components/shell/RecordCard";
import { Skeleton } from "../components/shell/Skeleton";
import { ErrorState } from "../components/shell/states";

const VERIFIED = (s: string) => s === "verified";

export function Assets() {
  const { data, isLoading, error, refetch } = useAssets();
  const [query, setQuery] = useState("");

  const { live, retired, unverified } = useMemo(() => {
    const all = (data ?? []).filter((a) => a.canonicalIdentifier.toLowerCase().includes(query.toLowerCase()));
    const liveRows = all.filter((a) => a.lifecycleState !== "retired");
    const sorted = [...liveRows].sort((a, b) => Number(VERIFIED(a.verificationState)) - Number(VERIFIED(b.verificationState)));
    return {
      live: sorted,
      retired: all.filter((a) => a.lifecycleState === "retired"),
      unverified: sorted.filter((a) => !VERIFIED(a.verificationState)).length,
    };
  }, [data, query]);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <h1 className="text-[18px] font-semibold">Assets</h1>
      <p className="text-[14px] text-[var(--ink-muted)] mt-1">
        Everything that may be scanned. Unverified assets cannot be relied on in a report.
      </p>

      <div className="mt-5">
        <Toolbar>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            aria-label="Search assets"
            className="border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-[14px] w-64"
          />
          {unverified > 0 ? <Badge tone="warn">{unverified} unverified</Badge> : null}
        </Toolbar>
        <div className="flex gap-2">
          <Link to="/assets/new" className="rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2">Add asset</Link>
          <Link to="/assets/import" className="rounded-[var(--radius)] border border-[var(--border)] text-[14px] font-medium px-3.5 py-2">Import CSV</Link>
        </div>
      </div>

      <div className="mt-6">
        {error ? <ErrorState message="We couldn’t read your asset inventory." onRetry={() => void refetch()} /> : null}
        {isLoading ? <Skeleton lines={5} /> : null}

        {!isLoading && !error && live.length === 0 && retired.length === 0 ? (
          <EmptyState
            title="No assets yet"
            description="Add the hosts, IPs and directories the acquirer expects you to scan. CSV columns: type, identifier, displayName, owner, environment, criticality."
            action={<Link to="/assets/import" className="rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2">Import CSV</Link>}
          />
        ) : null}

        {live.length > 0 ? (
          <ul className="space-y-2">
            {live.map((a) => (
              <RecordCard
                key={a.id}
                title={a.displayName ?? a.canonicalIdentifier}
                subtitle={`${a.type} · ${a.criticality}`}
                status={<Badge tone={VERIFIED(a.verificationState) ? "pass" : "warn"}>{VERIFIED(a.verificationState) ? "verified" : a.verificationState}</Badge>}
                meta={`${a.canonicalIdentifier}${a.owner ? ` · owner ${a.owner}` : ""}${a.environment ? ` · ${a.environment}` : ""}`}
                actions={<Link to={`/assets/${a.id}`} className="text-[13px] font-medium">Open</Link>}
              />
            ))}
          </ul>
        ) : null}

        {retired.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-[15px] font-medium">Retired</h2>
            <p className="text-[12px] text-[var(--ink-muted)] mt-1">Kept for history — never scanned again.</p>
            <ul className="space-y-2 mt-3">
              {retired.map((a) => (
                <RecordCard key={a.id} title={a.displayName ?? a.canonicalIdentifier} subtitle={`${a.type} · retired`} status={<Badge tone="idle">retired</Badge>} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/screens/Assets.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/screens/Assets.tsx customer-ui/src/components/shell/RecordCard.tsx customer-ui/src/screens/Assets.test.tsx
git commit -m "feat(customer-ui): assets screen with card list, search and retired section"
```

---

### Task 12: Scope screen

**Files:**
- Create: `customer-ui/src/screens/Scope.tsx`, `customer-ui/src/lib/viewmodels/scope.ts`
- Test: `customer-ui/src/lib/viewmodels/scope.test.ts`, `customer-ui/src/screens/Scope.test.tsx`

**Interfaces:**
- Consumes: `useScopeSets`, `useScopeVersion`
- Produces:
  - `scopeView(input: { sets: ScopeSetApi[]; versions: ScopeVersionApi[] }): { inForce: ScopeVersionApi | null; draft: ScopeVersionApi | null; history: ScopeVersionApi[]; labelFor(v: ScopeVersionApi): string }` where `history` is every version that is not in force and not the draft, newest first
  - `<Scope />` rendering the approved-scope hero, the draft banner, and the history list

- [ ] **Step 1: Write the failing tests**

```ts
// customer-ui/src/lib/viewmodels/scope.test.ts
import { describe, it, expect } from "vitest";
import { scopeView } from "./scope";

const v = (over = {}) => ({ id: "v4", scopeSetId: "set1", versionNumber: 4, status: "approved", contentHash: "9f2ca41d", submittedAt: null, approvedAt: null, items: [], ...over });

describe("scopeView", () => {
  it("picks the newest approved version as the one in force", () => {
    const view = scopeView({ sets: [{ id: "set1", name: "Production", description: null, createdAt: "" }], versions: [v({ id: "v3", versionNumber: 3 }), v()] });
    expect(view.inForce?.id).toBe("v4");
    expect(view.labelFor(view.inForce!)).toBe("Production — v4");
  });

  it("surfaces a draft separately from history", () => {
    const view = scopeView({ sets: [], versions: [v(), v({ id: "v5", versionNumber: 5, status: "draft", approvedAt: null })] });
    expect(view.draft?.id).toBe("v5");
    expect(view.history.map((x) => x.id)).toEqual([]);
  });

  it("keeps superseded versions in history, newest first", () => {
    const view = scopeView({ sets: [], versions: [v({ id: "v2", versionNumber: 2 }), v(), v({ id: "v3", versionNumber: 3 })] });
    expect(view.history.map((x) => x.versionNumber)).toEqual([3, 2]);
  });

  it("has nothing in force for an organisation with no approved version", () => {
    expect(scopeView({ sets: [], versions: [v({ status: "draft" })] }).inForce).toBeNull();
  });
});
```

```tsx
// customer-ui/src/screens/Scope.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/api/queries", () => ({
  useScopeSets: vi.fn(), useScopeVersion: vi.fn(() => ({ data: null, isLoading: false, error: null })),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useReports: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAudit: vi.fn(),
}));

import { useScopeSets } from "../lib/api/queries";
import { Scope } from "./Scope";

describe("Scope", () => {
  it("says so plainly when nothing is approved, and does not claim coverage", () => {
    vi.mocked(useScopeSets).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    render(<MemoryRouter><Scope /></MemoryRouter>);
    expect(screen.getByText(/No approved scope/i)).toBeInTheDocument();
    expect(screen.queryByText(/in force/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd customer-ui && npx vitest run src/lib/viewmodels/scope.test.ts src/screens/Scope.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement the view model and the screen**

```ts
// customer-ui/src/lib/viewmodels/scope.ts
import type { ScopeSetApi, ScopeVersionApi } from "../api/types";

export interface ScopeView {
  inForce: ScopeVersionApi | null;
  draft: ScopeVersionApi | null;
  history: ScopeVersionApi[];
  labelFor(v: ScopeVersionApi): string;
}

export function scopeView(input: { sets: ScopeSetApi[]; versions: ScopeVersionApi[] }): ScopeView {
  const nameOf = (setId: string) => input.sets.find((s) => s.id === setId)?.name ?? "Scope";
  const byNewest = [...input.versions].sort((a, b) => b.versionNumber - a.versionNumber);
  const approved = byNewest.filter((v) => v.status === "approved");
  const inForce = approved[0] ?? null;
  const draft = byNewest.find((v) => v.status === "draft" || v.status === "submitted") ?? null;
  const history = byNewest.filter((v) => v !== inForce && v !== draft);
  return { inForce, draft, history, labelFor: (v) => `${nameOf(v.scopeSetId)} — v${v.versionNumber}` };
}
```

`Scope.tsx` renders: the hero (`inForce` → `v{n} · {items.length} assets`, approver date, short fingerprint from `contentHash`, "view assets" and "download authorisation" links, or the plain "No approved scope yet" empty state); the draft banner (`Card` with accent border, the diff line, and a "Submit for approval" primary action) when `draft` exists; and the history list. Every action that a non-`scope.manage` membership cannot perform is hidden in the UI **and** remains guarded server-side — the screen never becomes the authorization decision.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd customer-ui && npx vitest run src/lib/viewmodels/scope.test.ts src/screens/Scope.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/screens/Scope.tsx customer-ui/src/lib/viewmodels/scope.ts customer-ui/src/screens/Scope.test.tsx customer-ui/src/lib/viewmodels/scope.test.ts
git commit -m "feat(customer-ui): scope screen with approved hero and version history"
```

---

### Task 13: Scans screen

**Files:**
- Create: `customer-ui/src/screens/Scans.tsx`
- Test: `customer-ui/src/screens/Scans.test.tsx`

**Interfaces:**
- Consumes: `useScans`, `useScopeSets`; `recordStateFromScan`, `toneForRecord`, `recordLabel` (Task 4)
- Produces: `<Scans />` — card list, newest first, running scans showing a progress line, and a "New scan" primary action that is disabled with a stated reason when no approved scope exists

- [ ] **Step 1: Write the failing test**

```tsx
// customer-ui/src/screens/Scans.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/api/queries", () => ({
  useScans: vi.fn(), useScopeSets: vi.fn(),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useReports: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeVersion: vi.fn(() => ({ data: null, isLoading: false, error: null })), useAudit: vi.fn(),
}));

import { useScans, useScopeSets } from "../lib/api/queries";
import { Scans } from "./Scans";

const scan = (over = {}) => ({ id: "s1", name: "Q3 external", status: "COMPLETED", startedAt: "2026-08-12T09:00:00Z", completedAt: "2026-08-12T09:44:00Z", createdAt: "2026-08-12T09:00:00Z", manifestIssuedAt: null, manifestExpiresAt: null, ...over });

const renderScans = () => render(<MemoryRouter><Scans /></MemoryRouter>);

describe("Scans", () => {
  it("explains why a new scan is not possible instead of silently disabling it", () => {
    vi.mocked(useScans).mockReturnValue({ data: [scan()], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    const btn = screen.getByRole("button", { name: /New scan/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/approved scope is required/i)).toBeInTheDocument();
  });

  it("shows status as a word plus a glyph, not colour alone", () => {
    vi.mocked(useScans).mockReturnValue({ data: [scan({ status: "FAILED" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [{ id: "set1", name: "Production", description: null, createdAt: "" }], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    expect(screen.getByText(/Failed/)).toBeInTheDocument();
  });

  it("marks a running scan as running", () => {
    vi.mocked(useScans).mockReturnValue({ data: [scan({ status: "RUNNING" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [{ id: "set1", name: "Production", description: null, createdAt: "" }], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    expect(screen.getByText(/Running/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd customer-ui && npx vitest run src/screens/Scans.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement the screen**

```tsx
// customer-ui/src/screens/Scans.tsx
import { Link } from "react-router-dom";
import { useScans, useScopeSets } from "../lib/api/queries";
import { Badge } from "../components/primitives/Badge";
import { Button } from "../components/primitives/Button";
import { EmptyState } from "../components/primitives/EmptyState";
import { RecordCard } from "../components/shell/RecordCard";
import { Skeleton } from "../components/shell/Skeleton";
import { ErrorState } from "../components/shell/states";
import { glyphFor, recordLabel, recordStateFromScan, toneForRecord } from "../lib/status";

export function Scans() {
  const scans = useScans();
  const scopeSets = useScopeSets();
  const hasScope = (scopeSets.data ?? []).length > 0;
  const rows = [...(scans.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold">Scans</h1>
          <p className="text-[14px] text-[var(--ink-muted)] mt-1">Every scan this organisation has run, newest first.</p>
        </div>
        <Button disabled={!hasScope} disabledReason="An approved scope is required before you can scan">
          New scan
        </Button>
      </div>
      {!hasScope ? <p className="text-[12px] text-[var(--ink-muted)] mt-2">An approved scope is required before you can scan.</p> : null}

      <div className="mt-6">
        {scans.error ? <ErrorState message="We couldn’t read your scans." onRetry={() => void scans.refetch()} /> : null}
        {scans.isLoading ? <Skeleton lines={5} /> : null}

        {!scans.isLoading && !scans.error && rows.length === 0 ? (
          <EmptyState
            title="No scans yet"
            description="Once your scope is approved you can run a scan against it. Results arrive as findings on the report."
            action={<Link to="/scope" className="rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2">Open scope</Link>}
          />
        ) : null}

        {rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((s) => {
              const state = recordStateFromScan(s.status);
              const targets = s.targets?.length ?? 0;
              return (
                <RecordCard
                  key={s.id}
                  title={s.name}
                  subtitle={`${targets} target${targets === 1 ? "" : "s"} · started ${s.startedAt.slice(0, 10)}`}
                  status={<Badge tone={toneForRecord(state)}><span aria-hidden="true">{state === "running" ? "◐" : state === "failed" ? "●" : "●"}</span> {recordLabel(state)}</Badge>}
                  actions={<Link to={`/reports?scan=${s.id}`} className="text-[13px] font-medium">Findings →</Link>}
                />
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
```

`glyphFor` is imported for the step glyph used elsewhere on this screen; if it ends up unused after wiring, remove the import rather than leaving it.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd customer-ui && npx vitest run src/screens/Scans.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customer-ui/src/screens/Scans.tsx customer-ui/src/screens/Scans.test.tsx
git commit -m "feat(customer-ui): scans screen with card list and blocked-action explanation"
```

---

### Task 14: Reports and report detail with the gate

**Files:**
- Create: `customer-ui/src/screens/Reports.tsx`, `customer-ui/src/screens/ReportDetail.tsx`, `customer-ui/src/components/shell/GateCallout.tsx`
- Modify: `customer-ui/src/screens/Home.tsx` (replace the Task 10 shortcut with the real approved-scope lookup)
- Test: `customer-ui/src/screens/Reports.test.tsx`, `customer-ui/src/components/shell/GateCallout.test.tsx`

**Interfaces:**
- Consumes: `useReports`, `useScans`, `useScanFindings`, `reportGate` (Task 7), `StageProgress` (Task 8)
- Produces:
  - `<GateCallout gate={GateView} />` — renders all conditions as rows with their evidence, the one-sentence position, and the download action gated by `gate.canDownload`
  - `<Reports />` — report cards with the stepper header and the callout
  - `<ReportDetail />` — same callout, findings grouped by severity with a dispute entry point
  - `useApprovedScopeVersionId()` — added to `queries.ts`; the single place the "approved scope version" is derived, consumed by Home, Reports and ReportDetail

- [ ] **Step 1: Write the failing tests**

```tsx
// customer-ui/src/components/shell/GateCallout.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GateCallout } from "./GateCallout";
import { reportGate } from "../../lib/viewmodels/gate";

describe("GateCallout", () => {
  it("shows both conditions with their evidence when final", () => {
    const gate = reportGate({ status: "attested", scopeVersionId: "v4", approvedScopeVersionId: "v4", attestationStatus: "attested", scopeLabel: "v4", attestedAt: "2026-09-03" });
    render(<GateCallout gate={gate} reportId="r1" />);
    expect(screen.getByText("QA attestation")).toBeInTheDocument();
    expect(screen.getByText("Scope version approved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download PDF/i })).toBeInTheDocument();
  });

  it("names the missing condition and offers no download when not final", () => {
    const gate = reportGate({ status: "submitted", scopeVersionId: "v4", approvedScopeVersionId: "v4", attestationStatus: "submitted", scopeLabel: "v4", attestedAt: null });
    render(<GateCallout gate={gate} reportId="r1" />);
    expect(screen.getByText(/Attestation pending/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download PDF/i })).toBeNull();
  });
});
```

```tsx
// customer-ui/src/screens/Reports.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/api/queries", () => ({
  useReports: vi.fn(), useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeSets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeVersion: vi.fn(() => ({ data: null, isLoading: false, error: null })),
  useApprovedScopeVersionId: vi.fn(() => null),
  useScanFindings: vi.fn(() => ({ data: [], isLoading: false, error: null })), useAudit: vi.fn(),
}));

import { useApprovedScopeVersionId, useReports } from "../lib/api/queries";
import { Reports } from "./Reports";

const report = (over = {}) => ({ id: "r1", scanId: "s1", status: "submitted", scopeVersionId: "v4", attestationId: "att1", attestation: { id: "att1", status: "submitted", reason: null, reviewedAt: null }, summary: { hosts: 4, vulnerabilities: 9, averageRisk: 2.1, bySeverity: { "2": 7, "3": 2 }, compliance: "PASSED" }, createdAt: "2026-09-03T00:00:00Z", updatedAt: "2026-09-03T00:00:00Z", ...over });

const renderReports = () => render(<MemoryRouter><Reports /></MemoryRouter>);

describe("Reports", () => {
  it("does not label a submitted report final even when a scope version is recorded", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report()], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useApprovedScopeVersionId).mockReturnValue("v4");
    renderReports();
    expect(screen.queryByText(/^Final$/)).toBeNull();
    expect(screen.getByText(/Attestation pending/)).toBeInTheDocument();
  });

  it("labels a report final only when attested and backed by the approved version", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report({ status: "attested", attestation: { id: "att1", status: "attested", reason: null, reviewedAt: "2026-09-03" } })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useApprovedScopeVersionId).mockReturnValue("v4");
    renderReports();
    expect(screen.getByText(/^Final$/)).toBeInTheDocument();
  });

  it("refuses to call a report final when the approved version has moved on", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report({ status: "attested", attestation: { id: "att1", status: "attested", reason: null, reviewedAt: "2026-09-03" } })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useApprovedScopeVersionId).mockReturnValue("v5");
    renderReports();
    expect(screen.queryByText(/^Final$/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd customer-ui && npx vitest run src/screens/Reports.test.tsx src/components/shell/GateCallout.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Add `useApprovedScopeVersionId` and implement the screens**

Add to `customer-ui/src/lib/api/queries.ts`:

```ts
/**
 * The one place "the approved scope version" is derived. Home, Reports and
 * ReportDetail all consume this so the gate cannot drift between screens.
 * Reads /scope-sets then each set's versions, and returns the newest approved
 * version's id, or null when nothing is approved.
 */
export function useApprovedScopeVersionId(): string | null {
  const sets = useScopeSets();
  const setsWithIds = sets.data ?? [];
  const versions = useQueries({
    queries: setsWithIds.map((s) => ({
      queryKey: ["scope-versions", s.id] as const,
      queryFn: async () => (await apiGet<{ versions: ScopeVersionApi[] }>(`/scope-sets/${s.id}/versions`)).versions,
    })),
  });
  const all = versions.flatMap((q) => q.data ?? []);
  const approved = all.filter((v) => v.status === "approved").sort((a, b) => b.versionNumber - a.versionNumber);
  return approved[0]?.id ?? null;
}
```

(add `useQueries` to the `@tanstack/react-query` import; confirm the response key of `GET /api/v1/scope-sets/[scopeSetId]/versions` is `versions` before shipping, and adjust the cast if it is not.)

```tsx
// customer-ui/src/components/shell/GateCallout.tsx
import type { GateView } from "../../lib/viewmodels/gate";
import { TONE_CLASS } from "../../lib/status";

export function GateCallout({ gate, reportId }: { gate: GateView; reportId: string }) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] p-4">
      <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)]">Finalisation gate</div>
      <ul className="mt-3 space-y-1.5">
        {gate.conditions.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-[14px]">
            <span aria-hidden="true" className={`border rounded-[var(--radius-sm)] px-1 text-[12px] ${TONE_CLASS[c.met ? "pass" : "warn"]}`}>
              {c.met ? "✔" : "◐"}
            </span>
            <span>{c.label}</span>
            <span className="ml-auto text-[12px] text-[var(--ink-muted)]">{c.evidence}</span>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-[var(--ink-muted)] mt-3">{gate.sentence}</p>
      {gate.canDownload ? (
        <a href={`/api/v1/reports/${reportId}/download`} className="mt-3 inline-flex rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2">
          Download PDF
        </a>
      ) : (
        <p className="text-[12px] text-[var(--ink-subtle)] mt-3">Download becomes available when every condition is met.</p>
      )}
    </div>
  );
}
```

`Reports.tsx` maps each report to `reportGate({ status, scopeVersionId, approvedScopeVersionId: useApprovedScopeVersionId(), attestationStatus, scopeLabel, attestedAt })`, renders `StageProgress` with the four steps derived from that gate (Scan complete / Findings in / Attested / Final), the gate callout, and a "Findings" link into the detail screen. `ReportDetail.tsx` reuses the callout, lists findings grouped by severity from `useScanFindings(report.scanId)`, and offers a dispute action per finding.

- [ ] **Step 4: Update Home to use the real approved-scope lookup**

In `Home.tsx`, replace the Task 10 shortcut:

```tsx
const approvedScopeVersionId = useApprovedScopeVersionId();
// ...
approvedScopeVersionId,
// ...
const tasks = quarterTasks({ assets: assets.data ?? [], approved: null, hasDraftScope: false, ... });
```

and replace the fail-closed `approvedScopeVersionId: null` from Task 10 with the real lookup. Home's "Reports final" stat then uses the same rule as the Reports screen.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd customer-ui && npx vitest run src/screens/Reports.test.tsx src/components/shell/GateCallout.test.tsx src/screens/Home.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add customer-ui/src/screens/Reports.tsx customer-ui/src/screens/ReportDetail.tsx customer-ui/src/components/shell/GateCallout.tsx customer-ui/src/lib/api/queries.ts customer-ui/src/screens/Home.tsx
git commit -m "feat(customer-ui): reports, report detail and the finalisation gate"
```

---

### Task 15: States sweep, colour-literal guard, accessibility, smoke path

**Files:**
- Create: `customer-ui/src/lib/colour-guard.test.ts`, `customer-ui/e2e/smoke.spec.ts`, `customer-ui/playwright.config.ts`
- Modify: every screen that lacks a loading/empty/partial/permission state

**Interfaces:**
- Produces: a suite-level guarantee that (a) no component or screen contains a colour literal, (b) every screen renders a loading state, an empty state and an error state under test, (c) a Playwright smoke path exists for sign-in → home → scope → reports.

- [ ] **Step 1: Write the colour-literal guard test**

```ts
// customer-ui/src/lib/colour-guard.test.ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOTS = ["src/components", "src/screens"].map((p) => resolve(__dirname, "..", p));
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

describe("colour literals", () => {
  it("appear only in tokens.css and status.ts", () => {
    const offenders = ROOTS.flatMap(walk).filter((f) => LITERAL.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and fix what it finds**

```bash
cd customer-ui && npx vitest run src/lib/colour-guard.test.ts
```
Expected: PASS. Any file it names must switch to a `var(--token)` reference or a `tone-*` class — never a literal.

- [ ] **Step 3: Add the missing states and their tests**

For each of Home, Assets, Scope, Scans, Reports: assert (a) a skeleton renders while `isLoading`, (b) the documented empty state renders with zero records, (c) `ErrorState` with a working retry renders when the query errors, (d) `PermissionState` renders when the API returns 403 (`ApiError.status === 403`). Use the mocking pattern from Tasks 10–14.

- [ ] **Step 4: Add keyboard and contrast checks**

```tsx
// customer-ui/src/components/shell/keyboard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { LifecycleNav } from "./LifecycleNav";
import { stageRows } from "../../lib/viewmodels/stages";

describe("keyboard traversal", () => {
  it("reaches every nav link with the keyboard alone", async () => {
    const stages = stageRows({ assets: [], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [] });
    render(<MemoryRouter><LifecycleNav stages={stages} /></MemoryRouter>);
    await userEvent.tab();
    expect(screen.getByRole("link", { name: /Assets/ })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("link", { name: /Scope/ })).toHaveFocus();
  });
});
```

Contrast: check `--pass`/`--pass-bg`, `--warn`/`--warn-bg`, `--fail`/`--fail-bg` and `--ink-muted` on `--surface` against WCAG AA (4.5:1 body, 3:1 large). Record the measured ratios in the commit message.

- [ ] **Step 5: Add the Playwright smoke path**

```ts
// customer-ui/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:5173/app/" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:5173/app/", reuseExistingServer: true },
});
```

```ts
// customer-ui/e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";

test("sign-in landing → home → scope → reports", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("link", { name: /Continue with Keycloak/i })).toBeVisible();

  // Requires a live portal + Keycloak (portal/docker/keycloak). Skip cleanly when absent.
  if (!process.env.E2E_LIVE) test.skip(true, "set E2E_LIVE=1 with the portal and Keycloak running");

  await page.getByRole("link", { name: /Continue with Keycloak/i }).click();
  await page.waitForURL(/\/$/);
  await expect(page.getByRole("heading", { name: /checklist/i })).toBeVisible();
  await page.getByRole("link", { name: /Scope/ }).click();
  await expect(page.getByRole("heading", { name: "Scope" })).toBeVisible();
  await page.getByRole("link", { name: /Reports/ }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
});
```

- [ ] **Step 6: Run everything**

```bash
cd customer-ui && npx vitest run && npx tsc --noEmit
cd ../portal && npx vitest run
```
Expected: all green; the portal total is unchanged from Task 1's run plus 3.

- [ ] **Step 7: Commit**

```bash
git add customer-ui/src customer-ui/e2e customer-ui/playwright.config.ts
git commit -m "test(customer-ui): colour guard, state coverage, keyboard and smoke path"
```

---

### Task 16: Deployment runbook and proxy configuration

**Files:**
- Create: `customer-ui/README.md`, `hermes/customer/specs/2026-09-12-app-deployment.md` (runbook)
- Add to runbook: the nginx and Caddy rules below

**Interfaces:**
- Produces: a build artifact (`customer-ui/dist/`) plus the exact reverse-proxy rules that serve it at `/app` and forward `/api/*` to the portal, so the session cookie authenticates both.

- [ ] **Step 1: Confirm the edge with the human before writing the rule that will be used**

There is no reverse proxy in this repo today (verified: no `Caddyfile`, no `nginx.conf`, no Traefik config). Ask which edge purple runs (or will run) — nginx, Caddy, or something else — and record the answer in the runbook. Both candidate rules are written below so the runbook is complete either way; the human picks one.

- [ ] **Step 2: Write the build and verify the base path**

```bash
cd /home/cchock/projects/ds-asv/customer-ui && npm run build
grep -o '/app/assets/[^"]*' dist/index.html | head -3
```
Expected: asset URLs begin with `/app/assets/`.

- [ ] **Step 3: Write both proxy rules into the runbook**

```nginx
# nginx — serves the SPA at /app and the portal API at /api on the same origin
server {
  listen 443 ssl;
  server_name portal.example.com;

  # Existing portal (unchanged)
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  # The API must stay on the portal listener so the session cookie is same-origin
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  # New customer UI — static files, history fallback for client-side routes
  location /app/ {
    alias /srv/customer-ui/;
    try_files $uri $uri/ /app/index.html;
  }
}
```

```caddy
# Caddyfile — equivalent, same origin
portal.example.com {
  handle /app/* {
    root * /srv/customer-ui
    try_files {path} /index.html
    file_server
  }
  handle {
    reverse_proxy 127.0.0.1:3000
  }
}
```

- [ ] **Step 4: Verify end to end against the local stack**

```bash
cd /home/cchock/projects/ds-asv/portal && npm run dev &
cd /home/cchock/projects/ds-asv/customer-ui && npm run dev
# browser: http://localhost:5173/app/sign-in → Continue with Keycloak → dashboard loads with real data
```

Expected: the session cookie set by the portal is accepted on `/api/v1/*` through the Vite dev proxy; no CORS errors in the console; `/app/` deep links (e.g. `/app/reports`) load.

- [ ] **Step 5: Record the cookie-scope finding**

Note in the runbook what `Set-Cookie` the portal actually emits (path and `SameSite`) and confirm the cookie is sent for both `/app` and `/api` on the deployed origin. If the cookie's `Path` is `/api`, `/app` pages will not be authenticated and the portal's cookie path must widen — record that as a finding with the exact header observed.

- [ ] **Step 6: Commit**

```bash
git add customer-ui/README.md hermes/customer/specs/2026-09-12-app-deployment.md
git commit -m "docs(customer-ui): deployment runbook and same-origin proxy rules"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §2 standalone app, 6 surfaces + sign-in | Tasks 2, 8–14 |
| §3 design language, rules | Tasks 3, 4, 15 (colour guard) |
| §4 shell (nav, context bar, content, responsive, placeholder nav) | Task 8 |
| §5.1 Home checklist | Task 10 |
| §5.2 Assets | Task 11 |
| §5.3 Scope | Task 12 |
| §5.4 Scans | Task 13 |
| §5.5 Reports + gate | Task 14 |
| §5.6 Report detail | Task 14 |
| §5.7 Sign-in landing | Task 9 |
| §6 data flow, view models, query rules | Tasks 6, 7 |
| §7 auth + topology | Tasks 2, 6, 16 |
| §8 additive backend prerequisite | Task 1 |
| §9 states | Tasks 10–15 |
| §10 components and boundaries | Tasks 5, 8 + screens |
| §11 verification | Task 15 |
| §12 out of scope | Honoured — no Team/Access/Audit/Settings screens, no dark mode, no portal UI changes |

**Type consistency:** `StageState`/`RecordState`/`Tone` defined only in `status.ts`; `StageRow`, `TaskView`, `GateView` defined only in their view-model files and imported everywhere else; `ReportApi.scopeVersionId` is the field the gate consumes, matching the Prisma column name on `Report`.

**Known soft spots the executor must resolve, not guess:**

1. `GET /api/v1/scope-versions/[versionId]` and the response key of `GET /api/v1/scope-sets/[scopeSetId]/versions` must be confirmed before Task 6's hooks are relied on (noted in Task 6 Step 3 and Task 14 Step 3). If neither returns a list of versions per set, extend `GET /api/v1/reports` (Task 1) to include `approvedScopeVersionId` per report and drop the fan-out.
2. The exact query-parameter name on `/api/auth/login` (Task 6 Step 1) — confirmed by reading the route, not assumed.
3. Which reverse proxy purple uses (Task 16 Step 1) — a human answer, not a guess.


