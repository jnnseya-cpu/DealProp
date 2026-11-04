/**
 * The durable agent-run record (spec §20.5).
 *
 * Every time an agent executes — the live model-backed analysis runtime, the
 * intake qualification seam, or the deterministic observers — it produces a
 * record of *that it ran*: which agent, over which subject, from which input,
 * how it ended, and why. Today those three executions each return a different
 * in-memory shape (`runtime.ts`'s `AgentOutcome`, `intakeAssistant.ts`'s
 * `IntakeRun`, `agents.ts`'s `AgentRun`) and none is persisted. This is the one
 * shape they all map into and the one lifecycle they all obey, so there is a
 * single auditable ledger of agent activity rather than three ephemeral ones.
 *
 * This module is pure and framework-free. It defines the record, a lifecycle
 * state machine with guarded transitions, and mappers from each execution's own
 * result into a record. It does not persist anything and it computes no hash and
 * no id — the caller supplies those (a stable input hash and a run id), because
 * hashing and persistence are backend concerns and this layer runs in the
 * browser bundle too.
 *
 * Deliberately NOT modelled yet, because nothing produces them: a durable
 * work queue (so no `queued`/`retry_wait` states), per-run token/cost usage (the
 * live runtime returns none), tenant scope (the platform is single-tenant), and
 * a cross-agent orchestrator. The record carries what a real producer can fill
 * today; the spec's richer fields are added when a producer exists to populate
 * them, never as empty forward-compatibility.
 */

/** Which execution produced the run. */
export type AgentRunKind = "live-analysis" | "intake-qualification" | "deterministic";

/** What the run is about. Single-tenant, so there is no tenant dimension. */
export type AgentRunSubjectType = "deal" | "intake-conversation";

/**
 * Autonomy at which the run executed (spec §20.3): `shadow` (L0, internal
 * drafts, no external effect), `internal` (L1, persisted proposals/tasks),
 * `routine` (L2, a validated factual reply may be sent after a policy check),
 * and `deterministic` for the observers, which have no model and no autonomy of
 * their own.
 */
export type AgentAutonomy = "shadow" | "internal" | "routine" | "deterministic";

/**
 * The run lifecycle. A run begins `running`, optionally passes through
 * `validating` (output being gated), and ends in exactly one terminal state:
 *
 *  - `succeeded`       — produced a usable result.
 *  - `awaiting-human`  — stopped for a person: review required, or a budget
 *                        (e.g. the step limit) was hit before finishing.
 *  - `awaiting-data`   — stopped for missing input or an unavailable dependency.
 *  - `failed`          — an error the run could not recover from.
 *  - `cancelled`       — a kill switch or operator cancelled it.
 *  - `superseded`      — a newer run for the same subject replaced this one
 *                        before it finished (so its output must not be applied).
 */
export type AgentRunState =
  | "running"
  | "validating"
  | "succeeded"
  | "awaiting-human"
  | "awaiting-data"
  | "failed"
  | "cancelled"
  | "superseded";

export const TERMINAL_RUN_STATES: readonly AgentRunState[] = [
  "succeeded",
  "awaiting-human",
  "awaiting-data",
  "failed",
  "cancelled",
  "superseded",
];

export function isTerminalRunState(state: AgentRunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

export interface AgentRunRecord {
  /** Unique run id, supplied by the caller (a CSPRNG uuid in practice). */
  readonly id: string;
  /**
   * Ties a source event through this run to any effect it leads to. Where a run
   * has no distinct triggering event it is the run id itself.
   */
  readonly correlationId: string;
  readonly kind: AgentRunKind;
  readonly subjectType: AgentRunSubjectType;
  readonly subjectId: string;
  /** The agent that ran (e.g. "live-analysis", "seller_qualification"). */
  readonly agentId: string;
  readonly agentVersion: string;
  readonly autonomy: AgentAutonomy;
  /**
   * A stable hash of the input snapshot the run read, supplied by the caller. It
   * is what makes a later run detectable as operating on newer state (so an
   * older run's output can be marked `superseded`), and what AG01-style replay
   * keys off. Empty where the producer has no snapshot to hash.
   */
  readonly inputHash: string;
  readonly provider: string;
  readonly model: string;
  readonly state: AgentRunState;
  /** A concise operational result — never a private reasoning trace. */
  readonly summary: string;
  readonly toolCalls: number;
  readonly stepsUsed: number;
  readonly maxSteps: number;
  /** Model turns taken, where a model-backed run reports them. */
  readonly modelCalls?: number;
  /** Provider-reported token usage, where the provider reports it (§20.11). */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly repairAttempted: boolean;
  readonly humanReviewRequired: boolean;
  /** Review or error reason codes, for the operator queue. */
  readonly reasonCodes: readonly string[];
  /** A safe error code where the run failed; never a raw exception message. */
  readonly errorCode?: string;
  readonly startedAt: string;
  /** Set once the run reaches a terminal state. */
  readonly finishedAt?: string;
}

/** The fields a caller supplies to open a run; the rest are defaulted. */
export interface AgentRunSeed {
  readonly id: string;
  readonly kind: AgentRunKind;
  readonly subjectType: AgentRunSubjectType;
  readonly subjectId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly autonomy: AgentAutonomy;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly correlationId?: string;
  readonly inputHash?: string;
  readonly maxSteps?: number;
}

/** Open a run in the `running` state. Pure: the caller owns id and clock. */
export function beginRun(seed: AgentRunSeed): AgentRunRecord {
  return {
    id: seed.id,
    correlationId: seed.correlationId ?? seed.id,
    kind: seed.kind,
    subjectType: seed.subjectType,
    subjectId: seed.subjectId,
    agentId: seed.agentId,
    agentVersion: seed.agentVersion,
    autonomy: seed.autonomy,
    inputHash: seed.inputHash ?? "",
    provider: seed.provider,
    model: seed.model,
    state: "running",
    summary: "",
    toolCalls: 0,
    stepsUsed: 0,
    maxSteps: seed.maxSteps ?? 0,
    repairAttempted: false,
    humanReviewRequired: false,
    reasonCodes: [],
    startedAt: seed.startedAt,
  };
}

/** Allowed state transitions. A terminal state never transitions again. */
const TRANSITIONS: Readonly<Record<AgentRunState, readonly AgentRunState[]>> = {
  running: ["validating", "succeeded", "awaiting-human", "awaiting-data", "failed", "cancelled", "superseded"],
  validating: ["succeeded", "awaiting-human", "awaiting-data", "failed", "cancelled", "superseded"],
  succeeded: [],
  "awaiting-human": [],
  "awaiting-data": [],
  failed: [],
  cancelled: [],
  superseded: [],
};

export function canTransition(from: AgentRunState, to: AgentRunState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface RunClose {
  readonly state: AgentRunState;
  readonly finishedAt: string;
  readonly summary?: string;
  readonly toolCalls?: number;
  readonly stepsUsed?: number;
  readonly modelCalls?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly repairAttempted?: boolean;
  readonly humanReviewRequired?: boolean;
  readonly reasonCodes?: readonly string[];
  readonly errorCode?: string;
}

/**
 * Move a run to a new state, applying the result fields. Refuses an illegal
 * transition (e.g. finishing a run that already finished, or superseding a
 * terminal run) by returning the record unchanged — a run's recorded ending is
 * never silently overwritten by a late or duplicate write.
 */
export function closeRun(run: AgentRunRecord, close: RunClose): AgentRunRecord {
  if (!canTransition(run.state, close.state)) return run;
  return {
    ...run,
    state: close.state,
    finishedAt: close.finishedAt,
    ...(close.summary !== undefined ? { summary: close.summary } : {}),
    ...(close.toolCalls !== undefined ? { toolCalls: close.toolCalls } : {}),
    ...(close.stepsUsed !== undefined ? { stepsUsed: close.stepsUsed } : {}),
    ...(close.modelCalls !== undefined ? { modelCalls: close.modelCalls } : {}),
    ...(close.inputTokens !== undefined ? { inputTokens: close.inputTokens } : {}),
    ...(close.outputTokens !== undefined ? { outputTokens: close.outputTokens } : {}),
    ...(close.repairAttempted !== undefined ? { repairAttempted: close.repairAttempted } : {}),
    ...(close.humanReviewRequired !== undefined ? { humanReviewRequired: close.humanReviewRequired } : {}),
    ...(close.reasonCodes !== undefined ? { reasonCodes: close.reasonCodes } : {}),
    ...(close.errorCode !== undefined ? { errorCode: close.errorCode } : {}),
  };
}

/**
 * Mark an unfinished run superseded by a newer one for the same subject. A run
 * that already finished is left exactly as it was — its output already applied
 * or already rejected, and the ledger says what actually happened, not what a
 * later arrival wishes had.
 */
export function supersede(run: AgentRunRecord, at: string): AgentRunRecord {
  return closeRun(run, { state: "superseded", finishedAt: at, summary: "Superseded by a newer run for this subject." });
}

/** Why a bounded stop happened, mirroring the runtime's own stop reason. */
export type AnalysisStop = "completed" | "step-limit" | "token-limit";

/** How the live analysis runtime ended, in the fields this module needs. */
export interface AnalysisOutcomeView {
  readonly complete: boolean;
  readonly stop: AnalysisStop;
  readonly text: string;
  readonly toolCalls: number;
  readonly modelCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Close a run from the live analysis runtime's outcome. A loop that hit a bound
 * (`complete: false`) is a bounded stop for a person, not a success (spec AG09):
 * it closes `awaiting-human` with the exact bound as the reason rather than
 * presenting an unfinished answer as done. Token usage is recorded either way.
 */
export function closeFromAnalysis(run: AgentRunRecord, outcome: AnalysisOutcomeView, at: string): AgentRunRecord {
  const usage = {
    toolCalls: outcome.toolCalls,
    modelCalls: outcome.modelCalls,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
  };
  if (!outcome.complete) {
    return closeRun(run, {
      ...usage,
      state: "awaiting-human",
      finishedAt: at,
      stepsUsed: run.maxSteps,
      humanReviewRequired: true,
      reasonCodes: [outcome.stop === "token-limit" ? "token-budget-exhausted" : "step-budget-exhausted"],
      summary:
        outcome.stop === "token-limit"
          ? "Stopped at the token budget before finishing."
          : "Stopped at the step limit before finishing.",
    });
  }
  return closeRun(run, { ...usage, state: "succeeded", finishedAt: at, summary: firstLine(outcome.text) });
}

/** How a model-backed run failed, mapped to a terminal state and a safe code. */
export function closeFailed(run: AgentRunRecord, errorCode: string, at: string): AgentRunRecord {
  return closeRun(run, {
    state: "failed",
    finishedAt: at,
    errorCode,
    summary: "The run failed before producing a result.",
  });
}

/** The intake-qualification result fields this module needs. */
export interface IntakeOutcomeView {
  readonly humanReviewRequired: boolean;
  readonly reasonCodes: readonly string[];
  readonly repairAttempted: boolean;
}

/**
 * Close a run from the intake qualification seam. Human-review required ends
 * `awaiting-human`; anything else is a clean `succeeded`. The reason codes and
 * whether a schema repair was attempted are carried onto the record.
 */
export function closeFromIntake(run: AgentRunRecord, outcome: IntakeOutcomeView, at: string): AgentRunRecord {
  return closeRun(run, {
    state: outcome.humanReviewRequired ? "awaiting-human" : "succeeded",
    finishedAt: at,
    repairAttempted: outcome.repairAttempted,
    humanReviewRequired: outcome.humanReviewRequired,
    reasonCodes: outcome.reasonCodes,
    summary: outcome.humanReviewRequired
      ? `Held for a person: ${outcome.reasonCodes.join(", ") || "no safe automatic reply"}.`
      : "Qualified and answered automatically.",
  });
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}
