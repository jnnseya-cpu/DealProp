import { describe, expect, it } from "vitest";
import { registerFromOfficialCopy, titleNumbersFrom } from "@backend/sources/landRegistryTitle";
import { parseProprietors } from "@backend/discovery/owners";

describe("the official-copy register maps to the proprietor view owners.ts reads", () => {
  it("reads name, address for service and company number, tolerant of key spellings", () => {
    const view = registerFromOfficialCopy({
      register: {
        proprietorship: [
          { name: "Jane Doe", addressForService: "2 High Street, Leeds, LS1 1AA" },
          { proprietorName: "Acme Developments Ltd", correspondenceAddress: "1 Trade Park, B1 1AA", companyRegistrationNumber: "07654321" },
        ],
      },
    });
    expect(view.proprietors).toHaveLength(2);
    expect(view.proprietors[0]?.name).toBe("Jane Doe");
    expect(view.proprietors[0]?.addressForService).toBe("2 High Street, Leeds, LS1 1AA");
    expect(view.proprietors[1]?.companyNumber).toBe("07654321");
  });

  it("never invents an address: a proprietor with none stays without one", () => {
    const view = registerFromOfficialCopy({ proprietors: [{ name: "No Address Person" }] });
    expect(view.proprietors[0]?.addressForService).toBeUndefined();
  });

  it("returns an empty view for a body that is not a register", () => {
    expect(registerFromOfficialCopy("nope").proprietors).toEqual([]);
    expect(registerFromOfficialCopy({}).proprietors).toEqual([]);
    expect(registerFromOfficialCopy(null).proprietors).toEqual([]);
  });

  it("feeds owners.ts parseProprietors cleanly (the handoff lookupOwner makes)", () => {
    const view = registerFromOfficialCopy({ proprietors: [{ name: "Jane Doe", address: "2 High Street, LS1 1AA" }] });
    const proprietors = parseProprietors(view);
    expect(proprietors[0]?.name).toBe("Jane Doe");
    expect(proprietors[0]?.addressForService).toBe("2 High Street, LS1 1AA");
    // Not a company, so the outreach gate will route it to a letter.
    expect(proprietors[0]?.recipientType).not.toBe("limited-company");
  });
});

describe("the property-description search yields title numbers", () => {
  it("reads strings or objects, de-duplicated", () => {
    expect(titleNumbersFrom({ titles: ["WM123456", "WM123456"] })).toEqual(["WM123456"]);
    expect(titleNumbersFrom({ results: [{ titleNumber: "LT987654" }, { title_number: "AB111" }] })).toEqual([
      "LT987654",
      "AB111",
    ]);
  });

  it("returns nothing for a body that carries no titles", () => {
    expect(titleNumbersFrom("nope")).toEqual([]);
    expect(titleNumbersFrom({})).toEqual([]);
  });
});
