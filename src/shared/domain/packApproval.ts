/**
 * Freezing a pack to its content, so an approval cannot outlive the thing it
 * approved (spec §8/§10, acceptance A08).
 *
 * The memorandum recomputes live from the deal, which is right — it can never
 * show a stale figure. But "a named person approved this pack for release" is a
 * statement about a *particular* pack, and the moment the price, the costs or
 * the material facts change, that statement is no longer true. An approval is
 * therefore bound to a hash of the facts the pack is built from: change any of
 * them and the approval is void, and the pack must be approved again before it
 * goes out.
 *
 * This module is the pure half — it says what the pack's content is
 * (canonically, so the same facts always hash the same) and decides whether an
 * approval still matches. The hash itself is computed in the backend with a
 * real digest; here we only serialise and compare.
 */

export const PACK_VERSION = "pack-1";

export interface PackApproval {
  /** The digest of the pack's content at the moment it was approved. */
  readonly contentHash: string;
  /** The named person who approved it — never a shared credential. */
  readonly approvedBy: string;
  /** ISO-8601 instant of approval. */
  readonly approvedAt: string;
  readonly packVersion: string;
}

/**
 * The facts a pack is built from. Everything here, changed, must invalidate an
 * approval; nothing derived is included, because it is a function of these.
 */
export interface PackApprovalInput {
  /** The modelled/agreed deal inputs — price, finance, structure, exit. */
  readonly inputs: unknown;
  /** The material information disclosed in the pack. */
  readonly material?: unknown;
  /** The seller due-diligence the pack relies on. */
  readonly sellerChecks?: unknown;
}

/** The canonical content object an approval is taken against. */
export function packPayload(input: PackApprovalInput): unknown {
  return {
    inputs: input.inputs ?? null,
    material: input.material ?? null,
    sellerChecks: input.sellerChecks ?? null,
  };
}

/**
 * Deterministic JSON: object keys sorted recursively, so the same facts always
 * produce the same string regardless of key order, and a digest of it is a
 * stable content hash.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export type ApprovalState = "none" | "valid" | "stale";

export interface ApprovalStatus {
  readonly state: ApprovalState;
  readonly reason: string;
  /** The approval on record, where there is one (valid or stale). */
  readonly approval?: PackApproval;
}

/**
 * Whether the pack's current content still matches what was approved.
 *
 * `none` — never approved. `valid` — approved, and unchanged since. `stale` —
 * approved, but the content has changed, so the approval is void and release
 * must not proceed until it is approved again.
 */
export function approvalStatus(currentHash: string, approval: PackApproval | undefined): ApprovalStatus {
  if (approval === undefined) {
    return { state: "none", reason: "This pack has not been approved for release." };
  }
  if (approval.contentHash === currentHash) {
    return {
      state: "valid",
      reason: `Approved for release by ${approval.approvedBy} on ${approval.approvedAt.slice(0, 10)}.`,
      approval,
    };
  }
  return {
    state: "stale",
    reason: `The pack has changed since ${approval.approvedBy} approved it on ${approval.approvedAt.slice(0, 10)} — the approval is void. It must be approved again before release.`,
    approval,
  };
}
