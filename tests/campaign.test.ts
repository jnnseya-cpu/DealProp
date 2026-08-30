import { describe, expect, it } from "vitest";
import {
  BUSINESS_HOURS,
  DEFAULT_CAPS,
  outcomeOf,
  windowIsOpen,
  withinCaps,
} from "@shared/domain/campaign";

/**
 * When outreach may go out, and how much of it.
 *
 * Separate from whether a recipient may be written to at all. This is the
 * difference between a considered approach and a campaign somebody reports.
 */

describe("the send window", () => {
  it("is open in the middle of a working day", () => {
    // Wednesday 11:00 UTC.
    expect(windowIsOpen(new Date("2026-08-26T11:00:00Z")).open).toBe(true);
  });

  it("is shut at three on a Sunday morning", () => {
    // The hour that makes a message unmistakably a bulk send.
    const decision = windowIsOpen(new Date("2026-08-30T03:00:00Z"));
    expect(decision.open).toBe(false);
    expect(decision.nextOpenAt).toBeDefined();
  });

  it("is shut before nine and at five", () => {
    expect(windowIsOpen(new Date("2026-08-26T08:59:00Z")).open).toBe(false);
    expect(windowIsOpen(new Date("2026-08-26T17:00:00Z")).open).toBe(false);
    expect(windowIsOpen(new Date("2026-08-26T16:59:00Z")).open).toBe(true);
  });

  it("is shut at the weekend", () => {
    for (const day of ["2026-08-29T11:00:00Z", "2026-08-30T11:00:00Z"]) {
      expect(windowIsOpen(new Date(day)).open, day).toBe(false);
    }
  });

  it("says when it next opens, and that moment is inside the window", () => {
    const decision = windowIsOpen(new Date("2026-08-29T11:00:00Z"));
    expect(decision.nextOpenAt).toBeDefined();
    expect(windowIsOpen(new Date(decision.nextOpenAt ?? "")).open).toBe(true);
  });

  it("uses hours a person would send in", () => {
    expect(BUSINESS_HOURS.startHour).toBe(9);
    expect(BUSINESS_HOURS.endHour).toBe(17);
    expect(BUSINESS_HOURS.days).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("frequency caps", () => {
  const now = new Date("2026-08-26T11:00:00Z");
  const sent = (to: string, daysAgo: number) => ({
    to,
    sentAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  });

  it("allows a first approach", () => {
    expect(withinCaps("a@lender.co.uk", [], now).allowed).toBe(true);
  });

  it("stops after the third message to one address", () => {
    // A firm that has ignored three is telling us something.
    const history = [sent("a@lender.co.uk", 30), sent("a@lender.co.uk", 20), sent("a@lender.co.uk", 10)];
    const decision = withinCaps("a@lender.co.uk", history, now);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("telling us something");
  });

  it("stops a domain being written to department by department", () => {
    const history = Array.from({ length: DEFAULT_CAPS.perDomainPerWindow }, (_, i) =>
      sent(`person${i}@lender.co.uk`, 1),
    );
    const decision = withinCaps("another@lender.co.uk", history, now);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("reads as a campaign");
  });

  it("lets the domain window expire", () => {
    const old = Array.from({ length: 9 }, (_, i) => sent(`p${i}@lender.co.uk`, 60));
    expect(withinCaps("new@lender.co.uk", old, now).allowed).toBe(true);
  });

  it("counts addresses case-insensitively", () => {
    const history = [sent("A@Lender.co.uk", 1), sent("a@lender.co.uk", 2), sent("a@LENDER.co.uk", 3)];
    expect(withinCaps("a@lender.co.uk", history, now).allowed).toBe(false);
  });
});

describe("delivery events", () => {
  it("suppresses on a complaint, with no threshold and no review", () => {
    // Somebody pressed "this is spam". There is no version of that signal that
    // means write again.
    const outcome = outcomeOf("complained");
    expect(outcome.suppress).toBe(true);
    expect(outcome.reason).toContain("never weighed");
  });

  it("suppresses on a hard bounce to protect the sending domain", () => {
    const outcome = outcomeOf("bounced");
    expect(outcome.suppress).toBe(true);
    expect(outcome.reason).toContain("everybody");
  });

  it("suppresses on an unsubscribe", () => {
    expect(outcomeOf("unsubscribed").suppress).toBe(true);
  });

  it("does not suppress on a successful delivery", () => {
    expect(outcomeOf("delivered").suppress).toBe(false);
  });
});
