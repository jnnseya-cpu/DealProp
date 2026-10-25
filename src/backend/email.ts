import nodemailer from "nodemailer";

/**
 * Email transport.
 *
 * Provider-agnostic by design. No provider is configured in this repository
 * and no credentials exist in it — the transport is resolved from environment
 * variables at call time, and the default is a logging transport that does not
 * send anything.
 *
 * Three shapes are supported, tried in this order: a normal SMTP server
 * (SMTP_HOST/SMTP_USER/SMTP_PASSWORD — what most people already have), an HTTP
 * JSON provider (EMAIL_API_URL/EMAIL_API_KEY), and the console sandbox.
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
/**
 * SMTP transport — a normal mail server, the kind most people already have.
 *
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASSWORD
 *   SMTP_SECURE          "true" for implicit TLS on 465; otherwise STARTTLS
 *   EMAIL_FROM           "Name <address>"
 */
export function smtpTransport(config: {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  from: string;
}): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
  return {
    name: "smtp",
    async send(message) {
      try {
        const info = await transporter.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: {
            "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        return { ok: true, providerId: info.messageId };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        // SMTP failures (auth, connection, greylisting) are generally transient.
        return { ok: false, error: reason, retryable: true };
      }
    },
  };
}

export interface EmailEnv {
  readonly SMTP_HOST?: string | undefined;
  readonly SMTP_PORT?: string | undefined;
  readonly SMTP_USER?: string | undefined;
  readonly SMTP_PASSWORD?: string | undefined;
  readonly SMTP_SECURE?: string | undefined;
  readonly EMAIL_API_URL?: string | undefined;
  readonly EMAIL_API_KEY?: string | undefined;
  readonly EMAIL_FROM?: string | undefined;
  /** Present so `process.env` itself satisfies this type. */
  readonly [key: string]: string | undefined;
}

/** Resolve the transport from the environment. Never throws. */
export function resolveTransport(env: EmailEnv = process.env): EmailTransport {
  const from = env.EMAIL_FROM;
  const has = (v: string | undefined): v is string => v !== undefined && v !== "";

  // SMTP first — a normal mail server is what most deployments already have.
  if (has(env.SMTP_HOST) && has(env.SMTP_USER) && has(env.SMTP_PASSWORD) && has(from)) {
    const port = Number(env.SMTP_PORT) || 587;
    const secure = (env.SMTP_SECURE ?? "").toLowerCase() === "true" || port === 465;
    return smtpTransport({
      host: env.SMTP_HOST,
      port,
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
      secure,
      from,
    });
  }

  // Then an HTTP JSON provider.
  if (has(env.EMAIL_API_URL) && has(env.EMAIL_API_KEY) && has(from)) {
    return httpTransport({ url: env.EMAIL_API_URL, apiKey: env.EMAIL_API_KEY, from });
  }

  // Otherwise the sandbox, which logs and sends nothing.
  return consoleTransport;
}

/** Partially redact an address so logs are useful without being a data leak. */
export function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local === undefined || domain === undefined) return "invalid";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
