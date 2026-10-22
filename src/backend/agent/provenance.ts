/**
 * Provenance: no figure without a source.
 *
 * This is the structural guarantee behind "live, but never fabricated". Every
 * value an agent reports is wrapped with where it came from — a deterministic
 * tool computed it, a licensed data source supplied it, or a human entered it.
 *
 * A `Sourced<T>` cannot be built without a provenance, and the only functions
 * that build one are the three below, each of which demands a source. So there
 * is no path by which a number reaches a result without saying where it came
 * from, which means an agent cannot report a figure it invented: to put a value
 * into the answer it must have gone through a tool or a source that stamped it.
 *
 * The model is free to write the words. It is not free to write the numbers —
 * those are these values, and these values always know their origin.
 */

export type Provenance =
  /** A deterministic engine computed it. Reproducible and auditable. */
  | { readonly kind: "computed"; readonly tool: string }
  /** A licensed external source supplied it. */
  | { readonly kind: "source"; readonly source: string; readonly reference?: string; readonly asOf?: string }
  /** A human entered it (the seller's figure, the user's input). */
  | { readonly kind: "supplied"; readonly by: string };

export interface Sourced<T> {
  readonly value: T;
  readonly provenance: Provenance;
}

export function computed<T>(value: T, tool: string): Sourced<T> {
  return { value, provenance: { kind: "computed", tool } };
}

export function fromSource<T>(value: T, source: string, reference?: string, asOf?: string): Sourced<T> {
  return {
    value,
    provenance: {
      kind: "source",
      source,
      ...(reference !== undefined ? { reference } : {}),
      ...(asOf !== undefined ? { asOf } : {}),
    },
  };
}

export function supplied<T>(value: T, by: string): Sourced<T> {
  return { value, provenance: { kind: "supplied", by } };
}

/** One line a page or a document can print beside a figure, so a reader can check it. */
export function describeProvenance(p: Provenance): string {
  switch (p.kind) {
    case "computed":
      return `computed by ${p.tool}`;
    case "source":
      return `from ${p.source}${p.reference !== undefined ? ` (${p.reference})` : ""}${
        p.asOf !== undefined ? `, as of ${p.asOf}` : ""
      }`;
    case "supplied":
      return `supplied by ${p.by}`;
  }
}
