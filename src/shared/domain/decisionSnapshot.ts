import type { DecisionOutput } from "@shared/domain/decisionOutput";

/**
 * DecisionSnapshot (Independent AI Deal Engine spec §5).
 *
 * A saved, versioned decision a reviewer can be shown: the four-field decision
 * output frozen at a point in time, with the evidence-set version and the
 * calculation ids it rested on, its blockers and reason codes, a visibility and
 * an expiry. Publishing rechecks permissions and unresolved publication gates
 * first (create_decision_snapshot), and a withdrawn source permission revokes it
 * so it can no longer be displayed or exported (IND14). Execution blockers are
 * part of the content and are shown, not a reason to withhold the snapshot — a
 * blocked decision still publishes as "Blocked for this strategy".
 *
 * Immutable once created: a changed input is a new snapshot, never an edit.
 */

export type SnapshotVisibility = "private" | "reviewer" | "investor";

export const SNAPSHOT_TTL_DAYS = 30;

export interface DecisionSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly actorId: string;
  /** The frozen evidence-set version this decision rested on. */
  readonly evidenceSetVersion: string;
  readonly calculationIds: readonly string[];
  readonly decision: DecisionOutput;
  /** The unresolved execution blockers, lifted out for display/filtering. */
  readonly blockers: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly visibility: SnapshotVisibility;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** IND14: a withdrawn source permission blocks display and export. */
  readonly revoked: boolean;
}

export interface CreateSnapshotInput {
  readonly id: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly actorId: string;
  readonly evidenceSetVersion: string;
  readonly calculationIds: readonly string[];
  readonly decision: DecisionOutput;
  readonly reasonCodes?: readonly string[];
  readonly visibility: SnapshotVisibility;
  readonly createdAt: string;
  /** The permission recheck result for this actor on this subject. */
  readonly permitted: boolean;
  /**
   * Whether the publication gates are clear (e.g. Part A material information
   * answered, identity/funding checks done). Required to publish beyond private.
   */
  readonly publicationGatesClear: boolean;
}

export type CreateSnapshotResult =
  | { readonly ok: true; readonly snapshot: DecisionSnapshot }
  | { readonly ok: false; readonly reason: string };

export function createDecisionSnapshot(input: CreateSnapshotInput): CreateSnapshotResult {
  if (!input.permitted) {
    return { ok: false, reason: "The actor is not permitted to publish a decision for this subject." };
  }
  if (input.visibility !== "private" && !input.publicationGatesClear) {
    return {
      ok: false,
      reason: "An unresolved publication gate stops this being shared beyond private (resolve the gate first).",
    };
  }
  const createdMs = new Date(input.createdAt).getTime();
  const expiresAt = new Date(createdMs + SNAPSHOT_TTL_DAYS * 86_400_000).toISOString();
  const blockers = input.decision.executionBlockers.filter((b) => !b.cleared).map((b) => b.label);

  return {
    ok: true,
    snapshot: {
      id: input.id,
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      subjectType: input.subjectType,
      actorId: input.actorId,
      evidenceSetVersion: input.evidenceSetVersion,
      calculationIds: input.calculationIds,
      decision: input.decision,
      blockers,
      reasonCodes: input.reasonCodes ?? [],
      visibility: input.visibility,
      createdAt: input.createdAt,
      expiresAt,
      revoked: false,
    },
  };
}

/** Readable where it is neither revoked nor expired (IND14, plus the TTL). */
export function isSnapshotReadable(snapshot: DecisionSnapshot, now: Date): boolean {
  if (snapshot.revoked) return false;
  return new Date(snapshot.expiresAt).getTime() > now.getTime();
}

/** Revoke a snapshot because a source it rested on is no longer permitted (IND14). */
export function revokeSnapshot(snapshot: DecisionSnapshot): DecisionSnapshot {
  return { ...snapshot, revoked: true };
}
