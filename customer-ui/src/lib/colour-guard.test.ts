// customer-ui/src/lib/colour-guard.test.ts
//
// Guard rail: colour literals live in exactly one file — src/styles/tokens.css —
// and reach components only as `tone-*` classes (app.css) or as `var(--token)`
// references. This test walks the two rendered trees (`components/`, `screens/`)
// and fails if a hex code, rgb()/rgba() or hsl()/hsla() appears in any source.
//
// It passes today with zero matches. The value is that it keeps passing: the
// first inline `#fff` or `rgba(0,0,0,.5)` added to a component breaks the suite.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "..");
const SCANNED = ["components", "screens"].map((dir) => join(SRC, dir));

// A hex colour literal, an rgb()/rgba() call, or an hsl()/hsla() call.
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const files = SCANNED.flatMap(walk);

describe("colour guard", () => {
  it("actually finds the component and screen sources to scan", () => {
    // Without this, a typo in a directory name would make the guard pass vacuously.
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith("Assets.tsx"))).toBe(true);
  });

  it("keeps every colour literal out of components/ and screens/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const matches = readFileSync(file, "utf8").match(new RegExp(COLOUR_LITERAL, "g"));
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
