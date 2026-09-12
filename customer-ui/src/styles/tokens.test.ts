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
