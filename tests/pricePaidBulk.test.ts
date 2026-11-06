import { describe, expect, it } from "vitest";
import { fromMajor } from "@shared/money";
import {
  DEFAULT_LOAD_AREAS,
  inAreas,
  parseBulkRow,
  postcodeArea,
} from "@backend/sources/pricePaidBulk";

/**
 * The streaming bulk parser that the Price Paid loader runs line by line. It
 * must agree with `parsePricePaid` on the fields they share and add the two the
 * bulk feed needs: the transaction id (the dedup key) and the record-status
 * deletion rule.
 */

const GUID = "{AA11BB22-CC33-DD44-EE55-FF6677889900}";

/** A fully quoted 16-column Price Paid row, as the published file writes them. */
function row(over: Partial<Record<number, string>> = {}): string {
  const cols = [
    GUID, // 0 transaction id
    "250000", // 1 price
    "2024-03-15 00:00", // 2 date of transfer
    "B23 5AB", // 3 postcode
    "T", // 4 property type
    "N", // 5 old/new
    "F", // 6 duration/tenure
    "14", // 7 PAON
    "", // 8 SAON
    "ACACIA ROAD", // 9 street
    "ERDINGTON", // 10 locality
    "BIRMINGHAM", // 11 town
    "BIRMINGHAM", // 12 district
    "WEST MIDLANDS", // 13 county
    "A", // 14 PPD category
    "A", // 15 record status
  ];
  for (const [i, v] of Object.entries(over)) if (v !== undefined) cols[Number(i)] = v;
  return cols.map((c) => `"${c}"`).join(",");
}

describe("parseBulkRow", () => {
  it("parses a standard arm's-length sale, keeping the transaction id", () => {
    const sale = parseBulkRow(row());
    expect(sale).toBeDefined();
    expect(sale!.transactionId).toBe(GUID);
    expect(sale!.price).toBe(fromMajor(250_000));
    expect(sale!.soldAt).toBe("2024-03-15");
    expect(sale!.postcode).toBe("B23 5AB");
    expect(sale!.propertyType).toBe("T");
    expect(sale!.tenure).toBe("F");
    expect(sale!.paon).toBe("14");
    expect(sale!.street).toBe("ACACIA ROAD");
    expect(sale!.category).toBe("A");
    expect(sale!.newBuild).toBe(false);
  });

  it("keeps a category B (non-arm's-length) sale, labelled as such", () => {
    expect(parseBulkRow(row({ 14: "B" }))!.category).toBe("B");
  });

  it("marks a new build", () => {
    expect(parseBulkRow(row({ 5: "Y" }))!.newBuild).toBe(true);
  });

  it("drops a deletion (record status D) — it is not a sale", () => {
    expect(parseBulkRow(row({ 15: "D" }))).toBeUndefined();
  });

  it("parses a change (record status C) like any row", () => {
    expect(parseBulkRow(row({ 15: "C" }))).toBeDefined();
  });

  it("refuses a row with no price, no date, or no transaction id", () => {
    expect(parseBulkRow(row({ 1: "0" }))).toBeUndefined();
    expect(parseBulkRow(row({ 1: "" }))).toBeUndefined();
    expect(parseBulkRow(row({ 2: "" }))).toBeUndefined();
    expect(parseBulkRow(row({ 0: "" }))).toBeUndefined();
  });

  it("refuses a row with an unknown PPD category rather than guessing", () => {
    expect(parseBulkRow(row({ 14: "X" }))).toBeUndefined();
  });

  it("skips a blank or truncated line without throwing", () => {
    expect(parseBulkRow("")).toBeUndefined();
    expect(parseBulkRow('"a","1","2024-01-01"')).toBeUndefined();
  });
});

describe("postcodeArea and inAreas", () => {
  it("reads the alphabetic area off the postcode", () => {
    expect(postcodeArea("B23 5AB")).toBe("B");
    expect(postcodeArea("CV1 2AB")).toBe("CV");
    expect(postcodeArea("dy4 7aa")).toBe("DY");
    expect(postcodeArea("")).toBe("");
  });

  it("keeps a postcode only when its area is configured", () => {
    expect(inAreas("B23 5AB", ["B", "CV"])).toBe(true);
    expect(inAreas("L1 1AA", ["B", "CV"])).toBe(false);
    // An empty area list is no filter at all.
    expect(inAreas("L1 1AA", [])).toBe(true);
  });

  it("ships the West Midlands launch region as the default", () => {
    expect([...DEFAULT_LOAD_AREAS]).toEqual(["B", "CV", "DY", "WS", "WV"]);
  });
});
