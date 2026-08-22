import type { PropertyFacts, SellerProfile, SellerSituation } from "@shared/domain/types";

/**
 * Seller diagnostics.
 *
 * A high motivation score is NOT a licence to push a bigger discount. The same
 * signals that raise motivation also raise the vulnerability flags in
 * protection.ts, and the two are read together. Motivation tells the OS how
 * much *flexibility on terms* a seller may have; it never sets the price on
 * its own.
 */

interface SituationProfile {
  /** How pressed the seller typically is, 0-100. */
  readonly baseMotivation: number;
  /** Typical time pressure, 0-100. */
  readonly baseUrgency: number;
  /** Transactional and legal difficulty the situation itself creates, 0-100. */
  readonly baseComplexity: number;
  readonly label: string;
  /** True where the situation is a recognised vulnerability indicator. */
  readonly vulnerabilitySignal: boolean;
}

const SITUATIONS: Record<SellerSituation, SituationProfile> = {
  probate: {
    baseMotivation: 72,
    baseUrgency: 45,
    baseComplexity: 70,
    label: "Probate sale",
    vulnerabilitySignal: false,
  },
  inherited: {
    baseMotivation: 70,
    baseUrgency: 50,
    baseComplexity: 45,
    label: "Inherited property",
    vulnerabilitySignal: false,
  },
  divorce: {
    baseMotivation: 78,
    baseUrgency: 65,
    baseComplexity: 60,
    label: "Divorce or separation",
    vulnerabilitySignal: true,
  },
  relocation: {
    baseMotivation: 62,
    baseUrgency: 70,
    baseComplexity: 25,
    label: "Relocation",
    vulnerabilitySignal: false,
  },
  "landlord-exit": {
    baseMotivation: 58,
    baseUrgency: 40,
    baseComplexity: 40,
    label: "Landlord exiting",
    vulnerabilitySignal: false,
  },
  "problem-tenant": {
    baseMotivation: 80,
    baseUrgency: 60,
    baseComplexity: 78,
    label: "Difficult tenancy",
    vulnerabilitySignal: false,
  },
  "vacant-property": {
    baseMotivation: 66,
    baseUrgency: 42,
    baseComplexity: 38,
    label: "Empty property",
    vulnerabilitySignal: false,
  },
  "needs-major-works": {
    baseMotivation: 74,
    baseUrgency: 45,
    baseComplexity: 62,
    label: "Property needs substantial work",
    vulnerabilitySignal: false,
  },
  "chain-collapse": {
    baseMotivation: 84,
    baseUrgency: 88,
    baseComplexity: 30,
    label: "Chain collapsed",
    vulnerabilitySignal: false,
  },
  "failed-listing": {
    baseMotivation: 68,
    baseUrgency: 48,
    baseComplexity: 35,
    label: "Failed to sell on the open market",
    vulnerabilitySignal: false,
  },
  "mortgage-arrears": {
    baseMotivation: 90,
    baseUrgency: 88,
    baseComplexity: 55,
    label: "Mortgage arrears",
    vulnerabilitySignal: true,
  },
  "repossession-threat": {
    baseMotivation: 96,
    baseUrgency: 96,
    baseComplexity: 72,
    label: "Repossession proceedings",
    vulnerabilitySignal: true,
  },
  "auction-alternative": {
    baseMotivation: 82,
    baseUrgency: 80,
    baseComplexity: 45,
    label: "Auction alternative",
    vulnerabilitySignal: false,
  },
  "portfolio-disposal": {
    baseMotivation: 55,
    baseUrgency: 35,
    baseComplexity: 68,
    label: "Portfolio disposal",
    vulnerabilitySignal: false,
  },
  "development-exit": {
    baseMotivation: 70,
    baseUrgency: 62,
    baseComplexity: 85,
    label: "Development exit",
    vulnerabilitySignal: false,
  },
  "urgent-cash-need": {
    baseMotivation: 92,
    baseUrgency: 92,
    baseComplexity: 30,
    label: "Urgent cash requirement",
    vulnerabilitySignal: true,
  },
  downsizing: {
    baseMotivation: 48,
    baseUrgency: 30,
    baseComplexity: 25,
    label: "Downsizing",
    vulnerabilitySignal: false,
  },
};

export interface SellerDiagnostics {
  readonly situationLabel: string;
  readonly motivation: number;
  readonly urgency: number;
  readonly complexity: number;
  /** How strongly the seller favours terms over headline price, 0-100. */
  readonly priorityFlexibility: number;
  readonly signals: readonly string[];
  /** True where the situation itself is a recognised vulnerability indicator. */
  readonly vulnerabilitySignal: boolean;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export function diagnoseSeller(
  seller: SellerProfile,
  property: PropertyFacts,
): SellerDiagnostics {
  const profile = SITUATIONS[seller.situation];
  const signals: string[] = [`Situation: ${profile.label}`];

  let motivation = profile.baseMotivation;
  let urgency = profile.baseUrgency;
  let complexity = profile.baseComplexity;

  // A stated deadline is the strongest single urgency signal a seller gives.
  if (seller.targetDays !== undefined) {
    if (seller.targetDays <= 21) {
      urgency += 18;
      motivation += 10;
      signals.push(`Stated deadline of ${seller.targetDays} days`);
    } else if (seller.targetDays <= 45) {
      urgency += 10;
      motivation += 5;
      signals.push(`Stated deadline of ${seller.targetDays} days`);
    } else if (seller.targetDays >= 120) {
      urgency -= 12;
      signals.push("No near-term deadline — open-market sale may serve better");
    }
  }

  // A seller who has already discounted against open market value is telling
  // the OS what they will accept more reliably than any stated priority.
  if (seller.priceExpectation !== undefined && property.openMarketValue > 0) {
    const discountBps = Math.round(
      ((property.openMarketValue - seller.priceExpectation) / property.openMarketValue) * 10_000,
    );
    if (discountBps >= 1_500) {
      motivation += 12;
      signals.push(`Expectation already ${(discountBps / 100).toFixed(1)}% below market value`);
    } else if (discountBps <= 0) {
      motivation -= 15;
      signals.push("Expectation at or above market value — limited flexibility");
    }
  }

  // Priorities are self-reported, so they move the score less than behaviour.
  const priorityWeights: Record<string, number> = {
    speed: 22,
    certainty: 18,
    convenience: 14,
    flexibility: 12,
    price: -25,
  };
  let priorityFlexibility = 50;
  for (const priority of seller.priorities) {
    priorityFlexibility += priorityWeights[priority] ?? 0;
  }
  if (seller.priorities.includes("price")) {
    signals.push("Seller prioritises price — creative structures may not suit");
    motivation -= 10;
  }
  if (seller.priorities.includes("speed") || seller.priorities.includes("certainty")) {
    motivation += 6;
  }

  // Property condition and title problems make the open market a poor route,
  // which raises effective motivation regardless of the seller's temperament.
  complexity += property.knownIssues.length * 6;
  if (property.knownIssues.length > 0) {
    signals.push(`${property.knownIssues.length} known property issue(s)`);
  }
  if (property.occupancy === "tenanted-arrears") {
    complexity += 15;
    motivation += 8;
    signals.push("Tenant in arrears");
  }
  if (property.tenure === "leasehold" && (property.leaseYearsRemaining ?? 999) < 70) {
    complexity += 18;
    signals.push(`Short lease: ${property.leaseYearsRemaining} years remaining`);
  }
  if (property.refurbishmentEstimate > property.openMarketValue * 0.2) {
    complexity += 12;
    motivation += 6;
    signals.push("Works exceed 20% of market value");
  }

  return {
    situationLabel: profile.label,
    motivation: clamp(motivation),
    urgency: clamp(urgency),
    complexity: clamp(complexity),
    priorityFlexibility: clamp(priorityFlexibility),
    signals,
    vulnerabilitySignal: profile.vulnerabilitySignal,
  };
}

export function situationLabel(situation: SellerSituation): string {
  return SITUATIONS[situation].label;
}

export function allSituations(): readonly SellerSituation[] {
  return Object.keys(SITUATIONS) as SellerSituation[];
}
