/**
 * Email transport.
 *
 * Provider-agnostic by design. No provider is configured in this repository
 * and no credentials exist in it — the transport is resolved from environment
 * variables at call time, and the default is a logging transport that does not
 * send anything.
 *
 * That default is deliberate, not a placeholder: an unconfigured deployment
 * must fail closed. Silently doing nothing is the wrong failure for a payment,
 * but it is the right one for marketing email, where the alternative is
 * mailing real people from a half-configured environment.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Surfaces the one-click unsubscribe to the mail client itself (RFC 8058). */
  readonly unsubscribeUrl: string;
}

export type SendOutcome =
  | { readonly ok: true; readonly providerId?: string }
  | { readonly ok: false; readonly error: string; readonly retryable: boolean };

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<SendOutcome>;
}

/**
 * Logs what would be sent and reports success without sending.
 *
 * Used in development and whenever no provider is configured. It logs the
 * recipient and subject but never the body, which can contain personal data.
 */
export const consoleTransport: EmailTransport = {
  name: "console",
  async send(message) {
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        transport: "console",
        event: "email.not_sent_no_provider",
        to: redactEmail(message.to),
        subject: message.subject,
      }),
    );
    return { ok: true, providerId: "console" };
  },
};

/**
 * Generic HTTP transport for a provider that accepts a JSON payload.
 *
 * Configured entirely from the environment so no provider name, endpoint or
 * credential is baked into the repository:
 *
 *   EMAIL_API_URL    endpoint to POST to
 *   EMAIL_API_KEY    bearer token
 *   EMAIL_FROM       "Name <address>"
 *
 * The payload shape below is the common one (to/from/subject/html/text). A
 * provider expecting something different needs its own adapter rather than
 * this one bent to fit.
 */
export function httpTransport(config: {
  url: string;
  apiKey: string;
  from: string;
  timeoutMs?: number;
}): EmailTransport {
  return {
    name: "http",
    async send(message) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
      try {
        const response = await fetch(config.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            from: config.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            headers: {
              // Lets the mail client offer unsubscribe natively, which reduces
              // spam complaints and is expected by the major inbox providers.
              "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }),
          signal: controller.signal,
        });

        if (response.ok) {
          return { ok: true };
        }
        // 4xx is our fault and will fail again identically; 5xx and 429 may not.
        const retryable = response.status >= 500 || response.status === 429;
        return {
          ok: false,
          error: `provider responded ${response.status}`,
          retryable,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        // Network failures and timeouts are transient by nature.
        return { ok: false, error: reason, retryable: true };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * The environment variables this module reads.
 *
 * Declared narrowly rather than as the whole `ProcessEnv` so callers and tests
 * can pass exactly what is relevant, and so the set of variables the transport
 * depends on is visible in one place.
 */
export interface EmailEnv {
  readonly EMAIL_API_URL?: string | undefined;
  readonly EMAIL_API_KEY?: string | undefined;
  readonly EMAIL_FROM?: string | undefined;
  /** Present so `process.env` itself satisfies this type. */
  readonly [key: string]: string | undefined;
}

/** Resolve the transport from the environment. Never throws. */
export function resolveTransport(env: EmailEnv = process.env): EmailTransport {
  const url = env.EMAIL_API_URL;
  const apiKey = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM;
  if (
    url !== undefined && url !== "" &&
    apiKey !== undefined && apiKey !== "" &&
    from !== undefined && from !== ""
  ) {
    return httpTransport({ url, apiKey, from });
  }
  return consoleTransport;
}

/** Partially redact an address so logs are useful without being a data leak. */
export function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local === undefined || domain === undefined) return "invalid";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
