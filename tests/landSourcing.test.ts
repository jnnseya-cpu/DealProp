import { describe, expect, it } from "vitest";
import {
  assessLandSite,
  developmentPotential,
  eligibleStructures,
  hardConstraints,
  sourcingRoute,
  BLOCKED_SCORE_CAP,
  DENSITY_BANDS,
} from "@shared/domain/land/sourcing";
import type { LandSite } from "@shared/domain/land/types";

const site = (over: Partial<LandSite> = {}): LandSite => ({
  id: "site_1",
  postcodeArea: "CV",
  locality: "Kenilworth",
  areaHectares: 1,
  currentUse: "agricultural",
  settlement: "suburban",
  planningStatus: "none",
  constraints: [],
  ownerKnown: true,
  openlyMarketed: false,
  ...over,
});

describe("developmentPotential", () => {
  it("derives units from area, net factor and density band", () => {
    // 1 ha, suburban (38 dph), <2ha factor 0.75 → 1*0.75*38 = 28.5 → 29
    const p = developmentPotential(site({ areaHectares: 1, settlement: "suburban" }));
    expect(p.densityPerHectare).toBe(DENSITY_BANDS.suburban);
    expect(p.units).toBe(29);
    expect(p.fromConsent).toBe(false);
  });

  it("uses the consented count when a consent exists", () => {
    const p = developmentPotential(site({ planningStatus: "full", consentedUnits: 12 }));
    expect(p.units).toBe(12);
    expect(p.fromConsent).toBe(true);
  });

  it("applies a smaller net factor to larger strategic sites", () => {
    const small = developmentPotential(site({ areaHectares: 0.4, settlement: "urban" })).units;
    const strategic = developmentPotential(site({ areaHectares: 10, settlement: "urban" })).units;
    // 0.4ha*0.9*65 = 23.4 → 23 ; 10ha*0.55*65 = 357.5 → 358
    expect(small).toBe(23);
    expect(strategic).toBe(358);
  });
});

describe("hardConstraints / vetoes", () => {
  it("treats green belt and flood zone 3 as hard even if marked soft", () => {
    const v = hardConstraints(site({ constraints: [{ code: "green-belt", severity: "soft" }] }));
    expect(v).toContain("green-belt");
  });

  it("respects an explicitly hard constraint", () => {
    const v = hardConstraints(site({ constraints: [{ code: "covenant-restriction", severity: "hard" }] }));
    expect(v).toContain("covenant-restriction");
  });

  it("does not treat a soft conservation area as hard", () => {
    const v = hardConstraints(site({ constraints: [{ code: "conservation-area", severity: "soft" }] }));
    expect(v).toHaveLength(0);
  });
});

describe("eligibleStructures", () => {
  it("a consented site is a direct purchase (ready)", () => {
    const r = eligibleStructures(site({ planningStatus: "full" }));
    expect(r.structures).toEqual(["direct-purchase"]);
    expect(r.riskBand).toBe("ready");
  });

  it("allocated land suits option / conditional / promotion (promotable)", () => {
    const r = eligibleStructures(site({ planningStatus: "allocated" }));
    expect(r.structures).toEqual(["option", "conditional-contract", "promotion-agreement"]);
    expect(r.riskBand).toBe("promotable");
  });

  it("greenfield with no allocation suits option / promotion only (strategic)", () => {
    const r = eligibleStructures(site({ planningStatus: "none" }));
    expect(r.structures).toEqual(["option", "promotion-agreement"]);
    expect(r.riskBand).toBe("strategic");
    expect(r.structures).not.toContain("conditional-contract");
  });

  it("a hard constraint blocks every structure", () => {
    const r = eligibleStructures(site({ planningStatus: "allocated", constraints: [{ code: "sssi", severity: "hard" }] }));
    expect(r.structures).toEqual([]);
    expect(r.riskBand).toBe("blocked");
  });

  it("a lapsed consent is promotable via option or conditional", () => {
    const r = eligibleStructures(site({ planningStatus: "lapsed" }));
    expect(r.structures).toEqual(["option", "conditional-contract"]);
  });
});

describe("sourcingRoute", () => {
  it("routes a marketed consented plot to agent/auction", () => {
    expect(sourcingRoute(site({ planningStatus: "full", openlyMarketed: true }))).toBe("agent-or-auction");
  });
  it("routes off-market strategic land to an owner approach", () => {
    expect(sourcingRoute(site({ planningStatus: "none", openlyMarketed: false }))).toBe("owner-approach");
  });
  it("blocks a hard-constrained site", () => {
    expect(sourcingRoute(site({ constraints: [{ code: "green-belt", severity: "hard" }] }))).toBe("blocked");
  });
});

describe("assessLandSite", () => {
  it("scores a consented, marketed, unconstrained plot highly", () => {
    const a = assessLandSite(site({ planningStatus: "full", consentedUnits: 20, openlyMarketed: true }));
    expect(a.riskBand).toBe("ready");
    expect(a.route).toBe("agent-or-auction");
    expect(a.sourceabilityScore).toBeGreaterThan(80);
    expect(a.vetoes).toHaveLength(0);
  });

  it("caps a blocked site's score however good it otherwise looks", () => {
    const a = assessLandSite(
      site({ planningStatus: "full", consentedUnits: 50, settlement: "urban", constraints: [{ code: "flood-zone-3", severity: "hard" }] }),
    );
    expect(a.vetoes).toContain("flood-zone-3");
    expect(a.sourceabilityScore).toBeLessThanOrEqual(BLOCKED_SCORE_CAP);
    expect(a.structures).toEqual([]);
  });

  it("publishes its reasoning and never a bare number", () => {
    const a = assessLandSite(site({ planningStatus: "allocated" }));
    expect(a.reasons.length).toBeGreaterThan(0);
    expect(a.potential.reasoning).toMatch(/indicative/);
  });

  it("gives an unallocated greenfield a strategic, owner-approach profile", () => {
    const a = assessLandSite(site({ planningStatus: "none", areaHectares: 3, settlement: "edge-of-settlement" }));
    expect(a.riskBand).toBe("strategic");
    expect(a.route).toBe("owner-approach");
    expect(a.structures).toContain("option");
    expect(a.structures).toContain("promotion-agreement");
  });
});
