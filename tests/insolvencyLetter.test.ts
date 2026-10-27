import { describe, expect, it } from "vitest";
import { draftInsolvencyLetter } from "@shared/domain/insolvencyLetter";
import type { CompanyIdentity } from "@shared/domain/identity";

const sender: CompanyIdentity = {
  legalName: "JNN Global Ltd",
  companyNumber: "15405437",
  placeOfRegistration: "England and Wales",
  registeredOffice: "1 Example Street, London, EC1A 1AA",
  icoRegistration: "ZA232345",
  contactEmail: "contact@lodeprop.com",
  amlSupervision: "HMRC, registration XML00000000",
};

describe("the insolvency letter is addressed to the office-holder, never the debtor", () => {
  const letter = draftInsolvencyLetter({
    sender,
    officeHolder: "The Official Receiver, Insolvency Service, 2 Civic Centre, Leeds, LS1 4DT",
    debtorName: "Inaam Ahmed Danish",
    propertyAddress: "12 Example Terrace, Leeds, LS8 2NP",
    today: "2026-10-27",
  });

  it("writes to the trustee / Official Receiver and says so explicitly", () => {
    expect(letter).toContain("The Trustee in Bankruptcy / Official Receiver");
    expect(letter).toContain("writing to the office-holder, not to the bankrupt");
    expect(letter).toContain("The Official Receiver, Insolvency Service");
  });

  it("names the sender, the debtor as the subject, and the property", () => {
    expect(letter).toContain("JNN Global Ltd");
    expect(letter).toContain("Inaam Ahmed Danish");
    expect(letter).toContain("12 Example Terrace");
  });

  it("acknowledges the duty to obtain the best price and offers proof of funds", () => {
    expect(letter).toContain("best price reasonably obtainable");
    expect(letter).toContain("proof of funds");
    expect(letter).toContain("expression of interest, not an offer");
  });

  it("states the data source, the lawful basis and the ICO registration", () => {
    expect(letter).toContain("The Gazette");
    expect(letter).toContain("Open Government Licence");
    expect(letter).toContain("legitimate interest");
    expect(letter).toContain("right to object");
    expect(letter).toContain("ZA232345");
  });

  it("falls back to a bracketed recipient and placeholders when details are missing", () => {
    const thin = draftInsolvencyLetter({
      sender: { legalName: "JNN Global Ltd" },
      debtorName: "A Person",
      today: "2026-10-27",
    });
    expect(thin).toContain("c/o the trustee or Official Receiver named in the notice");
    expect(thin).toContain("[registered office address]");
    expect(thin).toContain("[contact email]");
  });
});
