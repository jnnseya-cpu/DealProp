import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { loadCorpus } from "@backend/blog/corpus";
import { readingMinutes, TOPIC_DEFINITIONS, TOPICS } from "@shared/domain/blog";
import { siteUrl } from "@backend/site";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "The Lode blog — property deals with the working shown",
  description:
    "Real deals run through the engine, including the ones we turned down. Plus what open property data, tax and regulation actually do to a figure.",
  alternates: { canonical: `${siteUrl()}/blog` },
  openGraph: {
    type: "website",
    title: "The Lode blog",
    description: "Property deals with the working shown, including the rejections.",
    url: `${siteUrl()}/blog`,
  },
};

export default async function BlogIndex() {
  const corpus = await loadCorpus();

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/sell" className="transition hover:text-ink-100">Sell</Link>
            <Link href="/blog" className="text-ink-100">Blog</Link>
            <Link href="/newsletter" className="transition hover:text-ink-100">Newsletter</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          Writing
        </span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100 sm:text-5xl">
          Deals with the working shown
        </h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-300">
          Every figure here is computed by the same engine that produces the Deal Room, on profit
          after tax. That includes the deals we refused — those are the ones worth reading, because
          anyone can publish a deal that worked.
        </p>

        <nav aria-label="Topics" className="mt-8 flex flex-wrap gap-2">
          {TOPICS.map((topic) => (
            <Link
              key={topic}
              href={`/blog/topic/${topic}`}
              className="rounded-full border hairline px-3.5 py-1.5 text-xs text-ink-300 transition hover:border-lode-400/40 hover:text-lode-200"
            >
              {TOPIC_DEFINITIONS[topic].label}
            </Link>
          ))}
          <Link
            href="/glossary"
            className="rounded-full border border-lode-500/30 px-3.5 py-1.5 text-xs text-lode-300 transition hover:border-lode-400"
          >
            Glossary
          </Link>
        </nav>

        <div className="mt-12 space-y-8">
          {corpus.map((post) => (
            <article key={post.slug} className="border-b hairline pb-8">
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
                <Link
                  href={`/blog/topic/${post.topic}`}
                  className="text-lode-300 transition hover:text-lode-200"
                >
                  {TOPIC_DEFINITIONS[post.topic].label}
                </Link>
                <span>·</span>
                <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>
                <span>·</span>
                <span>{readingMinutes(post)} min read</span>
                {post.fromLiveDeal && (
                  <>
                    <span>·</span>
                    <span className="text-lode-400">from a live deal</span>
                  </>
                )}
              </div>
              <h2 className="mt-3 font-display text-2xl leading-snug text-ink-100">
                <Link href={`/blog/${post.slug}`} className="transition hover:text-lode-200">
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-400">{post.description}</p>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
