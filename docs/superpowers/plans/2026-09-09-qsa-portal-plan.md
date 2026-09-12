# QSA Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an assignment-based QSA portal that lets staff coordinators create report jobs, lets reviewers claim or receive them, and permits report review actions only through verified active assignments.

**Architecture:** Add a `QsaAssignment` domain model owned by a QSA organization and linked to exactly one customer report. Use assignment-aware database session variables and RLS policies/functions to expose only assigned customer evidence; `isStaff` alone never bypasses tenant isolation. Add a separate `/qsa` Next.js route tree and server-authorized API/service layer while reusing the existing report, finding, scope, attestation, dispute, and audit semantics.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL RLS, Keycloak realm roles and cookie/header sessions, Vitest, and the existing OpenAPI contract.

**Spec:** `docs/superpowers/specs/2026-09-09-qsa-portal-design.md`

## Global Constraints

- The QSA portal is assignment-based. The organization parent/child relationship remains informational and does not grant cross-customer access.
- The first release stays in the existing Next.js deployment with a separate QSA route tree and layout.
- One active assignment exists per report; completed and cancelled records remain as history.
- Claiming a queued job changes it to `assigned` atomically; opening review changes it to `in_review`.
- Findings and disputes attached to a report are reviewed under the same assignment.
- Staff identity alone is insufficient for customer data access.
- Do not use `isStaff` as a global RLS bypass.
- Client input may select an assignment ID, but may never supply the customer organization used for authorization.
- Queue claim must be transactional and conditional on `status = queued` and `assigneeUserId IS NULL`.
- Report finalization continues to require the existing approved-scope and QA-attestation gates.
- Customer users never see QSA internal notes or assignment controls.
- No PCI qualification or compliance claims are introduced.

---

## File Map

### New files

- `portal/prisma/migrations/20260909000001_qsa_assignments/migration.sql` — assignment table, indexes, RLS, grants, and assignment-aware database functions/policies.
- `portal/src/lib/qsa/types.ts` — assignment status and serializable view-model types.
- `portal/src/lib/qsa/assignment.ts` — assignment lifecycle service and authorization checks.
- `portal/src/lib/qsa/assignment.test.ts` — lifecycle, queue, reassignment, and race tests.
- `portal/src/lib/qsa/review.ts` — assignment-scoped report/evidence loader and review mutations.
- `portal/src/lib/qsa/review.test.ts` — assigned/unassigned/cross-customer review tests.
- `portal/src/app/api/v1/qsa/candidates/route.ts` — coordinator candidate-report listing.
- `portal/src/app/api/v1/qsa/assignments/route.ts` — assignment list/create.
- `portal/src/app/api/v1/qsa/assignments/[assignmentId]/route.ts` — assignment detail/update/reassign/cancel.
- `portal/src/app/api/v1/qsa/assignments/[assignmentId]/claim/route.ts` — atomic queue claim.
- `portal/src/app/api/v1/qsa/assignments/[assignmentId]/start/route.ts` — transition to `in_review`.
- `portal/src/app/api/v1/qsa/assignments/[assignmentId]/complete/route.ts` — complete an active review.
- `portal/src/app/api/v1/qsa/assignments/[assignmentId]/review/route.ts` — assignment-scoped report review payload.
- `portal/src/app/api/v1/qsa/assignments/[assignmentId]/attest/route.ts` — assignment-checked report attestation.
- `portal/src/app/api/v1/qsa/assignments/[assignmentId]/disputes/[disputeId]/moderate/route.ts` — assignment-checked dispute moderation.
- `portal/src/app/api/v1/qsa/**/*.test.ts` — route auth, assignment scope, lifecycle, and conflict tests.
- `portal/src/app/qsa/layout.tsx` — verified staff/QSA shell and navigation.
- `portal/src/app/qsa/page.tsx` — queue summary/home.
- `portal/src/app/qsa/queue/page.tsx` — shared unclaimed queue.
- `portal/src/app/qsa/assignments/page.tsx` — assigned and historical jobs.
- `portal/src/app/qsa/assignments/[assignmentId]/page.tsx` — assignment detail/review workspace.
- `portal/src/app/qsa/reports/[reportId]/page.tsx` — assignment-linked report view.
- `portal/src/components/qsa/sidebar.tsx` — QSA-only navigation and sign-out.
- `portal/src/components/qsa/AssignmentTable.tsx` — queue and history tables.
- `portal/src/components/qsa/ReviewWorkspace.tsx` — report evidence, attestation, disputes, and internal notes UI.

### Modified files

- `portal/prisma/schema.prisma` — add `QsaAssignment` and relations.
- `portal/src/lib/scan/report.ts` — expose transaction-aware report attestation internals without weakening the existing customer API.
- `portal/src/lib/disputes/service.ts` — expose transaction-aware assignment-checked moderation internals.
- `portal/src/lib/http-error.ts` — map QSA assignment guard/conflict errors to sanitized `409` responses.
- `portal/src/lib/openapi/contract.test.ts` and `portal/spec/openapi.yaml` — document QSA candidate, assignment, claim, review, attest, complete, and dispute routes.

All QSA staff members of the configured QSA organization are coordinators in v1; a later release may add a separate coordinator/reviewer role without changing the assignment boundary.

---

### Task 1: Add the QSA assignment schema and database enforcement

**Files:**
- Modify: `portal/prisma/schema.prisma`
- Create: `portal/prisma/migrations/20260909000001_qsa_assignments/migration.sql`
- Test: `portal/prisma/qsa-assignments.test.ts`

**Interfaces:**
- Consumes: existing `Organization`, `User`, `Report`, `Finding`, `Dispute`, and audit tables plus the existing `app.tenant_id` RLS convention.
- Produces: `QsaAssignment` Prisma model and session variables `app.qsa_org_id`, `app.qsa_user_id`, and `app.qsa_assignment_id` for assignment-scoped transactions.

- [ ] **Step 1: Write the failing schema/RLS tests**

Add tests that create a QSA organization, two customer organizations, two reports, and assignments. Assert that the active-report uniqueness rule prevents two active assignments for one report, completed/cancelled history remains insertable, candidate listing returns only eligible submitted reports with no active assignment, and an unassigned report is not visible through an assignment-scoped session.

- [ ] **Step 2: Run the focused database test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run prisma/qsa-assignments.test.ts`

Expected: FAIL because `QsaAssignment` and its migration do not exist.

- [ ] **Step 3: Add the Prisma model and migration**

Add the model with `status`, nullable `assigneeUserId`, `dueAt`, `notes`, lifecycle timestamps, foreign keys to QSA/customer organizations and report, indexes on `(qsaOrganizationId, status)`, `(assigneeUserId, status)`, and `reportId`, plus a partial unique index for active statuses (`queued`, `assigned`, `in_review`).

The migration must enable RLS and grant only the required DML to `asv_app`. Add a `qsa_assignment_access(assignment_id, qsa_org_id, user_id)` SECURITY DEFINER helper that validates the assignment’s QSA organization, active status, and queue-or-assignee rule. Add a `qsa_list_candidate_reports(qsa_org_id, user_id)` SECURITY DEFINER function that returns only minimal report/customer metadata for eligible submitted reports with no active assignment; it must not accept a customer organization from the caller. Add assignment-aware policies to the report evidence tables used by review (`Report`, `ReportAttestation`, `Scan`, `ScanTarget`, `Finding`, `ScopeVersion`, `ScopeItem`, and `Dispute`) so rows are visible only when `app.qsa_assignment_id` resolves to the requested row’s report/customer organization. Keep ordinary customer policies unchanged.

- [ ] **Step 4: Generate Prisma and run the focused database test**

Run:

```bash
cd portal && ./node_modules/.bin/prisma generate
./node_modules/.bin/vitest run prisma/qsa-assignments.test.ts
```

Expected: PASS with the configured local PostgreSQL environment; when the database is unavailable, the test must skip using the project’s existing integration-test convention.

- [ ] **Step 5: Commit**

```bash
git add portal/prisma/schema.prisma portal/prisma/migrations/20260909000001_qsa_assignments portal/prisma/qsa-assignments.test.ts
git commit -m "feat: add assignment-scoped qsa schema"
```

### Task 2: Implement assignment lifecycle services

**Files:**
- Create: `portal/src/lib/qsa/types.ts`
- Create: `portal/src/lib/qsa/assignment.ts`
- Create: `portal/src/lib/qsa/assignment.test.ts`
- Modify: `portal/src/lib/http-error.ts`

**Interfaces:**
- Consumes: `TenantContext`, `isStaff`, the QSA session variables, Prisma transaction client, and the `QsaAssignment` model.
- Produces:

```ts
export type QsaAssignmentStatus = "queued" | "assigned" | "in_review" | "completed" | "cancelled";
export type QsaAssignmentRole = "queue" | "assignee" | "coordinator";

export interface QsaAssignmentRow {
  id: string;
  qsaOrganizationId: string;
  customerOrganizationId: string;
  reportId: string;
  assigneeUserId: string | null;
  createdByUserId: string;
  status: QsaAssignmentStatus;
  dueAt: string | null;
  notes: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QsaCandidateReport {
  reportId: string;
  customerOrganizationId: string;
  customerName: string;
  reportStatus: string;
  createdAt: string;
}

export function listQsaCandidateReports(ctx: TenantContext): Promise<QsaCandidateReport[]>;
export function listQsaAssignments(ctx: TenantContext, filter: { status?: QsaAssignmentStatus }): Promise<QsaAssignmentRow[]>;
export function createQsaAssignment(ctx: TenantContext, input: { reportId: string; assigneeUserId?: string; dueAt?: Date; notes?: string }): Promise<QsaAssignmentRow>;
export function claimQsaAssignment(ctx: TenantContext, assignmentId: string): Promise<QsaAssignmentRow>;
export function startQsaReview(ctx: TenantContext, assignmentId: string): Promise<QsaAssignmentRow>;
export function reassignQsaAssignment(ctx: TenantContext, assignmentId: string, assigneeUserId: string | null): Promise<QsaAssignmentRow>;
export function completeQsaAssignment(ctx: TenantContext, assignmentId: string): Promise<QsaAssignmentRow>;
export function cancelQsaAssignment(ctx: TenantContext, assignmentId: string, reason: string): Promise<QsaAssignmentRow>;
```

- [ ] **Step 1: Write failing service tests**

Cover staff/QSA membership requirements, queue visibility, individual visibility, create queue/direct assignment, claim success, second-claim conflict, start/reassign/complete/cancel transitions, invalid transitions, due-date/notes validation, and assignment audit events. Assert all reads are scoped to `ctx.organizationId` and the reviewer identity.

- [ ] **Step 2: Run the focused service test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/lib/qsa/assignment.test.ts`

Expected: FAIL because the service and guard errors do not exist.

- [ ] **Step 3: Implement the transaction helpers and lifecycle guards**

Use one interactive transaction per mutation. Set `app.qsa_org_id`, `app.qsa_user_id`, and `app.tenant_id` to the QSA organization before loading the assignment. Candidate listing must call the migration’s `qsa_list_candidate_reports` function. Assignment creation must call a transaction-local helper that re-reads the selected report, derives `customerOrganizationId` server-side, verifies the report is eligible and the optional assignee is an active member of the same QSA organization, and inserts the assignment. Claim with a conditional update equivalent to:

```ts
where: { id: assignmentId, qsaOrganizationId: ctx.organizationId, status: "queued", assigneeUserId: null }
```

Return a typed conflict error when the conditional update affects zero rows. Record assignment lifecycle events in the QSA organization audit stream with the actor, previous status, next status, and reason. Never accept a customer organization from input.

- [ ] **Step 4: Add sanitized error mapping and run tests**

Add `QsaAssignmentGuardError` and `QsaAssignmentConflictError` to `routeErrorResponse`, mapping both to `409` with safe messages. Candidate absence and inaccessible report IDs must be normalized to `404`; only lifecycle conflicts use `409`. Run:

```bash
cd portal && ./node_modules/.bin/vitest run src/lib/qsa/assignment.test.ts && ./node_modules/.bin/eslint src/lib/qsa src/lib/http-error.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/qsa portal/src/lib/http-error.ts
git commit -m "feat: add qsa assignment lifecycle"
```

### Task 3: Add assignment-scoped review services

**Files:**
- Create: `portal/src/lib/qsa/review.ts`
- Create: `portal/src/lib/qsa/review.test.ts`
- Modify: `portal/src/lib/scan/report.ts`
- Modify: `portal/src/lib/disputes/service.ts`

**Interfaces:**
- Consumes: an active `QsaAssignmentRow`, assignment-aware RLS session variables, existing `getReport`, `getScan`, `listFindings`, `getScopeVersion`, `attestReport`, and `moderateDispute` semantics.
- Produces:

```ts
export interface QsaReviewView {
  assignment: QsaAssignmentRow;
  customer: { id: string; name: string };
  report: { id: string; status: string; summary: unknown; createdAt: string; attestation: unknown };
  scan: { id: string; name: string; status: string; targets: unknown[] };
  scope: unknown | null;
  findings: unknown[];
  disputes: unknown[];
  isFinal: boolean;
}

export function getQsaReview(ctx: TenantContext, assignmentId: string): Promise<QsaReviewView | null>;
export function attestAssignedReport(ctx: TenantContext, assignmentId: string, reason?: string): Promise<QsaReviewView | null>;
export function moderateAssignedDispute(ctx: TenantContext, assignmentId: string, disputeId: string, input: { status: "resolved" | "rejected"; note?: string }): Promise<QsaReviewView | null>;
```

- [ ] **Step 1: Write failing review isolation tests**

Seed assignments for two customer organizations and assert that a reviewer can load the assigned report, scan, findings, scope, and disputes, but receives `null`/not-found for an unassigned report, another QSA organization’s assignment, a completed assignment, and a forged customer organization id.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/lib/qsa/review.test.ts`

Expected: FAIL because the review service does not exist.

- [ ] **Step 3: Factor transaction-aware report/dispute internals**

Refactor `report.ts` and `disputes/service.ts` so the existing customer entry points retain their behavior while QSA review calls can execute the same gates on a caller-owned transaction. The internal functions must:

- derive the customer organization from the assignment;
- require `ctx.isStaff` and an active assignment;
- preserve the approved-scope gate before attestation;
- write the customer report/dispute audit event with the QSA actor;
- never accept a customer organization from request input.

- [ ] **Step 4: Implement `getQsaReview` and mutations**

Start the transaction in QSA context, load the assignment, set `app.qsa_assignment_id`, switch the tenant variable only to the assignment-derived customer organization, and load evidence through the same transaction. On mutation, keep the assignment active and audit the action before returning the refreshed serializable review view.

- [ ] **Step 5: Run tests, lint, and TypeScript**

Run:

```bash
cd portal && ./node_modules/.bin/vitest run src/lib/qsa/review.test.ts src/lib/scan/report.test.ts src/lib/disputes/service.test.ts && ./node_modules/.bin/eslint src/lib/qsa src/lib/scan/report.ts src/lib/disputes/service.ts && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS with existing report/dispute gates unchanged.

- [ ] **Step 6: Commit**

```bash
git add portal/src/lib/qsa portal/src/lib/scan/report.ts portal/src/lib/disputes/service.ts
git commit -m "feat: add assignment-scoped qsa review"
```

### Task 4: Add QSA API routes and contract

**Files:**
- Create: `portal/src/app/api/v1/qsa/candidates/route.ts`
- Create: `portal/src/app/api/v1/qsa/assignments/route.ts`
- Create: `portal/src/app/api/v1/qsa/assignments/[assignmentId]/route.ts`
- Create: `portal/src/app/api/v1/qsa/assignments/[assignmentId]/claim/route.ts`
- Create: `portal/src/app/api/v1/qsa/assignments/[assignmentId]/start/route.ts`
- Create: `portal/src/app/api/v1/qsa/assignments/[assignmentId]/complete/route.ts`
- Create: `portal/src/app/api/v1/qsa/assignments/[assignmentId]/review/route.ts`
- Create: `portal/src/app/api/v1/qsa/assignments/[assignmentId]/attest/route.ts`
- Create: `portal/src/app/api/v1/qsa/assignments/[assignmentId]/disputes/[disputeId]/moderate/route.ts`
- Create: matching `route.test.ts` files
- Modify: `portal/spec/openapi.yaml`
- Modify: `portal/src/lib/openapi/contract.test.ts`

**Interfaces:**
- Consumes: `tenantContextFromRequest`, `can`, QSA assignment/review services, and `routeErrorResponse`.
- Produces: authenticated `/api/v1/qsa/*` routes returning `401`, `403`, `404`, `409`, or serializable QSA view models.

- [ ] **Step 1: Write failing route tests**

For every route, cover unauthenticated `401`, non-staff `403`, another-QSA-org `404`, inactive assignment `409`, successful queue/direct assignment, claim race `409`, review payload, attestation, dispute moderation, completion, cancellation, and candidate listing.

- [ ] **Step 2: Run the focused route tests and verify they fail**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/api/v1/qsa`

Expected: FAIL because the route modules do not exist.

- [ ] **Step 3: Implement route guards and input validation**

Authenticate with `tenantContextFromRequest`, require staff plus an active QSA membership, validate body enums/lengths before calling services, and use `404` for inaccessible assignments or reports. Candidate listing must return only minimal report metadata needed for manual assignment. In v1 every active QSA member may create, assign, reassign, and cancel jobs; the service still records the actor and keeps the coordinator role in the API model for future role refinement.

- [ ] **Step 4: Document the contract**

Add OpenAPI paths for candidate listing, assignment CRUD/lifecycle, review payload, attestation, and dispute moderation. Reuse existing `Report`, `Finding`, `Dispute`, and error schemas. Add contract assertions for every route and response class.

- [ ] **Step 5: Run route tests and contract checks**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/api/v1/qsa src/lib/openapi/contract.test.ts && ./node_modules/.bin/eslint src/app/api/v1/qsa`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/src/app/api/v1/qsa portal/spec/openapi.yaml portal/src/lib/openapi/contract.test.ts
git commit -m "feat: expose qsa assignment api"
```

### Task 5: Build the QSA route shell and queue pages

**Files:**
- Create: `portal/src/app/qsa/layout.tsx`
- Create: `portal/src/app/qsa/page.tsx`
- Create: `portal/src/app/qsa/queue/page.tsx`
- Create: `portal/src/app/qsa/assignments/page.tsx`
- Create: `portal/src/components/qsa/sidebar.tsx`
- Create: `portal/src/components/qsa/AssignmentTable.tsx`
- Test: `portal/src/components/qsa/sidebar.test.ts`

**Interfaces:**
- Consumes: QSA API/service view models and verified staff session.
- Produces: staff-only `/qsa`, `/qsa/queue`, and `/qsa/assignments` pages with separate navigation.

- [ ] **Step 1: Write failing shell/navigation tests**

Assert that the QSA navigation contains only QSA routes, that customer navigation is not rendered, and that non-staff users are redirected away from `/qsa`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/components/qsa/sidebar.test.ts`

Expected: FAIL because the QSA shell does not exist.

- [ ] **Step 3: Implement the staff-only layout**

Resolve the verified Keycloak user and tenant context, require `ctx.isStaff` plus the QSA membership, and render a QSA sidebar with Queue, Assignments, and sign-out. Do not place database queries in the layout.

- [ ] **Step 4: Implement queue/history pages**

Render queued, assigned, in-review, completed, and cancelled rows from server-loaded serializable view models. Include claim/reassign/complete controls only when the assignment service says the current reviewer may act.

- [ ] **Step 5: Run focused tests, lint, and TypeScript**

Run: `cd portal && ./node_modules/.bin/vitest run src/components/qsa/sidebar.test.ts && ./node_modules/.bin/eslint src/app/qsa src/components/qsa && ./node_modules/.bin/tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/src/app/qsa portal/src/components/qsa
git commit -m "feat: add qsa queue portal shell"
```

### Task 6: Build assignment review workspace

**Files:**
- Create: `portal/src/app/qsa/assignments/[assignmentId]/page.tsx`
- Create: `portal/src/app/qsa/reports/[reportId]/page.tsx`
- Create: `portal/src/components/qsa/ReviewWorkspace.tsx`
- Test: `portal/src/components/qsa/review-workspace.test.ts`

**Interfaces:**
- Consumes: `QsaReviewView` and assignment lifecycle API actions.
- Produces: report review UI with scope evidence, findings, disputes, attestation, internal notes, and lifecycle controls.

- [ ] **Step 1: Write failing view-model tests**

Assert that the review workspace shows customer/report identity, scope approval, findings, dispute state, finalization state, and internal notes only to QSA users. Assert that the complete action is disabled until the report review mutation succeeds.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/components/qsa/review-workspace.test.ts`

Expected: FAIL because the review workspace does not exist.

- [ ] **Step 3: Implement the assignment and report pages**

Load review data only through the assignment ID or server-verified assignment route. Render explicit not-found/conflict/error states. Use POST actions for claim, start, attest, dispute moderation, complete, and cancel; never let the client submit a customer organization id.

- [ ] **Step 4: Run focused tests, lint, and TypeScript**

Run: `cd portal && ./node_modules/.bin/vitest run src/components/qsa/review-workspace.test.ts src/lib/qsa/review.test.ts && ./node_modules/.bin/eslint src/app/qsa src/components/qsa && ./node_modules/.bin/tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/qsa portal/src/components/qsa
git commit -m "feat: add qsa review workspace"
```

### Task 7: Run complete verification and browser smoke path

**Files:**
- Test: full portal suite and browser-visible QSA routes.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: verified assignment-based QSA workflow with no customer isolation regression.

- [ ] **Step 1: Run focused QSA tests**

Run:

```bash
cd portal && ./node_modules/.bin/vitest run \
  prisma/qsa-assignments.test.ts \
  src/lib/qsa \
  src/app/api/v1/qsa \
  src/components/qsa \
  src/lib/openapi/contract.test.ts
```

Expected: all QSA-focused tests pass.

- [ ] **Step 2: Run the configured full portal gates**

Load the protected local portal environment without printing secrets, then run:

```bash
cd portal && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit
```

Expected: all existing and QSA tests pass.

- [ ] **Step 3: Verify the browser smoke path**

With a real staff Keycloak session and seeded assignment data, verify:

1. `/qsa` loads only for staff users.
2. A queued report appears in `/qsa/queue`.
3. Two reviewers cannot claim the same job; one receives a conflict.
4. The claimant can open `/qsa/assignments/:id`, review evidence, and attest.
5. Dispute moderation is available only through the active assignment.
6. Completing the assignment records the terminal state.
7. A customer session cannot access `/qsa` or internal notes.

- [ ] **Step 4: Run final diff and status checks**

Run: `git diff --check`, `git status --short --branch`, and `git log -1 --oneline`. Preserve unrelated customer-portal changes and do not claim QSA completion until the full suite and browser path pass.

- [ ] **Step 5: Commit verification notes**

Record the exact test commands, database migration result, and browser URLs in the task handoff.
