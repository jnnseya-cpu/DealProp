import { describe, expect, it } from "vitest";
import {
  routeAllSourcing,
  routeSourcing,
  sourcingRoute,
  SOURCING_ROUTES,
  SOURCING_RULES,
  type SourcingFacts,
} from "@shared/domain/sourcing";
import { resolveCitation } from "@shared/domain/citations";
import { feeAmount, feeDefinition } from "@shared/domain/fees";
import { sourcingFee, sourcingFeeBand, SOURCING_FEE_BANDS } from "@shared/domain/pricing";
import { fromMajor, toMajor } from "@shared/money";
import { STREAMS } from "@shared/domain/revenue";

const AGENCY = ["estate-agency-aml", "redress-scheme"] as const;

const CONFIRMED = {
  firm: "Example LLP",
  solicitor: "A Solicitor",
  at: "2026-10-01T00:00:00.000Z",
  confirms: "Schedule 2A relief is claimable on these facts and we will file the return.",
};

/** Everything recorded. The only thing left open is counsel approval. */
function clean(overrides: Partial<Omit<SourcingFacts, "route">> = {}): Omit<SourcingFacts, "route"> {
  return {
    permissionsHeld: [...AGENCY],
    sellerIsConsumer: true,
    conflictDisclosedToSeller: true,
    investorFundsEvidenced: true,
    feeTakenBeforeCompletion: false,
    upliftDisclosedToSeller: true,
    conveyancer: CONFIRMED,
    ...overrides,
  };
}

describe("the sourcing register", () => {
  it("records a route that never owns the property", () => {
    expect(SOURCING_ROUTES.length).toBeGreaterThanOrEqual(3);
    for (const route of SOURCING_ROUTES) {
      // The whole category. If a route owned it, it would be an acquisition
      // structure and belong in StructureKind instead.
      expect(route.weOwnIt, route.route).toBe(false);
      expect(route.paidBy, route.route).toBe("investor");
      // Due on completion, on every route, with no other value expressible.
      expect(route.dueOn, route.route).toBe("completion");
      expect(route.principalRisk.length, route.route).toBeGreaterThan(40);
      expect(route.contractRequirements.length, route.route).toBeGreaterThan(0);
    }
  });

  it("treats every route as estate agency work", () => {
    // s.1 covers a client who wishes to acquire as well as one who wishes to
    // dispose, so acting for the investor is not an escape. Identical on all
    // three, and that is the finding rather than an oversight.
    for (const route of SOURCING_ROUTES) {
      expect([...route.requiresPermissions].sort(), route.route).toEqual([...AGENCY].sort());
    }
  });

  it("cites a source that resolves, on every route", () => {
    for (const route of SOURCING_ROUTES) {
      expect(route.citations.length, route.route).toBeGreaterThanOrEqual(3);
      for (const key of route.citations) {
        expect(resolveCitation(key).url).toMatch(/^https:\/\//);
      }
    }
  });

  it("throws rather than guessing on an unknown route", () => {
    // @ts-expect-error — the point is the runtime behaviour on bad input.
    expect(() => sourcingRoute("rent-to-rent")).toThrow(/No sourcing route/);
  });

  it("says plainly that it has not been through legal review", () => {
    expect(SOURCING_RULES.requiresCounselApproval).toBe(true);
    expect(SOURCING_RULES.citation).toContain("Estate Agents Act 1979 s.1");
  });
});

describe("routeSourcing", () => {
  it("refuses without the agency permissions, whatever else is recorded", () => {
    for (const route of SOURCING_ROUTES) {
      const decision = routeSourcing({ ...clean({ permissionsHeld: [] }), route: route.route });
      expect(decision.ruling, route.route).toBe("REFUSED");
      expect(decision.blockers.some((b) => b.reason.includes("estate-agency-aml"))).toBe(true);
      // The remedy has to say why "I act for the buyer" is not a way out,
      // because that is the belief this blocker exists to correct.
      expect(decision.blockers[0]?.remedy).toContain("wishes to acquire");
    }
  });

  it("refuses a fee taken before completion, on every route", () => {
    for (const route of SOURCING_ROUTES) {
      const decision = routeSourcing({
        ...clean({ feeTakenBeforeCompletion: true }),
        route: route.route,
      });
      expect(decision.ruling, route.route).toBe("REFUSED");
      expect(decision.blockers.some((b) => b.reason.includes("before completion"))).toBe(true);
    }
  });

  it("refuses an undisclosed fee where the seller is a consumer", () => {
    const decision = routeSourcing({
      ...clean({ conflictDisclosedToSeller: false }),
      route: "sourcing-fee",
    });
    expect(decision.ruling).toBe("REFUSED");
    expect(decision.blockers.some((b) => b.remedy.includes("s.18"))).toBe(true);
  });

  it("does not require seller disclosure where the seller is a business", () => {
    // s.18 protects a client; a company selling an investment asset is not in
    // the position the consumer provisions exist for. It is still disclosed in
    // practice — this is about what the gate refuses, not about good manners.
    const decision = routeSourcing({
      ...clean({ sellerIsConsumer: false, conflictDisclosedToSeller: false }),
      route: "sourcing-fee",
    });
    expect(decision.blockers).toHaveLength(0);
  });

  it("refuses assignment and sub-sale with no conveyancer confirmation", () => {
    for (const route of ["assignment", "back-to-back"] as const) {
      const decision = routeSourcing({ ...clean({ conveyancer: undefined }), route });
      expect(decision.ruling, route).toBe("REFUSED");
      const blocker = decision.blockers.find((b) => b.reason.includes("conveyancer"));
      // And it must say the engine will not compute it, so nobody goes looking
      // for the calculation that was deliberately not written.
      expect(blocker?.remedy).toContain("does not compute");
    }
  });

  it("does not demand a conveyancer on the simple route", () => {
    // There is no pre-completion transaction to get wrong, so insisting would
    // be ceremony. The register says so in needsConveyancerConfirmation.
    expect(sourcingRoute("sourcing-fee").needsConveyancerConfirmation).toBe(false);
    const decision = routeSourcing({ ...clean({ conveyancer: undefined }), route: "sourcing-fee" });
    expect(decision.blockers).toHaveLength(0);
  });

  it("refuses to exchange before the investor's money is evidenced", () => {
    for (const route of ["assignment", "back-to-back"] as const) {
      const decision = routeSourcing({ ...clean({ investorFundsEvidenced: false }), route });
      expect(decision.ruling, route).toBe("REFUSED");
      // This is the "left holding the property" risk, and the remedy says so.
      expect(decision.blockers.some((b) => b.remedy.includes("cannot fund"))).toBe(true);
    }
  });

  it("sends an undisclosed sub-sale uplift to a person, not to a rule", () => {
    const decision = routeSourcing({
      ...clean({ upliftDisclosedToSeller: false }),
      route: "back-to-back",
    });
    // Review rather than refused: whether disclosure is legally required is
    // genuinely arguable, and a rule that pretended otherwise would be wrong
    // in one direction or the other.
    expect(decision.ruling).toBe("REVIEW");
    expect(decision.reviews.some((r) => r.reason.includes("higher price"))).toBe(true);
  });

  it("holds everything at review while counsel approval is outstanding", () => {
    // Nothing reaches PERMITTED today, and that is correct: the rule set has
    // not been reviewed. The test pins the reason rather than the ruling, so
    // it keeps working when the flag is cleared.
    for (const decision of routeAllSourcing(clean())) {
      expect(decision.blockers).toHaveLength(0);
      expect(decision.ruling).toBe("REVIEW");
      expect(decision.reviews.some((r) => r.reason.includes("counsel"))).toBe(true);
    }
  });

  it("rules on every route from one set of facts", () => {
    const all = routeAllSourcing(clean());
    expect(all).toHaveLength(SOURCING_ROUTES.length);
    expect(new Set(all.map((d) => d.route.route)).size).toBe(SOURCING_ROUTES.length);
  });
});

describe("the sourcing fee", () => {
  it("is owned by pricing.ts and by nothing else", () => {
    // The amount comes from the band, not from the fee engine restating a rate.
    const price = fromMajor(400_000);
    expect(toMajor(sourcingFee(price, "percentage"))).toBe(
      toMajor(feeAmount("sourcing-fee", { appraisal: { inputs: { purchasePrice: price } } } as never)),
    );
  });

  it("applies the floor then the cap", () => {
    const band = sourcingFeeBand("percentage");
    // A small purchase pays the minimum rather than the percentage.
    expect(sourcingFee(fromMajor(50_000), "percentage")).toBe(band.minimum);
    // A large one pays the cap rather than the percentage.
    expect(sourcingFee(fromMajor(5_000_000), "percentage")).toBe(band.maximum);
  });

  it("offers a fixed shape for deals a percentage does not cover", () => {
    expect(SOURCING_FEE_BANDS.map((b) => b.shape)).toContain("fixed");
    expect(sourcingFee(fromMajor(90_000), "fixed")).toBe(sourcingFeeBand("fixed").minimum);
    for (const band of SOURCING_FEE_BANDS) expect(band.suits.length).toBeGreaterThan(30);
  });

  it("falls due on completion and at no other stage", () => {
    const definition = feeDefinition("sourcing-fee");
    expect(definition.dueAt).toEqual(["completed"]);
    expect(definition.payer).toBe("buyer");
    expect(definition.requiresSellerDisclosure).toBe(true);
    expect([...definition.requiresPermissions].sort()).toEqual([...AGENCY].sort());
  });

  it("is excluded from the revenue model until the permissions are recorded", () => {
    const stream = STREAMS.find((s) => s.key === "sourcing-fee");
    expect(stream).toBeDefined();
    expect([...(stream?.requiresPermissions ?? [])].sort()).toEqual([...AGENCY].sort());
  });
});
