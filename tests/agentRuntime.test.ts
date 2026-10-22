import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "@backend/agent/runtime";
import { dealAnalysisTools } from "@backend/agent/dealTools";
import { computed } from "@backend/agent/provenance";
import type { AgentTool } from "@backend/agent/tools";
import type { DealInputs } from "@shared/domain/types";
import { fromMajor, pct } from "@shared/money";

/**
 * The agent runtime: live orchestration, figures only from tools.
 *
 * The model is faked here (a two-turn tool-use transcript) so the loop is
 * tested deterministically; the real model plugs in behind the same shape with
 * the key. What matters is the invariant: the number in the outcome is the
 * tool's, carrying the tool's provenance — the runtime never reads a figure out
 * of the model's prose.
 */

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function turn(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const mockTool: AgentTool = {
  name: "mock_calc",
  description: "Returns a fixed score.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run() {
    return { ok: true, summary: "Score is 61.", data: { score: computed(61, "mock_calc") } };
  },
};

describe("runAgent", () => {
  it("runs the tool the model asks for and reports only the tool's figure", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "anthropic";
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return turn({
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Let me compute the score." },
            { type: "tool_use", id: "t1", name: "mock_calc", input: {} },
          ],
        });
      }
      return turn({ stop_reason: "end_turn", content: [{ type: "text", text: "The score is 61." }] });
    });

    const outcome = await runAgent({ task: "Score this deal.", tools: [mockTool], fetchImpl: fetchMock as unknown as typeof fetch });

    expect(outcome.complete).toBe(true);
    expect(outcome.text).toBe("The score is 61.");
    expect(outcome.steps).toEqual([{ tool: "mock_calc", ok: true, summary: "Score is 61." }]);
    // The figure is the tool's, with the tool's provenance — not parsed from prose.
    expect(outcome.data.score).toEqual({ value: 61, provenance: { kind: "computed", tool: "mock_calc" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to run with no key, and with a non-Anthropic provider", async () => {
    delete process.env.BLOG_MODEL_API_KEY;
    await expect(runAgent({ task: "x", tools: [mockTool] })).rejects.toThrow(/cannot run live/);

    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "openai";
    await expect(runAgent({ task: "x", tools: [mockTool] })).rejects.toThrow(/Anthropic/);
  });

  it("stops honestly at the step limit rather than inventing a conclusion", async () => {
    process.env.BLOG_MODEL_API_KEY = "sk-test";
    process.env.BLOG_MODEL_PROVIDER = "anthropic";
    // A model that always wants another tool call: the loop must bound itself.
    const fetchMock = vi.fn(async () =>
      turn({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "mock_calc", input: {} }] }),
    );
    const outcome = await runAgent({
      task: "loop",
      tools: [mockTool],
      maxSteps: 3,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(outcome.complete).toBe(false);
    expect(outcome.text).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("the appraise_deal tool", () => {
  const inputs: DealInputs = {
    property: {
      id: "example",
      jurisdiction: "GB-ENG",
      postcodeArea: "B23",
      locality: "Erdington",
      propertyType: "house",
      tenure: "freehold",
      bedrooms: 3,
      occupancy: "vacant",
      openMarketValue: fromMajor(212_000),
      valuationConfidence: pct(80),
      refurbishmentEstimate: fromMajor(34_000),
      postWorksValue: fromMajor(285_000),
      monthlyRent: fromMajor(1_250),
      knownIssues: [],
    },
    seller: { situation: "probate", priorities: ["speed"] },
    purchasePrice: fromMajor(170_000),
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
    holdMonths: 9,
    structure: "cash-purchase",
    finance: {
      ltvBps: pct(0),
      refurbAdvanceBps: pct(0),
      annualRateBps: pct(0),
      arrangementFeeBps: pct(0),
      exitFeeBps: pct(0),
      interestRolledUp: false,
      lenderCosts: fromMajor(0),
    },
    exit: "sell",
  };

  it("returns the engine's figures, each stamped computed", async () => {
    const [tool] = dealAnalysisTools(inputs);
    expect(tool).toBeDefined();
    const result = await tool!.run({});
    expect(result.ok).toBe(true);
    const score = result.data?.dealScore;
    expect(score).toBeDefined();
    expect(typeof score?.value).toBe("number");
    expect(score?.provenance).toEqual({ kind: "computed", tool: "appraise_deal" });
    expect(result.summary).toContain("Deal Score");
  });

  it("rejects a non-numeric price rather than guessing one", async () => {
    const [tool] = dealAnalysisTools(inputs);
    const result = await tool!.run({ purchasePrice: "cheap" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/positive number/);
  });
});
