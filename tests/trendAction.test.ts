import { describe, expect, it } from "vitest";
import {
  approvalMatches,
  approveAction,
  canonicalPayloadHash,
  canTransition,
  deriveIdempotencyKey,
  guardExecution,
  guardRollback,
  validateProposedAction,
  type ProposedAction,
} from "@shared/domain/trend/action";

const action = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  tenantId: "inst_a",
  platformId: "fixture_platform_a",
  briefId: "gb_104",
  briefVersion: 3,
  actionKind: "seo_metadata_patch",
  channel: "seo",
  targetId: "asset_onboarding_page",
  expectedTargetRevision: "rev_7",
  patch: { title: "Simpler team onboarding", description: "Set up a small team fast" },
  evidenceIds: ["ev_341"],
  approvedClaimIds: ["claim_onboarding_01"],
  actionExpiry: "2026-11-17T10:00:00Z",
  ...over,
});

describe("validateProposedAction (§18, TI-06)", () => {
  it("accepts an allowlisted metadata patch", () => {
    expect(validateProposedAction(action()).ok).toBe(true);
  });

  it("rejects an unknown action kind", () => {
    const r = validateProposedAction(action({ actionKind: "wire_transfer" as never }));
    expect(r.ok).toBe(false);
  });

  it("rejects a forbidden field (canonical/redirect/robots)", () => {
    const r = validateProposedAction(action({ patch: { title: "x", canonical: "/elsewhere" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "patch.canonical")).toBe(true);
  });

  it("rejects a field not in the allowlist", () => {
    const r = validateProposedAction(action({ patch: { price: "0" } }));
    expect(r.ok).toBe(false);
  });

  it("rejects an empty patch and missing evidence", () => {
    expect(validateProposedAction(action({ patch: {} })).ok).toBe(false);
    expect(validateProposedAction(action({ evidenceIds: [] })).ok).toBe(false);
  });
});

describe("canonical hash and idempotency (§6/§18, TI-09)", () => {
  it("is stable across patch key order", () => {
    const a = action({ patch: { title: "A", description: "B" } });
    const b = action({ patch: { description: "B", title: "A" } });
    expect(canonicalPayloadHash(a)).toBe(canonicalPayloadHash(b));
  });

  it("changes when the patch changes", () => {
    expect(canonicalPayloadHash(action({ patch: { title: "A" } }))).not.toBe(
      canonicalPayloadHash(action({ patch: { title: "B" } })),
    );
  });

  it("derives the same idempotency key for the same action (one side effect)", () => {
    expect(deriveIdempotencyKey(action())).toBe(deriveIdempotencyKey(action()));
  });

  it("derives a different key when the target revision changes", () => {
    expect(deriveIdempotencyKey(action({ expectedTargetRevision: "rev_7" }))).not.toBe(
      deriveIdempotencyKey(action({ expectedTargetRevision: "rev_8" })),
    );
  });
});

describe("approveAction and binding (§18, TI-06/TI-08)", () => {
  const now = new Date("2026-11-12T00:00:00Z");

  it("binds approval to the reviewed hash and revision", () => {
    const r = approveAction(action(), { author: "ana", approver: "ben", isLiveChange: true }, 5, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(approvalMatches(action(), r.approval)).toBe(true);
    }
  });

  it("an edit after approval breaks the binding (TI-06)", () => {
    const r = approveAction(action(), { author: "ana", approver: "ben", isLiveChange: true }, 5, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const edited = action({ patch: { title: "Edited after approval", description: "x" } });
      expect(approvalMatches(edited, r.approval)).toBe(false);
    }
  });

  it("rejects self-approval of a live change", () => {
    const r = approveAction(action(), { author: "ana", approver: "ana", isLiveChange: true }, 5, now);
    expect(r.ok).toBe(false);
  });

  it("rejects the shared operator as approver", () => {
    const r = approveAction(action(), { author: "ana", approver: "shared-operator", isLiveChange: true }, 5, now);
    expect(r.ok).toBe(false);
  });
});

describe("guardExecution (§16 execute, TI-05/TI-08)", () => {
  const now = new Date("2026-11-12T00:00:00Z");
  const approval = (() => {
    const r = approveAction(action(), { author: "ana", approver: "ben", isLiveChange: true }, 5, now);
    if (!r.ok) throw new Error("approval failed");
    return r.approval;
  })();

  const ctx = (over = {}) => ({
    approval,
    liveTargetRevision: "rev_7",
    frozen: false,
    briefLive: true,
    now,
    ...over,
  });

  it("allows execution when every guard passes", () => {
    expect(guardExecution(action(), ctx()).allow).toBe(true);
  });

  it("denies a frozen installation", () => {
    expect(guardExecution(action(), ctx({ frozen: true })).allow).toBe(false);
  });

  it("denies an expired brief", () => {
    expect(guardExecution(action(), ctx({ briefLive: false })).allow).toBe(false);
  });

  it("denies an expired action", () => {
    expect(guardExecution(action({ actionExpiry: "2026-11-11T00:00:00Z" }), ctx()).allow).toBe(false);
  });

  it("denies when the target moved since approval (TI-08)", () => {
    expect(guardExecution(action(), ctx({ liveTargetRevision: "rev_8" })).allow).toBe(false);
  });
});

describe("guardRollback (§18, TI-08)", () => {
  it("allows a named rollback when the live revision still matches applied", () => {
    expect(
      guardRollback({ appliedRevision: "rev_9", liveRevision: "rev_9", approver: "ben", author: "ana" }).allow,
    ).toBe(true);
  });
  it("sends a moved asset to conflict review", () => {
    expect(
      guardRollback({ appliedRevision: "rev_9", liveRevision: "rev_10", approver: "ben", author: "ana" }).allow,
    ).toBe(false);
  });
});

describe("state machine (§6)", () => {
  it("permits the happy path", () => {
    expect(canTransition("proposed", "validated")).toBe(true);
    expect(canTransition("approved", "queued")).toBe(true);
    expect(canTransition("executing", "applied")).toBe(true);
    expect(canTransition("applied", "rolled_back")).toBe(true);
  });
  it("forbids skipping approval and reviving a terminal state", () => {
    expect(canTransition("validated", "applied")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("rolled_back", "applied")).toBe(false);
  });
});
