/**
 * Where a deal came from.
 *
 * A deal can enter the pipeline three ways and none of them is an operator
 * typing an address into a form: a seller submits one through the public sell
 * form (no account needed), an operator starts one from a sourced register
 * lead, or it is demonstration data. "Why is this here, I didn't add it" is a
 * reasonable question, and the answer should be on the deal rather than inferred
 * from a reference nobody can read.
 *
 * Recorded at creation going forward. For deals created before it was recorded,
 * `dealOriginLabel` derives a best-effort answer from two things it can trust —
 * the id prefix, which the creation paths set deterministically (`enq-` for a
 * sell submission, `deal-` for a sourced lead), and the seller narrative, which
 * the sourcing path stamps with "Started from …". It never invents an origin it
 * cannot support; where it genuinely cannot tell, it says so.
 */

export type DealOriginVia = "sell" | "sourcing" | "operator" | "seed";

export interface DealOrigin {
  readonly via: DealOriginVia;
  /** A short human detail — e.g. the lead signal a sourced deal came from. */
  readonly note?: string;
  /** ISO-8601, when the deal was created. */
  readonly at?: string;
}

export function dealOriginLabel(input: {
  readonly origin?: DealOrigin;
  readonly id?: string;
  readonly narrative?: string;
}): string {
  const o = input.origin;
  if (o !== undefined) {
    switch (o.via) {
      case "sell":
        return "Submitted by the owner through the public sell form — no account needed.";
      case "sourcing":
        return `Started by an operator from a sourced register lead${o.note !== undefined && o.note !== "" ? ` (${o.note.replace(/-/g, " ")})` : ""}.`;
      case "operator":
        return "Created directly by an operator.";
      case "seed":
        return "Demonstration data that ships with the platform, not a real submission.";
    }
  }

  // Legacy: recorded before origin was tracked. Derive from what is reliable.
  const id = input.id ?? "";
  if (id.startsWith("enq-")) {
    return "Submitted by the owner through the public sell form — no account needed. (Derived from the record.)";
  }
  if (id.startsWith("deal-")) {
    const marker = /started from[^.]*\./i.exec(input.narrative ?? "")?.[0];
    return marker !== undefined
      ? `${marker} (Derived from the record.)`
      : "Started by an operator from a sourced register lead. (Derived from the record.)";
  }
  return "Origin not separately recorded for this deal.";
}
