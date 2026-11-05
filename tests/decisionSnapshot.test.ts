import { describe, expect, it } from "vitest";
import { fromMajor } from "@shared/money";
import { buildDecisionOutput } from "@shared/domain/decisionOutput";
import {
  createDecisionSnapshot,
  isSnapshotReadable,
  revokeSnapshot,
  SNAPSHOT_TTL_DAYS,
  type CreateSnapshotInput,
} from "@shared/domain/decisionSnapshot";

const decision = buildDecisionOutput({
  investigationPriority: ["Returned and reduced."],
  basePence: fromMajor(30_000),
  downsidePence: fromMajor(5_000),
  maxSupportedPricePence: fromMajor(200_000),
  currentAskPence: fromMajor(190_000),
  executionBlockers: [{ label: "Tenure confirmed", cleared: true }],
  evidenceCoverage: { confirmed: 5, userReported: 0, inferred: 0, missing: [] },
  inputsComplete: true,
});

function base(over: Partial<CreateSnapshotInput> = {}): CreateSnapshotInput {
  return {
    id: "snap-1",
    tenantId: "lode",
    subjectId: "deal-1",
    subjectType: "deal",
    actorId: "op-1",
    evidenceSetVersion: "ev-7",
    calculationIds: ["calc-1"],
    decision,
    visibility: "reviewer",
    createdAt: "2026-06-15T09:00:00.000Z",
    permitted: true,
    publicationGatesClear: true,
    ...over,
  };
}

describe("createDecisionSnapshot (§5)", () => {
  it("publishes a permitted, gate-clear snapshot with a TTL", () => {
    const r = createDecisionSnapshot(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expectedExpiry = new Date(new Date(base().createdAt).getTime() + SNAPSHOT_TTL_DAYS * 86_400_000).toISOString();
    expect(r.snapshot.expiresAt).toBe(expectedExpiry);
    expect(r.snapshot.revoked).toBe(false);
  });

  it("refuses to publish when the actor is not permitted", () => {
    const r = createDecisionSnapshot(base({ permitted: false }));
    expect(r.ok).toBe(false);
  });

  it("refuses to publish beyond private with an unresolved publication gate", () => {
    expect(createDecisionSnapshot(base({ publicationGatesClear: false })).ok).toBe(false);
    // ...but private is always allowed.
    expect(createDecisionSnapshot(base({ publicationGatesClear: false, visibility: "private" })).ok).toBe(true);
  });
});

describe("readability, expiry and revocation (IND14)", () => {
  const snap = (() => {
    const r = createDecisionSnapshot(base());
    if (!r.ok) throw new Error("expected ok");
    return r.snapshot;
  })();

  it("is readable before expiry and not after", () => {
    expect(isSnapshotReadable(snap, new Date("2026-06-20T00:00:00.000Z"))).toBe(true);
    expect(isSnapshotReadable(snap, new Date("2026-08-20T00:00:00.000Z"))).toBe(false);
  });

  it("is not readable once revoked, whatever the date (withdrawn source)", () => {
    const revoked = revokeSnapshot(snap);
    expect(revoked.revoked).toBe(true);
    expect(isSnapshotReadable(revoked, new Date("2026-06-20T00:00:00.000Z"))).toBe(false);
  });
});
