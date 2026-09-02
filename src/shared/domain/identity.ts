/**
 * Who this company is, as a matter of law and of trust.
 *
 * The landing page could describe the engine in nine sections and still fail
 * the only test a stranger applies first: does a real company exist behind
 * this, and can I find it if something goes wrong. Nothing on the site
 * answered that — no company number, no registered office, no supervision,
 * no named person — which for a platform that asks a seller about a
 * bereavement and a funder for six figures is not a marketing gap.
 *
 * Two things follow from that, and both shape this file.
 *
 * **Nothing here is invented.** Every value is read from configuration and is
 * absent by default. A placeholder company number is worse than none: it is a
 * false statement of identity, it is the kind of thing a regulator treats as
 * a misleading action, and it would look correct in review.
 *
 * **The absence is enforced, not merely visible.** `identityGaps()` returns
 * what is missing and why it matters, the preflight reads it and blocks, and
 * the footer prints only what has actually been recorded. So the site cannot
 * launch claiming to be a company it has not been told it is.
 *
 * The requirements themselves: the Companies Act 2006 s.82 and the Company,
 * Limited Liability Partnership and Business (Names and Trading Disclosures)
 * Regulations 2015 require a company's registered name, number, place of
 * registration and registered office on its websites. The rest — ICO
 * registration under the Data Protection (Charges and Information) Regulations
 * 2018, HMRC anti-money-laundering supervision for estate agency work, and
 * redress scheme membership — are conditions of doing this particular business
 * at all, and the revenue engine already refuses the income that depends on
 * them.
 */

export interface CompanyIdentity {
  readonly legalName?: string;
  readonly tradingName?: string;
  /** Companies House registered number. */
  readonly companyNumber?: string;
  /** "England and Wales", "Scotland", "Northern Ireland". */
  readonly placeOfRegistration?: string;
  readonly registeredOffice?: string;
  /** ICO data protection registration reference. */
  readonly icoRegistration?: string;
  /** HMRC anti-money-laundering supervision number. */
  readonly amlSupervision?: string;
  /** Property redress scheme and membership number. */
  readonly redressScheme?: string;
  /** A monitored address a person can actually write to. */
  readonly contactEmail?: string;
  readonly contactPhone?: string;
  /** The named person accountable for data protection enquiries. */
  readonly dataProtectionContact?: string;
}

export interface IdentityGap {
  readonly key: keyof CompanyIdentity;
  readonly label: string;
  /** Why its absence matters, in a sentence somebody can act on. */
  readonly consequence: string;
  /** True where trading without it is unlawful rather than merely unwise. */
  readonly blocking: boolean;
}

/**
 * What must be recorded, and what it costs to leave each one out.
 *
 * Ordered by consequence. The first four are statutory disclosures; the last
 * are the ones a seller or a funder looks for before deciding you are real.
 */
const REQUIREMENTS: readonly IdentityGap[] = [
  {
    key: "legalName",
    label: "Registered company name",
    consequence:
      "Trading disclosures require the registered name on the website. Without it no visitor can identify who they are contracting with.",
    blocking: true,
  },
  {
    key: "companyNumber",
    label: "Company number",
    consequence:
      "Required by the Companies Act 2006 s.82 on every website. It is also the one field that lets a stranger verify the company exists.",
    blocking: true,
  },
  {
    key: "placeOfRegistration",
    label: "Place of registration",
    consequence: "Required alongside the number, and it determines which register to look in.",
    blocking: true,
  },
  {
    key: "registeredOffice",
    label: "Registered office",
    consequence:
      "Required on the website, and it is the address at which a seller or a funder can serve anything on you.",
    blocking: true,
  },
  {
    key: "icoRegistration",
    label: "ICO registration",
    consequence:
      "This platform processes health and capacity concerns reported by sellers, which is special-category data. Processing it without a current registration is an offence.",
    blocking: true,
  },
  {
    key: "contactEmail",
    label: "Contact address",
    consequence:
      "A seller who wants to withdraw, or a recipient who wants to be removed, needs somewhere to write that is not a form.",
    blocking: true,
  },
  {
    key: "amlSupervision",
    label: "HMRC AML supervision",
    consequence:
      "Introducing sellers to buyers for a fee is estate agency work. dealRevenue() already excludes that income until this is recorded; recording it here does not grant it.",
    blocking: false,
  },
  {
    key: "redressScheme",
    label: "Redress scheme",
    consequence: "Required alongside AML supervision for estate agency work.",
    blocking: false,
  },
  {
    key: "dataProtectionContact",
    label: "Data protection contact",
    consequence: "A named person for subject access requests, rather than an unattended inbox.",
    blocking: false,
  },
];

/** Read from configuration. Absent by default, and absent means absent. */
export function companyIdentity(
  env: Record<string, string | undefined> = {},
): CompanyIdentity {
  const value = (key: string): string | undefined => {
    const raw = env[key];
    return raw === undefined || raw.trim() === "" ? undefined : raw.trim();
  };

  return {
    ...(value("COMPANY_LEGAL_NAME") !== undefined ? { legalName: value("COMPANY_LEGAL_NAME") } : {}),
    ...(value("COMPANY_TRADING_NAME") !== undefined
      ? { tradingName: value("COMPANY_TRADING_NAME") }
      : {}),
    ...(value("COMPANY_NUMBER") !== undefined ? { companyNumber: value("COMPANY_NUMBER") } : {}),
    ...(value("COMPANY_PLACE_OF_REGISTRATION") !== undefined
      ? { placeOfRegistration: value("COMPANY_PLACE_OF_REGISTRATION") }
      : {}),
    ...(value("COMPANY_REGISTERED_OFFICE") !== undefined
      ? { registeredOffice: value("COMPANY_REGISTERED_OFFICE") }
      : {}),
    ...(value("ICO_REGISTRATION") !== undefined
      ? { icoRegistration: value("ICO_REGISTRATION") }
      : {}),
    ...(value("AML_SUPERVISION") !== undefined ? { amlSupervision: value("AML_SUPERVISION") } : {}),
    ...(value("REDRESS_SCHEME") !== undefined ? { redressScheme: value("REDRESS_SCHEME") } : {}),
    ...(value("CONTACT_EMAIL") !== undefined ? { contactEmail: value("CONTACT_EMAIL") } : {}),
    ...(value("CONTACT_PHONE") !== undefined ? { contactPhone: value("CONTACT_PHONE") } : {}),
    ...(value("DATA_PROTECTION_CONTACT") !== undefined
      ? { dataProtectionContact: value("DATA_PROTECTION_CONTACT") }
      : {}),
  };
}

/** Everything not yet recorded, worst first. */
export function identityGaps(identity: CompanyIdentity): readonly IdentityGap[] {
  return REQUIREMENTS.filter((r) => identity[r.key] === undefined);
}

/** True where every statutory disclosure has been recorded. */
export function identityComplete(identity: CompanyIdentity): boolean {
  return identityGaps(identity).every((g) => !g.blocking);
}

/**
 * The line a visitor reads, assembled from what is actually known.
 *
 * Returns undefined rather than a partial sentence: "Registered in , number "
 * is worse than saying nothing, because it looks like a bug in the place a
 * reader is deciding whether to trust you.
 */
export function registrationLine(identity: CompanyIdentity): string | undefined {
  const { legalName, companyNumber, placeOfRegistration } = identity;
  if (legalName === undefined || companyNumber === undefined || placeOfRegistration === undefined) {
    return undefined;
  }
  return `${legalName} is registered in ${placeOfRegistration}, company number ${companyNumber}.`;
}
