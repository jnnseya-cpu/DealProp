import {
  configuredProvider,
  llmConfigured,
  providerEndpoint,
  providerModel,
} from "@backend/llm";
import type { Sourced } from "@backend/agent/provenance";
import type { AgentTool, ToolResult } from "@backend/agent/tools";

/**
 * The live agent runtime.
 *
 * A real Claude tool-use loop: the model is given a task and a set of tools,
 * decides which to call, and the runtime executes them and feeds the results
 * back until the model stops. The model orchestrates the work live; it does not
 * do the arithmetic, because the arithmetic is a tool.
 *
 * Two guardrails make "live but never fabricated" structural rather than hoped
 * for:
 *
 *   1. The system prompt forbids the model from stating any figure a tool did
 *      not return.
 *   2. The figures the platform renders come from `outcome.data` — the
 *      provenance-stamped values the TOOLS returned — not from parsing numbers
 *      out of the model's prose. So even if a model ignored the instruction,
 *      the number a page shows is still the tool's, with the tool's name on it.
 *
 * Anthropic only, for now: tool use is provider-specific and this is the key
 * the platform holds. With no key, or another provider, the runtime refuses
 * rather than pretending — a caller that must not fail wraps it and falls back.
 */

const GUARDRAIL =
  "You are an analyst for a UK property platform. You may reason, plan and write prose freely, " +
  "but you must NEVER state a number — a price, score, percentage, yield, rate or date — that a " +
  "tool did not return to you in this conversation. To obtain any figure, call the appropriate " +
  "tool. If a tool has not given you a figure, say it is not yet known rather than estimating it. " +
  "British English.";

export interface AgentStep {
  readonly tool: string;
  readonly ok: boolean;
  readonly summary: string;
}

/** Why the loop ended: a clean finish, or a bound it hit first (AG09). */
export type AgentStop = "completed" | "step-limit" | "token-limit";

export interface AgentOutcome {
  /** The model's final prose. Narrative only — figures live in `data`. */
  readonly text: string;
  readonly steps: readonly AgentStep[];
  /** Every provenance-stamped figure the tools returned, merged by key. */
  readonly data: Readonly<Record<string, Sourced<string | number>>>;
  /** False when the loop hit a bound (steps or tokens) without the model finishing. */
  readonly complete: boolean;
  /** Which bound ended the loop, or a clean finish. */
  readonly stop: AgentStop;
  /** Model turns taken. */
  readonly modelCalls: number;
  /** Provider-reported token usage, summed across turns (0 if the provider gives none). */
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Per-run token budget (spec §20.11). The loop stops before the next provider
 * call once either is exceeded — a real spend cap now that usage is captured,
 * rather than only a turn count. Defaults match the pack's guardrails.
 */
export const RUNTIME_MAX_INPUT_TOKENS = 24_000;
export const RUNTIME_MAX_OUTPUT_TOKENS = 6_000;

interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
interface TextBlock {
  readonly type: "text";
  readonly text: string;
}
type ContentBlock = ToolUseBlock | TextBlock | { readonly type: string };
interface AssistantTurn {
  readonly stop_reason?: string | null;
  readonly content?: readonly ContentBlock[];
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}
interface Message {
  readonly role: "user" | "assistant";
  readonly content: unknown;
}

function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}
function isText(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

export interface RunAgentOptions {
  /** The task, as a user instruction. */
  readonly task: string;
  readonly tools: readonly AgentTool[];
  /** Extra guidance appended to the standard guardrail system prompt. */
  readonly system?: string;
  readonly maxSteps?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentOutcome> {
  if (!llmConfigured()) throw new Error("No model key configured; the agent cannot run live.");
  if (configuredProvider() !== "anthropic") {
    throw new Error("The agent runtime currently requires the Anthropic provider (BLOG_MODEL_PROVIDER=anthropic).");
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = providerEndpoint("anthropic");
  const model = providerModel("anthropic");
  const key = process.env.BLOG_MODEL_API_KEY ?? "";
  const system = opts.system === undefined ? GUARDRAIL : `${GUARDRAIL}\n\n${opts.system}`;
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const maxSteps = opts.maxSteps ?? 6;
  const maxInputTokens = opts.maxInputTokens ?? RUNTIME_MAX_INPUT_TOKENS;
  const maxOutputTokens = opts.maxOutputTokens ?? RUNTIME_MAX_OUTPUT_TOKENS;

  const messages: Message[] = [{ role: "user", content: opts.task }];
  const steps: AgentStep[] = [];
  const data: Record<string, Sourced<string | number>> = {};
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    // Stop before another provider call once the token budget is spent: a
    // bounded stop for a person, not an extra charge (AG09 / §20.11).
    if (inputTokens > maxInputTokens || outputTokens > maxOutputTokens) {
      return { text: "", steps, data, complete: false, stop: "token-limit", modelCalls, inputTokens, outputTokens };
    }

    const turn = await requestTurn(fetchImpl, url, key, model, system, opts.tools, messages, opts.signal);
    modelCalls += 1;
    inputTokens += turn.usage?.input_tokens ?? 0;
    outputTokens += turn.usage?.output_tokens ?? 0;
    const blocks = turn.content ?? [];
    messages.push({ role: "assistant", content: blocks });

    const toolUses = blocks.filter(isToolUse);
    if (turn.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = blocks.filter(isText).map((b) => b.text).join("\n\n").trim();
      return { text, steps, data, complete: true, stop: "completed", modelCalls, inputTokens, outputTokens };
    }

    const results: unknown[] = [];
    for (const call of toolUses) {
      const tool = byName.get(call.name);
      let result: ToolResult;
      if (tool === undefined) {
        result = { ok: false, summary: "", error: `No such tool: ${call.name}` };
      } else {
        try {
          result = await tool.run(call.input);
        } catch (error) {
          result = { ok: false, summary: "", error: String(error) };
        }
      }
      steps.push({ tool: call.name, ok: result.ok, summary: result.ok ? result.summary : result.error ?? "failed" });
      if (result.ok && result.data !== undefined) {
        for (const [k, v] of Object.entries(result.data)) data[k] = v;
      }
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result.ok ? result.summary : `Error: ${result.error ?? "failed"}`,
        ...(result.ok ? {} : { is_error: true }),
      });
    }
    messages.push({ role: "user", content: results });
  }

  // Ran out of steps. Return honestly rather than inventing a conclusion.
  return { text: "", steps, data, complete: false, stop: "step-limit", modelCalls, inputTokens, outputTokens };
}

async function requestTurn(
  fetchImpl: typeof fetch,
  url: string,
  key: string,
  model: string,
  system: string,
  tools: readonly AgentTool[],
  messages: readonly Message[],
  signal?: AbortSignal,
): Promise<AssistantTurn> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      messages,
    }),
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Agent model returned ${response.status}`);
  return (await response.json()) as AssistantTurn;
}
