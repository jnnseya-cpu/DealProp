import { assertSourceUsable } from "@shared/domain/sources";
import type { RecipientType } from "@shared/domain/outreach";
import { recipientTypeFromName } from "@backend/discovery/extract";

/**
 * Who owns a property.
 *
 * The register names the proprietor and gives an address for service. That is
 * the lawful route to an owner, and it is bought one title at a time for a
 * property genuinely being pursued — which is ordinary practice, and what a
 * conveyancer does on every purchase.
 *
 * What this deliberately cannot do is bulk. There is no function here that
 * takes a postcode and returns owners, and there must never be one: harvesting
 * registers to build a marketing list is a different activity from looking up a
 * property you are buying. It processes personal data about thousands of people
 * who have not been told, for a purpose they would not expect, and it fails the
 * legitimate-interests balance that a single purposeful lookup passes.
 *
 * So every lookup carries the reason it was made. Not as decoration — as the
 * record that distinguishes the two activities if anybody ever asks.
 *
 * A corporate proprietor is a different matter: a company is not a person, its
 * officers are already public, and it can be written to as a business. The
 * recipient type is derived here so the outreach gate treats each correctly,
 * and anything it cannot classify is treated as an individual.
 */

const SOURCE = "land-registry-title";

/** Why a register was bought. Free text is not enough; the reason is chosen. */
export type LookupPurpose =
  /** A property already in the pipeline that we intend to offer on. */
  | "pursuing-acquisition"
  /** The seller approached us and we are confirming they own it. */
  | "verifying-seller"
  /** Conveyancing on a deal that is proceeding. */
  | "transaction-due-diligence";

export interface OwnerLookupRequest {
  readonly titleNumber: string;
  readonly purpose: LookupPurpose;
  /** The deal this is for. A lookup with no deal behind it is bulk collection. */
  readonly dealId: string;
  readonly requestedBy: string;
}

export interface Proprietor {
  readonly name: string;
  readonly recipientType: RecipientType;
  /** The address for service on the register, which may not be the property. */
  readonly addressForService?: string;
  /** Companies House number where the proprietor is a company. */
  readonly companyNumber?: string;
}

export interface OwnerLookup {
  readonly ok: boolean;
  readonly titleNumber: string;
  readonly proprietors: readonly Proprietor[];
  readonly observedAt: string;
  readonly purpose: LookupPurpose;
  readonly reason: string;
}

/** Title numbers are letters then digits, e.g. WM123456. */
const TITLE_NUMBER = /^[A-Z]{1,4}\d{1,8}$/i;

/**
 * Parse a title register into its proprietors.
 *
 * The register's proprietorship register lists each registered proprietor and
 * an address for service. Nothing is inferred: a register that does not state
 * an address yields a proprietor without one, rather than one guessed from the
 * property address — the address for service is frequently not the property,
 * which is the whole reason it is recorded separately.
 */
export function parseProprietors(register: unknown): readonly Proprietor[] {
  if (typeof register !== "object" || register === null) return [];
  const body = register as Record<string, unknown>;
  const entries = body["proprietors"];
  if (!Array.isArray(entries)) return [];

  const proprietors: Proprietor[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = record["name"];
    if (typeof name !== "string" || name.trim() === "") continue;

    const address = record["addressForService"];
    const company = record["companyNumber"];

    proprietors.push({
      name: name.trim(),
      recipientType: recipientTypeFromName(name),
      ...(typeof address === "string" && address.trim() !== ""
        ? { addressForService: address.trim() }
        : {}),
      ...(typeof company === "string" && company.trim() !== ""
        ? { companyNumber: company.trim() }
        : {}),
    });
  }

  return proprietors;
}

/**
 * Look up one title.
 *
 * Fails closed on the licence, on the shape of the title number, and on the
 * absence of a deal to attribute the lookup to. The last of those is the one
 * that matters: a lookup with no deal behind it is not a lookup, it is
 * collection, and the difference is not visible from the request alone.
 */
export async function lookupOwner(
  request: OwnerLookupRequest,
  reader: (titleNumber: string) => Promise<unknown>,
): Promise<OwnerLookup> {
  const at = new Date().toISOString();
  const refuse = (reason: string): OwnerLookup => ({
    ok: false,
    titleNumber: request.titleNumber,
    proprietors: [],
    observedAt: at,
    purpose: request.purpose,
    reason,
  });

  try {
    assertSourceUsable(SOURCE, "internal-analysis");
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "No licence recorded.");
  }

  if (!TITLE_NUMBER.test(request.titleNumber.trim())) {
    return refuse(`${request.titleNumber} is not the shape of a title number.`);
  }
  if (request.dealId.trim() === "") {
    return refuse(
      "A title lookup must be attributed to a deal. Buying a register with no transaction behind it is collection rather than conveyancing, and the record is what tells the two apart.",
    );
  }
  if (request.requestedBy.trim() === "") {
    return refuse("A title lookup must be attributed to a named person.");
  }

  try {
    const proprietors = parseProprietors(await reader(request.titleNumber.trim().toUpperCase()));
    return {
      ok: true,
      titleNumber: request.titleNumber.trim().toUpperCase(),
      proprietors,
      observedAt: at,
      purpose: request.purpose,
      reason:
        proprietors.length === 0
          ? "The register returned no proprietor. Nothing is assumed from that."
          : `${proprietors.length} registered proprietor(s), read from the register rather than inferred.`,
    };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "The register could not be read.");
  }
}

/**
 * How an owner may be approached.
 *
 * A company may be written to as a business. A named individual may not receive
 * unsolicited electronic marketing without consent — that is PECR reg. 22, and
 * it has no workaround — so the lawful channel to a homeowner is a letter, sent
 * under legitimate interests with a privacy notice, screened against the Mailing
 * Preference Service.
 *
 * Returning "letter" rather than refusing is the point: the approach is lawful,
 * the channel is not a matter of preference.
 */
export type OwnerChannel = "email" | "letter" | "none";

export interface ChannelDecision {
  readonly channel: OwnerChannel;
  readonly reason: string;
  readonly requirements: readonly string[];
}

export function channelFor(proprietor: Proprietor): ChannelDecision {
  if (proprietor.recipientType === "limited-company" || proprietor.recipientType === "llp") {
    return {
      channel: "email",
      reason:
        "A corporate proprietor is a business subscriber, so it may be written to electronically provided the sender is identified and an opt-out is offered.",
      requirements: [
        "Identify the sender and the reason for writing.",
        "Offer a working opt-out in every message.",
      ],
    };
  }

  if (proprietor.addressForService === undefined) {
    return {
      channel: "none",
      reason:
        "An individual proprietor with no address for service on the register. Nothing is guessed from the property address — the two are frequently different, and writing to the wrong one tells a stranger about somebody else's property.",
      requirements: [],
    };
  }

  return {
    channel: "letter",
    reason:
      "A named individual. Unsolicited electronic marketing to an individual needs consent under PECR reg. 22 and there is no workaround, so the lawful channel is a letter under legitimate interests.",
    requirements: [
      "Screen the address against the Mailing Preference Service before sending.",
      "Include a privacy notice saying where the address came from and how to object.",
      "Record the legitimate-interests assessment for this approach.",
      "Check the suppression list immediately before sending.",
    ],
  };
}
