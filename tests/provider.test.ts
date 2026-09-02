import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Creating a charge with the payment provider.
 *
 * The tests that matter are the ones proving the pending charge survives a
 * failure. A charge that exists only in the provider's records is money nothing
 * here can account for.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-provider-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
delete process.env.DATABASE_URL;

const { createCharge, providerConfig } = await import("@backend/billing/provider");
const { fileStore } = await import("@backend/store/fileStore");
const { getPendingCharge } = await import("@backend/store/repository");

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const CONFIG = { url: "https://provider.example/checkout", apiKey: "key" };

const request = {
  accountId: "acc-1",
  description: "Prepaid balance — £100.00",
  amountMinorUnits: 10_000,
  currency: "GBP",
  packId: "topup-100",
  returnUrl: "https://lode.example/account/billing",
};

function transport(response: { status?: number; body?: unknown; throws?: boolean }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: url.toString(), ...(init !== undefined ? { init } : {}) });
    if (response.throws === true) throw new Error("network down");
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fn: fn as unknown as typeof fetch };
}

async function reset(): Promise<void> {
  await fileStore.replaceAll({
    deals: [], buyBoxes: [], fundingBoxes: [], subscribers: [], accounts: [], auditEvents: [],
    blogViews: [], subscriptions: [], creditLots: [], ledgerEntries: [], billingEvents: [],
    discoveryCandidates: [], outreachMessages: [], suppressions: [], dataRoomGrants: [], agentDecisions: [], dealFees: [],
    reveals: [],
    pendingCharges: [],
  });
  rmSync(process.env.LODE_DATA_FILE ?? "", { force: true });
}

beforeEach(reset);

describe("configuration", () => {
  it("needs both the endpoint and the key", () => {
    expect(providerConfig({ BILLING_CHECKOUT_URL: "x" })).toBeUndefined();
    expect(providerConfig({ BILLING_API_KEY: "x" })).toBeUndefined();
    expect(providerConfig({ BILLING_CHECKOUT_URL: "x", BILLING_API_KEY: "y" })).toBeDefined();
  });

  it("charges nothing with no provider connected, and says so", async () => {
    // The safe state rather than a working one: no endpoint means no charge,
    // and the caller is told why rather than handed a success that did not
    // happen.
    delete process.env.BILLING_CHECKOUT_URL;
    delete process.env.BILLING_API_KEY;

    const t = transport({});
    const result = await createCharge(request, { transport: t.fn });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("BILLING_CHECKOUT_URL");
    expect(t.calls).toEqual([]);
  });
});

describe("creating a charge", () => {
  it("records the charge before calling the provider", async () => {
    // If the call succeeds and the response is lost, the charge still exists
    // and the webhook can reconcile against it.
    const t = transport({ throws: true });
    const result = await createCharge(request, { transport: t.fn, config: CONFIG });

    expect(result.ok).toBe(false);
    expect(result.charge).toBeDefined();
    expect(await getPendingCharge(result.charge?.id ?? "")).toBeDefined();
  });

  it("sends the amount, currency and an idempotency key", async () => {
    const t = transport({ body: { url: "https://provider.example/pay/abc" } });
    await createCharge(request, { transport: t.fn, config: CONFIG });

    const headers = new Headers(t.calls[0]?.init?.headers);
    expect(headers.get("idempotency-key")).toMatch(/^charge:/);
    const body = JSON.parse(String(t.calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body["amount"]).toBe(10_000);
    expect(body["currency"]).toBe("GBP");
  });

  it("returns where to send the customer", async () => {
    const t = transport({ body: { url: "https://provider.example/pay/abc" } });
    const result = await createCharge(request, { transport: t.fn, config: CONFIG });
    expect(result.ok).toBe(true);
    expect(result.redirectUrl).toBe("https://provider.example/pay/abc");
    expect((await getPendingCharge(result.charge?.id ?? ""))?.redirectUrl).toBe(
      "https://provider.example/pay/abc",
    );
  });

  it("accepts either field name a provider might use", async () => {
    const t = transport({ body: { redirect_url: "https://provider.example/pay/def" } });
    expect((await createCharge(request, { transport: t.fn, config: CONFIG })).redirectUrl).toBe(
      "https://provider.example/pay/def",
    );
  });

  it("fails where the provider returns nowhere to send them", async () => {
    const t = transport({ body: { id: "abc" } });
    const result = await createCharge(request, { transport: t.fn, config: CONFIG });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("did not return somewhere to send");
  });

  it("fails on a provider error, keeping the charge", async () => {
    const t = transport({ status: 500 });
    const result = await createCharge(request, { transport: t.fn, config: CONFIG });
    expect(result.ok).toBe(false);
    expect(await getPendingCharge(result.charge?.id ?? "")).toBeDefined();
  });

  it("refuses an amount that is not a positive whole number of minor units", async () => {
    const t = transport({ body: { url: "x" } });
    for (const amount of [0, -100, 1.5]) {
      const result = await createCharge({ ...request, amountMinorUnits: amount }, { transport: t.fn, config: CONFIG });
      expect(result.ok, `${amount}`).toBe(false);
    }
    expect(t.calls).toEqual([]);
  });

  it("gives every charge its own reference and key", async () => {
    const t = transport({ body: { url: "https://provider.example/pay/abc" } });
    const a = await createCharge(request, { transport: t.fn, config: CONFIG });
    const b = await createCharge(request, { transport: t.fn, config: CONFIG });
    expect(a.charge?.id).not.toBe(b.charge?.id);
    expect(a.charge?.idempotencyKey).not.toBe(b.charge?.idempotencyKey);
  });
});

describe("talking to Stripe", () => {
  const STRIPE = { url: "https://api.stripe.com/v1/checkout/sessions", apiKey: "sk_test" };

  it("sends form-encoded line items rather than a JSON amount", async () => {
    // Stripe's Checkout Sessions API does not take JSON, and prices are line
    // items rather than an amount. That single fact is why it needs an adapter
    // rather than a configuration value.
    const t = transport({ body: { url: "https://checkout.stripe.com/c/pay/cs_1" } });
    const result = await createCharge(request, { transport: t.fn, config: STRIPE });

    expect(result.ok).toBe(true);
    expect(result.redirectUrl).toBe("https://checkout.stripe.com/c/pay/cs_1");

    const init = t.calls[0]?.init;
    const headers = init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");

    const form = new URLSearchParams(String(init?.body));
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("10000");
    expect(form.get("metadata[accountId]")).toBe("acc-1");
    expect(form.get("metadata[packId]")).toBe("topup-100");
  });

  it("still sends JSON to a provider that is not Stripe", async () => {
    const t = transport({ body: { url: "https://provider.example/pay/1" } });
    await createCharge(request, { transport: t.fn, config: CONFIG });

    const init = t.calls[0]?.init;
    const headers = init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init?.body)) as { amount?: number };
    expect(body.amount).toBe(10_000);
  });

  it("records the charge before either provider is called", async () => {
    // The charge exists whichever adapter is used, and it exists before the
    // request goes out — a charge that exists only in the provider's records
    // is money nothing here can account for.
    const t = transport({ throws: true });
    const result = await createCharge(request, { transport: t.fn, config: STRIPE });
    expect(result.ok).toBe(false);
    expect(result.charge).toBeDefined();
    expect(await getPendingCharge(result.charge?.id ?? "")).toBeDefined();
  });

  it("carries the opportunity through, so a reveal can be matched to its deal", async () => {
    const t = transport({ body: { url: "https://checkout.stripe.com/c/pay/cs_2" } });
    await createCharge(
      { ...request, packId: undefined, opportunityId: "deal-0001" },
      { transport: t.fn, config: STRIPE },
    );
    const form = new URLSearchParams(String(t.calls[0]?.init?.body));
    expect(form.get("metadata[opportunityId]")).toBe("deal-0001");
    expect(form.get("payment_intent_data[metadata][opportunityId]")).toBe("deal-0001");
  });
});
