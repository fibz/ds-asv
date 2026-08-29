This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Tenant database setup (RLS)

Tenant isolation is enforced by PostgreSQL row-level security (RLS). Two DB
roles are required (created by `prisma/migrations/*_rls/migration.sql`):

- `asv` — superuser (BYPASSRLS); used ONLY by the Prisma CLI for migrations.
  It bypasses RLS unconditionally, so the application must never connect as it.
- `asv_app` — non-superuser, non-owner; all application/tenant DML runs as this
  role and is subject to the RLS policies.

Connections (`portal/.env`):

- `DATABASE_URL` → `asv_app` (app + tests, RLS enforced)
- `ADMIN_DATABASE_URL` → `asv` (prisma CLI / `npx prisma migrate ...`)

Tenant queries must run inside `prisma.$transaction(async (tx) => ...)` with
`setRlsContext(orgId, tx)` from `@/lib/tenant`; the RLS session variable is
transaction-scoped, so it must be set on the same connection that runs the
queries.

Grants are fail-closed: `asv_app` has DML only on the 4 RLS tables
(Organization, OrganizationMembership, Contact, AuditEvent) plus minimal
`User` access (SELECT for the FK check, INSERT for identity provisioning);
`ApiKey`/`Scan`/`Compliance`/`WafConfig`/`SiemAlert` and `_prisma_migrations`
have no grants until their policies land. Pattern for future migrations: any
migration that adds a tenant table must enable RLS, add its policies, and
GRANT the table to `asv_app` — all in the same migration.

The Organization policy exposes own-row + direct-child reads only; the parent
org row is read through `getParentOrg(tx)` from `@/lib/tenant`, backed by the
session-variable-bound SECURITY DEFINER function `public.get_org_parent()`
(no parameters, so it cannot read an arbitrary org).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
