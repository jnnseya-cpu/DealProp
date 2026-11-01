import type { DealOrigin } from "@shared/domain/dealOrigin";
import type { InventoryItem } from "@shared/domain/inventory";

/**
 * The bridge between a letter-sourced lead and a listing.
 *
 * A property we wrote to — a homeowner, a probate estate, a bankruptcy —
 * reached us from public records under legitimate interest, as a private
 * one-to-one approach. It is never a marketplace listing on the strength of
 * that letter. It becomes one only when the owner (or their representative)
 * replies and agrees to explore selling — and that reply, recorded, is the
 * consent that turns a private approach into a listing that may go into the
 * pipeline. §59 and the discovery/outreach design forbid any shortcut.
 *
 * In the store that consent is an OWNER sale-confirmation: `saleIsConfirmed`
 * already keeps an unconfirmed opportunity shut, and the only lawful basis for
 * confirming a cold-sourced lead is that the owner themselves said so. There was
 * never an agent we instructed, so an "instructed-agent" confirmation on a
 * sourced lead is not a shortcut, it is a fiction — which is why recording one
 * is refused (see `inventoryActions.ts`).
 *
 * Pure and framework-free: it reads the origin and the recorded confirmation and
 * reports the §5b state, nothing more.
 */

/** True where this deal entered from our own outreach rather than a seller. */
export function isOutreachSourced(origin: DealOrigin | undefined): boolean {
  return origin?.via === "sourcing";
}

/**
 * True where a letter-sourced lead has NOT yet had the owner's reply recorded,
 * so it may not be listed. False for a seller-submitted deal (consented from the
 * first second) and false once the owner's confirmation is on the record.
 */
export function awaitingOwnerConsent(input: {
  readonly origin?: DealOrigin;
  readonly inventory?: InventoryItem;
}): boolean {
  if (!isOutreachSourced(input.origin)) return false;
  return input.inventory?.confirmation?.by !== "owner";
}

/**
 * What the operator is told to do with a sourced lead before it can be listed.
 * Published copy, so it is stated once here rather than retyped on the surface.
 */
export const OWNER_REPLY_GUIDANCE =
  "This came from our outreach, not from the owner. It cannot be listed until the owner has " +
  "replied and agreed to explore selling. Record their reply below as the owner's confirmation — " +
  "nothing about this property reaches a buyer before then.";
