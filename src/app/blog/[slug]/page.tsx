import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { Prose } from "@/app/components/prose";
import { TrackOnView } from "@/app/components/TrackOnView";
import { RecordBlogView } from "@/app/components/RecordBlogView";
import { loadCorpus } from "@backend/blog/corpus";
import { siteUrl, SITE_NAME } from "@backend/site";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  canonical,
  faqJsonLd,
  internalLinks,
  readingMinutes,
  relatedPosts,
  termsMentioned,
  TOPIC_DEFINITIONS,
} from "@shared/domain/blog";

export const revalidate = 3600;

/** Pre-rendered so a crawler is never served a cold page. */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return (await loadCorpus()).map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = (await loadCorpus()).find((p) => p.slug === slug);
  if (post === undefined) return { title: "Not found" };

  const url = canonical(siteUrl(), `/blog/${post.slug}`);
  return {
    title: `${post.title} — ${SITE_NAME}`,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const corpus = await loadCorpus();
  const post = corpus.find((p) => p.slug === slug);
  if (post === undefined) notFound();

  const base = siteUrl();
  const topic = TOPIC_DEFINITIONS[post.topic];
  const related = relatedPosts(post, corpus);
  const terms = termsMentioned(post);
  const links = internalLinks(post, corpus);
  const faq = faqJsonLd(post);

  const trail = [
    { name: "Blog", path: "/blog" },
    { name: topic.label, path: `/blog/topic/${post.topic}` },
    { name: post.title, path: `/blog/${post.slug}` },
  ];

  return (
    <main className="min-h-screen pb-24">
      {/* Structured data. Article and breadcrumbs always; FAQ where the post
          answers questions, because marking up an FAQ that is not there is how
          a site earns a manual action. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleJsonLd(post, base, SITE_NAME)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail, base)) }}
      />
      {faq !== undefined && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
        />
      )}

      <RecordBlogView slug={post.slug} />

      <TrackOnView
        event="blog_post_viewed"
        properties={{ content: post.slug, category: post.topic }}
      />

      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/blog" className="text-ink-100">Blog</Link>
            <Link href="/glossary" className="transition hover:text-ink-100">Glossary</Link>
            <Link href="/sell" className="transition hover:text-ink-100">Sell</Link>
          </nav>
        }
      />

      <article className="mx-auto max-w-3xl px-6 py-10">
        {/* The last crumb is the page itself and is not a link — a breadcrumb
            that links to where you already are is noise to a reader and to a
            crawler. */}
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <Link href="/blog" className="text-lode-300 transition hover:text-lode-200">
            Blog
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href={`/blog/topic/${post.topic}`}
            className="text-lode-300 transition hover:text-lode-200"
          >
            {topic.label}
          </Link>
        </nav>

        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">{post.title}</h1>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ink-500">
          <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>
          <span>·</span>
          <span>{readingMinutes(post)} min read</span>
          {post.fromLiveDeal && (
            <>
              <span>·</span>
              <span className="text-lode-400">figures from a live deal</span>
            </>
          )}
        </div>

        <div className="mt-10">
          <Prose blocks={post.body} />
        </div>

        {terms.length > 0 && (
          <section className="mt-14 rounded-2xl border hairline bg-surface-1 px-5 py-4">
            <h2 className="eyebrow">
              Terms used on this page
            </h2>
            <dl className="mt-4 space-y-3">
              {terms.map((term) => (
                <div key={term.slug}>
                  <dt className="text-sm text-ink-100">
                    <Link
                      href={`/glossary/${term.slug}`}
                      className="text-lode-200 underline decoration-lode-500/40 underline-offset-2"
                    >
                      {term.term}
                    </Link>
                  </dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-ink-400">{term.short}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-6">
            <h2 className="eyebrow">Related reading</h2>
            <ul className="mt-4 space-y-3">
              {related.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/blog/${other.slug}`}
                    className="text-[15px] text-ink-100 transition hover:text-lode-200"
                  >
                    {other.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-ink-500">{other.description}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <h2 className="eyebrow">Where to next</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {links
              .filter((l) => !l.href.startsWith("/blog/"))
              .map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    title={link.context}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
          </ul>
        </section>

        <footer className="mt-10 border-t hairline pt-5 text-xs leading-relaxed text-ink-500">
          {post.attributions.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="mt-2">
            Figures are screening estimates, not advice. Tax figures require professional review.
          </p>
        </footer>
      </article>
    </main>
  );
}
