import { configuredTitleReader } from "@backend/titleReader";
import { lookupOwner } from "@backend/discovery/owners";
import { runCheck } from "@backend/screening";
import {
  verifyCounterparty as combine,
  type CounterpartyVerification,
  type VerificationInputs,
} from "@shared/domain/counterparty";

/**
 * Verifying who owns a property and that they are who they say — from one line.
 *
 * The one line is a title number. This buys the register (when a reader is
 * configured), takes the proprietor it names, and screens that name for
 * identity and sanctions. The result is folded into the deal's seller
 * due-diligence by the caller.
 *
 * Every step degrades to inconclusive rather than failing the platform: no
 * title number, no configured register reader, or no screening provider each
 * produce "not confirmed", and `verifyCounterparty()` in the domain writes
 * nothing for a check that did not clear. So this is safe to call today, before
 * any key is paid for — it simply reports that the checks must be run by hand
 * and records nothing that would pretend otherwise.
 */

export interface VerifyRequest {
  readonly dealId: string;
  readonly titleNumber?: string;
  readonly requestedBy: string;
}

export async function runCounterpartyVerification(
  request: VerifyRequest,
  now: Date = new Date(),
): Promise<CounterpartyVerification> {
  const title = (request.titleNumber ?? "").trim();
  const reader = configuredTitleReader();

  let inputs: VerificationInputs;

  if (title === "") {
    inputs = { ownershipReason: "No title number was given." };
  } else if (reader === undefined) {
    inputs = {
      titleNumber: title,
      ownershipReason: "No HM Land Registry reader is connected, so the register was not read.",
    };
  } else {
    const lookup = await lookupOwner(
      { titleNumber: title, purpose: "verifying-seller", dealId: request.dealId, requestedBy: request.requestedBy },
      reader,
    );
    const proprietor = lookup.proprietors[0];
    if (lookup.ok && proprietor !== undefined) {
      const isCompany =
        proprietor.recipientType === "limited-company" || proprietor.recipientType === "llp";
      // The register gave us the real owner's name — screen that, not a name
      // somebody typed. Identity and sanctions are two checks on one subject.
      const [identity, sanctions] = await Promise.all([
        runCheck({
          kind: "identity",
          subject: { name: proprietor.name, ...(proprietor.companyNumber !== undefined ? { companyNumber: proprietor.companyNumber } : {}) },
          purpose: `Counterparty verification for deal ${request.dealId}`,
          requestedBy: request.requestedBy,
        }),
        runCheck({
          kind: "sanctions-pep",
          subject: { name: proprietor.name, country: "GB", ...(proprietor.companyNumber !== undefined ? { companyNumber: proprietor.companyNumber } : {}) },
          purpose: `Counterparty verification for deal ${request.dealId}`,
          requestedBy: request.requestedBy,
        }),
      ]);
      inputs = {
        proprietor: { name: proprietor.name, isCompany },
        titleNumber: lookup.titleNumber,
        ownershipReason: "",
        identity: identity.result,
        sanctions: sanctions.result,
      };
    } else {
      inputs = { titleNumber: title, ownershipReason: lookup.reason };
    }
  }

  return combine(inputs, now);
}
