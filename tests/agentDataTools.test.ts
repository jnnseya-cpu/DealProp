import { afterEach, describe, expect, it, vi } from "vitest";
import { liveDataTools } from "@backend/agent/dataTools";

/**
 * The live-data tools, exercised offline with an injected fetch.
 *
 * What matters: a figure they return is stamped `from <source>` (a real record,
 * not a guess), and a source that is unavailable or unconfigured yields "not
 * known", never a fabricated number.
 */

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function toolNamed(name: string, fetchImpl: typeof fetch) {
  const tool = liveDataTools("B23 6QR", { fetchImpl }).find((t) => t.name === name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool;
}

describe("sold_comparables", () => {
  it("returns real sold prices stamped from Price Paid Data", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        result: {
          items: [
            { transactionId: "a", pricePaid: 200000, transactionDate: "2026-02-01", propertyAddress: { postcode: "B23 6QR", paon: "12", street: "High St", town: "Birmingham" }, transactionCategory: { prefLabel: ["Standard price paid"] } },
            { transactionId: "b", pricePaid: 180000, transactionDate: "2025-11-01", propertyAddress: { postcode: "B23 6QR" }, transactionCategory: { prefLabel: ["Standard price paid"] } },
          ],
        },
      }),
    );
    const result = await toolNamed("sold_comparables", fetchMock as unknown as typeof fetch).run({});
    expect(result.ok).toBe(true);
    expect(result.data?.comparableCount?.value).toBe(2);
    expect(result.data?.medianSoldPrice?.provenance).toMatchObject({ kind: "source", source: "Land Registry Price Paid Data" });
    expect(result.summary).toContain("actual completions");
  });

  it("reports an absence, not a number, when there are no sales", async () => {
    const fetchMock = vi.fn(async () => json({ result: { items: [] } }));
    const result = await toolNamed("sold_comparables", fetchMock as unknown as typeof fetch).run({});
    expect(result.ok).toBe(true);
    expect(result.data).toBeUndefined();
    expect(result.summary).toContain("absence");
  });
});

describe("epc_lookup", () => {
  it("returns real floor area and rating stamped from the EPC register", async () => {
    process.env.EPC_API_EMAIL = "me@example.com";
    process.env.EPC_API_KEY = "key";
    const fetchMock = vi.fn(async () =>
      json({
        rows: [
          {
            "lmk-key": "x",
            postcode: "B23 6QR",
            "lodgement-date": "2025-09-01",
            "current-energy-rating": "D",
            "total-floor-area": "82",
            "construction-age-band": "1900-1929",
          },
        ],
      }),
    );
    const result = await toolNamed("epc_lookup", fetchMock as unknown as typeof fetch).run({});
    expect(result.ok).toBe(true);
    expect(result.data?.epcLodgedAt?.provenance).toMatchObject({ kind: "source", source: "EPC register" });
    expect(result.summary).toContain("sqm");
  });

  it("fails closed when the EPC key is not configured", async () => {
    delete process.env.EPC_API_EMAIL;
    delete process.env.EPC_API_KEY;
    const fetchMock = vi.fn();
    const result = await toolNamed("epc_lookup", fetchMock as unknown as typeof fetch).run({});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/EPC register unavailable/);
    // Never reached the network, because the licence/key gate refused first.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
