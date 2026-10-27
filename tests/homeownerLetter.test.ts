import { describe, expect, it } from "vitest";
import { draftHomeownerLetter } from "@shared/domain/homeownerLetter";
import type { CompanyIdentity } from "@shared/domain/identity";

const sender: CompanyIdentity = {
  legalName: "JNN Global Ltd",
  companyNumber: "15405437",
  placeOfRegistration: "England and Wales",
  registeredOffice: "JNN Global House, Kingstanding, Birmingham, B44 8DJ",
  icoRegistration: "232345",
  contactEmail: "contact@lodeprop.com",
};

describe("the homeowner letter is addressed to the property, holds no name, and discloses honestly", () => {
  const letter = draftHomeownerLetter({
    sender,
    propertyAddress: "23 Fairford Road",
    postcode: "B44 8DJ",
    today: "2026-10-28",
  });

  it("writes to 'The Homeowner' at the property, never a named person", () => {
    expect(letter).toContain("The Homeowner");
    expect(letter).toContain("23 Fairford Road");
    expect(letter).toContain("B44 8DJ");
    expect(letter).toContain("Dear Homeowner");
  });

  it("is an enquiry, not an assertion about the reader, and is honest about agents", () => {
    expect(letter.toLowerCase()).toContain("enquiry");
    expect(letter).toContain("estate agent");
    expect(letter.toLowerCase()).toContain("speed and certainty");
  });

  it("states that selling to us is free, with no fee or commission", () => {
    expect(letter.toLowerCase()).toContain("selling to us is free to you");
    expect(letter.toLowerCase()).toContain("no commission and no fee");
  });

  it("names the sender and gives a one-line opt-out", () => {
    expect(letter).toContain("JNN Global Ltd");
    expect(letter.toLowerCase()).toContain("not write to this property again");
  });

  it("says where the property was identified from, and the lawful basis", () => {
    expect(letter).toContain("Energy Performance of Buildings Register");
    expect(letter).toContain("Price Paid Data");
    expect(letter).toContain("legitimate interest");
    expect(letter).toContain("hold no personal information about you");
    expect(letter).toContain("232345");
  });

  it("shows bracketed placeholders where a sender detail is missing", () => {
    const thin = draftHomeownerLetter({
      sender: { legalName: "JNN Global Ltd" },
      propertyAddress: "1 Example Street",
      today: "2026-10-28",
    });
    expect(thin).toContain("[registered office address]");
    expect(thin).toContain("[contact email]");
  });
});
