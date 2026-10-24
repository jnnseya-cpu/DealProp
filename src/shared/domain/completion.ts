/**
 * CLOSE — Close Score and the Completion Commander.
 *
 * Once terms are agreed the OS stops being a marketplace and becomes a
 * transaction controller. The value here is not the checklist; it is knowing
 * which incomplete item is actually on the critical path, because a
 * transaction team that chases everything equally chases the wrong thing.
 */

export type MilestoneStatus = "complete" | "in-progress" | "blocked" | "not-started" | "expiring";

export type MilestoneOwner =
  | "seller"
  | "buyer"
  | "seller-solicitor"
  | "buyer-solicitor"
  | "lender"
  | "surveyor"
  | "jv-partner"
  | "accountant"
  | "platform"
  | "insurer";

export interface Milestone {
  readonly key: string;
  readonly label: string;
  readonly owner: MilestoneOwner;
  readonly status: MilestoneStatus;
  /** Weight in the Close Score. */
  readonly weight: number;
  /** Milestone keys that cannot start until this one completes. */
  readonly blocks: readonly string[];
  /** Typical working days once started. */
  readonly typicalDays: number;
  /** Days until this item expires and must be redone, where applicable. */
  readonly expiresInDays?: number;
  readonly note?: string;
}

export const STANDARD_MILESTONES: readonly Omit<Milestone, "status" | "expiresInDays" | "note">[] = [
  { key: "seller-id", label: "Seller identity and AML", owner: "platform", weight: 8, blocks: ["contract-draft"], typicalDays: 2 },
  { key: "buyer-id", label: "Buyer identity and AML", owner: "platform", weight: 8, blocks: ["lender-offer"], typicalDays: 2 },
  { key: "source-of-funds", label: "Source of funds evidenced", owner: "buyer", weight: 8, blocks: ["lender-offer"], typicalDays: 3 },
  { key: "terms-agreed", label: "Heads of terms agreed", owner: "buyer", weight: 6, blocks: ["contract-draft", "lender-application"], typicalDays: 2 },
  { key: "protection-cleared", label: "Seller protection cleared", owner: "platform", weight: 10, blocks: ["contract-draft"], typicalDays: 3 },
  { key: "jv-agreement", label: "JV agreement executed", owner: "jv-partner", weight: 7, blocks: ["lender-offer"], typicalDays: 10 },
  { key: "tax-review", label: "Tax review completed", owner: "accountant", weight: 5, blocks: ["exchange"], typicalDays: 5 },
  { key: "valuation", label: "Lender valuation", owner: "surveyor", weight: 8, blocks: ["lender-offer"], typicalDays: 7 },
  { key: "survey", label: "Buyer survey", owner: "surveyor", weight: 4, blocks: ["exchange"], typicalDays: 7 },
  { key: "lender-application", label: "Finance application submitted", owner: "buyer", weight: 5, blocks: ["lender-offer"], typicalDays: 3 },
  { key: "lender-offer", label: "Formal finance offer", owner: "lender", weight: 10, blocks: ["exchange"], typicalDays: 10 },
  { key: "contract-draft", label: "Draft contract issued", owner: "seller-solicitor", weight: 6, blocks: ["enquiries"], typicalDays: 5 },
  { key: "searches", label: "Local searches returned", owner: "buyer-solicitor", weight: 7, blocks: ["exchange"], typicalDays: 15 },
  { key: "enquiries", label: "Pre-contract enquiries answered", owner: "seller-solicitor", weight: 6, blocks: ["exchange"], typicalDays: 10 },
  { key: "insurance", label: "Buildings insurance in place", owner: "insurer", weight: 3, blocks: ["exchange"], typicalDays: 1 },
  { key: "exchange", label: "Exchange of contracts", owner: "buyer-solicitor", weight: 12, blocks: ["completion"], typicalDays: 1 },
  { key: "completion", label: "Completion", owner: "buyer-solicitor", weight: 15, blocks: [], typicalDays: 1 },
];

/**
 * The hard completion cap. The platform will not carry a sale that cannot
 * complete within this many days: the motivated-seller value proposition is
 * speed and certainty, and a transaction that drags past this ties up capital
 * and loses the advantage it was bought for. A route that could run longer is
 * not offered (see `sellerRoutes.ts`), and a live deal whose critical path
 * exceeds it is flagged to be dropped or restructured rather than nursed along.
 */
export const MAX_COMPLETION_DAYS = 60;

export interface CloseScoreSection {
  readonly label: string;
  readonly percent: number;
}

export interface Blocker {
  readonly severity: "red" | "amber";
  readonly milestone: Milestone;
  readonly message: string;
  readonly action: string;
  /** How many downstream milestones this blocks, directly or indirectly. */
  readonly downstreamCount: number;
}

export interface CloseReport {
  readonly closeScore: number;
  readonly completionProbability: number;
  readonly sections: readonly CloseScoreSection[];
  readonly blockers: readonly Blocker[];
  readonly criticalPathDays: number;
  /**
   * True where the critical path runs past `MAX_COMPLETION_DAYS`. A deal in this
   * state is to be dropped or restructured, not carried: the pipeline reads this
   * to flag it rather than silently deleting a record.
   */
  readonly breachesCompletionCap: boolean;
  readonly nextActions: readonly string[];
  readonly summary: string;
}

const STATUS_CREDIT: Record<MilestoneStatus, number> = {
  complete: 1,
  "in-progress": 0.5,
  expiring: 0.6,
  blocked: 0,
  "not-started": 0,
};

/**
 * Count everything downstream of a milestone, following the block graph.
 * Cycles are guarded against because a malformed milestone set should degrade
 * the ranking, not hang the transaction dashboard.
 */
function downstreamCount(key: string, byKey: Map<string, Milestone>): number {
  const seen = new Set<string>();
  const stack = [key];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const node = byKey.get(current);
    if (node === undefined) continue;
    for (const next of node.blocks) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size;
}

/** Longest remaining chain of incomplete work, in typical days. */
function criticalPath(milestones: readonly Milestone[], byKey: Map<string, Milestone>): number {
  const memo = new Map<string, number>();

  function longest(key: string, visiting: ReadonlySet<string>): number {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return 0;

    const node = byKey.get(key);
    if (node === undefined) return 0;

    const own = node.status === "complete" ? 0 : node.typicalDays;
    const nextVisiting = new Set(visiting).add(key);
    const downstream = node.blocks.reduce(
      (longestSoFar, next) => Math.max(longestSoFar, longest(next, nextVisiting)),
      0,
    );

    const total = own + downstream;
    memo.set(key, total);
    return total;
  }

  return milestones.reduce((worst, m) => Math.max(worst, longest(m.key, new Set())), 0);
}

export function buildCloseReport(milestones: readonly Milestone[]): CloseReport {
  const byKey = new Map(milestones.map((m) => [m.key, m]));

  // Computed up front because the completion cap depends on it and the cap's
  // blocker must be counted toward the completion probability below.
  const criticalPathDays = criticalPath(milestones, byKey);
  const breachesCompletionCap = criticalPathDays > MAX_COMPLETION_DAYS;

  const totalWeight = milestones.reduce((t, m) => t + m.weight, 0);
  const earned = milestones.reduce((t, m) => t + m.weight * STATUS_CREDIT[m.status], 0);
  const closeScore = totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);

  // --- Blockers, ranked by how much they hold up ------------------------
  const blockers: Blocker[] = [];
  for (const m of milestones) {
    if (m.status === "complete") continue;
    const downstream = downstreamCount(m.key, byKey);

    if (m.status === "blocked") {
      blockers.push({
        severity: "red",
        milestone: m,
        message: `${m.label} is blocked${m.note !== undefined ? `: ${m.note}` : "."}`,
        action: `Escalate to ${describeOwner(m.owner)}. This holds up ${downstream} downstream item(s).`,
        downstreamCount: downstream,
      });
    } else if (m.status === "expiring") {
      blockers.push({
        severity: "red",
        milestone: m,
        message: `${m.label} expires in ${m.expiresInDays ?? 0} days and will need redoing.`,
        action: `${describeOwner(m.owner)} must extend or refresh this before it lapses.`,
        downstreamCount: downstream,
      });
    } else if (m.status === "not-started" && downstream >= 2) {
      blockers.push({
        severity: "amber",
        milestone: m,
        message: `${m.label} has not started and sits on the critical path.`,
        action: `Instruct ${describeOwner(m.owner)} now. ${downstream} item(s) cannot begin until it completes.`,
        downstreamCount: downstream,
      });
    }
  }

  // The completion cap. A deal that cannot close within the window is not a
  // slow-but-fine deal; it is one to drop. Raised as the hardest blocker so it
  // ranks first and counts against the completion probability like any red.
  if (breachesCompletionCap) {
    const anchor = byKey.get("completion") ?? milestones[milestones.length - 1];
    if (anchor !== undefined) {
      blockers.push({
        severity: "red",
        milestone: anchor,
        message: `Projected completion is ${criticalPathDays} working days — past the ${MAX_COMPLETION_DAYS}-day cap this platform will carry.`,
        action: `This cannot complete within ${MAX_COMPLETION_DAYS} days on the current critical path. Drop it or restructure to a faster route.`,
        downstreamCount: 0,
      });
    }
  }

  blockers.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "red" ? -1 : 1;
    return b.downstreamCount - a.downstreamCount;
  });

  // --- Completion probability -------------------------------------------
  // Starts from readiness, then penalises the things that actually kill
  // transactions: hard blockers and expiring approvals.
  const redCount = blockers.filter((b) => b.severity === "red").length;
  const amberCount = blockers.filter((b) => b.severity === "amber").length;
  const completionProbability = Math.max(
    5,
    Math.min(97, Math.round(closeScore * 0.85 + 10 - redCount * 12 - amberCount * 3)),
  );

  const sections: CloseScoreSection[] = [
    section("Parties and AML", milestones, ["seller-id", "buyer-id", "source-of-funds"]),
    section("Seller protection", milestones, ["protection-cleared"]),
    section("Capital", milestones, ["lender-application", "lender-offer", "jv-agreement"]),
    section("Valuation and survey", milestones, ["valuation", "survey"]),
    section("Tax", milestones, ["tax-review"]),
    section("Legal", milestones, ["contract-draft", "enquiries", "searches"]),
    section("Exchange and completion", milestones, ["exchange", "completion", "insurance"]),
  ];

  const nextActions = blockers.slice(0, 3).map((b) => b.action);
  const gap = 95 - closeScore;

  return {
    closeScore,
    completionProbability,
    sections,
    blockers,
    criticalPathDays,
    breachesCompletionCap,
    nextActions,
    summary:
      blockers.length === 0
        ? `Close Score ${closeScore}%. Nothing is blocked; the transaction is progressing on its critical path.`
        : `Close Score ${closeScore}%. ${blockers.length} item(s) are holding this transaction${gap > 0 ? `; clearing the top ${Math.min(3, blockers.length)} moves it materially toward completion readiness` : ""}.`,
  };
}

function section(
  label: string,
  milestones: readonly Milestone[],
  keys: readonly string[],
): CloseScoreSection {
  const relevant = milestones.filter((m) => keys.includes(m.key));
  if (relevant.length === 0) return { label, percent: 0 };
  const weight = relevant.reduce((t, m) => t + m.weight, 0);
  const earned = relevant.reduce((t, m) => t + m.weight * STATUS_CREDIT[m.status], 0);
  return { label, percent: weight === 0 ? 0 : Math.round((earned / weight) * 100) };
}

function describeOwner(owner: MilestoneOwner): string {
  const labels: Record<MilestoneOwner, string> = {
    seller: "the seller",
    buyer: "the buyer",
    "seller-solicitor": "the seller's solicitor",
    "buyer-solicitor": "the buyer's solicitor",
    lender: "the lender",
    surveyor: "the surveyor",
    "jv-partner": "the JV partner",
    accountant: "the accountant",
    platform: "the platform team",
    insurer: "the insurer",
  };
  return labels[owner];
}
