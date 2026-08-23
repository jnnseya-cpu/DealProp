"use client";

import { useEffect } from "react";

/**
 * Tell the server this post was opened.
 *
 * Blog posts are statically generated with a one-hour revalidate, so the page
 * component does not run per visitor and cannot count anything. This does it
 * from the browser instead.
 *
 * `keepalive` rather than `sendBeacon` because the request needs a JSON body
 * and a content type, and it must survive the reader clicking away immediately
 * — which, on a blog, is most of them.
 *
 * Deliberately not gated on consent: nothing is stored on the device and the
 * server stores a count against a slug and nothing else. There is no identifier
 * to consent to. It is equally deliberately not deduplicated with session
 * storage, because that *would* be device storage and would need consent to do
 * something a plain count does not. What this measures is page opens, and that
 * is what the operator dashboard calls it.
 */
/**
 * Slugs already counted in this tab.
 *
 * Two reasons, and neither is device storage. React's development mode mounts
 * every effect twice on purpose, which would double every count a developer
 * ever looked at. And the request must not be cancelled on unmount — that is
 * what `keepalive` is for — so there is no cleanup to rely on instead.
 */
const reported = new Set<string>();

export function RecordBlogView({ slug }: { slug: string }) {
  useEffect(() => {
    if (reported.has(slug)) return;
    reported.add(slug);

    void fetch("/api/blog/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => {
      // Offline, blocked, or navigated away mid-flight. A missed count is not
      // an error worth showing a reader.
    });
  }, [slug]);

  return null;
}
