import { describe, expect, it } from "vitest";
import { channelFor, lookupOwner, parseProprietors } from "@backend/discovery/owners";

/**
 * Finding an owner, and how they may be approached.
 *
 * The refusals are the point again: the difference between a lookup and a
 * harvest is not visible from a single request, so it is the record attached to
 * each one that tells them apart.
 */

const REGISTER = {
  proprietors: [
    { name: "Jane Smith", addressForService: "12 Elsewhere Road, Birmingham B1 1AA" },
    { name: "Example Holdings Limited", companyNumber: "01234567", addressForService: "1 Corporate Way" },
  ],
};

const request = {
  titleNumber: "WM123456",
  purpose: "pursuing-acquisition" as const,
  dealId: "deal-1",
  requestedBy: "ops@example.com",
};

describe("reading a register", () => {
  it("takes each proprietor as stated", async () => {
    const result = await lookupOwner(request, async () => REGISTER);
    expect(result.ok).toBe(true);
    expect(result.proprietors).toHaveLength(2);
    expect(result.proprietors[0]?.name).toBe("Jane Smith");
  });

  it("classifies a company as a company and a person as a person", async () => {
    const result = await lookupOwner(request, async () => REGISTER);
    expect(result.proprietors[0]?.recipientType).toBe("unknown");
    expect(result.proprietors[1]?.recipientType).toBe("limited-company");
  });

  it("never guesses an address for service", () => {
    // The address for service is frequently not the property, which is the
    // whole reason the register records it separately.
    const parsed = parseProprietors({ proprietors: [{ name: "Jane Smith" }] });
    expect(parsed[0]?.addressForService).toBeUndefined();
  });

  it("assumes nothing from an empty register", async () => {
    const result = await lookupOwner(request, async () => ({ proprietors: [] }));
    expect(result.ok).toBe(true);
    expect(result.reason).toContain("Nothing is assumed");
  });
});

describe("what a lookup must carry", () => {
  it("refuses a lookup with no deal behind it", async () => {
    // A register bought with no transaction behind it is collection, not
    // conveyancing, and only the record tells them apart.
    let read = false;
    const result = await lookupOwner({ ...request, dealId: "" }, async () => {
      read = true;
      return REGISTER;
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("collection rather than conveyancing");
    expect(read).toBe(false);
  });

  it("refuses a lookup with no named person behind it", async () => {
    const result = await lookupOwner({ ...request, requestedBy: "" }, async () => REGISTER);
    expect(result.ok).toBe(false);
  });

  it("refuses anything that is not a title number, without reading", async () => {
    let read = false;
    const result = await lookupOwner({ ...request, titleNumber: "B23 6TT" }, async () => {
      read = true;
      return REGISTER;
    });
    expect(result.ok).toBe(false);
    expect(read).toBe(false);
  });

  it("records the purpose on every result", async () => {
    const result = await lookupOwner(request, async () => REGISTER);
    expect(result.purpose).toBe("pursuing-acquisition");
    expect(result.observedAt).not.toBe("");
  });

  it("survives a register that cannot be read", async () => {
    const result = await lookupOwner(request, async () => {
      throw new Error("register unavailable");
    });
    expect(result.ok).toBe(false);
    expect(result.proprietors).toEqual([]);
  });
});

describe("how an owner may be approached", () => {
  it("allows email to a corporate proprietor", () => {
    const decision = channelFor({
      name: "Example Holdings Limited",
      recipientType: "limited-company",
      addressForService: "1 Corporate Way",
    });
    expect(decision.channel).toBe("email");
  });

  it("requires a letter to a named individual, not an email", () => {
    // PECR reg. 22 has no workaround. The approach is lawful; the channel is
    // not a matter of preference.
    const decision = channelFor({
      name: "Jane Smith",
      recipientType: "unknown",
      addressForService: "12 Elsewhere Road",
    });
    expect(decision.channel).toBe("letter");
    expect(decision.reason).toContain("PECR reg. 22");
    expect(decision.requirements.join(" ")).toContain("Mailing Preference Service");
  });

  it("refuses entirely where an individual has no address on the register", () => {
    // Writing to the property instead tells a stranger about somebody else's
    // house.
    const decision = channelFor({ name: "Jane Smith", recipientType: "individual" });
    expect(decision.channel).toBe("none");
    expect(decision.reason).toContain("Nothing is guessed");
  });

  it("requires a privacy notice and a suppression check on every letter", () => {
    const decision = channelFor({
      name: "Jane Smith",
      recipientType: "individual",
      addressForService: "12 Elsewhere Road",
    });
    expect(decision.requirements.join(" ")).toContain("privacy notice");
    expect(decision.requirements.join(" ")).toContain("suppression list");
  });
});
