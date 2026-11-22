import type {
  ConstraintCode,
  ControlStructure,
  LandSite,
  PlanningStatus,
  SettlementType,
} from "@shared/domain/land/types";

/**
 * Land sourcing — the deterministic finder.
 *
 * Given a candidate site, it answers the three sourcing questions, each with its
 * reasoning (decision #6) and none of them a price:
 *
 *  1. **What could be built here** — indicative units from the site area and a
 *     settlement-based density band. Clearly an indicative planning rule of
 *     thumb, not a scheme; where a consent already exists, the consented count
 *     is used instead of a guess.
 *  2. **How you'd take control** — which of the four structures is viable
 *     (buy a consented plot; option / conditional / promotion to secure land and
 *     pursue planning), driven by the planning status.
 *  3. **Whether it's worth pursuing** — a 0–100 sourceability score, capped hard
 *     by any constraint that makes a scheme impossible, exactly as Seller
 *     Protection caps a deal (decision #3). A green-belt or flood-zone-3 site is
 *     not a cheap opportunity, it is a blocked one.
 *
 * The density bands and factors are documented constants in one place
 * (centralise-constants), never scattered or guessed per site.
 */

export const LAND_SOURCING_VERSION = "land-sourcing-1";

/** Indicative net dwellings per hectare by settlement context (rule of thumb). */
export const DENSITY_BANDS: Record<SettlementType, number> = {
  urban: 65,
  suburban: 38,
  "edge-of-settlement": 30,
  rural: 22,
};

/**
 * Gross-to-net developable factor by site size: larger sites lose more area to
 * roads, drainage and open space, so a strategic site nets proportionally less.
 */
function netDevelopableFactor(areaHectares: number): number {
  if (areaHectares < 0.5) return 0.9;
  if (areaHectares < 2) return 0.75;
  if (areaHectares < 5) return 0.65;
  return 0.55;
}

/** A consent exists and the principle of development is established. */
function isConsented(status: PlanningStatus): boolean {
  return status === "outline" || status === "reserved-matters" || status === "full";
}

export interface DevelopmentPotential {
  readonly units: number;
  readonly netDevelopableHectares: number;
  readonly densityPerHectare: number;
  /** True when the figure is a consented count rather than a density estimate. */
  readonly fromConsent: boolean;
  readonly reasoning: string;
}

/**
 * Indicative development potential. A consented site reports its consented
 * units; otherwise units are the net developable area times the settlement
 * density band, rounded. Always indicative — it is a sourcing filter, not a
 * scheme design.
 */
export function developmentPotential(site: LandSite): DevelopmentPotential {
  const density = DENSITY_BANDS[site.settlement];
  if (isConsented(site.planningStatus) && site.consentedUnits !== undefined) {
    return {
      units: site.consentedUnits,
      netDevelopableHectares: site.areaHectares,
      densityPerHectare: density,
      fromConsent: true,
      reasoning: `${site.consentedUnits} units already consented (${site.planningStatus}).`,
    };
  }
  const factor = netDevelopableFactor(site.areaHectares);
  const net = site.areaHectares * factor;
  const units = Math.round(net * density);
  return {
    units,
    netDevelopableHectares: Math.round(net * 100) / 100,
    densityPerHectare: density,
    fromConsent: false,
    reasoning: `~${units} units indicative: ${site.areaHectares} ha × ${factor} net × ${density} dph (${site.settlement}).`,
  };
}

// --- constraints and vetoes ---------------------------------------------------

/** Constraint codes that block a residential scheme on their own, by default. */
const INHERENTLY_HARD: ReadonlySet<ConstraintCode> = new Set<ConstraintCode>([
  "green-belt",
  "flood-zone-3",
  "sssi",
  "ancient-woodland",
  "no-access",
]);

/** The hard constraints on a site: those marked hard, plus the inherently hard. */
export function hardConstraints(site: LandSite): readonly ConstraintCode[] {
  return site.constraints
    .filter((c) => c.severity === "hard" || INHERENTLY_HARD.has(c.code))
    .map((c) => c.code);
}

function softConstraintCount(site: LandSite): number {
  return site.constraints.filter(
    (c) => c.severity === "soft" && !INHERENTLY_HARD.has(c.code),
  ).length;
}

// --- control structures and route ---------------------------------------------

export type RiskBand = "ready" | "promotable" | "strategic" | "blocked";

/**
 * Which control structures are viable for this site, and the risk band. A hard
 * constraint blocks everything (the site is not developable as it stands). A
 * consented site is bought. Allocated or lapsed-consent land suits option /
 * conditional / promotion (planning is probable). Greenfield potential suits
 * option / promotion only — binding a conditional contract on unallocated land
 * takes on too much planning risk.
 */
export function eligibleStructures(site: LandSite): {
  readonly structures: readonly ControlStructure[];
  readonly riskBand: RiskBand;
  readonly reasons: readonly string[];
} {
  const hard = hardConstraints(site);
  if (hard.length > 0) {
    return {
      structures: [],
      riskBand: "blocked",
      reasons: [`blocked by hard constraint(s): ${hard.join(", ")} — no viable scheme as it stands`],
    };
  }

  switch (site.planningStatus) {
    case "full":
    case "reserved-matters":
    case "outline":
      return {
        structures: ["direct-purchase"],
        riskBand: "ready",
        reasons: [`consented (${site.planningStatus}) — buy the plot or trade the consent`],
      };
    case "allocated":
      return {
        structures: ["option", "conditional-contract", "promotion-agreement"],
        riskBand: "promotable",
        reasons: ["allocated in the plan — secure control and deliver consent (option / conditional / promotion)"],
      };
    case "lapsed":
      return {
        structures: ["option", "conditional-contract"],
        riskBand: "promotable",
        reasons: ["a lapsed consent is a strong material consideration — re-consent is likely; option or conditional"],
      };
    case "none":
    case "pre-application":
      return {
        structures: ["option", "promotion-agreement"],
        riskBand: "strategic",
        reasons: ["greenfield potential, no allocation — longer-term option or promotion, higher planning risk"],
      };
    case "refused":
      return {
        structures: ["option"],
        riskBand: "strategic",
        reasons: ["recently refused — only a cheap long option on a materially changed basis makes sense"],
      };
  }
}

export type SourcingRoute = "agent-or-auction" | "owner-approach" | "blocked";

/**
 * How you'd reach this deal. A blocked site has no route. A consented site that
 * is openly marketed goes through the agent or auction; everything else is an
 * off-market owner approach — which runs through the same licensed, lawful
 * owner spine (`owners.ts` + the letter channel), never a scrape.
 */
export function sourcingRoute(site: LandSite): SourcingRoute {
  if (hardConstraints(site).length > 0) return "blocked";
  if (isConsented(site.planningStatus) && site.openlyMarketed) return "agent-or-auction";
  return "owner-approach";
}

// --- sourceability score ------------------------------------------------------

const PLANNING_PROXIMITY: Record<PlanningStatus, number> = {
  full: 100,
  "reserved-matters": 95,
  outline: 85,
  allocated: 65,
  lapsed: 60,
  "pre-application": 40,
  none: 30,
  refused: 15,
};

export const SOURCEABILITY_WEIGHTS = {
  planning: 0.4,
  potential: 0.2,
  constraints: 0.2,
  deliverability: 0.2,
} as const;

/** Cap applied when a hard constraint blocks the site (mirrors decision #3). */
export const BLOCKED_SCORE_CAP = 25;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface LandAssessment {
  readonly site: LandSite;
  readonly potential: DevelopmentPotential;
  readonly structures: readonly ControlStructure[];
  readonly riskBand: RiskBand;
  readonly route: SourcingRoute;
  readonly sourceabilityScore: number;
  readonly vetoes: readonly ConstraintCode[];
  readonly reasons: readonly string[];
  readonly version: string;
}

/**
 * Full sourcing assessment of a candidate site. The score is weighted across
 * planning proximity, scale, constraints and deliverability, and then capped if
 * a hard constraint blocks it — a blocked site can never read as a strong
 * prospect however large or close to a settlement it is.
 */
export function assessLandSite(site: LandSite): LandAssessment {
  const potential = developmentPotential(site);
  const structure = eligibleStructures(site);
  const route = sourcingRoute(site);
  const vetoes = hardConstraints(site);

  const planning = PLANNING_PROXIMITY[site.planningStatus];
  // Scale: credit units up to a point; a 50-unit prospect scores full.
  const potentialScore = clamp(potential.units * 2, 0, 100);
  // Constraints: each soft constraint takes 15 off a clean 100.
  const constraintScore = clamp(100 - softConstraintCount(site) * 15, 0, 100);
  // Deliverability: a known owner and no services/ransom flags.
  const hasServiceFlag = site.constraints.some(
    (c) => c.code === "no-services" || c.code === "ransom-strip" || c.code === "covenant-restriction",
  );
  const deliverability = clamp((site.ownerKnown ? 60 : 30) + (hasServiceFlag ? 0 : 40), 0, 100);

  let score =
    SOURCEABILITY_WEIGHTS.planning * planning +
    SOURCEABILITY_WEIGHTS.potential * potentialScore +
    SOURCEABILITY_WEIGHTS.constraints * constraintScore +
    SOURCEABILITY_WEIGHTS.deliverability * deliverability;

  const reasons = [...structure.reasons];
  if (vetoes.length > 0 && score > BLOCKED_SCORE_CAP) {
    reasons.push(`score capped at ${BLOCKED_SCORE_CAP}: blocked by ${vetoes.join(", ")}`);
    score = BLOCKED_SCORE_CAP;
  }

  return {
    site,
    potential,
    structures: structure.structures,
    riskBand: structure.riskBand,
    route,
    sourceabilityScore: Math.round(score * 10) / 10,
    vetoes,
    reasons,
    version: LAND_SOURCING_VERSION,
  };
}
