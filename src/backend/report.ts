/**
 * Reporting something that went wrong to somewhere a person will see it.
 *
 * Every failure on this platform was written to stderr and nowhere else. On a
 * managed host that is a log stream nobody is watching at three in the
 * morning, and the failures that matter here are the quiet ones: a payout that
 * did not send, a webhook claimed but not applied, a store that stopped
 * answering. Each of those is money or data, and each currently announces
 * itself by being noticed later.
 *
 * This is the seam, not the provider. It keeps writing to stderr — that is the
 * behaviour everything already depends on and it is what works in
 * development — and additionally posts to a webhook when one is configured.
 * Adding Sentry or anything else later is a change here and nowhere else.
 *
 * Three rules, all of which exist because a reporter that misbehaves is worse
 * than no reporter:
 *
 *  1. **It never throws.** A failure to report a failure must not become the
 *     failure. Everything is wrapped and swallowed.
 *  2. **It never blocks the caller.** The post is fire-and-forget. A slow
 *     reporting endpoint must not add its latency to a customer's request.
 *  3. **It never sends a secret.** The payload is a category, a message and a
 *     subject the caller chose. There is no "include the environment" option,
 *     because that option is how credentials reach a third party.
 */

export type Severity = "error" | "warning";

export interface Report {
  readonly severity: Severity;
  /** What area this came from — "billing", "store", "outreach". */
  readonly area: string;
  /** What happened, in a sentence somebody woken up could act on. */
  readonly message: string;
  /**
   * What it happened to — a deal id, an account id, a payment reference.
   *
   * Deliberately not "context: unknown". A free-form bag is how a stack trace
   * carrying a request body carrying a card number reaches a third party.
   */
  readonly subject?: string;
}

function endpoint(): string {
  return process.env.ERROR_REPORT_URL ?? "";
}

/**
 * Send it.
 *
 * Returns immediately. The caller is a request path and must not wait for a
 * reporting endpoint that may be slow or gone.
 */
export function report(entry: Report): void {
  const line = `${entry.severity.toUpperCase()} ${entry.area}: ${entry.message}${
    entry.subject !== undefined ? ` [${entry.subject}]` : ""
  }`;

  // Always. stderr is what works with no configuration at all, and it is what
  // a developer reads.
  try {
    process.stderr.write(`${line}\n`);
  } catch {
    // Even this can fail on a closed stream during shutdown. Nothing to do
    // about it and nothing worth crashing over.
  }

  const url = endpoint();
  if (url === "") return;

  try {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        severity: entry.severity,
        area: entry.area,
        message: entry.message,
        ...(entry.subject !== undefined ? { subject: entry.subject } : {}),
        at: new Date().toISOString(),
      }),
      // Bounded. An unbounded fetch from a fire-and-forget path is a socket
      // that stays open until the process ends.
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  } catch {
    // A malformed URL, a fetch that is unavailable. Reporting is best-effort
    // by definition and must never be the reason a request fails.
  }
}

/** The message from an unknown thrown value, without ever including a stack. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
