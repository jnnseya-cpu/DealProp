import type { MetadataRoute } from "next";
import { loadCorpus } from "@backend/blog/corpus";
import { siteUrl } from "@backend/site";
import { canonical, GLOSSARY, TOPICS } from "@shared/domain/blog";

export const revalidate = 3600;

/**
 * The sitemap.
 *
 * Public pages only. The operator surfaces are absent for the same reason
 * robots.txt disallows them: they carry seller screening answers, and a URL a
 * crawler has never seen is one fewer way in.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const corpus = await loadCorpus();
  const now = new Date();

  return [
    { url: canonical(base, "/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: canonical(base, "/sell"), lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: canonical(base, "/blog"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: canonical(base, "/glossary"), lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    {
      url: canonical(base, "/newsletter"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    ...TOPICS.map((topic) => ({
      url: canonical(base, `/blog/topic/${topic}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...corpus.map((post) => ({
      url: canonical(base, `/blog/${post.slug}`),
      lastModified: new Date(post.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...GLOSSARY.map((term) => ({
      url: canonical(base, `/glossary/${term.slug}`),
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
  ];
}
