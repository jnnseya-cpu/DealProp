/**
 * The site's policies, and the footer navigation, in one place.
 *
 * Two problems this solves at once. First, the policy pages a visitor needs to
 * trust us — a privacy notice before they describe a bereavement, a complaints
 * route before they instruct us — were linked from the footer and the enquiry
 * form but did not exist, so the links went nowhere. Second, the same footer
 * link was being typed by hand, which is how a renamed slug leaves a dead link.
 *
 * So the documents are data, the footer derives its legal links from them, and
 * a test walks both directions: every policy linked from the footer resolves to
 * a document, and every document is reachable. A renamed slug breaks the test
 * before it breaks the site.
 *
 * The prose here is static and describes what the platform actually does — the
 * lawful bases, the encryption, the double opt-in, the append-only trail are
 * all real behaviours of this codebase, not boilerplate. What it deliberately
 * does NOT contain is the company's identity: the registered name, number,
 * office, the data-protection contact and the ICO number are read from the
 * environment by `identity.ts` and rendered beside every policy, because a
 * policy that states a placeholder company number states a false one.
 */

export interface LegalSection {
  readonly heading: string;
  readonly body: readonly string[];
}

export interface LegalDocument {
  readonly slug: string;
  readonly title: string;
  /** Short label for the footer and nav, where the full title is too long. */
  readonly navLabel: string;
  /** One sentence, for the page intro and the meta description. */
  readonly summary: string;
  /** ISO date the content was last changed. */
  readonly updated: string;
  readonly sections: readonly LegalSection[];
  /** Cross-references rendered as a short "See also" list. */
  readonly links?: readonly { readonly label: string; readonly href: string }[];
}

const UPDATED = "2026-10-21";

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    slug: "privacy",
    title: "Privacy notice",
    navLabel: "Privacy",
    summary:
      "What we collect when you tell us about a property, why we hold it, who ever sees it, and the control you keep over it.",
    updated: UPDATED,
    sections: [
      {
        heading: "The short version",
        body: [
          "We use what you tell us to show you the routes that could solve your situation, and for nothing else. We never sell your information. No buyer, investor or funder sees your personal information without a separate check that they are entitled to.",
          "You can ask us at any time to show you what we hold, correct it, or delete it. Nothing you see on this site is an offer, and sending us an enquiry puts you under no obligation.",
        ],
      },
      {
        heading: "What we collect, and why",
        body: [
          "When you send an enquiry, we collect what you choose to tell us about your situation and your property, and an estimate of its value. We use it to compute the routes that are genuinely available to you.",
          "We ask a small number of questions about your circumstances — whether you are under financial pressure, whether a health condition affects your decision, your age band. You can leave any of them blank. We ask only to decide what protections to put in place for you, and leaving one blank makes us more careful, never less.",
          "If you hold an account — as an operator, investor or funder — we hold your sign-in details and the records of what you were shown and when, because access to deal material is something we have to be able to account for.",
        ],
      },
      {
        heading: "Our lawful bases",
        body: [
          "For an enquiry, we rely on taking steps at your request. Showing you your options is the step you asked us to take.",
          "The questions about your circumstances are special-category data under Article 9 of the UK GDPR. We process them only with your consent, to apply safeguards for your own protection, and we encrypt them. You can withdraw that consent at any time, and we will delete them.",
          "Where we identify a property from public registers published under open licences, we rely on our legitimate interest in finding owners who may want the kind of help we offer — balanced against your interests, which is why any approach to an individual is by letter, never automated, and stops the moment you ask.",
          "Marketing email is sent only to people who have asked for it and confirmed the request. We rely on your consent, and every message carries a one-click way to stop.",
          "Some processing we have to do by law: anti-money-laundering checks, tax records, and keeping an audit trail of who accessed deal material.",
        ],
      },
      {
        heading: "Who sees it",
        body: [
          "Your situation, your figures and the safeguards raised for you are private to you and the people working on your enquiry. A buyer, investor or funder never sees your personal information unless and until they hold a current certification that entitles them to, and even then only the specific material that step requires.",
          "We use a small number of processors — for payments, for sending email, for hosting — under contracts that bind them to use your data only as we instruct. We do not sell data to anyone, for any purpose.",
          "The questions you answer about your circumstances are encrypted at rest, so that even within our own systems they are not readable except where they are needed to protect you.",
        ],
      },
      {
        heading: "How long we keep it",
        body: [
          "We keep an enquiry for as long as it is useful to you and to any transaction that follows, and then no longer than our legal obligations require. Records we have to keep by law — anti-money-laundering, tax, the audit trail — are kept for the period the law sets and then deleted.",
          "If you ask us to delete your information, we will, except for the minimum we are legally required to retain, which we will tell you about.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "You have the right to see what we hold about you, to have it corrected, to have it deleted, to restrict or object to how we use it, to receive it in a portable form, and to withdraw any consent you have given.",
          "To exercise any of these, contact us using the details beside this notice. We will respond within one month.",
          "If you are not satisfied with how we have handled your information, you can complain to the Information Commissioner's Office. We would ask you to raise it with us first so we can put it right.",
        ],
      },
    ],
    links: [
      { label: "Stop hearing from us (one click, no account)", href: "/outreach/opt-out" },
      { label: "Information Commissioner's Office", href: "https://ico.org.uk/make-a-complaint/" },
      { label: "How we find and contact people", href: "/legal/outreach" },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie policy",
    navLabel: "Cookies",
    summary:
      "We keep cookies to the minimum. The analytics ones load only if you agree, and never on a page carrying your situation.",
    updated: UPDATED,
    sections: [
      {
        heading: "What we use, and what we don't",
        body: [
          "We use the few cookies the site genuinely needs to work: keeping an operator signed in, and protecting forms against cross-site submission. These do not track you and need no consent.",
          "We do not use cookies to build a profile of you, and we do not share cookie data with advertisers as a matter of course.",
        ],
      },
      {
        heading: "Analytics, only if you agree",
        body: [
          "We can load analytics from Meta and Google to understand which pages help people. These load only after you have given consent, only on a short list of public pages, and never on any page that carries your situation, your address or your figures.",
          "If you decline, or use an ad blocker, nothing analytics-related loads and the site works exactly the same.",
        ],
      },
      {
        heading: "How we count article reads without a cookie",
        body: [
          "We count how many times an article is opened, on our own server, as a single number per article. There is no identifier, no per-visit record and no cookie involved, so there is nothing that could be turned back into a person — which is why it needs no consent and survives an ad blocker.",
        ],
      },
      {
        heading: "Controlling cookies",
        body: [
          "You can change or withdraw your consent at any time, and you can block or delete cookies in your browser settings. Blocking the essential ones may stop parts of the operator area working; everything a seller or visitor uses will still work.",
        ],
      },
    ],
    links: [{ label: "How we use your information", href: "/legal/privacy" }],
  },
  {
    slug: "terms",
    title: "Terms of use",
    navLabel: "Terms",
    summary:
      "What this service is and is not: a deal engine that computes a position, never advice, never an offer, never a guarantee of a sale.",
    updated: UPDATED,
    sections: [
      {
        heading: "What Lode is",
        body: [
          "Lode is a Property Deal OS. It computes a position on a property — the routes available, what each pays and when, and what each costs — from the information it is given.",
          "It is not a portal, an estate agent of record, a lender or a financial adviser, except where a specific regulated activity is carried out under the permissions, redress-scheme membership and supervision recorded in the footer.",
        ],
      },
      {
        heading: "Not advice, not an offer",
        body: [
          "Every figure on this site is an estimate produced by an engine from the inputs it was given. It is not financial, legal, tax or investment advice, and it is not a valuation. Tax figures in particular require professional review.",
          "Nothing shown to you is an offer to buy, to lend or to transact, and nothing you do here binds you. You are always free to go to the open market instead.",
        ],
      },
      {
        heading: "Using the site properly",
        body: [
          "Give us accurate information, and do not use the site to break the law, to infringe anyone's rights, or to attempt to gain access to areas or data you are not entitled to.",
          "The operator, investor and funder areas are access-controlled. Do not share credentials, and do not attempt to view deal material without the certification that entitles you to it.",
        ],
      },
      {
        heading: "Fees",
        body: [
          "Seeing your options as a seller is free, and there is nothing for a seller to pay to use the engine. Where we act on a sale and a fee applies, it is a percentage of the price achieved, payable on completion and at no other point, and only where you have signed an agreement for it and been told about it in advance.",
          "Operator, investor and funder plans are priced on the pricing page. The price always comes from our catalogue on the server; nothing you submit carries an amount.",
        ],
      },
      {
        heading: "Liability",
        body: [
          "We take care that the engine computes correctly, but we do not warrant that an estimate will match an outcome, that a route will complete, or that the site will be uninterrupted. To the extent the law allows, we are not liable for decisions taken in reliance on an estimate without professional advice.",
          "Nothing in these terms limits liability for anything that cannot lawfully be limited, including death or personal injury caused by negligence, or fraud.",
        ],
      },
      {
        heading: "Governing law and changes",
        body: [
          "These terms are governed by the laws of England and Wales, and are subject to the courts of England and Wales.",
          "We may update these terms and will change the date at the top when we do. Continuing to use the site after a change means you accept the updated terms.",
        ],
      },
    ],
    links: [{ label: "How to complain", href: "/legal/complaints" }],
  },
  {
    slug: "complaints",
    title: "Complaints",
    navLabel: "Complaints",
    summary: "How to tell us something has gone wrong, what we will do about it, and who to go to if we do not put it right.",
    updated: UPDATED,
    sections: [
      {
        heading: "Tell us first",
        body: [
          "If something has gone wrong, tell us, using the contact details beside this page. Give us your reference if you have one, and what you would like us to do. A complaint by email reaches a person, not a form.",
          "We will acknowledge your complaint within three working days and give you a considered response within fifteen working days. If we need longer, we will tell you why and when to expect an answer.",
        ],
      },
      {
        heading: "If we do not put it right",
        body: [
          "If your complaint is about an estate-agency matter and you are not satisfied with our final response, you can refer it to the redress scheme recorded in the footer, which provides independent resolution at no cost to you.",
          "If your complaint is about how we have handled your personal information, you can refer it to the Information Commissioner's Office.",
        ],
      },
      {
        heading: "Fairness",
        body: [
          "We treat a complaint as information about how to do better, not as something to defend against. A complaint about contact we should not have made is actioned immediately, with no threshold and no review — there is no version of 'this is spam' that means we write to you again.",
        ],
      },
    ],
    links: [
      { label: "Stop hearing from us (one click)", href: "/outreach/opt-out" },
      { label: "Information Commissioner's Office", href: "https://ico.org.uk/make-a-complaint/" },
    ],
  },
  {
    slug: "outreach",
    title: "How we find and contact people",
    navLabel: "Outreach",
    summary:
      "We find owners and funders from licensed public records, approach individuals only by letter, and stop the instant you ask.",
    updated: UPDATED,
    sections: [
      {
        heading: "Where our information comes from",
        body: [
          "We find properties and organisations from public records published under open licences — the Land Registry's Price Paid data, the energy performance register, the Gazette's official notices, Companies House, and a company's or funder's own published pages. We read each only where its licence permits it.",
          "We do not scrape property portals, we do not harvest social-media profiles, and we never guess an email address. If a contact detail was not published, we do not have it.",
        ],
      },
      {
        heading: "How we contact an individual",
        body: [
          "If you are a named individual rather than a business, we contact you by post, not by email or automated message — that is what the law requires, and we built the system so there is no other path. We screen against the Mailing Preference Service first, we tell you who we are and why we are writing, and we record our reasoning before anything is sent.",
          "No approach is automated. A named person decides to send each one. We will not approach you at all before we have checked who an interested buyer is and that they are funded.",
        ],
      },
      {
        heading: "Stopping",
        body: [
          "You can stop hearing from us in one click, without an account, at the opt-out link below. A request to stop is honoured immediately and permanently, and it survives anything else happening in our systems.",
          "If you tell us a contact was unwelcome, we treat that as a complaint and suppress you straight away.",
        ],
      },
    ],
    links: [
      { label: "Stop hearing from us (one click, no account)", href: "/outreach/opt-out" },
      { label: "How we use your information", href: "/legal/privacy" },
    ],
  },
];

export function legalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((d) => d.slug === slug);
}

/* ------------------------------------------------------- footer navigation */

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

/** The product links, as the footer has always shown them. */
export const FOOTER_PRODUCT: readonly NavLink[] = [
  { href: "/appraise", label: "Free appraisal" },
  { href: "/sell", label: "Selling a property" },
  { href: "/partners", label: "Agents and professionals" },
  { href: "/invest", label: "Buy Boxes" },
  { href: "/capital", label: "Funding Boxes" },
];

/** Who we are and how it works — the pages a visitor reads before trusting us. */
export const FOOTER_COMPANY: readonly NavLink[] = [
  { href: "/about", label: "About us" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/blog", label: "Writing" },
  { href: "/newsletter", label: "Newsletter" },
];

/**
 * The legal links, derived from the documents so a renamed slug cannot leave a
 * dead link. The order is the order the documents are declared in.
 */
export const FOOTER_LEGAL: readonly NavLink[] = LEGAL_DOCUMENTS.map((d) => ({
  href: `/legal/${d.slug}`,
  label: d.navLabel,
}));
