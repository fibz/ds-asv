import "dotenv/config";
import { defineConfig } from "prisma/config";

// CLI/migrations must run as the admin role (`asv`, superuser, bypasses RLS);
// the app runtime connects as `asv_app` via DATABASE_URL (subject to RLS).
// Fail fast: silently falling back to DATABASE_URL would run DDL as the
// RLS-limited role and fail confusingly.
const cliUrl = process.env.ADMIN_DATABASE_URL;
if (!cliUrl) {
  throw new Error(
    "ADMIN_DATABASE_URL is not set — prisma CLI must connect as the admin role " +
      "(asv), not the RLS-limited asv_app. See portal/.env and README."
  );
}

// Throwaway shadow DB for `prisma migrate diff --from-migrations` (Prisma 7:
// the shadow URL is configured here — `--shadow-database-url` no longer
// exists — and diff creates/drops tables inside it, never the live DB).
// Same host/port/user as ADMIN_DATABASE_URL, only the database name differs.
const shadowUrl = cliUrl.replace(/\/[^/]+$/, "/asv_shadow");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: cliUrl,
    shadowDatabaseUrl: shadowUrl,
  },
});
