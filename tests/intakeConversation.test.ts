import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The intake conversation service, against a real store (spec §12).
 *
 * The gate was tested as a pure function already; what this proves is that the
 * path which actually moves a conversation forward goes through it — a safe
 * draft is sent, an unsafe or absent one is held for a person, and nothing the
 * model asks for escapes `reviewQualification`. A correct gate nothing calls
 * stops nothing (decision #42).
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-intake-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
delete process.env.DATABASE_URL;
// A real 32-byte key, so the whole sealed path runs — the seller's words are
// sealed at rest and must still come back readable.
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

const {
  startIntakeConversation,
  addSellerReply,
  operatorReply,
  closeIntakeConversation,
} = await import("@backend/intake/service");
const { getIntakeConversation, listIntakeConversations, listAgentRuns } = await import("@backend/store/repository");

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

const OPERATOR = { id: "op-1", email: "jo@lode.example", name: "Jo Operator" };

/** A model that returns a safe, answerable draft. */
const safeComplete = async () =>
  JSON.stringify({
    facts: [],
    missing_fields: ["postcode_area"],
    recommended_action: "ask_missing_information",
    human_review_required: false,
    review_reason_codes: [],
    draft_reply: "Thanks for getting in touch — whereabouts is the property?",
  });

/** A model that tries to guarantee a purchase: a claim it may not make (§9). */
const prohibitedComplete = async () =>
  JSON.stringify({
    facts: [],
    missing_fields: [],
    recommended_action: "answer_question",
    human_review_required: false,
    review_reason_codes: [],
    draft_reply: "Good news — we guarantee we will buy your property this week.",
  });

describe("starting a conversation", () => {
  it("holds for a human when no model is configured", async () => {
    const c = await startIntakeConversation("I need to sell a flat in Leeds quickly.");
    expect(c.status).toBe("needs-review");
    // Nothing was said to the seller automatically.
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]?.from).toBe("seller");
  });

  it("answers automatically when the gate says the draft is safe", async () => {
    const c = await startIntakeConversation("Hello, I have a house to sell.", {
      complete: safeComplete,
    });
    expect(c.status).toBe("awaiting-seller");
    expect(c.messages).toHaveLength(2);
    expect(c.messages[1]?.from).toBe("assistant");
    expect(c.messages[1]?.text).toMatch(/whereabouts/i);
    expect(c.lastReview?.safeToAutoReply).toBe(true);
  });

  it("withholds a forbidden claim and routes it to a person", async () => {
    const c = await startIntakeConversation("Will you buy my house?", {
      complete: prohibitedComplete,
    });
    expect(c.status).toBe("needs-review");
    // The guarantee never reached the seller, even as a drafted reply.
    expect(c.messages).toHaveLength(1);
    expect(c.lastReview?.reviewReasonCodes).toContain("prohibited_claim");
  });

  it("records a run in the ledger for each qualification (§20.5)", async () => {
    const safe = await startIntakeConversation("A house to sell in Leeds.", { complete: safeComplete });
    const safeRuns = await listAgentRuns(safe.id);
    expect(safeRuns).toHaveLength(1);
    expect(safeRuns[0]?.kind).toBe("intake-qualification");
    expect(safeRuns[0]?.agentId).toBe("seller_qualification");
    expect(safeRuns[0]?.state).toBe("succeeded");

    // A forbidden claim ends the run awaiting a person, with the reason carried.
    const held = await startIntakeConversation("Will you buy my house?", { complete: prohibitedComplete });
    const heldRuns = await listAgentRuns(held.id);
    expect(heldRuns[0]?.state).toBe("awaiting-human");
    expect(heldRuns[0]?.reasonCodes).toContain("prohibited_claim");
    expect(heldRuns[0]?.humanReviewRequired).toBe(true);

    // A second seller turn is a second run for the same conversation.
    await addSellerReply(safe.id, "It's in LS6.", { complete: safeComplete });
    expect(await listAgentRuns(safe.id)).toHaveLength(2);
  });
});

describe("continuing and resolving a conversation", () => {
  it("persists across turns and is sealed but readable", async () => {
    const started = await startIntakeConversation("Inherited a property, need advice.", {
      complete: safeComplete,
    });
    const reloaded = await getIntakeConversation(started.id);
    // Stored and read back through the sealed store with the text intact.
    expect(reloaded?.messages[0]?.text).toBe("Inherited a property, need advice.");

    const replied = await addSellerReply(started.id, "It's in Bristol, BS5.", {
      complete: safeComplete,
    });
    expect(replied?.messages.some((m) => m.text.includes("BS5"))).toBe(true);
  });

  it("lets a named operator reply, which resolves the review", async () => {
    const started = await startIntakeConversation("My situation is complicated.");
    expect(started.status).toBe("needs-review");

    const replied = await operatorReply(started.id, OPERATOR, "Happy to help — let's book a call.");
    expect(replied?.status).toBe("awaiting-seller");
    expect(replied?.handledBy).toBe("Jo Operator");
    expect(replied?.messages[replied.messages.length - 1]?.from).toBe("operator");
  });

  it("closes a conversation and refuses further seller replies", async () => {
    const started = await startIntakeConversation("Quick question.");
    const closed = await closeIntakeConversation(started.id, OPERATOR);
    expect(closed?.status).toBe("closed");
    await expect(addSellerReply(started.id, "one more thing")).rejects.toThrow(/closed/i);
  });

  it("returns undefined for an unknown conversation id", async () => {
    expect(await addSellerReply("does-not-exist", "hello")).toBeUndefined();
    expect(await operatorReply("does-not-exist", OPERATOR, "hello")).toBeUndefined();
  });

  it("lists conversations for the operator queue, newest first", async () => {
    const all = await listIntakeConversations();
    expect(all.length).toBeGreaterThan(0);
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i - 1]!.updatedAt >= all[i]!.updatedAt).toBe(true);
    }
  });
});
