import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { siteUrl, SITE_NAME } from "@backend/site";
import { canonical, GLOSSARY, TOPIC_DEFINITIONS, TOPICS } from "@shared/domain/blog";

export const metadata: Metadata = {
  title: `Property investment glossary — ${SITE_NAME}`,
  description:
    "The terms where misunderstanding the word means misunderstanding the figure: true discount, GDV, the additional dwelling surcharge, MEES and the rest.",
  alternates: { canonical: canonical(siteUrl(), "/glossary") },
};

export default function GlossaryIndex() {
  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/blog" className="transition hover:text-ink-100">Blog</Link>
            <Link href="/glossary" className="text-ink-100">Glossary</Link>
          </nav>
        }
      />
      <div className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-display text-4xl leading-tight text-ink-100">Glossary</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-300">
          The load-bearing terms — the ones where misunderstanding the word means misunderstanding
          the figure. Every one of them is something the engine actually computes.
        </p>

        {TOPICS.map((topic) => {
          const terms = GLOSSARY.filter((t) => t.topic === topic);
          if (terms.length === 0) return null;
          return (
            <section key={topic} className="mt-10">
              <h2 className="text-[11px] uppercase tracking-[0.12em] text-lode-400">
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
    </main>
  );
}
