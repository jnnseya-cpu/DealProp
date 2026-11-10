/**
 * Trend Intelligence — the commercial control plane (spec §19).
 *
 * Two deterministic concerns, kept away from money. DealProp already owns money
 * end to end (`pricing.ts`, `entitlements.ts`, `ledger.ts`, `charging.ts`), and
 * this does NOT re-implement any of it. What it adds is the trend module's own
 * usage control: a draft-generation quota and a capability gate derived from the
 * entitlement's status. No price is set here — the spec's tiers are an explicit
 * packaging-for-discovery proposal with no published price (§19), so only the
 * feature caps live here, in one place, and nothing states an amount.
 *
 * The two rules that matter:
 *
 *  - **One completed draft per unique logical generation id.** Quota is reserved
 *    atomically before generation, settled once on successful persist, and
 *    released on final failure or expiry — attempts and template fallbacks never
 *    count. A replay of the same work id never double-charges (TI-09, the
 *    decision #24 posture applied to drafts rather than pence).
 *  - **Entitlement is derived, never stored.** There is no `isActive` flag;
 *    capabilities are computed from the plan and status on every request
 *    (decision #26). Grace and suspended installations become read / export /
 *    rollback only — ingestion and generation stop — and an ended installation
 *    keeps export and authorised rollback through its recovery window and
 *    nothing after (TI-11, spec §18/§19).
 */

export const TREND_COMMERCIAL_VERSION = "trend-commercial-1";

// --- plans (proposed caps for discovery; no prices, spec §19) ------------------

export type TrendPlanKey = "internal" | "managed_starter" | "managed_growth" | "enterprise";

export interface TrendPlanLimits {
  readonly markets: number;
  readonly channels: number;
  readonly reviewers: number;
  /** Successful generated drafts per UTC calendar month. */
  readonly draftsPerMonth: number;
}

/**
 * Proposed v1 feature caps (spec §19). A packaging decision for discovery, with
 * NO price — `Number.POSITIVE_INFINITY` means "configured per deployment", not
 * unlimited-for-free. Enterprise caps are agreed per contract.
 */
export const TREND_PLAN_LIMITS: Record<TrendPlanKey, TrendPlanLimits> = {
  internal: {
    markets: Number.POSITIVE_INFINITY,
    channels: Number.POSITIVE_INFINITY,
    reviewers: Number.POSITIVE_INFINITY,
    draftsPerMonth: Number.POSITIVE_INFINITY,
  },
  managed_starter: { markets: 1, channels: 2, reviewers: 3, draftsPerMonth: 50 },
  managed_growth: { markets: 3, channels: 4, reviewers: 10, draftsPerMonth: 500 },
  enterprise: {
    markets: Number.POSITIVE_INFINITY,
    channels: Number.POSITIVE_INFINITY,
    reviewers: Number.POSITIVE_INFINITY,
    draftsPerMonth: Number.POSITIVE_INFINITY,
  },
};

// --- entitlement and capabilities (derived, spec §19, TI-11) ------------------

export type EntitlementStatus = "trial" | "active" | "grace" | "suspended" | "ended";

export interface TrendEntitlement {
  readonly customer: string;
  readonly planKey: TrendPlanKey;
  readonly planRevision: number;
  readonly status: EntitlementStatus;
  readonly effectiveFrom: string;
  /** For an ended entitlement: export and rollback remain until this instant. */
  readonly recoveryUntil?: string;
}

export interface TrendCapabilities {
  readonly canIngest: boolean;
  readonly canGenerateDraft: boolean;
  readonly canApproveWrite: boolean;
  readonly canRollback: boolean;
  readonly canExport: boolean;
  readonly draftCap: number;
  readonly reason: string;
}

/**
 * Compute what an entitlement permits right now (spec §19/§18, TI-11). Trial and
 * active are full within the plan caps; grace and suspended stop ingestion and
 * generation but keep read/export/rollback; ended keeps export and authorised
 * rollback through the recovery window and nothing after.
 */
export function trendCapabilities(entitlement: TrendEntitlement, now: Date = new Date()): TrendCapabilities {
  const draftCap = TREND_PLAN_LIMITS[entitlement.planKey].draftsPerMonth;
  switch (entitlement.status) {
    case "trial":
    case "active":
      return {
        canIngest: true,
        canGenerateDraft: true,
        canApproveWrite: true,
        canRollback: true,
        canExport: true,
        draftCap,
        reason: "entitlement active",
      };
    case "grace":
    case "suspended":
      return {
        canIngest: false,
        canGenerateDraft: false,
        canApproveWrite: false,
        canRollback: true,
        canExport: true,
        draftCap,
        reason: "grace/suspended: read, export and rollback only",
      };
    case "ended": {
      const inRecovery =
        entitlement.recoveryUntil !== undefined && now.getTime() < Date.parse(entitlement.recoveryUntil);
      return {
        canIngest: false,
        canGenerateDraft: false,
        canApproveWrite: false,
        canRollback: inRecovery,
        canExport: inRecovery,
        draftCap,
        reason: inRecovery ? "ended: export and authorised rollback during recovery window" : "ended: recovery window elapsed, pending deletion",
      };
    }
  }
}

// --- draft metering (spec §19, TI-09) -----------------------------------------

export type MeterEntryStatus = "reserved" | "settled" | "released";

export interface MeterEntry {
  readonly workId: string;
  readonly status: MeterEntryStatus;
}

/** The first instant of the next UTC calendar month — the quota reset (spec §19). */
export function nextMonthResetUtc(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1, 0, 0, 0)).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Settled drafts in the ledger count toward usage; reserved/released do not. */
export function draftsUsed(ledger: ReadonlyMap<string, MeterEntry>): number {
  let used = 0;
  for (const entry of ledger.values()) if (entry.status === "settled") used += 1;
  return used;
}

export type ReserveStatus = "reserved" | "duplicate" | "over_cap";

export interface ReserveResult {
  readonly status: ReserveStatus;
  readonly workId: string;
  /** When over cap, the UTC instant the quota resets (spec §19, 429 Retry). */
  readonly resetAt?: string;
  readonly reason: string;
}

/**
 * Reserve one draft generation against the cap (spec §19). A replay of the same
 * work id returns its existing state rather than reserving again — so duplicate
 * attempts never double-charge (TI-09). At the cap, nothing is reserved and the
 * caller returns 429 with the reset instant. The reservation itself is atomic in
 * the store (compare-and-set on the unique work id); this is the pure decision.
 */
export function reserveDraft(
  workId: string,
  ledger: ReadonlyMap<string, MeterEntry>,
  cap: number,
  now: Date,
): ReserveResult {
  const existing = ledger.get(workId);
  if (existing !== undefined) {
    return { status: "duplicate", workId, reason: `work id already ${existing.status}` };
  }
  if (draftsUsed(ledger) >= cap) {
    return { status: "over_cap", workId, resetAt: nextMonthResetUtc(now), reason: "monthly draft cap reached" };
  }
  return { status: "reserved", workId, reason: "quota reserved" };
}

/** Settle a reserved draft on successful persist. Only a reserved entry settles. */
export function settleDraft(entry: MeterEntry | undefined): MeterEntry | undefined {
  if (entry === undefined) return undefined;
  if (entry.status === "settled") return entry; // idempotent
  if (entry.status === "released") return undefined; // a released slot cannot settle
  return { workId: entry.workId, status: "settled" };
}

/** Release a reserved draft on final failure or expiry (frees the slot). */
export function releaseDraft(entry: MeterEntry | undefined): MeterEntry | undefined {
  if (entry === undefined) return undefined;
  if (entry.status === "settled") return entry; // a settled draft is not released
  return { workId: entry.workId, status: "released" };
}
