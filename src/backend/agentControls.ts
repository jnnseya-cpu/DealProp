import { parseAgentPause, type AgentPause } from "@shared/domain/agentControls";

/**
 * The agent pause, read from the server environment at request time (§20.8).
 *
 * One reader so the producers and the Control Room agree. Read live, never
 * cached, so changing `AGENTS_PAUSED` and recreating the container takes effect
 * on the next request.
 */
export function agentPause(): AgentPause {
  return parseAgentPause(process.env.AGENTS_PAUSED);
}
