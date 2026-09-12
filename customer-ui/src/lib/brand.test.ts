// customer-ui/src/lib/brand.test.ts
//
// A brand name rendered in the chrome stops looking like a placeholder and
// starts looking like a decision. That is exactly what happened when "T3MP3ST"
// was hardcoded in three components during the build. This guard makes it
// impossible to reintroduce: the wordmark must come from `brand.ts`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every .ts/.tsx file under a directory, as [path, contents]. */
function sourceFiles(dir: string): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push([full, readFileSync(full, "utf8")]);
  }
  return out;
}

// Assembled at runtime so this file does not match its own search - a literal
// would make the guard permanently red.
const RETIRED_BRAND = ["T3", "MP3ST"].join("");
const RETIRED_TAGLINE = ["Payment", "security", "portal"].join(" ");

describe("brand guard", () => {
  const files = sourceFiles("src");

  it("finds source files to check (guard is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it(`never hardcodes the retired brand ${RETIRED_BRAND} outside brand.ts`, () => {
    const hits = files
      // brand.ts may name brands (that is its job, and its comment explains this
      // history); brand.test.ts must assemble the string to avoid self-matching.
      .filter(([path]) => !path.endsWith("brand.test.ts") && !path.endsWith("/brand.ts"))
      .filter(([, body]) => body.includes(RETIRED_BRAND))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it("never hardcodes the tagline outside brand.ts", () => {
    const hits = files
      .filter(([path]) => !path.endsWith("brand.test.ts") && !path.endsWith("/brand.ts"))
      .filter(([, body]) => body.includes(RETIRED_TAGLINE))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it("exports a non-empty product name", async () => {
    const { PRODUCT_NAME, PRODUCT_TAGLINE } = await import("./brand");
    expect(PRODUCT_NAME.trim().length).toBeGreaterThan(0);
    expect(PRODUCT_TAGLINE.trim().length).toBeGreaterThan(0);
  });
});
