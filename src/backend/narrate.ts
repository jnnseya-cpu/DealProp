import { complete, configuredProvider, llmConfigured } from "@backend/llm";

/**
 * Live prose over computed figures.
 *
 * This is the analysis-side counterpart of the blog drafter, and it keeps the
 * same hard line: the numbers are the engine's and are passed in; the model
 * writes the words around them and is told, in the system prompt, that it may
 * not touch a figure. A model cannot change a Deal Score, a valuation or a yield
 * here because it never produces one — it only phrases the sentences between the
 * numbers the engine already computed.
 *
 * It is synchronous, because the caller has already metered the analysis and the
 * reader is waiting for it. But it is bounded by a timeout and ALWAYS falls back
 * to the deterministic prose the caller supplies, so a missing key, a slow model
 * or an outage costs better sentences and never the page, and never a charge for
 * nothing.
 */

export interface NarrationFact {
  readonly label: string;
  readonly value: string;
}

export interface NarrationRequest {
  /** What to write, e.g. "Write a two-paragraph executive summary…". */
  readonly instruction: string;
  /** The computed figures and facts. The model may use these and nothing else. */
  readonly facts: readonly NarrationFact[];
  /** The deterministic prose to show when no model is configured or it fails. */
  readonly fallback: string;
  readonly maxTokens?: number;
  /** How long to wait before giving up and falling back. */
  readonly timeoutMs?: number;
}

export interface Narration {
  readonly text: string;
  /** True when the model wrote it; false when this is the deterministic fallback. */
  readonly live: boolean;
}

const SYSTEM =
  "You write concise, plain prose for a UK property investment platform. Use ONLY the facts you are given. Never invent, change, round, restate differently, or add any number, price, percentage, rate, score or date — every figure is computed elsewhere and is fixed; your job is only the words around them. Write in British English. No headings, no preamble, no bullet points, no markdown.";

function buildPrompt(req: NarrationRequest): string {
  const facts = req.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n");
  return `${req.instruction}\n\nFacts (fixed — do not alter or add to any number):\n${facts}`;
}

export async function narrate(
  req: NarrationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<Narration> {
  if (!llmConfigured()) return { text: req.fallback, live: false };
  // The custom gateway has a blog-specific request/response contract; narration
  // uses the real providers only, and falls back rather than guess its shape.
  if (configuredProvider() === "custom") return { text: req.fallback, live: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 10_000);
  try {
    const text = (
      await complete(
        { system: SYSTEM, prompt: buildPrompt(req), maxTokens: req.maxTokens ?? 600 },
        fetchImpl,
        controller.signal,
      )
    ).trim();
    return text === "" ? { text: req.fallback, live: false } : { text, live: true };
  } catch {
    return { text: req.fallback, live: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Split narration into paragraphs for rendering. */
export function narrationParagraphs(text: string): readonly string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p !== "");
}
