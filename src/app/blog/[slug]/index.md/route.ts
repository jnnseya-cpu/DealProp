import { loadCorpus } from "@backend/blog/corpus";
import { siteUrl } from "@backend/site";
import { postMarkdown } from "@shared/domain/blog";

export const revalidate = 3600;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return (await loadCorpus()).map((post) => ({ slug: post.slug }));
}

/**
 * The same post, as Markdown.
 *
 * Served for anything consuming this page as a source rather than rendering
 * it. The HTML carries a `rel="alternate"` pointing here, and `llms.txt` links
 * here rather than to the page, so a crawler that wants the content does not
 * have to strip a layout to find it.
 *
 * Derived from the same `BlogPost` the page renders. There is no second copy
 * of a post to fall out of date with the first, which is the only reason this
 * is safe to publish at all — a stale machine-readable mirror of a page is a
 * worse problem than not having one.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const corpus = await loadCorpus();
  const post = corpus.find((p) => p.slug === slug);
  if (post === undefined) return new Response("Not found\n", { status: 404 });

  return new Response(postMarkdown(post, corpus, siteUrl()), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
