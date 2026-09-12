// customer-ui/src/lib/status.ts
export type Tone = "pass" | "warn" | "fail" | "idle" | "accent";
export type StageState = "complete" | "active" | "pending" | "blocked";
export type RecordState =
  | "passed" | "running" | "failed"
  | "draft" | "submitted" | "attested" | "final"
  | "pending" | "unknown";

export const TONE_CLASS: Record<Tone, string> = {
  pass: "tone-pass", warn: "tone-warn", fail: "tone-fail", idle: "tone-idle", accent: "tone-accent",
};

const STAGE_TONE: Record<StageState, Tone> = {
  complete: "pass", active: "warn", blocked: "fail", pending: "idle",
};
export const toneForStage = (s: StageState): Tone => STAGE_TONE[s];

const STAGE_GLYPH: Record<StageState, string> = {
  complete: "✔", active: "◐", blocked: "⚠", pending: "○",
};
export const glyphFor = (s: StageState): string => STAGE_GLYPH[s];

const STAGE_LABEL: Record<StageState, string> = {
  complete: "Done", active: "In progress", blocked: "Blocked", pending: "Not started",
};
export const stageLabel = (s: StageState): string => STAGE_LABEL[s];

const RECORD_TONE: Record<RecordState, Tone> = {
  passed: "pass", final: "pass", attested: "pass",
  running: "warn", submitted: "warn", pending: "warn",
  failed: "fail",
  draft: "idle", unknown: "idle",
};
export const toneForRecord = (s: RecordState): Tone => RECORD_TONE[s];

const RECORD_LABEL: Record<RecordState, string> = {
  passed: "Passed", running: "Running", failed: "Failed",
  draft: "Draft", submitted: "Awaiting attestation", attested: "Attested", final: "Final",
  pending: "Pending", unknown: "Unavailable",
};
export const recordLabel = (s: RecordState): string => RECORD_LABEL[s];

export function recordStateFromScan(status: string): RecordState {
  switch (status.toUpperCase()) {
    case "RUNNING": return "running";
    case "COMPLETED": return "passed";
    case "FAILED": return "failed";
    case "PENDING": return "pending";
    default: return "unknown";
  }
}

export function recordStateFromReport(status: string, isFinal: boolean): RecordState {
  if (status === "attested") return isFinal ? "final" : "attested";
  if (status === "submitted") return "submitted";
  if (status === "draft") return "draft";
  return "unknown";
}
