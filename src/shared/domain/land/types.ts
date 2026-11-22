/**
 * Land sourcing — the site model (strategic land and consented plots).
 *
 * A land deal is not a flip. You are not buying a house to refurbish; you are
 * securing control of a parcel whose value is almost entirely about what can be
 * built on it and whether planning will allow it. So the model here is about
 * three things a flip never cares about: the planning status, the physical and
 * legal constraints that decide whether a scheme is even possible, and the way
 * control is taken (buy it, or option it and pursue consent).
 *
 * Pure and framework-free, like the rest of `src/shared/domain`. Figures that
 * depend on a scheme (residual land value, GDV) are a separate appraisal; this
 * module is the *sourcing* question — is this a prospect worth pursuing, how,
 * and under what structure — not the price.
 */

/** Where a site sits in the planning system (spec of the land-finder). */
export type PlanningStatus =
  /** No application, no allocation. Greenfield potential at best. */
  | "none"
  /** Pre-application discussions only. */
  | "pre-application"
  /** Allocated for development in the adopted or emerging local plan. */
  | "allocated"
  /** Outline consent (principle agreed, details reserved). */
  | "outline"
  /** Outline plus reserved matters discharged. */
  | "reserved-matters"
  /** Full planning permission. */
  | "full"
  /** A consent that has lapsed (time-expired, not implemented). */
  | "lapsed"
  /** A recent refusal with no obvious path. */
  | "refused";

/** How control of the land is taken (the four structures the user asked for). */
export type ControlStructure =
  /** Buy it outright — for a consented plot. */
  | "direct-purchase"
  /** Pay an option fee for the right to buy within a period; exercise on consent. */
  | "option"
  /** Binding sale, conditional on planning by a longstop date. */
  | "conditional-contract"
  /** Promoter funds and runs planning; land sold on the open market; promoter takes a % of the uplift. */
  | "promotion-agreement";

/** A physical or legal constraint on developing the site. */
export interface Constraint {
  readonly code: ConstraintCode;
  /** A hard constraint can make a scheme impossible; a soft one just lowers it. */
  readonly severity: "hard" | "soft";
  readonly detail?: string;
}

export type ConstraintCode =
  | "green-belt"
  | "flood-zone-3"
  | "flood-zone-2"
  | "sssi"
  | "aonb"
  | "conservation-area"
  | "listed-building"
  | "ancient-woodland"
  | "tpo"
  | "contaminated-land"
  | "no-access"
  | "ransom-strip"
  | "no-services"
  | "covenant-restriction";

/** The settlement context, which drives the density assumption. */
export type SettlementType = "urban" | "suburban" | "edge-of-settlement" | "rural";

/** The current use of the land, which affects deliverability and policy support. */
export type CurrentUse =
  | "brownfield"
  | "agricultural"
  | "paddock"
  | "garden"
  | "employment"
  | "vacant";

export interface LandSite {
  readonly id: string;
  readonly postcodeArea: string;
  readonly locality: string;
  /**
   * A point in the site, when known, used to query planning designations from
   * planning.data.gov.uk. Absent means constraints come only from what was
   * recorded on the site.
   */
  readonly location?: { readonly longitude: number; readonly latitude: number };
  /** Gross site area in hectares. */
  readonly areaHectares: number;
  readonly currentUse: CurrentUse;
  readonly settlement: SettlementType;
  readonly planningStatus: PlanningStatus;
  /**
   * Units already consented, where a consent exists. When a consent is present
   * this is the deliverable count; otherwise potential is derived from density.
   */
  readonly consentedUnits?: number;
  readonly constraints: readonly Constraint[];
  /** True once the owner has been established from a licensed title read (HMLR). */
  readonly ownerKnown: boolean;
  /** Is the site openly marketed (agent/auction) rather than off-market? */
  readonly openlyMarketed: boolean;
}
