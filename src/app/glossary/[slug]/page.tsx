import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { TrackOnView } from "@/app/components/TrackOnView";
import { loadCorpus } from "@backend/blog/corpus";
import { siteUrl, SITE_NAME } from "@backend/site";
import {
  breadcrumbJsonLd,
  canonical,
  GLOSSARY,
  glossaryTerm,
  termsMentioned,
  TOPIC_DEFINITIONS,
} from "@shared/domain/blog";

export const revalidate = 3600;

export function generateStaticParams(): { slug: string }[] {
  return GLOSSARY.map((term) => ({ slug: term.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const term = glossaryTerm(slug);
  if (term === undefined) return { title: "Not found" };
  return {
    title: `${term.term} — ${SITE_NAME}`,
    description: term.short,
    alternates: { canonical: canonical(siteUrl(), `/glossary/${term.slug}`) },
  };
}

/**
 * A definition page.
 *
 * These are the landing pages for the long tail — somebody searching "what is
 * true discount property" wants one screen, not a 2,000-word article. Each one
 * lists every post that uses the term, which is what makes the link graph
 * bidirectional: posts point at definitions, definitions point back at posts.
 */
export default async function TermPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const term = glossaryTerm(slug);
  if (term === undefined) notFound();

  const corpus = await loadCorpus();
  const mentions = corpus.filter((post) =>
    termsMentioned(post).some((t) => t.slug === term.slug),
  );
  const siblings = GLOSSARY.filter((t) => t.topic === term.topic && t.slug !== term.slug);
  const topic = TOPIC_DEFINITIONS[term.topic];

  const trail = [
    { name: "Glossary", path: "/glossary" },
    { name: term.term, path: `/glossary/${term.slug}` },
  ];

  return (
    <main className="min-h-screen pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd(trail, siteUrl())),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "DefinedTerm",
            name: term.term,
            description: term.short,
            inDefinedTermSet: canonical(siteUrl(), "/glossary"),
          }),
        }}
      />

      <TrackOnView
        event="glossary_term_viewed"
        properties={{ content: term.slug, category: term.topic }}
      />

      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/blog" className="transition hover:text-ink-100">Blog</Link>
            <Link href="/glossary" className="text-ink-100">Glossary</Link>
            <Link href="/sell" className="transition hover:text-ink-100">Sell</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-2xl px-6 py-10">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
          <Link href="/glossary" className="text-lode-300 transition hover:text-lode-200">
            Glossary
          </Link>
          <span aria-hidden="true"> / </span>
          <Link
            href={`/blog/topic/${term.topic}`}
            className="text-lode-300 transition hover:text-lode-200"
          >
            {topic.label}
          </Link>
        </nav>

        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">{term.term}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-200">{term.short}</p>

        <div className="mt-8 space-y-4">
          {term.body.map((paragraph) => (
            <p key={paragraph} className="text-[15px] leading-relaxed text-ink-300">
              {paragraph}
            </p>
          ))}
        </div>

        {mentions.length > 0 && (
          <section className="mt-12">
            <h2 className="eyebrow">
              Where this comes up
            </h2>
            <ul className="mt-4 space-y-3">
              {mentions.map((post) => (
                <li key={post.slug}>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="text-[15px] text-ink-100 transition hover:text-lode-200"
                  >
                    {post.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-ink-500">{post.description}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {siblings.length > 0 && (
          <section className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
            <h2 className="eyebrow">
              Related definitions
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {siblings.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/glossary/${other.slug}`}
                    title={other.short}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
                  >
                    {other.term}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
