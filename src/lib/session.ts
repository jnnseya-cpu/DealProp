import { constantTimeEqual } from "@/lib/operator";

/**
 * Per-account sessions.
 *
 * `lib/operator.ts` proves that *somebody* holds the shared password. This
 * proves *which person* is signed in, which is what an audit trail needs and
 * what the shared password could never give.
 *
 * The cookie carries the account id and the time it was issued, signed with
 * HMAC under `OPERATOR_SECRET`. Nothing else: no role, no permissions, no
 * certification. All of those are read from the account record on every
 * request, so disabling an account or letting a certification lapse takes
 * effect immediately rather than at the end of a session — which is the whole
 * point of having them.
 *
 * Web Crypto rather than node:crypto for the same reason as `lib/operator.ts`:
 * middleware runs in the edge runtime.
 */

export const SESSION_COOKIE = "lode_session";

/** Eight hours, matching the operator session. */
export const SESSION_SECONDS = 8 * 60 * 60;

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

export interface SessionClaims {
  readonly accountId: string;
  /** Unix seconds. */
  readonly issuedAt: number;
}

/**
 * Mint a session cookie value.
 *
 * Format is `accountId.issuedAt.signature`. The account id is visible to
 * whoever holds the cookie, which is fine — it is their own id — and it saves a
 * database lookup to discover whose session a malformed cookie claims to be.
 */
export async function createSession(accountId: string, secret: string, now = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = `${accountId}.${issuedAt}`;
  return `${payload}.${await sign(secret, payload)}`;
}

/**
 * Read a session cookie, or return undefined.
 *
 * Returns undefined for every failure — bad shape, bad signature, expired —
 * rather than distinguishing them. A caller that could tell a forged cookie
 * from an expired one would leak that distinction to whoever sent it.
 */
export async function readSession(
  cookie: string | undefined,
  secret: string | undefined,
  now = new Date(),
): Promise<SessionClaims | undefined> {
  if (cookie === undefined || cookie === "") return undefined;
  if (secret === undefined || secret === "") return undefined;

  const parts = cookie.split(".");
  if (parts.length !== 3) return undefined;
  const [accountId, issuedAtRaw, signature] = parts;
  if (accountId === undefined || issuedAtRaw === undefined || signature === undefined) {
    return undefined;
  }

  const expected = await sign(secret, `${accountId}.${issuedAtRaw}`);
  if (!constantTimeEqual(signature, expected)) return undefined;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return undefined;

  const age = Math.floor(now.getTime() / 1000) - issuedAt;
  // A negative age means the cookie claims to have been issued in the future,
  // which a genuine one never does.
  if (age < 0 || age > SESSION_SECONDS) return undefined;

  return { accountId, issuedAt };
}
