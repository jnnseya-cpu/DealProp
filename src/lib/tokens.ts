import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque tokens for email confirmation and unsubscribe links.
 *
 * These arrive from a URL that anyone can craft, and one of them disables a
 * legal obligation (unsubscribe), so they are generated from a CSPRNG and
 * compared in constant time. A predictable or timing-leaky token would let a
 * third party confirm someone else's address or unsubscribe them.
 */

/** 32 bytes of entropy, URL-safe. Long enough that guessing is not a threat. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time comparison.
 *
 * Length is compared first because timingSafeEqual throws on mismatched
 * lengths; that leak is acceptable since token length is fixed and public.
 */
export function tokenMatches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
