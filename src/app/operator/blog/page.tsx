import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { requirePermission } from "@/app/operator/guard";
import { listBlogViews } from "@backend/store/repository";
import { loadCorpus } from "@backend/blog/corpus";
import { auditCorpus, type SeoCheck, type SeoReport } from "@shared/domain/seo";

export const dynamic = "force-dynamic";

export const metadata = { title: "Blog performance — Lode" };

/**
 * How the blog is doing, from this platform's own figures.
 *
 * Two numbers per post, and they answer different questions. **Opens** is a
 * counter on our own server, so it keeps counting when a reader declines the
 * consent banner or runs an ad blocker — which no pixel does. **SEO** is a
 * deterministic audit of the post itself, computed on every render because it
 * costs nothing and calls nothing.
 *
 * Neither is a ranking. Nothing here can see a competitor, a backlink or a
 * search volume, and a page saying otherwise would be inventing figures. What
 * it can say is which posts people open and which posts have problems that are
 * definitely costing them, in the order worth fixing.
 */
const BAND_TONE: Record<SeoReport["band"], string> = {
  strong: "text-emerald-300",
  workable: "text-amber-300",
  weak: "text-red-300",
};

const SEVERITY_TONE: Record<SeoCheck["severity"], string> = {
  problem: "text-red-300",
  improvement: "text-amber-300",
  pass: "text-ink-500",
};

export default async function BlogPerformancePage() {
  await requirePermission("view-content-performance", "/operator/blog");

  const [corpus, viewRows] = await Promise.all([loadCorpus(), listBlogViews()]);
  const reports = auditCorpus(corpus);
  const views = new Map(viewRows.map((row) => [row.slug, row]));

  const totalOpens = viewRows.reduce((sum, row) => sum + row.views, 0);
  const averageScore =
    reports.length === 0
      ? 0
      : Math.round(reports.reduce((sum, r) => sum + r.score, 0) / reports.length);
  const problems = reports.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.severity === "problem").length,
    0,
  );

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
            <Link href="/operator/blog" className="text-ink-100">Blog</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          Blog performance
        </span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100">
          {reports.length === 0
            ? "No posts published"
            : `${reports.length} post${reports.length === 1 ? "" : "s"}, worst first`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Opens are counted on this server, so they keep counting when a reader declines cookies or
          blocks the pixels. The SEO score audits each post against what is inside this codebase —
          title, description, structure, body length and internal links. It is not a ranking, and
          nothing here can see a competitor or a backlink.
        </p>

        {reports.length === 0 ? (
          <p className="mt-10 rounded-2xl border hairline bg-ink-900/40 px-6 py-8 text-sm text-ink-400">
            The corpus is empty. Posts are generated from evergreen explainers and from deals worth
            writing up, so publishing one means recording a deal.
          </p>
        ) : (
          <>
            <dl className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Stat label="Total opens" value={totalOpens.toLocaleString("en-GB")} />
              <Stat label="Average SEO score" value={`${averageScore}`} />
              <Stat
                label="Problems to fix"
                value={`${problems}`}
                tone={problems > 0 ? "text-amber-300" : "text-emerald-300"}
              />
            </dl>

            {totalOpens === 0 && (
              <p className="mt-6 rounded-2xl border hairline bg-ink-900/40 px-6 py-5 text-sm text-ink-400">
                No opens recorded yet. The counter starts when somebody visits a post — it does not
                backfill, so this stays at zero for posts published before counting existed.
              </p>
            )}

            <ol className="mt-10 space-y-5">
              {reports.map((report) => {
                const row = views.get(report.slug);
                return (
                  <li
                    key={report.slug}
                    className="rounded-2xl border hairline bg-ink-900/40 px-6 py-6"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                      <Link
                        href={`/blog/${report.slug}`}
                        className="font-display text-lg text-ink-100 transition hover:text-lode-200"
                      >
                        {report.title}
                      </Link>
                      <p className="font-mono text-xs text-ink-400">
                        <span className={BAND_TONE[report.band]}>SEO {report.score}</span>
                        <span className="text-ink-600"> · </span>
                        {(row?.views ?? 0).toLocaleString("en-GB")} open
                        {(row?.views ?? 0) === 1 ? "" : "s"}
                        <span className="text-ink-600"> · </span>
                        {report.words} words
                        <span className="text-ink-600"> · </span>
                        {report.internalLinkCount} links
                      </p>
                    </div>

                    {report.issues.length === 0 ? (
                      <p className="mt-4 text-sm text-emerald-300">
                        Every check passes. Nothing on this page is holding it back.
                      </p>
                    ) : (
                      <ul className="mt-4 space-y-3">
                        {report.issues.map((issue) => (
                          <li key={issue.id} className="text-sm leading-relaxed">
                            <span className={`font-mono text-xs ${SEVERITY_TONE[issue.severity]}`}>
                              {issue.severity === "problem" ? "PROBLEM" : "IMPROVE"}
                            </span>{" "}
                            <span className="text-ink-200">{issue.label}</span>
                            <span className="text-ink-600"> — </span>
                            <span className="text-ink-300">{issue.finding}</span>
                            {issue.remedy !== undefined && (
                              <span className="block pl-1 text-ink-400">→ {issue.remedy}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {row !== undefined && (
                      <p className="mt-4 font-mono text-[11px] text-ink-600">
                        Last opened {new Date(row.lastViewedAt).toLocaleString("en-GB")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border hairline bg-ink-900/40 px-5 py-4">
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500">{label}</dt>
      <dd className={`mt-2 font-display text-2xl ${tone ?? "text-ink-100"}`}>{value}</dd>
    </div>
  );
}
