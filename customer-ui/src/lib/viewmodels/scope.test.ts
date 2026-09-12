import { describe, it, expect } from "vitest";
import { scopeView } from "./scope";
import type { ScopeSetApi, ScopeVersionApi } from "../api/types";

const version = (over: Partial<ScopeVersionApi> = {}): ScopeVersionApi => ({
  id: "v4",
  scopeSetId: "set1",
  versionNumber: 4,
  status: "approved",
  contentHash: "9f2ca41d",
  submittedAt: null,
  approvedAt: null,
  ...over,
});

const production: ScopeSetApi = { id: "set1", name: "Production", description: null, createdAt: "" };

describe("scopeView", () => {
  it("picks the newest approved version as the one in force", () => {
    const view = scopeView({
      sets: [{ ...production, versions: [version({ id: "v3", versionNumber: 3 }), version()] }],
    });
    expect(view.inForce?.id).toBe("v4");
    expect(view.labelFor(view.inForce!)).toBe("Production — v4");
  });

  it("surfaces a draft separately from history", () => {
    const view = scopeView({
      sets: [
        {
          ...production,
          versions: [version(), version({ id: "v5", versionNumber: 5, status: "draft", approvedAt: null })],
        },
      ],
    });
    expect(view.draft?.id).toBe("v5");
    expect(view.history.map((x) => x.id)).toEqual([]);
  });

  it("treats a submitted version as the draft too, not as history", () => {
    const view = scopeView({
      sets: [{ ...production, versions: [version({ id: "v5", versionNumber: 5, status: "submitted" })] }],
    });
    expect(view.draft?.id).toBe("v5");
    expect(view.history).toEqual([]);
  });

  it("keeps superseded versions in history, newest first", () => {
    const view = scopeView({
      sets: [
        {
          ...production,
          versions: [version({ id: "v2", versionNumber: 2 }), version(), version({ id: "v3", versionNumber: 3 })],
        },
      ],
    });
    expect(view.history.map((x) => x.versionNumber)).toEqual([3, 2]);
  });

  it("has nothing in force for an organisation with no approved version", () => {
    const view = scopeView({
      sets: [{ ...production, versions: [version({ status: "draft" })] }],
    });
    expect(view.inForce).toBeNull();
    expect(view.draft).not.toBeNull();
  });

  it("has nothing at all for an organisation with no scope sets", () => {
    const view = scopeView({ sets: [] });
    expect(view.inForce).toBeNull();
    expect(view.draft).toBeNull();
    expect(view.history).toEqual([]);
  });

  it("spans every set when picking the newest approved version", () => {
    const view = scopeView({
      sets: [
        { ...production, id: "set1", name: "Production", versions: [version({ id: "p3", scopeSetId: "set1", versionNumber: 3 })] },
        {
          id: "set2",
          name: "Staging",
          description: null,
          createdAt: "",
          versions: [version({ id: "s9", scopeSetId: "set2", versionNumber: 9 })],
        },
      ],
    });
    expect(view.inForce?.id).toBe("s9");
    expect(view.labelFor(view.inForce!)).toBe("Staging — v9");
  });
});
