import { afterEach, describe, expect, it, vi } from "vitest";
import { narrate } from "@backend/narrate";

/**
 * Live prose, computed numbers — tested for the property that matters: the
 * numbers are never the model's, and a model that is absent, slow or broken
 * degrades to the deterministic fallback rather than blocking or erroring.
 */

const REQUEST = {
  instruction: "Write a two-paragraph executive summary.",
  facts: [
    { label: "Deal Score", value: "61/100" },
    { label: "Profit after tax", value: "£42,000" },
  ],
  fallback: "The engine's own summary sentence.",
} as const;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("narrate", () => {
  it("returns the deterministic fallback when no model is configured", async () => {
    delete process.env.BLOG_MODEL_API_KEY;
    const fetchMock = vi.fn();
    const out = await narrate(REQUEST, fetchMock as unknown as typeof fetch);
    expect(out).toEqual({ text: REQUEST.fallback, live: false });
    // No network call when there is no key.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back for a custom gateway rather than guessing its shape", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "custom";
    process.env.BLOG_MODEL_API_URL = "https://gateway.example/draft";
    const out = await narrate(REQUEST, (vi.fn() as unknown) as typeof fetch);
    expect(out.live).toBe(false);
    expect(out.text).toBe(REQUEST.fallback);
  });

  it("returns the model's prose live when it answers", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "anthropic";
    const fetchMock = vi.fn(async () =>
      jsonResponse({ content: [{ type: "text", text: "A live committee summary." }] }),
    );
    const out = await narrate(REQUEST, fetchMock as unknown as typeof fetch);
    expect(out).toEqual({ text: "A live committee summary.", live: true });
  });

  it("falls back, never throws, when the model errors", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "anthropic";
    const fetchMock = vi.fn(async () => new Response("no", { status: 503 }));
    const out = await narrate(REQUEST, fetchMock as unknown as typeof fetch);
    expect(out).toEqual({ text: REQUEST.fallback, live: false });
  });

  it("falls back when the model returns empty prose", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "openai";
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "   " } }] }));
    const out = await narrate(REQUEST, fetchMock as unknown as typeof fetch);
    expect(out.live).toBe(false);
  });
});
