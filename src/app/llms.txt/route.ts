import { loadCorpus } from "@backend/blog/corpus";
import { siteUrl, SITE_NAME } from "@backend/site";
import { llmsTxt } from "@shared/domain/blog";

export const revalidate = 3600;

/**
 * `/llms.txt`.
 *
 * A Markdown index of the site for anything that reads rather than renders:
 * what is published, where the canonical text of each piece lives, and the
 * definitions the writing depends on. A convention rather than a standard, and
 * cheap enough that its uncertain future is not a reason to skip it.
 *
 * Computed from the corpus on every regeneration, so it cannot list a post
 * that no longer exists or miss one that does — which is the failure mode of
 * every hand-maintained index of a site's own contents.
 */
export async function GET(): Promise<Response> {
  const corpus = await loadCorpus();
  const body = llmsTxt(
    corpus,
    siteUrl(),
    SITE_NAME,
    "A property deal engine. Sellers bring a situation, dealmakers bring the opportunity, funders bring the capital, and the platform structures a transaction that survives tax, stress testing and completion.",
  );

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
