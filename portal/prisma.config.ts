import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // CLI/migrations run as the admin role (superuser, bypasses RLS); the app
    // runtime connects as `asv_app` via DATABASE_URL (subject to RLS).
    url: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});
