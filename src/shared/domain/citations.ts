/**
 * Primary sources, and the rule that a URL is never typed.
 *
 * Answer engines cite pages that cite. A post that says "stamp duty is charged
 * at these rates" and names nothing is a claim; one that names the Act, the
 * section and the authority is a citation, and it is the difference between
 * being summarised and being credited. That is the SEO half of why this module
 * exists.
 *
 * The other half is the same rule as everywhere else on this platform: nothing
 * is published from a string somebody remembered. A deep link into a
 * government guidance page is a slug that changes without notice and cannot be
 * checked from here, and a dead citation is worse than none — it is a claim to
 * authority that collapses the moment a reader clicks it.
 *
 * So references come in two shapes and only two:
 *
 *  - **Legislation** is an identity — a kind, a year, a chapter or SI number
 *    and optionally a section — and the URL is *derived* from it.
 *    `legislation.gov.uk` addresses are structural, so a reference that is
 *    correct as a citation is correct as a link, by construction.
 *  - **Guidance** names the authority and the document, and links to the
 *    authority's own root, which is a domain rather than a path. It is an
 *    honest reference and it survives a redesign of somebody else's website.
 *
 * There is no third shape, and specifically no field for a typed deep URL. A
 * test refuses one.
 */

/** Primary and secondary legislation, as `legislation.gov.uk` files them. */
export type LegislationKind =
  /** UK Public General Act. `number` is the chapter. */
  | "ukpga"
  /** UK Statutory Instrument. `number` is the SI number within its year. */
  | "uksi"
  /** Act of the Scottish Parliament. `number` is the asp number. */
  | "asp"
  /** Act of Senedd Cymru, as filed for 2017. `number` is the chapter. */
  | "anaw";

export interface Legislation {
  readonly kind: LegislationKind;
  readonly year: number;
  readonly number: number;
  readonly title: string;
  /** A section or regulation, where the citation is to one. */
  readonly section?: string;
}

/**
 * The URL for a piece of legislation, derived from its identity.
 *
 * `legislation.gov.uk` is addressed as `/{kind}/{year}/{number}`, with
 * `/section/{n}` appended for a section of an Act and `/regulation/{n}` for a
 * regulation of an instrument. Nothing here is remembered: given the year and
 * the chapter number, which are part of how an Act is cited in the first
 * place, the address follows.
 */
export function legislationUrl(ref: Legislation): string {
  const base = `https://www.legislation.gov.uk/${ref.kind}/${ref.year}/${ref.number}`;
  if (ref.section === undefined) return base;
  // Acts have sections; statutory instruments have regulations. The devolved
  // Acts are Acts.
  const part = ref.kind === "uksi" ? "regulation" : "section";
  return `${base}/${part}/${ref.section}`;
}

/** How a lawyer would write it: "Estate Agents Act 1979, s. 18". */
export function legislationLabel(ref: Legislation): string {
  if (ref.section === undefined) return ref.title;
  const part = ref.kind === "uksi" ? "reg." : "s.";
  return `${ref.title}, ${part} ${ref.section}`;
}

/* ------------------------------------------------------------ authorities */

export type AuthorityKey =
  | "hmrc"
  | "hm-land-registry"
  | "fca"
  | "national-trading-standards"
  | "ico"
  | "companies-house"
  | "desnz";

export interface Authority {
  readonly key: AuthorityKey;
  readonly name: string;
  /**
   * The authority's own root. A domain, never a path.
   *
   * A root outlives a content restructure; a deep link into guidance does not,
   * and there is no way to check one from a build that cannot reach the
   * network. If a reference needs to be more specific than this, the specific
   * part belongs in the document title where a reader can search for it.
   */
  readonly root: string;
}

export const AUTHORITIES: readonly Authority[] = [
  { key: "hmrc", name: "HM Revenue & Customs", root: "https://www.gov.uk" },
  { key: "hm-land-registry", name: "HM Land Registry", root: "https://landregistry.data.gov.uk" },
  { key: "fca", name: "Financial Conduct Authority", root: "https://www.handbook.fca.org.uk" },
  {
    key: "national-trading-standards",
    name: "National Trading Standards Estate and Letting Agency Team",
    root: "https://www.nationaltradingstandards.uk",
  },
  { key: "ico", name: "Information Commissioner's Office", root: "https://ico.org.uk" },
  {
    key: "companies-house",
    name: "Companies House",
    root: "https://find-and-update.company-information.service.gov.uk",
  },
  {
    key: "desnz",
    name: "Department for Energy Security and Net Zero",
    root: "https://epc.opendatacommunities.org",
  },
];

export function authority(key: AuthorityKey): Authority {
  const found = AUTHORITIES.find((a) => a.key === key);
  if (found === undefined) throw new Error(`No authority recorded for "${key}".`);
  return found;
}

/* -------------------------------------------------------------- citations */

export type CitationKey =
  | "estate-agents-act"
  | "estate-agents-act-s18"
  | "estate-agents-information-regs"
  | "fsma"
  | "fsma-s21"
  | "financial-promotion-order"
  | "regulated-activities-order"
  | "money-laundering-regs"
  | "money-laundering-regs-r28"
  | "unfair-trading-regs"
  | "dmcc-act"
  | "pecr"
  | "pecr-r22"
  | "companies-act-s82"
  | "consumer-rights-act"
  | "data-protection-act"
  | "land-registration-act"
  | "mees-regs"
  | "lbtt-scotland"
  | "ltt-wales"
  | "stamp-duty"
  | "additional-dwelling-rates"
  | "corporation-tax"
  | "price-paid-data"
  | "house-price-index"
  | "epc-register"
  | "material-information"
  | "fca-perg-8"
  | "hmrc-estate-agency-supervision";

export interface Citation {
  readonly key: CitationKey;
  /** What it is called, as a reader would search for it. */
  readonly title: string;
  /** What it establishes, in one sentence. Never "see also". */
  readonly establishes: string;
  /** Exactly one of these. Legislation derives its URL; guidance does not. */
  readonly legislation?: Legislation;
  readonly authorityKey?: AuthorityKey;
}

const EAA: Legislation = { kind: "ukpga", year: 1979, number: 38, title: "Estate Agents Act 1979" };
const FSMA: Legislation = {
  kind: "ukpga",
  year: 2000,
  number: 8,
  title: "Financial Services and Markets Act 2000",
};
const DMCC: Legislation = {
  kind: "ukpga",
  year: 2024,
  number: 13,
  title: "Digital Markets, Competition and Consumers Act 2024",
};
const MLR: Legislation = {
  kind: "uksi",
  year: 2017,
  number: 692,
  title: "Money Laundering, Terrorist Financing and Transfer of Funds Regulations 2017",
};
const PECR: Legislation = {
  kind: "uksi",
  year: 2003,
  number: 2426,
  title: "Privacy and Electronic Communications (EC Directive) Regulations 2003",
};

export const CITATIONS: readonly Citation[] = [
  {
    key: "estate-agents-act",
    title: EAA.title,
    establishes:
      "What counts as estate agency work: things done on instructions from somebody who wants to sell, for the purpose of introducing a buyer.",
    legislation: EAA,
  },
  {
    key: "estate-agents-act-s18",
    title: legislationLabel({ ...EAA, section: "18" }),
    establishes:
      "A fee must be disclosed to the client before they are bound, or it is unenforceable without a court's permission.",
    legislation: { ...EAA, section: "18" },
  },
  {
    key: "estate-agents-information-regs",
    title: "Estate Agents (Provision of Information) Regulations 1991",
    establishes: "The form the disclosure takes, and when it must be given.",
    legislation: {
      kind: "uksi",
      year: 1991,
      number: 859,
      title: "Estate Agents (Provision of Information) Regulations 1991",
    },
  },
  {
    key: "fsma",
    title: FSMA.title,
    establishes: "The perimeter: which activities may only be carried on by an authorised person.",
    legislation: FSMA,
  },
  {
    key: "fsma-s21",
    title: legislationLabel({ ...FSMA, section: "21" }),
    establishes:
      "An invitation or inducement to engage in investment activity may only be communicated or approved by an authorised person.",
    legislation: { ...FSMA, section: "21" },
  },
  {
    key: "financial-promotion-order",
    title: "Financial Services and Markets Act 2000 (Financial Promotion) Order 2005",
    establishes:
      "Which investments are controlled, and the exemptions — including high net worth and sophisticated investor categorisation.",
    legislation: {
      kind: "uksi",
      year: 2005,
      number: 1529,
      title: "Financial Services and Markets Act 2000 (Financial Promotion) Order 2005",
    },
  },
  {
    key: "regulated-activities-order",
    title: "Financial Services and Markets Act 2000 (Regulated Activities) Order 2001",
    establishes:
      "Which activities are regulated, including regulated mortgage contracts and credit broking.",
    legislation: {
      kind: "uksi",
      year: 2001,
      number: 544,
      title: "Financial Services and Markets Act 2000 (Regulated Activities) Order 2001",
    },
  },
  {
    key: "money-laundering-regs",
    title: MLR.title,
    establishes: "Customer due diligence obligations, and who must be supervised to carry them out.",
    legislation: MLR,
  },
  {
    key: "money-laundering-regs-r28",
    title: legislationLabel({ ...MLR, section: "28" }),
    establishes:
      "What customer due diligence requires: identify the customer, verify them from a reliable independent source, and identify those behind an entity.",
    legislation: { ...MLR, section: "28" },
  },
  {
    key: "unfair-trading-regs",
    title: "Consumer Protection from Unfair Trading Regulations 2008",
    establishes:
      "The misleading action and misleading omission tests, as they stood before the 2024 Act replaced them for most purposes.",
    legislation: {
      kind: "uksi",
      year: 2008,
      number: 1277,
      title: "Consumer Protection from Unfair Trading Regulations 2008",
    },
  },
  {
    key: "dmcc-act",
    // Part 4 rather than a section number. The chapter of an Act is part of how
    // it is cited and the URL follows from it; a section number is not, and a
    // citation that names the wrong section is the exact failure this module
    // exists to prevent. The title says where to look.
    title: `${DMCC.title}, Part 4`,
    establishes:
      "The current consumer protection regime: misleading actions and misleading omissions, which replaced the 2008 Regulations for most purposes in April 2025.",
    legislation: DMCC,
  },
  {
    key: "pecr",
    title: PECR.title,
    establishes: "The rules on unsolicited electronic marketing.",
    legislation: PECR,
  },
  {
    key: "pecr-r22",
    title: legislationLabel({ ...PECR, section: "22" }),
    establishes:
      "Unsolicited electronic mail may not be sent to an individual subscriber without their consent. There is no legitimate-interests route.",
    legislation: { ...PECR, section: "22" },
  },
  {
    key: "companies-act-s82",
    title: "Companies Act 2006, s. 82",
    establishes: "Trading disclosures: the registered name and particulars a company must publish.",
    legislation: { kind: "ukpga", year: 2006, number: 46, title: "Companies Act 2006", section: "82" },
  },
  {
    key: "consumer-rights-act",
    title: "Consumer Rights Act 2015",
    establishes: "Unfair terms, and the requirement that a term be transparent as well as fair.",
    legislation: { kind: "ukpga", year: 2015, number: 15, title: "Consumer Rights Act 2015" },
  },
  {
    key: "data-protection-act",
    title: "Data Protection Act 2018",
    establishes: "UK GDPR as it applies here, including special-category data.",
    legislation: { kind: "ukpga", year: 2018, number: 12, title: "Data Protection Act 2018" },
  },
  {
    key: "land-registration-act",
    title: "Land Registration Act 2002",
    establishes: "The register, what it proves, and who is recorded as proprietor.",
    legislation: { kind: "ukpga", year: 2002, number: 9, title: "Land Registration Act 2002" },
  },
  {
    key: "mees-regs",
    title: "Energy Efficiency (Private Rented Property) Regulations 2015",
    establishes:
      "The minimum energy efficiency standard below which a property may not be let.",
    legislation: {
      kind: "uksi",
      year: 2015,
      number: 962,
      title: "Energy Efficiency (Private Rented Property) (England and Wales) Regulations 2015",
    },
  },
  {
    key: "lbtt-scotland",
    title: "Land and Buildings Transaction Tax (Scotland) Act 2013",
    establishes:
      "Scotland's own transfer tax, with its own bands and its own supplement for additional dwellings.",
    legislation: {
      kind: "asp",
      year: 2013,
      number: 11,
      title: "Land and Buildings Transaction Tax (Scotland) Act 2013",
    },
  },
  {
    key: "ltt-wales",
    title: "Land Transaction Tax and Anti-avoidance of Devolved Taxes (Wales) Act 2017",
    establishes: "Wales's own transfer tax, on the same principle and with different figures.",
    legislation: {
      kind: "anaw",
      year: 2017,
      number: 1,
      title: "Land Transaction Tax and Anti-avoidance of Devolved Taxes (Wales) Act 2017",
    },
  },
  {
    key: "stamp-duty",
    title: "Stamp Duty Land Tax rates",
    establishes: "The bands and rates in force, and the reliefs that alter them.",
    authorityKey: "hmrc",
  },
  {
    key: "additional-dwelling-rates",
    title: "Higher rates for additional dwellings",
    establishes:
      "The surcharge on a second residential property, and that a company pays it from the first pound.",
    authorityKey: "hmrc",
  },
  {
    key: "corporation-tax",
    title: "Corporation Tax rates and reliefs",
    establishes: "The main rate, the small profits rate and marginal relief between them.",
    authorityKey: "hmrc",
  },
  {
    key: "price-paid-data",
    title: "Price Paid Data",
    establishes: "Every registered residential sale in England and Wales since 1995.",
    authorityKey: "hm-land-registry",
  },
  {
    key: "house-price-index",
    title: "UK House Price Index",
    establishes: "Official movement in values, by local authority and property type.",
    authorityKey: "hm-land-registry",
  },
  {
    key: "epc-register",
    title: "Energy Performance of Buildings Register",
    establishes:
      "Every certificate lodged, with floor area, construction age band and the assessor's date.",
    authorityKey: "desnz",
  },
  {
    key: "material-information",
    title: "Material information in property listings, Parts A, B and C",
    establishes:
      "What must be stated on every listing, and what must be stated where it applies, before a property is marketed.",
    authorityKey: "national-trading-standards",
  },
  {
    key: "fca-perg-8",
    title: "FCA Perimeter Guidance, chapter 8: financial promotions",
    establishes: "How the regulator reads an invitation or inducement.",
    authorityKey: "fca",
  },
  {
    key: "hmrc-estate-agency-supervision",
    title: "Money laundering supervision for estate agency businesses",
    establishes: "Who must register, and that carrying on the business unregistered is an offence.",
    authorityKey: "hmrc",
  },
];

export function citation(key: CitationKey): Citation {
  const found = CITATIONS.find((c) => c.key === key);
  if (found === undefined) throw new Error(`No citation recorded for "${key}".`);
  return found;
}

export interface CitationLink {
  readonly key: CitationKey;
  readonly title: string;
  readonly establishes: string;
  /** Who stands behind it — the publisher, for the reader and for a citation. */
  readonly publisher: string;
  readonly url: string;
  /** True where the URL addresses the document itself rather than its publisher. */
  readonly direct: boolean;
}

/**
 * A citation resolved to something renderable.
 *
 * `direct` is load-bearing and is shown: a link to the section of an Act and a
 * link to a regulator's homepage are not the same promise, and a reader who
 * clicks the second expecting the first has been misled by a citation, which is
 * the one thing a citation must never do.
 */
export function resolveCitation(key: CitationKey): CitationLink {
  const found = citation(key);
  if (found.legislation !== undefined) {
    return {
      key: found.key,
      title: found.title,
      establishes: found.establishes,
      publisher: "legislation.gov.uk",
      url: legislationUrl(found.legislation),
      direct: true,
    };
  }
  if (found.authorityKey !== undefined) {
    const source = authority(found.authorityKey);
    return {
      key: found.key,
      title: found.title,
      establishes: found.establishes,
      publisher: source.name,
      url: source.root,
      direct: false,
    };
  }
  throw new Error(`Citation "${key}" names neither legislation nor an authority.`);
}
