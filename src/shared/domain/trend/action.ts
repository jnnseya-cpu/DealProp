/**
 * Trend Intelligence — typed actions, approval binding and the write-safety
 * state machine (spec §6, §16, §18).
 *
 * A Growth Brief changes what an agent proposes; this module governs what
 * happens to a proposal before anything is written. It is the trend engine's
 * form of the rule the rest of this codebase already lives by: an agent
 * proposes and a named person decides (decision #51), the shared operator
 * password cannot be that person, and the decision binds to exactly what was
 * reviewed — editing the payload invalidates the approval (decision #52).
 *
 * Five safety properties, each pinned by a conformance scenario:
 *
 *  1. **Only a typed, allowlisted action.** v1 live execution is
 *     `seo_metadata_patch` and `owned_content_patch` on a prebound asset, over
 *     a field allowlist (title, description, a named body block). URL, canonical,
 *     redirects, robots, schema and template code are out of scope and a patch
 *     touching them is rejected. An unknown action kind is rejected (TI-06).
 *  2. **Approval binds to the canonical payload hash and the expected target
 *     revision.** Re-hash on approve; any edit changes the hash and the
 *     approval no longer matches (TI-06/TI-08).
 *  3. **Author and approver differ.** A live change cannot be self-approved.
 *  4. **One side effect per logical action.** The idempotency key is *derived*
 *     from tenant, brief version, channel, action kind, target, base revision
 *     and the canonical patch hash — never generated — so a retry carries the
 *     same key and the write happens once (TI-09, decision #24 posture).
 *  5. **Rollback matches the applied revision or fails safely.** A compensating
 *     write is a new, logged, authorised action; if the asset moved on, it goes
 *     to conflict review rather than clobbering the editor's work (TI-08).
 *
 * Pure and framework-free: it runs in the browser bundle, so it carries no node
 * crypto. The canonical hash here is a deterministic content digest for
 * change-detection — its job is that any edit to the reviewed payload changes
 * it, not cryptographic collision-resistance. A backend may compute SHA-256
 * over {@link canonicalActionString} instead and compare the opaque strings; the
 * canonicalisation is the contract, the digest function is swappable.
 */

export const TREND_ACTION_VERSION = "trend-action-1";

/** Live v1 execution kinds and the draft-only kinds (spec §18). */
export const LIVE_ACTION_KINDS = ["seo_metadata_patch", "owned_content_patch"] as const;
export const DRAFT_ACTION_KINDS = ["seo_page_draft", "organic_social_draft"] as const;

export type LiveActionKind = (typeof LIVE_ACTION_KINDS)[number];
export type DraftActionKind = (typeof DRAFT_ACTION_KINDS)[number];
export type ActionKind = LiveActionKind | DraftActionKind;

export function isLiveActionKind(kind: string): kind is LiveActionKind {
  return (LIVE_ACTION_KINDS as readonly string[]).includes(kind);
}
export function isActionKind(kind: string): kind is ActionKind {
  return isLiveActionKind(kind) || (DRAFT_ACTION_KINDS as readonly string[]).includes(kind);
}

/** The only fields a v1 patch may set (spec §18 typed field allowlist). */
export const ALLOWED_PATCH_FIELDS = ["title", "description", "body_block"] as const;
export type AllowedPatchField = (typeof ALLOWED_PATCH_FIELDS)[number];

/** Fields explicitly out of scope for v1 automation — a patch naming one fails. */
export const FORBIDDEN_PATCH_FIELDS = [
  "url",
  "slug",
  "canonical",
  "redirect",
  "redirects",
  "robots",
  "noindex",
  "structured_data",
  "schema",
  "permissions",
  "template",
  "template_code",
] as const;

export type PatchFields = Readonly<Record<string, string>>;

/** A proposed action (spec §6 requested-action shape). */
export interface ProposedAction {
  readonly tenantId: string;
  readonly platformId: string;
  readonly briefId: string;
  readonly briefVersion: number;
  readonly actionKind: ActionKind;
  readonly channel: string;
  readonly targetId: string;
  readonly expectedTargetRevision: string;
  readonly patch: PatchFields;
  readonly evidenceIds: readonly string[];
  readonly approvedClaimIds: readonly string[];
  readonly actionExpiry: string;
}

export interface ActionValidationError {
  readonly field: string;
  readonly message: string;
}

export type ActionValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly ActionValidationError[] };

/**
 * Validate a proposed action against the typed allowlist (spec §18). A live
 * patch may only set allowed fields and must never name a forbidden one; a
 * draft action carries its content the same way but is never executed live.
 */
export function validateProposedAction(action: ProposedAction): ActionValidation {
  const errors: ActionValidationError[] = [];

  if (!isActionKind(action.actionKind)) {
    errors.push({ field: "actionKind", message: "unknown action kind" });
    return { ok: false, errors };
  }

  const fields = Object.keys(action.patch);
  if (fields.length === 0) errors.push({ field: "patch", message: "empty patch" });
  for (const f of fields) {
    if ((FORBIDDEN_PATCH_FIELDS as readonly string[]).includes(f)) {
      errors.push({ field: `patch.${f}`, message: "field is out of scope for v1 automation" });
    } else if (!(ALLOWED_PATCH_FIELDS as readonly string[]).includes(f)) {
      errors.push({ field: `patch.${f}`, message: "field not in the allowlist" });
    }
  }
  if (action.evidenceIds.length === 0) {
    errors.push({ field: "evidenceIds", message: "at least one evidence id" });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// --- canonical hash and idempotency (spec §6, §18, TI-09) ---------------------

/** Canonical, stable serialization of the fields approval binds to. */
export function canonicalActionString(action: ProposedAction): string {
  const patch: Record<string, string> = {};
  for (const key of Object.keys(action.patch).sort()) {
    patch[key] = action.patch[key] ?? "";
  }
  // A fixed field order so the same action always serialises identically.
  return JSON.stringify([
    action.tenantId,
    action.platformId,
    action.briefId,
    action.briefVersion,
    action.actionKind,
    action.channel,
    action.targetId,
    action.expectedTargetRevision,
    patch,
    [...action.approvedClaimIds].sort(),
  ]);
}

/** FNV-1a 32-bit over a string, hex. A deterministic content digest. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in uint32.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The canonical payload hash approval binds to (spec §16). */
export function canonicalPayloadHash(action: ProposedAction): string {
  return fnv1a(canonicalActionString(action));
}

/**
 * The durable idempotency key, derived (never generated) from tenant, brief
 * version, channel, action kind, target, base revision and the canonical patch
 * hash (spec §18). A safe retry recomputes the same key, so the side effect
 * happens at most once.
 */
export function deriveIdempotencyKey(action: ProposedAction): string {
  const parts = [
    action.tenantId,
    action.briefVersion,
    action.channel,
    action.actionKind,
    action.targetId,
    action.expectedTargetRevision,
    canonicalPayloadHash(action),
  ].join("::");
  return `idem_${fnv1a(parts)}_${canonicalPayloadHash(action)}`;
}

// --- state machine (spec §6, §16, §18) ----------------------------------------

export type ActionState =
  | "proposed"
  | "validated"
  | "pending_approval"
  | "approved"
  | "queued"
  | "executing"
  | "applied"
  | "failed"
  | "reconciliation_required"
  | "rolled_back";

/** The approval that binds a decision to exactly what was reviewed. */
export interface Approval {
  /** The named approver. The shared operator password is never an approver. */
  readonly approver: string;
  /** The hash the approver signed. */
  readonly payloadHash: string;
  /** The target revision the approver signed against. */
  readonly targetRevision: string;
  readonly policyVersion: number;
  readonly briefVersion: number;
  readonly approvedAt: string;
}

export interface ApprovalRequest {
  readonly author: string;
  readonly approver: string;
  readonly isLiveChange: boolean;
}

export type ApprovalResult =
  | { readonly ok: true; readonly approval: Approval }
  | { readonly ok: false; readonly reason: string };

/**
 * Approve a proposed action. Binds to the current canonical hash and the
 * expected target revision — so a later edit, which changes the hash, leaves the
 * approval unmatched. Rejects a self-approved live change and a shared-operator
 * approver.
 */
export function approveAction(
  action: ProposedAction,
  request: ApprovalRequest,
  policyVersion: number,
  now: Date,
): ApprovalResult {
  if (request.approver.trim() === "" || request.approver === "shared-operator") {
    return { ok: false, reason: "a named approver is required; the shared operator password cannot approve" };
  }
  if (request.isLiveChange && request.author === request.approver) {
    return { ok: false, reason: "author and approver must differ for a live change" };
  }
  return {
    ok: true,
    approval: {
      approver: request.approver,
      payloadHash: canonicalPayloadHash(action),
      targetRevision: action.expectedTargetRevision,
      policyVersion,
      briefVersion: action.briefVersion,
      approvedAt: now.toISOString(),
    },
  };
}

/** Does an approval still bind to this (possibly edited) action? */
export function approvalMatches(action: ProposedAction, approval: Approval): boolean {
  return (
    approval.payloadHash === canonicalPayloadHash(action) &&
    approval.targetRevision === action.expectedTargetRevision &&
    approval.briefVersion === action.briefVersion
  );
}

export interface ExecutionContext {
  readonly approval: Approval;
  /** The live target revision read immediately before execution. */
  readonly liveTargetRevision: string;
  /** Whether the installation is frozen (emergency freeze, §8). */
  readonly frozen: boolean;
  /** Whether the brief is still live (not expired). */
  readonly briefLive: boolean;
  readonly now: Date;
}

export type ExecutionDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

/**
 * The execution-time re-guard (spec §16 execute, §18 step 3). Run again at
 * execution, after any queue delay: the approval must still match the action,
 * the brief must be live, the installation must not be frozen, the action must
 * not have expired, and the live target revision must equal the one approved —
 * otherwise execution is denied (a stale queued action never writes, TI-05/TI-08).
 */
export function guardExecution(action: ProposedAction, ctx: ExecutionContext): ExecutionDecision {
  if (ctx.frozen) return { allow: false, reason: "installation is frozen" };
  if (!ctx.briefLive) return { allow: false, reason: "brief is no longer live" };
  if (Date.parse(action.actionExpiry) <= ctx.now.getTime()) {
    return { allow: false, reason: "action has expired" };
  }
  if (!approvalMatches(action, ctx.approval)) {
    return { allow: false, reason: "approval no longer matches the action (edited or re-versioned)" };
  }
  if (ctx.liveTargetRevision !== ctx.approval.targetRevision) {
    return { allow: false, reason: "target changed since approval — needs a new approval against the new revision" };
  }
  return { allow: true };
}

// --- rollback (spec §18 step 6, TI-08) ----------------------------------------

export interface RollbackContext {
  /** The revision the system recorded as applied. */
  readonly appliedRevision: string;
  /** The live revision now. */
  readonly liveRevision: string;
  readonly approver: string;
  readonly author: string;
}

export type RollbackDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

/**
 * A rollback is a new authorised compensating action. It proceeds only when the
 * live revision still matches the applied revision — otherwise an editor has
 * changed the asset since, and clobbering their work would lose it, so it goes
 * to conflict review (TI-08). A freeze still permits authorised rollback (§18).
 */
export function guardRollback(ctx: RollbackContext): RollbackDecision {
  if (ctx.approver.trim() === "" || ctx.approver === "shared-operator") {
    return { allow: false, reason: "a named approver is required for a rollback" };
  }
  if (ctx.liveRevision !== ctx.appliedRevision) {
    return { allow: false, reason: "asset changed since the applied revision — conflict review required" };
  }
  return { allow: true };
}

// --- transition guard ---------------------------------------------------------

const TRANSITIONS: Record<ActionState, readonly ActionState[]> = {
  proposed: ["validated", "failed"],
  validated: ["pending_approval", "failed"],
  pending_approval: ["approved", "failed"],
  approved: ["queued", "failed"],
  queued: ["executing", "failed"],
  executing: ["applied", "failed", "reconciliation_required"],
  applied: ["rolled_back"],
  reconciliation_required: ["applied", "failed", "rolled_back"],
  failed: [],
  rolled_back: [],
};

/** May an action move from `from` to `to`? Terminal states never move (§6). */
export function canTransition(from: ActionState, to: ActionState): boolean {
  return TRANSITIONS[from].includes(to);
}
