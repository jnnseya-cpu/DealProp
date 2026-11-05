import { describe, expect, it } from "vitest";
import { ALLOWED_NEXT, decideTransition, needsCompletionDate, offeredTransitions, type TransitionFacts } from "@shared/domain/dealTransition";
import type { DealStatus } from "@shared/domain/types";

/**
 * The deal transition guard (§10). The tests that matter: a deal moves one step
 * at a time, completion cannot be recorded without a conveyancer and a date
 * (A16), and withdraw is always available until the deal is terminal.
 */

const PROVEN: TransitionFacts = {
  saleConfirmed: true,
  sellerChecked: true,
  materialComplete: true,
  protectionBlocked: false,
  fundingRecorded: true,
  solicitorInstructed: true,
  completionRecorded: true,
};

describe("the transition ordering", () => {
  it("moves one step forward and never backward or by a skip", () => {
    expect(decideTransition("new", "qualified", PROVEN).ok).toBe(true);
    expect(decideTransition("new", "in-market", PROVEN).ok).toBe(false); // skip
    expect(decideTransition("funded", "in-market", PROVEN).ok).toBe(false); // backward
    expect(decideTransition("new", "new", PROVEN).ok).toBe(false); // no-op
  });

  it("allows withdraw from any live status, and nothing from a terminal one", () => {
    for (const s of ["new", "qualified", "in-market", "funded"] as const) {
      expect(decideTransition(s, "withdrawn", PROVEN).ok).toBe(true);
    }
    expect(ALLOWED_NEXT.completed).toEqual([]);
    expect(ALLOWED_NEXT.withdrawn).toEqual([]);
    expect(offeredTransitions("funded")).toEqual(["completed", "withdrawn"]);
  });
});

describe("the evidence gates", () => {
  it("qualified needs authority verified and the seller checked", () => {
    expect(decideTransition("new", "qualified", { ...PROVEN, saleConfirmed: false }).ok).toBe(false);
    expect(decideTransition("new", "qualified", { ...PROVEN, sellerChecked: false }).ok).toBe(false);
  });

  it("in-market needs a marketable, unblocked opportunity", () => {
    expect(decideTransition("qualified", "in-market", { ...PROVEN, materialComplete: false }).ok).toBe(false);
    const blocked = decideTransition("qualified", "in-market", { ...PROVEN, protectionBlocked: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/Seller Protection/);
  });

  it("funded needs capital behind the price", () => {
    expect(decideTransition("in-market", "funded", { ...PROVEN, fundingRecorded: false }).ok).toBe(false);
    expect(decideTransition("in-market", "funded", PROVEN).ok).toBe(true);
  });

  it("completion needs a conveyancer and a date (A16)", () => {
    expect(decideTransition("funded", "completed", { ...PROVEN, solicitorInstructed: false }).ok).toBe(false);
    const noDate = decideTransition("funded", "completed", { ...PROVEN, completionRecorded: false });
    expect(noDate.ok).toBe(false);
    expect(noDate.reason).toMatch(/completion date/i);
    expect(decideTransition("funded", "completed", PROVEN).ok).toBe(true);
  });

  it("withdraw never needs evidence", () => {
    const nothing: TransitionFacts = {
      saleConfirmed: false, sellerChecked: false, materialComplete: false, protectionBlocked: true,
      fundingRecorded: false, solicitorInstructed: false, completionRecorded: false,
    };
    expect(decideTransition("in-market", "withdrawn", nothing).ok).toBe(true);
  });

  it("flags when a completion date is required", () => {
    expect(needsCompletionDate("completed")).toBe(true);
    for (const s of ["qualified", "in-market", "funded", "withdrawn"] as DealStatus[]) {
      expect(needsCompletionDate(s)).toBe(false);
    }
  });
});
