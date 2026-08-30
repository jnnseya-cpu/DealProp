import { randomUUID } from "node:crypto";
import type { Candidate, DiscoveredFact, Provenance } from "@shared/domain/outreach";
import { Fetcher, type FetchResult } from "@backend/discovery/fetcher";
import {
  extractContacts,
  parseCompanyProfile,
  parseFirmDetails,
  recipientTypeFromName,
  type CompanyRecord,
  type RegisterRecord,
} from "@backend/discovery/extract";

/**
 * The three sources this platform is licensed to read for funder discovery.
 *
 * Each fails closed. Companies House and the FCA Register both require an API
 * key issued to a named account under terms that were accepted at registration
 * — that acceptance is the licence, so without the key there is no licence and
 * nothing is read. Neither is scraped: both publish an official API, and using
 * it is the difference between a permitted read and an unwelcome one.
 *
 * NOTE ON VERIFICATION: outbound access is blocked in this environment, so no
 * live call has been made from here. Every parser is fixture-tested against the
 * published field definitions; the gates are tested against an injected
 * transport. Make one live call per source before relying on any of this.
 */

const COMPANIES_HOUSE = "companies-house";
const FCA_REGISTER = "fca-register";
const OWN_WEBSITE = "funder-own-website";

export interface ConnectorResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly reason: string;
  readonly provenance?: Provenance;
}

function provenanceOf(sourceKey: string, result: FetchResult): Provenance {
  return {
    sourceKey,
    sourceUrl: result.url,
    observedAt: result.fetchedAt,
    inferred: false,
  };
}

/* ------------------------------------------------------- Companies House */

/**
 * Confirm an organisation exists, is trading, and is what it says it is.
 *
 * Basic authentication with the API key as the username is what the API
 * specifies; it is not a credential embedded in a URL, which is the thing the
 * fetcher refuses.
 */
export async function lookupCompany(
  fetcher: Fetcher,
  companyNumber: string,
  apiKey: string | undefined = process.env.COMPANIES_HOUSE_API_KEY,
): Promise<ConnectorResult<CompanyRecord>> {
  if (apiKey === undefined || apiKey === "") {
    return {
      ok: false,
      reason:
        "COMPANIES_HOUSE_API_KEY is not set. The key is issued against accepted terms, and those terms are the licence, so nothing is read without it.",
    };
  }
  if (!/^[A-Z0-9]{6,10}$/i.test(companyNumber.trim())) {
    return { ok: false, reason: `${companyNumber} is not the shape of a company number.` };
  }

  const result = await fetcher.get(
    COMPANIES_HOUSE,
    `https://api.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber.trim())}`,
    { headers: { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` } },
  );
  if (!result.ok || result.body === undefined) return { ok: false, reason: result.reason };

  try {
    const record = parseCompanyProfile(JSON.parse(result.body));
    if (record === undefined) return { ok: false, reason: "The response was not a company profile." };
    return { ok: true, value: record, reason: "Confirmed against the register.", provenance: provenanceOf(COMPANIES_HOUSE, result) };
  } catch {
    return { ok: false, reason: "The response could not be read as JSON." };
  }
}

/* ----------------------------------------------------------- FCA Register */

/**
 * Confirm a firm's regulatory claim, and detect a clone.
 *
 * A cloned firm copies an authorised firm's name and FRN onto a site with a
 * different domain and different contact details. Comparing what the register
 * holds against what the website says is the check that finds it, which is why
 * the register's own contact details are returned rather than only a yes or no.
 */
export async function lookupFirm(
  fetcher: Fetcher,
  firmReference: string,
  credentials: { readonly email?: string; readonly key?: string } = {
    email: process.env.FCA_REGISTER_EMAIL,
    key: process.env.FCA_REGISTER_KEY,
  },
): Promise<ConnectorResult<RegisterRecord>> {
  if (
    credentials.email === undefined ||
    credentials.email === "" ||
    credentials.key === undefined ||
    credentials.key === ""
  ) {
    return {
      ok: false,
      reason:
        "FCA_REGISTER_EMAIL and FCA_REGISTER_KEY are not both set. Register access is issued against accepted terms; without them nothing is read.",
    };
  }
  if (!/^\d{5,7}$/.test(firmReference.trim())) {
    return { ok: false, reason: `${firmReference} is not the shape of a firm reference number.` };
  }

  const result = await fetcher.get(
    FCA_REGISTER,
    `https://register.fca.org.uk/services/V0.1/Firm/${encodeURIComponent(firmReference.trim())}`,
    { headers: { "X-Auth-Email": credentials.email, "X-Auth-Key": credentials.key, accept: "application/json" } },
  );
  if (!result.ok || result.body === undefined) return { ok: false, reason: result.reason };

  try {
    const record = parseFirmDetails(JSON.parse(result.body));
    if (record === undefined) return { ok: false, reason: "The response was not a firm record." };
    return {
      ok: true,
      value: record,
      reason: record.authorised
        ? `${record.name} is authorised.`
        : `The register shows status "${record.status}", which is not authorisation.`,
      provenance: provenanceOf(FCA_REGISTER, result),
    };
  } catch {
    return { ok: false, reason: "The response could not be read as JSON." };
  }
}

/* ------------------------------------------------- the funder's own site */

export interface WebsiteFindings {
  readonly emails: readonly DiscoveredFact<string>[];
  readonly phones: readonly DiscoveredFact<string>[];
  readonly enquiryForms: readonly DiscoveredFact<string>[];
  readonly mandateText?: DiscoveredFact<string>;
  readonly rejected: readonly { readonly value: string; readonly why: string }[];
}

/**
 * Read one page of a funder's own website.
 *
 * Bound to the verified domain by the fetcher, so a link or a redirect cannot
 * carry the read onto somebody else's site, and subject to that site's
 * robots.txt like any other client.
 */
export async function readOwnWebsite(
  fetcher: Fetcher,
  domain: string,
  path = "/",
): Promise<ConnectorResult<WebsiteFindings>> {
  const result = await fetcher.get(OWN_WEBSITE, `https://${domain}${path}`, {
    candidateDomain: domain,
  });
  if (!result.ok || result.body === undefined) return { ok: false, reason: result.reason };

  const contacts = extractContacts(result.body, domain, {
    sourceKey: OWN_WEBSITE,
    sourceUrl: result.url,
    observedAt: result.fetchedAt,
  });

  return {
    ok: true,
    value: contacts,
    reason:
      contacts.emails.length > 0
        ? `${contacts.emails.length} published contact address(es) found.`
        : "No published business contact address on this page.",
    provenance: provenanceOf(OWN_WEBSITE, result),
  };
}

/* ---------------------------------------------------------- verification */

export interface VerificationInput {
  readonly organisationName: string;
  readonly domain: string;
  readonly companyNumber?: string;
  readonly firmReference?: string;
  /** Names on any warning or sanctions list the operator has recorded. */
  readonly warningList?: readonly string[];
}

/**
 * Build a candidate from official records and the organisation's own site.
 *
 * The status it lands on decides whether anything may ever be sent, so the
 * rules are conservative: only a company confirmed active, with a published
 * business address on its own domain, and no warning-list match, reaches
 * `VERIFIED`. Anything contradictory is `CONFLICTING`, which the outreach gate
 * treats as a possible cloned firm and refuses outright.
 */
export async function buildCandidate(
  fetcher: Fetcher,
  input: VerificationInput,
): Promise<{ readonly candidate: Candidate; readonly notes: readonly string[] }> {
  const notes: string[] = [];
  const warningFlags: string[] = [];
  const at = new Date().toISOString();

  const listed = (input.warningList ?? []).some(
    (name) => name.trim().toLowerCase() === input.organisationName.trim().toLowerCase(),
  );
  if (listed) warningFlags.push("Named on a recorded warning or sanctions list");

  let company: CompanyRecord | undefined;
  if (input.companyNumber !== undefined) {
    const result = await lookupCompany(fetcher, input.companyNumber);
    notes.push(`Companies House: ${result.reason}`);
    company = result.value;
    if (company?.inactive === true) {
      warningFlags.push(`Companies House status "${company.status}"`);
    }
  } else {
    notes.push("No company number given, so nothing was confirmed against Companies House.");
  }

  let firm: RegisterRecord | undefined;
  if (input.firmReference !== undefined) {
    const result = await lookupFirm(fetcher, input.firmReference);
    notes.push(`FCA Register: ${result.reason}`);
    firm = result.value;
    if (firm !== undefined && !firm.authorised) {
      warningFlags.push(`FCA Register status "${firm.status}"`);
    }
  }

  const site = await readOwnWebsite(fetcher, input.domain);
  notes.push(`Own website: ${site.reason}`);
  for (const rejection of site.value?.rejected ?? []) {
    notes.push(`Not taken — ${rejection.value}: ${rejection.why}`);
  }

  // A clone announces itself as a mismatch between the register and the site.
  const nameConflict =
    firm !== undefined && !similar(firm.name, input.organisationName)
      ? `The register holds "${firm.name}" against FRN ${firm.firmReference}, but this site presents itself as "${input.organisationName}".`
      : company !== undefined && !similar(company.name, input.organisationName)
        ? `Companies House holds "${company.name}" against ${company.companyNumber}, not "${input.organisationName}".`
        : undefined;
  if (nameConflict !== undefined) notes.push(nameConflict);

  const email = site.value?.emails[0];
  const status = nameConflict !== undefined
    ? "CONFLICTING"
    : warningFlags.length > 0
      ? "REJECTED"
      : email !== undefined && company !== undefined && !company.inactive
        ? "VERIFIED"
        : "PARTIALLY_VERIFIED";

  const candidate: Candidate = {
    id: randomUUID(),
    organisationName: company?.name ?? input.organisationName,
    recipientType: recipientTypeFromName(company?.name ?? input.organisationName),
    ...(company !== undefined && input.companyNumber !== undefined
      ? {
          companyNumber: {
            value: company.companyNumber,
            provenance: { sourceKey: COMPANIES_HOUSE, observedAt: at, inferred: false },
          },
        }
      : {}),
    domain: {
      value: input.domain,
      provenance: { sourceKey: OWN_WEBSITE, sourceUrl: `https://${input.domain}/`, observedAt: at, inferred: false },
    },
    ...(email !== undefined ? { publishedEmail: email } : {}),
    ...(site.value?.enquiryForms[0] !== undefined ? { enquiryFormUrl: site.value.enquiryForms[0] } : {}),
    ...(site.value?.phones[0] !== undefined ? { switchboard: site.value.phones[0] } : {}),
    ...(site.value?.mandateText !== undefined ? { mandateSummary: site.value.mandateText } : {}),
    status,
    // Only a fully verified candidate carries a verification timestamp. A
    // partial one must not age into looking current.
    ...(status === "VERIFIED" ? { verifiedAt: at } : {}),
    warningFlags,
    optedOut: false,
    doNotContact: status === "REJECTED" || status === "CONFLICTING",
  };

  return { candidate, notes };
}

/** Names match allowing for punctuation and the usual suffixes. */
function similar(a: string, b: string): boolean {
  const normalise = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(limited|ltd|plc|llp|the)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  const left = normalise(a);
  const right = normalise(b);
  return left === right || left.includes(right) || right.includes(left);
}
