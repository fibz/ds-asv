# QSA Portal — Design Spec

**Date:** 2026-09-09  
**Module:** ds-asv QSA review portal  
**Status:** Draft, awaiting user review

## 1. Purpose

Build the QSA-facing half of the two-portal product. QSA reviewers will receive manually assigned report jobs, review customer evidence, attest reports, handle report-linked disputes, and complete assignments with an immutable audit trail.

The QSA portal is assignment-based. The organization parent/child relationship remains informational and does not grant cross-customer access.

## 2. URL and deployment boundary

The first release stays in the existing Next.js deployment with a separate QSA route tree and layout:

```text
/qsa                         QSA home / queue summary
/qsa/queue                   shared unclaimed queue
/qsa/assignments             assigned and historical jobs
/qsa/assignments/:id         assignment detail and review workspace
/qsa/reports/:reportId      report review view
```

Customer routes remain under `/customer/*`. QSA navigation and customer navigation are separate. The route structure is portable to a future QSA hostname without moving API contracts.

## 3. Assignment model

Add a dedicated `QsaAssignment` domain record. One active assignment exists per report; completed and cancelled records remain as history.

Required fields:

- `id`
- `qsaOrganizationId`
- `customerOrganizationId`
- `reportId`
- nullable `assigneeUserId`
- `status`: `queued`, `assigned`, `in_review`, `completed`, `cancelled`
- `createdByUserId`
- `dueAt`
- `notes`
- `claimedAt`, `completedAt`, `cancelledAt`
- `createdAt`, `updatedAt`

The QSA organization identifies the queue owner. A null assignee means the job is available in that QSA organization’s shared queue. Claiming a queued job records the reviewer and changes it to `assigned` atomically; opening the review workspace changes it to `in_review`. Reassignment is an explicit audited mutation.

The report is the job boundary. Findings and disputes attached to that report are reviewed under the same assignment; they do not create separate assignment records in v1.

## 4. Assignment lifecycle

```text
queued -> assigned -> in_review -> completed
   |         |           |
   +---------+-----------+----> cancelled
```

- `queued`: created for the shared QSA queue.
- `assigned`: directly assigned or claimed by an individual reviewer.
- `in_review`: reviewer has opened or started review.
- `completed`: review action is finished and the assignment is closed.
- `cancelled`: withdrawn with an audit reason.

Only an active assignment may be claimed, reassigned, reviewed, attested, or completed. A report may receive a new assignment after a prior assignment is completed or cancelled; historical rows are never overwritten.

## 5. QSA request flow

1. A QSA coordinator creates a report assignment.
2. The job appears in the QSA shared queue when no reviewer is assigned.
3. A reviewer claims the job, or the coordinator assigns it directly.
4. The reviewer opens the report workspace and sees the customer’s scan, approved-scope evidence, findings, and report-linked disputes.
5. The reviewer may attest the report, resolve or reject disputes, add internal review notes, and complete the assignment.
6. Every create, claim, assign, reassign, review-start, attest, dispute-moderation, complete, and cancel action records an immutable audit event.
7. Customers see report status changes through the customer portal, but never see QSA internal notes or assignment controls.

Report finalization continues to require the existing approved-scope and QA-attestation gates. Assignment completion does not weaken or replace those gates.

## 6. Authentication and authorization

The QSA layout requires a verified Keycloak identity with the configured staff realm role and an active membership in the QSA organization that owns the assignment queue. Staff identity alone is insufficient for customer data access.

Every QSA read or mutation must verify:

1. the request is authenticated and staff-authorized;
2. the assignment belongs to the QSA reviewer’s organization;
3. the assignment is active and either assigned to the reviewer or available to that reviewer’s shared queue;
4. the requested report, scan, finding, scope, or dispute belongs to the assignment’s recorded customer organization.

The UI is not an authorization boundary. URL changes, forged report IDs, and forged customer organization IDs must fail closed.

## 7. Tenant and database safety

Do not use `isStaff` as a global RLS bypass. Add assignment-aware server services and database policy/function support that prove the QSA assignment before exposing customer evidence.

The intended access sequence is:

1. resolve the authenticated staff user and QSA organization;
2. read or claim the assignment under the QSA organization context;
3. derive the customer organization only from the stored assignment;
4. read customer report data through an assignment-scoped service path that preserves RLS;
5. write attestation, dispute, and audit records against the stored customer organization.

Client input may select an assignment ID, but may never supply the customer organization used for authorization. Cross-tenant isolation tests must prove that a valid QSA reviewer cannot read an unassigned customer report.

Queue claim must be transactional and conditional on `status = queued` and `assigneeUserId IS NULL`, so two reviewers cannot claim the same job.

## 8. Components and API boundaries

- QSA layout: staff authentication, QSA navigation, and shared queue chrome only.
- Assignment service: create, list, claim, assign, reassign, start review, complete, and cancel.
- Assignment-scoped review service: load report, scan, findings, scope evidence, disputes, and permitted mutations.
- QSA queue page: unclaimed jobs for the reviewer’s QSA organization.
- Assignment list/detail pages: individual work and history.
- Report review page: evidence, finalization gate, attestation, disputes, and internal notes.
- API routes remain under `/api/v1/*` and use server-side assignment checks.

The QSA layout must not contain database queries or authorization rules that belong in services. View models crossing server/client boundaries must be plain serializable objects.

## 9. Error behavior

- unauthenticated: redirect to `/sign-in` or return `401` from API routes;
- non-staff: redirect away from QSA pages or return `403`;
- unassigned report: return `404` to avoid confirming another customer’s report existence;
- inactive assignment: reject claim/review/mutation with a sanitized conflict response;
- queue race: only the first conditional claim succeeds; later claims receive a conflict response;
- invalid lifecycle transition: return a sanitized validation error and preserve the audit trail;
- customer scanner/report data unavailable: show a bounded review error without exposing upstream credentials or internal addresses.

## 10. Verification and acceptance

The milestone is complete when:

1. `/qsa`, `/qsa/queue`, `/qsa/assignments`, and report review routes render behind the real staff session guard.
2. Coordinators can create queue and direct assignments.
3. Reviewers can claim queue jobs, see only their assigned/queue jobs, and complete or cancel them.
4. An unassigned report cannot be read, attested, or moderated by changing a URL.
5. Queue claim is race-safe and tested transactionally.
6. Assignment-scoped report review preserves approved-scope and attestation finalization gates.
7. Report-linked dispute moderation requires an active assignment and records an audit event.
8. Customer users cannot access QSA routes or internal notes.
9. Portal TypeScript, full unit tests, assignment/RLS tests, and a browser smoke path for queue → claim → review → complete pass.

## 11. Out of scope

- automatic job routing or workload balancing;
- multi-reviewer approval quorum;
- customer-to-QSA messaging or email notifications;
- organization-tree-based authorization;
- separate QSA deployment/hostname provisioning;
- PCI qualification claims.
