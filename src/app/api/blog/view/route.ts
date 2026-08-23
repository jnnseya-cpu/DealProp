import { NextResponse } from "next/server";
import { loadCorpus } from "@backend/blog/corpus";
import { recordBlogView } from "@backend/store/repository";

export const dynamic = "force-dynamic";

/**
 * Count a blog post being opened.
 *
 * Why this exists at all when there are two analytics vendors on the site: a
 * pixel reports to Meta and Google, and only to Meta and Google. Reading it back
 * means opening someone else's dashboard, it stops entirely when a visitor
 * declines the consent banner or runs an ad blocker — which is most of them —
 * and it cannot be shown on an operator page next to the post it describes.
 * This is a counter on our own server that answers "which posts are read"
 * without depending on either.
 *
 * What is stored is a number per slug. No IP address, no user agent, no
 * identifier, no per-view row — so nothing here is personal data, nothing needs
 * a lawful basis beyond legitimate interest, and no consent is required under
 * PECR reg. 6 because nothing is stored on or read from the device.
 *
 * The slug is checked against the real corpus before anything is written. A
 * POST body is client input; without that check this endpoint is an open
 * invitation to create rows, and the operator dashboard is where they would
 * show up.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let slug: unknown;
  try {
    const body: unknown = await request.json();
    slug = typeof body === "object" && body !== null ? (body as { slug?: unknown }).slug : undefined;
  } catch {
    return NextResponse.json({ status: "rejected" }, { status: 400 });
  }

  if (typeof slug !== "string" || slug === "" || slug.length > 120) {
    return NextResponse.json({ status: "rejected" }, { status: 400 });
  }

  const corpus = await loadCorpus();
  if (!corpus.some((post) => post.slug === slug)) {
    // Deliberately the same response as a malformed body. Whoever is probing
    // does not get to use this endpoint to enumerate which slugs exist.
    return NextResponse.json({ status: "rejected" }, { status: 400 });
  }

  try {
    await recordBlogView(slug, new Date().toISOString());
  } catch {
    // A counter is not worth a 500 on a page that has already rendered. The
    // reason goes to the server log; the reader sees nothing either way.
    process.stderr.write("blog view: store unreachable\n");
  }

  // No body worth returning, and no cache anywhere in front of it.
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
