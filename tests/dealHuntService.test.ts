import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAndRunHunt, interpret } from "@backend/dealHunt/service";
import { listDealHuntResults } from "@backend/store/repository";

/**
 * The service wired to the fixture feed, exercising interpret → validate →
 * persist → run end to end. DEAL_HUNT_FIXTURES is the staff-pilot switch; with
 * it off the same path returns an honest zero (covered in the worker tests).
 */

const PREV = process.env.DEAL_HUNT_FIXTURES;
beforeAll(() => {
  process.env.DEAL_HUNT_FIXTURES = "1";
});
afterAll(() => {
  if (PREV === undefined) delete process.env.DEAL_HUNT_FIXTURES;
  else process.env.DEAL_HUNT_FIXTURES = PREV;
});

describe("createAndRunHunt over the pilot fixtures", () => {
  it("interprets the example brief, runs it, and returns the one qualifying match", async () => {
    const r = interpret(
      "2–3 bed houses in Birmingham under £225,000 that returned to market in the last 30 days and dropped at least 5%",
    );
    expect(r.validation.ok).toBe(true);

    const result = await createAndRunHunt({ investorId: "op-1", draft: r.draft });
    expect(result.ok).toBe(true);
    const run = result.outcome!.run;
    expect(run.state).toBe("completed");
    expect(run.counts?.eligible).toBe(1); // erdington qualifies; kingstanding (DH04) excluded
    const persisted = await listDealHuntResults(run.id);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.propertyId).toBe("fx-erdington-1");
    expect(persisted[0]!.enrichment.rent).toBe("missing"); // no fixture rental feed
  });

  it("refuses to run an invalid draft (DH02)", async () => {
    const result = await createAndRunHunt({ investorId: "op-1", draft: { geographyId: "pilot-birmingham" } });
    expect(result.ok).toBe(false);
    expect(result.errors && result.errors.length).toBeGreaterThan(0);
  });
});
