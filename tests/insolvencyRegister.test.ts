import { describe, expect, it } from "vitest";
import {
  INSOLVENCY_SOURCE,
  confirmInsolvency,
  parseInsolvencyRegisterRecord,
  type InsolvencyRegisterRecord,
} from "@backend/discovery/insolvencyRegister";
import { sourcePermits } from "@shared/domain/sources";

/**
 * The Individual Insolvency Register adapter. This is distress data about a
 * living person, so the tests pin the two things that keep it safe: it is
 * internal-analysis only, and a confirmation is never made on a name alone
 * across a different address.
 */

describe("the register is internal-analysis only, never redistributed", () => {
  it("may be used for internal analysis", () => {
    expect(sourcePermits(INSOLVENCY_SOURCE, "internal-analysis")).toBe(true);
  });

  it("may NOT be displayed or redistributed — never shown to a buyer", () => {
    expect(sourcePermits(INSOLVENCY_SOURCE, "display")).toBe(false);
    expect(sourcePermits(INSOLVENCY_SOURCE, "redistribute")).toBe(false);
  });
});

describe("parsing a register record", () => {
  it("reads the case, name, status and currency", () => {
    const record = parseInsolvencyRegisterRecord({
      caseNumber: "BK-2026-001",
      name: "Jane Doe",
      insolvencyType: "Bankruptcy",
      address: "9 Example Road, Leeds LS1 4DT",
      current: true,
    });
    expect(record?.caseNumber).toBe("BK-2026-001");
    expect(record?.status).toBe("bankruptcy");
    expect(record?.current).toBe(true);
  });

  it("reads currency explicitly and treats absence as not-current", () => {
    // Caution on absence, never less: a record that does not say it is current
    // is not treated as current.
    const record = parseInsolvencyRegisterRecord({ caseNumber: "1", name: "X", status: "IVA" });
    expect(record?.current).toBe(false);
    expect(record?.status).toBe("individual-voluntary-arrangement");
  });

  it("returns undefined without a case number and a name", () => {
    expect(parseInsolvencyRegisterRecord({ name: "X" })).toBeUndefined();
    expect(parseInsolvencyRegisterRecord({ caseNumber: "1" })).toBeUndefined();
    expect(parseInsolvencyRegisterRecord(null)).toBeUndefined();
  });
});

describe("confirming an insolvency for a pursued person", () => {
  const records: readonly InsolvencyRegisterRecord[] = [
    { caseNumber: "1", name: "Jane Doe", status: "bankruptcy", address: "9 Example Road, Leeds LS1 4DT", current: true },
    { caseNumber: "2", name: "John Smith", status: "debt-relief-order", address: "1 Other St, York YO1 1AA", current: false },
  ];

  it("confirms a current insolvency when name and postcode agree", () => {
    const result = confirmInsolvency("Jane Doe", records, "2026-10-21T00:00:00Z", "LS1 4DT");
    expect(result.confirmed).toBe(true);
    expect(result.status).toBe("bankruptcy");
    expect(result.provenance.inferred).toBe(false);
  });

  it("refuses to confirm on a name match at a different address", () => {
    // Two people share a name; acting on the wrong one is acting on a stranger.
    const result = confirmInsolvency("Jane Doe", records, "2026-10-21T00:00:00Z", "SW1A 1AA");
    expect(result.confirmed).toBe(false);
  });

  it("does not confirm a discharged or historical entry", () => {
    const result = confirmInsolvency("John Smith", records, "2026-10-21T00:00:00Z");
    expect(result.confirmed).toBe(false);
  });

  it("confirms with a caveat where no postcode is available to corroborate", () => {
    const result = confirmInsolvency("Jane Doe", records, "2026-10-21T00:00:00Z");
    expect(result.confirmed).toBe(true);
    expect(result.reason).toContain("not corroborated");
  });
});
