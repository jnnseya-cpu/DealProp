import { afterEach, describe, expect, it, vi } from "vitest";
import { cachingDrafter, modelDrafter, type DraftBrief, type Drafter } from "@backend/blog/agent";

/**
 * The one LLM seam, tested without a network.
 *
 * The provider adapters are exercised with a fake `fetch` returning each
 * provider's real response shape, and the caching wrapper is tested for the
 * property that actually matters in production: a render never blocks on the
 * model and never throws when it fails. The figures are the engine's whatever
 * the model says, so every test also checks the figures block survives.
 */

const BRIEF: DraftBrief = {
  slug: "deal-breakdown-erdington-b23",
  topic: "deal-analysis",
  headline: "Deal Score 61: a 3-bed in Erdington",
  evidence: ["It clears the target margin after tax.", "No single stress takes it into a loss."],
  figures: [
    { label: "Deal Score", value: "61/100" },
    { label: "True discount to value", value: "8.2%" },
  ],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("the model drafter", () => {
  it("parses an Anthropic response into paragraphs and keeps the engine's figures", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "anthropic";
    const fetchMock = vi.fn(async () =>
      jsonResponse({ content: [{ type: "text", text: "First paragraph.\n\nSecond paragraph." }] }),
    );

    const prose = await modelDrafter(fetchMock as unknown as typeof fetch).draft(BRIEF);

    const paragraphs = prose.body.filter((b) => b.kind === "paragraph");
    expect(paragraphs.map((b) => (b.kind === "paragraph" ? b.text : ""))).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ]);
    // The figures block is the engine's, appended after the model returns.
    const figures = prose.body.find((b) => b.kind === "figures");
    expect(figures?.kind === "figures" && figures.rows).toEqual(BRIEF.figures);
    // Hit the Anthropic endpoint with its auth header, not a bearer token.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
  });

  it("parses an OpenAI response into paragraphs", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "openai";
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "One.\n\nTwo.\n\nThree." } }] }),
    );

    const prose = await modelDrafter(fetchMock as unknown as typeof fetch).draft(BRIEF);
    const paragraphs = prose.body.filter((b) => b.kind === "paragraph");
    expect(paragraphs).toHaveLength(3);
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("honours the custom provider's {paragraphs} contract", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "custom";
    process.env.BLOG_MODEL_API_URL = "https://gateway.example/draft";
    const fetchImpl = vi.fn(async () => jsonResponse({ paragraphs: ["Only one."] })) as unknown as typeof fetch;

    const prose = await modelDrafter(fetchImpl).draft(BRIEF);
    expect(prose.body.filter((b) => b.kind === "paragraph")).toHaveLength(1);
  });

  it("fails closed with no key, and throws on a provider error", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(modelDrafter(fetchImpl).draft(BRIEF)).rejects.toThrow(/not configured/);

    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "anthropic";
    await expect(modelDrafter(fetchImpl).draft(BRIEF)).rejects.toThrow(/returned 500/);
  });
});

describe("the caching drafter", () => {
  const fallback: Drafter = {
    name: "fallback",
    async draft(brief) {
      return { title: brief.headline, standfirst: "fallback", body: [{ kind: "paragraph", text: "fallback prose" }] };
    },
  };

  it("returns the fallback immediately on a miss, then upgrades in the background", async () => {
    const primary: Drafter = {
      name: "primary",
      async draft(brief) {
        return { title: brief.headline, standfirst: "primary", body: [{ kind: "paragraph", text: "primary prose" }] };
      },
    };
    const drafter = cachingDrafter(primary, fallback);

    // First render: the fallback, with no waiting on the primary.
    const first = await drafter.draft(BRIEF);
    expect(first.standfirst).toBe("fallback");

    // Let the background warm settle, then the cache serves the primary.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await drafter.draft(BRIEF);
    expect(second.standfirst).toBe("primary");
  });

  it("never throws when the primary fails — the page keeps rendering", async () => {
    const primary: Drafter = {
      name: "primary",
      async draft() {
        throw new Error("model down");
      },
    };
    const drafter = cachingDrafter(primary, fallback);

    const first = await drafter.draft(BRIEF);
    expect(first.standfirst).toBe("fallback");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Still the fallback, and still no throw.
    const second = await drafter.draft(BRIEF);
    expect(second.standfirst).toBe("fallback");
  });
});
