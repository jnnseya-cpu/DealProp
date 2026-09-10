import { SiteFooter } from "@/app/components/SiteFooter";
import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { siteUrl, SITE_NAME } from "@backend/site";
import {
  canonical,
  definedTermSetJsonLd,
  GLOSSARY,
  TOPIC_DEFINITIONS,
  TOPICS,
} from "@shared/domain/blog";

/*
 * Not indefinitely static.
 *
 * The footer prints the Companies Act 2006 s.82 disclosure, and it reads it
 * from the environment at render time. A page prerendered once at build has
 * that environment baked into it — and the Dockerfile deliberately passes only
 * NEXT_PUBLIC_* as build arguments, so at build there is no company identity to
 * read. A page with no revalidate would therefore serve "identity has not been
 * configured" for the life of the deployment, on the pages a seller actually
 * lands on. An hour is the window after a deploy, not a permanent state.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: `Property investment glossary — ${SITE_NAME}`,
  description:
    "The terms where misunderstanding the word means misunderstanding the figure: true discount, GDV, the additional dwelling surcharge, MEES and the rest.",
  alternates: { canonical: canonical(siteUrl(), "/glossary") },
};

export default function GlossaryIndex() {
  return (
    <main className="min-h-screen pb-24">
      {/*
        The glossary as a DefinedTermSet.

        The most under-used piece of schema there is and the one that fits this
        site exactly: a set of terms with stable addresses, each referenced by
        `@id` from every post that uses it. That is an entity graph rather than
        a keyword list — the difference between a model knowing this site
        discusses true discount and knowing it defines it.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            definedTermSetJsonLd(siteUrl(), `${SITE_NAME} property glossary`),
          ),
        }}
      />
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/blog" className="transition hover:text-ink-100">Blog</Link>
            <Link href="/glossary" className="text-ink-100">Glossary</Link>
          </nav>
        }
      />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">Glossary</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-300">
          The load-bearing terms — the ones where misunderstanding the word means misunderstanding
          the figure. Every one of them is something the engine actually computes.
        </p>

        {TOPICS.map((topic) => {
          const terms = GLOSSARY.filter((t) => t.topic === topic);
          if (terms.length === 0) return null;
          return (
            <section key={topic} className="mt-10">
              <h2 className="eyebrow">
                <Link href={`/blog/topic/${topic}`} className="transition hover:text-lode-200">
                  {TOPIC_DEFINITIONS[topic].label}
                </Link>
              </h2>
              <dl className="mt-4 space-y-4">
                {terms.map((term) => (
                  <div key={term.slug}>
                    <dt className="text-[15px] text-ink-100">
                      <Link
                        href={`/glossary/${term.slug}`}
                        className="text-lode-200 underline decoration-lode-500/40 underline-offset-2 transition hover:decoration-lode-300"
                      >
                        {term.term}
                      </Link>
                    </dt>
                    <dd className="mt-1 text-sm leading-relaxed text-ink-400">{term.short}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
      <SiteFooter />
    </main>
  );
}
