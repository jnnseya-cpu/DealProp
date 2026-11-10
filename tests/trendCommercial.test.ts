import { describe, expect, it } from "vitest";
import {
  draftsUsed,
  nextMonthResetUtc,
  releaseDraft,
  reserveDraft,
  settleDraft,
  trendCapabilities,
  TREND_PLAN_LIMITS,
  type MeterEntry,
  type TrendEntitlement,
} from "@shared/domain/trend/commercial";

const ent = (over: Partial<TrendEntitlement> = {}): TrendEntitlement => ({
  customer: "cust_1",
  planKey: "managed_starter",
  planRevision: 1,
  status: "active",
  effectiveFrom: "2026-11-01T00:00:00Z",
  ...over,
});

describe("trendCapabilities (§19/§18, TI-11)", () => {
  it("active and trial are full within caps", () => {
    for (const status of ["active", "trial"] as const) {
      const c = trendCapabilities(ent({ status }));
      expect(c.canIngest && c.canGenerateDraft && c.canApproveWrite && c.canRollback && c.canExport).toBe(true);
      expect(c.draftCap).toBe(TREND_PLAN_LIMITS.managed_starter.draftsPerMonth);
    }
  });

  it("grace and suspended are read/export/rollback only — no ingestion or generation", () => {
    for (const status of ["grace", "suspended"] as const) {
      const c = trendCapabilities(ent({ status }));
      expect(c.canIngest).toBe(false);
      expect(c.canGenerateDraft).toBe(false);
      expect(c.canApproveWrite).toBe(false);
      expect(c.canRollback).toBe(true);
      expect(c.canExport).toBe(true);
    }
  });

  it("ended keeps export and rollback during the recovery window (TI-11)", () => {
    const c = trendCapabilities(
      ent({ status: "ended", recoveryUntil: "2026-12-01T00:00:00Z" }),
      new Date("2026-11-20T00:00:00Z"),
    );
    expect(c.canExport).toBe(true);
    expect(c.canRollback).toBe(true);
    expect(c.canGenerateDraft).toBe(false);
  });

  it("ended after the recovery window permits nothing but pending deletion", () => {
    const c = trendCapabilities(
      ent({ status: "ended", recoveryUntil: "2026-11-10T00:00:00Z" }),
      new Date("2026-11-20T00:00:00Z"),
    );
    expect(c.canExport).toBe(false);
    expect(c.canRollback).toBe(false);
  });
});

describe("draft metering (§19, TI-09)", () => {
  const now = new Date("2026-11-20T12:00:00Z");

  it("counts only settled drafts, never reserved or released", () => {
    const ledger = new Map<string, MeterEntry>([
      ["w1", { workId: "w1", status: "settled" }],
      ["w2", { workId: "w2", status: "reserved" }],
      ["w3", { workId: "w3", status: "released" }],
    ]);
    expect(draftsUsed(ledger)).toBe(1);
  });

  it("reserves when under the cap", () => {
    const ledger = new Map<string, MeterEntry>();
    expect(reserveDraft("w1", ledger, 50, now).status).toBe("reserved");
  });

  it("a replay of the same work id is a duplicate, never a second reservation", () => {
    const ledger = new Map<string, MeterEntry>([["w1", { workId: "w1", status: "reserved" }]]);
    expect(reserveDraft("w1", ledger, 50, now).status).toBe("duplicate");
  });

  it("at the cap nothing reserves and a reset instant is returned (429)", () => {
    const ledger = new Map<string, MeterEntry>([
      ["a", { workId: "a", status: "settled" }],
      ["b", { workId: "b", status: "settled" }],
    ]);
    const r = reserveDraft("c", ledger, 2, now);
    expect(r.status).toBe("over_cap");
    expect(r.resetAt).toBe("2026-12-01T00:00:00Z");
  });

  it("at most one reservation wins the last slot (TI-09)", () => {
    // used = cap - 1. First reserve succeeds; once it settles, the next is over cap.
    const ledger = new Map<string, MeterEntry>([["a", { workId: "a", status: "settled" }]]);
    expect(reserveDraft("b", ledger, 2, now).status).toBe("reserved");
    const settled = settleDraft({ workId: "b", status: "reserved" });
    expect(settled?.status).toBe("settled");
    if (settled) ledger.set("b", settled);
    expect(reserveDraft("c", ledger, 2, now).status).toBe("over_cap");
  });

  it("settles a reserved draft once, idempotently; a released slot cannot settle", () => {
    expect(settleDraft({ workId: "w", status: "reserved" })?.status).toBe("settled");
    expect(settleDraft({ workId: "w", status: "settled" })?.status).toBe("settled");
    expect(settleDraft({ workId: "w", status: "released" })).toBeUndefined();
  });

  it("releases a reserved draft but never a settled one", () => {
    expect(releaseDraft({ workId: "w", status: "reserved" })?.status).toBe("released");
    expect(releaseDraft({ workId: "w", status: "settled" })?.status).toBe("settled");
  });

  it("rolls the reset to next January across a December boundary", () => {
    expect(nextMonthResetUtc(new Date("2026-12-15T00:00:00Z"))).toBe("2027-01-01T00:00:00Z");
  });
});
