import { describe, expect, it } from "vitest";
import {
  availableSources,
  independentFamilies,
  isStale,
  reconcileBatch,
  reconcileObservation,
  sourceAvailability,
  sourceVersionKey,
  type Observation,
  type SourceRegistryEntry,
} from "@shared/domain/trend/sources";

const base = (over: Partial<SourceRegistryEntry>): SourceRegistryEntry => ({
  sourceId: "src_a",
  family: "first_party_events",
  accessPath: "public_keyless",
  owner: "tenant",
  termsVersion: "v1",
  permittedUses: ["detection"],
  territories: ["CA"],
  locales: ["en-CA"],
  cadenceMinutes: 60,
  ingestionLagMinutes: 5,
  staleAfterMinutes: 1440,
  quality: 90,
  ...over,
});

const obs = (over: Partial<Observation>): Observation => ({
  tenantScope: "inst_a",
  sourceId: "src_a",
  sourceFamily: "first_party_events",
  sourceRecordId: "rec_1",
  observedAt: "2026-11-10T10:00:00Z",
  windowStart: "2026-11-10T09:00:00Z",
  windowEnd: "2026-11-10T10:00:00Z",
  ingestedAt: "2026-11-10T10:05:00Z",
  geography: "CA",
  locale: "en-CA",
  segment: "all",
  metric: "search_count",
  value: 42,
  unit: "count",
  scalingScope: "tenant",
  coverage: 1,
  evidenceUri: "s3://ev/1",
  evidenceHash: "hash-1",
  termsVersion: "v1",
  ...over,
});

describe("sourceAvailability (§2/§3, TI-22)", () => {
  it("public_keyless is always available", () => {
    expect(sourceAvailability(base({ accessPath: "public_keyless" }), { authorisedIntegrations: [] }).available).toBe(true);
  });

  it("file_import is always available", () => {
    expect(sourceAvailability(base({ accessPath: "file_import" }), { authorisedIntegrations: [] }).available).toBe(true);
  });

  it("host_mediated is unavailable without an authorised host integration — never prompts for a key", () => {
    const r = sourceAvailability(base({ sourceId: "gsc", accessPath: "host_mediated" }), { authorisedIntegrations: [] });
    expect(r.available).toBe(false);
    expect(r.reason).toContain("unavailable");
  });

  it("host_mediated becomes available once the host authorises it", () => {
    const r = sourceAvailability(base({ sourceId: "gsc", accessPath: "host_mediated" }), { authorisedIntegrations: ["gsc"] });
    expect(r.available).toBe(true);
  });

  it("availableSources filters to the keyless/authorised set (TI-20)", () => {
    const registry = [
      base({ sourceId: "first_party", accessPath: "public_keyless" }),
      base({ sourceId: "gsc", accessPath: "host_mediated" }),
      base({ sourceId: "csv", accessPath: "file_import" }),
    ];
    const got = availableSources(registry, { authorisedIntegrations: [] }).map((e) => e.sourceId);
    expect(got).toEqual(["first_party", "csv"]);
  });
});

describe("isStale (§3)", () => {
  it("fresh within the stale window", () => {
    expect(isStale(base({ staleAfterMinutes: 1440 }), "2026-11-10T10:00:00Z", new Date("2026-11-10T20:00:00Z"))).toBe(false);
  });
  it("stale beyond it", () => {
    expect(isStale(base({ staleAfterMinutes: 60 }), "2026-11-10T10:00:00Z", new Date("2026-11-10T20:00:00Z"))).toBe(true);
  });
});

describe("reconcileObservation (TI-01)", () => {
  it("accepts a new observation", () => {
    expect(reconcileObservation(obs({}), undefined).status).toBe("accepted");
  });
  it("treats an exact replay as a duplicate", () => {
    expect(reconcileObservation(obs({ evidenceHash: "hash-1" }), "hash-1").status).toBe("duplicate");
  });
  it("treats a changed hash on the same version as a conflict (409)", () => {
    expect(reconcileObservation(obs({ evidenceHash: "hash-2" }), "hash-1").status).toBe("conflict");
  });
  it("scopes the version key by tenant", () => {
    expect(sourceVersionKey(obs({ tenantScope: "inst_a" }))).not.toBe(sourceVersionKey(obs({ tenantScope: "inst_b" })));
  });
});

describe("reconcileBatch (§16, TI-01)", () => {
  it("counts accepted, duplicate, conflict and rejected", () => {
    const known = new Map<string, string>();
    known.set(sourceVersionKey(obs({ sourceRecordId: "rec_existing" })), "hash-old");
    const batch = [
      obs({ sourceRecordId: "rec_new" }), // accepted
      obs({ sourceRecordId: "rec_new" }), // duplicate (seen in-batch)
      obs({ sourceRecordId: "rec_existing", evidenceHash: "hash-changed" }), // conflict
      obs({ sourceId: "unknown_src" }), // rejected
    ];
    const result = reconcileBatch(batch, known, (id) => id !== "unknown_src");
    expect(result.counts).toEqual({ accepted: 1, duplicate: 1, conflict: 1, rejected: 1 });
  });
});

describe("independentFamilies (§3, TI-04)", () => {
  it("collapses four syndications of one story to a single family", () => {
    const registry = [base({ sourceId: "news", family: "context_feed" })];
    const four = [1, 2, 3, 4].map((n) =>
      obs({ sourceId: "news", sourceFamily: "context_feed", sourceRecordId: `mirror_${n}`, syndicationGroup: "story_x" }),
    );
    expect(independentFamilies(four, registry)).toBe(1);
  });

  it("counts two genuinely independent families", () => {
    const registry = [
      base({ sourceId: "fp", family: "first_party_events" }),
      base({ sourceId: "crm", family: "crm_support" }),
    ];
    const set = [
      obs({ sourceId: "fp", sourceFamily: "first_party_events" }),
      obs({ sourceId: "crm", sourceFamily: "crm_support" }),
    ];
    expect(independentFamilies(set, registry)).toBe(2);
  });

  it("excludes a context-only family from corroboration", () => {
    const registry = [
      base({ sourceId: "fp", family: "first_party_events" }),
      base({ sourceId: "views", family: "context_feed", contextOnly: true }),
    ];
    const set = [
      obs({ sourceId: "fp", sourceFamily: "first_party_events" }),
      obs({ sourceId: "views", sourceFamily: "context_feed" }),
    ];
    expect(independentFamilies(set, registry)).toBe(1);
  });
});
