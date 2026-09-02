import type { OpportunityClass } from "@shared/domain/pricing";
import type { PropertyFacts } from "@shared/domain/types";

/**
 * Where an opportunity came from, and whether anybody has said it is for sale.
 *
 * The platform holds three kinds of stock and they are not equivalent. A
 * property whose owner asked us to sell it is a different object from one an
 * algorithm noticed looked distressed, and the second one is worth very little
 * until somebody with authority over it says otherwise.
 *
 * The temptation is to blur them, because a catalogue of nine thousand
 * AI-discovered addresses looks like a marketplace and a catalogue of forty
 * owner-verified ones looks like a start-up. Blurring them is the single most
 * damaging thing this platform could do: a buyer who pays to unlock an
 * "opportunity" and finds an owner who never agreed to sell has been sold
 * nothing, and they only find that out after paying. They tell people.
 *
 * So the category is carried with the opportunity everywhere it goes, the
 * label is never softened, and — the part that is structural rather than
 * editorial — an unconfirmed opportunity cannot be charged for at all.
 */

export type InventoryCategory = "owner-verified" | "agent-authorised" | "ai-discovered";

/** Who said the property is actually available. */
export type ConfirmedBy = "owner" | "instructed-agent";

/**
 * A statement, by somebody with authority over the property, that it is for
 * sale.
 *
 * Absent means nobody has said so — which is the normal state of a discovered
 * property and is not a defect. It becomes a defect only when the category
 * claims otherwise.
 */
export interface SaleConfirmation {
  readonly by: ConfirmedBy;
  /** ISO-8601. */
  readonly at: string;
  /** The named person on our side who took the confirmation. */
  readonly recordedBy: string;
  /** How it was given, in the words used, kept as the evidence. */
  readonly evidence: string;
}

export interface InventoryItem {
  readonly category: InventoryCategory;
  readonly confirmation?: SaleConfirmation;
}

export interface CategoryDefinition {
  readonly category: InventoryCategory;
  readonly label: string;
  /**
   * The sentence shown to a buyer, verbatim, on every surface the opportunity
   * appears on. Not a tooltip and not a footnote.
   */
  readonly disclosure: string;
  /** Who must have confirmed the sale for the category to be honest. */
  readonly requiresConfirmationBy?: ConfirmedBy;
}

export const CATEGORIES: readonly CategoryDefinition[] = [
  {
    category: "owner-verified",
    label: "Owner-verified",
    disclosure:
      "The owner has confirmed to us that this property is for sale and has agreed to be contacted about it.",
    requiresConfirmationBy: "owner",
  },
  {
    category: "agent-authorised",
    label: "Agent-authorised",
    disclosure:
      "The instructed agent has authorised this property to be offered here on the owner's behalf.",
    requiresConfirmationBy: "instructed-agent",
  },
  {
    category: "ai-discovered",
    label: "AI-discovered — not yet confirmed",
    // Deliberately blunt, and deliberately the same sentence everywhere. A
    // buyer reading it should be in no doubt that nobody has said this is for
    // sale, because nobody has.
    disclosure:
      "Identified from licensed public data as possibly available. Nobody connected to the property has confirmed it is for sale, and it may not be.",
  },
];

export function categoryDefinition(category: InventoryCategory): CategoryDefinition {
  const found = CATEGORIES.find((c) => c.category === category);
  if (found === undefined) throw new Error(`No category definition for "${category}".`);
  return found;
}

/**
 * Whether the category an item is filed under matches what is actually known
 * about it.
 *
 * Returns the reason it does not, so a page and an operator screen say the
 * same thing. Honest is the common case; the point of the check is that
 * mislabelling has to be impossible to do quietly.
 */
export function categoryDefect(item: InventoryItem): string | undefined {
  const definition = categoryDefinition(item.category);

  if (definition.requiresConfirmationBy === undefined) {
    // Discovered stock with a confirmation against it is not a defect in the
    // dangerous direction, but it is still wrong: it is under-claiming, the
    // buyer is being told less than is true, and the opportunity is being
    // priced as if nobody had spoken to anybody.
    return item.confirmation === undefined
      ? undefined
      : `Filed as ${definition.label.toLowerCase()} but the ${item.confirmation.by === "owner" ? "owner" : "instructed agent"} has confirmed the sale. Reclassify it.`;
  }

  if (item.confirmation === undefined) {
    return `Filed as ${definition.label.toLowerCase()} with no confirmation recorded. Nobody has said this property is for sale.`;
  }

  if (item.confirmation.by !== definition.requiresConfirmationBy) {
    return `Filed as ${definition.label.toLowerCase()} but the confirmation came from the ${
      item.confirmation.by === "owner" ? "owner" : "instructed agent"
    }.`;
  }

  return undefined;
}

/**
 * True where somebody with authority over the property has said it is for
 * sale.
 *
 * This, and not the category, is what money hangs off. A category is a label
 * and labels can be wrong; a recorded confirmation is a fact with a name and a
 * date against it.
 */
export function saleIsConfirmed(item: InventoryItem | undefined): boolean {
  if (item === undefined) return false;
  if (categoryDefect(item) !== undefined) return false;
  return item.confirmation !== undefined;
}

/**
 * What kind of opportunity this is, for pricing.
 *
 * Derived from the property rather than chosen, so two identical properties
 * cannot be priced differently by whoever happened to enter them. Ordered from
 * the most specific test to the least: a vacant HMO is an HMO, because the
 * verification work is what the class is really describing.
 */
export function classifyOpportunity(
  property: PropertyFacts,
  item: InventoryItem | undefined,
): OpportunityClass {
  switch (property.propertyType) {
    case "land":
      return "land";
    case "commercial":
      return "commercial";
    case "mixed-use":
    case "hmo":
      return "hmo-mixed-use";
    default:
      break;
  }

  if (property.occupancy === "vacant") return "vacant-refurbishment";

  // An owner-verified opportunity is a different product from a discovered
  // one: the introduction is to somebody who has agreed to be introduced.
  if (item?.category === "owner-verified" && saleIsConfirmed(item)) return "owner-verified";

  return "standard-residential";
}
