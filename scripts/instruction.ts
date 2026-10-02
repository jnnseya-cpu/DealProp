import { buildSellerRoutes } from "@shared/domain/sellerRoutes";
import { allSituations } from "@shared/domain/motivation";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import { fromMajor, pct } from "@shared/money";
import { gbp } from "@shared/format";
import type {
  JurisdictionCode,
  OccupancyStatus,
  PropertyFacts,
  SellerPriority,
  SellerProfile,
  SellerSituation,
  Tenure,
} from "@shared/domain/types";

/**
 * What an estate agent's unsellable instruction is actually worth, costed.
 *
 * This is an instrument for a field test, not a product surface. The question
 * it answers is the one an agent asks in a meeting — "what would my client
 * get?" — and there was no way to answer it in under two minutes.
 *
 * `/sell` is the seller's own journey and asks the vulnerability screening
 * questions, which an agent cannot answer on their client's behalf and should
 * not try to. Running it on their behalf produces a protection pause, which is
 * the correct behaviour and a useless demonstration. `/appraise` answers the
 * buyer's question, not the seller's.
 *
 * `buildSellerRoutes()` needs only the property and the situation — screening
 * is optional and the route engine never reads it — so everything needed is
 * what an agent already has on their listing.
 *
 * Deliberately a CLI. It stays off the web, it needs no authorisation surface
 * of its own, and it cannot be mistaken for an offer by anybody who finds a
 * URL. Nothing is written to the store: this computes and prints.
 *
 *   npm run instruction -- --omv 212000 --works 34000 --situation probate \
 *     --area B23 --locality Erdington --beds 3
 */

interface Options {
  readonly omv: number;
  readonly works: number;
  readonly situation: SellerSituation;
  readonly priorities: readonly SellerPriority[];
  readonly area: string;
  readonly locality: string;
  readonly beds: number;
  readonly tenure: Tenure;
  readonly occupancy: OccupancyStatus;
  readonly jurisdiction: JurisdictionCode;
  readonly rent: number;
  readonly asking?: number;
  readonly days?: number;
}

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function number(name: string, fallback?: number): number {
  const raw = arg(name);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} is required`);
  }
  // Agents read figures off a listing, where they carry commas and a pound sign.
  const parsed = Number(raw.replace(/[£,\s]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`--${name} is not a number: ${raw}`);
  return parsed;
}

function options(): Options {
  const situation = (arg("situation") ?? "failed-listing") as SellerSituation;
  if (!allSituations().includes(situation)) {
    throw new Error(`--situation must be one of: ${allSituations().join(", ")}`);
  }

  const priorities = (arg("priorities") ?? "speed,certainty")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean) as SellerPriority[];

  const omv = number("omv");
  return {
    omv,
    works: number("works", Math.round(omv * 0.08)),
    situation,
    priorities,
    area: arg("area") ?? "B1",
    locality: arg("locality") ?? "Birmingham",
    beds: number("beds", 3),
    tenure: (arg("tenure") ?? "freehold") as Tenure,
    occupancy: (arg("occupancy") ?? "vacant") as OccupancyStatus,
    jurisdiction: (arg("jurisdiction") ?? "GB-ENG") as JurisdictionCode,
    // Only used by the rent-based routes. A rough yield assumption beats
    // leaving it at zero, which makes a hold route look impossible.
    rent: number("rent", Math.round((omv * 0.05) / 12)),
    ...(arg("asking") === undefined ? {} : { asking: number("asking") }),
    ...(arg("days") === undefined ? {} : { days: number("days") }),
  };
}

function main(): void {
  const o = options();
  const pack = getJurisdiction(o.jurisdiction);

  const property: PropertyFacts = {
    id: "instruction",
    jurisdiction: o.jurisdiction,
    postcodeArea: o.area,
    locality: o.locality,
    propertyType: "house",
    tenure: o.tenure,
    bedrooms: o.beds,
    occupancy: o.occupancy,
    openMarketValue: fromMajor(o.omv),
    // An agent's own figure, from a property they have stood in and failed to
    // sell, is better evidence than a desktop estimate. It is still a claim,
    // which is what the confidence figure on the output says.
    valuationConfidence: pct(75),
    refurbishmentEstimate: fromMajor(o.works),
    postWorksValue: fromMajor(Math.round(o.omv + o.works * 1.6)),
    monthlyRent: fromMajor(o.rent),
    knownIssues: [],
  };

  const seller: SellerProfile = {
    situation: o.situation,
    priorities: o.priorities,
    ...(o.days === undefined ? {} : { targetDays: o.days }),
  };

  const report = buildSellerRoutes(property, seller);

  const head = `${o.beds}-bed ${o.tenure} in ${o.locality} ${o.area} · ${pack.name}`;
  process.stdout.write(`\n${head}\n${"=".repeat(head.length)}\n\n`);
  process.stdout.write(`Agent's market value   ${gbp(fromMajor(o.omv))}\n`);
  process.stdout.write(`Works assumed          ${gbp(fromMajor(o.works))}\n`);
  if (o.asking !== undefined) {
    process.stdout.write(`Currently asking       ${gbp(fromMajor(o.asking))}\n`);
  }
  process.stdout.write(`Situation              ${o.situation}\n`);
  process.stdout.write(`Priorities             ${o.priorities.join(", ")}\n\n`);
  process.stdout.write(`${report.summary}\n\n`);

  for (const route of report.routes) {
    const fit = `fit ${route.fit}/100`;
    process.stdout.write(`${route.label}\n`);
    process.stdout.write(
      `  To the seller   ${gbp(route.totalToSeller)}${
        route.deferred > fromMajor(0) ? `  (${gbp(route.upfront)} on completion, ${gbp(route.deferred)} later)` : ""
      }\n`,
    );
    process.stdout.write(
      `  Timescale       ${route.completionDaysMin}-${route.completionDaysMax} days, ${route.certainty} certainty, ${fit}\n`,
    );
    process.stdout.write(`  ${route.summary}\n`);
    // Printed, always. A figure without what it costs the seller is the thing
    // every cash-buying company sends and the reason none of them is believed.
    for (const trade of route.tradeOffs) process.stdout.write(`  - ${trade}\n`);
    process.stdout.write("\n");
  }

  if (report.unavailable.length > 0) {
    process.stdout.write("Not available on these figures\n");
    for (const route of report.unavailable) {
      process.stdout.write(`  ${route.label} — ${route.unavailableReason ?? "no reason recorded"}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(
    "These are screening estimates from the agent's own value and an assumed works\n" +
      "figure. No valuation and no builder's estimate exists. Every number moves once\n" +
      "both do, and any offer to the client would be subject to them. Nothing here is\n" +
      "an offer, and the client's own vulnerability screening has not been done — that\n" +
      "happens on their own journey, with their consent, not on their agent's word.\n",
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`);
  process.stderr.write(
    "Usage: npm run instruction -- --omv 212000 [--works 34000] [--situation probate]\n" +
      "       [--area B23] [--locality Erdington] [--beds 3] [--tenure freehold]\n" +
      "       [--occupancy vacant] [--rent 1250] [--asking 215000] [--days 60]\n" +
      "       [--priorities speed,certainty]\n",
  );
  process.exit(1);
}
