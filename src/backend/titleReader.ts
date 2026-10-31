/**
 * Reading one title from HM Land Registry.
 *
 * The seam for the register, kept exactly parallel to `configuredProvider()` in
 * `backend/screening.ts` and for the same reason: there is no licensed endpoint
 * configured, and this file does not pretend otherwise. With none, there is no
 * reader to hand `lookupOwner()`, so the ownership half of counterparty
 * verification comes back inconclusive — never a match against nobody.
 *
 * That is deliberate and it is the whole point of wiring this before the key
 * exists: the platform must not be blocked for want of a paid API. An
 * inconclusive lookup clears no gate and falls back to a named manual check
 * (the operator buys the title the way a conveyancer does and records it), so
 * the absence of the key costs an automation, not the ability to transact.
 *
 * Connecting it later is one adapter — a function that takes a title number and
 * returns the register's JSON — and one line here. Nothing that reads an owner
 * lookup changes.
 */

export type TitleReader = (titleNumber: string) => Promise<unknown>;

export function configuredTitleReader(): TitleReader | undefined {
  // No HMLR Business Gateway / Business e-services credential is configured.
  // When one is, the adapter that calls it belongs here and nowhere else, so a
  // second place cannot disagree about whether the register was actually read.
  return undefined;
}
