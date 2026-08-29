import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma-client";

describe("prisma client", () => {
  it("connects to a real client instance", async () => {
    expect(prisma).toBeDefined();
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeTruthy();
  });
});

afterAll(async () => { await prisma.$disconnect(); });
