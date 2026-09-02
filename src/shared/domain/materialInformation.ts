import type { JurisdictionCode, PropertyFacts, Tenure } from "@shared/domain/types";

/**
 * Material information, in the National Trading Standards sense.
 *
 * A property may not be marketed until a buyer has been told the things that
 * would affect their decision to buy it. Since 2023 this is not a courtesy:
 * omitting material information is a misleading omission under the Consumer
 * Protection from Unfair Trading Regulations, and the enforcement is against
 * whoever published the listing.
 *
 * The three parts are the industry's own division and are kept because they
 * mean something:
 *
 *  - **Part A** applies to every property without exception. Price, tenure,
 *    council tax band. A listing missing any of it is not a listing.
 *  - **Part B** applies to every property but is only known once somebody has
 *    asked: utilities, parking, accessibility. Absent means unasked, not
 *    absent — which is why the report distinguishes them.
 *  - **Part C** applies only where the thing exists, and is where the
 *    expensive surprises live: flood history, restrictive covenants, planning
 *    in the area, building safety. "Not applicable" is a legitimate answer and
 *    it must be a recorded one, because unrecorded and not-applicable look
 *    identical and only the first is a problem.
 *
 * The recurring failure this prevents is the one that reads as diligence:
 * publishing what is known and staying silent about the rest. A buyer cannot
 * tell the difference between "no covenants" and "nobody looked", so this
 * refuses to let a listing go to market until every question has an answer,
 * including the answer "we asked and do not know".
 */

export const MATERIAL_INFORMATION_VERSION = "material-1";

export type Part = "A" | "B" | "C";

/**
 * What is known about one item.
 *
 * Three states, not two. "Not known" is the one that matters: it is an honest
 * answer, it is publishable, and it is different from silence — a buyer
 * reading "flood risk: not established" knows to commission a search, and a
 * buyer reading nothing at all does not.
 */
export type Knowledge =
  | { readonly state: "stated"; readonly value: string }
  | { readonly state: "not-applicable"; readonly why: string }
  | { readonly state: "not-known"; readonly whoWasAsked: string };

export interface MaterialItem {
  readonly key: string;
  readonly part: Part;
  readonly label: string;
  /** Why a buyer would want it, in a sentence. */
  readonly why: string;
  /** True where "not applicable" is not an available answer. */
  readonly alwaysApplies: boolean;
  /** Jurisdictions this item applies in. Empty means everywhere. */
  readonly jurisdictions?: readonly JurisdictionCode[];
  /** Tenures this item applies to. Empty means all of them. */
  readonly tenures?: readonly Tenure[];
}

export const MATERIAL_ITEMS: readonly MaterialItem[] = [
  // --- Part A: every property, no exceptions ---------------------------
  {
    key: "price",
    part: "A",
    label: "Asking price",
    why: "The first thing anybody filters on, and the one figure a listing cannot be vague about.",
    alwaysApplies: true,
  },
  {
    key: "tenure",
    part: "A",
    label: "Tenure",
    why: "Freehold and leasehold are different products with different costs. A buyer who finds out at the searches has wasted a month.",
    alwaysApplies: true,
  },
  {
    key: "council-tax",
    part: "A",
    label: "Council tax band",
    why: "A running cost every month for as long as they own it.",
    alwaysApplies: true,
  },
  {
    key: "lease-term",
    part: "A",
    label: "Lease length, ground rent and service charge",
    why: "A short lease is a mortgage refusal and an extension bill. Ground rent that doubles is a property nobody will buy in ten years.",
    alwaysApplies: true,
    tenures: ["leasehold", "share-of-freehold"],
  },
  // --- Part B: every property, once somebody has asked -------------------
  {
    key: "utilities",
    part: "B",
    label: "Utilities and heating",
    why: "Electricity, gas, water, sewerage and how the property is heated. Off-grid drainage is a survey and a bill.",
    alwaysApplies: true,
  },
  {
    key: "broadband",
    part: "B",
    label: "Broadband and mobile coverage",
    why: "For a great many buyers this decides whether the property is habitable at all.",
    alwaysApplies: true,
  },
  {
    key: "parking",
    part: "B",
    label: "Parking",
    why: "Allocated, permit, on-street or none. In a city it is a material part of the price.",
    alwaysApplies: true,
  },
  {
    key: "accessibility",
    part: "B",
    label: "Accessibility and adaptations",
    why: "Step-free access, level thresholds, a wet room. For some buyers it is the only question.",
    alwaysApplies: true,
  },
  {
    key: "construction",
    part: "B",
    label: "Building construction",
    why: "Non-standard construction is a mortgage problem, and it is not visible in a photograph.",
    alwaysApplies: true,
  },
  // --- Part C: where it exists, and where the expensive surprises live ----
  {
    key: "flood",
    part: "C",
    label: "Flooding and flood risk",
    why: "History of flooding, and whether the property is in a flood zone. It decides the insurance premium and sometimes whether cover exists.",
    alwaysApplies: false,
  },
  {
    key: "covenants",
    part: "C",
    label: "Restrictive covenants and easements",
    why: "A covenant against alterations is a refurbishment plan that cannot happen. A right of way is somebody else's access across the garden.",
    alwaysApplies: false,
  },
  {
    key: "planning",
    part: "C",
    label: "Planning permissions and proposals nearby",
    why: "Both what has been granted here and what is proposed next door.",
    alwaysApplies: false,
  },
  {
    key: "building-safety",
    part: "C",
    label: "Building safety",
    why: "Cladding, remediation and the EWS position. It is the difference between a saleable flat and an unsaleable one.",
    alwaysApplies: false,
    tenures: ["leasehold", "share-of-freehold"],
  },
  {
    key: "rights-of-way",
    part: "C",
    label: "Public rights of way",
    why: "A footpath across the land is not visible from the road and does not go away.",
    alwaysApplies: false,
  },
  {
    key: "mining",
    part: "C",
    label: "Coalfield or mining area",
    why: "The West Midlands sits on one. It is a search, a report and occasionally a structural problem.",
    alwaysApplies: false,
  },
];

/** The items that apply to one property. */
export function itemsFor(property: PropertyFacts): readonly MaterialItem[] {
  return MATERIAL_ITEMS.filter((item) => {
    if (item.jurisdictions !== undefined && !item.jurisdictions.includes(property.jurisdiction)) {
      return false;
    }
    if (item.tenures !== undefined && !item.tenures.includes(property.tenure)) return false;
    return true;
  });
}

/** What has been established about a property, keyed by item. */
export type MaterialRecord = Readonly<Record<string, Knowledge | undefined>>;

export interface ItemStatus {
  readonly item: MaterialItem;
  readonly knowledge: Knowledge | undefined;
  /** True where the question has an answer of any of the three kinds. */
  readonly answered: boolean;
  /** What a buyer is shown for this item. */
  readonly shown: string;
}

export interface MaterialReport {
  readonly items: readonly ItemStatus[];
  /** True where every applicable item has an answer and the property may be marketed. */
  readonly mayMarket: boolean;
  /** Part A items with nothing recorded. These stop marketing outright. */
  readonly missingPartA: readonly string[];
  /** Everything else unanswered, in the order it should be dealt with. */
  readonly unanswered: readonly string[];
  readonly summary: string;
  readonly version: string;
}

function describe(item: MaterialItem, knowledge: Knowledge | undefined): string {
  if (knowledge === undefined) {
    // Never softened into "no information available", which reads as a
    // statement about the property rather than about our own diligence.
    return "Not established. Nobody has answered this yet.";
  }
  switch (knowledge.state) {
    case "stated":
      return knowledge.value;
    case "not-applicable":
      return `Does not apply — ${knowledge.why}`;
    case "not-known":
      return `Not known. ${knowledge.whoWasAsked} was asked and could not say; a buyer should commission their own check.`;
  }
}

/**
 * Whether this property may be marketed, and what is stopping it.
 *
 * Part A is a hard gate. Everything else is reported and published as
 * unanswered rather than blocking, because "we asked and do not know" is a
 * legitimate state for a Part C item and refusing to market until a flood
 * search comes back would stop the platform working — while publishing
 * silence in its place is the misleading omission this exists to prevent.
 */
export function materialInformation(
  property: PropertyFacts,
  record: MaterialRecord = {},
): MaterialReport {
  const items = itemsFor(property).map((item): ItemStatus => {
    const knowledge = record[item.key];
    // "Not applicable" is not an available answer for an item that always
    // applies. Accepting it there would let every Part A question be closed
    // with one word.
    const usable =
      knowledge !== undefined && !(item.alwaysApplies && knowledge.state === "not-applicable")
        ? knowledge
        : undefined;
    return {
      item,
      ...(usable !== undefined ? { knowledge: usable } : { knowledge: undefined }),
      answered: usable !== undefined,
      shown: describe(item, usable),
    };
  });

  const missingPartA = items
    .filter((s) => s.item.part === "A" && !s.answered)
    .map((s) => s.item.label);
  const unanswered = items
    .filter((s) => s.item.part !== "A" && !s.answered)
    .map((s) => s.item.label);

  return {
    items,
    mayMarket: missingPartA.length === 0,
    missingPartA,
    unanswered,
    summary: summarise(missingPartA, unanswered, items.length),
    version: MATERIAL_INFORMATION_VERSION,
  };
}

function summarise(
  missingPartA: readonly string[],
  unanswered: readonly string[],
  total: number,
): string {
  if (missingPartA.length > 0) {
    return `Cannot be marketed: ${missingPartA.join(", ").toLowerCase()} ${missingPartA.length === 1 ? "is" : "are"} not recorded. Part A applies to every property without exception, and a listing missing it is not a listing.`;
  }
  if (unanswered.length > 0) {
    return `${total - unanswered.length} of ${total} questions answered. The rest are published as unanswered rather than left out — a buyer cannot tell the difference between "no covenants" and "nobody looked", and only one of those is true here.`;
  }
  return `All ${total} questions answered, including the ones answered "not known". That is what a buyer is entitled to before they spend money on a survey.`;
}
