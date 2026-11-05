/**
 * EvidenceClaim (Independent AI Deal Engine spec §5).
 *
 * The spine of the independent core: one typed, sourced assertion about one
 * field of one property — who said it, from where, when it was effective and
 * when observed, under what entitlement it may be shown, and which earlier claim
 * it supersedes. Everything downstream (comparable bundles, decision snapshots,
 * coverage statements) cites claim IDs rather than restating facts, so a
 * withdrawn source (IND14) can block exactly what rested on it.
 *
 * Four confidence classes, and the distinction is load-bearing: a fact nobody
 * has is `missing`, never silently absent, so "not known" can never read as a
 * cleared check. A claim is never mutated — a correction is a new revision that
 * `supersedes` the old one, like the audit trail.
 */

export type EvidenceConfidence = "confirmed" | "user_reported" | "inferred" | "missing";

export interface EvidenceClaim {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId: string;
  /** The field this claim is about, e.g. "tenure", "asking_price", "epc_rating". */
  readonly field: string;
  /** The asserted value, serialised. `missing` claims carry an empty value. */
  readonly value: string;
  readonly sourceType: string;
  readonly sourceLocator: string;
  /** When the fact was true (effective time). */
  readonly effectiveAt: string;
  /** When we observed it (received time) — distinct from effective (spec §5). */
  readonly observedAt: string;
  readonly confidence: EvidenceConfidence;
  /** The entitlement scope under which this claim may be displayed/exported. */
  readonly entitlement: string;
  readonly revision: number;
  /** The claim this one replaces, if any. */
  readonly supersedesId?: string;
}

/**
 * Produce the next revision of a claim, carrying forward identity and pointing
 * back at the one it replaces. The original is never changed.
 */
export function reviseClaim(
  prev: EvidenceClaim,
  patch: Partial<Pick<EvidenceClaim, "value" | "sourceType" | "sourceLocator" | "effectiveAt" | "confidence" | "entitlement">>,
  next: { id: string; observedAt: string },
): EvidenceClaim {
  return {
    ...prev,
    ...patch,
    id: next.id,
    observedAt: next.observedAt,
    revision: prev.revision + 1,
    supersedesId: prev.id,
  };
}

/** A claim that records the ABSENCE of a fact, with who was asked (spec §5). */
export function missingClaim(input: {
  id: string;
  tenantId: string;
  propertyId: string;
  field: string;
  sourceType: string;
  sourceLocator: string;
  observedAt: string;
  entitlement: string;
}): EvidenceClaim {
  return {
    id: input.id,
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    field: input.field,
    value: "",
    sourceType: input.sourceType,
    sourceLocator: input.sourceLocator,
    effectiveAt: input.observedAt,
    observedAt: input.observedAt,
    confidence: "missing",
    entitlement: input.entitlement,
    revision: 1,
  };
}
