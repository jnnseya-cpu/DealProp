/**
 * Checking that somebody is who they say, and is not on a list.
 *
 * Both the Buyer Readiness Passport and the seller's due diligence turn on two
 * dates: when identity was verified, and when sanctions and PEP screening was
 * run. Until now both were dates a human typed into a form, and the seller's
 * screening was a checkbox somebody ticked. The gates were real; the evidence
 * behind them was an assertion.
 *
 * That is the difference between a business that scales and one that hires.
 * Every buyer needs a check before they reach a seller and every seller needs
 * three before their property can be marketed — as manual work that is linear
 * human labour per transaction, which is the opposite of a marketplace.
 *
 * This file is the shape of the answer, not the provider. It defines what a
 * check is, what makes one usable, and how a manual check is recorded
 * honestly — so connecting a provider later is an adapter rather than a
 * rewrite of everything that reads a screening date.
 *
 * The design decision that matters: a manual check is a first-class outcome,
 * not a fallback that pretends to be automated. An operator who ran a check
 * somewhere else and typed the reference in has done the work; what the system
 * must not do is present that as though a provider answered. `method` is on
 * every result and it never lies.
 */

export const SCREENING_VERSION = "screening-1";

/** Who or what performed the check. */
export type CheckMethod =
  /** A provider answered over an API. */
  | "provider"
  /** A person ran it elsewhere and recorded the reference. */
  | "manual";

export type CheckKind = "identity" | "sanctions-pep";

/**
 * What a check can say.
 *
 * "Inconclusive" is separate from "not run" and from "failed", because the
 * three call for different actions and collapsing them is how a person who
 * simply has a thin credit file gets treated as a match. A clear result and a
 * result nobody could obtain are not the same fact.
 */
export type Outcome = "clear" | "review" | "failed" | "inconclusive";

export interface CheckResult {
  readonly kind: CheckKind;
  readonly outcome: Outcome;
  readonly method: CheckMethod;
  /** ISO-8601, when the check was actually performed. */
  readonly at: string;
  /** The provider's reference, or the reference of the check run elsewhere. */
  readonly reference: string;
  /** Who recorded it. Named, always — a check has an author. */
  readonly recordedBy: string;
  /** What was found, where anything was. Shown to whoever reviews it. */
  readonly detail?: string;
}

/**
 * Whether a result may be relied on.
 *
 * Only "clear" clears. A review or an inconclusive result is not a soft pass:
 * the whole reason to run the check is the case where it says something, and a
 * system that treats "we could not tell" as "fine" has bought itself the cost
 * of screening with none of the benefit.
 */
export function isClear(result: CheckResult | undefined): boolean {
  return result?.outcome === "clear";
}

/**
 * What a check costs to trust, in time.
 *
 * Twelve months, matching the identity and screening windows already used by
 * the passport and the seller's due diligence. Deliberately the same number,
 * from the same reasoning: a check from four years ago is not a check.
 */
export const CHECK_VALID_MONTHS = 12;

export function isCurrent(result: CheckResult | undefined, now: Date): boolean {
  if (result === undefined) return false;
  const at = Date.parse(result.at);
  if (Number.isNaN(at) || at > now.getTime()) return false;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - CHECK_VALID_MONTHS);
  return at >= cutoff.getTime();
}

/** Usable means current and clear. Both, always. */
export function isUsable(result: CheckResult | undefined, now: Date): boolean {
  return isCurrent(result, now) && isClear(result);
}

export interface ScreeningSubject {
  /** A person's full name, or a company's registered name. */
  readonly name: string;
  /** ISO-8601 date of birth, for an individual. */
  readonly dateOfBirth?: string;
  /** ISO-3166-1 alpha-2. */
  readonly country?: string;
  /** Company number, where the subject is an entity. */
  readonly companyNumber?: string;
}

export interface ScreeningRequest {
  readonly kind: CheckKind;
  readonly subject: ScreeningSubject;
  /** What this check is for — a deal, an account. Recorded, never guessed. */
  readonly purpose: string;
  readonly requestedBy: string;
}

/**
 * What must be true before a check may even be attempted.
 *
 * A screening request with no name is a request that will come back clear
 * against nobody, and a clear result against nobody is worse than no result:
 * it is a record saying the check was done.
 */
export function requestProblem(request: ScreeningRequest): string | undefined {
  if (request.subject.name.trim() === "") {
    return "A screening request needs a name. A clear result against nobody is worse than no result, because it is a record saying the check was done.";
  }
  if (request.requestedBy.trim() === "") {
    return "A screening request needs a named requester. A check is somebody's decision to run it.";
  }
  if (request.purpose.trim() === "") {
    return "A screening request needs a purpose. Screening somebody with no transaction behind it is collection, not diligence.";
  }
  if (request.kind === "sanctions-pep" && (request.subject.country ?? "").trim() === "") {
    // Screening without a jurisdiction produces either everything or nothing,
    // and both look like an answer.
    return "Sanctions screening needs a country. Without one the match set is either everything or nothing, and both look like an answer.";
  }
  return undefined;
}

/**
 * A provider, as this platform needs one.
 *
 * Deliberately tiny. Every identity and screening provider does the same
 * thing behind very different payloads: takes a subject, returns an outcome
 * and a reference. Keeping the port this narrow is what stops one vendor's
 * vocabulary reaching the passport, the due diligence and every page that
 * reads a date.
 */
export interface ScreeningProvider {
  readonly name: string;
  check(request: ScreeningRequest): Promise<CheckResult>;
}

/**
 * What to record when a person ran the check somewhere else.
 *
 * A first-class outcome rather than a fallback pretending to be automated.
 * The operator has done the work; the system's job is to record that honestly,
 * which means `method: "manual"` and a reference somebody can look up.
 */
export function manualCheck(input: {
  readonly kind: CheckKind;
  readonly outcome: Outcome;
  readonly reference: string;
  readonly recordedBy: string;
  readonly at?: string;
  readonly detail?: string;
}): CheckResult | string {
  if (input.reference.trim() === "") {
    return "Record the reference of the check you ran. Without it there is nothing for anybody to look up later, and this becomes the tick box it is replacing.";
  }
  if (input.recordedBy.trim() === "") {
    return "A check has an author. Record who ran it.";
  }
  return {
    kind: input.kind,
    outcome: input.outcome,
    method: "manual",
    at: input.at ?? new Date().toISOString(),
    reference: input.reference.trim(),
    recordedBy: input.recordedBy.trim(),
    ...(input.detail !== undefined && input.detail.trim() !== ""
      ? { detail: input.detail.trim() }
      : {}),
  };
}

/**
 * How a check reads on a screen.
 *
 * The method is always shown. An operator looking at a clear result is
 * entitled to know whether a provider said so or whether a colleague typed it,
 * because those carry different weight and the difference is invisible
 * otherwise.
 */
export function describe(result: CheckResult | undefined, now: Date): string {
  if (result === undefined) return "Not run.";

  const how = result.method === "provider" ? "by a provider" : "manually, and recorded";
  const stale = isCurrent(result, now)
    ? ""
    : ` Out of date — a check stands for ${CHECK_VALID_MONTHS} months.`;

  switch (result.outcome) {
    case "clear":
      return `Clear, checked ${how} on ${result.at.slice(0, 10)} (${result.reference}).${stale}`;
    case "review":
      return `Needs review: ${result.detail ?? "a possible match was returned"}. Checked ${how} on ${result.at.slice(0, 10)} (${result.reference}). A possible match is not a pass.`;
    case "failed":
      return `Failed: ${result.detail ?? "a match was returned"}. Checked ${how} on ${result.at.slice(0, 10)} (${result.reference}).`;
    case "inconclusive":
      return `Inconclusive — the check could not reach an answer, which is not the same as clear. Attempted ${how} on ${result.at.slice(0, 10)} (${result.reference}).`;
  }
}
