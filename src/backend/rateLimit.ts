/**
 * Refusing to do unbounded work for one caller.
 *
 * Nothing on this platform limited an inbound request. The only throttle in
 * the codebase was outbound politeness in the discovery fetcher, which limits
 * how fast we ask other people's servers for things and does nothing whatever
 * about how fast they ask us.
 *
 * The measurement that made this urgent: signing in runs scrypt, which costs
 * about 74ms of CPU, and Node runs JavaScript on one thread. Thirteen sign-in
 * attempts a second saturate a core. That is not an attack, it is a slow
 * afternoon — and it takes the whole platform down, because the same thread
 * serves every other request.
 *
 * Two properties matter more than the algorithm:
 *
 * **It fails open, deliberately.** A limiter that throws takes down the thing
 * it protects. Where this cannot decide — a missing clock, an unreadable key —
 * it allows, because the alternative is that a bug in the limiter is a total
 * outage rather than a lost defence.
 *
 * **It is per-process, and honest about it.** There is no shared store behind
 * it, so on four instances a caller gets four times the allowance. That is
 * still a bound and it is still worth having; what it is not is a
 * distributed-quota system, and calling it one would be the mistake. The
 * comment is here so nobody later assumes a guarantee that was never made.
 */

export interface Limit {
  /** How many requests are allowed in the window. */
  readonly requests: number;
  /** How long the window is, in milliseconds. */
  readonly windowMs: number;
}

/**
 * The limits, in one place.
 *
 * Each is set by what the endpoint costs us rather than by a round number.
 * Sign-in is the tightest because it is the only one that burns 74ms of CPU on
 * a request that has not proved anything yet.
 */
export const LIMITS = {
  /**
   * Sign-in. Five attempts a minute is generous for a person and useless for
   * anybody working through a password list — and, more to the point, it caps
   * the scrypt work one caller can make us do.
   */
  "sign-in": { requests: 5, windowMs: 60_000 },
  /**
   * The payment webhook. High, because a provider legitimately redelivers in
   * bursts and refusing one is money we then have to reconcile by hand. It is
   * a bound against a flood, not a shaping policy.
   */
  webhook: { requests: 120, windowMs: 60_000 },
  /** Public form posts. A person submits one; a script submits thousands. */
  intake: { requests: 10, windowMs: 60_000 },
  /** The blog view counter, which is unauthenticated and writes on every call. */
  "view-count": { requests: 60, windowMs: 60_000 },
  /** Anything else that asks. */
  default: { requests: 60, windowMs: 60_000 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

export interface Decision {
  readonly allowed: boolean;
  /** Requests left in this window. */
  readonly remaining: number;
  /** Seconds until the window resets. For the Retry-After header. */
  readonly retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * One map per process, swept lazily.
 *
 * A fixed window rather than a sliding log: a log holds one entry per request
 * and this is the thing standing in front of a flood, so it must not be the
 * thing that runs out of memory during one. The cost of a fixed window is that
 * a caller can send the whole allowance at the end of one window and again at
 * the start of the next; the cost of the alternative is unbounded retention.
 */
const windows = new Map<string, Window>();

/** Above this many tracked keys, the map is swept before anything else. */
const SWEEP_THRESHOLD = 10_000;

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * Count one request against a limit.
 *
 * `key` identifies the caller — an address, an account, an address and a form.
 * It is never logged by this module and never leaves it.
 */
export function consume(
  name: LimitName,
  key: string,
  now: number = Date.now(),
): Decision {
  const limit = LIMITS[name];

  // Fail open. A limiter that cannot decide must not be the reason a request
  // fails, because that turns a bug here into a total outage.
  if (!Number.isFinite(now) || key === "") {
    return { allowed: true, remaining: limit.requests, retryAfterSeconds: 0 };
  }

  if (windows.size > SWEEP_THRESHOLD) sweep(now);

  const id = `${name}:${key}`;
  const existing = windows.get(id);

  if (existing === undefined || existing.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + limit.windowMs });
    return { allowed: true, remaining: limit.requests - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit.requests - existing.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  return { allowed: existing.count <= limit.requests, remaining, retryAfterSeconds };
}

/**
 * Who is asking, from the headers a proxy sets.
 *
 * `x-forwarded-for` is a list and the **first** entry is the client; the rest
 * are proxies. Reading the last one limits the proxy instead of the caller,
 * which means one bad actor exhausts everybody's allowance. Where no address
 * can be read the caller is bucketed as "unknown" rather than allowed
 * unlimited: several unidentified callers sharing one bucket is a worse
 * experience for them and a better one than having no bound at all.
 */
export function callerFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim() !== "") {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  return headers.get("x-real-ip")?.trim() ?? "unknown";
}

/** Reset everything. Tests only — there is no call site in the app. */
export function resetLimits(): void {
  windows.clear();
}
