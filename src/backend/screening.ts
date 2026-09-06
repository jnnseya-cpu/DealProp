import {
  requestProblem,
  type CheckResult,
  type ScreeningProvider,
  type ScreeningRequest,
} from "@shared/domain/screening";

/**
 * Running an identity or sanctions check.
 *
 * There is no provider configured and this file does not pretend otherwise.
 * With none, `runCheck()` returns `inconclusive` — never `clear` — because the
 * only thing worse than not screening somebody is a record saying they were
 * screened and found clean when nothing looked.
 *
 * That is the whole reason this exists before a provider does. The passport
 * and the seller's due diligence already read a screening date, and the
 * temptation when wiring a provider in later is to make the no-provider path
 * "pass through" so nothing breaks in development. This makes that impossible:
 * the closed path returns an outcome that clears no gate, so a deployment with
 * no provider fails visibly rather than silently approving everybody.
 *
 * Adding a provider is one adapter satisfying `ScreeningProvider` and one line
 * in `configuredProvider()`. Nothing that reads a check changes.
 */

export function configuredProvider(): ScreeningProvider | undefined {
  // No adapter is written. When one is, it belongs here and nowhere else:
  // a second place that decides which provider is in use is a second place
  // that can disagree about whether anybody was checked.
  return undefined;
}

export interface CheckOutcome {
  readonly result: CheckResult;
  /** True where a provider actually answered. */
  readonly automated: boolean;
  /** What to tell the operator, in a sentence they can act on. */
  readonly message: string;
}

export async function runCheck(request: ScreeningRequest): Promise<CheckOutcome> {
  const problem = requestProblem(request);
  const at = new Date().toISOString();

  if (problem !== undefined) {
    return {
      automated: false,
      result: {
        kind: request.kind,
        outcome: "inconclusive",
        method: "manual",
        at,
        reference: "not-attempted",
        recordedBy: request.requestedBy || "unknown",
        detail: problem,
      },
      message: problem,
    };
  }

  const provider = configuredProvider();
  if (provider === undefined) {
    return {
      automated: false,
      result: {
        kind: request.kind,
        outcome: "inconclusive",
        method: "manual",
        at,
        reference: "no-provider",
        recordedBy: request.requestedBy,
        detail: "No screening provider is configured, so nothing was checked.",
      },
      message:
        "No screening provider is connected, so nothing was checked. Run the check with whatever you use today and record its reference — an inconclusive result clears no gate, which is the correct state until a provider exists.",
    };
  }

  try {
    return {
      result: await provider.check(request),
      automated: true,
      message: `Checked by ${provider.name}.`,
    };
  } catch (error) {
    // A provider that is down must not become a pass. It becomes an
    // inconclusive result, which reads as "nobody knows" and clears nothing.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      automated: false,
      result: {
        kind: request.kind,
        outcome: "inconclusive",
        method: "manual",
        at,
        reference: "provider-unavailable",
        recordedBy: request.requestedBy,
        detail,
      },
      message: `${provider.name} could not be reached, so nothing was checked: ${detail}`,
    };
  }
}
