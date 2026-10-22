import type { Sourced } from "@backend/agent/provenance";

/**
 * A tool an agent may call.
 *
 * A tool is the only way a number enters an answer. It runs deterministic code
 * or reads a licensed source, and returns both a human/model-readable `summary`
 * and the structured, provenance-stamped `data` the runtime keeps out of the
 * model's hands — the model sees the summary and may describe it, but the
 * figures the platform renders come from `data`, where each one knows its
 * source.
 *
 * `inputSchema` is a JSON Schema object sent to the model as the tool's
 * signature. The model fills it in; `run` validates it, because the model's
 * proposed input is a suggestion, not a guarantee.
 */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  run(input: unknown): Promise<ToolResult>;
}

export interface ToolResult {
  readonly ok: boolean;
  /** What the tool found, in words the model may quote. Never "looks good". */
  readonly summary: string;
  /**
   * The figures, each stamped with where it came from. The runtime renders
   * these rather than trusting the model's prose for a number.
   */
  readonly data?: Readonly<Record<string, Sourced<string | number>>>;
  readonly error?: string;
}

export function toolError(error: string): ToolResult {
  return { ok: false, summary: "", error };
}
