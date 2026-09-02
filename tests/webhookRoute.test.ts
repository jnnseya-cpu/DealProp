import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The webhook, end to end, against a real signed Stripe payload.
 *
 * The unit tests prove the adapter maps fields and the verifier checks
 * signatures. This proves the two meet: that a delivery Stripe would actually
 * send, signed the way Stripe would actually sign it, moves the balance — and
 * that every one of the five defences still refuses when it should.
 *
 * It is the one endpoint on the platform that is unauthenticated by necessity
 * and whose word is taken as proof that money arrived, so it is worth testing
 * as a whole rather than in pieces.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-webhook-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
process.env.BILLING_WEBHOOK_SECRET = "whsec_test_secret";
delete process.env.DATABASE_URL;

const { POST } = await import("@/app/api/billing/webhook/route");
const { signPayload } = await import("@backend/billing/webhook");
const { fileStore } = await import("@backend/store/fileStore");
const { listCreditLots, saveAccount } = await import("@backend/store/repository");
const { availableBalance } = await import("@shared/domain/ledger");
const { fromMajor } = await import("@shared/money");

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const ACCOUNT = {
  id: "acc-1",
  email: "buyer@example.com",
  name: "A Buyer",
  role: "investor" as const,
  passwordHash: "x",
  passwordSalt: "y",
  createdAt: "2026-01-01T00:00:00.000Z",
};

async function reset(): Promise<void> {
  await fileStore.replaceAll({
    deals: [], buyBoxes: [], fundingBoxes: [], subscribers: [], accounts: [], auditEvents: [],
    blogViews: [], subscriptions: [], creditLots: [], ledgerEntries: [], billingEvents: [],
    discoveryCandidates: [], outreachMessages: [], suppressions: [], dataRoomGrants: [],
    agentDecisions: [], dealFees: [], reveals: [], pendingCharges: [],
  });
  rmSync(process.env.LODE_DATA_FILE ?? "", { force: true });
  await saveAccount(ACCOUNT);
}

beforeEach(reset);

/** A checkout Stripe would actually send, for a £100 top-up. */
function stripeEvent(over: Record<string, unknown> = {}, id = "evt_1"): string {
  return JSON.stringify({
    id,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "cs_test_1",
        payment_intent: "pi_1",
        amount_total: 10_000,
        currency: "gbp",
        customer_details: { address: { country: "GB" } },
        metadata: { accountId: "acc-1", packId: "topup-100" },
        ...over,
      },
    },
  });
}

function deliver(body: string, header?: string): Promise<Response> {
  const timestamp = Math.floor(Date.now() / 1000);
  return POST(
    new Request("https://lode.example/api/billing/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": header ?? signPayload(body, timestamp, "whsec_test_secret"),
        "content-type": "application/json",
      },
      body,
    }),
  );
}

async function balance(): Promise<number> {
  return availableBalance(await listCreditLots("acc-1"), new Date());
}

describe("a signed Stripe delivery moves the balance", () => {
  it("credits the pack, once", async () => {
    const body = stripeEvent();
    expect((await deliver(body)).status).toBe(200);

    // £100 purchased plus the £5 bonus lot the catalogue grants.
    expect(await balance()).toBe(fromMajor(105));

    // Providers redeliver by design. The second delivery must do nothing.
    expect((await deliver(body)).status).toBe(200);
    expect(await balance()).toBe(fromMajor(105));
  });

  it("credits nothing when the signature is wrong", async () => {
    const response = await deliver(stripeEvent(), "t=1,v1=deadbeef");
    expect(response.status).toBe(401);
    expect(await balance()).toBe(0);
  });

  it("credits nothing when the amount does not match the catalogue", async () => {
    // The single most valuable check on the platform: what the provider says
    // was paid has to equal what this platform would have charged.
    const response = await deliver(stripeEvent({ amount_total: 100 }));
    expect(response.status).toBe(200);
    expect(await balance()).toBe(0);
  });

  it("credits nothing on an overpayment either", async () => {
    // An overpayment usually means the confirmation belongs to a different
    // charge, and applying it delivers the wrong thing while leaving a real
    // payment unfulfilled.
    expect((await deliver(stripeEvent({ amount_total: 50_000 }))).status).toBe(200);
    expect(await balance()).toBe(0);
  });

  it("credits nothing for a pack that does not exist", async () => {
    await deliver(stripeEvent({ metadata: { accountId: "acc-1", packId: "topup-1000000" } }));
    expect(await balance()).toBe(0);
  });

  it("refuses a delivery with no account to credit", async () => {
    const response = await deliver(stripeEvent({ metadata: { packId: "topup-100" } }));
    expect(response.status).toBe(400);
    expect(await balance()).toBe(0);
  });

  it("ignores a Stripe event type we do not act on", async () => {
    const body = JSON.stringify({
      id: "evt_2",
      type: "customer.created",
      data: { object: { id: "cus_1" } },
    });
    const response = await deliver(body);
    // 400 rather than 200: an unmapped type is not our shape either, so it
    // reads as unreadable. Either answer stops the provider retrying usefully;
    // what matters is that nothing was credited.
    expect([200, 400]).toContain(response.status);
    expect(await balance()).toBe(0);
  });

  it("refuses a delivery signed too long ago to be current", async () => {
    const body = stripeEvent();
    const old = Math.floor(Date.now() / 1000) - 3_600;
    const response = await deliver(body, signPayload(body, old, "whsec_test_secret"));
    expect(response.status).toBe(401);
    expect(await balance()).toBe(0);
  });
});

describe("this platform's own shape still works", () => {
  it("credits a native event, and refuses one missing its account", async () => {
    const native = JSON.stringify({
      id: "evt_native_1",
      type: "payment.succeeded",
      accountId: "acc-1",
      packId: "topup-100",
      amountMinorUnits: 10_000,
      currency: "GBP",
      paymentReference: "pay-1",
      customerCountry: "GB",
      customerKind: "consumer",
    });
    expect((await deliver(native)).status).toBe(200);
    expect(await balance()).toBe(fromMajor(105));

    const headless = JSON.stringify({ id: "evt_native_2", type: "payment.succeeded" });
    expect((await deliver(headless)).status).toBe(400);
  });

  it("says not-handled rather than unreadable for a known-shape unknown type", async () => {
    // The two mean different things to whoever is reading the provider's
    // delivery log, so they are different answers.
    const body = JSON.stringify({
      id: "evt_native_3",
      type: "invoice.something_new",
      accountId: "acc-1",
    });
    const response = await deliver(body);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { reason: string }).reason).toContain("not handled");
  });
});
