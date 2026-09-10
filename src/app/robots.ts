import type { MetadataRoute } from "next";
import { siteUrl } from "@backend/site";

/**
 * robots.txt.
 *
 * The disallow list is the point. Those paths carry what sellers told us in
 * confidence, including reported financial distress and health concerns, and a
 * seller's own result page is a capability URL that must never be indexed. They
 * are gated by middleware and by a per-page guard, and keeping them out of the
 * index is the third layer — not a substitute for either.
 */
/**
 * The crawlers that read for a model rather than for an index.
 *
 * Named explicitly and allowed explicitly, which is a decision rather than an
 * oversight. The business case for this platform is that its figures are
 * computed and its sources are cited; being quoted by an answer engine with
 * attribution is the distribution, not the leak. A publisher whose value is
 * volume of ad impressions should reach the opposite conclusion, and the point
 * of writing the list down is that somebody made the choice.
 *
 * Every one of them inherits the same disallow list as everybody else. The
 * operator surfaces carry what sellers told us in confidence, and there is no
 * reading of "we would like to be cited" that includes those.
 */
const READS_FOR_A_MODEL: readonly string[] = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
  "Bytespider",
  "cohere-ai",
  "DuckAssistBot",
  "MistralAI-User",
];

export default function robots(): MetadataRoute.Robots {
  const disallow = [
    "/deals",
    "/invest",
    "/opportunities",
    "/portfolio",
    "/capital",
    "/operator",
    "/account",
    "/sell/",
    "/api/",
    // Carries a recipient's own address in the query string. Nothing to index,
    // and no reason for it to appear in a search result.
    "/outreach/",
    // Capability URLs granting one funder a time-limited view of one deal.
    "/dataroom/",
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...READS_FOR_A_MODEL.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
