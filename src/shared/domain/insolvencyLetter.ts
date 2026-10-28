import type { CompanyIdentity } from "@shared/domain/identity";
import { registrationLine } from "@shared/domain/identity";

/**
 * The letter sent on a personal bankruptcy — to the office-holder, never the
 * debtor.
 *
 * On a bankruptcy order the debtor's home vests in the trustee in bankruptcy
 * (the Official Receiver until a trustee is appointed), who has a statutory duty
 * to realise it for the creditors. So the only lawful and sensible recipient is
 * that professional — not the bankrupt individual, who no longer controls the
 * property and is exactly the vulnerable person the protections exist for. This
 * letter is addressed to the trustee/Official Receiver, is plainly a business
 * approach, and acknowledges their duty to obtain the best reasonable price.
 *
 * Pure and framework-free, like the probate letter. A missing sender detail is
 * a bracketed placeholder the operator fills, never a silent gap where a
 * disclosure is required.
 */

export interface InsolvencyLetterInput {
  readonly sender: CompanyIdentity;
  /** The trustee/Official Receiver named in the notice, where known. */
  readonly officeHolder?: string;
  readonly debtorName: string;
  /** Any property address known for the estate; usually absent on these. */
  readonly propertyAddress?: string;
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

export function draftInsolvencyLetter(input: InsolvencyLetterInput): string {
  const s = input.sender;
  const name = orPlaceholder(s.legalName ?? s.tradingName, "company name");
  const office = orPlaceholder(s.registeredOffice, "registered office address");
  const email = orPlaceholder(s.contactEmail, "contact email");
  const phoneLine = s.contactPhone !== undefined ? ` or ${s.contactPhone}` : "";

  const recipient =
    input.officeHolder !== undefined && input.officeHolder !== ""
      ? input.officeHolder
      : "c/o the trustee or Official Receiver named in the notice";

  const subject =
    input.propertyAddress !== undefined && input.propertyAddress !== ""
      ? `Re: The bankruptcy of ${input.debtorName} — the property at ${input.propertyAddress}`
      : `Re: The bankruptcy of ${input.debtorName}`;

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
    "The Trustee in Bankruptcy / Official Receiver",
    recipient,
    "",
    "Dear Sir or Madam",
    "",
    subject,
    "",
    `We note from The Gazette the bankruptcy order made in respect of ${input.debtorName}. We are writing to the office-holder, not to the bankrupt.`,
    "",
    `We are ${name}, a property purchasing business. Where the estate includes residential property to be realised, we may be able to assist with a prompt, chain-free purchase, and we are ready to provide proof of funds on request. We understand your duty to obtain the best price reasonably obtainable, and we would expect any sale to be at arm's length and properly evidenced; this is an expression of interest, not an offer, and carries no obligation.`,
    "",
    "To be clear about cost: a purchase by us carries no fee or commission payable to the estate — no fees of any kind, and nothing to pay up front. We are the buyer, not an agent, so nothing is deducted from what the estate realises on our side of the transaction.",
    "",
    `If a property in the estate is to be marketed or sold, we would be glad to be considered. You can reach us at ${email}${phoneLine}. If you would prefer we did not write again, one line to the same address is enough.`,
    "",
    "How we hold your information",
    `We identified this matter solely from the notice in The Gazette, published under the Open Government Licence, and this approach is to you as the appointed office-holder in your professional capacity. We rely on our legitimate interest in being considered as a purchaser of estate property, balanced against your interests, and it stops the moment you ask. You have the right to object and to ask us to erase your information.${icoSentence}${dpSentence}`,
    "",
    "Yours faithfully",
    "",
    "",
    name,
    ...(footerParts.length > 0 ? ["", footerParts.join(" ")] : []),
  ].join("\n");
}
