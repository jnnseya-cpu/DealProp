import type { OcdsRelease } from "@shared/domain/land/disposals";

/**
 * Staff-pilot fixtures for the Contracts Finder disposals feed — clearly
 * synthetic, never production. Stored as raw OCDS releases so the fixture path
 * runs through the exact same classifier and mapper the live connector uses.
 *
 * The set deliberately includes a NON-disposal (a services procurement) to prove
 * the classifier filters it out — the feed must never show a bin-collection
 * contract as a development site. Switched on with `DISPOSALS_FIXTURES=1`.
 */
export const DISPOSALS_FIXTURE_RELEASES: readonly OcdsRelease[] = [
  // A genuine freehold disposal, matched by the sale-of-land CPV.
  {
    ocid: "ocds-pilot-0001",
    id: "pilot-0001",
    date: "2026-10-02",
    tender: {
      id: "t-0001",
      title: "Freehold disposal of former depot, Red Lane, Coventry",
      description:
        "The Council invites offers for the freehold of a surplus 0.6 ha brownfield site with residential development potential, by informal tender.",
      value: { amount: 750000, currency: "GBP" },
      tenderPeriod: { endDate: "2026-12-15T12:00:00Z" },
      classification: { scheme: "CPV", id: "70122200", description: "Land sale services" },
      items: [{ deliveryAddresses: [{ region: "West Midlands", postalCode: "CV6 5EH" }] }],
    },
    buyer: { name: "Coventry City Council" },
  },
  // A development opportunity, matched by keyword (no sale CPV present).
  {
    ocid: "ocds-pilot-0002",
    id: "pilot-0002",
    date: "2026-10-20",
    tender: {
      id: "t-0002",
      title: "Development opportunity — surplus land at Bilston Road",
      description:
        "Development partner sought for a redevelopment opportunity on council-owned land. Conditional and unconditional offers invited.",
      tenderPeriod: { endDate: "2027-01-09T12:00:00Z" },
      classification: { scheme: "CPV", id: "70110000", description: "Development services of real estate" },
      items: [{ deliveryAddresses: [{ region: "West Midlands", postalCode: "WV2 2JH" }] }],
    },
    buyer: { name: "City of Wolverhampton Council" },
  },
  // NOT a disposal: a services procurement that must be filtered out, even
  // though it carries a real-estate CPV (estate-management services).
  {
    ocid: "ocds-pilot-0003",
    id: "pilot-0003",
    date: "2026-10-25",
    tender: {
      id: "t-0003",
      title: "Provision of grounds maintenance and estate management services",
      description: "A framework for grounds maintenance across the authority's housing estate.",
      value: { amount: 1200000, currency: "GBP" },
      classification: { scheme: "CPV", id: "70330000", description: "Property management services" },
      items: [{ deliveryAddresses: [{ region: "West Midlands", postalCode: "B1 1AA" }] }],
    },
    buyer: { name: "Birmingham City Council" },
  },
];
