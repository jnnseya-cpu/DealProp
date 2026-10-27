import type { CompanyIdentity } from "@shared/domain/identity";
import { registrationLine } from "@shared/domain/identity";

/**
 * A letter to the homeowner, addressed to the property, holding no name.
 *
 * The prepared-but-unsold signal gives a property, not a person — the owner's
 * name needs a title lookup (see owners.ts and docs/HMLR-ACCESS.md). This is the
 * lawful way to approach without one: an addressed letter to "The Homeowner" at
 * the property. Post is outside PECR, so it needs no consent, and because it
 * names no individual it is not matched by the Mailing Preference Service as a
 * named letter is. It still identifies the sender, says plainly where the
 * property was identified from, and offers a one-line opt-out that is honoured.
 *
 * It is blunter than a named, title-confirmed approach: the occupier may be a
 * tenant rather than the owner (an EPC is lodged for a letting too), so the
 * letter is a courteous enquiry, never an assertion about the reader's
 * circumstances, and it says — as every approach on this platform does — that an
 * agent would usually get a better price. Pure and framework-free, like the
 * other letters. A missing sender detail is a bracketed placeholder the operator
 * fills, never a silent gap where a disclosure is required.
 */

export interface HomeownerLetterInput {
  readonly sender: CompanyIdentity;
  /** The property, e.g. "23 Fairford Road". */
  readonly propertyAddress: string;
  /** The postcode, shown on its own line in the address block where known. */
  readonly postcode?: string;
  /** ISO-8601 date the letter is drafted. */
  readonly today: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function orPlaceholder(value: string | undefined, placeholder: string): string {
  return value !== undefined && value !== "" ? value : `[${placeholder}]`;
}

export function draftHomeownerLetter(input: HomeownerLetterInput): string {
  const s = input.sender;
  const name = orPlaceholder(s.legalName ?? s.tradingName, "company name");
  const office = orPlaceholder(s.registeredOffice, "registered office address");
  const email = orPlaceholder(s.contactEmail, "contact email");
  const phoneLine = s.contactPhone !== undefined ? ` or ${s.contactPhone}` : "";

  const property = orPlaceholder(input.propertyAddress, "property address");
  const recipientBlock = [
    "The Homeowner",
    property,
    ...(input.postcode !== undefined && input.postcode !== "" ? [input.postcode] : []),
  ];

  const reg = registrationLine(s);
  const icoSentence =
    s.icoRegistration !== undefined
      ? ` We are registered with the Information Commissioner's Office, registration ${s.icoRegistration}.`
      : "";
  const dpContact = s.dataProtectionContact ?? s.contactEmail;
  const dpSentence = dpContact !== undefined ? ` Our data protection contact is ${dpContact}.` : "";

  const footerParts = [
    reg,
    s.amlSupervision !== undefined ? `Anti-money-laundering supervision: ${s.amlSupervision}.` : undefined,
  ].filter((p): p is string => p !== undefined && p !== "");

  return [
    name,
    office,
    `${email}${s.contactPhone !== undefined ? `  ·  ${s.contactPhone}` : ""}`,
    "",
    longDate(input.today),
    "",
    ...recipientBlock,
    "",
    "Dear Homeowner",
    "",
    `Re: ${property}`,
    "",
    `We are ${name}, a property-buying company. We are writing to you as the homeowner at this address because public records suggest the property was prepared for sale at some point and no sale has since been registered. We may be wrong about that, and we know nothing about your circumstances — this is simply an enquiry.`,
    "",
    `If you have ever thought about selling, we may be able to offer a straightforward, chain-free purchase, and we would be glad to talk with no obligation whatsoever. We should be plain about one thing: we are writing as a prospective buyer, not as your agent, and if your aim is the highest possible price a good estate agent would usually achieve more than a direct sale to a buyer like us. What we offer is speed and certainty, which suits some situations and not others.`,
    "",
    "And to be clear about cost: selling to us is free to you. There is no commission and no fee of any kind to pay us — we are the buyer, not an agent. You would instruct your own conveyancer, as you would in any sale.",
    "",
    `If it is of interest, you can reach us at ${email}${phoneLine}. If you would prefer not to hear from us again, one line to the same address is enough and we will not write to this property again.`,
    "",
    "How we identified this property",
    `We wrote to this address, not to you by name, and we hold no personal information about you. The property was identified from public open data — the Energy Performance of Buildings Register and HM Land Registry Price Paid Data — which together indicate a property that was prepared for sale without a sale being registered since. We rely on our legitimate interest in approaching potential sellers, balanced against your interests, and it stops the moment you ask us to. You may object at any time.${icoSentence}${dpSentence}`,
    "",
    "Yours faithfully",
    "",
    "",
    name,
    ...(footerParts.length > 0 ? ["", footerParts.join(" ")] : []),
  ].join("\n");
}
