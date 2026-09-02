/**
 * Go-live preflight.
 *
 * Answers one question — is this deployment safe to put in front of the public
 * — and answers it by checking, not by asserting. It exits non-zero on any
 * blocker, so it can sit in a deploy pipeline and stop a release rather than
 * printing a warning nobody reads.
 *
 * The bias is deliberate. Every check here fails closed: a value it cannot read
 * is treated as absent, and absent is a blocker wherever the consequence of
 * being wrong is a member of the public seeing something they should not, or
 * being told something untrue.
 *
 * Usage: npm run preflight
 */

import { normaliseSiteUrl } from "../src/shared/site";
import { STREAMS } from "../src/shared/domain/revenue";
import { UK_INVESTOR_CATEGORISATION } from "../src/shared/domain/jurisdictions/uk-financial-promotion";
import { DATA_SOURCES } from "../src/shared/domain/sources";
import { isDealReady } from "../src/shared/domain/jurisdictions";
import { IOS_DEVICES, PWA_ICONS, splashPath } from "../src/shared/pwa";
import { CREDIT_PACKS, PLANS, FREE_PLAN_ID, plan } from "../src/shared/domain/pricing";
import { companyIdentity, identityGaps } from "../src/shared/domain/identity";
import { heldKeys, permissionDefinition, readPermissions } from "../src/shared/domain/permissions";
import { existsSync } from "node:fs";
import path from "node:path";

type Level = "block" | "warn" | "pass";

interface Check {
  readonly level: Level;
  readonly area: string;
  readonly message: string;
  /** What to do about it. Required on anything that is not a pass. */
  readonly remedy?: string;
}

const checks: Check[] = [];
const pass = (area: string, message: string): void => {
  checks.push({ level: "pass", area, message });
};
const warn = (area: string, message: string, remedy: string): void => {
  checks.push({ level: "warn", area, message, remedy });
};
const block = (area: string, message: string, remedy: string): void => {
  checks.push({ level: "block", area, message, remedy });
};

const env = process.env;

/** Values that appear in this repository and must never reach production. */
const KNOWN_DEV_SECRETS = new Set(["test-operator-secret", "lode", "changeme", "secret", "password"]);

function secretIsWeak(value: string): string | undefined {
  if (KNOWN_DEV_SECRETS.has(value.toLowerCase())) {
    return "it is a value used in this repository's own tests";
  }
  if (value.length < 24) {
    return `it is ${value.length} characters; use at least 24`;
  }
  if (new Set(value).size < 10) {
    return "it has too little variety to have come from a random generator";
  }
  return undefined;
}

/* ------------------------------------------------------------ credentials */

function checkOperatorSecret(): void {
  const secret = env.OPERATOR_SECRET;
  if (secret === undefined || secret === "") {
    // Not a blocker for the app — it fails closed by itself — but it is a
    // blocker for a useful deployment, because every operator surface returns
    // 503 and nobody can sign in at all.
    block(
      "Access control",
      "OPERATOR_SECRET is not set, so every operator surface will return 503 and no account can be created.",
      "Generate one with `openssl rand -base64 32` and set it in the host's environment.",
    );
    return;
  }
  const weakness = secretIsWeak(secret);
  if (weakness !== undefined) {
    block(
      "Access control",
      `OPERATOR_SECRET is weak: ${weakness}.`,
      "Replace it with `openssl rand -base64 32`. It also signs every account session, so rotating it signs everybody out.",
    );
    return;
  }
  pass("Access control", "OPERATOR_SECRET is set and looks randomly generated.");
}

function checkCronSecret(): void {
  const secret = env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    warn(
      "Newsletter",
      "CRON_SECRET is not set, so the weekly send endpoint will refuse to run.",
      "Set it if the newsletter should send. Leaving it unset is safe — the endpoint fails closed — but nothing will be mailed.",
    );
    return;
  }
  const weakness = secretIsWeak(secret);
  if (weakness !== undefined) {
    block(
      "Newsletter",
      `CRON_SECRET is weak: ${weakness}. Anything that can guess it can mail every subscriber.`,
      "Replace it with `openssl rand -base64 32`.",
    );
    return;
  }
  pass("Newsletter", "CRON_SECRET is set and looks randomly generated.");
}

/* ------------------------------------------------------------- addressing */

function checkSiteUrl(): void {
  const raw = env.NEXT_PUBLIC_SITE_URL;
  if (raw === undefined || raw.trim() === "") {
    block(
      "Site address",
      "NEXT_PUBLIC_SITE_URL is not set, so canonical URLs, the sitemap and every newsletter link will point at localhost.",
      "Set it to the public origin, e.g. https://lode.example — no trailing slash.",
    );
    return;
  }
  const url = normaliseSiteUrl(raw);
  if (url.startsWith("http://")) {
    block(
      "Site address",
      `NEXT_PUBLIC_SITE_URL is ${url}, which is not HTTPS. Session cookies are marked Secure in production and will not be sent.`,
      "Serve the site over HTTPS and set the https:// origin here.",
    );
    return;
  }
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    block(
      "Site address",
      `NEXT_PUBLIC_SITE_URL is ${url}, which is not a public address.`,
      "Set it to the real origin before going live.",
    );
    return;
  }
  pass("Site address", `Canonical origin is ${url}.`);
}

/* --------------------------------------------------------------- storage */

async function checkDatabase(): Promise<void> {
  const url = env.DATABASE_URL;
  if (url === undefined || url === "") {
    block(
      "Storage",
      "DATABASE_URL is not set, so the app will use the JSON file store. On any host running more than one instance — which includes every serverless deployment — instances do not share a filesystem and writes silently diverge.",
      "Provision Postgres and set DATABASE_URL. Both engines pass the same contract suite, so nothing else changes.",
    );
    return;
  }

  if (!/\bsslmode=require\b/.test(url) && !url.includes("localhost") && !url.includes("127.0.0.1")) {
    warn(
      "Storage",
      "DATABASE_URL does not request TLS. Seller screening answers, including reported health concerns, would cross the network in the clear.",
      "Append ?sslmode=require unless the connection is over a private network that guarantees encryption.",
    );
  }

  if (/\bsslmode=(no-verify|prefer|allow)\b/.test(url)) {
    warn(
      "Storage",
      "DATABASE_URL uses an sslmode that does not authenticate the server. The connection may be encrypted but it can still be intercepted.",
      "Use sslmode=require against managed Postgres, which presents a publicly signed certificate. sslmode=no-verify is only for a self-hosted server with a self-signed certificate on a trusted network.",
    );
  }

  try {
    const { postgresStore, closePostgres } = await import("../src/backend/store/postgresStore");
    const empty = await postgresStore.isEmpty();
    const accounts = await postgresStore.listAccounts();
    await closePostgres();

    pass("Storage", "Postgres is reachable and the schema is present.");

    if (accounts.length === 0) {
      warn(
        "Accounts",
        "No accounts exist. Access will only be possible with the shared operator password, which appears in the audit trail with no name against it.",
        "Sign in with the shared password, create an administrator at /operator/accounts, then use that.",
      );
    } else {
      const admins = accounts.filter((a) => a.role === "admin" && a.disabledAt === undefined);
      if (admins.length === 0) {
        warn(
          "Accounts",
          `${accounts.length} account(s) exist but none is an active administrator, so nobody can manage accounts or read the audit trail as a named person.`,
          "Create an admin account at /operator/accounts.",
        );
      } else {
        pass("Accounts", `${admins.length} active administrator account(s).`);
      }
    }

    if (empty) {
      warn(
        "Storage",
        "The store holds no deals or mandates. The seller journey will correctly tell every seller that no buyer matches their property.",
        "That is the honest state before capital is recruited. Recruit funding and buying mandates before marketing to sellers.",
      );
    }
  } catch (error) {
    block(
      "Storage",
      `Postgres is not reachable: ${error instanceof Error ? error.message : String(error)}`,
      "Check DATABASE_URL, network access from the host, and that the database accepts connections.",
    );
  }
}

/* ----------------------------------------------------------------- email */

function checkEmail(): void {
  const configured = ["EMAIL_API_URL", "EMAIL_API_KEY", "EMAIL_FROM"].filter(
    (name) => (env[name] ?? "") !== "",
  );
  if (configured.length === 0) {
    warn(
      "Email",
      "No email provider is configured. Newsletter confirmations and issues will be logged instead of sent, so double opt-in cannot complete.",
      "Set EMAIL_API_URL, EMAIL_API_KEY and EMAIL_FROM, or leave the newsletter switched off.",
    );
  } else if (configured.length < 3) {
    block(
      "Email",
      `Email is half-configured: ${configured.join(", ")} set. A partial configuration is how a deployment mails real people from the wrong address.`,
      "Set all three, or none.",
    );
  } else {
    pass("Email", "Email transport is fully configured.");
  }

  const identity = ["NEWSLETTER_SENDER_NAME", "NEWSLETTER_SENDER_ADDRESS"].filter(
    (name) => (env[name] ?? "") === "",
  );
  if (configured.length === 3 && identity.length > 0) {
    block(
      "Email",
      `Sender identity is incomplete (${identity.join(", ")} missing). Marketing email must carry the sender's identity and a postal address by law.`,
      "Set both before any issue is sent.",
    );
  }
}

/* ------------------------------------------------------------- regulatory */

/**
 * Who this company is.
 *
 * Placed with the blocking checks rather than the advisory ones, because a
 * website that does not identify its operator fails a statutory disclosure
 * requirement, and because it is the first thing a stranger looks for before
 * deciding whether to tell you about a bereavement or lend against a deal. The
 * values are never defaulted: an invented company number would satisfy this
 * check and be a false statement of identity.
 */
function checkIdentity(): void {
  const identity = companyIdentity(process.env);
  const gaps = identityGaps(identity);
  const blocking = gaps.filter((g) => g.blocking);
  const advisory = gaps.filter((g) => !g.blocking);

  for (const gap of blocking) {
    block("Company identity", `${gap.label} is not recorded. ${gap.consequence}`, `Set it in the environment. Nothing may be guessed here — a placeholder is a false statement of identity, not a missing one.`);
  }

  for (const gap of advisory) {
    warn("Company identity", `${gap.label} is not recorded. ${gap.consequence}`, "Record it once it is granted.");
  }

  if (gaps.length === 0) {
    pass("Company identity", "Every statutory disclosure and supervision is recorded and rendered in the footer.");
  }
}

function checkRegulatory(): void {
  const permissions = readPermissions(env.HELD_PERMISSIONS);
  const held = heldKeys(permissions);

  for (const key of permissions.unevidenced) {
    const definition = permissionDefinition(key);
    block(
      "Regulatory",
      `${definition.label} is named in HELD_PERMISSIONS with no evidence behind it.`,
      `Record it as "${key}:<${definition.evidenceLabel}>". A permission that gates chargeable income is a claim somebody must be able to check${definition.criminal ? ", and carrying on this activity without it is an offence" : ""}.`,
    );
  }
  for (const entry of permissions.unrecognised) {
    block(
      "Regulatory",
      `HELD_PERMISSIONS contains "${entry}", which is not a permission this platform knows about.`,
      "Fix the spelling or remove it. A typo here reads as a permission not held, which silently switches off income.",
    );
  }

  const gated = STREAMS.filter((s) => (s.requiresPermissions ?? []).length > 0);
  const missing = gated.filter((s) =>
    (s.requiresPermissions ?? []).some((key) => !held.includes(key)),
  );

  if (missing.length === gated.length) {
    warn(
      "Regulatory",
      `All ${gated.length} permission-gated revenue streams are excluded, because no permissions are recorded as held. Subscriptions and AI credits are unaffected.`,
      "This is the correct state before HMRC AML registration and redress scheme membership are granted. dealRevenue() already excludes them; do not charge them.",
    );
  } else if (missing.length > 0) {
    warn(
      "Regulatory",
      `${missing.length} revenue stream(s) remain gated: ${missing.map((s) => s.label).join(", ")}.`,
      "Obtain the recorded permission before charging them.",
    );
  } else {
    pass("Regulatory", "Every gated revenue stream has its permission recorded.");
  }

  if (UK_INVESTOR_CATEGORISATION.requiresVerification) {
    warn(
      "Regulatory",
      `Investor categorisation thresholds are recorded as at ${UK_INVESTOR_CATEGORISATION.asOf} and marked as needing verification. Deal material is gated on these.`,
      "Confirm them against the current Financial Promotion Order and clear requiresVerification, or accept that the gate may be using superseded figures.",
    );
  }

  const unlicensed = DATA_SOURCES.filter((s) => s.licence === undefined);
  pass(
    "Data sources",
    `${DATA_SOURCES.length - unlicensed.length} licensed source(s) usable; ${unlicensed.length} refused for want of a licence.`,
  );

  for (const code of ["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR"] as const) {
    if (!isDealReady(code)) {
      warn(
        "Jurisdictions",
        `${code} is not deal-ready, so deals there will be capped rather than transacted.`,
        "Implement and date its tax tables before operating there.",
      );
    }
  }
}

/* ---------------------------------------------------------------- assets */

function checkAssets(): void {
  const publicDir = path.join(process.cwd(), "public");
  const missing: string[] = [];

  for (const icon of PWA_ICONS) {
    if (!existsSync(path.join(publicDir, icon.file))) missing.push(icon.file);
  }
  for (const device of IOS_DEVICES) {
    for (const orientation of ["portrait", "landscape"] as const) {
      const file = splashPath(device, orientation);
      if (!existsSync(path.join(publicDir, file.replace(/^\//, "")))) missing.push(file);
    }
  }

  if (missing.length > 0) {
    warn(
      "PWA assets",
      `${missing.length} icon or splash file(s) missing. iOS shows a blank white screen on launch where a splash is absent, which users read as a crash.`,
      "Run `npm run pwa:assets`.",
    );
  } else {
    pass("PWA assets", "Every declared icon and splash image is present.");
  }

  if (!existsSync(path.join(publicDir, "sw.js"))) {
    warn("PWA assets", "No service worker at the root scope; the app will not be installable.", "Check public/sw.js.");
  }
}

/* ------------------------------------------------------------- analytics */

function checkAnalytics(): void {
  const meta = (env.NEXT_PUBLIC_META_PIXEL_ID ?? "").trim();
  const ga = (env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "").trim();

  if (meta === "" && ga === "") {
    warn(
      "Analytics",
      "Neither NEXT_PUBLIC_META_PIXEL_ID nor NEXT_PUBLIC_GA_MEASUREMENT_ID is set, so no pixel loads and the seller funnel is unmeasured.",
      "Set one or both, or accept launching without conversion data. Both are NEXT_PUBLIC_ and therefore public by design — they are identifiers, not secrets.",
    );
    return;
  }

  if (ga !== "") {
    if (ga.startsWith("GTM-")) {
      // A container, not a measurement ID. Tag Manager lets a tag be added from
      // its own console at any time, which would put a third-party script on
      // pages this platform's route allowlist deliberately excludes — the Deal
      // Room, the memorandum, a seller's own result page. The allowlist can only
      // govern tags the code loads.
      block(
        "Analytics",
        `NEXT_PUBLIC_GA_MEASUREMENT_ID is ${ga}, which is a Tag Manager container, not a GA4 measurement ID. A container can load tags added later from its console, on any page, outside the route allowlist that keeps pixels off pages carrying sellers' reported health and financial distress.`,
        "Use the GA4 measurement ID (G-…). Do not route this platform through Tag Manager.",
      );
    } else if (!/^G-[A-Z0-9]{6,}$/i.test(ga)) {
      warn(
        "Analytics",
        `NEXT_PUBLIC_GA_MEASUREMENT_ID is ${ga}, which is not the shape of a GA4 measurement ID (G-…). Google accepts it silently and reports nothing.`,
        "Copy the measurement ID from the GA4 data stream.",
      );
    } else {
      pass("Analytics", "Google Tag configured with a GA4 measurement ID.");
    }
  }

  if (meta !== "") {
    if (!/^\d{12,20}$/.test(meta)) {
      warn(
        "Analytics",
        `NEXT_PUBLIC_META_PIXEL_ID is ${meta}, which is not the shape of a pixel ID (a long run of digits). fbevents.js accepts it and drops every event.`,
        "Copy the pixel ID from Meta Events Manager.",
      );
    } else {
      pass("Analytics", "Meta Pixel configured.");
    }
  }

  // Both vendors set non-essential cookies, so PECR reg. 6 requires consent
  // before they load. The banner is compiled in and the loader refuses without
  // a granted cookie, so nothing here can be misconfigured at deploy time —
  // this is the reminder that the requirement exists and that the excluded
  // routes are load-bearing, not a preference.
  warn(
    "Analytics",
    "A pixel is configured. Nothing loads before the visitor accepts, and the pipeline, Deal Room, memorandum and seller result pages are excluded in code.",
    "Confirm the privacy notice names both vendors, and never add a tag outside src/app/components/Analytics.tsx — the route allowlist cannot govern a script it did not load.",
  );
}

/* --------------------------------------------------------------- billing */

function checkBilling(): void {
  const secret = env.BILLING_WEBHOOK_SECRET;
  if (secret === undefined || secret === "") {
    warn(
      "Billing",
      "BILLING_WEBHOOK_SECRET is not set, so every payment confirmation is refused. Nothing can be sold and no top-up can be applied.",
      "Set it to the signing secret from the payment provider. Until then the endpoint fails closed, which is the safe state but not a working one.",
    );
  } else {
    const weak = secretIsWeak(secret);
    if (weak !== undefined) {
      // This secret is the only thing standing between the internet and an
      // endpoint that grants subscriptions and prepaid balance.
      block(
        "Billing",
        `BILLING_WEBHOOK_SECRET is weak: ${weak}. Anyone who guesses it can award themselves a subscription and any amount of prepaid balance, repeatedly.`,
        "Use the value the provider generated, unmodified.",
      );
    } else {
      pass("Billing", "Webhook signing secret configured.");
    }
  }

  if (secret !== undefined && secret === env.OPERATOR_SECRET) {
    block(
      "Billing",
      "BILLING_WEBHOOK_SECRET and OPERATOR_SECRET are the same value. Compromising either compromises both, and rotating one silently breaks the other.",
      "Generate them separately.",
    );
  }

  // A catalogue error is charged to every customer until somebody notices.
  const free = plan(FREE_PLAN_ID);
  if (free === undefined) {
    block("Billing", `The free plan ${FREE_PLAN_ID} is missing from the catalogue.`, "Restore it: every entitlement decision falls back to it.");
  } else if (free.price !== 0) {
    block("Billing", "The plan used as the free fallback has a price.", "Every unpaid account would be treated as owing this.");
  } else if (free.limits.memorandaPerPeriod > 0 || free.limits.periodCredits > 0) {
    block(
      "Billing",
      "The free plan grants memoranda or credits, so an account that has never paid can take value out.",
      "Set both to zero on the free plan.",
    );
  }

  for (const p of PLANS) {
    if (!Number.isSafeInteger(p.price) || p.price < 0) {
      block("Billing", `Plan ${p.id} has an invalid price.`, "Prices are a whole number of pence.");
    }
  }
  for (const pack of CREDIT_PACKS) {
    if (pack.bonus > pack.price) {
      block(
        "Billing",
        `Credit pack ${pack.id} gives away more than it charges.`,
        "A bonus larger than the price is a loss on every sale.",
      );
    }
  }

  const checkoutUrl = env.BILLING_CHECKOUT_URL ?? "";
  const checkoutKey = env.BILLING_API_KEY ?? "";
  if (checkoutUrl === "" && checkoutKey === "") {
    warn(
      "Billing",
      "No payment provider is connected, so /api/billing/checkout authorises and then returns 503. Nothing can be sold.",
      "Set BILLING_CHECKOUT_URL and BILLING_API_KEY. Until then the authorisation is real and the charge is not.",
    );
  } else if (checkoutUrl === "" || checkoutKey === "") {
    block(
      "Billing",
      "The payment provider is half configured. One of BILLING_CHECKOUT_URL and BILLING_API_KEY is missing, so every checkout will fail after the customer has decided to buy.",
      "Set both, or neither.",
    );
  } else if (!checkoutUrl.startsWith("https://")) {
    block(
      "Billing",
      "BILLING_CHECKOUT_URL is not HTTPS. The API key travels on that request.",
      "Use the provider's HTTPS endpoint.",
    );
  } else if (secret === undefined || secret === "") {
    block(
      "Billing",
      "A payment provider is connected but BILLING_WEBHOOK_SECRET is not set, so a customer could be charged and the confirmation refused. They would pay and receive nothing.",
      "Set the webhook secret before taking a single payment.",
    );
  } else {
    pass("Billing", "Payment provider connected and confirmations can be verified.");
  }

  warn(
    "Billing",
    "Sales to consumers outside the UK are refused, because charging them correctly needs a One Stop Shop or local registration that does not exist yet.",
    "Either register, or accept that the addressable market is UK consumers and overseas businesses. Do not remove the refusal — charging the wrong rate means remitting to the wrong state and still owing the right one.",
  );
}

/* ------------------------------------------------------------- discovery */

function checkOutreach(): void {
  const email = [env.EMAIL_API_URL, env.EMAIL_API_KEY, env.EMAIL_FROM].filter(
    (v) => v !== undefined && v !== "",
  ).length;

  if (email === 0) {
    warn(
      "Outreach",
      "No email transport is configured, so approved outreach writes to the server log instead of being delivered. The same is true of the newsletter.",
      "Set EMAIL_API_URL, EMAIL_API_KEY and EMAIL_FROM.",
    );
  }

  if (env.CRON_SECRET === undefined || env.CRON_SECRET === "") {
    warn(
      "Outreach",
      "CRON_SECRET is not set, so inbound replies and delivery events are refused. A recipient replying \"remove me\" would not be actioned until somebody read the inbox.",
      "Set it, and point the mail provider's inbound and event webhooks at /api/outreach/reply and /api/outreach/events.",
    );
  } else {
    pass("Outreach", "Reply and delivery-event endpoints are authenticated.");
  }
}

function checkDiscovery(): void {
  const ch = env.COMPANIES_HOUSE_API_KEY;
  const fcaEmail = env.FCA_REGISTER_EMAIL;
  const fcaKey = env.FCA_REGISTER_KEY;

  const configured = [ch, fcaEmail, fcaKey].filter((v) => v !== undefined && v !== "").length;

  if (configured === 0) {
    warn(
      "Discovery",
      "No discovery credentials are set, so no funder can be verified against Companies House or the FCA Register. Candidates will stay PARTIALLY_VERIFIED and none may be approved for outreach.",
      "Set COMPANIES_HOUSE_API_KEY, and FCA_REGISTER_EMAIL with FCA_REGISTER_KEY. Both keys are issued against accepted terms, and that acceptance is the licence.",
    );
    return;
  }

  if ((fcaEmail === undefined || fcaEmail === "") !== (fcaKey === undefined || fcaKey === "")) {
    block(
      "Discovery",
      "FCA Register access is half configured. One of FCA_REGISTER_EMAIL and FCA_REGISTER_KEY is missing, so every regulatory check will fail silently and firms will pass verification unchecked.",
      "Set both, or neither.",
    );
  }

  if (env.NEXT_PUBLIC_SITE_URL === undefined || env.NEXT_PUBLIC_SITE_URL === "") {
    warn(
      "Discovery",
      "NEXT_PUBLIC_SITE_URL is not set, so the discovery agent identifies itself to publishers with a placeholder URL.",
      "Set it. A publisher cannot exercise a preference against a client that will not say who it is or where to read about it.",
    );
  } else {
    pass("Discovery", "Credentials configured and the agent identifies itself with a real URL.");
  }
}

/* ------------------------------------------------------------------- run */

async function main(): Promise<void> {
  checkOperatorSecret();
  checkCronSecret();
  checkSiteUrl();
  await checkDatabase();
  checkEmail();
  checkIdentity();
  checkRegulatory();
  checkAssets();
  checkAnalytics();
  checkBilling();
  checkDiscovery();
  checkOutreach();

  const blockers = checks.filter((c) => c.level === "block");
  const warnings = checks.filter((c) => c.level === "warn");
  const passes = checks.filter((c) => c.level === "pass");

  const icon: Record<Level, string> = { block: "BLOCK", warn: " WARN", pass: " PASS" };

  process.stdout.write("\nGo-live preflight\n=================\n\n");
  for (const check of [...blockers, ...warnings, ...passes]) {
    process.stdout.write(`[${icon[check.level]}] ${check.area}: ${check.message}\n`);
    if (check.remedy !== undefined) {
      process.stdout.write(`         → ${check.remedy}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(
    `${blockers.length} blocking, ${warnings.length} to review, ${passes.length} passing.\n`,
  );

  if (blockers.length > 0) {
    process.stdout.write("\nNOT READY. Fix the blocking items above.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    "\nNo blockers. Read the warnings before going live — several of them are things that are lawful to leave undone and dangerous to forget.\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`preflight failed to run: ${String(error)}\n`);
  process.exitCode = 1;
});
