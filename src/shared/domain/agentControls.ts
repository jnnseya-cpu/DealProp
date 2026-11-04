import type { AgentRunKind } from "@shared/domain/agentRun";

/**
 * The agent kill switch (spec §20.8).
 *
 * A single env-driven pause that stops the model-backed agents from running —
 * the emergency control for runaway spend or a misbehaving agent. It is the
 * same posture as every other runtime toggle on this platform: set it in the
 * server environment and recreate the container, rather than a button that
 * needs a writable settings store the platform does not yet have. `AGENTS_PAUSED`
 * is read server-side immediately before a run; a paused kind does not call the
 * model, and the would-be run is recorded as cancelled rather than run, so the
 * pause is visible in the ledger and the Control Room rather than silent.
 *
 * Values: "all" (or "1" / "true" / "on") pauses every kind; a comma- or
 * space-separated list pauses only the named kinds (e.g.
 * "live-analysis,intake-qualification"). The deterministic observers are never
 * pauseable — they call no model and have no external effect.
 */
export interface AgentPause {
  readonly all: boolean;
  readonly kinds: readonly AgentRunKind[];
}

/** The kinds a pause can name. Deterministic observers are not model-backed. */
export const PAUSEABLE_KINDS: readonly AgentRunKind[] = ["live-analysis", "intake-qualification"];

export function parseAgentPause(raw: string | undefined): AgentPause {
  const text = (raw ?? "").trim().toLowerCase();
  if (text === "") return { all: false, kinds: [] };
  if (text === "all" || text === "1" || text === "true" || text === "on") return { all: true, kinds: [] };
  const kinds = text
    .split(/[,\s]+/)
    .filter((t): t is AgentRunKind => (PAUSEABLE_KINDS as readonly string[]).includes(t));
  return { all: false, kinds };
}

export function agentPaused(pause: AgentPause, kind: AgentRunKind): boolean {
  return pause.all || pause.kinds.includes(kind);
}

/** True when any model-backed agent is paused — for a Control Room banner. */
export function anyAgentPaused(pause: AgentPause): boolean {
  return pause.all || pause.kinds.length > 0;
}

/** A human-readable description of what is paused, for a read-only surface. */
export function describePause(pause: AgentPause): string {
  if (pause.all) return "All model-backed agents are paused.";
  if (pause.kinds.length === 0) return "No agents are paused.";
  return `Paused: ${pause.kinds.join(", ")}.`;
}
