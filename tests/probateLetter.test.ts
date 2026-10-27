import { describe, expect, it } from "vitest";
import { draftProbateLetter } from "@shared/domain/probateLetter";
import type { CompanyIdentity } from "@shared/domain/identity";

const sender: CompanyIdentity = {
  legalName: "JNN Global Ltd",
  companyNumber: "15405437",
  placeOfRegistration: "England and Wales",
  registeredOffice: "1 Example Street, London, EC1A 1AA",
  icoRegistration: "ZA232345",
  contactEmail: "contact@lodeprop.com",
  redressScheme: "The Property Ombudsman, membership T01234",
};

describe("the probate letter carries everything a lawful postal approach needs", () => {
  const letter = draftProbateLetter({
    sender,
    recipientContact: "Messrs Example & Co Solicitors, 2 High Street, Nottingham, NG1 1AA",
    deceasedName: "Kevin Drew",
    propertyAddress: "29 Coach Drive, Nottingham, NG16 3DR",
    claimDeadline: "2026-12-27",
    today: "2026-10-26",
  });

  it("names the sender, the deceased, the property and the recipient", () => {
    expect(letter).toContain("JNN Global Ltd");
    expect(letter).toContain("Kevin Drew");
    expect(letter).toContain("29 Coach Drive");
    expect(letter).toContain("Messrs Example & Co");
  });

  it("states how the data was obtained and the lawful basis", () => {
    expect(letter).toContain("The Gazette");
    expect(letter).toContain("Open Government Licence");
    expect(letter).toContain("legitimate interest");
  });

  it("gives the right to object, a one-line opt-out, and the ICO registration", () => {
    expect(letter).toContain("right to object");
    expect(letter.toLowerCase()).toContain("did not write again");
    expect(letter).toContain("ZA232345");
  });

  it("states there is nothing for the estate to pay us", () => {
    expect(letter).toContain("nothing for the estate to pay us");
    expect(letter.toLowerCase()).toContain("no commission");
  });

  it("steers the reader to independent advice and more than one valuation", () => {
    expect(letter).toContain("independent advice");
    expect(letter).toContain("more than one valuation");
    expect(letter).toContain("estate agent");
  });

  it("writes the claim deadline in long form", () => {
    expect(letter).toContain("27 December 2026");
  });

  it("shows a bracketed placeholder where a sender detail is missing", () => {
    const thin = draftProbateLetter({
      sender: { legalName: "JNN Global Ltd" },
      deceasedName: "A Person",
      today: "2026-10-26",
    });
    expect(thin).toContain("[registered office address]");
    expect(thin).toContain("[contact email]");
  });
});
