import { sub, money, type Money } from "@shared/money";
import type { DealHuntResult } from "@shared/domain/dealHuntRun";
import type { ComparableBundle } from "@shared/domain/comparableBundle";
import { missingClaim, type EvidenceClaim } from "@shared/domain/evidenceClaim";
import {
  buildDecisionOutput,
  summariseCoverage,
  type DecisionOutput,
} from "@shared/domain/decisionOutput";

/**
 * Turning a Deal Hunt result into evidence claims and the §3 decision output.
 *
 * This is the live bridge between the matcher's result, the comparable bundle,
 * and the four-field decision — so `evidenceClaim`, `decisionOutput` and the
 * coverage summary are produced from real run data, not left as inert engines.
 *
 * The decision is honest about the pilot's coverage: with no comparable feed the
 * supported price cannot be established, so the verdict is "Needs evidence" with
 * the missing fields named — never a fabricated valuation. Where defensible sold
 * comparables exist, headroom is the conservative supported price (the as-is low)
 * minus the current ask.
 */

/**
 * The fields a priced hunt decision is BLOCKED without — the ones that gate the
 * supported price. Rental evidence is tracked in the coverage counts and shown,
 * but it does not block a headroom decision (a flip needs no rent), so it is not
 * in this set.
 */
export const DECISION_REQUIRED_FIELDS = ["asking_price", "previous_baseline", "sold_comparables"] as const;

/** Deterministic claims for a result, so a re-run upserts rather than piling up. */
export function buildResultClaims(
  result: DealHuntResult,
  bundle: ComparableBundle | undefined,
  tenantId: string,
  now: string,
): EvidenceClaim[] {
  const id = (field: string): string => `ec-${result.runId}-${result.propertyId}-${field}`;
  const source = result.provenance[0] ?? "listing";
  const claims: EvidenceClaim[] = [
    {
      id: id("asking_price"),
      tenantId,
      propertyId: result.propertyId,
      field: "asking_price",
      value: String(Number(result.currentPence)),
      sourceType: source,
      sourceLocator: `obs:${result.currentObservationId}`,
      effectiveAt: result.resultWatermark,
      observedAt: now,
      confidence: "confirmed",
      entitlement: "pilot",
      revision: 1,
    },
    {
      id: id("previous_baseline"),
      tenantId,
      propertyId: result.propertyId,
      field: "previous_baseline",
      value: String(Number(result.baselinePence)),
      sourceType: source,
      sourceLocator: `obs:${result.baselineObservationId}`,
      effectiveAt: result.resultWatermark,
      observedAt: now,
      confidence: "confirmed",
      entitlement: "pilot",
      revision: 1,
    },
  ];

  const policyLocator = bundle !== undefined ? `policy:${bundle.policyVersion}` : "none";

  const soldDefensible = bundle !== undefined && !bundle.coverage.soldThin && bundle.coverage.soldCount > 0;
  claims.push(
    soldDefensible
      ? {
          id: id("sold_comparables"),
          tenantId,
          propertyId: result.propertyId,
          field: "sold_comparables",
          value: String(bundle!.coverage.soldCount),
          sourceType: "comparables",
          sourceLocator: policyLocator,
          effectiveAt: now,
          observedAt: now,
          confidence: "confirmed",
          entitlement: "pilot",
          revision: 1,
        }
      : // No defensible sold comparables — recorded as a missing fact, with where
        // it would come from, never silently absent.
        missingClaim({ id: id("sold_comparables"), tenantId, propertyId: result.propertyId, field: "sold_comparables", sourceType: "comparables", sourceLocator: policyLocator, observedAt: now, entitlement: "pilot" }),
  );

  const rentCount = (bundle?.coverage.advertisedRentCount ?? 0) + (bundle?.coverage.agreedRentCount ?? 0);
  const rentPresent = bundle !== undefined && !bundle.coverage.rentUnavailable && rentCount > 0;
  claims.push(
    rentPresent
      ? {
          id: id("rental_evidence"),
          tenantId,
          propertyId: result.propertyId,
          field: "rental_evidence",
          value: String(rentCount),
          sourceType: "comparables",
          sourceLocator: policyLocator,
          effectiveAt: now,
          observedAt: now,
          confidence: "user_reported",
          entitlement: "pilot",
          revision: 1,
        }
      : missingClaim({ id: id("rental_evidence"), tenantId, propertyId: result.propertyId, field: "rental_evidence", sourceType: "comparables", sourceLocator: policyLocator, observedAt: now, entitlement: "pilot" }),
  );

  return claims;
}

/**
 * Compose the §3 decision for a result from its evidence claims and comparable
 * bundle. The investigation priority is the return-and-reduction itself.
 */
export function decisionFromResult(
  result: DealHuntResult,
  bundle: ComparableBundle | undefined,
  claims: readonly EvidenceClaim[],
): DecisionOutput {
  const currentAskPence = result.currentPence;
  const asIs = bundle?.sold.asIs;
  const soldDefensible = bundle !== undefined && !bundle.coverage.soldThin && bundle.coverage.soldCount > 0;

  // A supported price only where there is a defensible valuation — otherwise the
  // decision is honestly "Needs evidence", never an invented figure.
  const maxSupportedPricePence: Money = soldDefensible && asIs !== undefined ? asIs.low : currentAskPence;
  const basePence: Money = soldDefensible && asIs !== undefined ? sub(asIs.mid, currentAskPence) : money(0);
  const downsidePence: Money = soldDefensible && asIs !== undefined ? sub(asIs.low, currentAskPence) : money(0);

  const coverage = summariseCoverage(claims, DECISION_REQUIRED_FIELDS);

  return buildDecisionOutput({
    investigationPriority: result.matchReasons,
    basePence,
    downsidePence,
    maxSupportedPricePence,
    currentAskPence,
    executionBlockers: [], // Market research stage: deal blockers arise in the workflow, not here.
    evidenceCoverage: coverage,
    inputsComplete: soldDefensible,
  });
}
