import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { loadCorpus } from "@backend/blog/corpus";
import { siteUrl, SITE_NAME } from "@backend/site";
import {
  breadcrumbJsonLd,
  canonical,
  GLOSSARY,
  readingMinutes,
  TOPIC_DEFINITIONS,
  TOPICS,
  type Topic,
} from "@shared/domain/blog";

export const revalidate = 3600;

export async function generateStaticParams(): Promise<{ topic: string }[]> {
  return TOPICS.map((topic) => ({ topic }));
}

function isTopic(value: string): value is Topic {
  return (TOPICS as readonly string[]).includes(value);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;
  if (!isTopic(topic)) return { title: "Not found" };
  const definition = TOPIC_DEFINITIONS[topic];
  return {
    title: `${definition.title} — ${SITE_NAME}`,
    description: definition.description,
    alternates: { canonical: canonical(siteUrl(), `/blog/topic/${topic}`) },
  };
}

/**
 * A topic hub.
 *
 * Hubs are what turn a list of posts into a structure a crawler can follow, and
 * what give a reader arriving on one article somewhere to go next. Each links
 * to every post on the topic and to the glossary terms filed under it, so the
 * link graph is dense in both directions rather than only downward.
 */
export default async function TopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  if (!isTopic(topic)) notFound();

  const definition = TOPIC_DEFINITIONS[topic];
  const posts = (await loadCorpus()).filter((p) => p.topic === topic);
  const terms = GLOSSARY.filter((t) => t.topic === topic);
  const trail = [
    { name: "Blog", path: "/blog" },
    { name: definition.label, path: `/blog/topic/${topic}` },
  ];

  return (
    <main className="min-h-screen pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd(trail, siteUrl())),
        }}
      />
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/blog" className="transition hover:text-ink-100">Blog</Link>
            <Link href="/glossary" className="transition hover:text-ink-100">Glossary</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
          <Link href="/blog" className="text-lode-300 transition hover:text-lode-200">Blog</Link>
          <span aria-hidden="true"> / </span>
          <span className="text-ink-400">{definition.label}</span>
        </nav>

        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">{definition.title}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-300">
          {definition.description}
        </p>

        <nav aria-label="Other topics" className="mt-8 flex flex-wrap gap-2">
          {TOPICS.filter((t) => t !== topic).map((other) => (
            <Link
              key={other}
              href={`/blog/topic/${other}`}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
            >
              {TOPIC_DEFINITIONS[other].label}
            </Link>
          ))}
        </nav>

        {posts.length === 0 ? (
          <p className="mt-12 text-sm text-ink-400">Nothing filed here yet.</p>
        ) : (
          <div className="mt-12 space-y-8">
            {posts.map((post) => (
              <article key={post.slug} className="border-b hairline pb-8">
                <h2 className="font-display text-2xl leading-snug text-ink-100">
                  <Link href={`/blog/${post.slug}`} className="transition hover:text-lode-200">
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-400">{post.description}</p>
                <p className="mt-2 text-xs text-ink-500">
                  {post.publishedAt.slice(0, 10)} · {readingMinutes(post)} min read
                </p>
              </article>
            ))}
          </div>
        )}

        {terms.length > 0 && (
          <section className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
            <h2 className="eyebrow">
              Definitions on this topic
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {terms.map((term) => (
                <li key={term.slug}>
                  <Link
                    href={`/glossary/${term.slug}`}
                    title={term.short}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
                  >
                    {term.term}
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
