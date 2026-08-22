import Link from "next/link";
import { GLOSSARY, type Block, type GlossaryTerm } from "@shared/domain/blog";

/**
 * Rendering a post body, with glossary terms linked automatically.
 *
 * This is where "many hyperlinks" actually comes from. Every load-bearing term
 * the body uses becomes a link to its definition, computed at render time, so a
 * renamed slug cannot leave a dead link behind and nobody has to remember to
 * add one. Internal linking is most of what on-page SEO is, and it is the part
 * that decays fastest when it is typed by hand.
 *
 * Only the first mention in a given block is linked. Linking every occurrence
 * turns a paragraph into a wall of blue and reads as keyword stuffing to a
 * person and to a crawler alike.
 */

interface Match {
  readonly start: number;
  readonly end: number;
  readonly term: GlossaryTerm;
}

/** All non-overlapping term matches in a string, earliest and longest first. */
function findTerms(text: string, exclude: ReadonlySet<string>): readonly Match[] {
  const found: Match[] = [];

  for (const term of GLOSSARY) {
    if (exclude.has(term.slug)) continue;
    for (const phrase of [term.term, ...term.aliases]) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`\\b${escaped}\\b`, "i").exec(text);
      if (match !== null) {
        found.push({ start: match.index, end: match.index + match[0].length, term });
        break;
      }
    }
  }

  // Longest first at the same position, so "true discount to value" wins over
  // "true discount" and the shorter one is then dropped as overlapping.
  const ordered = [...found].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  let cursor = -1;
  for (const match of ordered) {
    if (match.start >= cursor) {
      kept.push(match);
      cursor = match.end;
    }
  }
  return kept;
}

function Linked({ text, linked }: { text: string; linked: Set<string> }) {
  const matches = findTerms(text, linked);
  if (matches.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    linked.add(match.term.slug);
    if (match.start > cursor) parts.push(text.slice(cursor, match.start));
    parts.push(
      <Link
        key={`${match.term.slug}-${match.start}`}
        href={`/glossary/${match.term.slug}`}
        title={match.term.short}
        className="text-lode-200 underline decoration-lode-500/40 underline-offset-2 transition hover:decoration-lode-300"
      >
        {text.slice(match.start, match.end)}
      </Link>,
    );
    cursor = match.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function Prose({ blocks }: { blocks: readonly Block[] }) {
  // Shared across the whole body: a term linked in the opening paragraph does
  // not need linking again four paragraphs later.
  const linked = new Set<string>();

  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "heading":
            return (
              <h2 key={key} className="pt-4 font-display text-2xl text-ink-100">
                <Linked text={block.text} linked={linked} />
              </h2>
            );
          case "paragraph":
            return (
              <p key={key} className="text-[15px] leading-relaxed text-ink-300">
                <Linked text={block.text} linked={linked} />
              </p>
            );
          case "list":
            return (
              <ul key={key} className="space-y-2.5">
                {block.items.map((item) => (
                  <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-ink-300">
                    <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                    <span>
                      <Linked text={item} linked={linked} />
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-lode-500/50 bg-ink-900/40 px-5 py-4 text-[15px] leading-relaxed text-ink-200"
              >
                <Linked text={block.text} linked={linked} />
              </blockquote>
            );
          case "figures":
            return (
              <figure key={key} className="rounded-2xl border hairline bg-ink-900/40 px-6 py-5">
                <figcaption className="text-[11px] uppercase tracking-[0.12em] text-ink-400">
                  {block.caption}
                </figcaption>
                <dl className="mt-4 divide-y divide-ink-800/70">
                  {block.rows.map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
                      <dt className="text-sm text-ink-400">{row.label}</dt>
                      <dd className="tnum text-sm text-ink-100">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </figure>
            );
          case "faq":
            return (
              <section key={key} className="pt-4">
                <h2 className="font-display text-2xl text-ink-100">Common questions</h2>
                <dl className="mt-4 space-y-4">
                  {block.items.map((item) => (
                    <div key={item.question}>
                      <dt className="text-[15px] text-ink-100">{item.question}</dt>
                      <dd className="mt-1 text-[15px] leading-relaxed text-ink-300">
                        <Linked text={item.answer} linked={linked} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
        }
      })}
    </div>
  );
}
