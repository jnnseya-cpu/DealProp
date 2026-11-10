/**
 * Trend Intelligence — the Growth Brief contract (spec §6, §16, Appendix A).
 *
 * The Growth Brief is the one object that connects the trend reader to the
 * SEO and marketing agents. It is a *closed* contract: a versioned, time-boxed
 * instruction that changes an agent's priorities, audience, approved claims and
 * allowed channels at run time, and nothing more. An agent resolves the
 * effective brief, adapts its work to it, and cannot use it to grant itself a
 * privilege it did not already have (spec §1, §4).
 *
 * This module is the contract and its gatekeeper. It validates a brief against
 * the Appendix-A schema AND the runtime rules the schema cannot express, and it
 * resolves the *effective* brief for a lookup — returning the baseline when the
 * brief has expired or none applies. That last rule is the whole safety story
 * of the SDK: a stale or revoked brief must never be the authority for a write
 * (spec §4, §14, TI-05). The cache is a convenience; expiry is absolute.
 *
 * Hand-rolled validation, deliberately: the codebase carries no schema library
 * and adds none for this (a validated field is only as good as the validator,
 * and one dependency-free closed check is easier to audit than a config).
 * Validation is strict in both directions — a missing required field fails, and
 * so does an unexpected extra one, because an agent treats this as a closed
 * object and an unknown field is either an attack or a version skew.
 */

export const GROWTH_BRIEF_SCHEMA_VERSION = 1;

/**
 * Every routing value the contract reserves (Appendix A). The enum is wider
 * than what v1 can act on: it fixes stable values so a future adapter slots in
 * without a contract change. Reserving a value makes no feature available.
 */
export const BRIEF_CHANNELS = [
  "seo",
  "organic_social",
  "sales_enablement",
  "owned_placement",
  "lifecycle",
  "paid",
] as const;

export type BriefChannel = (typeof BRIEF_CHANNELS)[number];

/** The only channels with a live draft route in v1 (spec Appendix A). */
export const ACTIVE_CHANNELS_V1: readonly BriefChannel[] = ["seo", "organic_social"];

export interface GrowthBrief {
  readonly schema_version: 1;
  readonly brief_id: string;
  readonly brief_version: number;
  readonly tenant_id: string;
  readonly platform_id: string;
  readonly market: string;
  readonly locale: string;
  readonly topic_id: string;
  readonly opportunity_score: number;
  readonly confidence: number;
  readonly valid_from: string;
  readonly expires_at: string;
  readonly evidence_ids: readonly string[];
  readonly audience: string;
  readonly intent: string;
  readonly approved_claim_ids: readonly string[];
  readonly cta_id: string;
  readonly allowed_channels: readonly BriefChannel[];
  readonly prohibited_claims: readonly string[];
  readonly objective: string;
  readonly experiment_id: string;
  readonly policy_version: number;
}

export interface BriefValidationError {
  readonly field: string;
  readonly message: string;
}

export type BriefValidation =
  | { readonly ok: true; readonly brief: GrowthBrief }
  | { readonly ok: false; readonly errors: readonly BriefValidationError[] };

// --- field primitives (Appendix A $defs) --------------------------------------

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MARKET_PATTERN = /^[A-Z]{2}$/;
const UTC_PATTERN = /Z$/;

const REQUIRED_FIELDS: readonly (keyof GrowthBrief)[] = [
  "schema_version",
  "brief_id",
  "brief_version",
  "tenant_id",
  "platform_id",
  "market",
  "locale",
  "topic_id",
  "opportunity_score",
  "confidence",
  "valid_from",
  "expires_at",
  "evidence_ids",
  "audience",
  "intent",
  "approved_claim_ids",
  "cta_id",
  "allowed_channels",
  "prohibited_claims",
  "objective",
  "experiment_id",
  "policy_version",
];

const ALLOWED_FIELDS = new Set<string>(REQUIRED_FIELDS as readonly string[]);

function isId(v: unknown): v is string {
  return typeof v === "string" && ID_PATTERN.test(v);
}

function isScore(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

function isShortText(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 500;
}

function isUtc(v: unknown): v is string {
  if (typeof v !== "string" || !UTC_PATTERN.test(v)) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

function idList(
  v: unknown,
  field: string,
  errors: BriefValidationError[],
  { minItems = 0 }: { minItems?: number } = {},
): void {
  if (!Array.isArray(v)) {
    errors.push({ field, message: "must be an array of ids" });
    return;
  }
  if (v.length > 64) errors.push({ field, message: "at most 64 items" });
  if (v.length < minItems) errors.push({ field, message: `at least ${minItems} item(s)` });
  if (new Set(v).size !== v.length) errors.push({ field, message: "must be unique" });
  v.forEach((item, i) => {
    if (!isId(item)) errors.push({ field: `${field}[${i}]`, message: "invalid id" });
  });
}

/**
 * Validate a candidate Growth Brief against the Appendix-A schema and the
 * runtime rules beyond JSON Schema (valid_from < expires_at; channel enum;
 * no extra fields). Does NOT check now within the window — that is time- and
 * scope-dependent and belongs in {@link resolveEffectiveBrief}.
 */
export function validateGrowthBrief(input: unknown): BriefValidation {
  const errors: BriefValidationError[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ field: "", message: "brief must be an object" }] };
  }
  const o = input as Record<string, unknown>;

  // Closed object: reject any field the contract does not define.
  for (const key of Object.keys(o)) {
    if (!ALLOWED_FIELDS.has(key)) {
      errors.push({ field: key, message: "unexpected field (closed object)" });
    }
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in o)) errors.push({ field: field as string, message: "required" });
  }

  if (o.schema_version !== GROWTH_BRIEF_SCHEMA_VERSION) {
    errors.push({ field: "schema_version", message: "must be 1" });
  }
  if (!isId(o.brief_id)) errors.push({ field: "brief_id", message: "invalid id" });
  if (!isPositiveInt(o.brief_version)) errors.push({ field: "brief_version", message: "integer ≥ 1" });
  if (!isId(o.tenant_id)) errors.push({ field: "tenant_id", message: "invalid id" });
  if (!isId(o.platform_id)) errors.push({ field: "platform_id", message: "invalid id" });
  if (typeof o.market !== "string" || !MARKET_PATTERN.test(o.market)) {
    errors.push({ field: "market", message: "two uppercase letters (ISO alpha-2) or ZZ" });
  }
  if (typeof o.locale !== "string" || o.locale.length < 2 || o.locale.length > 35) {
    errors.push({ field: "locale", message: "2–35 characters" });
  }
  if (!isId(o.topic_id)) errors.push({ field: "topic_id", message: "invalid id" });
  if (!isScore(o.opportunity_score)) errors.push({ field: "opportunity_score", message: "0–100" });
  if (!isScore(o.confidence)) errors.push({ field: "confidence", message: "0–100" });
  if (!isUtc(o.valid_from)) errors.push({ field: "valid_from", message: "RFC3339 UTC ending Z" });
  if (!isUtc(o.expires_at)) errors.push({ field: "expires_at", message: "RFC3339 UTC ending Z" });
  idList(o.evidence_ids, "evidence_ids", errors, { minItems: 1 });
  if (!isShortText(o.audience)) errors.push({ field: "audience", message: "1–500 characters" });
  if (!isShortText(o.intent)) errors.push({ field: "intent", message: "1–500 characters" });
  idList(o.approved_claim_ids, "approved_claim_ids", errors);
  if (!isId(o.cta_id)) errors.push({ field: "cta_id", message: "invalid id" });

  if (!Array.isArray(o.allowed_channels)) {
    errors.push({ field: "allowed_channels", message: "array of channels" });
  } else {
    const ch = o.allowed_channels;
    if (ch.length < 1 || ch.length > 6) errors.push({ field: "allowed_channels", message: "1–6 channels" });
    if (new Set(ch).size !== ch.length) errors.push({ field: "allowed_channels", message: "must be unique" });
    ch.forEach((c, i) => {
      if (!BRIEF_CHANNELS.includes(c as BriefChannel)) {
        errors.push({ field: `allowed_channels[${i}]`, message: "unknown channel" });
      }
    });
  }

  if (!Array.isArray(o.prohibited_claims)) {
    errors.push({ field: "prohibited_claims", message: "array of short text" });
  } else {
    if (o.prohibited_claims.length > 32) errors.push({ field: "prohibited_claims", message: "at most 32" });
    if (new Set(o.prohibited_claims).size !== o.prohibited_claims.length) {
      errors.push({ field: "prohibited_claims", message: "must be unique" });
    }
    o.prohibited_claims.forEach((c, i) => {
      if (!isShortText(c)) errors.push({ field: `prohibited_claims[${i}]`, message: "1–500 characters" });
    });
  }

  if (!isShortText(o.objective)) errors.push({ field: "objective", message: "1–500 characters" });
  if (!isId(o.experiment_id)) errors.push({ field: "experiment_id", message: "invalid id" });
  if (!isPositiveInt(o.policy_version)) errors.push({ field: "policy_version", message: "integer ≥ 1" });

  // Runtime rule beyond JSON Schema: valid_from < expires_at.
  if (isUtc(o.valid_from) && isUtc(o.expires_at) && Date.parse(o.valid_from as string) >= Date.parse(o.expires_at as string)) {
    errors.push({ field: "expires_at", message: "must be after valid_from" });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, brief: o as unknown as GrowthBrief };
}

// --- effective-brief resolution (§14, TI-05) ----------------------------------

export type EffectiveBriefStatus = "active" | "baseline";

export interface EffectiveBrief {
  readonly status: EffectiveBriefStatus;
  readonly brief?: GrowthBrief;
  readonly reason: string;
}

export interface EffectiveQuery {
  readonly market: string;
  readonly locale: string;
  readonly topic_id: string;
  readonly channel: BriefChannel;
}

/** Is `now` within [valid_from, expires_at)? (spec Appendix A runtime rules) */
export function briefIsLive(brief: GrowthBrief, now: Date): boolean {
  const t = now.getTime();
  return Date.parse(brief.valid_from) <= t && t < Date.parse(brief.expires_at);
}

/**
 * Resolve the effective brief for a lookup. Returns the active brief only when
 * it is live AND it matches the requested scope and channel; otherwise the
 * caller must fall back to baseline instructions (the §16 204 case / the SDK
 * fallback in §14). ZZ (global) never matches a country-targeted lookup by
 * default (spec §16).
 *
 * This is the rule that makes a cached-but-expired brief safe: even if an agent
 * holds a brief, resolving it past its expiry returns baseline, so the brief can
 * never be the authority for a stale write (TI-05).
 */
export function resolveEffectiveBrief(
  brief: GrowthBrief | undefined,
  query: EffectiveQuery,
  now: Date,
): EffectiveBrief {
  if (!brief) return { status: "baseline", reason: "no approved brief for this scope" };
  if (!briefIsLive(brief, now)) return { status: "baseline", reason: "brief expired or not yet valid" };

  const scopeMatches =
    brief.market === query.market &&
    brief.locale === query.locale &&
    brief.topic_id === query.topic_id;
  if (!scopeMatches) return { status: "baseline", reason: "brief scope does not match the lookup" };

  if (!brief.allowed_channels.includes(query.channel)) {
    return { status: "baseline", reason: `channel ${query.channel} not allowed by the brief` };
  }

  return { status: "active", brief, reason: "approved brief resolved for scope and channel" };
}
