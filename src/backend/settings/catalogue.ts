/**
 * The configuration catalogue, and the status of each key.
 *
 * This is the read-only half of admin key management: the operator can see, in
 * one place, which keys are set and which are still missing, grouped by what
 * they power and flagged where they block launch. Entry is still via the
 * server environment for now; the encrypted in-admin editor comes after launch.
 *
 * Security: this module is server-only and must never reach the browser bundle.
 * A value is only ever surfaced as a hint — the last four characters of a
 * secret, never the secret itself — and `secretsNeverWhole` in the tests pins
 * that. `managedBy` records why a key lives where it does; three keys can never
 * move into the admin at all, because they are what reaches, decrypts and gates
 * the admin in the first place.
 */

export type KeyGroup =
  | "Core — bootstrap"
  | "Site & identity"
  | "Payments"
  | "AI"
  | "Email & outreach"
  | "Data & discovery"
  | "Scheduled & monitoring"
  | "Analytics"
  | "Permissions";

export type ManagedBy =
  /** Needed to reach, decrypt or gate the admin — can never move into it. */
  | "env-bootstrap"
  /** Compiled into the build/prerendered pages — set as a build argument. */
  | "env-build"
  /** Read at request time — a candidate for the in-admin editor later. */
  | "env-runtime";

export interface KeySpec {
  readonly key: string;
  readonly label: string;
  readonly group: KeyGroup;
  /** Masked to its last four characters when shown. */
  readonly secret: boolean;
  /** The preflight refuses to launch until this is set. */
  readonly blocksLaunch: boolean;
  readonly purpose: string;
  readonly managedBy: ManagedBy;
}

export const REQUIRED_KEYS: readonly KeySpec[] = [
  // --- Core bootstrap (never movable into the admin) ----------------------
  { key: "OPERATOR_SECRET", label: "Operator secret", group: "Core — bootstrap", secret: true, blocksLaunch: true, managedBy: "env-bootstrap", purpose: "Gates every operator surface. It is what unlocks this account." },
  { key: "DATA_ENCRYPTION_KEY", label: "Data encryption key", group: "Core — bootstrap", secret: true, blocksLaunch: true, managedBy: "env-bootstrap", purpose: "Encrypts seller special-category data, and will encrypt stored keys." },
  { key: "DATABASE_URL", label: "Database URL", group: "Core — bootstrap", secret: true, blocksLaunch: true, managedBy: "env-bootstrap", purpose: "The Postgres store. Without it the app serves from a local JSON file." },

  // --- Site & identity (build arguments; public by definition) ------------
  { key: "NEXT_PUBLIC_SITE_URL", label: "Public site URL", group: "Site & identity", secret: false, blocksLaunch: true, managedBy: "env-build", purpose: "Canonical URLs, the sitemap and every email link." },
  { key: "COMPANY_LEGAL_NAME", label: "Registered company name", group: "Site & identity", secret: false, blocksLaunch: true, managedBy: "env-build", purpose: "Required on the website for trading disclosures." },
  { key: "COMPANY_TRADING_NAME", label: "Trading name", group: "Site & identity", secret: false, blocksLaunch: false, managedBy: "env-build", purpose: "The name shown across the product." },
  { key: "COMPANY_NUMBER", label: "Companies House number", group: "Site & identity", secret: false, blocksLaunch: true, managedBy: "env-build", purpose: "Required by the Companies Act on every website." },
  { key: "COMPANY_PLACE_OF_REGISTRATION", label: "Place of registration", group: "Site & identity", secret: false, blocksLaunch: true, managedBy: "env-build", purpose: "Required alongside the company number." },
  { key: "COMPANY_REGISTERED_OFFICE", label: "Registered office", group: "Site & identity", secret: false, blocksLaunch: true, managedBy: "env-build", purpose: "The address at which anything can be served on you." },
  { key: "ICO_REGISTRATION", label: "ICO registration", group: "Site & identity", secret: false, blocksLaunch: true, managedBy: "env-build", purpose: "Processing special-category seller data requires a current registration." },
  { key: "CONTACT_EMAIL", label: "Contact email", group: "Site & identity", secret: false, blocksLaunch: true, managedBy: "env-build", purpose: "Where a seller or recipient can write to withdraw." },

  // --- Payments -----------------------------------------------------------
  { key: "BILLING_API_KEY", label: "Payment provider key", group: "Payments", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "The Stripe secret key. Until set, checkout authorises then 503s." },
  { key: "BILLING_CHECKOUT_URL", label: "Checkout endpoint", group: "Payments", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "The provider's checkout-session endpoint." },
  { key: "BILLING_WEBHOOK_SECRET", label: "Webhook signing secret", group: "Payments", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "Verifies payment confirmations. Until set, every one is refused." },

  // --- AI -----------------------------------------------------------------
  { key: "BLOG_MODEL_PROVIDER", label: "AI provider", group: "AI", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "Which model provider the live features call." },
  { key: "BLOG_MODEL_API_KEY", label: "AI API key", group: "AI", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "Without it, the AI features fall back to deterministic output." },

  // --- Email & outreach ---------------------------------------------------
  { key: "SMTP_HOST", label: "SMTP host", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "Your mail server. Set the SMTP_* group to send through normal email rather than an HTTP provider." },
  { key: "SMTP_PORT", label: "SMTP port", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "587 for STARTTLS (default), 465 for implicit TLS." },
  { key: "SMTP_USER", label: "SMTP username", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "The mailbox or API user to authenticate as." },
  { key: "SMTP_PASSWORD", label: "SMTP password", group: "Email & outreach", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "The SMTP password. Until a transport is set, email is written to the log, not sent." },
  { key: "SMTP_SECURE", label: "SMTP implicit TLS", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "\"true\" on port 465; otherwise STARTTLS is used." },
  { key: "EMAIL_API_URL", label: "Email send endpoint (HTTP alt.)", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "Alternative to SMTP: an HTTP provider the newsletter and outreach send through." },
  { key: "EMAIL_API_KEY", label: "Email API key", group: "Email & outreach", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "Until set, approved outreach writes to the log, not the recipient." },
  { key: "EMAIL_FROM", label: "From address", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "The sender address on outbound email." },
  { key: "NEWSLETTER_SENDER_NAME", label: "Sender name", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "The sender identity required in marketing email." },
  { key: "NEWSLETTER_SENDER_ADDRESS", label: "Sender postal address", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "The postal address required in marketing email." },
  { key: "NEWSLETTER_REPLY_TO", label: "Reply-to address", group: "Email & outreach", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "Where replies to the newsletter go." },

  // --- Data & discovery ---------------------------------------------------
  { key: "EPC_API_EMAIL", label: "EPC account email", group: "Data & discovery", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "EPC register access (free, registration)." },
  { key: "EPC_API_KEY", label: "EPC API key", group: "Data & discovery", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "EPC register access (free, registration)." },
  { key: "GAZETTE_DECEASED_CODE", label: "Gazette deceased code", group: "Data & discovery", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "Probate discovery notice code." },
  { key: "GAZETTE_INSOLVENCY_CODE", label: "Gazette insolvency code", group: "Data & discovery", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "Insolvency discovery notice code." },
  { key: "COMPANIES_HOUSE_API_KEY", label: "Companies House key", group: "Data & discovery", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "Funder verification against Companies House." },
  { key: "FCA_REGISTER_EMAIL", label: "FCA register email", group: "Data & discovery", secret: false, blocksLaunch: false, managedBy: "env-runtime", purpose: "Funder verification against the FCA Register." },
  { key: "FCA_REGISTER_KEY", label: "FCA register key", group: "Data & discovery", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "Funder verification against the FCA Register." },

  // --- Scheduled & monitoring --------------------------------------------
  { key: "CRON_SECRET", label: "Cron secret", group: "Scheduled & monitoring", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "Protects the scheduled endpoints and inbound outreach webhooks." },
  { key: "ERROR_REPORT_URL", label: "Error report URL", group: "Scheduled & monitoring", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "Where failures are reported. Unset means stderr only." },

  // --- Analytics (public identifiers) ------------------------------------
  { key: "NEXT_PUBLIC_GA_MEASUREMENT_ID", label: "Google Analytics ID", group: "Analytics", secret: false, blocksLaunch: false, managedBy: "env-build", purpose: "A public measurement ID; no pixel loads without it." },
  { key: "NEXT_PUBLIC_META_PIXEL_ID", label: "Meta Pixel ID", group: "Analytics", secret: false, blocksLaunch: false, managedBy: "env-build", purpose: "A public pixel ID; no pixel loads without it." },

  // --- Permissions --------------------------------------------------------
  { key: "HELD_PERMISSIONS", label: "Held permissions", group: "Permissions", secret: true, blocksLaunch: false, managedBy: "env-runtime", purpose: "The authorisations that switch on the transaction-fee revenue streams. Contains evidence, so it is masked." },
];

export interface KeyStatus {
  readonly spec: KeySpec;
  readonly set: boolean;
  /** Last four of a secret, the value of a non-secret, or "" when unset. */
  readonly hint: string;
}

function hintFor(spec: KeySpec, raw: string | undefined): string {
  if (raw === undefined) return "";
  const value = raw.trim();
  if (value === "") return "";
  if (spec.secret) return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
  return value.length > 48 ? `${value.slice(0, 45)}…` : value;
}

/** The status of every catalogued key, in catalogue order. */
export function keyStatuses(env: Record<string, string | undefined> = process.env): readonly KeyStatus[] {
  return REQUIRED_KEYS.map((spec) => {
    const raw = env[spec.key];
    const set = raw !== undefined && raw.trim() !== "";
    return { spec, set, hint: hintFor(spec, raw) };
  });
}

export interface SettingsSummary {
  readonly launchRequired: number;
  readonly launchSet: number;
  readonly launchReady: boolean;
  readonly totalSet: number;
  readonly total: number;
}

export function settingsSummary(statuses: readonly KeyStatus[]): SettingsSummary {
  const launch = statuses.filter((s) => s.spec.blocksLaunch);
  const launchSet = launch.filter((s) => s.set).length;
  return {
    launchRequired: launch.length,
    launchSet,
    launchReady: launchSet === launch.length,
    totalSet: statuses.filter((s) => s.set).length,
    total: statuses.length,
  };
}

/** The distinct groups, in the order they first appear in the catalogue. */
export function keyGroups(): readonly KeyGroup[] {
  const seen: KeyGroup[] = [];
  for (const spec of REQUIRED_KEYS) if (!seen.includes(spec.group)) seen.push(spec.group);
  return seen;
}
