/**
 * The one place the language-model HTTP shapes live.
 *
 * Two surfaces call a model — the blog drafter (`blog/agent.ts`) and the
 * analysis narrator (`narrate.ts`) — and both go through here so a provider's
 * request and response shape is written once rather than drifting between two
 * copies. It speaks Anthropic and OpenAI, chosen from the environment.
 *
 * It does NOT handle the `custom` provider: that contract's request and response
 * shapes are caller-specific (the blog's gateway returns `{ paragraphs: [...] }`),
 * so a caller that supports `custom` branches on `configuredProvider()` and
 * handles it itself.
 *
 * The guarantee this seam exists to keep: a model writes prose, never a figure.
 * Callers pass the computed numbers in and tell the model, in the system prompt,
 * that they are fixed. Nothing here can change what a number is — the figures a
 * page shows are assembled by the engine, not parsed back out of the model.
 */

export type LlmProvider = "anthropic" | "openai" | "custom";

/** Whether a model key is configured at all. With none, callers fall back. */
export function llmConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.BLOG_MODEL_API_KEY ?? "") !== "";
}

export function configuredProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const named = (env.BLOG_MODEL_PROVIDER ?? "").trim().toLowerCase();
  if (named === "anthropic" || named === "openai" || named === "custom") return named;
  // Not named: infer from a configured URL, else default to Anthropic, which is
  // the house model. A bare key with no provider should still just work.
  const url = env.BLOG_MODEL_API_URL ?? "";
  if (url.includes("anthropic")) return "anthropic";
  if (url.includes("openai")) return "openai";
  return url === "" ? "anthropic" : "custom";
}

export function providerEndpoint(provider: LlmProvider, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BLOG_MODEL_API_URL;
  if (override !== undefined && override !== "") return override;
  if (provider === "anthropic") return "https://api.anthropic.com/v1/messages";
  if (provider === "openai") return "https://api.openai.com/v1/chat/completions";
  throw new Error("BLOG_MODEL_API_URL is required for the custom provider.");
}

export function providerModel(provider: LlmProvider, env: NodeJS.ProcessEnv = process.env): string {
  const name = env.BLOG_MODEL_NAME;
  if (name !== undefined && name !== "") return name;
  // The cheapest current model by default — this platform uses the model only
  // for prose, where the cheapest is more than enough. Override with
  // BLOG_MODEL_NAME for better sentences.
  return provider === "openai" ? "gpt-4o-mini" : "claude-haiku-5-5";
}

export interface CompletionRequest {
  /** Fixed instructions and guardrails — above all, that the numbers are fixed. */
  readonly system?: string;
  readonly prompt: string;
  readonly maxTokens?: number;
}

/**
 * One chat completion, returned as plain text, from Anthropic or OpenAI.
 *
 * Throws with no key, on the `custom` provider (the caller handles that), and on
 * any non-2xx. A caller that must not break on a model failure wraps this in a
 * try/catch and falls back — `narrate()` does exactly that.
 */
export async function complete(
  req: CompletionRequest,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const key = process.env.BLOG_MODEL_API_KEY;
  if (key === undefined || key === "") throw new Error("BLOG_MODEL_API_KEY is not configured.");
  const provider = configuredProvider();
  if (provider === "custom") throw new Error("complete() does not handle the custom provider.");
  const url = providerEndpoint(provider);
  const model = providerModel(provider);
  const maxTokens = req.maxTokens ?? 1024;

  if (provider === "anthropic") {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(req.system !== undefined ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.prompt }],
      }),
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Model returned ${response.status}`);
    const data = (await response.json()) as { content?: readonly { readonly text?: string }[] };
    return (data.content ?? [])
      .map((block) => block.text ?? "")
      .filter((t) => t !== "")
      .join("\n\n");
  }

  // openai, and OpenAI-compatible gateways.
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        ...(req.system !== undefined ? [{ role: "system", content: req.system }] : []),
        { role: "user", content: req.prompt },
      ],
    }),
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Model returned ${response.status}`);
  const data = (await response.json()) as {
    choices?: readonly { readonly message?: { readonly content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}
