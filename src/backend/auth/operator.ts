/**
 * Operator access control.
 *
 * The pipeline and Deal Room carry seller screening answers — reported
 * financial distress, third-party pressure, health and capacity concerns, age
 * band. Health and capacity data is special-category personal data under UK
 * GDPR Article 9, and it was reachable by anyone who knew or guessed a URL.
 * These are operator surfaces and they are now gated.
 *
 * This is a shared operator secret, not a user account system. That is the
 * honest description and it is deliberately proportionate: the platform has no
 * users, no roles and no investor categorisation yet, and inventing all three
 * to close a data-exposure hole would have delayed the fix behind a much larger
 * build. When accounts arrive this module is what they replace.
 *
 * Three properties matter:
 *
 *  1. FAILS CLOSED. No `OPERATOR_SECRET` means the surfaces refuse to render at
 *     all, exactly as the cron endpoint refuses to run. An unconfigured
 *     deployment must not default to open.
 *  2. THE SECRET IS NEVER IN THE COOKIE. The cookie carries an HMAC of a fixed
 *     message under the secret, so a stolen cookie cannot be replayed as the
 *     password anywhere else, and rotating the secret invalidates every
 *     existing session with no stored state.
 *  3. WEB CRYPTO, NOT node:crypto. This runs in middleware, which Next executes
 *     in the edge runtime where `node:crypto` is unavailable. `lib/tokens.ts`
 *     stays as it is because it only ever runs on the server.
 */

/** Cookie name. Prefixed so it cannot collide with anything else on the host. */
export const OPERATOR_COOKIE = "lode_operator";

/**
 * Bound into the signature so the cookie value is specific to this purpose.
 * Bump the suffix to invalidate every session without rotating the secret.
 */
const COOKIE_MESSAGE = "lode-operator-session-v1";

/** Eight hours. Long enough for a working day, short enough to expire. */
export const OPERATOR_SESSION_SECONDS = 8 * 60 * 60;

function base64url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/**
 * Constant-time comparison.
 *
 * `node:crypto`'s timingSafeEqual is unavailable in the edge runtime, so this
 * accumulates the difference across every byte rather than returning early.
 * Length is compared first; the length of an HMAC digest is fixed and public.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** The value to store in the operator cookie for this secret. */
export function operatorCookieValue(secret: string): Promise<string> {
  return sign(secret, COOKIE_MESSAGE);
}

/** True where the cookie was issued by this secret. */
export async function verifyOperatorCookie(
  cookie: string | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (cookie === undefined || cookie === "") return false;
  if (secret === undefined || secret === "") return false;
  return constantTimeEqual(cookie, await operatorCookieValue(secret));
}

/**
 * Assert an operator session from inside a page or route handler.
 *
 * Middleware is the gate; this is the second lock behind it. Next.js has
 * shipped more than one middleware-bypass advisory — CVE-2025-29927 let a
 * crafted `x-middleware-subrequest` header skip middleware entirely — and the
 * pages behind this gate carry special-category personal data. A single point
 * of failure in somebody else's framework is not an acceptable place to put
 * that, so the surfaces check for themselves as well.
 *
 * Throws rather than returning a boolean: a guard whose result can be ignored
 * is one that will eventually be ignored.
 */
export async function assertOperator(cookie: string | undefined): Promise<void> {
  if (!(await verifyOperatorCookie(cookie, process.env.OPERATOR_SECRET))) {
    throw new OperatorAccessDenied();
  }
}

/** Thrown when an operator surface is reached without a valid session. */
export class OperatorAccessDenied extends Error {
  constructor() {
    super("Operator access denied");
    this.name = "OperatorAccessDenied";
  }
}

/** True where the submitted password is the operator secret. */
export async function operatorPasswordMatches(
  submitted: string,
  secret: string | undefined,
): Promise<boolean> {
  if (secret === undefined || secret === "") return false;
  // Both sides are hashed before comparison so the comparison runs over
  // fixed-length digests regardless of what was submitted, and a wrong-length
  // guess cannot be distinguished from a wrong-value one.
  return constantTimeEqual(await sign(secret, submitted), await sign(secret, secret));
}
