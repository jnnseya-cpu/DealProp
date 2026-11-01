import { describe, expect, it } from "vitest";
import { awaitingOwnerConsent, isOutreachSourced } from "@shared/domain/outreachConsent";
import type { InventoryItem } from "@shared/domain/inventory";
import type { DealOrigin } from "@shared/domain/dealOrigin";

/**
 * The letter-reply-to-listing bridge (§5b).
 *
 * The rule that must hold: a property we wrote to is never a listing until the
 * OWNER has replied and that reply is recorded as the owner's confirmation. A
 * seller who submitted themselves is consented from the first second, so the
 * bridge never applies to them.
 */

const SOURCED: DealOrigin = { via: "sourcing", note: "probate-notice" };
const SELF: DealOrigin = { via: "sell", note: "public sell form" };

const ownerConfirmed: InventoryItem = {
  category: "owner-verified",
  confirmation: {
    by: "owner",
    at: "2026-05-01T00:00:00.000Z",
    recordedBy: "Jo Bloggs",
    evidence: "Owner replied to our letter and confirmed the property is theirs to sell.",
  },
};

const agentConfirmed: InventoryItem = {
  category: "agent-authorised",
  confirmation: {
    by: "instructed-agent",
    at: "2026-05-01T00:00:00.000Z",
    recordedBy: "Jo Bloggs",
    evidence: "An agent said so.",
  },
};

describe("awaiting the owner's consent", () => {
  it("holds a sourced lead back until the owner has replied", () => {
    // Nothing recorded, and an agent 'confirmation' that cannot stand for the
    // owner on a cold lead, both still await the owner's own reply.
    expect(awaitingOwnerConsent({ origin: SOURCED, inventory: undefined })).toBe(true);
    expect(awaitingOwnerConsent({ origin: SOURCED, inventory: agentConfirmed })).toBe(true);
  });

  it("releases it once the owner's reply is recorded as their confirmation", () => {
    expect(awaitingOwnerConsent({ origin: SOURCED, inventory: ownerConfirmed })).toBe(false);
  });

  it("never applies to a seller who submitted themselves", () => {
    expect(awaitingOwnerConsent({ origin: SELF, inventory: undefined })).toBe(false);
    expect(awaitingOwnerConsent({ origin: undefined, inventory: undefined })).toBe(false);
    expect(isOutreachSourced(SELF)).toBe(false);
    expect(isOutreachSourced(SOURCED)).toBe(true);
  });
});
