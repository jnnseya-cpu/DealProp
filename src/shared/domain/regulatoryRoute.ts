/**
 * Which regulatory route an introduction falls under, and whether it may
 * proceed at all.
 *
 * This is a technical control framework, not a legal determination. It exists
 * so that the platform cannot make an introduction it has not been configured
 * to be allowed to make — not so that anyone can skip taking advice. UK counsel
 * must approve the regulated/unregulated boundary, the credit-broking
 * permissions and the financial-promotion process before any of this runs
 * against real people, and the rules below are effective-dated configuration
 * for exactly that reason.
 *
 * The direction of every uncertainty is the same: **route to review, never to
 * permitted.** An introduction wrongly allowed is an unauthorised regulated
 * activity, which makes the agreement unenforceable and the fee unrecoverable
 * on top of any penalty. An introduction wrongly held for review costs a day.
 *
 * The distinction that does most of the work here is whether the borrowing is
 * genuinely for business purposes. A loan secured on a dwelling that the
 * borrower or a relative occupies or intends to occupy is a regulated mortgage
 * contract, and no declaration of business purpose changes that.
 */

export const ROUTING_RULES = {
  asOf: "2026-08-25",
  jurisdiction: "GB",
  /**
   * True until counsel has approved these rules for production.
   *
   * Deliberately starts true. Nothing here has been through legal review, and a
   * rule set that quietly presents itself as approved is worse than one that
   * says plainly that it is not.
   */
  requiresCounselApproval: true,
  citation:
    "FSMA 2000 s.19 and s.21; RAO arts. 25A, 36A, 53A, 61; MCOB; CONC; the Financial Promotion Order",
} as const;

export type RegulatoryRoute =
  /** A regulated mortgage contract or regulated introduction. Needs permission. */
  | "REGULATED_ROUTE"
  /** Genuine business lending outside the regulated perimeter. */
  | "BUSINESS_UNREGULATED_ROUTE"
  /** Consumer buy-to-let: outside MCOB but its own regime. */
  | "CBTL_REVIEW"
  /** An introduction to a private lender rather than an authorised firm. */
  | "PRIVATE_DEBT_REVIEW"
  /** An equity or joint-venture offer, which is a financial promotion. */
  | "EQUITY_PROMOTION_REVIEW"
  /** Nothing here fits, or the facts conflict. A person must decide. */
  | "LEGAL_REVIEW_REQUIRED";

export type IntroductionType =
  | "regulated-lender"
  | "unregulated-business-lender"
  | "private-lender"
  | "equity-or-jv-investor";

export interface BorrowerFacts {
  readonly legalForm: "individual" | "company" | "llp" | "trust" | "spv";
  /** The borrower has declared the borrowing is wholly or predominantly for business. */
  readonly businessPurposeDeclared: boolean;
  /** Evidence supporting that declaration has been recorded, not merely ticked. */
  readonly businessPurposeEvidenced: boolean;
  /**
   * The security includes a dwelling occupied, or intended to be occupied, by
   * the borrower or a related person.
   *
   * The single most important fact on this page. It is the test that makes a
   * contract regulated regardless of what anybody has declared about purpose.
   */
  readonly securityIncludesOwnerOccupiedDwelling: boolean;
  /** Let to a family member, or otherwise not entered into wholly for business. */
  readonly consumerBuyToLetIndicators: boolean;
  readonly borrowerJurisdiction: string;
  readonly assetJurisdiction: string;
}

export interface OperatorPermissions {
  /** Recorded permission to carry on regulated mortgage introductions. */
  readonly regulatedMortgageIntroductions: boolean;
  /** Credit broking permission, or appointed-representative status for it. */
  readonly creditBroking: boolean;
  /** An authorised person will approve financial promotions. */
  readonly promotionApprover: boolean;
}

export interface RouteDecision {
  readonly route: RegulatoryRoute;
  /** False where no introduction may be made on this route today. */
  readonly mayIntroduce: boolean;
  /** Always populated. No silent classifications. */
  readonly reason: string;
  /** What has to be true before this may proceed. Empty where it may. */
  readonly blockers: readonly string[];
  readonly rulesAsOf: string;
}

const OUT_OF_SCOPE = "GB";

/**
 * Classify, then check permission. Never the other way round.
 *
 * Classifying by what we are allowed to do produces the answer we want rather
 * than the answer that is true, and the resulting record would be evidence
 * against us rather than for us.
 */
export function classifyRoute(
  borrower: BorrowerFacts,
  introduction: IntroductionType,
  permissions: OperatorPermissions,
): RouteDecision {
  const blockers: string[] = [];

  // Anything outside the jurisdiction these rules were written for is a person's
  // decision. A rule set for England and Wales says nothing about Jersey.
  if (
    borrower.borrowerJurisdiction.toUpperCase() !== OUT_OF_SCOPE ||
    borrower.assetJurisdiction.toUpperCase() !== OUT_OF_SCOPE
  ) {
    return refer(
      "LEGAL_REVIEW_REQUIRED",
      `These rules cover a ${OUT_OF_SCOPE} borrower and a ${OUT_OF_SCOPE} asset. This transaction involves ${borrower.borrowerJurisdiction} and ${borrower.assetJurisdiction}, so the perimeter has to be checked rather than assumed.`,
      ["Take advice on the regulatory position in every jurisdiction involved."],
    );
  }

  // The test that overrides every declaration. Purpose does not make a loan
  // secured on the borrower's own home unregulated.
  if (borrower.securityIncludesOwnerOccupiedDwelling) {
    const missing = permissions.regulatedMortgageIntroductions
      ? []
      : [
          "Record the operator's permission for regulated mortgage introductions, or appointed-representative status covering them.",
        ];
    return {
      route: "REGULATED_ROUTE",
      mayIntroduce: permissions.regulatedMortgageIntroductions,
      reason:
        "The security includes a dwelling occupied or intended to be occupied by the borrower or a related person. That makes this a regulated mortgage contract whatever purpose has been declared.",
      blockers: missing,
      rulesAsOf: ROUTING_RULES.asOf,
    };
  }

  if (borrower.consumerBuyToLetIndicators) {
    return refer(
      "CBTL_REVIEW",
      "Consumer buy-to-let indicators are present — a letting that was not entered into wholly for business purposes, such as a property let to a family member or one that was inherited rather than bought to let.",
      [
        "Confirm whether this is a consumer buy-to-let, which carries its own regime rather than falling outside regulation.",
      ],
    );
  }

  if (introduction === "equity-or-jv-investor") {
    const missing: string[] = [];
    if (!permissions.promotionApprover) {
      missing.push(
        "An equity or joint-venture offer is a financial promotion under FSMA s.21. Record who is approving it, or the exemption being relied on for each recipient.",
      );
    }
    return {
      route: "EQUITY_PROMOTION_REVIEW",
      mayIntroduce: false,
      reason:
        "Offering a share of a project or an SPV to an investor is an invitation to engage in investment activity. Every recipient has to be eligible before they see it, and the offer itself has to be approved or exempt.",
      blockers: [
        ...missing,
        "Confirm each recipient's investor categorisation is current before anything is sent.",
      ],
      rulesAsOf: ROUTING_RULES.asOf,
    };
  }

  if (introduction === "private-lender") {
    return refer(
      "PRIVATE_DEBT_REVIEW",
      "An introduction to a private lender rather than an authorised firm. Whether this is credit broking depends on the borrower, the security and how the introduction is made, and it is the arrangement most often assumed to be outside the perimeter when it is not.",
      [
        "Confirm the borrower is a body corporate borrowing for business purposes, or take advice.",
        permissions.creditBroking
          ? "Credit broking permission is recorded; confirm it covers this arrangement."
          : "Record credit broking permission or appointed-representative status before charging any fee for the introduction.",
      ],
    );
  }

  // Business lending to a corporate borrower, unsecured on any dwelling.
  const corporate = borrower.legalForm !== "individual";
  if (corporate && borrower.businessPurposeDeclared && borrower.businessPurposeEvidenced) {
    return {
      route: "BUSINESS_UNREGULATED_ROUTE",
      mayIntroduce: true,
      reason:
        "A corporate borrower, borrowing for evidenced business purposes, secured on something other than a dwelling the borrower occupies. This falls outside the regulated mortgage perimeter.",
      blockers: [],
      rulesAsOf: ROUTING_RULES.asOf,
    };
  }

  if (borrower.businessPurposeDeclared && !borrower.businessPurposeEvidenced) {
    return refer(
      "LEGAL_REVIEW_REQUIRED",
      "Business purpose has been declared but nothing evidences it. A declaration alone does not move a transaction outside the perimeter, and relying on one that turns out to be wrong is the platform's problem, not the borrower's.",
      ["Record evidence of the business purpose, or treat this as a regulated transaction."],
    );
  }

  return refer(
    "LEGAL_REVIEW_REQUIRED",
    "The facts recorded do not clearly place this transaction inside or outside the regulated perimeter.",
    ["A person must classify this transaction before any introduction is made."],
  );
}

function refer(
  route: RegulatoryRoute,
  reason: string,
  blockers: readonly string[],
): RouteDecision {
  return {
    route,
    // Every review route is a hard stop until a person clears it. A route that
    // means "probably fine" is a route that gets treated as fine.
    mayIntroduce: false,
    reason,
    blockers,
    rulesAsOf: ROUTING_RULES.asOf,
  };
}

/**
 * Language that must never appear in anything sent to an investor.
 *
 * Not a spell-check. These are the specific claims that turn a lawful
 * description of an opportunity into a misleading promotion, and they are
 * checked because they get written by accident — usually by somebody
 * summarising a good deal enthusiastically.
 */
const FORBIDDEN_CLAIMS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bguarantee(d|s)?\b/i, why: "Nothing about a property return may be described as guaranteed." },
  { pattern: /\brisk[-\s]?free\b/i, why: "No property investment is risk-free." },
  { pattern: /\bno[-\s]risk\b/i, why: "No property investment is without risk." },
  { pattern: /\bcan(no|')t lose\b/i, why: "An assurance against loss is misleading however it is phrased." },
  { pattern: /\bsafe as houses\b/i, why: "A colloquial assurance is still an assurance." },
  { pattern: /\bassured (return|profit|income)\b/i, why: "Returns may not be described as assured." },
  { pattern: /\bfixed return\b/i, why: "Describe the contractual interest rate instead, with the risk of non-payment stated." },
];

export interface PromotionCheck {
  readonly clean: boolean;
  readonly findings: readonly { readonly phrase: string; readonly why: string }[];
}

/**
 * Check text bound for an investor.
 *
 * Returns findings rather than editing. A control that silently rewrites what
 * somebody wrote produces text nobody has read, which is its own problem.
 */
export function checkPromotionLanguage(text: string): PromotionCheck {
  const findings: { phrase: string; why: string }[] = [];
  for (const rule of FORBIDDEN_CLAIMS) {
    const match = rule.pattern.exec(text);
    if (match !== null) findings.push({ phrase: match[0], why: rule.why });
  }
  return { clean: findings.length === 0, findings };
}
