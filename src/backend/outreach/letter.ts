/**
 * Posting a letter.
 *
 * The lawful channel to a named individual, and therefore the only way this
 * platform can approach a homeowner who has not asked to be contacted. It
 * mirrors the email transport deliberately: two implementations behind one
 * interface, chosen from configuration, and the unconfigured one is honest
 * about being unconfigured rather than silently doing nothing.
 *
 *  - **A print-and-mail provider**, where one is configured. The letter is
 *    handed over as text and an address and the provider prints and posts it.
 *  - **The manual queue** otherwise. The letter is rendered and held for
 *    somebody to print and post, and marked posted when they have. That is not
 *    a placeholder — it is how most sourcing businesses actually send, and a
 *    letter nobody posted is visibly unposted rather than quietly assumed sent.
 */

export interface Letter {
  readonly to: string;
  /** The full address block, as it will be printed. */
  readonly address: string;
  readonly subject: string;
  readonly body: string;
}

export type PostOutcome =
  /** Handed to a provider that will print and post it. */
  | "dispatched"
  /** Rendered and waiting for somebody to print and post it. */
  | "queued-for-post"
  | "failed";

export interface PostResult {
  readonly outcome: PostOutcome;
  readonly reason: string;
  /** The provider's reference, where there is one. */
  readonly reference?: string;
}

export interface LetterTransport {
  readonly name: "provider" | "manual";
  post(letter: Letter): Promise<PostResult>;
}

/**
 * No provider configured: render and hold.
 *
 * Returns `queued-for-post` rather than `dispatched`, so the operator surface
 * can show what is waiting. Nothing pretends a letter is on its way when it is
 * sitting in a queue.
 */
export const manualTransport: LetterTransport = {
  name: "manual",
  async post(letter) {
    return {
      outcome: "queued-for-post",
      reason: `Rendered for ${letter.to}. Print it, post it, and mark it posted — nothing here has sent it.`,
    };
  },
};

/**
 * A print-and-mail provider that accepts a JSON payload.
 *
 * Configured entirely from the environment so no provider name, endpoint or
 * credential is in the repository. A provider expecting a different shape needs
 * its own adapter rather than this one bent to fit.
 */
export function providerTransport(config: {
  url: string;
  apiKey: string;
  sender: string;
  timeoutMs?: number;
  transport?: typeof fetch;
}): LetterTransport {
  return {
    name: "provider",
    async post(letter) {
      const send = config.transport ?? fetch;
      try {
        const response = await send(config.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            sender: config.sender,
            recipient: letter.to,
            address: letter.address,
            subject: letter.subject,
            body: letter.body,
          }),
          signal: AbortSignal.timeout(config.timeoutMs ?? 15_000),
        });

        if (!response.ok) {
          return { outcome: "failed", reason: `The provider answered ${response.status}.` };
        }

        const body = (await response.json().catch(() => ({}))) as { id?: unknown };
        return {
          outcome: "dispatched",
          reason: "Handed to the print provider.",
          ...(typeof body.id === "string" ? { reference: body.id } : {}),
        };
      } catch (error) {
        return {
          outcome: "failed",
          reason: error instanceof Error ? error.message : "The provider could not be reached.",
        };
      }
    },
  };
}

export function resolveLetterTransport(
  env: Record<string, string | undefined> = process.env,
): LetterTransport {
  const url = env.LETTER_API_URL ?? "";
  const apiKey = env.LETTER_API_KEY ?? "";
  const sender = env.LETTER_SENDER_ADDRESS ?? "";

  if (url === "" || apiKey === "" || sender === "") return manualTransport;
  return providerTransport({ url, apiKey, sender });
}

/**
 * A stable key for a postal address.
 *
 * Suppression has to work by address as well as by mailbox, because somebody
 * who asks not to be written to has asked once and should not have to ask again
 * for every property they own.
 *
 * Address matching is imperfect and this does not pretend otherwise: it
 * normalises case, punctuation and spacing and leans on the postcode, which is
 * the part people write consistently. That is why the letter also carries a
 * reference and a phone number — a person who cannot be matched by address can
 * still say who they are.
 */
export function postalKey(address: string): string {
  const normalised = address
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const postcode = /\b([a-z]{1,2}\d[a-z\d]?)\s*(\d[a-z]{2})\b/.exec(normalised);
  const houseNumber = /\b(\d+[a-z]?)\b/.exec(normalised);

  if (postcode !== null) {
    return `${houseNumber?.[1] ?? ""}|${postcode[1] ?? ""}${postcode[2] ?? ""}`;
  }
  // No postcode to lean on. Fall back to the whole normalised string, which is
  // strict — two spellings of the same address will not match, and that errs
  // towards writing again rather than towards suppressing the wrong person.
  return normalised;
}
