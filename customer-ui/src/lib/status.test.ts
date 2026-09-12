// customer-ui/src/lib/status.test.ts
import { describe, it, expect } from "vitest";
import {
  toneForStage, glyphFor, stageLabel, toneForRecord, recordLabel,
  recordStateFromScan, recordStateFromReport, TONE_CLASS,
} from "./status";

describe("stage status", () => {
  it("maps each stage state to a tone", () => {
    expect(toneForStage("complete")).toBe("pass");
    expect(toneForStage("active")).toBe("warn");
    expect(toneForStage("blocked")).toBe("fail");
    expect(toneForStage("pending")).toBe("idle");
  });

  it("gives every stage state a distinguishing glyph", () => {
    const glyphs = (["complete", "active", "blocked", "pending"] as const).map(glyphFor);
    expect(new Set(glyphs).size).toBe(4);
    expect(glyphFor("complete")).toBe("✔");
    expect(glyphFor("active")).toBe("◐");
    expect(glyphFor("blocked")).toBe("⚠");
    expect(glyphFor("pending")).toBe("○");
  });

  it("gives every stage state a word, so colour is never the only signal", () => {
    for (const s of ["complete", "active", "blocked", "pending"] as const) {
      expect(stageLabel(s).length).toBeGreaterThan(0);
    }
  });
});

describe("record status", () => {
  it("treats attestation-pending as a warning, not a pass", () => {
    expect(toneForRecord("submitted")).toBe("warn");
    expect(toneForRecord("attested")).toBe("pass");
  });

  it("only calls a report final when the caller says it is final", () => {
    expect(recordStateFromReport("attested", true)).toBe("final");
    expect(recordStateFromReport("attested", false)).toBe("attested");
    expect(recordStateFromReport("draft", false)).toBe("draft");
  });

  it("maps scan statuses case-insensitively and never throws on the unknown", () => {
    expect(recordStateFromScan("RUNNING")).toBe("running");
    expect(recordStateFromScan("completed")).toBe("passed");
    expect(recordStateFromScan("FAILED")).toBe("failed");
    expect(recordStateFromScan("SOMETHING_NEW")).toBe("unknown");
  });

  it("exposes a tone class for every tone", () => {
    for (const tone of ["pass", "warn", "fail", "idle", "accent"] as const) {
      expect(TONE_CLASS[tone]).toBe(`tone-${tone}`);
    }
    expect(recordLabel("final")).toBe("Final");
  });
});
