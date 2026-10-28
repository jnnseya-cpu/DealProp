import type { CompanyIdentity } from "@shared/domain/identity";
import { registrationLine } from "@shared/domain/identity";

/**
 * The letter sent to a deceased estate's personal representatives.
 *
 * Generated for the operator to print and post — never sent automatically.
 * These are the most sensitive recipients this platform reaches: people
 * administering a bereavement. So the letter is written to be read by them, not
 * optimised for a response. It carries, in one document, everything a lawful
 * approach to an individual by post requires:
 *
 *  - who we are, in full, with the statutory company particulars;
 *  - how we came to write (the public Gazette notice, named);
 *  - the offer, with no obligation and an explicit steer to take advice and get
 *    more than one valuation — because an estate agent may achieve more;
 *  - the privacy notice: the lawful basis (legitimate interests), the source,
 *    the right to object, the ICO registration, and a one-line opt-out that we
 *    honour immediately.
 *
 * Pure and framework-free, so it is fully testable. A missing sender detail is
 * shown as a bracketed placeholder rather than silently dropped, so the
 * operator sees exactly what to fill before posting rather than sending a
 * letter with a gap where the law requires a disclosure.
 */

export interface ProbateLetterInput {
  readonly sender: CompanyIdentity;
  /** The contact for service named in the notice (name and address), if known. */
  readonly recipientContact?: string;
  readonly deceasedName: string;
  readonly propertyAddress?: string;
  /** ISO-8601 claim deadline, where the notice stated one. */
  readonly claimDeadline?: string;
  /** ISO-8601 date the letter is drafted. */
  readonly today: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-12-27" → "27 December 2026"; passed through unchanged if not a date. */
function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  const day = Number(m[3]);
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${day} ${month} ${m[1]}`;
}

function orPlaceholder(value: string | undefined, placeholder: string): string {
  return value !== undefined && value !== "" ? value : `[${placeholder}]`;
}

export function draftProbateLetter(input: ProbateLetterInput): string {
  const s = input.sender;
  const senderName = s.legalName ?? s.tradingName;
  const name = orPlaceholder(senderName, "company name");
  const office = orPlaceholder(s.registeredOffice, "registered office address");
  const email = orPlaceholder(s.contactEmail, "contact email");
  const phoneLine = s.contactPhone !== undefined ? ` or ${s.contactPhone}` : "";

  const recipientBlock =
    input.recipientContact !== undefined && input.recipientContact !== ""
      ? input.recipientContact
      : "c/o the contact for service named in the notice";

  const reLine =
    input.propertyAddress !== undefined && input.propertyAddress !== ""
      ? `Re: The estate of ${input.deceasedName} — the property at ${input.propertyAddress}`
      : `Re: The estate of ${input.deceasedName}`;

  const deadlineSentence =
    input.claimDeadline !== undefined && input.claimDeadline !== ""
      ? ` We note the notice gives a deadline of ${longDate(input.claimDeadline)} for claims against the estate.`
      : "";

  const reg = registrationLine(s);
  const icoSentence =
    s.icoRegistration !== undefined
      ? ` We are registered with the Information Commissioner's Office, registration ${s.icoRegistration}.`
      : "";
  const dpContact = s.dataProtectionContact ?? s.contactEmail;
  const dpSentence =
    dpContact !== undefined ? ` Our data protection contact is ${dpContact}.` : "";

  const footerParts = [
    reg,
    s.redressScheme !== undefined ? `Property redress scheme: ${s.redressScheme}.` : undefined,
    s.amlSupervision !== undefined ? `Anti-money-laundering supervision: ${s.amlSupervision}.` : undefined,
  ].filter((p): p is string => p !== undefined && p !== "");

  return [
    name,
    office,
    `${email}${s.contactPhone !== undefined ? `  ·  ${s.contactPhone}` : ""}`,
    "",
    longDate(input.today),
    "",
    `The Personal Representatives of the estate of ${input.deceasedName}`,
    recipientBlock,
    "",
    "Dear Sir or Madam",
    "",
    reLine,
    "",
    `We are writing having seen the notice to creditors published in The Gazette in connection with the estate of the late ${input.deceasedName}. Please accept our condolences.${deadlineSentence}`,
    "",
    `We are ${name}, a property purchasing and advisory business. Where an estate includes a residential property that the personal representatives wish to sell, we may be able to help — with a direct purchase, a sale in a timescale that suits the estate, or simply an honest view of the options. There is no obligation.`,
    "",
    "To be clear about cost: if the estate sells to us there is nothing for the estate to pay us — no commission and no fees of any kind, no listing fee, and nothing to pay up front. We are the buyer, not an agent, and the estate would instruct its own solicitor as in any sale. There is no obligation at any stage.",
    "",
    "Please take independent advice before any decision, and obtain more than one valuation: a high-street estate agent may achieve a higher price if the estate can wait and the property is marketed in the usual way. Any figure we put forward will state plainly what it is and what it is not.",
    "",
    `If the estate may wish to explore this, you can reach us at ${email}${phoneLine}. If you would prefer we did not write again, one line to the same address is enough and we will remove these details immediately.`,
    "",
    "How we hold your information",
    `We identified this estate solely from the notice in The Gazette, published under the Open Government Licence. We rely on our legitimate interest in contacting personal representatives who may wish to sell — balanced against your interests, which is why this is by letter, never automated, and stops the moment you ask. You have the right to object and to ask us to erase your information.${icoSentence}${dpSentence}`,
    "",
    "Yours faithfully",
    "",
    "",
    name,
    ...(footerParts.length > 0 ? ["", footerParts.join(" ")] : []),
  ].join("\n");
}
