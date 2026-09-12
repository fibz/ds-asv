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

/*
 * Measured WCAG 2.1 contrast ratios (relative-luminance formula, computed with
 * a script against the hex values below — not estimated by eye):
 *
 *   --ink        #18181b on --surface #ffffff .......... 17.72 : 1  PASS
 *   --ink-muted  #71717a on --surface #ffffff ..........  4.83 : 1  PASS
 *   --ink-subtle #74747d on --surface #ffffff ..........  4.63 : 1  PASS
 *   --pass       #15803d on --pass-bg #f0fdf4 ..........  4.79 : 1  PASS
 *   --warn       #a16207 on --warn-bg #fffbeb ..........  4.75 : 1  PASS
 *   --fail       #b91c1c on --fail-bg #fef2f2 ..........  5.91 : 1  PASS
 *
 * --ink-subtle FAILED first time round: the shipped #a1a1aa measured 2.56 : 1
 * on white, well under the 4.5 : 1 floor for normal text (it is used at 11–13px
 * in the nav label, Home footnote, "Locked" chip and gate footnotes). It was
 * darkened to #74747d — the same neutral hue, ~2.7x the luminance — which
 * measures 4.63 : 1. No other pair changed.
 *
 * The test below recomputes every ratio from tokens.css, so a future edit that
 * lightens a token fails the suite instead of shipping.
 */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function hexOf(token: string): string {
  const match = tokens.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!match) throw new Error(`token ${token} is not defined as a hex colour`);
  return match[1];
}

const CONTRAST_PAIRS: [string, string][] = [
  ["--ink", "--surface"],
  ["--ink-muted", "--surface"],
  ["--ink-subtle", "--surface"],
  ["--pass", "--pass-bg"],
  ["--warn", "--warn-bg"],
  ["--fail", "--fail-bg"],
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

describe("token contrast", () => {
  it.each(CONTRAST_PAIRS)("%s on %s meets 4.5:1 for normal text", (fg, bg) => {
    expect(contrast(hexOf(fg), hexOf(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
