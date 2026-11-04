/**
 * How often, and when, outreach may go out.
 *
 * The eligibility engine decides whether a recipient may be written to at all.
 * This decides whether *now* is a reasonable moment and whether we have written
 * too much already — which is a different question, and the one that separates
 * a considered approach from a campaign somebody reports as spam.
 *
 * All pure. The caller supplies the clock and the history.
 */

export interface SendWindow {
  /** Inclusive, 24-hour, in the recipient's local time. */
  readonly startHour: number;
  /** Exclusive. */
  readonly endHour: number;
  /** 1 = Monday … 7 = Sunday, matching ISO. */
  readonly days: readonly number[];
}

/**
 * Business hours, and only business hours.
 *
 * A mandate enquiry that arrives at three on a Sunday morning is read as a bulk
 * send by a machine, because that is what it is. Nine to five, Monday to
 * Friday, is when a person writing to a business would write.
 */
export const BUSINESS_HOURS: SendWindow = {
  startHour: 9,
  endHour: 18,
  days: [1, 2, 3, 4, 5],
};

/** The business's timezone. Hours are judged here, not in UTC. */
const BUSINESS_TZ = "Europe/London";

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

/**
 * The hour (0–23) and ISO weekday (1 = Monday) of an instant, in London time.
 *
 * Computed through `Intl` so British Summer Time is handled correctly: a send
 * judged "business hours" in July must mean 09:00–18:00 as the recipient's
 * clock reads it, not 08:00–17:00 because the window was pinned to UTC. Still
 * pure — the instant in, the local parts out.
 */
function londonParts(date: Date): { readonly hour: number; readonly weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TZ,
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekday = WEEKDAY_INDEX[parts.find((p) => p.type === "weekday")?.value ?? "Mon"] ?? 1;
  return { hour, weekday };
}

export interface WindowDecision {
  readonly open: boolean;
  readonly reason: string;
  /** When the window next opens, where it is currently shut. */
  readonly nextOpenAt?: string;
}

/**
 * Whether the send window is open, judged in London time.
 *
 * The window is the recipient's business day as a London clock reads it, so it
 * holds at 09:00–18:00 local through both GMT and BST rather than drifting an
 * hour with the season. Per-recipient timezones would need a timezone discovery
 * does not collect; London is the business's own, and is the right default for
 * a UK-first platform.
 */
export function windowIsOpen(now: Date, window: SendWindow = BUSINESS_HOURS): WindowDecision {
  const { hour, weekday } = londonParts(now);

  if (window.days.includes(weekday) && hour >= window.startHour && hour < window.endHour) {
    return { open: true, reason: `Inside the ${window.startHour}:00–${window.endHour}:00 London window.` };
  }

  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  // Walk forward an hour at a time rather than doing calendar arithmetic: a
  // fortnight of hours is cheap and the edge cases are somebody else's. Each
  // candidate is judged in London time, so a DST change is handled for free.
  for (let i = 0; i < 24 * 14; i += 1) {
    next.setUTCHours(next.getUTCHours() + 1);
    const at = londonParts(next);
    if (window.days.includes(at.weekday) && at.hour >= window.startHour && at.hour < window.endHour) {
      return {
        open: false,
        reason: `Outside business hours — it is ${String(hour).padStart(2, "0")}:00 London on weekday ${weekday}. Queued rather than sent.`,
        nextOpenAt: next.toISOString(),
      };
    }
  }

  return { open: false, reason: "No window found in the next fortnight." };
}

/* ---------------------------------------------------------------- limits */

export interface FrequencyCaps {
  /** Messages to one address, ever, across all deals. */
  readonly perRecipientTotal: number;
  /** Messages to one email domain within the window. */
  readonly perDomainPerWindow: number;
  /** Days the domain window covers. */
  readonly domainWindowDays: number;
  /** Messages sent by the whole platform in one run. */
  readonly perRun: number;
}

/**
 * Caps chosen to be obviously modest.
 *
 * The point is not to find the maximum a provider tolerates. Three approaches
 * to one organisation is already generous, and a firm that has ignored three is
 * telling us something. Five to one domain in a fortnight stops a large group
 * being written to department by department, which reads as a campaign however
 * individually reasonable each message was.
 */
export const DEFAULT_CAPS: FrequencyCaps = {
  perRecipientTotal: 3,
  perDomainPerWindow: 5,
  domainWindowDays: 14,
  perRun: 20,
};

export interface SentRecord {
  readonly to: string;
  readonly sentAt: string;
}

export interface CapDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export function withinCaps(
  to: string,
  history: readonly SentRecord[],
  now: Date,
  caps: FrequencyCaps = DEFAULT_CAPS,
): CapDecision {
  const address = to.trim().toLowerCase();
  const domain = address.split("@")[1] ?? "";

  const toRecipient = history.filter((h) => h.to.trim().toLowerCase() === address).length;
  if (toRecipient >= caps.perRecipientTotal) {
    return {
      allowed: false,
      reason: `${toRecipient} messages have already gone to this address. A firm that has not replied to ${caps.perRecipientTotal} is telling us something.`,
    };
  }

  const since = now.getTime() - caps.domainWindowDays * 86_400_000;
  const toDomain = history.filter((h) => {
    if ((h.to.split("@")[1] ?? "").toLowerCase() !== domain) return false;
    const at = new Date(h.sentAt).getTime();
    return Number.isFinite(at) && at >= since;
  }).length;

  if (toDomain >= caps.perDomainPerWindow) {
    return {
      allowed: false,
      reason: `${toDomain} messages have gone to ${domain} in ${caps.domainWindowDays} days. Writing to one organisation department by department reads as a campaign however reasonable each message was.`,
    };
  }

  return {
    allowed: true,
    reason: `${toRecipient} of ${caps.perRecipientTotal} to this address, ${toDomain} of ${caps.perDomainPerWindow} to ${domain}.`,
  };
}

/* ------------------------------------------------------- delivery events */

export type DeliveryEvent = "delivered" | "bounced" | "complained" | "unsubscribed";

export interface DeliveryOutcome {
  /** True where this address must never be written to again. */
  readonly suppress: boolean;
  readonly reason: string;
}

/**
 * What a provider's delivery event means for the recipient.
 *
 * A complaint is the most serious signal there is: somebody pressed "this is
 * spam". It suppresses immediately and is never weighed against anything.
 * A hard bounce suppresses too — continuing to send to an address that does not
 * exist damages the sending domain's reputation for everybody else on it.
 */
export function outcomeOf(event: DeliveryEvent): DeliveryOutcome {
  switch (event) {
    case "complained":
      return {
        suppress: true,
        reason: "The recipient marked it as spam. That is the strongest signal there is and it is never weighed against anything.",
      };
    case "unsubscribed":
      return { suppress: true, reason: "The recipient unsubscribed." };
    case "bounced":
      return {
        suppress: true,
        reason: "The address does not accept mail. Continuing to send to it damages the sending domain for everybody on it.",
      };
    case "delivered":
      return { suppress: false, reason: "Delivered." };
  }
}
