import { isClear, isCurrent, type CheckResult } from "@shared/domain/screening";
import type { SellerDueDiligence } from "@shared/domain/sellerDueDiligence";

/**
 * Turning the register and the screening provider into the seller's checks.
 *
 * This is the "verify id and address in one line" the start-a-deal form offers.
 * The one line is a title number: the register returns who actually owns the
 * property (the address/ownership half), and that same proprietor name is what
 * gets screened for identity and sanctions (the id half). One input, both
 * checks.
 *
 * It writes into the deal's existing `SellerDueDiligence` fields rather than a
 * parallel store, so the due-diligence report, the workflow and the marketing
 * gate all read one source. And it is inconclusive-safe by construction: a
 * field is set ONLY where its check came back clear and current. No register
 * reader and no screening provider means no proprietor and no clear result,
 * which means nothing is written — the seller stays "unchecked", which is the
 * correct default and the one that keeps the platform usable without paying for
 * a single key. The absence of a provider costs an automation, never a false
 * pass and never a blocked deal.
 *
 * Pure: it takes results already obtained and decides what they prove. The IO —
 * calling the register and the provider — is the backend orchestrator's job, so
 * this stays testable without either.
 */

/** The registered proprietor, as the backend extracted it from a title lookup. */
export interface RegisteredProprietor {
  readonly name: string;
  /** Whether the register shows a company/LLP rather than an individual. */
  readonly isCompany: boolean;
}

export interface VerificationInputs {
  /** The proprietor the register returned, where the lookup succeeded. */
  readonly proprietor?: RegisteredProprietor;
  /** The title the lookup was for, shown in the evidence line. */
  readonly titleNumber?: string;
  /** Why ownership could not be confirmed, where it could not (no reader, no title, refused). */
  readonly ownershipReason: string;
  /** The identity check result, where one was attempted. */
  readonly identity?: CheckResult;
  /** The sanctions/PEP check result, where one was attempted. */
  readonly sanctions?: CheckResult;
}

/** The fields this may write into the seller's due-diligence record. */
export type SellerVerificationUpdate = Partial<
  Pick<
    SellerDueDiligence,
    "identityVerifiedAt" | "identityMethod" | "screenedAt" | "authorityEvidencedAt" | "authorityEvidence"
  >
>;

export interface CounterpartyVerification {
  /** Merge into the deal's SellerDueDiligence. Only clear checks set anything. */
  readonly sellerUpdate: SellerVerificationUpdate;
  readonly identityVerified: boolean;
  readonly screened: boolean;
  readonly ownershipConfirmed: boolean;
  /** True only where all three held. */
  readonly complete: boolean;
  /** One line for the operator, naming each half's state. */
  readonly line: string;
  /** What still needs doing by hand, each a sentence an operator can act on. */
  readonly outstanding: readonly string[];
}

function methodLabel(result: CheckResult): string {
  const how = result.method === "provider" ? "Electronic check" : "Manual check";
  return `${how} (${result.reference})`;
}

export function verifyCounterparty(inputs: VerificationInputs, now: Date): CounterpartyVerification {
  const update: {
    identityVerifiedAt?: string;
    identityMethod?: string;
    screenedAt?: string;
    authorityEvidencedAt?: string;
    authorityEvidence?: string;
  } = {};
  const outstanding: string[] = [];

  // Ownership / address: the register names the proprietor, or it does not.
  const ownershipConfirmed = inputs.proprietor !== undefined;
  if (inputs.proprietor !== undefined) {
    update.authorityEvidencedAt = now.toISOString();
    update.authorityEvidence =
      `Registered proprietor "${inputs.proprietor.name}"` +
      (inputs.titleNumber !== undefined ? ` on title ${inputs.titleNumber}` : "") +
      ", read from HM Land Registry rather than inferred.";
  } else {
    outstanding.push(
      `Ownership not confirmed: ${inputs.ownershipReason} Buy the title the way a conveyancer does and record the registered proprietor.`,
    );
  }

  // Identity: only a clear, current result sets the date. Inconclusive never does.
  const identityVerified = isClear(inputs.identity) && isCurrent(inputs.identity, now);
  if (identityVerified && inputs.identity !== undefined) {
    update.identityVerifiedAt = inputs.identity.at;
    update.identityMethod = methodLabel(inputs.identity);
  } else {
    outstanding.push(
      inputs.identity === undefined
        ? "Identity not checked: no proprietor name to screen yet. Confirm ownership first, then verify the person."
        : `Identity not confirmed (${inputs.identity.outcome}). Run an identity check and record its reference — an inconclusive result clears no gate.`,
    );
  }

  // Sanctions/PEP: likewise.
  const screened = isClear(inputs.sanctions) && isCurrent(inputs.sanctions, now);
  if (screened && inputs.sanctions !== undefined) {
    update.screenedAt = inputs.sanctions.at;
  } else {
    outstanding.push(
      inputs.sanctions === undefined
        ? "Sanctions and PEP screening not run: no name to screen yet."
        : `Sanctions and PEP screening not clear (${inputs.sanctions.outcome}). Dealing with a designated person is an offence regardless of what anybody knew — screen and record it.`,
    );
  }

  const part = (ok: boolean, label: string): string => `${label}: ${ok ? "confirmed" : "outstanding"}`;
  const line = [
    part(ownershipConfirmed, "Ownership"),
    part(identityVerified, "Identity"),
    part(screened, "Screening"),
  ].join(" · ");

  return {
    sellerUpdate: update,
    identityVerified,
    screened,
    ownershipConfirmed,
    complete: ownershipConfirmed && identityVerified && screened,
    line,
    outstanding,
  };
}
