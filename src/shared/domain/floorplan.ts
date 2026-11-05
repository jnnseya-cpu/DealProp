/**
 * Floorplan layout review (Independent AI Deal Engine spec §2/§4/§5, IND10).
 *
 * A floorplan upload produces a HYPOTHESIS, never a fact. The model may propose
 * rooms or alterations with page and bounding-box references, but:
 *
 *  - **No fabricated dimensions.** A dimension or an area may only be asserted
 *    when the plan's scale is confirmed. An unscaled plan stays a hypothesis
 *    with scale listed as an unresolved check and dimensions not permitted
 *    (IND10).
 *  - **No approved conversion.** A hypothesis never claims planning is granted;
 *    circulation, access and planning are unresolved checks until a human
 *    confirms them.
 *  - **A scenario needs human confirmation.** An appraisal scenario can only be
 *    created once scale and the structural checks are resolved — measurements
 *    and feasibility are a reviewer's call (§4).
 *
 * Pure: the extractor supplies regions and whether a scale bar was read; this
 * decides what may be asserted.
 */

export type CoordinateUnits = "pixels" | "mm" | "unknown";
export type LayoutConfidence = "low" | "medium" | "high";

export interface LayoutRegion {
  readonly label: string;
  /** [x, y, width, height] in the plan's own coordinate space — a reference. */
  readonly bbox: readonly [number, number, number, number];
}

export interface LayoutHypothesis {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly planVersion: string;
  readonly page: number;
  readonly coordinateUnits: CoordinateUnits;
  readonly scaleConfirmed: boolean;
  readonly proposedChange: string;
  readonly regions: readonly LayoutRegion[];
  readonly confidence: LayoutConfidence;
  readonly unresolvedChecks: readonly string[];
  /** False whenever scale is unconfirmed — no dimension may be stated (IND10). */
  readonly dimensionsPermitted: boolean;
  readonly linkedScenarioId?: string;
  readonly createdAt: string;
}

export interface BuildLayoutInput {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly planVersion: string;
  readonly page: number;
  readonly coordinateUnits: CoordinateUnits;
  readonly scaleReadable: boolean;
  readonly proposedChange: string;
  readonly regions: readonly LayoutRegion[];
  /** Checks the extractor already knows are open (e.g. structural wall). */
  readonly extraChecks?: readonly string[];
  readonly createdAt: string;
}

export function buildLayoutHypothesis(input: BuildLayoutInput): LayoutHypothesis {
  const checks: string[] = [...(input.extraChecks ?? [])];
  if (!input.scaleReadable) checks.push("scale");
  // Circulation and access always need confirming on a proposed alteration.
  checks.push("circulation", "access");
  // A change to walls or use is a planning question until a person resolves it.
  checks.push("planning permission");

  const dimensionsPermitted = input.scaleReadable;
  const confidence: LayoutConfidence = !input.scaleReadable
    ? "low"
    : checks.length > 3
      ? "medium"
      : "high";

  return {
    id: input.id,
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    planVersion: input.planVersion,
    page: input.page,
    coordinateUnits: input.coordinateUnits,
    scaleConfirmed: input.scaleReadable,
    proposedChange: input.proposedChange,
    regions: input.regions,
    confidence,
    unresolvedChecks: [...new Set(checks)],
    dimensionsPermitted,
    createdAt: input.createdAt,
  };
}

/**
 * Whether an appraisal scenario may be created from this hypothesis. It may only
 * once scale is confirmed and the structural/planning checks a person owns are
 * resolved — measurements and feasibility are a reviewer's call, not the
 * model's (§4). `resolvedChecks` is what a named reviewer has signed off.
 */
export function canCreateScenario(
  hypothesis: LayoutHypothesis,
  resolvedChecks: readonly string[],
): { readonly ok: boolean; readonly blocking: readonly string[] } {
  if (!hypothesis.scaleConfirmed) return { ok: false, blocking: ["scale"] };
  const resolved = new Set(resolvedChecks);
  const blocking = hypothesis.unresolvedChecks.filter((c) => !resolved.has(c));
  return { ok: blocking.length === 0, blocking };
}
