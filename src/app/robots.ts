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
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/deals",
          "/invest",
          "/opportunities",
          "/capital",
          "/operator",
          "/account",
          "/sell/",
          "/api/",
          // Carries a recipient's own address in the query string. Nothing to
          // index, and no reason for it to appear in a search result.
          "/outreach/",
          // Capability URLs granting one funder a time-limited view of one deal.
          "/dataroom/",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
