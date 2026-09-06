import { describe, expect, it } from "vitest";
import {
  CHECK_VALID_MONTHS,
  describe as describeCheck,
  isClear,
  isCurrent,
  isUsable,
  manualCheck,
  requestProblem,
  type CheckResult,
  type ScreeningRequest,
} from "@shared/domain/screening";
import { configuredProvider, runCheck } from "@backend/screening";

/**
 * Identity and sanctions screening.
 *
 * Both the passport and the seller's due diligence turn on a screening date,
 * and until this seam existed that date was typed into a form and the seller's
 * screening was a checkbox. The gates were real; the evidence behind them was
 * an assertion.
 *
 * The tests that matter are the ones proving the closed path refuses. The
 * temptation when a provider is wired in later is to make the no-provider case
 * pass through so nothing breaks in development, and that is exactly how a
 * deployment ends up silently approving everybody.
 */

const NOW = new Date("2026-09-06T00:00:00.000Z");

const request: ScreeningRequest = {
  kind: "sanctions-pep",
  subject: { name: "A Buyer", country: "GB" },
  purpose: "deal-0001",
  requestedBy: "Jo Bloggs",
};

describe("with no provider connected", () => {
  it("is honest that there is none", () => {
    expect(configuredProvider()).toBeUndefined();
  });

  it("returns inconclusive, never clear", async () => {
    // The only thing worse than not screening somebody is a record saying they
    // were screened and found clean when nothing looked.
    const outcome = await runCheck(request);
    expect(outcome.result.outcome).toBe("inconclusive");
    expect(outcome.automated).toBe(false);
    expect(isClear(outcome.result)).toBe(false);
    expect(isUsable(outcome.result, NOW)).toBe(false);
  });

  it("tells the operator what to do instead", async () => {
    const outcome = await runCheck(request);
    expect(outcome.message).toContain("record its reference");
    expect(outcome.message).toContain("clears no gate");
  });
});

describe("refusing a request it cannot run", () => {
  it("needs a name, because a clear result against nobody is a lie", async () => {
    const nameless = { ...request, subject: { ...request.subject, name: "  " } };
    expect(requestProblem(nameless)).toContain("clear result against nobody");
    expect((await runCheck(nameless)).result.outcome).toBe("inconclusive");
  });

  it("needs a requester and a purpose", () => {
    expect(requestProblem({ ...request, requestedBy: "" })).toContain("named requester");
    expect(requestProblem({ ...request, purpose: "" })).toContain("collection, not diligence");
  });

  it("needs a country for a sanctions check", () => {
    // Without one the match set is either everything or nothing, and both look
    // like an answer.
    const nowhere = { ...request, subject: { name: "A Buyer" } };
    expect(requestProblem(nowhere)).toContain("everything or nothing");
    // Identity does not need one, so the rule is not applied where it does not
    // belong.
    expect(requestProblem({ ...nowhere, kind: "identity" })).toBeUndefined();
  });
});

describe("what counts as a pass", () => {
  const clear = (over: Partial<CheckResult> = {}): CheckResult => ({
    kind: "sanctions-pep",
    outcome: "clear",
    method: "provider",
    at: "2026-08-01T00:00:00.000Z",
    reference: "chk_1",
    recordedBy: "Jo Bloggs",
    ...over,
  });

  it("only clears on clear", () => {
    // A possible match is not a soft pass, and "we could not tell" is not
    // "fine" — the whole reason to screen is the case where it says something.
    expect(isUsable(clear(), NOW)).toBe(true);
    for (const outcome of ["review", "failed", "inconclusive"] as const) {
      expect(isUsable(clear({ outcome }), NOW), outcome).toBe(false);
    }
  });

  it("expires, and refuses a date in the future", () => {
    expect(isCurrent(clear({ at: "2024-01-01T00:00:00.000Z" }), NOW)).toBe(false);
    expect(isCurrent(clear({ at: "2027-01-01T00:00:00.000Z" }), NOW)).toBe(false);
    expect(CHECK_VALID_MONTHS).toBe(12);
  });

  it("treats nothing recorded as not run, not as clear", () => {
    expect(isUsable(undefined, NOW)).toBe(false);
    expect(describeCheck(undefined, NOW)).toBe("Not run.");
  });
});

describe("a manual check is first-class, not a pretence", () => {
  it("records who ran it and what the reference was", () => {
    const result = manualCheck({
      kind: "identity",
      outcome: "clear",
      reference: "ONF-88213",
      recordedBy: "Jo Bloggs",
    });
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;
    expect(result.method).toBe("manual");
    expect(result.reference).toBe("ONF-88213");
  });

  it("refuses without a reference, or it is the tick box it replaces", () => {
    expect(manualCheck({ kind: "identity", outcome: "clear", reference: "  ", recordedBy: "Jo" })).toContain(
      "nothing for anybody to look up",
    );
    expect(manualCheck({ kind: "identity", outcome: "clear", reference: "X", recordedBy: "" })).toContain(
      "has an author",
    );
  });

  it("never hides that a person said so rather than a provider", () => {
    // An operator looking at a clear result is entitled to know which it was.
    // They carry different weight and the difference is invisible otherwise.
    const manual = manualCheck({
      kind: "identity",
      outcome: "clear",
      reference: "ONF-1",
      recordedBy: "Jo",
      at: "2026-08-01T00:00:00.000Z",
    });
    if (typeof manual === "string") throw new Error(manual);
    expect(describeCheck(manual, NOW)).toContain("manually");
    expect(describeCheck({ ...manual, method: "provider" }, NOW)).toContain("by a provider");
  });

  it("says out of date rather than quietly passing a stale check", () => {
    const stale = manualCheck({
      kind: "identity",
      outcome: "clear",
      reference: "ONF-1",
      recordedBy: "Jo",
      at: "2024-01-01T00:00:00.000Z",
    });
    if (typeof stale === "string") throw new Error(stale);
    expect(describeCheck(stale, NOW)).toContain("Out of date");
  });
});

describe("the registry signal is reachable", () => {
  it("is asked for by a page rather than existing untested and uncalled", async () => {
    // `registrySignal.ts` was tested and called by nothing. It is the
    // licensed-sources answer to GoldMine — which reads days on market and
    // agent changes, every one of which can only come from a portal and no
    // portal permits taking. Deleting it would have thrown away the only
    // version of that question we may lawfully ask.
    const { registryFor, clearRegistryCache } = await import("@backend/registry");
    clearRegistryCache();
    const { SEED_DEALS } = await import("@backend/store/seed");

    const lookup = await registryFor(SEED_DEALS[0]!);
    // With no EPC credentials the connector refuses, and that must read as
    // "nothing is known" rather than as a low score.
    expect(lookup.pressure).toBeUndefined();
    expect(lookup.reason).toBeDefined();
  });

  it("caches, so a page render is not an outbound request every time", async () => {
    const { registryFor, clearRegistryCache } = await import("@backend/registry");
    const { SEED_DEALS } = await import("@backend/store/seed");
    clearRegistryCache();

    const first = await registryFor(SEED_DEALS[0]!, 1_000);
    const second = await registryFor(SEED_DEALS[0]!, 1_000);
    // Same object identity: the second call did no work at all.
    expect(second).toBe(first);

    // And it expires, so a certificate lodged tomorrow is eventually seen.
    const later = await registryFor(SEED_DEALS[0]!, 1_000 + 7 * 60 * 60 * 1000);
    expect(later).not.toBe(first);
  });
});
