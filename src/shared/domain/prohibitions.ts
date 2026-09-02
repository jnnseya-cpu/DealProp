import type { Bps } from "@shared/money";

/**
 * The twelve things this platform must not do.
 *
 * Written down as a catalogue rather than left as a section of a
 * specification, because a prohibition nobody can point at is a prohibition
 * nobody can check. Each entry names the control that enforces it and the test
 * that proves the control is live — a rule with no `enforcedBy` is a rule that
 * stops nothing, which is the state most of these are in on most platforms.
 *
 * They are not equivalent in kind and the list does not pretend they are.
 * Three of them are criminal or regulatory exposure, several are the kind of
 * thing that ends a business by reputation rather than by prosecution, and one
 * — charging to reveal a number anybody could have looked up — is neither,
 * and is on the list because it is the specific dishonesty this business model
 * makes easy.
 */

export type ProhibitionKey =
  | "copy-listings"
  | "fake-instruction"
  | "toll-on-public-information"
  | "unverified-lenders"
  | "autonomous-offers"
  | "rank-by-commission"
  | "hidden-referral-fees"
  | "hold-deposits"
  | "guaranteed-valuation"
  | "publish-seller-distress"
  | "double-charge-seller"
  | "unchecked-buyer-contact";

export interface Prohibition {
  readonly key: ProhibitionKey;
  /** The rule, in the imperative, as short as it can honestly be. */
  readonly rule: string;
  /** Why it matters — the actual consequence, not the principle. */
  readonly why: string;
  /**
   * Where it is enforced.
   *
   * A module and the function inside it that refuses. "Structural" means there
   * is no code path that could do the thing and the control is the absence
   * itself — those are the strongest ones and the easiest to erode, so each is
   * held by a test that fails if such a path is ever added.
   */
  readonly enforcedBy: readonly string[];
}

export const PROHIBITIONS: readonly Prohibition[] = [
  {
    key: "copy-listings",
    rule: "Never copy complete listings or photographs without permission.",
    why: "Copyright in the photographs belongs to whoever took them, and portal terms forbid it outright. It is also the thing that turns every portal from an indifferent third party into a litigant.",
    enforcedBy: [
      "sources.ts assertSourceUsable() — throws at ingestion, not at display",
      "discovery/fetcher.ts — the only outbound path, licence-gated",
      "discovery/extract.ts — no inference path; a detail is extracted or it does not exist",
    ],
  },
  {
    key: "fake-instruction",
    rule: "Never present an AI-discovered property as instructed by its owner.",
    why: "A buyer who pays to open an opportunity and finds an owner who never agreed to sell has been sold nothing, and they only find out after paying. They tell people.",
    enforcedBy: [
      "inventory.ts categoryDefect() — catches a label claiming more than is recorded",
      "reveal.ts quoteReveal() — refuses to charge on unconfirmed stock",
    ],
  },
  {
    key: "toll-on-public-information",
    rule: "Never charge to reveal a telephone number anybody could look up.",
    why: "The fee buys a verified pack and an introduction to somebody who agreed to be introduced. Charged on a property openly advertised elsewhere it buys nothing, and the buyer discovers that with one search.",
    enforcedBy: ["reveal.ts quoteReveal() — refuses where the property is openly advertised"],
  },
  {
    key: "unverified-lenders",
    rule: "Never let an unverified lender advertise funds.",
    why: "An unverified private lender advertising capital is how advance-fee fraud reaches a borrower, and the introduction came from us.",
    enforcedBy: [
      "matching.ts matchFundingBox() — an unverified mandate fails a hard criterion",
      "prohibitions.ts funderIsVerified() — verification is evidence with a date and a name, not a flag anybody can set",
    ],
  },
  {
    key: "autonomous-offers",
    rule: "Never let software submit a binding offer without the buyer confirming it.",
    why: "An offer is a person committing money. There are four things an agent proposal may do and none of them is bind anybody.",
    enforcedBy: [
      "agents.ts ProposalEffect — four effects and no fifth, held by a test",
      "agents.ts authoriseDecision() — a named person, never the shared operator password",
    ],
  },
  {
    key: "rank-by-commission",
    rule: "Never rank lenders by what they pay us.",
    why: "A borrower reading a ranked list believes it is ranked on suitability. One ranked on commission is an advice-shaped object that is not advice, and the FCA treats it as such.",
    enforcedBy: [
      "matching.ts rankMatches() — orders by mandate fit; commission is not an input, and a test asserts the word does not appear in the engine at all",
    ],
  },
  {
    key: "hidden-referral-fees",
    rule: "Never take a referral fee the client was not told about.",
    why: "Estate Agents Act 1979 s.18 makes an undisclosed fee unenforceable, and the CPRs make it a misleading omission. Disclosure is what makes the fee collectable, not what delays it.",
    enforcedBy: [
      "fees.ts chargeableFees() — requiresSellerDisclosure blocks the raise",
      "billing/fees.ts recordFeeDisclosure() — recorded before anybody is bound, by a named person",
    ],
  },
  {
    key: "hold-deposits",
    rule: "Never hold a purchase deposit in an ordinary platform account.",
    why: "Client money needs a client account and the rules that come with it. Holding a deposit in a trading account mixes it with our own money and loses it if we fail — and it is somebody's house.",
    enforcedBy: [
      "Structural: there is no code path that takes a deposit. The ledger holds prepaid platform balance only, and a test asserts no purchase-deposit path exists.",
    ],
  },
  {
    key: "guaranteed-valuation",
    rule: "Never describe an estimated valuation as guaranteed.",
    why: "Every figure this platform produces is an engine estimate. Presenting one as certain is a misleading action under the CPRs, and it is the sentence a buyer quotes back when the survey disagrees.",
    enforcedBy: ["prohibitions.ts checkValuationLanguage() — refuses the vocabulary of certainty"],
  },
  {
    key: "publish-seller-distress",
    rule: "Never publish a seller's personal circumstances.",
    why: "Probate, arrears, divorce, illness. It is the seller's private information, it is special-category data more often than people assume, and a marketplace that advertises distress is advertising the seller rather than the property.",
    enforcedBy: [
      "reveal.ts opportunityCard() — a closed shape, so a field added to the deal cannot leak through it",
      "outreach.ts checkNeutralEnquiry() — refuses circumstances in an outbound message",
      "analytics.ts — deny-by-default route allowlist; no pixel sees a page carrying seller data",
    ],
  },
  {
    key: "double-charge-seller",
    rule: "Never charge a seller who is still instructed elsewhere without addressing that contract.",
    why: "Under sole agency or sole selling rights the existing agent is paid on a sale whoever introduced the buyer. A fee on top makes the seller pay twice for one completion.",
    enforcedBy: [
      "fees.ts bindsSellerElsewhere() — a blocker on the seller success fee, not a warning",
      "billing/fees.ts recordExistingInstruction() — the release is recorded by a named person",
    ],
  },
  {
    key: "unchecked-buyer-contact",
    rule: "Never let a buyer reach a seller before identity and funding checks.",
    why: "A motivated seller has finite patience and one property to sell. Spending it on somebody with no money is how the supply side dies, and the seller blames whoever introduced them.",
    enforcedBy: [
      "passport.ts mayApproachSeller() — grades C and D do not reach a seller",
      "reveal.ts quoteReveal() — an ungraded or unfunded buyer cannot pay to be introduced",
    ],
  },
];

export function prohibition(key: ProhibitionKey): Prohibition {
  const found = PROHIBITIONS.find((p) => p.key === key);
  if (found === undefined) throw new Error(`No prohibition recorded for "${key}".`);
  return found;
}

/* ------------------------------------------------- guaranteed valuations */

export interface LanguageCheck {
  readonly clean: boolean;
  readonly findings: readonly string[];
}

/**
 * Refuse the vocabulary of certainty around a figure.
 *
 * Every number this platform produces is an engine estimate against inputs
 * somebody typed. The failure being prevented is not rudeness, it is a
 * misleading action under the Consumer Protection from Unfair Trading
 * Regulations — and in practice it is the one sentence a buyer quotes back
 * when the survey comes in twenty thousand pounds lower.
 *
 * Deliberately narrow. It catches certainty *attached to a figure or a
 * valuation*, not the word "guarantee" wherever it appears — the reveal
 * guarantee is a promise about our own money, which we can keep, and
 * flagging it would train people to ignore this.
 */
const CERTAINTY_PATTERNS: readonly { readonly pattern: RegExp; readonly finding: string }[] = [
  {
    pattern: /\bguarantee(d|s)?\s+(valuation|value|price|sale price|figure|return|profit|yield)\b/i,
    finding: "Describes a figure as guaranteed. Every figure here is an estimate against inputs somebody typed.",
  },
  {
    pattern: /\b(valuation|value|price|figure)\s+(is\s+)?guarantee(d|s)?\b/i,
    finding: "Describes a valuation as guaranteed.",
  },
  {
    pattern: /\b(certified|confirmed|assured|locked[- ]in|fixed)\s+(valuation|market value|sale price)\b/i,
    finding: "Presents a valuation as settled. A valuation is one professional's opinion on a date.",
  },
  {
    pattern: /\b(will|shall)\s+be\s+worth\b/i,
    finding: "States a future value as fact. It is a projection, and it must read as one.",
  },
  {
    pattern: /\bno\s+risk\b|\brisk[- ]free\b/i,
    finding: "Describes a property transaction as riskless. Nothing here is.",
  },
];

export function checkValuationLanguage(text: string): LanguageCheck {
  const findings = CERTAINTY_PATTERNS.filter((c) => c.pattern.test(text)).map((c) => c.finding);
  return { clean: findings.length === 0, findings };
}

/* --------------------------------------------------- ranking by fit only */

/**
 * The inputs a lender ranking may legitimately use.
 *
 * A closed list, checked by a test rather than trusted, because the failure is
 * invisible: a ranking with a commission term in it looks exactly like a
 * ranking without one, right up to the point somebody asks how it was built.
 * Anything to do with what a funder pays us is absent, and must stay absent.
 */
export const PERMITTED_RANKING_INPUTS: readonly string[] = [
  "mandate fit against the deal",
  "hard criteria met",
  "loan to value headroom",
  "ticket size fit",
  "term fit",
  "borrower track record against the funder's minimum",
  "jurisdiction and locality",
];

/**
 * What a funder must have shown before their capital may be advertised.
 *
 * Evidence with a date and a named person, on the same principle as every
 * other permission on this platform: a boolean anybody can set is not
 * verification, it is a claim.
 */
export interface FunderVerification {
  /** ISO-8601. */
  readonly verifiedAt: string;
  /** Who on our side checked. Named. */
  readonly verifiedBy: string;
  /** What was checked — company number, FCA reference, source of capital. */
  readonly evidence: string;
}

/** How long a funder verification stands before it must be redone. */
export const FUNDER_VERIFICATION_MONTHS = 12;

export function funderIsVerified(
  verification: FunderVerification | undefined,
  now: Date,
): boolean {
  if (verification === undefined) return false;
  if (verification.evidence.trim() === "" || verification.verifiedBy.trim() === "") return false;
  const at = Date.parse(verification.verifiedAt);
  if (Number.isNaN(at) || at > now.getTime()) return false;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - FUNDER_VERIFICATION_MONTHS);
  return at >= cutoff.getTime();
}

/**
 * The commission a funder pays, where one is agreed.
 *
 * Declared here so it has one home and one obvious property: nothing that
 * ranks or matches may import it. It exists to be disclosed and invoiced,
 * never to order a list.
 */
export interface FunderCommission {
  readonly rateBps: Bps;
  /** The disclosure given to the borrower, verbatim. */
  readonly disclosedAs: string;
}
